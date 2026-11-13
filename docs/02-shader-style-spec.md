# 02 — Shader & Style Specification

> Status: **v0.3** — S1–S4 decided; S5–S6 open. M1 implementation notes and calibrated values in §18.
> Depends on: [01 — Engine & Visual Direction](01-engine-visual-direction.md) (D1 ink-comic style, D2 rotating 3/4 camera, D3 WebGPU + TSL, D4 mid-range 2021 mobile, D6 steam foundry biome).
> Purpose: define *exactly* how a frame is built so shaders, art and tooling can be developed in parallel.
> All numeric values are **starting values** to be tuned in the look-test prototype. Pixel sizes refer to a **1080p reference** and scale with render height.

---

## 1. Anatomy of a frame

The final image is built in layers. Each layer has one job; none of them should try to do another's job.

| # | Layer | Where | Job |
|---|---|---|---|
| 1 | **Painted albedo** | Textures | Color, grime, rust, small ink details (rivets, seams). No lighting direction baked in, except AO. |
| 2 | **Ink lighting** (`InkLit` material) | Forward pass | Soft-banded light ramp, warm-lit / cool-shadow color shift, light pools from local lights. |
| 3 | **Hatching** | Forward pass (inside `InkLit`) | Pen strokes in shadow areas, driven by the lighting term. |
| 4 | **Emissive** | Forward pass | Fire, runes, neon, lava. HDR values feed the bloom. |
| 5 | **Fog & mist** | Forward pass | Distance + height fog per biome. |
| 6 | **Particles & transparents** | Forward pass (after opaque) | Smoke, steam, sparks, flashes. |
| 7 | **Outlines** | Post | Silhouette, crease and object-boundary lines from depth/normal/ID buffers. |
| 8 | **Bloom** | Post | Glow around HDR emissive. |
| 9 | **Grade & paper** | Post | Tonemapping, 3D LUT, vignette, paper texture, grain. |
| 10 | **Anti-aliasing** | Post | FXAA (Low/Med) or SMAA (High/Ultra). |

---

## 2. Render pipeline

```
Scene (opaque, InkLit)                  ┐
  → MRT: color (HDR RGBA16F)            │  one geometry pass
         normal (view-space, RGBA8/16F) │
         meta   (RGBA8)                 │
         depth                          ┘
Scene (transparents/particles) → color only (no normal/meta write)
Post: outlines(depth, normal, meta) → composite on color
    → bloom(color) → tonemap → LUT → vignette + paper + grain → AA → screen
HUD: HTML/CSS overlay (outside WebGL/WebGPU)
```

### 2.1 `meta` buffer layout (RGBA8)

| Channel | Content | Used by |
|---|---|---|
| R | **Object ID hash** (8-bit, per mesh/instance group) | ID edges in outline pass |
| G | **Line weight** (0 = no outline, 0.5 = default, 1.0 = heavy) | Outline thickness/strength per object |
| B | **Hatch mask** (debug/composite: amount of hatching applied) | Debug view, optional screen-space hatch fallback |
| A | **Flags** (bit 0: is vehicle, bit 1: is hazard, bit 2: no-fog) | Readability tweaks, debug |

Mobile Low tier: `meta` can be dropped; outlines then use depth + normal only.

### 2.2 Implementation notes (Three.js WebGPU / TSL)

- Geometry pass: `pass(scene, camera)` with `setMRT(mrt({ output, normal: normalView, meta: ... }))`.
- `InkLit` is implemented as a **custom `LightingModel`** subclass (same mechanism as the built-in toon material), so the standard Three.js light objects, shadows and tiled lighting keep working. The material extends `NodeMaterial` and exposes the parameters in §3.6.
- Post-processing is a TSL node graph (`PostProcessing` + display nodes for bloom, LUT, FXAA/SMAA); outline, hatch fallback and paper composite are custom TSL nodes.
- Pin the Three.js version; TSL APIs still change between releases.

---

## 3. `InkLit` lighting model

### 3.1 Inputs

| Input | Source |
|---|---|
| `albedo` | sRGB texture (atlas / trim sheet) × `tint` |
| `ao` | Baked AO (vertex color channel or `aoMap`) |
| `emissive` | Emissive mask (texture channel) × `emissiveColor` × `emissiveIntensity` |
| `rampTex` | Biome ramp texture, 256×8, one row per material class (§3.5) |
| `rampRow` | Material class index |
| `metalSheen` | 0–1, stylized highlight for brass/copper/polished steel |
| `hatchStrength` | 0–1 (default 0.6) |

Normal maps are **not** used in the environment (detail lives in albedo ink lines). Vehicles may use a low-strength normal map on High/Ultra only.

### 3.2 Key light (directional)

```
w        = 0.35                                   // wrap amount
ndl      = dot(N, L)
d        = saturate((ndl + w) / (1 + w))          // wrapped Lambert
d       *= shadow                                 // shadow map (or 1 on Low)
ramp     = texture(rampTex, vec2(d, rampRow))     // banded color ramp
key      = ramp.rgb * keyColor * keyIntensity
```

- Ramp has **3–4 bands** with soft transitions (~0.05–0.08 in `d` units), not hard cel steps.
- The ramp encodes the **color shift**: lit end warm/neutral, shadow end shifted toward the biome shadow color (never pure black).

### 3.3 Ambient

```
hemi    = mix(groundColor, skyColor, N.y * 0.5 + 0.5)
ambient = hemi * ambientIntensity * ao
```

### 3.4 Local lights (point/spot)

- Same wrapped Lambert, **no banding** (smooth falloff), so they read as painted light pools rather than hard rings.
- Attenuation: Three.js physical falloff with `distance` cutoff; `decay = 2`.
- Desktop: tiled lighting (16+ lights). Mobile: max 4 nearest dynamic lights; static lights baked into vertex color/lightmap.
- Every furnace/brazier light is paired with an additive **light-pool decal** on the ground (works even when the light is culled on mobile).

### 3.5 Stylized specular (metals only)

```
h      = normalize(L + V)
spec   = smoothstep(0.92, 0.96, dot(N, h))        // hard-edged, small highlight
spec  *= metalSheen * d                            // only on lit side
color += spec * keyColor * sheenColor
```

No PBR roughness/metalness and no environment maps in the environment. Optional brass **matcap** on vehicles at High/Ultra.

### 3.6 Final combine

```
light   = key + Σ local + ambient
lit     = albedo * light
lit     = applyHatching(lit, luminance(light))     // §4
lit    += spec + emissive
lit     = applyFog(lit, worldPos)                  // §8
```

Ramp rows (material classes) for the foundry biome:

| Row | Class | Notes |
|---|---|---|
| 0 | Default / stone / concrete | Neutral, shadow → purple-brown |
| 1 | Rusted iron | Lit warmer, shadow → deep red-brown |
| 2 | Brass / copper | High-contrast, warm |
| 3 | Wood | Soft |
| 4 | Vehicles (all) | Slightly brighter mid-band for readability |
| 5 | Characters / crowd | Simple 2-band |
| 6–7 | Reserved | |

---

## 4. Hatching

### 4.1 Approach

- **Tonal Art Map (TAM)**: one tileable **512² RGBA texture**, mipmapped.
  - R: light hatching (single direction, sparse)
  - G: medium hatching (same direction, denser)
  - B: cross-hatching (second direction, ~45° rotated)
  - A: stipple/scribble for very dark areas (optional)
- Mip levels must keep stroke **thickness** constant while reducing count: generate mips with the TAM method (strokes added per level), not a box filter.
- **Authoring (S3): procedural first.** A tool script (`tools/tam-generator`) draws the strokes procedurally: slightly varied length, angle jitter ±4°, thickness taper at both ends, opacity jitter. It also generates the paper fibre texture and line-wobble noise. Seeded, so outputs are reproducible. A hand-drawn artist workflow (scanned or tablet strokes fed into the same generator) will be defined after the look test.

### 4.2 Projection

Screen-space hatching "swims" when the camera moves, and our camera moves and rotates all the time (D2), so:

| Target | Projection |
|---|---|
| Static environment | **World-space triplanar**, scale ~**0.05 hatch tiles per metre** (one 512² TAM tile ≈ 20 m; calibrated in M1, see §18) |
| Vehicles & dynamic props | **Object-space triplanar** (strokes stick to the vehicle while it turns) |
| Particles, liquids, emissive surfaces | No hatching |

The scale is tuned so strokes are ~**2–3 px wide at 1080p** at the standard camera distance (80 m, ~25 px/m). The camera zoom range is small, so no screen-space correction is needed.

### 4.3 Tone → strokes

```
t   = 1 - saturate(luminance(light) / hatchRef)   // hatchRef ≈ 0.8
h1  = smoothstep(0.35, 0.50, t) * tam.r
h2  = smoothstep(0.55, 0.70, t) * tam.g
h3  = smoothstep(0.75, 0.90, t) * tam.b
h   = max(h1, max(h2, h3)) * hatchStrength * (1 - fogFactor)
color = mix(color, inkColor * color * 0.6, h)    // strokes are a darker version of the surface, not flat black
```

- Hatching reacts to **lighting only**, not albedo (dark textures don't get extra hatching).
- Fades with fog and on emissive pixels.
- Off on Low tier (shading falls back to ramp only).

---

## 5. Outlines (post-process)

### 5.1 Edge sources

| Edge type | Test | Default threshold |
|---|---|---|
| **Silhouette** | Linear depth difference, relative: `abs(d - dn) / d` | > 0.015 |
| **Crease** | View-normal difference: `dot(n, nn)` | < cos(35°) ≈ 0.82 |
| **Object boundary** | `meta.R` differs | any difference |

Kernel: Sobel 3×3 (desktop) or Roberts cross (mobile), sampled at an offset equal to the line half-width.

### 5.2 Line weights

| Line | Width @1080p | Strength |
|---|---|---|
| Silhouette (environment) | 2.0 px | 1.0 |
| Silhouette (vehicles, `meta.G = 1`) | 3.0 px | 1.0 |
| Crease | 1.2 px | 0.7 |
| Object boundary | 1.5 px | 0.9 |

- Width scales with `renderHeight / 1080`; minimum 1 px.
- Lines fade with fog (`× (1 - fogFactor)`) and thin out with distance (×0.6 at far plane).
- Transparents/particles do not write normal/meta, so they get no outlines (their ink outline is painted into the sprite).

### 5.3 Hand-drawn wobble (S2)

- Offset the edge sampling UVs with a tileable noise texture: amplitude **0.6 px**, noise scale ~1/64 px.
- The wobble is **static**: the noise is fixed in screen space and never re-seeded. **No "boiling lines"**: lines and hatching must never look redrawn frame by frame.
- Player option: **Off / Low**. Default **Low** (amplitude 0.6 px). Off = clean lines.

### 5.4 Composite

```
color = mix(color, inkColor, edge * lineStrength)
```

`inkColor` = biome ink (foundry: `#1B1210`), never pure black.

---

## 6. Painted texture guidelines (for artists)

| Rule | Value |
|---|---|
| Texel density, vehicles | ~**256 px/m** (4 m vehicle → 1024² atlas, Desktop 2048²) |
| Texel density, environment | ~**128 px/m** with trim sheets; hero props 192 px/m |
| Ink lines in texture | Rivets, plate seams, bolts, grates, panel edges. Color = biome ink, 1–2 texels wide at final density. |
| Lighting in albedo | Only baked AO and painted **edge wear** highlights. No directional light/shadow. |
| Value range (albedo) | Environment L* 15–55; track surface L* 30–45; vehicles L* 35–70 |
| Saturation | Low on base materials; high saturation reserved for racer identity elements (§13.1), emissive and signage. |
| Format | Author in sRGB PNG/PSD → ship as KTX2 (UASTC for vehicles/hero, ETC1S for environment). |
| Atlases | One atlas per vehicle; per biome: 2–4 trim sheets + 1 props atlas + 1 decal atlas. |

---

## 7. Emissive & bloom

### 7.1 Emissive animation presets (shader uniforms, per material)

| Preset | Function | Use |
|---|---|---|
| `fire` | 2-octave noise, 3–6 Hz, intensity 0.7–1.2 × base | Furnaces, braziers |
| `neon` | Steady + random dropouts (1–3% chance/s, 50–150 ms) | Signs |
| `rune` | `0.75 + 0.25·sin(t·1.5 + phase)` | Runes, vehicle glyphs |
| `lava` | Scrolling noise mask × slow pulse | Lava, molten metal |
| `steady` | Constant | Headlights, gauges |

Emissive intensity range: **2–8** (HDR). Anything above 1.0 after lighting blooms.

### 7.2 Bloom

| Param | Desktop | Mobile |
|---|---|---|
| Threshold | 1.0 | 1.0 |
| Strength | 0.6 | 0.5 |
| Radius | 0.4 | 0.35 |
| Mip levels | 5 | 3 |
| Resolution | ½ | ¼ |

---

## 8. Fog & atmosphere

- **Exponential height fog** in the material: `fog = 1 - exp(-density · dist · exp(-heightFalloff · (y - fogBase)))`.
  - Foundry: density 0.012, heightFalloff 0.15, fogBase 0, color `#3B3533`.
- **Ground mist**: a few large alpha planes near the track edges with scrolling noise (2 layers, opposite directions), no outline, depth-faded.
- **Floating embers**: GPU particles over the whole visible area, 200 (mobile) – 1500 (desktop).
- Outlines and hatching fade with the same fog factor so distant geometry looks "less inked".

---

## 9. Particles

| Effect | Rendering | Notes |
|---|---|---|
| **Steam** (white) | Alpha-blended billboards, 8×8 flipbook, ink outline painted in sprite | Lit with a fake spherical normal + ramp (lit side warm). Soft-particle fade 0.5 m. |
| **Exhaust smoke** (black) | Alpha-blended, darker flipbook | Emitted from vehicle smokestacks; rate tied to throttle. |
| **Dust** | Alpha-blended, low opacity | From wheels/tracks on dirt. |
| **Sparks** | Additive, velocity-stretched billboards, HDR 4–6 | Collisions, grinding. |
| **Muzzle flash / explosions** | Additive flipbook + short-lived point light | Light only on Medium+. |
| **Shell casings / debris** | Instanced meshes (InkLit, no hatching) | Pooled, scripted bounce. |

- All billboard textures share one **particle atlas** (2048², KTX2).
- Particles never write depth/normal/meta.
- Budget: 2k (mobile) / 20k (desktop) active particles; simulation via TSL compute on WebGPU, CPU fallback on WebGL2 with lower counts.

---

## 10. Liquids (water, lava, sludge)

- Flat mesh with **two-phase flowmap** scrolling over a painted surface texture.
- **Shoreline ink line**: where scene depth behind the surface is shallow (`< 0.15 m`), draw an ink line + foam band.
- Ripple rings: animated ring decals/sprite sheet at random positions.
- Lava/molten metal: emissive with `lava` preset, steam particles above, point light (baked on mobile).
- Water: fake reflection with a blurred, darkened sky/fog color gradient; no planar reflections (High/Ultra could add SSR later, P2).

---

## 11. Color grading & paper

Order: **tonemap → 3D LUT → vignette → paper → grain**.

| Step | Setting |
|---|---|
| Tonemapping | Start with Khronos PBR Neutral (least color shift, so the LUT controls the look); AgX compared during the look test. Exposure 1.0 |
| 3D LUT | 32³, one per biome. **Initial foundry LUT (S1): match the tones of `refs/engine` (1) and (4)**: grade an in-engine screenshot until it matches the refs side by side, export the LUT. Refined after play tests. |
| Vignette | Strength 0.35, smoothness 0.5, color `#0E0908` |
| Paper texture | Tileable 1024² paper fibre texture, screen-space, **multiply 8%**, fixed to the screen |
| Grain | Animated noise, 3%, 24 fps stepped |

---

## 12. Foundry biome palette (D6)

Derived from engine refs 1 and 4.

| Token | Hex | Use |
|---|---|---|
| `ink` | `#1B1210` | Outlines, hatching, texture lines |
| `shadow` | `#2B1F22` | Ramp shadow end |
| `iron-dark` | `#3A3330` | Walls, machines |
| `iron` | `#5A514B` | Plates, grates |
| `rust` | `#7A4A2E` | Rust patches, barriers |
| `rust-light` | `#A8663A` | Lit rust, edge wear |
| `brass` | `#B08A4A` | Pipes, gauges, trims |
| `dirt` | `#5C4A3A` | Dirt sections, grime |
| `steam` | `#D8D2C8` | Steam particles |
| `fog` | `#3B3533` | Fog, sky |
| `fire-core` | `#FFD27A` | Emissive core |
| `fire` | `#FF8A2A` | Emissive, light color |
| `ember` | `#C8401A` | Embers, coals |
| `neon-cyan` | `#3FE0FF` | Signs, runes (accent) |
| `neon-magenta` | `#FF3FB4` | Signs (accent) |

Key light: color `#C9B8A6`, intensity 1.2, pitch 55°, from the camera's back-left. Hemisphere: sky `#4A4440`, ground `#2A1E1A`, intensity 0.5.

---

## 13. Readability rules

1. **Value hierarchy**: walls/background darkest → track mid → vehicles brightest (plus heavier outline and rim).
2. **Hue reservation**: saturated **cyan/magenta** = signage and decoration; **orange** = fire/hazard; **racer identity colors** (§13.1) = vehicles only; pickups/weapons use a distinct, reserved color (to be defined in the gameplay doc).
3. Hazards (lava, spikes, mines) always have an emissive or high-contrast cue.
4. **Grayscale test**: the debug view in grayscale must still clearly show track edges, vehicles and hazards.
5. Smoke and fog never fully hide a racer: vehicles get a **silhouette-through-smoke** fallback (outline drawn on top when occluded by particles, opacity 40%).

### 13.1 Racer identity (S4)

Vehicles are **not** recolored as a whole: the body keeps its painted, faction-appropriate materials. Each racer is recognised through a small set of **identity elements**:

| Element | Implementation |
|---|---|
| **Banners / standards / flags** | Cloth meshes on poles (vertex-shader wave, speed-driven). Texture from a shared **emblem atlas** (e.g. 4×4 emblems, 256² each) × racer identity color. |
| **Runes / glyphs** | Emissive mask areas on the vehicle atlas, color = racer identity color, `rune` animation preset. Brightest and most readable element at gameplay distance. |
| **Pennants / ribbons** (optional) | Small cloth strips on antennas/stacks, same identity color. |

- Per-racer parameters: `identityColor`, `emblemIndex`, `runeIntensity`. Passed as material uniforms (or instance attributes when vehicles share a material).
- 8 racers (D5) → a palette of **8 identity colors** distinct in hue and readable in the grayscale test, avoiding the reserved fire-orange. Defined in the look test.
- The same color + emblem appear in the HUD leaderboard and minimap dots, so player and opponents are matched instantly.
- The player's vehicle additionally gets a subtle ground marker (ring decal) on Low tier and in heavy smoke.

---

## 14. Quality tiers

| Feature | Low | Medium | High | Ultra |
|---|---|---|---|---|
| Render scale | 0.6 | 0.75 | 1.0 | 1.0 (up to 1440p+) |
| Shadows | Blob | 1024² | 2048² | 4096² |
| Hatching | Off | Env + vehicles | Full | Full |
| Outline kernel | Roberts, depth+normal | Sobel, + ID | Sobel, + ID | Sobel, + ID |
| Line wobble (static, player option Off/Low) | Off | Low | Low | Low |
| Bloom | ¼ res, 3 mips | ¼ res, 4 mips | ½ res, 5 mips | ½ res, 5 mips |
| Dynamic lights | 2 | 4 | 16 (tiled) | 32+ (tiled) |
| Particles | 2k | 5k | 15k | 20k+ |
| Ground mist / embers | Reduced | On | On | On |
| Vehicle normal map / matcap | Off | Off | On | On |
| AA | FXAA | FXAA | SMAA | SMAA |
| Paper + grain | On | On | On | On |

D4 target (mid-range 2021 phone): **Medium at 30 fps**, Low as safety net.

---

## 15. Debug views

Toggle from the debug panel: `albedo`, `lighting only`, `ramp d`, `hatch tone`, `normals`, `linear depth`, `edges`, `object ID`, `emissive`, `fog factor`, `grayscale final`, `overdraw (particles)`.

---

## 16. Look-test acceptance criteria

The look test (one foundry track section, 2 placeholder vehicles, steam, fire, neon sign) is accepted when:

1. A side-by-side with `refs/engine/engine (1).jpg` and `engine (4).jpg` reads as the same style (outlines, hatching, palette, atmosphere).
2. The grayscale test (§13.4) passes.
3. Desktop (mid GPU) ≥ 60 fps at High, 1080p.
4. Mid-range 2021 phone ≥ 30 fps stable at Medium.
5. All parameters in this document are exposed in the debug panel.

---

## 17. Open points

| ID | Question | Status |
|---|---|---|
| S1 | Tonemapping and grading tones | ✅ **Decided (2026-11-12):** start from the tones of the `refs/engine` screenshots (§11), refine after tests. |
| S2 | Line/hatch animation ("boiling") | ✅ **Decided (2026-11-12):** no redrawn-look animation. Static wobble only, player option Off/Low (§5.3). |
| S3 | TAM strokes and paper texture authoring | ✅ **Decided (2026-11-12):** procedural first (§4.1); artist workflow defined later. |
| S4 | Racer recognition | ✅ **Decided (2026-11-12):** identity through banners, standards and runes, not full-body team colors (§13.1). |
| S5 | Final 8 identity colors and emblem set | Open — define in the look test. |
| S6 | Artist workflow for hand-drawn strokes/paper | Open — after the look test. |

---

## 18. M1 implementation notes (2026-11-13)

Where the look-test implementation differs from or refines this spec. Source: `src/render/`.

| Topic | Implementation | Follow-up |
|---|---|---|
| Ramp | Procedural soft bands (`ink.bands`, `ink.bandSoftness`) + color shift `ink.shadowColor → ink.litTint` instead of a ramp texture | Ramp texture per material class (§3.6) if artists need per-class control |
| Hatching tone | `tone = 1 − (lum(lit − emissive) / lum(albedo)) / hatchRef`; albedo clamp 0.002 so painted ink lines do not leak into the tone | — |
| Hatching scale | `ink.hatchScale` 0.05 tiles/m, strokes 3 texels wide, 0.07-tile long; thresholds 0.30 / 0.50 / 0.70; strength 0.85 | Tune per biome with the debug panel |
| TAM mipmaps | GPU-generated (box filter), not stroke-preserving TAM mips | Build TAM mips offline in `tools/tam-generator` |
| TAM texture | `DataTexture` (a Canvas texture premultiplies RGB by A and erases levels 1–3) | — |
| Painted textures | Generated on canvas at boot (plates 3×3 per tile, rivets r=10 px at 1024², seams 9 px), sized for the 80 m camera | Replace with artist trim sheets / KTX2 |
| Outlines | 8-tap cross + diagonal kernel on depth / view normals / meta ID; static wobble from a 256² noise tile | Roberts kernel on Low tier |
| MRT blending | Scene pass sets `MaterialBlending` on `normal` and `meta`: opaque materials overwrite, particles write alpha 0 and keep the destination. Per-material MRT blend modes are ignored by the renderer | — |
| Grading | Parametric grade (saturation, contrast, lift, gain) stands in for the 3D LUT | S1: export a LUT matched to `refs/engine` (1)/(4) and load it with `lut3D` |
| Fog | `scene.fogNode` exponential height fog with a start distance (`fog.start` 70 m) | — |
| Particles | CPU-simulated instanced sprites, back-to-front sorted, procedural ink-rimmed puff | Soft particles (depth fade), GPU compute path on WebGPU |
| Light pools | Additive ground discs under furnace lights | Bake static lights for mobile |
| Shadows | One directional shadow map following the view focus; Low tier = no shadow map | Blob shadows on Low |
| Split screen | Direct render per viewport, no post chain | Per-viewport pipeline in M3 (doc 03 §10.4) |
| Shader warm-up | `renderer.compileAsync` before the first frame | — |

Camera for the look test: 58 m at FOV 30° (doc 03 §9); hatch scale was calibrated at 80 m and still reads at 58 m.

Calibrated defaults (all editable in `?debug`): key light 4.5, ambient 3.0, furnace lights 600 / 24 m, exposure 1.25, saturation 0.9, contrast 1.08, vignette 0.3, paper 8%, grain 3%, vehicles' albedo ×1.6 (value hierarchy §13).

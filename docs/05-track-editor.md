# 05 — Track editor (milestone M5)

The block-based level editor announced in doc 03 §7.3 (A3). A separate page of the game, `/mapeditor/`, where tracks are built by placing tiles freely on the grid, checked live against the compiler and the Cup rules, saved as the same JSON the game reads, test-driven in a new tab, previewed in 3D and printed as tabletop tiles.

## 1. Decisions (owner, 2026-11-14)

| # | Topic | Decision |
|---|---|---|
| E-A | Editing model | **Free placement**: tiles are placed anywhere on the grid with a rotation; the editor walks from the start tile through the connected sockets and derives the piece chain of the track format (doc 03 §7.1.1). |
| E-B | Page | `/mapeditor/` (Vite multi-page entry `mapeditor/index.html`), PC only (mouse + keyboard). |
| E-C | Files | Save / load as JSON in the `TrackFile` format; the standard tracks of `src/tracks` can be loaded; the last edited track is kept in `localStorage` (one slot; other tracks are loaded from file). |
| E-D | Test drive | "Play" opens the game in a **new tab** (`/?custom`) with defaults: 1 player, 3 AI rivals, Normal difficulty. |
| E-E | World | The world (biome) of the track is chosen in the editor; it drives the 3D preview, the tileset render and the dressing in game. |
| E-F | 3D preview | In scope: a 3D view of the real world (same builder as the game) beside the grid. |
| E-G | Tabletop tiles | "Show tileset": **rendered** top-down images (the game's ink look), one **16 × 16 cm module tile per grid cell** (§2). Multi-cell pieces (big curves, long straights) are **split into module tiles**, labelled with the piece number and the part. |
| E-H | Cup and build | E5: a dev-only way to save editor tracks into `src/tracks` and choose which tracks make up each Grand Prix. |
| E-I | Tabletop grid | **Squares** (decided 2026-11-14, see §2): one vehicle per square, 8 × 8 squares per grid cell, 6 road squares + 1 edge square per side, 2 cm per printed square, 2.5 m per square in 3D. |

## 2. Tabletop grid (`src/track/units.ts`)

| Quantity | Squares | 3D | Printed |
|---|---|---|---|
| Square (one vehicle) | 1 | 2.5 m | 2 cm |
| Road width (6 columns) | 6 | 15 m | 12 cm |
| Edge band per side (barricade type) | 1 | 2.5 m | 2 cm |
| Grid cell = module tile | 8 × 8 | 20 m | 16 × 16 cm |

Scale **1:125**.

**Vehicle size (decided 2026-11-16):** the vehicles are drawn and simulated at **half size** (`VEHICLE_SCALE` = 0.5 in `units.ts`; `?vscale=0.25..1.5` overrides it, `?vscale=1` = the original size). A hot rod is then 1 × 2.5 m, i.e. **one square**, and the track feels twice as big. `scaleSpec` (`vehicle-physics.ts`) scales the collider, wheels and suspension geometry; mass, engine, gear speeds and top speed are unchanged, and the vehicles follow the same paths in metres as before:

- inertia follows the size (∝ k²) and the steering angle is reduced so the turning radius stays the same (tan a′ = k · tan a), so the yaw response and the AI lines do not change;
- the suspension is stiffer (stiffness / k, damping / √k) so sag and travel shrink with the car (with the old stiffness the half-size chassis hit the start of the kickers);
- the models, their smoke / dust / damage effects and the camera distances and look-ahead are multiplied by the same factor (the camera tunables are the full-size values).

Why a square 8 × 8 module rather than a 6 × 8 straight: tiles must rotate and a loop closed in the editor must close on the table, so every tile is the same square module; with 6 road squares filling the whole cell a size-1 curve would have a zero inner radius. With the module, a size-1 curve has the road between 1 and 7 squares from its corner and the edge bands on 0–1 and 7–8.

Rules derived from the grid (the compiler and the Cup report enforce / check them):

- Every track uses `cell` 20 and `width` 15 (`tabletopProblems` in `track/rules.ts` reports anything else).
- **Crates** sit on a column centre: `lane` = −1, −0.6, −0.2, 0.2, 0.6, 1 (columns 1–6 from the left); lateral offset = lane × (half width − half a square). The inspector edits columns, not lanes.
- **Hazards** cover whole columns (`lanes` bounds are multiples of 1/3 of the half width) and whole squares in length (presets: vent 5 m, crossing 10 m, crane 7.5 m, stream 30 m).
- **Start grid**: columns 2 and 5 (±0.5 × half width), rows 12.5 m (5 squares) apart, left column 7.5 m (3 squares) back.
- `?grid` in the game draws the squares on the road (column lines along the road, cross lines every 2.5 m: radial on curves).

The standard tracks were migrated on 2026-11-14 (width 14 → 15, crate lanes snapped to the nearest column).

## 3. Phases

| Phase | Content | Status |
|---|---|---|
| **E1** | Page, tile layout model, 2D grid editor, inspector, live validation and stats, save / load / standard tracks / autosave, world selector, undo / redo | ✅ |
| **E2** | Play button → new tab, `?custom` boot in the game | ✅ |
| **E3** | 3D preview panel (world builder + orbit camera, rebuilt on change) | ✅ |
| **E4** | Tileset view: orthographic render per module, Grid / Lanes squares, print sheets with cut marks, layout sheet | ✅ |
| **G1** | Tabletop grid: units, width 15, crate columns, hazard columns / squares, start grid, editor squares and edge bands, `?grid` | ✅ |
| **G2** | Half-size vehicles (`VEHICLE_SCALE`, `?vscale`) | ✅ |
| **E5** | Dev-only "save to project" + Cup configuration file (`src/cup/cups.json`) | ✅ |

## 4. Tile layout model (`src/editor/layout.ts`)

Pure data, no DOM, runs in Node (unit tested).

- **Grid**: integer cells `(x, z)`, the same cells the compiler uses (`compile.ts` `pieceCells`: cell = `floor(X / cell)`). Directions `0..3` = headings `0, π/2, π, 3π/2` (0 = +Z, 1 = +X). The driver's right of `d` is `d − 1`.
- **Tile** = `{ id, x, z, dir, piece }`: the piece is entered from the edge of cell `(x, z)` heading `dir`. Footprint: straights / start / jumps cover `size` cells forward; a curve of size n covers the n × n block towards its turn side.
- **Sockets**: a tile is entered at its entry socket and leaves through its exit socket (`exitSocket`: next cell + heading). A tile can also be **traversed backwards**: then the chain gets the mirrored piece (curve turn flipped, `rise` negated, left/right barricades swapped, `at` → 1 − `at`, lanes negated, landmark side flipped).
- **Chain walk** (`walkChain`): from the start tile, follow the exit socket to the tile occupying the next cell; it must accept the socket forwards or backwards, otherwise the track is broken there. The walk ends when it comes back to the start entry (closed), reaches an empty cell (open end, shown on the grid as the next placement target) or fails. Tiles not reached are "unconnected" and ignored by the track.
- **Normalisation**: after every edit, tiles traversed backwards are rewritten in their forward form (`reverseTile`), so arrows and left/right in the inspector always follow the direction of travel. Jumps are directional: a jump reached backwards is an error ("Reverse" flips it explicitly).
- **Validation** (`validateDoc`): structural problems of the walk (no / several starts, broken connection, overlap) → then `compileTrack` (closure in height, slopes, jump gaps, pickups, hazards) → then `checkTrack` (Cup rules, warnings only). Compiler errors name a piece index; the editor maps it back to the tile and highlights it.
- **Height** is not stored per tile: levels come from the `rise` of the pieces along the chain (as in the track format). The grid shows the level of each tile.
- **Overpasses** (the road crossing over itself) are still out of scope: one tile per cell.

## 5. File format

Saved files are ordinary `TrackFile`s (doc 03 §7.1.1): `pieces` is the walked chain, so a saved file can go straight into `src/tracks`. The editor adds an optional `editor` field the game ignores:

```json
{ "id": "…", "name": "…", "biome": "orc", "cell": 20, "width": 15, "laps": 3, "level": 4,
  "defaultSurface": "sand", "defaultBarricade": "tyres",
  "pieces": [ … ],
  "editor": { "version": 1, "tiles": [ { "x": 0, "z": 0, "dir": 0, "piece": { "type": "start", "size": 3 } }, … ] } }
```

Loading: with `editor.tiles` the layout is restored as saved (unconnected tiles and open tracks included); without it (standard tracks, hand-written files) the tiles are laid out from the chain starting at cell (0, 0) heading north, exactly where the compiler puts them.

Storage keys: `steamRacers.editor.doc` (autosave of the last track), `steamRacers.customTrack` (the track handed to the game by Play).

## 6. Editor page (E1)

| Area | Content |
|---|---|
| Top bar | New, Open file…, Standard track (list of `src/tracks`), Save JSON, **Save to project** (dev only, §10), **Cup…** (§10), Undo / Redo, **Play**, **3D preview** (`P`), **Show tileset** (§9) |
| Palette (left) | Start, straight, ramp (straight with rise), crest, curve 1 / 2 / 3, jump 2 / 3 |
| 3D preview (centre right, when open) | §8 |
| Grid (centre) | Top view (north up, the driver's right on the right): road coloured by surface, edge bands one square wide coloured by barricade type, squares and column lines when zoomed in, travel arrows, jump gaps, crates, hazards, landmark footprints, level per tile; the open end and the ghost of the tile being placed (green = free, red = blocked) |
| Inspector (right) | Selected tile: size, turn, surface, barricades, rise, crest, zone, crates, hazards, landmark, raw JSON. Crates and hazards are placed by column. Nothing selected: track settings (name, id, world, laps, width (fixed at 15 m, a button fixes older files), level height, default surface / barricade). Always: validation and the Cup report |

Controls: left click places the current piece or selects a tile; drag a selected tile to move it; right / middle drag or drag on empty ground pans; wheel zooms. `R` rotates (piece being placed or selected tile), `F` flips a curve, `V` reverses the selected tile, `Enter` appends the current piece at the open end, `Del` deletes, `Esc` back to select, `Ctrl+Z` / `Ctrl+Y` undo / redo, `P` 3D preview, `1`–`9` palette.

Hovering the open end cell orients the ghost to the open end automatically.

Zone and landmark names are suggested per world from the zones and landmarks the standard tracks of that world use (the biome's `decorate` / `landmark` code is what gives them meaning).

## 7. Play (E2)

Play is enabled when the track compiles. It writes the track to `steamRacers.customTrack` and opens `/?custom` in a named tab (`steam-racers-play`, reused by the next Play). In the game, `?custom` (`flags.custom`) makes `Flow.boot` start a single race on that track: player 1 + 3 AI, Normal, random grid. Results offer Again / Title as usual. Without a stored track the game falls back to the title screen.

## 8. 3D preview (E3)

The **3D preview** button (or `P`) splits the centre area: grid on the left, 3D view on the right.

- **Same scene as the game**: a second `WebGPURenderer` (WebGL2 fallback) with the game's ink pipeline, `buildWorld` (`world/build.ts`) on the compiled track and its world, the crate and hazard views (`game/feature-views.ts`, fed by a preview clock instead of `RaceSim`: hazards cycle through idle / warning / active) and the world's particle emitters. No vehicles, no physics.
- **Rebuilt** 350 ms after the last change whenever the compiled track, its world or the seed change (renaming does not rebuild). A track that does not compile leaves the last build on screen. The camera stays put; loading another track frames it.
- **Camera**: drag to orbit, right-drag (or Shift-drag) to pan, wheel to zoom. Buttons: **Orbit** (whole track, 3/4 view), **Board** (the race camera's azimuth and pitch, `camera.board.*`), **Top** (straight from above, oriented like the grid). Selecting a tile in the grid centres the 3D view on that piece.
- **Squares** draws the tabletop squares on the road (the `?grid` overlay, §2). **Hazards ▶** runs or stops the hazard cycle.
- **Seed** of the dressing (the props around the track, doc 03 §7.3), editable, 🎲 rerolls. It belongs to the preview only: the game picks its own seed per race.
- Fog starts as in a race around the view target and is pushed out with the zoom, so the whole track stays readable from far away; the sun's shadow box grows with the zoom too.
- `src/editor/preview3d.ts` (renderer, scene, orbit camera) is loaded on first open (its own chunk); `src/editor/Preview.tsx` is the panel. Closing the panel frees the renderer and the scene.

## 9. Tileset (E4)

**Show tileset** opens a full-screen view of the printable tiles of the current track (it needs a track that compiles; the 3D preview closes, the two share the ink uniforms). `Esc` or ✕ goes back.

- **Modules** (`moduleTiles` in `src/editor/tileset.ts`, pure, unit tested): one module tile (16 × 16 cm = 8 × 8 squares) per grid cell of each piece, numbered in race order: `#7` for a one-cell piece, `#7 · 2/3` for the cells of a longer one in travel order. A cell is printed when the road or its edge bands touch it (the compiler's `cellPiece` tells which piece owns each cell): straights and curves 1–2 print every cell, a curve 3 prints 8 of its 9 (not the inner corner).
- **Render** (`src/editor/tileset-render.ts`, loaded on demand): a separate offscreen `WebGPURenderer` with the game's ink pipeline and `buildWorld` (no rain, no particles, hazards idle), an **orthographic camera** straight from above (the pipeline reads linear depth for orthographic cameras), north up and the driver's right of a northbound piece on the right, as in the grid. No fog, vignette or grain (seams must match); line weight scaled to metres as in a race view. Each module: 166 mm with the 3 mm bleed at **300 dpi = 1961 px**, read back from a render target, then the board markings drawn in 2D, saved as JPEG. The dressing uses the 3D preview seed. About 1 s per module on a desktop GPU.
- **Markings**: squares (double stroke, dark with a light core), lane borders along the road, edge bands with their barricade type (tag in the barricade colour), travel arrow, hazard letters (V, X, C, S), piece number (top left) and level (`L+1`, top right, when not 0).
- **Squares on curves** (toolbar, playtest option):
  - **Grid** (current board game rules): the module's 8 × 8 square grid, clipped to the road and edge bands, everywhere, curves included; a vehicle stands on whatever square it covers.
  - **Lanes**: the 6 columns and the 2 edge bands become concentric lanes, each split into spaces about one square long along its own arc (inner lanes of a curve have fewer spaces); on straights this is the same as the grid.
- **Print** (browser print → PDF, at 100 % scale, no "fit to page"): a **layout sheet** first (the whole track from above with the module outlines and numbers, `7·2` = piece 7, cell 2), then the modules with cut marks at the 16 cm trim and a caption: **A4 × 1** (portrait, one module per page) or **A3 × 2** (landscape, two per page). The page size is set with `@page`.
- `?tilepx=200` renders small tiles (quick checks of the sheets; the printed size stays 16 cm). `node tools/print/tileset-pdf.mjs out.pdf [a4|a3] [track-id]` saves the PDF of a standard track from the dev server (headless Chromium).

## 10. Cup and build (E5)

**Tracks are files.** `src/tracks/index.ts` loads every `src/tracks/*.json` with `import.meta.glob`, keyed by file name (the default track first, then by name): adding a track is adding a file. The headless tools read the files directly, as before.

**Save to project** (top bar, **dev server only**): writes the current track as `src/tracks/<id>.json` (the id field of the track settings: lower-case letters, digits, dashes). Only a raceable track is saved, without the `editor` layout (its chain is the compiler's own layout); an existing file asks before being overwritten. The page then reloads to pick up the new track list (the autosave is written first; the confirmation stays on screen).

**The Cup is data**: `src/cup/cups.json` = `{ name, rounds: [{ trackId, track, world, hazard, blurb }] }`, in race order; `src/cup/cup.ts` exports it as `CUP_CONFIG` / `CUP_NAME` / `CUP_ROUNDS`. The briefing shows `world`, `track`, `hazard` and `blurb`. The game's menus offer one Cup.

**Cup…** (top bar) edits it: Cup name; per race the track (any file of `src/tracks`), the world name (suggested from the other races of the same biome, else the editor's world label), the hazard and the description lines; reorder (↑ ↓), remove, **+ Add race** (the track being edited if it is in the project). Tracks that break the Cup rules (doc 04 §4) show the problems under their race. **Save to project** writes `src/cup/cups.json` (track names copied from the track files) and reloads; outside the dev server the button downloads `cups.json` instead.

**Dev server endpoint** (`tools/vite/editor-save.ts`, a Vite plugin applied only to `vite serve`, never in a build): `POST /__editor/save` with `{ "kind": "track", "file": … }` or `{ "kind": "cups", "cups": … }`. It accepts only JSON from the dev server's own pages (another origin → 403), checks the id (no paths), and writes the files in the layout of the hand-written tracks (`src/editor/format.ts`: one key per line, one piece / tile / race per line), so saving a standard track gives a clean diff.

A saved Cup in progress (`steamRacers.cup.v1`) keeps its round number: changing the Cup between two sessions changes the races still to run.

## 11. Tests

- `tests/unit/editor-layout.test.ts`: chain → tiles → chain round trip for every standard track (pieces identical, compiled cells identical), backward traversal and normalisation, broken / open / unconnected cases, compiler error mapping.
- `tests/e2e/editor.spec.ts`: `/mapeditor/` loads without errors, a standard track loads and validates, Play stores the track, the 3D preview builds the world, rebuilds on a world change and frees its canvas when closed, the tileset lists the modules and renders two of them (small, software WebGL in CI).
- `tests/unit/format.test.ts`: re-formatting every track file reproduces it. `tests/unit/editor-save.test.ts`: the endpoint writes tracks and the Cup in a temporary project, refuses bad ids and kinds; every Cup race names a track of the project.
- `tests/e2e/editor.spec.ts` (E5): the Cup panel lists the 4 races; the endpoint refuses another origin and a bad id (nothing written).
- `tests/unit/tileset.test.ts`: modules per piece (curve 3 → 8, labels), standard tracks (one module per printed cell, inside the footprint, race order), Lanes / Grid square lines.

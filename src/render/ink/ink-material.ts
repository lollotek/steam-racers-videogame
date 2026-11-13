/**
 * `InkLit` material (doc 02 §3–§4): soft-banded light ramp with a shadow color shift,
 * stylized metal sheen, hatching driven by the lighting term, animated emissive presets.
 * Implemented as a custom LightingModel so Three.js lights and shadows keep working.
 */
import { Color, LightingModel, NodeMaterial, type ColorRepresentation, type Texture } from 'three/webgpu';
import {
  BRDF_Lambert,
  abs,
  cameraPosition,
  diffuseColor,
  dot,
  exp,
  float,
  fog,
  fract,
  floor,
  hash,
  luminance,
  max,
  mix,
  mrt,
  normalLocal,
  normalView,
  normalWorld,
  normalize,
  positionLocal,
  positionViewDirection,
  positionWorld,
  select,
  sin,
  smoothstep,
  texture,
  time,
  triplanarTexture,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import { U, tamNode } from './ink-uniforms';

// TSL typings are very loose at this level; keep a local alias for node values.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export type EmissivePreset = 'steady' | 'fire' | 'neon' | 'rune' | 'lava';
export type Mapping = 'uv' | 'world' | 'object';

export interface InkParams {
  color?: ColorRepresentation;
  map?: Texture | null;
  /** How `map` is projected: mesh UVs, world triplanar (static env), object triplanar (vehicles). */
  mapping?: Mapping;
  /** Texture repeats per metre for triplanar mappings, or UV multiplier. */
  mapScale?: number;
  /** 0..1 stylized highlight for brass/copper/polished steel (doc 02 §3.5). */
  sheen?: number;
  hatch?: boolean;
  /** Hatching projection: world (static) or object (moving objects). */
  hatchSpace?: 'world' | 'object';
  /** 0 = no outline, 0.5 default, 1 = heavy (vehicles). Written to meta.G. */
  lineWeight?: number;
  emissive?: ColorRepresentation;
  emissiveMap?: Texture | null;
  emissiveIntensity?: number;
  emissivePreset?: EmissivePreset;
  /** Random phase so identical emitters do not pulse in sync. */
  phase?: number;
  flags?: number;
}

let nextId = 1;

/** Soft quantisation into `bands` steps with smooth transitions. */
const softBands = (d: N, bands: N, softness: N): N => {
  const x = d.mul(bands);
  const k = softness.mul(bands).mul(0.5).max(0.001);
  const t = smoothstep(float(0.5).sub(k), float(0.5).add(k), fract(x));
  return floor(x).add(t).div(bands).min(1);
};

class InkLightingModel extends LightingModel {
  constructor(private sheen: N) {
    super();
  }

  direct(data: N): void {
    const { lightDirection, lightColor, reflectedLight, lightNode } = data;
    const ndl = dot(normalView, lightDirection);
    const d = ndl.add(U.wrap).div(U.wrap.add(1)).saturate();
    const isKey = !!lightNode?.light?.isDirectionalLight;
    let irradiance: N;
    if (isKey) {
      const b = softBands(d, U.bands, U.bandSoftness);
      irradiance = mix(U.shadowColor, U.litTint, b).mul(b).mul(lightColor);
      // Stylized sheen: small hard-edged highlight on the lit side only.
      const h = normalize(lightDirection.add(positionViewDirection));
      const spec = smoothstep(U.specThreshold, U.specThreshold.add(0.03), dot(normalView, h)).mul(this.sheen).mul(b);
      reflectedLight.directSpecular.addAssign(spec.mul(lightColor).mul(0.35));
    } else {
      // Local lights: smooth falloff → painted light pools (doc 02 §3.4).
      irradiance = d.mul(lightColor);
    }
    reflectedLight.directDiffuse.addAssign(irradiance.mul(BRDF_Lambert({ diffuseColor: diffuseColor.rgb })));
  }

  indirect(builder: N): void {
    const { ambientOcclusion, irradiance, reflectedLight } = builder.context;
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul(BRDF_Lambert({ diffuseColor })));
    reflectedLight.indirectDiffuse.mulAssign(ambientOcclusion);
  }
}

function emissiveAnim(preset: EmissivePreset, phase: N): N {
  switch (preset) {
    case 'fire':
      return float(0.9).add(sin(time.mul(17).add(phase)).mul(sin(time.mul(7.3).add(phase.mul(2)))).mul(0.25));
    case 'neon': {
      // Steady with rare short dropouts (doc 02 §7.1).
      const slot = floor(time.mul(9)).add(phase.mul(97));
      return select(hash(slot).greaterThan(0.985), float(0.15), float(1));
    }
    case 'rune':
      return float(0.75).add(sin(time.mul(1.5).add(phase)).mul(0.25));
    case 'lava':
      return float(0.8).add(sin(time.mul(0.8).add(positionWorld.x.mul(0.3)).add(phase)).mul(0.2));
    default:
      return float(1);
  }
}

/** Triplanar sample with a blend sharpness of ~4 (cleaner than the default for hatching). */
function triplanar(tex: N, scale: N, pos: N, nrm: N): N {
  const w: N = abs(nrm).pow(4);
  const ws = w.div(w.x.add(w.y).add(w.z));
  const p = pos.mul(scale);
  return tex
    .sample(p.zy)
    .mul(ws.x)
    .add(tex.sample(p.xz).mul(ws.y))
    .add(tex.sample(p.xy).mul(ws.z));
}

export class InkLitMaterial extends NodeMaterial {
  readonly inkId: number;
  readonly params: InkParams;
  private sheenU: N;
  /** Emissive contribution (kept to separate it from lighting in setupOutput). */
  private emissiveValue: N = null;

  constructor(p: InkParams = {}) {
    super();
    this.params = p;
    this.lights = true;
    this.inkId = nextId++;
    this.sheenU = uniform(p.sheen ?? 0);

    const base: N = uniform(new Color(p.color ?? '#ffffff')) as N;
    const scale = float(p.mapScale ?? 1);
    let albedo: N = base;
    if (p.map) {
      const mapping = p.mapping ?? 'uv';
      const tex = texture(p.map);
      if (mapping === 'uv') albedo = tex.sample(uv().mul(scale)).rgb.mul(base);
      else if (mapping === 'world') albedo = triplanarTexture(tex, null, null, scale, positionWorld, normalWorld).rgb.mul(base);
      else albedo = triplanarTexture(tex, null, null, scale, positionLocal, normalLocal).rgb.mul(base);
    }
    this.colorNode = vec4(albedo, 1);

    if (p.emissive !== undefined || p.emissiveMap) {
      const e: N = uniform(new Color(p.emissive ?? '#ffffff')) as N;
      const mask: N = p.emissiveMap ? texture(p.emissiveMap).rgb : vec3(1);
      const anim = emissiveAnim(p.emissivePreset ?? 'steady', float(p.phase ?? 0));
      this.emissiveValue = e.mul(mask).mul(p.emissiveIntensity ?? 2).mul(anim);
      (this as N).emissiveNode = this.emissiveValue;
    }

    // Per-material meta for the outline pass (doc 02 §2.1): R id, G line weight, A flags.
    const idHash = ((this.inkId * 0.618034) % 1) * 0.98 + 0.01;
    this.mrtNode = mrt({ meta: vec4(idHash, p.lineWeight ?? 0.5, 0, (p.flags ?? 0) / 255) });
  }

  setupLightingModel(): LightingModel {
    return new InkLightingModel(this.sheenU);
  }

  setupOutput(builder: N, outputNode: N): N {
    const p = this.params;
    const lit: N = outputNode.rgb;
    const emissiveV: N = this.emissiveValue ?? vec3(0);
    const lightOnly = lit.sub(emissiveV).max(0);
    const albedoLum = max(luminance(diffuseColor.rgb), 0.002);
    // Lighting-only intensity, independent from the texture brightness (doc 02 §4.3).
    const lightLum = luminance(lightOnly).div(albedoLum);
    const tone = float(1).sub(lightLum.div(U.hatchRef).saturate());

    let color: N = lit;
    if (p.hatch !== false) {
      const space = p.hatchSpace ?? 'world';
      const pos = space === 'world' ? positionWorld : positionLocal;
      const nrm = space === 'world' ? normalWorld : normalLocal;
      const tam = triplanar(tamNode(), U.hatchScale, pos, nrm);
      const h1 = smoothstep(U.hatch1, U.hatch1.add(0.15), tone).mul(tam.r);
      const h2 = smoothstep(U.hatch2, U.hatch2.add(0.15), tone).mul(tam.g);
      const h3 = smoothstep(U.hatch3, U.hatch3.add(0.15), tone).mul(tam.b);
      const emissiveFade = float(1).sub(luminance(emissiveV).saturate());
      const h = max(h1, max(h2, h3)).mul(U.hatchStrength).mul(U.hatchOn).mul(emissiveFade);
      // Strokes are a darker, ink-tinted version of the surface (never flat black).
      const strokeColor = mix(lit.mul(0.3), U.inkColor, 0.5);
      color = mix(lit, strokeColor, h);
    }

    // Material debug views (doc 02 §15).
    color = select(U.inkDebug.equal(1), diffuseColor.rgb, color);
    color = select(U.inkDebug.equal(2), vec3(lightLum.mul(0.25)), color);
    color = select(U.inkDebug.equal(3), vec3(tone), color);

    return super.setupOutput(builder, vec4(color, outputNode.a));
  }
}

/** Exponential height fog (doc 02 §8), shared by every material through `scene.fogNode`. */
export function heightFogNode(): N {
  const toCam = positionWorld.sub(cameraPosition);
  const dist = toCam.length().sub(U.fogStart).max(0);
  const heightTerm = exp(U.fogHeightFalloff.negate().mul(positionWorld.y.max(0)));
  const factor = float(1).sub(exp(U.fogDensity.negate().mul(dist).mul(heightTerm))).saturate();
  return fog(U.fogColor, factor);
}

/** Same fog factor computed from view distance only (used by the outline pass, doc 02 §5.2). */
export function fogFactorFromDistance(dist: N): N {
  return float(1).sub(exp(U.fogDensity.negate().mul(dist.sub(U.fogStart).max(0)))).saturate();
}

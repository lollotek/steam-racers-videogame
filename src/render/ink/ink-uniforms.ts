/**
 * Global ink-style uniforms, bound to tunables (doc 02 §3–§5, §8, §11).
 * Shader nodes read these uniforms; the debug panel edits the tunables; a listener syncs them.
 */
import { Color, Vector2, type Texture } from 'three/webgpu';
import { uniform, texture } from 'three/tsl';
import { tunables, type TunableDef } from '../../core/tunables';

type Def = TunableDef extends infer D ? (D extends unknown ? Omit<D, 'group'> : never) : never;

const INK_DEFS: Def[] = [
  { key: 'ink.color', type: 'color', default: '#1B1210', label: 'Ink color' },
  { key: 'ink.shadowColor', type: 'color', default: '#2B1F22', label: 'Ramp shadow color' },
  { key: 'ink.litTint', type: 'color', default: '#FFF0DC', label: 'Ramp lit tint' },
  { key: 'ink.wrap', type: 'number', default: 0.35, min: 0, max: 1, step: 0.01, label: 'Light wrap' },
  { key: 'ink.bands', type: 'number', default: 3, min: 1, max: 8, step: 1, label: 'Light bands' },
  { key: 'ink.bandSoftness', type: 'number', default: 0.06, min: 0.005, max: 0.3, step: 0.005, label: 'Band softness' },
  { key: 'ink.specThreshold', type: 'number', default: 0.93, min: 0.5, max: 0.999, step: 0.001, label: 'Metal sheen threshold' },
  { key: 'ink.hatchEnabled', type: 'boolean', default: true, label: 'Hatching' },
  { key: 'ink.hatchStrength', type: 'number', default: 0.85, min: 0, max: 1, step: 0.01, label: 'Hatch strength' },
  { key: 'ink.hatchRef', type: 'number', default: 1.2, min: 0.05, max: 10, step: 0.05, label: 'Hatch light reference' },
  { key: 'ink.hatchScale', type: 'number', default: 0.05, min: 0.005, max: 1, step: 0.005, unit: 'tiles/m', label: 'Hatch scale' },
  { key: 'ink.hatch1', type: 'number', default: 0.3, min: 0, max: 1, step: 0.01, label: 'Hatch level 1 start' },
  { key: 'ink.hatch2', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, label: 'Hatch level 2 start' },
  { key: 'ink.hatch3', type: 'number', default: 0.7, min: 0, max: 1, step: 0.01, label: 'Cross-hatch start' },
  { key: 'ink.debugView', type: 'option', default: 'final', options: ['final', 'albedo', 'lighting', 'hatchTone'], label: 'Material debug view' },
];

const LINE_DEFS: Def[] = [
  { key: 'lines.enabled', type: 'boolean', default: true, label: 'Outlines' },
  { key: 'lines.width', type: 'number', default: 2.0, min: 0.5, max: 6, step: 0.1, unit: 'px@1080p', label: 'Silhouette width' },
  { key: 'lines.vehicleWidth', type: 'number', default: 3.0, min: 0.5, max: 8, step: 0.1, unit: 'px@1080p', label: 'Vehicle silhouette width' },
  { key: 'lines.depthThreshold', type: 'number', default: 0.015, min: 0.001, max: 0.2, step: 0.001, label: 'Depth threshold (relative)' },
  { key: 'lines.creaseAngle', type: 'number', default: 35, min: 5, max: 90, step: 1, unit: '°', label: 'Crease angle' },
  { key: 'lines.creaseStrength', type: 'number', default: 0.7, min: 0, max: 1, step: 0.01, label: 'Crease strength' },
  { key: 'lines.idStrength', type: 'number', default: 0.9, min: 0, max: 1, step: 0.01, label: 'Object boundary strength' },
  { key: 'lines.wobble', type: 'option', default: 'low', options: ['off', 'low'], label: 'Hand-drawn wobble (S2)' },
  { key: 'lines.wobbleAmp', type: 'number', default: 0.6, min: 0, max: 3, step: 0.05, unit: 'px', label: 'Wobble amplitude' },
  // Player vehicle border (hull readout): drawn over everything, so the car shows through obstacles.
  { key: 'lines.player', type: 'boolean', default: true, label: 'Player hull border' },
  { key: 'lines.playerWidth', type: 'number', default: 3.5, min: 1, max: 10, step: 0.5, unit: 'px@1080p', label: 'Player border width' },
  { key: 'lines.playerHiddenTint', type: 'number', default: 0.35, min: 0, max: 1, step: 0.05, label: 'Player tint when hidden' },
  { key: 'lines.playerOk', type: 'color', default: '#6FE04A', label: 'Player border: full hull' },
  { key: 'lines.playerHurt', type: 'color', default: '#FF9A2E', label: 'Player border: smoking' },
  { key: 'lines.playerCritical', type: 'color', default: '#FF2E22', label: 'Player border: burning' },
];

const POST_DEFS: Def[] = [
  { key: 'post.bloom', type: 'boolean', default: true, label: 'Bloom' },
  { key: 'post.bloomStrength', type: 'number', default: 0.6, min: 0, max: 3, step: 0.01, label: 'Bloom strength' },
  { key: 'post.bloomRadius', type: 'number', default: 0.4, min: 0, max: 1, step: 0.01, label: 'Bloom radius' },
  { key: 'post.bloomThreshold', type: 'number', default: 1.0, min: 0, max: 4, step: 0.01, label: 'Bloom threshold' },
  { key: 'post.exposure', type: 'number', default: 1.25, min: 0.1, max: 4, step: 0.01, label: 'Exposure' },
  { key: 'post.saturation', type: 'number', default: 0.9, min: 0, max: 2, step: 0.01, label: 'Saturation' },
  { key: 'post.contrast', type: 'number', default: 1.08, min: 0.5, max: 2, step: 0.01, label: 'Contrast' },
  { key: 'post.lift', type: 'color', default: '#120C0D', label: 'Lift (shadows tint)' },
  { key: 'post.gain', type: 'color', default: '#FFF4E6', label: 'Gain (highlights tint)' },
  { key: 'post.vignette', type: 'number', default: 0.3, min: 0, max: 1, step: 0.01, label: 'Vignette' },
  { key: 'post.paper', type: 'number', default: 0.08, min: 0, max: 0.4, step: 0.005, label: 'Paper multiply' },
  { key: 'post.grain', type: 'number', default: 0.03, min: 0, max: 0.2, step: 0.005, label: 'Grain' },
  { key: 'post.aa', type: 'option', default: 'fxaa', options: ['off', 'fxaa', 'smaa'], label: 'Anti-aliasing' },
  {
    key: 'post.debugView',
    type: 'option',
    default: 'final',
    options: ['final', 'grayscale', 'normals', 'depth', 'edges', 'objectId', 'noPost'],
    label: 'Post debug view',
  },
];

const FOG_DEFS: Def[] = [
  { key: 'fog.color', type: 'color', default: '#3B3533', label: 'Fog color' },
  { key: 'fog.density', type: 'number', default: 0.008, min: 0, max: 0.05, step: 0.0005, label: 'Density' },
  { key: 'fog.heightFalloff', type: 'number', default: 0.15, min: 0, max: 1, step: 0.01, label: 'Height falloff' },
  { key: 'fog.start', type: 'number', default: 55, min: 0, max: 300, step: 1, unit: 'm', label: 'Fog start distance' },
];

tunables.registerGroup('ink', INK_DEFS);
tunables.registerGroup('lines', LINE_DEFS);
tunables.registerGroup('post', POST_DEFS);
tunables.registerGroup('fog', FOG_DEFS);

const col = (k: string) => new Color(tunables.get<string>(k));
const num = (k: string) => tunables.get<number>(k);

export const INK_DEBUG = { final: 0, albedo: 1, lighting: 2, hatchTone: 3 } as const;

/** Shared uniform nodes (one instance for the whole app). */
export const U = {
  inkColor: uniform(col('ink.color')),
  shadowColor: uniform(col('ink.shadowColor')),
  litTint: uniform(col('ink.litTint')),
  wrap: uniform(num('ink.wrap')),
  bands: uniform(num('ink.bands')),
  bandSoftness: uniform(num('ink.bandSoftness')),
  specThreshold: uniform(num('ink.specThreshold')),
  hatchOn: uniform(1),
  hatchStrength: uniform(num('ink.hatchStrength')),
  hatchRef: uniform(num('ink.hatchRef')),
  hatchScale: uniform(num('ink.hatchScale')),
  hatch1: uniform(num('ink.hatch1')),
  hatch2: uniform(num('ink.hatch2')),
  hatch3: uniform(num('ink.hatch3')),
  inkDebug: uniform(0),

  lineWidth: uniform(num('lines.width')),
  vehicleLineWidth: uniform(num('lines.vehicleWidth')),
  depthThreshold: uniform(num('lines.depthThreshold')),
  creaseCos: uniform(Math.cos((num('lines.creaseAngle') * Math.PI) / 180)),
  creaseStrength: uniform(num('lines.creaseStrength')),
  idStrength: uniform(num('lines.idStrength')),
  wobbleAmp: uniform(num('lines.wobbleAmp')),
  playerLineWidth: uniform(num('lines.playerWidth')),
  playerHiddenTint: uniform(num('lines.playerHiddenTint')),
  /** 1 / render target size in px, and render height / 1080. */
  invResolution: uniform(new Vector2(1 / 1920, 1 / 1080)),
  resolutionScale: uniform(1),

  exposure: uniform(num('post.exposure')),
  saturation: uniform(num('post.saturation')),
  contrast: uniform(num('post.contrast')),
  lift: uniform(col('post.lift')),
  gain: uniform(col('post.gain')),
  vignette: uniform(num('post.vignette')),
  paper: uniform(num('post.paper')),
  grain: uniform(num('post.grain')),

  fogColor: uniform(col('fog.color')),
  fogDensity: uniform(num('fog.density')),
  fogHeightFalloff: uniform(num('fog.heightFalloff')),
  fogStart: uniform(num('fog.start')),
};

const MAP: Record<string, (v: unknown) => void> = {
  'ink.color': (v) => U.inkColor.value.set(v as string),
  'ink.shadowColor': (v) => U.shadowColor.value.set(v as string),
  'ink.litTint': (v) => U.litTint.value.set(v as string),
  'ink.wrap': (v) => (U.wrap.value = v as number),
  'ink.bands': (v) => (U.bands.value = v as number),
  'ink.bandSoftness': (v) => (U.bandSoftness.value = v as number),
  'ink.specThreshold': (v) => (U.specThreshold.value = v as number),
  'ink.hatchEnabled': (v) => (U.hatchOn.value = v ? 1 : 0),
  'ink.hatchStrength': (v) => (U.hatchStrength.value = v as number),
  'ink.hatchRef': (v) => (U.hatchRef.value = v as number),
  'ink.hatchScale': (v) => (U.hatchScale.value = v as number),
  'ink.hatch1': (v) => (U.hatch1.value = v as number),
  'ink.hatch2': (v) => (U.hatch2.value = v as number),
  'ink.hatch3': (v) => (U.hatch3.value = v as number),
  'ink.debugView': (v) => (U.inkDebug.value = INK_DEBUG[v as keyof typeof INK_DEBUG] ?? 0),
  'lines.width': (v) => (U.lineWidth.value = v as number),
  'lines.vehicleWidth': (v) => (U.vehicleLineWidth.value = v as number),
  'lines.depthThreshold': (v) => (U.depthThreshold.value = v as number),
  'lines.creaseAngle': (v) => (U.creaseCos.value = Math.cos(((v as number) * Math.PI) / 180)),
  'lines.creaseStrength': (v) => (U.creaseStrength.value = v as number),
  'lines.idStrength': (v) => (U.idStrength.value = v as number),
  'lines.wobbleAmp': (v) => (U.wobbleAmp.value = tunables.get<string>('lines.wobble') === 'off' ? 0 : (v as number)),
  'lines.playerWidth': (v) => (U.playerLineWidth.value = v as number),
  'lines.playerHiddenTint': (v) => (U.playerHiddenTint.value = v as number),
  'lines.wobble': (v) => (U.wobbleAmp.value = v === 'off' ? 0 : num('lines.wobbleAmp')),
  'post.exposure': (v) => (U.exposure.value = v as number),
  'post.saturation': (v) => (U.saturation.value = v as number),
  'post.contrast': (v) => (U.contrast.value = v as number),
  'post.lift': (v) => U.lift.value.set(v as string),
  'post.gain': (v) => U.gain.value.set(v as string),
  'post.vignette': (v) => (U.vignette.value = v as number),
  'post.paper': (v) => (U.paper.value = v as number),
  'post.grain': (v) => (U.grain.value = v as number),
  'fog.color': (v) => U.fogColor.value.set(v as string),
  'fog.density': (v) => (U.fogDensity.value = v as number),
  'fog.heightFalloff': (v) => (U.fogHeightFalloff.value = v as number),
  'fog.start': (v) => (U.fogStart.value = v as number),
};

// Initial sync for values that depend on other keys, then live sync.
MAP['ink.hatchEnabled']!(tunables.get('ink.hatchEnabled'));
MAP['lines.wobble']!(tunables.get('lines.wobble'));
tunables.onChange((key, value) => MAP[key]?.(value));

/** Shared textures used by materials and post (set once at boot). */
export const SharedTex = {
  tam: null as Texture | null,
  noise: null as Texture | null,
  paper: null as Texture | null,
};

export function tamNode() {
  if (!SharedTex.tam) throw new Error('TAM texture not initialised');
  return texture(SharedTex.tam);
}

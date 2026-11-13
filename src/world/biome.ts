/**
 * Biome definition (doc 04 §3 A1): everything that makes a world look like itself, as data plus
 * one `decorate` hook for hand-placed set pieces. The generic builder (world/build.ts) does the
 * rest: lights, fog, terrain, road, barricades, start gantry, pits, dressing.
 */
import type { CatmullRomCurve3, Object3D, PointLight, Scene, Vector3 } from 'three/webgpu';
import type { Preset } from '../core/tunables';
import type { Rng } from '../core/rng';
import type { ProceduralSet } from '../render/procedural/textures';
import type { EmitterOptions } from '../render/fx/particles';
import type { InkLitMaterial } from '../render/ink/ink-material';
import type { CompiledLandmark, CompiledTrack } from '../track/compile';
import type { Barricade, Surface } from '../track/track-format';
import type { Reserved, Theme } from '../game/dressing';

/** Procedural textures a surface may use. */
export type TexKey = 'plates' | 'grate' | 'dirt' | 'iron' | 'rust' | 'brass' | 'flagstone' | 'cobble' | 'planks' | 'rails';

export interface SurfaceLook {
  tex: TexKey;
  /** Albedo tint (multiplies the texture). */
  tint?: string;
  /** UV repeats per track width (road) or per metre (ground, world mapping). */
  scale?: number;
  sheen?: number;
}

export interface BiomeDef {
  id: string;
  name: string;
  /** Tunable values applied when the world is built: light.*, fog.*, ink.*, post.* (doc 02 palettes). */
  tunables: Preset;
  /** Off-road ground. */
  ground: SurfaceLook;
  /** Road look per surface; missing ones use the defaults of the builder. */
  surfaces?: Partial<Record<Surface, SurfaceLook>>;
  /** Dressing themes per barricade (what is built behind each edge type). */
  themes?: Partial<Record<Barricade, Theme>>;
  /** Start gantry banner. */
  gantry: { lines: string[]; bg: string; fg: string };
  /** Floor of the jump pits. */
  pit: 'lava' | 'dark';
  /** Hand-placed props and set pieces (furnaces, signs, crowds, halls). */
  decorate?(ctx: WorldContext): void;
  /** Build the set piece for a landmark slot; return false to get the generic placeholder. */
  landmark?(ctx: WorldContext, lm: CompiledLandmark): boolean;
}

/** What a biome hook can use while the world is being built. */
export interface WorldContext {
  scene: Scene;
  track: CompiledTrack;
  /** Flat (y = 0) helper curve through the centre line; use heightAt for heights. */
  curve: CatmullRomCurve3;
  tex: ProceduralSet;
  rng: Rng;
  seed: number;
  /** Footprints the dressing generator keeps clear of. */
  reserved: Reserved[];
  emitters: EmitterOptions[];
  /** Point lights the quality manager may cap. */
  localLights: PointLight[];
  /** Ground height under a point (0 on flat tracks). */
  heightAt(x: number, z: number): number;
  /** Distance from (x, z) to the nearest centre-line sample. */
  distToTrack(x: number, z: number): number;
  /**
   * Point `off` metres beside the track at curve parameter t (+ = left), at ground height. Off-track
   * spots keep the same clearance from every part of the track; null when there is no clear spot.
   */
  beside(t: number, off: number, extra?: number): { p: Vector3; yaw: number } | null;
  /** Add to the scene at (x, ground, z) with shadows on meshes only. */
  place(o: Object3D, x: number, z: number, ry?: number): Object3D;
  ink(p: ConstructorParameters<typeof InkLitMaterial>[0]): InkLitMaterial;
}

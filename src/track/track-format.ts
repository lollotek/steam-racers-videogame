/**
 * Block-based track format (doc 03 §7, A3; v2 in doc 04 §3 A2/A5). Pure data + math: no Three.js, runs in Node.
 *
 * A track is a chain of pieces on a square grid. Each piece starts at the exit of the previous
 * one (edge midpoint of a cell, heading along a grid axis). This guarantees connectivity; the
 * compiler checks closure and overlaps. The future editor (§7.3) will place blocks freely and
 * convert to/from this chain.
 *
 * v2 (M4): height levels (`rise`, `crest`, `jump`), new surfaces and barricades, pickups,
 * hazard zones, landmark slots and dressing zones. v1 files stay valid (everything is optional).
 */

export type Surface =
  | 'plate' | 'grate' | 'dirt' | 'sand' | 'oil' | 'water'
  // v2 (doc 04 §5)
  | 'flagstone' | 'rails' | 'cobble' | 'scrap' | 'mud' | 'heartwood' | 'moss';
/** Barricade types from gameplay.md §6.3 + doc 04 §5. */
export type Barricade =
  | 'earth' | 'riveted' | 'hedgehog' | 'corrugated' | 'sandbags' | 'barbed'
  | 'stone' | 'runepylon' | 'ironrail' | 'wreckwall' | 'tyres' | 'roots' | 'crystal';
export type PieceType = 'start' | 'straight' | 'curve' | 'jump';
export type Turn = 'L' | 'R';

export const SURFACES: readonly Surface[] = ['plate', 'grate', 'dirt', 'sand', 'oil', 'water', 'flagstone', 'rails', 'cobble', 'scrap', 'mud', 'heartwood', 'moss'];

export type PickupKind = 'coal' | 'money';
export const PICKUP_KINDS: readonly PickupKind[] = ['coal', 'money'];

/** A crate on the road (doc 04 §3 A3). */
export interface PickupSlot {
  kind: PickupKind;
  /** Position along the piece, 0..1 (default 0.5). */
  at?: number;
  /** Lateral position: -1 (centre of the left column) .. 1 (centre of the right column); see units.ts (default 0). */
  lane?: number;
}

export type HazardKind = 'vent' | 'crossing' | 'crane' | 'stream';
export const HAZARD_KINDS: readonly HazardKind[] = ['vent', 'crossing', 'crane', 'stream'];
export type HazardPhase = 'idle' | 'warning' | 'active';

/** What a hazard does to a racer inside its zone during one phase (doc 04 §6). */
export interface HazardEffect {
  /** PF lost once when entering (or being inside when the phase starts). */
  damage?: number;
  /** Frontal crash: full stop, 1st gear (barricades.crashStun). */
  crash?: boolean;
  /** PV gained once. */
  steam?: number;
  /** PV per second while inside. */
  steamRate?: number;
  /** Grip multiplier while inside. */
  grip?: number;
  /** Engine target multiplier while inside (barriers, smoke). */
  slow?: number;
  /** The zone becomes a wall (crane block): a solid collider is enabled. */
  solid?: boolean;
}

/** A timed zone on the track (doc 04 §3 A4). Missing values come from the kind preset. */
export interface HazardSpec {
  kind: HazardKind;
  /** Centre along the piece, 0..1 (default 0.5). */
  at?: number;
  /** Length along the track (m). */
  length?: number;
  /** Lateral range, -1..1 of the half width; column boundaries are multiples of 1/3 (units.ts; default full width). */
  lanes?: [number, number];
  /** Cycle (s): idle, then `warning`, then `active`. */
  period?: number;
  warning?: number;
  active?: number;
  /** Cycle offset (s). */
  phase?: number;
  effects?: Partial<Record<HazardPhase, HazardEffect>>;
}

/** Reserved footprint for a hand-built set piece beside the track (kept clear by the dressing). */
export interface LandmarkSlot {
  id: string;
  side: Turn;
  /** Position along the piece, 0..1 (default 0.5). */
  at?: number;
  /** Distance of the centre from the track edge (m, default 20). */
  offset?: number;
  /** Footprint radius (m, default 15). */
  radius?: number;
}

export interface Piece {
  type: PieceType;
  /** Curves: footprint size in cells (1 = tight, 2 = large, 3 = sweeping). Straights/jumps: length in cells. */
  size?: number;
  turn?: Turn;
  surface?: Surface;
  /** Barricade on the left / right edge (default: track-wide default). */
  left?: Barricade;
  right?: Barricade;
  /** Height change in levels over the piece (ramp; on a jump: landing level). */
  rise?: number;
  /** Straights: hump height in metres (bridge, crest), back to the same level. */
  crest?: number;
  /** Dressing district tag (biome themes may use it). */
  zone?: string;
  pickups?: PickupSlot[];
  hazard?: HazardSpec | HazardSpec[];
  landmark?: LandmarkSlot | LandmarkSlot[];
}

export interface TrackFile {
  id: string;
  name: string;
  biome: string;
  /** Grid cell size in metres (20 m = 8 squares, units.ts). */
  cell: number;
  /** Track width in metres (15 m = 6 squares, units.ts). */
  width: number;
  laps: number;
  defaultSurface: Surface;
  defaultBarricade: Barricade;
  /** Height of one level (m, default 4, doc 03 §7.3). */
  level?: number;
  pieces: Piece[];
  /** Free tile layout saved by the track editor (doc 05 §5); the game ignores it. */
  editor?: { version: number; tiles: { x: number; z: number; dir: number; piece: Piece }[] };
}

/** Jump geometry (doc 04 §3 A5): kicker, gap (no road), landing ramp. Metres. */
export const JUMP = {
  /** Kicker length and lip height: y = lip · u², launch slope 2·lip/kicker. */
  kicker: 10,
  lip: 1.5,
  /** Landing ramp length and height above the landing level: y = land · (1 − u)². */
  landing: 14,
  land: 1.4,
  /** Minimum gap. */
  minGap: 6,
  /** Depth of the pit under the gap (visual; a car below the line by `fallDepth` is repositioned). */
  pit: 8,
  fallDepth: 4,
} as const;

/** Steepest grade allowed on the road (rise/run). */
export const MAX_GRADE = 0.26;
/** Highest crest. */
export const MAX_CREST = 4;

/** Grip multiplier per surface (doc 03 §6.1). Rain/snow modifiers come later. */
export const SURFACE_GRIP: Record<Surface, number> = {
  plate: 1.0,
  grate: 0.9,
  dirt: 0.78,
  sand: 0.65,
  oil: 0.35,
  water: 0.6,
  flagstone: 0.98,
  rails: 0.8,
  cobble: 0.86,
  scrap: 0.74,
  mud: 0.55,
  heartwood: 0.95,
  moss: 0.62,
};

/** Extra rolling drag per surface (m/s² at full speed). */
export const SURFACE_DRAG: Record<Surface, number> = {
  plate: 0,
  grate: 0.2,
  dirt: 0.8,
  sand: 1.6,
  oil: 0,
  water: 1.2,
  flagstone: 0.05,
  rails: 0.4,
  cobble: 0.35,
  scrap: 0.9,
  mud: 2.4,
  heartwood: 0.1,
  moss: 0.6,
};

/** Loose surfaces throw dust behind the wheels. */
export const LOOSE_SURFACES: ReadonlySet<Surface> = new Set<Surface>(['dirt', 'sand', 'mud', 'scrap', 'moss']);

export const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

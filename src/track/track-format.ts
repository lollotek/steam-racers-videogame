/**
 * Block-based track format (doc 03 §7, A3). Pure data + math: no Three.js, runs in Node.
 *
 * A track is a chain of pieces on a square grid. Each piece starts at the exit of the previous
 * one (edge midpoint of a cell, heading along a grid axis). This guarantees connectivity; the
 * compiler checks closure and overlaps. The future editor (§7.3) will place blocks freely and
 * convert to/from this chain.
 */

export type Surface = 'plate' | 'grate' | 'dirt' | 'sand' | 'oil' | 'water';
/** Barricade types from gameplay.md §6.3. */
export type Barricade = 'earth' | 'riveted' | 'hedgehog' | 'corrugated' | 'sandbags' | 'barbed';
export type PieceType = 'start' | 'straight' | 'curve';
export type Turn = 'L' | 'R';

export interface Piece {
  type: PieceType;
  /** Curves: footprint size in cells (1 = tight, 2 = large, 3 = sweeping). Straights: length in cells. */
  size?: number;
  turn?: Turn;
  surface?: Surface;
  /** Barricade on the left / right edge (default: track-wide default). */
  left?: Barricade;
  right?: Barricade;
}

export interface TrackFile {
  id: string;
  name: string;
  biome: string;
  /** Grid cell size in metres (A6: 20 m proposed, to be matched with tabletop tiles). */
  cell: number;
  /** Track width in metres. */
  width: number;
  laps: number;
  defaultSurface: Surface;
  defaultBarricade: Barricade;
  pieces: Piece[];
}

/** Grip multiplier per surface (doc 03 §6.1). Rain/snow modifiers come later. */
export const SURFACE_GRIP: Record<Surface, number> = {
  plate: 1.0,
  grate: 0.9,
  dirt: 0.78,
  sand: 0.65,
  oil: 0.35,
  water: 0.6,
};

/** Extra rolling drag per surface (m/s² at full speed). */
export const SURFACE_DRAG: Record<Surface, number> = {
  plate: 0,
  grate: 0.2,
  dirt: 0.8,
  sand: 1.6,
  oil: 0,
  water: 1.2,
};

/**
 * Tabletop grid (doc 05 §2, decided 2026-11-14). Pure constants, shared by the game, the editor
 * and the tileset.
 *
 * - One square holds one vehicle (board game); in 3D a square is 2.5 m, the vehicle width.
 * - A grid cell (module) is 8 × 8 squares = 20 m: 6 squares of road + 1 square of edge per side.
 * - Printed, a square is 2 cm, so a module is a 16 × 16 cm tile (scale 1:125).
 */

/** Size of one square (m). */
export const SQUARE = 2.5;
/** Squares per grid cell (module), along both axes. */
export const MODULE_SQUARES = 8;
/** Road width in squares (the columns). */
export const ROAD_SQUARES = 6;
/** Edge band per side in squares (barricade type is printed there). */
export const EDGE_SQUARES = 1;
/** Grid cell size (m) = 20. */
export const CELL = SQUARE * MODULE_SQUARES;
/** Track width (m) = 15. */
export const WIDTH = SQUARE * ROAD_SQUARES;
/** Printed size of one square (cm). */
export const PRINT_SQUARE_CM = 2;

/**
 * Pickup lanes (-1..1) cover the column centres: lane ±1 is the centre of the outer column, so the
 * lateral offset is lane × (half width − half a square).
 */
export const LANE_REACH = (ROAD_SQUARES - 1) / ROAD_SQUARES;

/** Lane value (-1..1) of column `c` (0 = leftmost, 5 = rightmost, driver's view). */
export const laneOfColumn = (c: number) => (2 * c - (ROAD_SQUARES - 1)) / (ROAD_SQUARES - 1);
/** Nearest column of a lane value (ties go right). */
export const columnOfLane = (lane: number) =>
  Math.max(0, Math.min(ROAD_SQUARES - 1, Math.round(((lane + 1) * (ROAD_SQUARES - 1)) / 2 + 1e-9)));

/** Hazard lane bound (-1..1 of the half width) of column boundary `b` (0 = left edge … 6 = right edge). */
export const boundOfLine = (b: number) => (2 * b - ROAD_SQUARES) / ROAD_SQUARES;
/** Nearest column boundary of a hazard lane bound. */
export const lineOfBound = (v: number) => Math.max(0, Math.min(ROAD_SQUARES, Math.round(((v + 1) * ROAD_SQUARES) / 2)));

/**
 * Default vehicle size factor (decided 2026-11-16): vehicles at half size, so a hot rod is one
 * square long (2.5 m) and the track feels twice as big. Mass, speeds and paths unchanged
 * (`scaleSpec` in vehicle-physics.ts; `?vscale=` overrides it).
 */
export const VEHICLE_SCALE = 0.5;

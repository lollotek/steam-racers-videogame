# 05 — Track editor (milestone M5)

The block-based level editor announced in doc 03 §7.3 (A3). A separate page of the game, `/mapeditor/`, where tracks are built by placing tiles freely on the grid, checked live against the compiler and the Cup rules, saved as the same JSON the game reads, test-driven in a new tab and (later) previewed in 3D and printed as tabletop tiles.

## 1. Decisions (owner, 2026-11-14)

| # | Topic | Decision |
|---|---|---|
| E-A | Editing model | **Free placement**: tiles are placed anywhere on the grid with a rotation; the editor walks from the start tile through the connected sockets and derives the piece chain of the track format (doc 03 §7.1.1). |
| E-B | Page | `/mapeditor/` (Vite multi-page entry `mapeditor/index.html`), PC only (mouse + keyboard). |
| E-C | Files | Save / load as JSON in the `TrackFile` format; the standard tracks of `src/tracks` can be loaded; the last edited track is kept in `localStorage` (one slot; other tracks are loaded from file). |
| E-D | Test drive | "Play" opens the game in a **new tab** (`/?custom`) with defaults: 1 player, 3 AI rivals, Normal difficulty. |
| E-E | World | The world (biome) of the track is chosen in the editor; it drives the 3D preview, the tileset render and the dressing in game. |
| E-F | 3D preview | In scope: a 3D view of the real world (same builder as the game) beside the grid. |
| E-G | Tabletop tiles | "Show tileset": **rendered** top-down images (the game's ink look), **15 × 15 cm per grid cell**, **one tile per piece of the current track** (a piece of n cells prints at its footprint, e.g. a 3-cell straight is 15 × 45 cm, a size-3 curve 45 × 45 cm). |
| E-H | Cup and build | Later (E5): a dev-only way to save editor tracks into `src/tracks` and choose which tracks make up each Grand Prix. |

Scale: 20 m cell → 15 cm, i.e. **1:133**; a 5 m vehicle is a 3.75 cm miniature (doc 03 A6 assumed 10 cm cells at 1:200; this replaces it).

## 2. Phases

| Phase | Content | Status |
|---|---|---|
| **E1** | Page, tile layout model, 2D grid editor, inspector, live validation and stats, save / load / standard tracks / autosave, world selector, undo / redo | ✅ |
| **E2** | Play button → new tab, `?custom` boot in the game | ✅ |
| E3 | 3D preview panel (world builder + orbit camera, rebuilt on change) | — |
| E4 | Tileset view: orthographic render per piece, print sheets with cut marks, layout sheet | — |
| E5 | Dev-only "save to project" + Cup configuration file | — |

## 3. Tile layout model (`src/editor/layout.ts`)

Pure data, no DOM, runs in Node (unit tested).

- **Grid**: integer cells `(x, z)`, the same cells the compiler uses (`compile.ts` `pieceCells`: cell = `floor(X / cell)`). Directions `0..3` = headings `0, π/2, π, 3π/2` (0 = +Z, 1 = +X). The driver's right of `d` is `d − 1`.
- **Tile** = `{ id, x, z, dir, piece }`: the piece is entered from the edge of cell `(x, z)` heading `dir`. Footprint: straights / start / jumps cover `size` cells forward; a curve of size n covers the n × n block towards its turn side.
- **Sockets**: a tile is entered at its entry socket and leaves through its exit socket (`exitSocket`: next cell + heading). A tile can also be **traversed backwards**: then the chain gets the mirrored piece (curve turn flipped, `rise` negated, left/right barricades swapped, `at` → 1 − `at`, lanes negated, landmark side flipped).
- **Chain walk** (`walkChain`): from the start tile, follow the exit socket to the tile occupying the next cell; it must accept the socket forwards or backwards, otherwise the track is broken there. The walk ends when it comes back to the start entry (closed), reaches an empty cell (open end, shown on the grid as the next placement target) or fails. Tiles not reached are "unconnected" and ignored by the track.
- **Normalisation**: after every edit, tiles traversed backwards are rewritten in their forward form (`reverseTile`), so arrows and left/right in the inspector always follow the direction of travel. Jumps are directional: a jump reached backwards is an error ("Reverse" flips it explicitly).
- **Validation** (`validateDoc`): structural problems of the walk (no / several starts, broken connection, overlap) → then `compileTrack` (closure in height, slopes, jump gaps, pickups, hazards) → then `checkTrack` (Cup rules, warnings only). Compiler errors name a piece index; the editor maps it back to the tile and highlights it.
- **Height** is not stored per tile: levels come from the `rise` of the pieces along the chain (as in the track format). The grid shows the level of each tile.
- **Overpasses** (the road crossing over itself) are still out of scope: one tile per cell.

## 4. File format

Saved files are ordinary `TrackFile`s (doc 03 §7.1.1): `pieces` is the walked chain, so a saved file can go straight into `src/tracks`. The editor adds an optional `editor` field the game ignores:

```json
{ "id": "…", "name": "…", "biome": "orc", "cell": 20, "width": 14, "laps": 3, "level": 4,
  "defaultSurface": "sand", "defaultBarricade": "tyres",
  "pieces": [ … ],
  "editor": { "version": 1, "tiles": [ { "x": 0, "z": 0, "dir": 0, "piece": { "type": "start", "size": 3 } }, … ] } }
```

Loading: with `editor.tiles` the layout is restored as saved (unconnected tiles and open tracks included); without it (standard tracks, hand-written files) the tiles are laid out from the chain starting at cell (0, 0) heading north, exactly where the compiler puts them.

Storage keys: `steamRacers.editor.doc` (autosave of the last track), `steamRacers.customTrack` (the track handed to the game by Play).

## 5. Editor page (E1)

| Area | Content |
|---|---|
| Top bar | New, Open file…, Standard track (list of `src/tracks`), Save JSON, Undo / Redo, **Play**, 3D preview (E3), Show tileset (E4) |
| Palette (left) | Start, straight, ramp (straight with rise), crest, curve 1 / 2 / 3, jump 2 / 3 |
| Grid (centre) | Top view (north up, the driver's right on the right): road coloured by surface, barricades on the edges by type, travel arrows, jump gaps, crates, hazards, landmark footprints, level per tile; the open end and the ghost of the tile being placed (green = free, red = blocked) |
| Inspector (right) | Selected tile: size, turn, surface, barricades, rise, crest, zone, crates, hazards, landmark, raw JSON. Nothing selected: track settings (name, id, world, laps, width, level height, default surface / barricade). Always: validation and the Cup report |

Controls: left click places the current piece or selects a tile; drag a selected tile to move it; right / middle drag or drag on empty ground pans; wheel zooms. `R` rotates (piece being placed or selected tile), `F` flips a curve, `V` reverses the selected tile, `Enter` appends the current piece at the open end, `Del` deletes, `Esc` back to select, `Ctrl+Z` / `Ctrl+Y` undo / redo, `1`–`9` palette.

Hovering the open end cell orients the ghost to the open end automatically.

Zone and landmark names are suggested per world from the zones and landmarks the standard tracks of that world use (the biome's `decorate` / `landmark` code is what gives them meaning).

## 6. Play (E2)

Play is enabled when the track compiles. It writes the track to `steamRacers.customTrack` and opens `/?custom` in a named tab (`steam-racers-play`, reused by the next Play). In the game, `?custom` (`flags.custom`) makes `Flow.boot` start a single race on that track: player 1 + 3 AI, Normal, random grid. Results offer Again / Title as usual. Without a stored track the game falls back to the title screen.

## 7. 3D preview (E3, plan)

A second canvas in the editor built with the game's renderer and `world/build.ts` from the compiled track and the chosen biome, orbit camera (drag, wheel), "board camera" button; rebuilt (debounced) when the track compiles after an edit. Dressing seed editable with a reroll button (doc 03 §7.3).

## 8. Tileset (E4, plan)

- One tile per piece of the current track, numbered in race order (`#1` = start).
- Rendered orthographically from above with the ink pipeline at 300 dpi: 15 cm = 1772 px per cell. Includes the dressing inside the piece footprint, crates, hazard markings, travel arrow, level badge and the piece number.
- Print sheets: tiles with 3 mm bleed and cut marks, A4 / A3 via the browser's print to PDF; tiles larger than the sheet are split per cell with join marks.
- Layout sheet: the whole track from above with the numbered tiles.
- Open point to confirm before E4: whether multi-cell pieces stay one big tile or are always printed as 15 × 15 cm cell tiles.

## 9. Cup and build (E5, plan)

A Vite dev-server plugin exposes `POST /__editor/save` (dev only) that writes `src/tracks/<id>.json`; the editor shows "Save to project" in dev builds. Cup rounds move from code to `src/cup/cups.json` (Cup → ordered track ids), edited from the editor; `src/tracks/index.ts` picks up every JSON in the folder (`import.meta.glob`).

## 10. Tests

- `tests/unit/editor-layout.test.ts`: chain → tiles → chain round trip for every standard track (pieces identical, compiled cells identical), backward traversal and normalisation, broken / open / unconnected cases, compiler error mapping.
- `tests/e2e/editor.spec.ts`: `/mapeditor/` loads without errors, a standard track loads and validates, Play stores the track.

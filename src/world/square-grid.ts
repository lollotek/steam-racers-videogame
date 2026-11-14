/**
 * `?grid` overlay (doc 05 §2): the tabletop squares drawn on the road, to check that the 3D track
 * matches the printed tiles. Column lines follow the road; cross lines every square along the
 * centre line (so on curves they are radial). Debug only, not part of any quality tier.
 */
import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments } from 'three/webgpu';
import { sampleAt, type CompiledTrack } from '../track/compile';
import { EDGE_SQUARES, ROAD_SQUARES, SQUARE } from '../track/units';

export function squareGrid(track: CompiledTrack): LineSegments {
  const pos: number[] = [];
  const lift = 0.12;
  const hw = track.halfWidth;
  const edge = EDGE_SQUARES * SQUARE;
  const offsets = [-hw - edge, ...Array.from({ length: ROAD_SQUARES + 1 }, (_, k) => -hw + k * SQUARE), hw + edge];
  const S = track.samples;
  const at = (i: number, lat: number) => {
    const p = S[i]!;
    // Driver's right of tangent t is (−tz, tx).
    return [p.x - p.tz * lat, p.y + lift, p.z + p.tx * lat];
  };
  for (let i = 0; i < S.length; i++) {
    const j = (i + 1) % S.length;
    if (S[i]!.feature === 'gap' || S[j]!.feature === 'gap') continue;
    for (const o of offsets) pos.push(...at(i, o), ...at(j, o));
  }
  for (let s = 0; s < track.length; s += SQUARE) {
    const p = sampleAt(track, s);
    if (p.feature === 'gap') continue;
    const a = -hw - edge;
    const b = hw + edge;
    pos.push(p.x - p.tz * a, p.y + lift, p.z + p.tx * a, p.x - p.tz * b, p.y + lift, p.z + p.tx * b);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  const lines = new LineSegments(geo, new LineBasicMaterial({ color: 0x101010, transparent: true, opacity: 0.55, depthWrite: false }));
  lines.name = 'square-grid';
  lines.renderOrder = 5;
  return lines;
}

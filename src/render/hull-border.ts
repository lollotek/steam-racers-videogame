/**
 * Player hull border colour (render/pipeline.ts playerBorder): green at full hull, orange at the
 * smoke threshold, red at the fire threshold (gameplay.md §6.1), pulsing while the engine burns.
 * Colours are display sRGB 0..1: the border is composited after tonemapping and grading.
 */
import { Color, SRGBColorSpace } from 'three/webgpu';
import { tunables } from '../core/tunables';
import type { HullState } from '../rules/hull';

export interface BorderColor {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

const a = new Color();
const b = new Color();
const srgb = (key: string, out: Color) => {
  out.set(tunables.get<string>(key));
  const c = out.getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace);
  return out.setRGB(c.r, c.g, c.b);
};

/** `time` in seconds (any clock): drives the pulse while burning. */
export function hullBorderColor(h: HullState, time: number, out: BorderColor): BorderColor {
  const smokeAt = tunables.get<number>('hull.smokeAt');
  const fireAt = tunables.get<number>('hull.fireAt');
  const f = h.max > 0 ? h.pf / h.max : 0;
  let alpha = 1;
  if (h.wrecked) {
    srgb('lines.playerCritical', a);
    alpha = 0.6;
  } else if (f >= smokeAt) {
    const t = smokeAt < 1 ? (f - smokeAt) / (1 - smokeAt) : 1;
    srgb('lines.playerHurt', a).lerp(srgb('lines.playerOk', b), Math.min(1, t));
  } else if (f >= fireAt) {
    const t = smokeAt > fireAt ? (f - fireAt) / (smokeAt - fireAt) : 1;
    srgb('lines.playerCritical', a).lerp(srgb('lines.playerHurt', b), t);
  } else {
    srgb('lines.playerCritical', a);
    alpha = 0.65 + 0.35 * (0.5 + 0.5 * Math.cos(time * Math.PI * 2 * 2.5));
  }
  out.r = a.r;
  out.g = a.g;
  out.b = a.b;
  out.alpha = alpha;
  return out;
}

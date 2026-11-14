/**
 * Biome registry (doc 04 §3 A1). A track file names its biome; unknown ids fall back to the
 * foundry so a track under construction always loads. The four Cup worlds are added in phase C (doc 04 §7).
 */
import type { BiomeDef } from '../world/biome';
import { FOUNDRY } from './foundry';
import { DWARVEN } from './dwarven';
import { VICTORIAN } from './victorian';
import { ORC } from './orc';
import { ELVEN } from './elven';

const BIOMES: Record<string, BiomeDef> = {
  foundry: FOUNDRY,
  dwarven: DWARVEN,
  victorian: VICTORIAN,
  orc: ORC,
  elven: ELVEN,
};

export function getBiome(id: string): BiomeDef {
  const b = BIOMES[id];
  if (!b) console.warn(`[world] unknown biome "${id}", using the foundry`);
  return b ?? FOUNDRY;
}

export function biomeIds(): string[] {
  return Object.keys(BIOMES);
}

/**
 * Biome registry (doc 04 §3 A1). A track file names its biome; unknown ids fall back to the
 * foundry so a track under construction always loads. The four Cup worlds are added in phase C.
 */
import type { BiomeDef } from '../world/biome';
import { FOUNDRY } from './foundry';

const BIOMES: Record<string, BiomeDef> = {
  foundry: FOUNDRY,
};

export function getBiome(id: string): BiomeDef {
  const b = BIOMES[id];
  if (!b) console.warn(`[world] unknown biome "${id}", using the foundry`);
  return b ?? FOUNDRY;
}

export function biomeIds(): string[] {
  return Object.keys(BIOMES);
}

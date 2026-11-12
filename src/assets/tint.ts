import { parseState } from './models';

// Plains biome: temperature 0.8, downfall 0.4 → colormap pixel (x, y).
const PLAINS = { x: Math.floor((1 - 0.8) * 255), y: Math.floor((1 - 0.4 * 0.8) * 255) };

const FOLIAGE = new Set(['oak_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'vine']);
const FIXED: Record<string, number> = {
  birch_leaves: 0x80a755, spruce_leaves: 0x619961, lily_pad: 0x208030, water: 0x3f76e4,
  bubble_column: 0x3f76e4, water_cauldron: 0x3f76e4, attached_pumpkin_stem: 0xe0c71c, attached_melon_stem: 0xe0c71c,
};

export interface Colormaps { grass: number; foliage: number }

export function samplePlains(img: ImageData): number {
  const i = (PLAINS.y * img.width + PLAINS.x) * 4;
  return (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
}

/**
 * RGB tint for faces with a tintindex; everything not listed (grass, ferns, sugar cane...) uses grass color.
 * shortcut: one fixed biome; per-biome tint when biomes exist.
 */
export function tintFor(state: string, maps: Colormaps): number {
  const { name, props } = parseState(state);
  if (name in FIXED) return FIXED[name];
  if (FOLIAGE.has(name)) return maps.foliage;
  if (name === 'redstone_wire') {
    const f = Number(props.power ?? 0) / 15;
    const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
    return (c(f * 0.6 + (f > 0 ? 0.4 : 0.3)) << 16) | (c(f * f * 0.7 - 0.5) << 8) | c(f * f * 0.6 - 0.7);
  }
  if (name === 'pumpkin_stem' || name === 'melon_stem') {
    const age = Number(props.age ?? 0);
    return ((age * 32) << 16) | ((255 - age * 8) << 8) | (age * 4);
  }
  return maps.grass;
}

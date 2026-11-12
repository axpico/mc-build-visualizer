import { parseState } from '../assets/models';

const KNOWN: Record<string, number> = {
  stone: 0x7f7f7f, cobblestone: 0x6e6e6e, dirt: 0x866043, grass_block: 0x5d9c3a, oak_planks: 0xa2824e,
  spruce_planks: 0x735531, oak_log: 0x6d5434, stone_bricks: 0x7a7a7a, bricks: 0x966453, glass: 0xc8e6f0,
  white_wool: 0xe9ecec, black_wool: 0x15151a, red_wool: 0xa12722, sandstone: 0xd8cb9b, deepslate_bricks: 0x464648,
  oak_leaves: 0x3c7a24, water: 0x3f76e4, gold_block: 0xf6d02e, quartz_block: 0xebe5de,
};

/** Flat color for a block when no textures are available. */
export function blockColor(state: string): [number, number, number] {
  const { name } = parseState(state);
  let hex = KNOWN[name];
  if (hex === undefined) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    // stable pseudo-random mid-tone per block name
    hex = ((64 + (h & 127)) << 16) | ((64 + ((h >> 8) & 127)) << 8) | (64 + ((h >> 16) & 127));
  }
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

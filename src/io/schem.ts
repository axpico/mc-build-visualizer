import { World } from '../world/world';
import { gzip, nbt, Tag, writeNbt } from './nbt';

export const DEFAULT_DATA_VERSION = 5023; // Minecraft 26.3

/** Inclusive bounding box of all non-air blocks, or null for an empty world. */
export function bounds(world: World): { min: number[]; max: number[] } | null {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const [x, y, z] of world.blocks())
    [x, y, z].forEach((v, i) => { min[i] = Math.min(min[i], v); max[i] = Math.max(max[i], v); });
  return min[0] === Infinity ? null : { min, max };
}

function varints(values: Iterable<number>): Uint8Array {
  const out: number[] = [];
  for (let v of values) {
    while (v & ~0x7f) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
    out.push(v);
  }
  return new Uint8Array(out);
}

/**
 * Sponge Schematic v3 (WorldEdit `//schem load`). Palette keys are our blockstate strings;
 * WorldEdit fills properties we don't store (waterlogged, powered...) with their defaults.
 * Block entities: only signs carry data (their text); chests etc. are created empty by the game.
 */
export function schemTag(world: World, name: string, dataVersion: number): Tag & { type: 'compound' } {
  const b = bounds(world);
  if (!b) throw new Error('Nothing to export: the build is empty.');
  const [w, h, l] = [0, 1, 2].map((i) => b.max[i] - b.min[i] + 1);
  if (Math.max(w, h, l) > 0xffff) throw new Error('Build too large for a schematic (max 65535 per side).');

  const palette = new Map<number, number>([[0, 0]]); // world id → schem id, air first
  const ids = function* () {
    for (let y = 0; y < h; y++)
      for (let z = 0; z < l; z++)
        for (let x = 0; x < w; x++) {
          const id = world.get(b.min[0] + x, b.min[1] + y, b.min[2] + z);
          let s = palette.get(id);
          if (s === undefined) palette.set(id, (s = palette.size));
          yield s;
        }
  };
  const data = varints(ids()); // must run before the palette is read below

  return nbt.compound({
    Schematic: nbt.compound({
      Version: nbt.int(3),
      DataVersion: nbt.int(dataVersion),
      Metadata: nbt.compound({ Name: nbt.string(name), Date: nbt.long(BigInt(Date.now())) }),
      Width: nbt.short(w),
      Height: nbt.short(h),
      Length: nbt.short(l),
      Offset: nbt.intArray([0, 0, 0]),
      Blocks: nbt.compound({
        Palette: nbt.compound(Object.fromEntries([...palette].map(([wid, sid]) => [world.palette[wid], nbt.int(sid)]))),
        Data: nbt.byteArray(data),
        BlockEntities: nbt.list('compound', signEntities(world, b.min)),
      }),
    }),
  });
}

function signEntities(world: World, min: number[]): Tag[] {
  const out: Tag[] = [];
  for (const [key, lines] of world.texts) {
    const [x, y, z] = key.split(',').map(Number);
    const name = world.getState(x, y, z).replace(/^minecraft:|\[.*$/g, '');
    if (!name.endsWith('sign')) continue;
    // plain strings are valid text components in 26.x NBT
    const side = (msgs: string[]) => nbt.compound({
      messages: nbt.list('string', [0, 1, 2, 3].map((i) => nbt.string(msgs[i] ?? ''))),
      color: nbt.string('black'),
      has_glowing_text: nbt.byte(0),
    });
    out.push(nbt.compound({
      Pos: nbt.intArray([x - min[0], y - min[1], z - min[2]]),
      Id: nbt.string(name.includes('hanging') ? 'minecraft:hanging_sign' : 'minecraft:sign'),
      Data: nbt.compound({ front_text: side(lines), back_text: side([]), is_waxed: nbt.byte(0) }),
    }));
  }
  return out;
}

export async function exportSchem(world: World, name: string, dataVersion: number): Promise<Blob> {
  return new Blob([(await gzip(writeNbt(schemTag(world, name, dataVersion)))) as BlobPart], { type: 'application/octet-stream' });
}

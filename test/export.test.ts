import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { World } from '../src/world/world';
import { exportSchem } from '../src/io/schem';
import { materials, stacks } from '../src/io/materials';

// Independent NBT reader so the writer is checked against the format, not against itself.
function readNbt(buf: Uint8Array): any {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 0;
  const str = () => { const n = v.getUint16(o); o += 2; const s = new TextDecoder().decode(buf.subarray(o, o + n)); o += n; return s; };
  const read = (t: number): any => {
    switch (t) {
      case 1: return v.getInt8(o++);
      case 2: { const x = v.getUint16(o); o += 2; return x; }
      case 3: { const x = v.getInt32(o); o += 4; return x; }
      case 4: { const x = v.getBigInt64(o); o += 8; return x; }
      case 7: { const n = v.getInt32(o); o += 4; const b = buf.slice(o, o + n); o += n; return b; }
      case 8: return str();
      case 9: { const et = v.getUint8(o++); const n = v.getInt32(o); o += 4; return Array.from({ length: n }, () => read(et)); }
      case 10: { const c: any = {}; for (let tt; (tt = v.getUint8(o++)) !== 0; ) { const k = str(); c[k] = read(tt); } return c; }
      case 11: { const n = v.getInt32(o); o += 4; return Array.from({ length: n }, () => { const x = v.getInt32(o); o += 4; return x; }); }
    }
    throw new Error(`tag ${t}`);
  };
  expect(v.getUint8(o++)).toBe(10);
  expect(str()).toBe('');
  return read(10);
}

function unvarint(b: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.length; ) {
    let v = 0, shift = 0, byte;
    do { byte = b[i++]; v |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
    out.push(v);
  }
  return out;
}

describe('schem export', () => {
  it('writes Sponge v3 that decodes back to the same blocks', async () => {
    const w = new World();
    const set = (x: number, y: number, z: number, s: string) => w.apply([{ x, y, z, id: w.idOf(s) }]);
    set(-2, 5, 3, 'minecraft:stone');
    set(0, 5, 3, 'minecraft:oak_stairs[facing=east,half=bottom,shape=straight]');
    set(-2, 6, 4, 'minecraft:glass');
    // >127 palette entries to exercise multi-byte varints
    for (let i = 0; i < 140; i++) set(-1, 5, 3, `minecraft:light[level=${i % 16}]`), set(i - 2, 7, 3, `minecraft:test_${i}`);

    const blob = await exportSchem(w, 'demo', 5023);
    const root = readNbt(gunzipSync(new Uint8Array(await blob.arrayBuffer())));
    const s = root.Schematic;
    expect([s.Version, s.DataVersion, s.Width, s.Height, s.Length]).toEqual([3, 5023, 140, 3, 2]);
    expect(s.Metadata.Name).toBe('demo');

    const byId = Object.fromEntries(Object.entries<number>(s.Blocks.Palette).map(([k, i]) => [i, k]));
    const data = unvarint(s.Blocks.Data);
    expect(data).toHaveLength(140 * 3 * 2);
    const at = (x: number, y: number, z: number) => byId[data[x + z * s.Width + y * s.Width * s.Length]];
    expect(at(0, 0, 0)).toBe('minecraft:stone');
    expect(at(2, 0, 0)).toBe('minecraft:oak_stairs[facing=east,half=bottom,shape=straight]');
    expect(at(0, 1, 1)).toBe('minecraft:glass');
    expect(at(139, 2, 0)).toBe('minecraft:test_139');
    expect(at(5, 0, 1)).toBe('minecraft:air');
  });

  it('exports sign text as block entities', async () => {
    const w = new World();
    w.apply([{ x: 10, y: 64, z: -5, id: w.idOf('minecraft:stone') }, { x: 11, y: 65, z: -5, id: w.idOf('minecraft:oak_wall_sign[facing=north]') }]);
    w.texts.set('11,65,-5', ['Hello', 'World']);
    w.texts.set('10,64,-5', ['not a sign']);
    const root = readNbt(gunzipSync(new Uint8Array(await (await exportSchem(w, 's', 5023)).arrayBuffer())));
    const bes = root.Schematic.Blocks.BlockEntities;
    expect(bes).toHaveLength(1);
    expect(bes[0].Pos).toEqual([1, 1, 0]);
    expect(bes[0].Id).toBe('minecraft:sign');
    expect(bes[0].Data.front_text.messages).toEqual(['Hello', 'World', '', '']);
  });

  it('refuses an empty build', async () => {
    await expect(exportSchem(new World(), 'x', 5023)).rejects.toThrow(/empty/);
  });
});

describe('materials', () => {
  it('counts items, two-cell blocks once, double slabs twice', () => {
    const w = new World();
    const put = (x: number, s: string) => w.apply([{ x, y: 0, z: 0, id: w.idOf(s) }]);
    put(0, 'minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]');
    put(1, 'minecraft:oak_door[facing=north,half=upper,hinge=left,open=false]');
    put(2, 'minecraft:stone_slab[type=double]');
    put(3, 'minecraft:stone_slab[type=bottom]');
    put(4, 'minecraft:wall_torch[facing=east]');
    put(5, 'minecraft:torch');
    const items = materials(w, (n) => (n === 'wall_torch' ? 'torch' : n));
    expect(items).toEqual([['stone_slab', 3], ['torch', 2], ['oak_door', 1]]);
    expect(stacks(200)).toBe('3 stacks + 8');
    expect(stacks(64)).toBe('1 stack');
    expect(stacks(5)).toBe('5');
  });
});

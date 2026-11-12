import { describe, expect, it } from 'vitest';
import { World, History } from '../src/world/world';
import { serialize, deserialize } from '../src/io/buildFile';

describe('World', () => {
  it('sets and gets across negative chunk coords', () => {
    const w = new World();
    const id = w.idOf('minecraft:stone');
    w.apply([{ x: -1, y: -17, z: 33, id }]);
    expect(w.get(-1, -17, 33)).toBe(id);
    expect(w.get(0, -17, 33)).toBe(0);
  });

  it('drops empty chunks and reports neighbour chunks dirty', () => {
    const w = new World();
    let dirty = new Set<string>();
    w.onChange = (k) => (dirty = k);
    w.apply([{ x: 15, y: 0, z: 0, id: w.idOf('minecraft:stone') }]);
    expect(dirty.has('1,0,0')).toBe(true);
    w.apply([{ x: 15, y: 0, z: 0, id: 0 }]);
    expect(w.chunks.size).toBe(0);
  });

  it('undo/redo restores state', () => {
    const w = new World();
    const h = new History(w);
    const a = w.idOf('minecraft:stone'), b = w.idOf('minecraft:dirt');
    h.do([{ x: 1, y: 2, z: 3, id: a }]);
    h.do([{ x: 1, y: 2, z: 3, id: b }, { x: 0, y: 0, z: 0, id: a }]);
    h.undo();
    expect(w.get(1, 2, 3)).toBe(a);
    expect(w.get(0, 0, 0)).toBe(0);
    h.redo();
    expect(w.get(1, 2, 3)).toBe(b);
    expect(w.get(0, 0, 0)).toBe(a);
  });
});

describe('build file', () => {
  it('round-trips', () => {
    const w = new World();
    w.idOf('minecraft:unused');
    const s = w.idOf('minecraft:oak_stairs[facing=north]');
    w.apply([{ x: -5, y: 3, z: 100, id: s }, { x: 0, y: 0, z: 0, id: w.idOf('minecraft:stone') }]);
    const file = JSON.parse(JSON.stringify(serialize(w, 'test')));
    expect(file.palette).not.toContain('minecraft:unused');
    const w2 = new World();
    expect(deserialize(file, w2).name).toBe('test');
    expect(w2.getState(-5, 3, 100)).toBe('minecraft:oak_stairs[facing=north]');
    expect(w2.getState(0, 0, 0)).toBe('minecraft:stone');
    expect([...w2.blocks()].length).toBe(2);
  });

  it('keeps sign text and validates it', () => {
    const w = new World();
    w.apply([{ x: 1, y: 2, z: 3, id: w.idOf('minecraft:oak_sign[rotation=0]') }]);
    w.texts.set('1,2,3', ['a', 'b', '', '']);
    const file = JSON.parse(JSON.stringify(serialize(w, 't')));
    const w2 = new World();
    deserialize(file, w2);
    expect(w2.texts.get('1,2,3')).toEqual(['a', 'b', '', '']);
    file.texts['1,2,3'] = ['x'.repeat(91)];
    expect(() => deserialize(file, new World())).toThrow(/sign text/);
  });

  it('rejects corrupt input', () => {
    const w = new World();
    expect(() => deserialize({ format: 'nope' }, w)).toThrow();
    expect(() => deserialize({ format: 'mc-build-visualizer', version: 1, name: 'x', palette: ['minecraft:air'], chunks: { '0,0,0': [10, 5] } }, w)).toThrow();
  });
});

describe('baked geometry (v2)', () => {
  const quad = { pos: [0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0], uv: [0, 0, 16, 0, 16, 16, 0, 16], sprite: 'block/stone', color: [0.8, 0.8, 0.8] as [number, number, number], forceTranslucent: false, cull: 'north' as const };
  const fakeModels = { portable: () => [quad, { ...quad, sprite: null, cull: null }], spriteColor: () => [0.5, 0.25, 1] } as any;

  it('round-trips quads and sprite colors', () => {
    const w = new World();
    w.apply([{ x: 0, y: 0, z: 0, id: w.idOf('minecraft:stone') }, { x: 1, y: 0, z: 0, id: w.idOf('minecraft:water[level=0]') }]);
    const file = JSON.parse(JSON.stringify(serialize(w, 'b', fakeModels)));
    const { baked } = deserialize(file, new World());
    expect([...baked!.states.keys()]).toEqual(['minecraft:stone']); // fluids are not baked
    expect(baked!.states.get('minecraft:stone')).toEqual([quad, { ...quad, sprite: null, cull: null }]);
    const c = baked!.spriteColors.get('block/stone')!;
    expect(c.map((v) => Math.round(v * 255))).toEqual([128, 64, 255]);
  });

  it('rejects malformed baked data', () => {
    const w = new World();
    w.apply([{ x: 0, y: 0, z: 0, id: w.idOf('minecraft:stone') }]);
    const file = JSON.parse(JSON.stringify(serialize(w, 'b', fakeModels)));
    const bad = (mut: (f: any) => void) => { const f = structuredClone(file); mut(f); return () => deserialize(f, new World()); };
    expect(bad((f) => (f.baked.states['1'][0][20] = 99))).toThrow();
    expect(bad((f) => f.baked.states['1'][0].pop())).toThrow();
    expect(bad((f) => (f.baked.sprites[0][0] = '<script>'))).toThrow();
    expect(bad((f) => (f.baked.states['7'] = []))).toThrow();
  });
});

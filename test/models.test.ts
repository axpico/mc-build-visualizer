import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { bake, DIRS, Dir, parseState, Quad, RawAssets, selectParts, defaultProps, blockProps } from '../src/assets/models';
import { coveredFace } from '../src/render/blockModels';
import { loadAssets } from '../src/assets/pack';

// Hand-written fixtures (no Mojang data in the repo).
const raw: RawAssets = {
  models: new Map<string, any>([
    ['block/cube', {
      elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: Object.fromEntries((Object.keys(DIRS) as Dir[]).map((d) => [d, { texture: `#${d}`, cullface: d }])) }],
    }],
    ['block/cube_all', { parent: 'block/cube', textures: { down: '#all', up: '#all', north: '#all', south: '#all', west: '#all', east: '#all' } }],
    ['block/stone', { parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/stone' } }],
    ['block/glassy', { parent: 'block/cube_all', textures: { all: { sprite: 'minecraft:block/glass', force_translucent: true } } }],
    ['block/half', {
      textures: { t: 'block/half' },
      elements: [{ from: [0, 0, 0], to: [16, 8, 8], faces: { north: { texture: '#t', cullface: 'north' }, up: { texture: '#t' } } }],
    }],
  ]),
  blockstates: new Map<string, any>([
    ['stone', { variants: { '': { model: 'minecraft:block/stone' } } }],
    ['half', { variants: { 'facing=north': { model: 'block/half' }, 'facing=east': { model: 'block/half', y: 90, uvlock: true }, 'facing=down': { model: 'block/half', x: 90 } } }],
    ['fence', { multipart: [{ apply: { model: 'block/stone' } }, { when: { north: 'true' }, apply: { model: 'block/half' } }, { when: { OR: [{ east: 'true' }, { west: 'true|x' }] }, apply: { model: 'block/glassy' } }] }],
  ]),
};

const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const corner = (q: Quad, i: number) => q.pos.slice(i * 3, i * 3 + 3);
/** Normal of the first triangle as the mesher emits it (0, 2, 1). */
const windingNormal = (q: Quad) => cross(sub(corner(q, 2), corner(q, 0)), sub(corner(q, 1), corner(q, 0)));
const center = (q: Quad) => [0, 1, 2].map((a) => (q.pos[a] + q.pos[3 + a] + q.pos[6 + a] + q.pos[9 + a]) / 4);

describe('model resolver', () => {
  it('parses blockstate strings', () => {
    expect(parseState('minecraft:oak_stairs[facing=north,half=top]')).toEqual({ name: 'oak_stairs', props: { facing: 'north', half: 'top' } });
    expect(parseState('stone')).toEqual({ name: 'stone', props: {} });
  });

  it('follows parents and texture variables', () => {
    const q = bake(raw, selectParts(raw, 'stone', {}));
    expect(q).toHaveLength(6);
    expect(new Set(q.map((x) => x.sprite))).toEqual(new Set(['block/stone']));
  });

  it('winds every cube face counter-clockwise from outside', () => {
    for (const q of bake(raw, selectParts(raw, 'stone', {}))) {
      const n = windingNormal(q), c = sub(center(q), [0.5, 0.5, 0.5]);
      expect(n[0] * c[0] + n[1] * c[1] + n[2] * c[2]).toBeGreaterThan(0);
    }
  });

  it('applies variant y rotation to geometry and cullface', () => {
    const [north] = bake(raw, selectParts(raw, 'half', { facing: 'north' })).filter((q) => q.cull);
    const [east] = bake(raw, selectParts(raw, 'half', { facing: 'east' })).filter((q) => q.cull);
    expect(north.cull).toBe('north');
    expect(east.cull).toBe('east');
    expect(east.pos.filter((_, i) => i % 3 === 0).every((x) => Math.abs(x - 1) < 1e-9)).toBe(true);
  });

  it('applies variant x rotation (x=90 turns north to down)', () => {
    const [q] = bake(raw, selectParts(raw, 'half', { facing: 'down' })).filter((q) => q.cull);
    expect(q.cull).toBe('down');
  });

  it('keeps uvlocked UVs aligned to the world', () => {
    const up = bake(raw, selectParts(raw, 'half', { facing: 'east' })).find((q) => !q.cull)!;
    // top face of a half-depth slab rotated to east covers x 8..16, z 0..16 → u 8..16, v 0..16
    expect(Math.min(...up.uv.filter((_, i) => i % 2 === 0))).toBeCloseTo(8);
    expect(Math.max(...up.uv.filter((_, i) => i % 2 === 1))).toBeCloseTo(16);
  });

  it('evaluates multipart when / OR / | conditions and texture objects', () => {
    expect(bake(raw, selectParts(raw, 'fence', {}))).toHaveLength(6);
    expect(bake(raw, selectParts(raw, 'fence', { north: 'true' }))).toHaveLength(8);
    const q = bake(raw, selectParts(raw, 'fence', { west: 'x' }));
    expect(q.filter((x) => x.forceTranslucent && x.sprite === 'block/glass')).toHaveLength(6);
  });

  it('detects full faces for culling', () => {
    const faces = bake(raw, selectParts(raw, 'stone', {})).map((q) => coveredFace(q.pos));
    expect(new Set(faces)).toEqual(new Set(Object.keys(DIRS)));
    expect(bake(raw, selectParts(raw, 'half', { facing: 'north' })).map((q) => coveredFace(q.pos))).toEqual([null, null]);
  });
});

// Runs against the user's real client jar when present (not in CI): every blockstate must bake cleanly.
const JAR = `${homedir()}/.local/share/PrismLauncher/libraries/com/mojang/minecraft/26.3/minecraft-26.3-client.jar`;
describe.skipIf(!existsSync(JAR))('vanilla jar', () => {
  it('bakes every block default state with known sprites', async () => {
    const assets = await loadAssets([new Blob([readFileSync(JAR)])]);
    const missing = new Set<string>();
    let quads = 0;
    for (const name of assets.blockstates.keys()) {
      const props = defaultProps(assets, name);
      for (const q of bake(assets, selectParts(assets, name, props))) {
        quads++;
        if (!assets.textures.has(q.sprite)) missing.add(q.sprite);
        expect(q.pos.every(Number.isFinite)).toBe(true);
      }
    }
    expect(quads).toBeGreaterThan(5000);
    expect([...missing]).toEqual([]);
  }, 60_000);
});

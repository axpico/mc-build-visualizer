import { corners, Dir, SHADE, Vec3 } from '../assets/models';
import type { PQuad, RGB } from '../render/blockModels';

// Blocks drawn by a block entity renderer in-game (no JSON elements): hand-made boxes using the
// entity texture layout of Java model parts. Geometry is in block pixels (0..16), front facing north.

interface Tex { sprite: string; w: number; h: number }
const tex = (sprite: string, w = 64, h = 64): Tex => ({ sprite: `entity/${sprite}`, w, h });

/**
 * Box with the standard entity UV unwrap at texture offset (u, v) for a w×h×d part:
 * top row [top][bottom], side row [east][front][west][back] (front = north here).
 * `uvSize` lets a box use a part's UVs while being drawn shorter, avoiding z-fighting overlaps.
 */
function box(t: Tex, from: Vec3, to: Vec3, u: number, v: number, uvSize?: Vec3, tint: RGB = [1, 1, 1], faces?: Dir[]): PQuad[] {
  const [w, h, d] = uvSize ?? [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const rect: Record<Dir, number[]> = {
    up: [u + d, v, u + d + w, v + d],
    down: [u + d + w, v, u + d + 2 * w, v + d],
    east: [u, v + d, u + d, v + d + h],
    north: [u + d, v + d, u + d + w, v + d + h],
    west: [u + d + w, v + d, u + 2 * d + w, v + d + h],
    south: [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h],
  };
  return (faces ?? (Object.keys(rect) as Dir[])).map((dir) => {
    const [u1, v1, u2, v2] = rect[dir].map((p, i) => (p * 16) / (i % 2 ? t.h : t.w));
    // the top image's lower edge borders the front, so it is turned 180° relative to our corner order
    const uv = dir === 'up' ? [u2, v2, u1, v2, u1, v1, u2, v1] : [u1, v1, u2, v1, u2, v2, u1, v2];
    return {
      pos: corners(dir, from, to).flatMap((p) => p.map((c) => c / 16)),
      uv,
      sprite: t.sprite,
      color: tint.map((c) => c * SHADE[dir]) as RGB,
      forceTranslucent: false,
      cull: null,
    };
  });
}

/** Rotate quads about the block center: x then y degrees, clockwise like blockstate rotations. */
export function rotate(quads: PQuad[], xDeg: number, yDeg: number, pivot: Vec3 = [0.5, 0.5, 0.5]): PQuad[] {
  if (!xDeg && !yDeg) return quads;
  const ax = (-xDeg * Math.PI) / 180, ay = (-yDeg * Math.PI) / 180;
  const rot = ([x, y, z]: number[]) => {
    [x, y, z] = [x - pivot[0], y - pivot[1], z - pivot[2]];
    [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
    [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
    return [x + pivot[0], y + pivot[1], z + pivot[2]];
  };
  return quads.map((q) => ({ ...q, pos: [0, 1, 2, 3].flatMap((i) => rot(q.pos.slice(i * 3, i * 3 + 3))) }));
}

const FACING_Y: Record<string, number> = { north: 0, east: 90, south: 180, west: 270 };
/** Standing heads/banners: rotation 0 faces south, each step 22.5° clockwise. */
const rot16 = (r: string | undefined) => 180 + Number(r ?? 0) * 22.5;

export const DYE: Record<string, number> = {
  white: 0xf9fffe, orange: 0xf9801d, magenta: 0xc74ebd, light_blue: 0x3ab3da, yellow: 0xfed83d, lime: 0x80c71f,
  pink: 0xf38baa, gray: 0x474f52, light_gray: 0x9d9d97, cyan: 0x169c9c, purple: 0x8932b8, blue: 0x3c44aa,
  brown: 0x835432, green: 0x5e7c16, red: 0xb02e26, black: 0x1d1d21,
};
const rgb = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

function chest(t: Tex, type: string | undefined, facing: string): PQuad[] {
  // double chests: each half is 15 wide and uses its own _left/_right texture
  const half = type === 'left' || type === 'right';
  const x0 = type === 'left' ? 0 : 1, x1 = type === 'right' ? 16 : 15;
  const w = x1 - x0;
  const lock = type === 'left' ? [0, 1] : type === 'right' ? [15, 16] : [7, 9];
  return rotate([
    ...box(t, [x0, 0, 1], [x1, 9, 15], 0, 19, [w, 10, 14]),
    ...box(t, [x0, 9, 1], [x1, 14, 15], 0, 0),
    ...box(t, [lock[0], 7, 0], [lock[1], 11, 1], 0, 0, [half ? 1 : 2, 4, 1]),
  ], 0, FACING_Y[facing] ?? 0);
}

const CHEST_TEX: [RegExp, string][] = [
  [/^trapped_chest$/, 'trapped'], [/^chest$/, 'normal'], [/^ender_chest$/, 'ender'],
  [/^(waxed_)?copper_chest$/, 'copper'], [/^(waxed_)?exposed_copper_chest$/, 'copper_exposed'],
  [/^(waxed_)?weathered_copper_chest$/, 'copper_weathered'], [/^(waxed_)?oxidized_copper_chest$/, 'copper_oxidized'],
];

const HEADS: Record<string, { t: Tex; u: number; v: number; size: Vec3 }> = {
  skeleton: { t: tex('skeleton/skeleton', 64, 32), u: 0, v: 0, size: [8, 8, 8] },
  wither_skeleton: { t: tex('skeleton/wither_skeleton', 64, 32), u: 0, v: 0, size: [8, 8, 8] },
  zombie: { t: tex('zombie/zombie'), u: 0, v: 0, size: [8, 8, 8] },
  creeper: { t: tex('creeper/creeper', 64, 32), u: 0, v: 0, size: [8, 8, 8] },
  player: { t: tex('player/wide/steve'), u: 0, v: 0, size: [8, 8, 8] },
  piglin: { t: tex('piglin/piglin'), u: 0, v: 0, size: [10, 8, 8] },
  // shortcut: the dragon head is a plain textured box, not the jaw/horn model
  dragon: { t: tex('enderdragon/dragon', 256, 256), u: 176, v: 44, size: [16, 16, 16] },
};

/** Every entity texture these models may use (loaded into the atlas). */
export const BLOCK_ENTITY_SPRITES = [
  ...['normal', 'normal_left', 'normal_right', 'trapped', 'trapped_left', 'trapped_right', 'ender',
    ...['copper', 'copper_exposed', 'copper_weathered', 'copper_oxidized'].flatMap((c) => [c, `${c}_left`, `${c}_right`])].map((n) => `entity/chest/${n}`),
  'entity/shulker/shulker', ...Object.keys(DYE).map((c) => `entity/shulker/shulker_${c}`),
  'entity/banner/base', 'entity/banner/banner_base',
  ...Object.values(HEADS).map((h) => h.t.sprite),
  'entity/conduit/base', 'entity/decorated_pot/decorated_pot_base', 'entity/decorated_pot/decorated_pot_side',
  ...['', '_exposed', '_weathered', '_oxidized'].map((s) => `entity/copper_golem/copper_golem${s}`),
];

/** Hand-made geometry for blocks whose look comes from a block entity renderer; null for normal blocks. */
export function blockEntityQuads(name: string, props: Record<string, string>, hasTexture: (sprite: string) => boolean): PQuad[] | null {
  const quads = build(name, props);
  if (!quads) return null;
  const solid = !/banner|end_portal/.test(name);
  return quads.map((q) => ({
    ...q,
    // a texture missing from the jar/pack (e.g. resource pack without entities) falls back to untextured
    sprite: q.sprite && hasTexture(q.sprite) ? q.sprite : null,
    // a bottom face on the floor marks the model as solid (collision) and hides on top of full blocks
    cull: solid && [1, 4, 7, 10].every((i) => Math.abs(q.pos[i]) < 1e-6) ? 'down' : q.cull,
  }));
}

function build(name: string, p: Record<string, string>): PQuad[] | null {
  const chestTex = CHEST_TEX.find(([re]) => re.test(name))?.[1];
  if (chestTex) {
    const half = name === 'ender_chest' ? undefined : p.type;
    const suffix = half === 'left' || half === 'right' ? `_${half}` : '';
    return chest(tex(`chest/${chestTex}${suffix}`), half, p.facing ?? 'north');
  }

  const shulker = /^(?:(\w+)_)?shulker_box$/.exec(name);
  if (shulker) {
    const t = tex(shulker[1] ? `shulker/shulker_${shulker[1]}` : 'shulker/shulker');
    const f = p.facing ?? 'up';
    const [x, y] = f === 'up' ? [0, 0] : f === 'down' ? [180, 0] : [90, FACING_Y[f]];
    return rotate([...box(t, [0, 0, 0], [16, 8, 16], 0, 28), ...box(t, [0, 8, 0], [16, 16, 16], 0, 0, [16, 12, 16])], x, y);
  }

  const banner = /^(\w+?)_(wall_)?banner$/.exec(name);
  if (banner && DYE[banner[1]]) {
    const flag = tex('banner/base'), wood = tex('banner/banner_base');
    const tint = rgb(DYE[banner[1]]);
    if (banner[2]) // wall banner hangs from a bar on the wall behind it (south side when facing north)
      return rotate([...box(wood, [-2, 14, 14], [18, 16, 16], 0, 42), ...box(flag, [-2, -26, 13], [18, 14, 14], 0, 0, [20, 40, 1], tint)], 0, FACING_Y[p.facing] ?? 0);
    return rotate([
      ...box(wood, [7, 0, 7], [9, 42, 9], 44, 0),
      ...box(wood, [-2, 42, 7], [18, 44, 9], 0, 42),
      ...box(flag, [-2, 2, 6], [18, 42, 7], 0, 0, [20, 40, 1], tint),
    ], 0, rot16(p.rotation));
  }

  const head = /^(\w+?)_(wall_)?(head|skull)$/.exec(name);
  if (head && HEADS[head[1]]) {
    const h = HEADS[head[1]];
    const [w, hh, d] = h.size.map((s) => Math.min(s, 16));
    const x0 = 8 - w / 2;
    if (head[2]) // wall heads sit against the wall behind them, raised 4px
      return rotate(box(h.t, [x0, 4, 16 - d], [x0 + w, 4 + hh, 16], h.u, h.v, h.size), 0, FACING_Y[p.facing] ?? 0);
    return rotate(box(h.t, [x0, 0, 8 - d / 2], [x0 + w, hh, 8 + d / 2], h.u, h.v, h.size), 0, rot16(p.rotation));
  }

  if (name === 'conduit') return box(tex('conduit/base', 32, 16), [5, 5, 5], [11, 11, 11], 0, 0);

  if (name === 'decorated_pot') {
    const base = tex('decorated_pot/decorated_pot_base', 32, 32), side = tex('decorated_pot/decorated_pot_side', 16, 16);
    // shortcut: plain sides (no sherd patterns) and a simple neck
    const sides = box(side, [1, 0, 1], [15, 16, 15], 0, 0, [14, 16, 14], undefined, ['north', 'east', 'south', 'west'])
      .map((q) => ({ ...q, uv: [0, 0, 16, 0, 16, 16, 0, 16] }));
    return rotate([...sides, ...box(base, [1, 0, 1], [15, 16, 15], 0, 13, [14, 16, 14], undefined, ['up', 'down']),
      ...box(base, [4, 16, 4], [12, 20, 12], 0, 0, [8, 3, 8])], 0, FACING_Y[p.facing] ?? 0);
  }

  const golem = /^(?:waxed_)?(?:(exposed|weathered|oxidized)_)?copper_golem_statue$/.exec(name);
  if (golem) {
    const t = tex(`copper_golem/copper_golem${golem[1] ? `_${golem[1]}` : ''}`);
    // shortcut: standing pose only, body/head/arms/legs boxes from the copper golem texture layout
    return rotate([
      ...box(t, [4, 0, 6], [7, 5, 10], 36, 32, [3, 5, 4]),
      ...box(t, [9, 0, 6], [12, 5, 10], 50, 32, [3, 5, 4]),
      ...box(t, [4, 5, 5], [12, 11, 11], 0, 15, [8, 6, 6]),
      ...box(t, [2, 5, 6], [4, 11, 10], 36, 16, [2, 6, 4]),
      ...box(t, [12, 5, 6], [14, 11, 10], 50, 16, [2, 6, 4]),
      ...box(t, [4, 11, 4], [12, 16, 12], 0, 0, [8, 5, 8]),
    ], 0, FACING_Y[p.facing] ?? 0);
  }

  if (name === 'end_portal' || name === 'end_gateway') {
    // a starfield in-game; drawn as a dark surface here
    const top = name === 'end_portal' ? 12 : 16;
    return box({ sprite: '', w: 16, h: 16 }, [0, 0, 0], [16, top, 16], 0, 0, undefined, [0.06, 0.07, 0.12])
      .map((q) => ({ ...q, sprite: null }));
  }
  return null;
}

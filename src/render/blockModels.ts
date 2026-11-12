import { Atlas, Layer, Sprite } from '../assets/atlas';
import { bake, blockProps, corners, defaultUV, Dir, DIRS, parseState, resolveModel, selectParts, SHADE, Vec3 } from '../assets/models';
import type { LoadedAssets } from '../assets/pack';
import { tintFor } from '../assets/tint';
import { blockColor } from './colors';
import { blockEntityQuads } from '../blockentities';

export type RGB = [number, number, number];

/**
 * Atlas-independent face: what a shared build file stores ("baked geometry"), so a viewer
 * without the Minecraft jar can still draw the exact shapes.
 */
export interface PQuad {
  pos: number[]; // 4 × xyz, block-local 0..1, corners TL, TR, BR, BL seen from outside
  uv: number[]; // 4 × uv in sprite space 0..16
  sprite: string | null; // "block/oak_log"; null = untextured
  color: RGB; // tint × face shade
  forceTranslucent: boolean;
  cull: Dir | null;
}

export interface MeshQuad {
  pos: number[];
  uv: number[]; // atlas space
  color: RGB;
  layer: Layer;
  cull: Dir | null;
}

export interface BlockModel {
  quads: MeshQuad[];
  /** Faces fully covered by opaque geometry: hide the neighbour's face there. */
  full: Set<Dir>;
  /** Faces fully covered by any geometry: hide the same block's face there (glass next to glass). */
  fullAny: Set<Dir>;
  /** Collision AABB in block space [minX, minY, minZ, maxX, maxY, maxZ]; null = walk through. */
  box: number[] | null;
  fluid?: 'water' | 'lava';
  /** Fluid quads used when the same fluid is above (full height). */
  fluidFull?: MeshQuad[];
}

export const ALL_DIRS = Object.keys(DIRS) as Dir[];
const FLUID_SPRITE = { water: 'block/water_still', lava: 'block/lava_still' } as const;

/** Geometry from a shared build file, used when there is no jar. */
export interface Baked { states: Map<string, PQuad[]>; spriteColors: Map<string, RGB> }

export class BlockModels {
  private cache = new Map<string, BlockModel>();
  private pcache = new Map<string, PQuad[]>();
  private resolved = new Map();

  constructor(readonly atlas: Atlas, private assets: LoadedAssets | null, private baked?: Baked) {}

  get(state: string): BlockModel {
    let m = this.cache.get(state);
    if (!m) this.cache.set(state, (m = this.build(state)));
    return m;
  }

  /** Block names (no namespace) from the loaded jar, sorted; null with no jar. */
  blockNames(): string[] | null {
    return this.assets ? [...this.assets.blockstates.keys()].filter((n) => !n.endsWith('air')).sort() : null;
  }

  props(name: string): Record<string, string[]> {
    return this.assets ? blockProps(this.assets, name) : {};
  }

  exists(name: string): boolean {
    return !!this.assets?.blockstates.has(name);
  }

  /** Opaque full cube: fences/panes/walls connect to it. */
  isFull(state: string): boolean {
    return this.get(state).full.size === 6;
  }

  /** Average color of a sprite (for baking into share files). */
  spriteColor(sprite: string): RGB | undefined {
    return this.atlas.sprites.get(sprite)?.avg ?? this.baked?.spriteColors.get(sprite);
  }

  /** Portable faces of a blockstate (not for fluids, which are generated). */
  portable(state: string): PQuad[] {
    let q = this.pcache.get(state);
    if (!q) this.pcache.set(state, (q = this.buildPortable(state)));
    return q;
  }

  private buildPortable(state: string): PQuad[] {
    const shared = !this.assets && this.baked?.states.get(state);
    if (shared) return shared;
    const { name, props } = parseState(state);
    const be = blockEntityQuads(name, props, this.assets ? (s) => this.assets!.textures.has(s) : () => true);
    if (be) return be;
    if (!this.assets) return cubeQuads(null, blockColor(state));

    const parts = selectParts(this.assets, name, props);
    const quads = bake(this.assets, parts, this.resolved);
    if (!quads.length) {
      // blocks with no elements and no hand-made model: a cube of their particle texture
      const particle = parts[0] && resolveModel(this.assets, parts[0].model, this.resolved).textures.particle;
      const sprite = typeof particle === 'string' ? particle.replace(/^minecraft:/, '') : null;
      return sprite && this.assets.textures.has(sprite) ? cubeQuads(sprite, [1, 1, 1]) : cubeQuads(null, blockColor(state));
    }
    return quads.map((q) => ({
      pos: q.pos,
      uv: q.uv,
      sprite: q.sprite,
      color: (q.tint ? hexRgb(tintFor(state, this.atlas.colormaps)) : [1, 1, 1]).map((c) => c * q.shade) as RGB,
      forceTranslucent: q.forceTranslucent,
      cull: q.cull,
    }));
  }

  private build(state: string): BlockModel {
    const { name } = parseState(state);
    if (name === 'water' || name === 'lava') return this.fluid(name, state);
    return withCoverage(this.portable(state).map((q) => this.toMesh(q)));
  }

  private toMesh(q: PQuad): MeshQuad {
    const s = q.sprite ? this.atlas.sprites.get(q.sprite) : undefined;
    // no texture available: flat average color baked into the share file, magenta if unknown
    const flat = q.sprite && !s ? this.baked?.spriteColors.get(q.sprite) ?? [1, 0, 1] : [1, 1, 1];
    const sprite = s ?? this.atlas.white;
    return {
      pos: q.pos,
      uv: mapUV(q.uv, sprite),
      color: q.color.map((c, i) => c * flat[i]) as RGB,
      layer: q.forceTranslucent ? Layer.Translucent : sprite.layer,
      cull: q.cull,
    };
  }

  private fluid(name: 'water' | 'lava', state: string): BlockModel {
    const sprite = this.atlas.sprites.get(FLUID_SPRITE[name]) ?? this.atlas.white;
    const rgb: RGB =
      name === 'water' ? hexRgb(tintFor(state, this.atlas.colormaps)) : sprite === this.atlas.white ? hexRgb(0xd96415) : [1, 1, 1];
    const layer = name === 'water' ? Layer.Translucent : Layer.Opaque;
    const mesh = (h: number) => boxQuads(h, null, rgb).map((q) => ({ ...this.toMesh(q), uv: mapUV(q.uv, sprite), layer }));
    return { quads: mesh(14), fluidFull: mesh(16), full: new Set(), fullAny: new Set(), box: null, fluid: name };
  }
}

function boxQuads(height: number, sprite: string | null, rgb: RGB): PQuad[] {
  const from: Vec3 = [0, 0, 0], to: Vec3 = [16, height, 16];
  return ALL_DIRS.map((d) => {
    const [u1, v1, u2, v2] = defaultUV(d, from, to);
    return {
      pos: corners(d, from, to).flatMap((p) => p.map((v) => v / 16)),
      uv: [u1, v1, u2, v1, u2, v2, u1, v2],
      sprite,
      color: rgb.map((c) => c * SHADE[d]) as RGB,
      forceTranslucent: false,
      // a lowered fluid top must still render under a solid block, so it never culls
      cull: d === 'up' && height < 16 ? null : d,
    };
  });
}

const cubeQuads = (sprite: string | null, rgb: RGB) => boxQuads(16, sprite, rgb);

function mapUV(uv: number[], s: Sprite): number[] {
  return uv.map((v, i) => (i % 2 === 0 ? s.u0 + (v / 16) * (s.u1 - s.u0) : s.v0 + (v / 16) * (s.v1 - s.v0)));
}

export const hexRgb = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

function withCoverage(quads: MeshQuad[]): BlockModel {
  const full = new Set<Dir>(), fullAny = new Set<Dir>();
  for (const q of quads) {
    const d = coveredFace(q.pos);
    if (!d) continue;
    fullAny.add(d);
    if (q.layer === Layer.Opaque) full.add(d);
  }
  return { quads, full, fullAny, box: collisionBox(quads) };
}

/**
 * shortcut: one AABB around all quads, and only for models that touch their cell boundary (have cullfaces);
 * plants, torches and other free-floating models are walk-through. Per-element boxes if stairs feel wrong.
 */
function collisionBox(quads: MeshQuad[]): number[] | null {
  if (!quads.some((q) => q.cull)) return null;
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const q of quads)
    for (let i = 0; i < 12; i++) {
      const a = i % 3;
      box[a] = Math.min(box[a], q.pos[i]);
      box[a + 3] = Math.max(box[a + 3], q.pos[i]);
    }
  return box;
}

/** The block face this quad completely covers, if any. */
export function coveredFace(pos: number[]): Dir | null {
  const eps = 1e-4;
  for (const d of ALL_DIRS) {
    const axis = DIRS[d].findIndex((v) => v !== 0);
    const plane = DIRS[d][axis] > 0 ? 1 : 0;
    if (![0, 1, 2, 3].every((i) => Math.abs(pos[i * 3 + axis] - plane) < eps)) continue;
    const others = [0, 1, 2].filter((a) => a !== axis);
    if (others.every((a) => {
      const vals = [0, 1, 2, 3].map((i) => pos[i * 3 + a]);
      return Math.min(...vals) < eps && Math.max(...vals) > 1 - eps;
    })) return d;
  }
  return null;
}

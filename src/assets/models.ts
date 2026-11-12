// Pure blockstate + block model resolution and baking (no DOM), so it is unit-testable.

export type Dir = 'down' | 'up' | 'north' | 'south' | 'west' | 'east';
export type Vec3 = [number, number, number];
export const DIRS: Record<Dir, Vec3> = {
  down: [0, -1, 0], up: [0, 1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0],
};
export const OPPOSITE: Record<Dir, Dir> = { down: 'up', up: 'down', north: 'south', south: 'north', west: 'east', east: 'west' };

/** Vanilla JSON, keyed without namespace: blockstates "oak_stairs", models "block/oak_stairs". */
export interface RawAssets {
  blockstates: Map<string, any>;
  models: Map<string, any>;
}

export interface Apply { model: string; x?: number; y?: number; uvlock?: boolean }

/** One baked face, in block-local coordinates (0..1) with texture-local UVs (0..16 px). */
export interface Quad {
  pos: number[]; // 4 corners × xyz, order: top-left, top-right, bottom-right, bottom-left (seen from outside)
  uv: number[]; // 4 corners × uv
  sprite: string; // e.g. "block/oak_log"
  forceTranslucent: boolean;
  tint: boolean;
  cull: Dir | null;
  shade: number;
}

const strip = (s: string) => s.replace(/^minecraft:/, '');

export function parseState(state: string): { name: string; props: Record<string, string> } {
  const m = /^(?:minecraft:)?([^[]+)(?:\[(.*)\])?$/.exec(state);
  if (!m) return { name: state, props: {} };
  const props: Record<string, string> = {};
  for (const kv of (m[2] ?? '').split(',')) {
    const [k, v] = kv.split('=');
    if (k && v !== undefined) props[k.trim()] = v.trim();
  }
  return { name: m[1], props };
}

function matchWhen(when: any, props: Record<string, string>): boolean {
  if (!when) return true;
  if (Array.isArray(when.OR)) return when.OR.some((w: any) => matchWhen(w, props));
  if (Array.isArray(when.AND)) return when.AND.every((w: any) => matchWhen(w, props));
  return Object.entries(when).every(([k, v]) => String(v).split('|').includes(props[k] ?? 'false'));
}

/** Pick the model parts for a blockstate. Weighted variant lists use their first entry. */
export function selectParts(raw: RawAssets, name: string, props: Record<string, string>): Apply[] {
  const bs = raw.blockstates.get(name);
  if (!bs) return [];
  const first = (a: any): Apply => (Array.isArray(a) ? a[0] : a);
  if (bs.variants) {
    const entries = Object.entries(bs.variants);
    const hit = entries.find(([key]) =>
      key === '' || key.split(',').every((kv) => { const [k, v] = kv.split('='); return props[k] === v; }),
    );
    // a state with unset props (e.g. "minecraft:oak_stairs") falls back to the first variant
    return [first((hit ?? entries[0])[1])];
  }
  if (Array.isArray(bs.multipart))
    return bs.multipart.filter((p: any) => matchWhen(p.when, props)).flatMap((p: any) => (Array.isArray(p.apply) ? [p.apply[0]] : [p.apply]));
  return [];
}


interface Resolved { textures: Record<string, any>; elements: any[] }

export function resolveModel(raw: RawAssets, name: string, cache = new Map<string, Resolved>()): Resolved {
  name = strip(name);
  const hit = cache.get(name);
  if (hit) return hit;
  const chain: any[] = [];
  for (let n: string | undefined = name; n && chain.length < 32; ) {
    const m = raw.models.get(n);
    if (!m) break;
    chain.push(m);
    n = m.parent ? strip(m.parent) : undefined;
  }
  const textures: Record<string, any> = {};
  for (let i = chain.length - 1; i >= 0; i--) Object.assign(textures, chain[i].textures);
  const elements = chain.find((m) => Array.isArray(m.elements))?.elements ?? [];
  const r = { textures, elements };
  cache.set(name, r);
  return r;
}

function resolveTexture(textures: Record<string, any>, ref: string): { sprite: string; forceTranslucent: boolean } | null {
  for (let i = 0; i < 16 && ref; i++) {
    if (!ref.startsWith('#')) return { sprite: strip(ref), forceTranslucent: false };
    const v = textures[ref.slice(1)];
    if (v && typeof v === 'object') return { sprite: strip(v.sprite), forceTranslucent: !!v.force_translucent };
    ref = v;
  }
  return null;
}

// --- geometry (pixel space 0..16, rotations about a pivot) ---

const RAD = Math.PI / 180;
function rotAxis(p: Vec3, axis: 'x' | 'y' | 'z', deg: number, o: Vec3): Vec3 {
  const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
  const [x, y, z] = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  // right-handed rotation about the positive axis
  const r: Vec3 =
    axis === 'x' ? [x, y * c - z * s, y * s + z * c]
    : axis === 'y' ? [x * c + z * s, y, -x * s + z * c]
    : [x * c - y * s, x * s + y * c, z];
  return [r[0] + o[0], r[1] + o[1], r[2] + o[2]];
}

// Blockstate x/y rotate clockwise when looking along -axis, i.e. negative right-handed angle.
const CENTER: Vec3 = [8, 8, 8];
const variantRot = (p: Vec3, a: Apply) => rotAxis(rotAxis(p, 'x', -(a.x ?? 0), CENTER), 'y', -(a.y ?? 0), CENTER);

function nearestDir(v: Vec3): Dir {
  let best: Dir = 'up', bestDot = -Infinity;
  for (const d of Object.keys(DIRS) as Dir[]) {
    const n = DIRS[d], dot = n[0] * v[0] + n[1] * v[1] + n[2] * v[2];
    if (dot > bestDot) { bestDot = dot; best = d; }
  }
  return best;
}

export function corners(d: Dir, f: Vec3, t: Vec3): Vec3[] {
  const [x1, y1, z1] = f, [x2, y2, z2] = t;
  switch (d) {
    case 'north': return [[x2, y2, z1], [x1, y2, z1], [x1, y1, z1], [x2, y1, z1]];
    case 'south': return [[x1, y2, z2], [x2, y2, z2], [x2, y1, z2], [x1, y1, z2]];
    case 'west': return [[x1, y2, z1], [x1, y2, z2], [x1, y1, z2], [x1, y1, z1]];
    case 'east': return [[x2, y2, z2], [x2, y2, z1], [x2, y1, z1], [x2, y1, z2]];
    case 'up': return [[x1, y2, z1], [x2, y2, z1], [x2, y2, z2], [x1, y2, z2]];
    case 'down': return [[x1, y1, z2], [x2, y1, z2], [x2, y1, z1], [x1, y1, z1]];
  }
}

export function defaultUV(d: Dir, f: Vec3, t: Vec3): [number, number, number, number] {
  const [x1, y1, z1] = f, [x2, y2, z2] = t;
  switch (d) {
    case 'down': return [x1, 16 - z2, x2, 16 - z1];
    case 'up': return [x1, z1, x2, z2];
    case 'north': return [16 - x2, 16 - y2, 16 - x1, 16 - y1];
    case 'south': return [x1, 16 - y2, x2, 16 - y1];
    case 'west': return [z1, 16 - y2, z2, 16 - y1];
    case 'east': return [16 - z2, 16 - y2, 16 - z1, 16 - y1];
  }
}

export const SHADE: Record<Dir, number> = { up: 1, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 };

export function bake(raw: RawAssets, parts: Apply[], cache?: Map<string, Resolved>): Quad[] {
  const quads: Quad[] = [];
  for (const part of parts) {
    const model = resolveModel(raw, part.model, cache);
    for (const el of model.elements) {
      const from = el.from as Vec3, to = el.to as Vec3;
      const r = el.rotation;
      const elRot = (p: Vec3): Vec3 => {
        if (!r) return p;
        const o = (r.origin ?? CENTER) as Vec3;
        if (r.axis) {
          let q = rotAxis(p, r.axis, r.angle ?? 0, o);
          if (r.rescale && r.angle) {
            const k = 1 / Math.cos(Math.abs(r.angle) * RAD);
            q = q.map((v, i) => ('xyz'[i] === r.axis ? v : o[i] + (v - o[i]) * k)) as Vec3;
          }
          return q;
        }
        // shortcut: 26.x free-form {x,y,z} rotation applied in X,Y,Z order; verify order if hanging signs look wrong
        return rotAxis(rotAxis(rotAxis(p, 'x', r.x ?? 0, o), 'y', r.y ?? 0, o), 'z', r.z ?? 0, o);
      };
      for (const [faceName, face] of Object.entries<any>(el.faces ?? {})) {
        const d = faceName as Dir;
        // a face texture is always a variable; vanilla's heavy_core omits the '#'
        const tex = resolveTexture(model.textures, String(face.texture).replace(/^#?/, '#'));
        if (!tex) continue;
        const pts = corners(d, from, to).map((p) => variantRot(elRot(p), part));
        const normal = variantRot(elRot(DIRS[d].map((v, i) => v + CENTER[i]) as Vec3), part).map((v, i) => v - variantRot(elRot(CENTER), part)[i]) as Vec3;
        const finalDir = nearestDir(normal);

        // shortcut: uvlock re-projects UVs from the final axis-aligned bounds (drops face rotation);
        // exact for unrotated elements, which is every vanilla uvlock case
        const uvlock = part.uvlock && (part.x || part.y) && !r;
        let finalPts = pts, uvRect: number[] = face.uv ?? defaultUV(d, from, to), rot = face.rotation ?? 0;
        if (uvlock) {
          const min = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i]))) as Vec3;
          const max = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i]))) as Vec3;
          finalPts = corners(finalDir, min, max);
          uvRect = defaultUV(finalDir, min, max);
          rot = 0;
        }
        const [u1, v1, u2, v2] = uvRect;
        const uvc = [[u1, v1], [u2, v1], [u2, v2], [u1, v2]];
        const k = ((rot / 90) % 4 + 4) % 4;
        const uv = [0, 1, 2, 3].flatMap((i) => uvc[(i - k + 4) % 4]);

        const cull = face.cullface ? nearestDir(variantRot(DIRS[face.cullface as Dir].map((v, i) => v + CENTER[i]) as Vec3, part).map((v, i) => v - CENTER[i]) as Vec3) : null;
        const shadeDir = (el.shade_direction_override as Dir | undefined) ?? finalDir;
        quads.push({
          pos: finalPts.flatMap((p) => p.map((v) => v / 16)),
          uv,
          sprite: tex.sprite,
          forceTranslucent: tex.forceTranslucent,
          tint: face.tintindex !== undefined,
          cull,
          shade: el.shade === false ? 1 : SHADE[shadeDir],
        });
      }
    }
  }
  return quads;
}

const PREFERRED = ['false', 'none', 'straight', 'north_south', 'bottom', 'lower', 'single', 'foot', 'left', 'floor', 'y', 'north', '0', '1'];

/**
 * Property names → possible values, as far as the blockstate file reveals them (only model-relevant props).
 * Multipart booleans/wall heights gain their implicit "off" value first, so values[0] is the default.
 */
export function blockProps(raw: RawAssets, name: string): Record<string, string[]> {
  const bs = raw.blockstates.get(name);
  const out: Record<string, Set<string>> = {};
  const add = (k: string, v: string) => (out[k] ??= new Set()).add(v);
  if (bs?.variants)
    for (const key of Object.keys(bs.variants))
      for (const kv of key.split(',')) {
        const [k, v] = kv.split('=');
        if (k && v !== undefined) add(k, v);
      }
  const walk = (w: any) => {
    if (!w) return;
    for (const [k, v] of Object.entries<any>(w)) {
      if (k === 'OR' || k === 'AND') v.forEach(walk);
      else for (const val of String(v).split('|')) add(k, val);
    }
  };
  if (Array.isArray(bs?.multipart)) {
    bs.multipart.forEach((p: any) => walk(p.when));
    for (const vals of Object.values(out)) {
      if (vals.has('true') && !vals.has('false')) vals.add('false');
      if ((vals.has('low') || vals.has('tall')) && !vals.has('none')) vals.add('none');
    }
  }
  // the first variant key is arbitrary (stairs start at inner_left), so prefer the in-game default
  return Object.fromEntries(Object.entries(out).map(([k, s]) => {
    const vals = [...s];
    const d = PREFERRED.find((v) => s.has(v));
    return [k, d ? [d, ...vals.filter((v) => v !== d)] : vals];
  }));
}

export const defaultProps = (raw: RawAssets, name: string): Record<string, string> =>
  Object.fromEntries(Object.entries(blockProps(raw, name)).map(([k, v]) => [k, v[0]]));

export const stateString = (name: string, props: Record<string, string>) => {
  const kv = Object.entries(props).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`);
  return `minecraft:${name}${kv.length ? `[${kv.join(',')}]` : ''}`;
};

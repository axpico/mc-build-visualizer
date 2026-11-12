import { Dir, DIRS, OPPOSITE, parseState, stateString, Vec3 } from '../assets/models';

/** What the game knows when you place a block. */
export interface PlaceCtx {
  /** Clicked face: direction from the clicked block to the new cell. */
  face: Dir;
  /** Camera forward vector. */
  look: Vec3;
  /** Hit height within the new cell's Y level (0..1), decides top/bottom halves. */
  hitY: number;
}

export interface BlockInfo {
  props(name: string): Record<string, string[]>;
  exists(name: string): boolean;
  isFull(state: string): boolean;
}

export interface Placement { dx: number; dy: number; dz: number; state: string }

const HORIZONTAL: Dir[] = ['north', 'south', 'west', 'east'];

function nearest(v: Vec3, dirs: Dir[]): Dir {
  let best = dirs[0], bestDot = -Infinity;
  for (const d of dirs) {
    const n = DIRS[d], dot = n[0] * v[0] + n[1] * v[1] + n[2] * v[2];
    if (dot > bestDot) { bestDot = dot; best = d; }
  }
  return best;
}

/** "oak_sign" → "oak_wall_sign", "torch" → "wall_torch", "creeper_head" → "creeper_wall_head". */
export const wallVariant = (name: string) => (name.includes('_') ? name.replace(/_([^_]+)$/, '_wall_$1') : `wall_${name}`);

const ATTACH_FACING = /(^end_rod|lightning_rod|amethyst_bud|amethyst_cluster|shulker_box)$/;
const LOOK_FACING = /(stairs|door|fence_gate|_bed|^bed)$/;
const WALL_ATTACHED = /(wall_|^ladder$|tripwire_hook|_button$|^lever$|grindstone)/;

/**
 * In-game-style blockstate for placing `name`. Returns 1–2 placements (doors, tall plants and beds take two cells).
 * `overrides` are values the user pinned in the property panel; they win over derived values.
 * shortcut: stairs shape and other neighbour-dependent props stay default (except fence/pane/wall connections).
 */
export function derive(info: BlockInfo, name: string, ctx: PlaceCtx, overrides: Record<string, string> = {}): Placement[] {
  const { face, look, hitY } = ctx;
  const horizontalFace = HORIZONTAL.includes(face);
  if (horizontalFace && !overrides.facing && info.exists(wallVariant(name))) name = wallVariant(name);

  const avail = info.props(name);
  const has = (k: string, v?: string) => !!avail[k] && (v === undefined || avail[k].includes(v));
  const p: Record<string, string> = Object.fromEntries(Object.entries(avail).map(([k, v]) => [k, v[0]]));
  const lookH = nearest(look, HORIZONTAL);
  const look6 = nearest(look, Object.keys(DIRS) as Dir[]);
  const upperHalf = face === 'down' || (face !== 'up' && hitY > 0.5);

  if (has('facing')) {
    let f: Dir;
    if (has('facing', 'up')) {
      if (ATTACH_FACING.test(name)) f = face;
      else if (name === 'observer') f = look6;
      else f = OPPOSITE[look6]; // pistons, dispensers, barrels: front faces the player
    } else if (has('facing', 'down')) f = face === 'up' ? 'down' : OPPOSITE[face]; // hopper
    else if (name.endsWith('trapdoor')) f = horizontalFace ? face : OPPOSITE[lookH];
    else if (WALL_ATTACHED.test(name)) f = horizontalFace ? face : lookH;
    else if (LOOK_FACING.test(name)) f = lookH;
    else f = OPPOSITE[lookH]; // chests, furnaces...: front faces the player
    if (has('facing', f)) p.facing = f;
  }
  if (has('axis')) p.axis = face === 'up' || face === 'down' ? 'y' : face === 'east' || face === 'west' ? 'x' : 'z';
  if (has('half', 'top')) p.half = name.endsWith('trapdoor') && !horizontalFace ? (face === 'up' ? 'bottom' : 'top') : upperHalf ? 'top' : 'bottom';
  if (has('type', 'top') && has('type', 'bottom')) p.type = upperHalf ? 'top' : 'bottom';
  if (has('face', 'wall')) p.face = face === 'up' ? 'floor' : face === 'down' ? 'ceiling' : 'wall';
  if (has('attachment', 'floor')) p.attachment = face === 'up' ? 'floor' : face === 'down' ? 'ceiling' : 'single_wall';
  if (has('hanging')) p.hanging = String(face === 'down');
  if (has('vertical_direction')) p.vertical_direction = face === 'down' ? 'down' : 'up';
  if (has('rotation')) {
    // Minecraft yaw: 0 = south, 90 = west; signs/banners face the player
    const yaw = (Math.atan2(-look[0], look[2]) * 180) / Math.PI;
    p.rotation = String(Math.floor(((yaw + 180) * 16) / 360 + 0.5) & 15);
  }
  Object.assign(p, overrides);

  const out: Placement[] = [{ dx: 0, dy: 0, dz: 0, state: stateString(name, p) }];
  if (has('half', 'upper') && p.half === 'lower') out.push({ dx: 0, dy: 1, dz: 0, state: stateString(name, { ...p, half: 'upper' }) });
  if (has('part', 'head') && p.part === 'foot' && p.facing) {
    const [dx, dy, dz] = DIRS[p.facing as Dir];
    out.push({ dx, dy, dz, state: stateString(name, { ...p, part: 'head' }) });
  }
  return out;
}

// --- neighbour connections (fences, panes, walls) ---

type Family = 'fence' | 'pane' | 'wall' | null;
function family(name: string): Family {
  if (name.endsWith('_fence')) return 'fence';
  if (name.endsWith('_pane') || name.endsWith('_bars') || name === 'iron_bars') return 'pane';
  if (name.endsWith('_wall') && !name.includes('_wall_')) return 'wall';
  return null;
}

function connects(fam: Family, neighbour: string, info: BlockInfo): boolean {
  if (neighbour === 'minecraft:air') return false;
  const n = parseState(neighbour).name, nf = family(n);
  if (info.isFull(neighbour)) return true;
  if (fam === 'fence') return nf === 'fence' || n.endsWith('fence_gate');
  if (fam === 'pane') return nf === 'pane' || nf === 'wall' || n.endsWith('glass');
  return nf === 'wall' || nf === 'pane' || n.endsWith('fence_gate');
}

/** Recompute a fence/pane/wall's side connections from its neighbours; other blocks pass through unchanged. */
export function connect(state: string, at: (dx: number, dy: number, dz: number) => string, info: BlockInfo): string {
  const { name, props } = parseState(state);
  const fam = family(name);
  if (!fam) return state;
  const sides = Object.fromEntries(HORIZONTAL.map((d) => {
    const [dx, , dz] = DIRS[d];
    return [d, connects(fam, at(dx, 0, dz), info)];
  })) as Record<Dir, boolean>;
  for (const d of HORIZONTAL) props[d] = fam === 'wall' ? (sides[d] ? 'low' : 'none') : String(sides[d]);
  if (fam === 'wall') {
    const ns = sides.north && sides.south, ew = sides.east && sides.west;
    // the post disappears only on a straight run
    props.up = String(!((ns && !sides.east && !sides.west) || (ew && !sides.north && !sides.south)));
  }
  return stateString(name, props);
}

// --- mirroring ---

const SWAP: Record<'x' | 'z', Record<string, string>> = {
  x: { east: 'west', west: 'east' },
  z: { north: 'south', south: 'north' },
};
const FLIP_SIDE: Record<string, string> = { left: 'right', right: 'left', inner_left: 'inner_right', inner_right: 'inner_left', outer_left: 'outer_right', outer_right: 'outer_left' };

/** Blockstate mirrored across a plane perpendicular to `axis` (X mirror flips east/west). */
export function mirrorState(state: string, axis: 'x' | 'z'): string {
  const { name, props } = parseState(state);
  if (!Object.keys(props).length) return state;
  const swap = SWAP[axis];
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    let val = v;
    if (k === 'facing' || k === 'orientation' || k === 'shape' || k === 'attachment')
      val = v.split('_').map((t) => swap[t] ?? t).join('_'); // also handles rails ascending_east, north_east...
    if (k === 'hinge' || (k === 'shape' && name.endsWith('stairs'))) val = FLIP_SIDE[v] ?? v;
    if (k === 'rotation') val = String(((axis === 'x' ? 16 : 24) - Number(v)) % 16);
    out[swap[k] ?? k] = val;
  }
  return stateString(name, out);
}

/** The item a block comes from: "oak_wall_sign" → "oak_sign", "wall_torch" → "torch". */
export function itemName(name: string, exists: (n: string) => boolean): string {
  return [name.replace('_wall_', '_'), name.replace(/^wall_/, '')].find((n) => n !== name && exists(n)) ?? name;
}

// Unbounded voxel world stored as 16³ chunks of palette indices (0 = air).

export const CHUNK = 16;
export const AIR = 'minecraft:air';

export type ChunkKey = string;
export interface Edit { x: number; y: number; z: number; before: number; after: number }

export const chunkKey = (cx: number, cy: number, cz: number): ChunkKey => `${cx},${cy},${cz}`;
const floorDiv = (n: number) => Math.floor(n / CHUNK);
const mod = (n: number) => ((n % CHUNK) + CHUNK) % CHUNK;
const localIndex = (lx: number, ly: number, lz: number) => (ly * CHUNK + lz) * CHUNK + lx;

export class World {
  /** palette[i] is a blockstate string, e.g. "minecraft:oak_stairs[facing=north]". */
  readonly palette: string[] = [AIR];
  private paletteIndex = new Map<string, number>([[AIR, 0]]);
  readonly chunks = new Map<ChunkKey, Uint16Array>();
  /** Sign text per cell ("x,y,z" → 4 front lines). shortcut: not part of undo history. */
  readonly texts = new Map<string, string[]>();
  /** Called with the keys of chunks whose contents changed (incl. neighbours touching the edit). */
  onChange: (keys: Set<ChunkKey>) => void = () => {};

  idOf(state: string): number {
    let id = this.paletteIndex.get(state);
    if (id === undefined) {
      id = this.palette.length;
      if (id > 0xffff) throw new Error('Palette overflow: more than 65535 distinct blockstates');
      this.palette.push(state);
      this.paletteIndex.set(state, id);
    }
    return id;
  }

  get(x: number, y: number, z: number): number {
    const c = this.chunks.get(chunkKey(floorDiv(x), floorDiv(y), floorDiv(z)));
    return c ? c[localIndex(mod(x), mod(y), mod(z))] : 0;
  }

  getState(x: number, y: number, z: number): string {
    return this.palette[this.get(x, y, z)];
  }

  /** Raw set without change notification; returns previous id. */
  private setRaw(x: number, y: number, z: number, id: number): number {
    const key = chunkKey(floorDiv(x), floorDiv(y), floorDiv(z));
    let c = this.chunks.get(key);
    if (!c) {
      if (id === 0) return 0;
      c = new Uint16Array(CHUNK ** 3);
      this.chunks.set(key, c);
    }
    const i = localIndex(mod(x), mod(y), mod(z));
    const prev = c[i];
    c[i] = id;
    if (id === 0 && prev !== 0 && c.every((v) => v === 0)) this.chunks.delete(key);
    return prev;
  }

  /** Apply many sets at once; returns the edits that actually changed something. */
  apply(sets: { x: number; y: number; z: number; id: number }[]): Edit[] {
    const edits: Edit[] = [];
    const dirty = new Set<ChunkKey>();
    for (const s of sets) {
      const before = this.setRaw(s.x, s.y, s.z, s.id);
      if (before === s.id) continue;
      edits.push({ x: s.x, y: s.y, z: s.z, before, after: s.id });
      markDirty(dirty, s.x, s.y, s.z);
    }
    if (dirty.size) this.onChange(dirty);
    return edits;
  }

  clear() {
    const keys = new Set(this.chunks.keys());
    this.chunks.clear();
    this.texts.clear();
    this.palette.length = 1;
    this.paletteIndex = new Map([[AIR, 0]]);
    this.onChange(keys);
  }

  *blocks(): Generator<[number, number, number, number]> {
    for (const [key, c] of this.chunks) {
      const [cx, cy, cz] = key.split(',').map(Number);
      for (let i = 0; i < c.length; i++) {
        if (!c[i]) continue;
        const lx = i % CHUNK, lz = Math.floor(i / CHUNK) % CHUNK, ly = Math.floor(i / CHUNK ** 2);
        yield [cx * CHUNK + lx, cy * CHUNK + ly, cz * CHUNK + lz, c[i]];
      }
    }
  }
}

// Edits on a chunk border also change the neighbour's culled faces.
function markDirty(dirty: Set<ChunkKey>, x: number, y: number, z: number) {
  for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]])
    dirty.add(chunkKey(floorDiv(x + dx), floorDiv(y + dy), floorDiv(z + dz)));
}

export class History {
  private undoStack: Edit[][] = [];
  private redoStack: Edit[][] = [];
  constructor(private world: World, private limit = 500) {}

  /** Apply sets as one undoable step. */
  do(sets: { x: number; y: number; z: number; id: number }[]) {
    const edits = this.world.apply(sets);
    if (!edits.length) return;
    this.undoStack.push(edits);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo() {
    const step = this.undoStack.pop();
    if (!step) return;
    this.world.apply([...step].reverse().map((e) => ({ x: e.x, y: e.y, z: e.z, id: e.before })));
    this.redoStack.push(step);
  }

  redo() {
    const step = this.redoStack.pop();
    if (!step) return;
    this.world.apply(step.map((e) => ({ x: e.x, y: e.y, z: e.z, id: e.after })));
    this.undoStack.push(step);
  }

  reset() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

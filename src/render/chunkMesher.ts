import * as THREE from 'three';
import { CHUNK, World } from '../world/world';
import { DIRS, OPPOSITE } from '../assets/models';
import { BlockModels } from './blockModels';

interface Bucket { pos: number[]; uv: number[]; col: number[]; idx: number[] }

/** Build one geometry per render layer (opaque, cutout, translucent); null where a layer is empty. */
export function buildChunkGeometry(
  world: World, models: BlockModels, cx: number, cy: number, cz: number, maxY = Infinity,
): (THREE.BufferGeometry | null)[] {
  const data = world.chunks.get(`${cx},${cy},${cz}`);
  const buckets: Bucket[] = [0, 1, 2].map(() => ({ pos: [], uv: [], col: [], idx: [] }));
  if (!data) return [null, null, null];
  const ox = cx * CHUNK, oy = cy * CHUNK, oz = cz * CHUNK;
  const at = (x: number, y: number, z: number) => (y > maxY ? 0 : world.get(x, y, z));

  for (let i = 0; i < data.length; i++) {
    const id = data[i];
    if (!id) continue;
    const x = ox + (i % CHUNK), z = oz + (Math.floor(i / CHUNK) % CHUNK), y = oy + Math.floor(i / CHUNK ** 2);
    if (y > maxY) continue;
    const model = models.get(world.palette[id]);
    const quads = model.fluid && model.fluidFull && models.get(world.palette[at(x, y + 1, z)]).fluid === model.fluid ? model.fluidFull : model.quads;

    for (const q of quads) {
      if (q.cull) {
        const [dx, dy, dz] = DIRS[q.cull];
        const nid = at(x + dx, y + dy, z + dz);
        if (nid) {
          const n = models.get(world.palette[nid]);
          const opp = OPPOSITE[q.cull];
          if (n.full.has(opp) || (nid === id && n.fullAny.has(opp)) || (model.fluid && n.fluid === model.fluid)) continue;
        }
      }
      const b = buckets[q.layer];
      const base = b.pos.length / 3;
      for (let v = 0; v < 4; v++) {
        b.pos.push(x + q.pos[v * 3], y + q.pos[v * 3 + 1], z + q.pos[v * 3 + 2]);
        b.col.push(...q.color);
      }
      b.uv.push(...q.uv);
      // corners are TL, TR, BR, BL seen from outside → these triangles wind counter-clockwise
      b.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }

  return buckets.map((b) => {
    if (!b.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    g.setIndex(b.idx);
    g.computeBoundingSphere();
    return g;
  });
}

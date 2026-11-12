import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Body, BoxAt } from '../src/camera/firstPerson';

const FULL = [0, 0, 0, 1, 1, 1], SLAB = [0, 0, 0, 1, 0.5, 1];
const world = (cells: Record<string, number[]>): BoxAt => (x, y, z) => cells[`${x},${y},${z}`] ?? null;
const run = (b: Body, secs: number, wish = new THREE.Vector3(), input = { jump: false, down: false, sprint: false }) => {
  for (let t = 0; t < secs; t += 1 / 60) b.step(1 / 60, wish, input);
};

describe('Body', () => {
  it('falls onto the ground grid and stands on it', () => {
    const b = new Body(world({}));
    b.pos.set(0.5, 5, 0.5);
    run(b, 2);
    expect(b.pos.y).toBeCloseTo(0, 5);
    expect(b.onGround).toBe(true);
  });

  it('is stopped by a wall', () => {
    const b = new Body(world({ '2,0,0': FULL, '2,1,0': FULL }));
    b.pos.set(0.5, 0, 0.5);
    run(b, 2, new THREE.Vector3(1, 0, 0));
    expect(b.pos.x).toBeCloseTo(2 - 0.3, 5);
  });

  it('steps up onto a slab but not a full block', () => {
    const b = new Body(world({ '2,0,0': SLAB, '3,0,0': SLAB }));
    b.pos.set(0.5, 0, 0.5);
    run(b, 0.5, new THREE.Vector3(1, 0, 0)); // ~2.1 blocks: ends on the slabs (x 2..4)
    expect(b.pos.x).toBeGreaterThan(2.2);
    expect(b.pos.y).toBeCloseTo(0.5, 5);
    const wall = new Body(world({ '2,0,0': FULL }));
    wall.pos.set(0.5, 0, 0.5);
    run(wall, 0.5, new THREE.Vector3(1, 0, 0));
    expect(wall.pos.y).toBeCloseTo(0, 5);
  });

  it('jumps about 1.25 blocks', () => {
    const b = new Body(world({}));
    b.pos.set(0.5, 0, 0.5);
    run(b, 0.1);
    let top = 0;
    for (let t = 0; t < 1; t += 1 / 60) {
      b.step(1 / 60, new THREE.Vector3(), { jump: t === 0, down: false, sprint: false });
      top = Math.max(top, b.pos.y);
    }
    expect(top).toBeGreaterThan(1.1);
    expect(top).toBeLessThan(1.5);
  });

  it('flies through the ground grid only when flying', () => {
    const b = new Body(world({}));
    b.flying = true;
    b.pos.set(0.5, 1, 0.5);
    run(b, 0.5, new THREE.Vector3(), { jump: false, down: true, sprint: false });
    expect(b.pos.y).toBeLessThan(0);
  });
});

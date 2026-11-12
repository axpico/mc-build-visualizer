import * as THREE from 'three';

/** Collision box of the block at a cell, in block space, or null for no collision. */
export type BoxAt = (x: number, y: number, z: number) => number[] | null;

// Vanilla-ish numbers (blocks, seconds).
const HALF_W = 0.3, HEIGHT = 1.8, EYE = 1.62, STEP = 0.6;
const GRAVITY = 32, JUMP = 9, WALK = 4.3, SPRINT = 5.6, FLY = 10.9, FLY_SPRINT = 21.8;

/** Survival-style body: AABB physics with step-up, gravity and an optional fly mode. Pure, no DOM. */
export class Body {
  pos = new THREE.Vector3(); // feet
  vel = new THREE.Vector3();
  onGround = false;
  flying = false;

  constructor(private boxAt: BoxAt) {}

  /** wish: desired horizontal move (unit-ish, world space); up/down: fly or jump input. */
  step(dt: number, wish: THREE.Vector3, input: { jump: boolean; down: boolean; sprint: boolean }) {
    dt = Math.min(dt, 0.05); // avoid tunnelling after a frame hitch
    const speed = this.flying ? (input.sprint ? FLY_SPRINT : FLY) : input.sprint ? SPRINT : WALK;
    this.vel.x = wish.x * speed;
    this.vel.z = wish.z * speed;
    if (this.flying) this.vel.y = (Number(input.jump) - Number(input.down)) * FLY;
    else {
      if (input.jump && this.onGround) this.vel.y = JUMP;
      this.vel.y -= GRAVITY * dt;
    }

    const dy = this.vel.y * dt;
    const yMoved = this.move(1, dy);
    this.onGround = !this.flying && dy < 0 && yMoved > dy;
    if (yMoved !== dy) this.vel.y = 0;
    if (this.onGround) this.flying = false;

    for (const axis of [0, 2] as const) {
      const d = (axis === 0 ? this.vel.x : this.vel.z) * dt;
      if (!d || this.move(axis, d) === d) continue;
      // blocked: try stepping up onto a slab/stair (only when grounded, like vanilla)
      if (!this.onGround) continue;
      const saved = this.pos.clone();
      const up = this.move(1, STEP);
      const done = this.move(axis, d);
      if (done !== d) this.pos.copy(saved);
      else this.move(1, -up); // settle back down onto the step
    }
  }

  /** Move along one axis as far as collisions allow; returns the distance actually moved. */
  private move(axis: 0 | 1 | 2, d: number): number {
    const min = [this.pos.x - HALF_W, this.pos.y, this.pos.z - HALF_W];
    const max = [this.pos.x + HALF_W, this.pos.y + HEIGHT, this.pos.z + HALF_W];
    let allowed = d;
    if (d < 0) min[axis] += d;
    else max[axis] += d;
    const eps = 1e-7;
    for (let x = Math.floor(min[0]); x < max[0]; x++)
      for (let y = Math.floor(min[1]); y < max[1]; y++)
        for (let z = Math.floor(min[2]); z < max[2]; z++) {
          // shortcut: the ground grid at y < 0 is solid so you can walk on an empty world; fly to go below
          const b = y < 0 && !this.flying ? [0, 0, 0, 1, 1, 1] : this.boxAt(x, y, z);
          if (!b) continue;
          const bmin = [x + b[0], y + b[1], z + b[2]], bmax = [x + b[3], y + b[4], z + b[5]];
          // only boxes overlapping on the other two axes can block this one
          if ([0, 1, 2].some((a) => a !== axis && (bmax[a] <= min[a] + eps || bmin[a] >= max[a] - eps))) continue;
          const self0 = axis === 0 ? this.pos.x - HALF_W : axis === 1 ? this.pos.y : this.pos.z - HALF_W;
          const self1 = self0 + (axis === 1 ? HEIGHT : 2 * HALF_W);
          if (d > 0 && bmin[axis] >= self1 - eps) allowed = Math.min(allowed, bmin[axis] - self1);
          if (d < 0 && bmax[axis] <= self0 + eps) allowed = Math.max(allowed, bmax[axis] - self0);
        }
    this.pos.setComponent(axis, this.pos.getComponent(axis) + allowed);
    return allowed;
  }
}

/** Lock may be refused (no user gesture, quick re-lock after Esc); the next canvas click retries. */
export const lockPointer = (el: HTMLElement) => void Promise.resolve(el.requestPointerLock()).catch(() => {});

/** Pointer-lock first-person camera driving a Body. */
export class FirstPerson {
  enabled = false;
  readonly body: Body;
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private lastSpace = 0;
  onExit: () => void = () => {};

  constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement, boxAt: BoxAt) {
    this.body = new Body(boxAt);
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== dom && this.enabled) this.exit();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== dom) return;
      this.yaw -= e.movementX * 0.0025;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - e.movementY * 0.0025));
    });
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Space' && !e.repeat) {
        const now = performance.now();
        if (now - this.lastSpace < 300) this.body.flying = !this.body.flying;
        this.lastSpace = now;
      }
      this.keys.add(e.code);
      if (['Space', 'ShiftLeft', 'ControlLeft'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  enter() {
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    this.body.pos.copy(this.camera.position).y -= EYE;
    this.body.vel.set(0, 0, 0);
    this.body.flying = true; // start hovering where the orbit camera was
    this.enabled = true;
    lockPointer(this.dom);
  }

  exit() {
    this.enabled = false;
    this.keys.clear();
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
    this.onExit();
  }

  update(dt: number) {
    if (!this.enabled) return;
    const k = (c: string) => this.keys.has(c);
    const fwd = Number(k('KeyW')) - Number(k('KeyS')), right = Number(k('KeyD')) - Number(k('KeyA'));
    const wish = new THREE.Vector3(
      -Math.sin(this.yaw) * fwd + Math.cos(this.yaw) * right, 0, -Math.cos(this.yaw) * fwd - Math.sin(this.yaw) * right,
    );
    if (wish.lengthSq() > 1) wish.normalize();
    this.body.step(dt, wish, { jump: k('Space'), down: k('ShiftLeft') || k('ShiftRight'), sprint: k('ControlLeft') });
    this.camera.position.copy(this.body.pos).y += EYE;
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}

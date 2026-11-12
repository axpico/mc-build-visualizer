import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ChunkKey, World } from '../world/world';
import { buildChunkGeometry } from './chunkMesher';
import { buildSignMeshes, disposeGroup } from './signText';
import { BlockModels } from './blockModels';
import { whiteAtlas } from '../assets/atlas';
import { Dir, DIRS } from '../assets/models';

export interface Pick {
  /** Block that was hit (undefined when the ground plane was hit). */
  block?: [number, number, number];
  /** Cell where a new block would go. */
  place: [number, number, number];
  /** Clicked face (direction from the hit block towards `place`). */
  face: Dir;
  /** Hit height within the `place` cell's level (0..1), for top/bottom halves. */
  hitY: number;
}

export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  readonly gl: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  private meshes = new Map<ChunkKey, THREE.Mesh[]>();
  /** Opaque, cutout, translucent. Unlit: per-face shade is baked into vertex colors like vanilla. */
  private materials = [
    new THREE.MeshBasicMaterial({ vertexColors: true }),
    new THREE.MeshBasicMaterial({ vertexColors: true, alphaTest: 0.5 }),
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
  ];
  models = new BlockModels(whiteAtlas(), null);
  private ground: THREE.Mesh;
  private highlight: THREE.LineSegments;
  private raycaster = new THREE.Raycaster();
  private boxPreview: THREE.LineSegments;
  private timer = new THREE.Timer();
  /** Blocks above this Y are hidden (layer slice). */
  maxY = Infinity;
  private signs = new THREE.Group();
  /** Per-frame hook (first-person movement). */
  beforeRender: (dt: number) => void = () => {};

  constructor(private container: HTMLElement, private world: World) {
    this.gl = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.gl.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.gl.domElement);
    this.scene.background = new THREE.Color(0x9cc7f2);

    this.camera.position.set(20, 18, 20);
    this.controls = new OrbitControls(this.camera, this.gl.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.mouseButtons.MIDDLE = null; // middle click picks blocks
    // left-drag orbits; a click without drag places (see main.ts)
    this.controls.update();

    const grid = new THREE.GridHelper(64, 64, 0x446688, 0x88aacc);
    grid.position.y = 0.001;
    this.scene.add(grid);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(4096, 4096).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
    this.scene.add(this.ground);

    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
      new THREE.LineBasicMaterial({ color: 0x000000 }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    this.boxPreview = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0xffd400 }),
    );
    this.boxPreview.visible = false;
    this.scene.add(this.boxPreview);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.gl.setAnimationLoop(() => {
      this.timer.update();
      this.beforeRender(this.timer.getDelta());
      if (this.controls.enabled) this.controls.update();
      this.gl.render(this.scene, this.camera);
    });
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.gl.setSize(w, h);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  remesh(keys: Iterable<ChunkKey>) {
    for (const key of keys) {
      for (const old of this.meshes.get(key) ?? []) {
        old.geometry.dispose();
        this.scene.remove(old);
      }
      this.meshes.delete(key);
      const [cx, cy, cz] = key.split(',').map(Number);
      const meshes = buildChunkGeometry(this.world, this.models, cx, cy, cz, this.maxY).flatMap((g, layer) => {
        if (!g) return [];
        const mesh = new THREE.Mesh(g, this.materials[layer]);
        mesh.renderOrder = layer; // translucent after opaque/cutout
        this.scene.add(mesh);
        return [mesh];
      });
      if (meshes.length) this.meshes.set(key, meshes);
    }
    this.updateSigns();
  }

  /** Rebuild sign text planes (few per build, so a full rebuild is cheap). */
  updateSigns() {
    this.scene.remove(this.signs);
    disposeGroup(this.signs);
    this.signs = buildSignMeshes(this.world, this.maxY);
    this.scene.add(this.signs);
  }

  setModels(models: BlockModels) {
    this.models.atlas.texture.dispose();
    this.models = models;
    for (const m of this.materials) {
      m.map = models.atlas.texture;
      m.needsUpdate = true;
    }
    this.remeshAll();
  }

  remeshAll() {
    this.remesh(new Set([...this.meshes.keys(), ...this.world.chunks.keys()]));
  }

  pick(clientX: number, clientY: number, far = Infinity): Pick | null {
    const r = this.gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.far = far;
    const hit = this.raycaster.intersectObjects([...[...this.meshes.values()].flat(), this.ground], false)[0];
    if (!hit || !hit.face) return null;
    if (hit.object === this.ground) {
      const p = hit.point;
      return { place: [Math.floor(p.x), 0, Math.floor(p.z)], face: 'up', hitY: 0 };
    }
    // snap the normal to its dominant axis (cross plants and rotated elements have diagonal normals)
    const n = hit.face.normal.clone();
    const ax = ['x', 'y', 'z'] as const;
    const main = ax.reduce((a, b) => (Math.abs(n[a]) >= Math.abs(n[b]) ? a : b));
    const step = new THREE.Vector3();
    step[main] = Math.sign(n[main]);
    // step just behind the surface so slabs, torches etc. resolve to their own cell
    const b = hit.point.clone().addScaledVector(n, -0.01).floor();
    const outside = hit.point.clone().addScaledVector(step, 0.01).floor();
    // a face inside the cell (bottom slab top) places in the next cell along the normal, like in-game
    const place = outside.equals(b) ? b.clone().add(step) : outside;
    const face = (Object.keys(DIRS) as Dir[]).find((d) => DIRS[d][0] === step.x && DIRS[d][1] === step.y && DIRS[d][2] === step.z)!;
    return { block: [b.x, b.y, b.z], place: [place.x, place.y, place.z], face, hitY: hit.point.y - place.y };
  }

  showHighlight(p: [number, number, number] | undefined) {
    this.highlight.visible = !!p;
    if (p) this.highlight.position.set(p[0] + 0.5, p[1] + 0.5, p[2] + 0.5);
  }

  /** Yellow wireframe around the inclusive cell range a..b; null hides it. */
  showBox(a: [number, number, number] | null, b?: [number, number, number]) {
    this.boxPreview.visible = !!(a && b);
    if (!a || !b) return;
    const min = a.map((v, i) => Math.min(v, b[i])), max = a.map((v, i) => Math.max(v, b[i]) + 1);
    this.boxPreview.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    this.boxPreview.scale.set(max[0] - min[0] + 0.01, max[1] - min[1] + 0.01, max[2] - min[2] + 0.01);
  }

  screenshot(): string {
    this.gl.render(this.scene, this.camera);
    return this.gl.domElement.toDataURL('image/png');
  }
}

import * as THREE from 'three';
import { parseState } from '../assets/models';
import { World } from '../world/world';

// Where the text sits on each sign model (block pixels, sign facing south / rotation 0), from the 26.3 models.
const LAYOUT = {
  standing: { center: [8, 13.33, 8.72], size: [15, 7] },
  wall: { center: [8, 8.33, 1.72], size: [15, 7] },
  hanging: { center: [8, 4.5, 9.05], size: [13, 8] },
};
const FACING_DEG: Record<string, number> = { south: 0, west: 90, north: 180, east: 270 };

function textTexture(lines: string[]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  // shortcut: the system monospace font (not bundled, so no font licensing); a pixel font would look closer to vanilla
  g.font = 'bold 44px monospace';
  g.fillStyle = '#000';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.slice(0, 4).forEach((l, i) => g.fillText(l, 256, 34 + i * 62, 500));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** One textured plane per sign with text, positioned on the sign's front face. */
export function buildSignMeshes(world: World, maxY: number): THREE.Group {
  const group = new THREE.Group();
  for (const [key, lines] of world.texts) {
    if (!lines.some((l) => l)) continue;
    const [x, y, z] = key.split(',').map(Number);
    if (y > maxY) continue;
    const { name, props } = parseState(world.getState(x, y, z));
    if (!name.endsWith('sign')) continue;
    const kind = name.includes('hanging') ? 'hanging' : name.includes('wall_') ? 'wall' : 'standing';
    const deg = props.rotation !== undefined ? Number(props.rotation) * 22.5 : FACING_DEG[props.facing] ?? 0;
    const { center, size } = LAYOUT[kind];

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size[0] / 16, size[1] / 16),
      new THREE.MeshBasicMaterial({ map: textTexture(lines), transparent: true, depthWrite: false }),
    );
    mesh.position.set((center[0] - 8) / 16, center[1] / 16, (center[2] - 8) / 16);
    const pivot = new THREE.Group();
    pivot.position.set(x + 0.5, y, z + 0.5);
    pivot.rotation.y = (-deg * Math.PI) / 180; // clockwise from above, like the sign's rotation
    pivot.add(mesh);
    group.add(pivot);
  }
  return group;
}

export function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const m = o.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      m.dispose();
    }
  });
}

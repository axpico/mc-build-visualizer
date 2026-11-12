import * as THREE from 'three';
import { Colormaps, samplePlains } from './tint';
import { BLOCK_ENTITY_SPRITES } from '../blockentities';

export const enum Layer { Opaque = 0, Cutout = 1, Translucent = 2 }

export interface Sprite {
  u0: number; v0: number; u1: number; v1: number;
  layer: Layer;
  /** Average RGB of visible pixels (0..1): the flat color used when a viewer has no textures. */
  avg: [number, number, number];
}

export interface Atlas {
  texture: THREE.Texture;
  sprites: Map<string, Sprite>;
  white: Sprite;
  colormaps: Colormaps;
}

const DEFAULT_MAPS: Colormaps = { grass: 0x91bd59, foliage: 0x77ab2f };

function makeTexture(canvas: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Atlas with only a white texel, used before any jar is loaded (blocks are vertex-colored). */
export function whiteAtlas(): Atlas {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 1, 1);
  const white: Sprite = { u0: 0, v0: 0, u1: 1, v1: 1, layer: Layer.Opaque, avg: [1, 1, 1] };
  return { texture: makeTexture(c), sprites: new Map(), white, colormaps: DEFAULT_MAPS };
}

/**
 * Pack every block texture (plus the entity textures block entities use) into one atlas with shelf packing.
 * Animated block strips use their first frame.
 * shortcut: single atlas; very high-res packs may exceed GPU texture limits, split into pages if that happens.
 */
export async function buildAtlas(textures: Map<string, Blob>): Promise<Atlas> {
  const wanted = new Set(BLOCK_ENTITY_SPRITES);
  const names = [...textures.keys()].filter((k) => k.startsWith('block/') || wanted.has(k));
  const loaded = await Promise.all(names.map((n) => createImageBitmap(textures.get(n)!).catch(() => null)));
  const items = [{ name: '', bmp: null as ImageBitmap | null, w: 16, h: 16 }]; // white cell for untextured faces
  loaded.forEach((bmp, i) => {
    if (!bmp) return;
    const block = names[i].startsWith('block/');
    items.push({ name: names[i], bmp, w: bmp.width, h: block ? Math.min(bmp.width, bmp.height) : bmp.height });
  });

  // shelf packing: tallest first, fill rows left to right, grow the square until everything fits
  const order = [...items.keys()].sort((a, b) => items[b].h - items[a].h || items[b].w - items[a].w);
  const pos: [number, number][] = [];
  let size = 256;
  const pack = () => {
    let x = 0, y = 0, rowH = 0;
    for (const i of order) {
      const it = items[i];
      if (x + it.w > size) { x = 0; y += rowH; rowH = 0; }
      if (it.w > size || y + it.h > size) return false;
      pos[i] = [x, y];
      x += it.w;
      rowH = Math.max(rowH, it.h);
    }
    return true;
  };
  while (!pack()) size *= 2;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 16, 16);
  items.forEach((it, i) => {
    if (!it.bmp) return;
    g.drawImage(it.bmp, 0, 0, it.w, it.h, pos[i][0], pos[i][1], it.w, it.h);
    it.bmp.close();
  });

  const pixels = g.getImageData(0, 0, size, size).data;
  // Small inset keeps nearest sampling from bleeding into the neighbouring texture.
  const inset = 0.01 / size;
  const sprite = (i: number): Sprite => {
    const [x, y] = pos[i], { w, h } = items[i];
    return { u0: x / size + inset, v0: y / size + inset, u1: (x + w) / size - inset, v1: (y + h) / size - inset, ...scan(pixels, size, x, y, w, h) };
  };
  const sprites = new Map<string, Sprite>();
  items.forEach((it, i) => i > 0 && sprites.set(it.name, sprite(i)));

  return {
    texture: makeTexture(canvas),
    sprites,
    white: sprite(0),
    colormaps: {
      grass: await colormapPixel(textures.get('colormap/grass'), DEFAULT_MAPS.grass),
      foliage: await colormapPixel(textures.get('colormap/foliage'), DEFAULT_MAPS.foliage),
    },
  };
}

// Layer: any semi-transparent pixel → translucent; only fully clear pixels → cutout. Plus the average color.
function scan(px: Uint8ClampedArray, size: number, x0: number, y0: number, w: number, h: number): { layer: Layer; avg: [number, number, number] } {
  let layer = Layer.Opaque, r = 0, g = 0, b = 0, sum = 0;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * size + x) * 4, a = px[i + 3];
      r += px[i] * a; g += px[i + 1] * a; b += px[i + 2] * a; sum += a;
      if (a === 255) continue;
      if (a > 0) layer = Layer.Translucent;
      else if (layer === Layer.Opaque) layer = Layer.Cutout;
    }
  const avg: [number, number, number] = sum ? [r / sum / 255, g / sum / 255, b / sum / 255] : [1, 1, 1];
  return { layer, avg };
}

async function colormapPixel(blob: Blob | undefined, fallback: number): Promise<number> {
  if (!blob) return fallback;
  const b = await createImageBitmap(blob);
  const c = new OffscreenCanvas(b.width, b.height);
  const g = c.getContext('2d')!;
  g.drawImage(b, 0, 0);
  return samplePlains(g.getImageData(0, 0, b.width, b.height) as ImageData);
}

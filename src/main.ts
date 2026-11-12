import { World, History } from './world/world';
import { Renderer } from './render/renderer';
import { serialize, deserialize, MAX_LINE } from './io/buildFile';
import { saveProject, loadProject, listProjects, deleteProject, saveAssetFiles, loadAssetFiles } from './io/store';
import { loadAssets } from './assets/pack';
import { buildAtlas } from './assets/atlas';
import { BlockModels } from './render/blockModels';
import { whiteAtlas } from './assets/atlas';
import * as THREE from 'three';
import type { Pick } from './render/renderer';
import { parseState } from './assets/models';
import { connect, derive, itemName, mirrorState } from './tools/placement';
import { FirstPerson, lockPointer } from './camera/firstPerson';
import { DEFAULT_DATA_VERSION, exportSchem } from './io/schem';
import { materials, stacks } from './io/materials';
import { Palette } from './ui/palette';

// Blocks offered before a jar is loaded (flat colors).
const STARTER_BLOCKS = [
  'stone', 'cobblestone', 'stone_bricks', 'deepslate_bricks', 'bricks', 'dirt', 'grass_block', 'oak_planks',
  'spruce_planks', 'oak_log', 'oak_leaves', 'glass', 'sandstone', 'quartz_block', 'gold_block',
  'white_wool', 'red_wool', 'black_wool', 'water',
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ?build=<url> opens a read-only viewer for a shared build file.
const viewer = new URLSearchParams(location.search).get('build');
if (viewer) document.body.classList.add('viewer');
let assetsLoaded = false;

const world = new World();
const history = new History(world);
const renderer = new Renderer($('viewport'), world);
// dev-only handle for scripted checks (camera placement in headless screenshots)
if (import.meta.env.DEV) Object.assign(window, { __mcbv: { renderer, world } });

let projectId = '';
let projectName = '';
let saveTimer = 0;

world.onChange = (keys) => {
  renderer.remesh(keys);
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(save, 500);
};

async function save() {
  saveTimer = 0;
  if (!projectId) return;
  await saveProject(projectId, serialize(world, projectName));
  await refreshList();
}

const palette = new Palette($('block-search'), $('block-list'), $('prop-panel'), $('hotbar'));
palette.setBlocks(STARTER_BLOCKS, () => ({}));

// --- textures: the user's own client jar (+ optional packs), cached in IndexedDB ---
async function useAssets(files: File[]) {
  const status = $('assets-status');
  status.textContent = 'Loading textures…';
  try {
    // vanilla jar first, packs override it
    const ordered = [...files].sort((a, b) => Number(b.name.endsWith('.jar')) - Number(a.name.endsWith('.jar')));
    const assets = await loadAssets(ordered);
    renderer.setModels(new BlockModels(await buildAtlas(assets.textures), assets));
    const models = renderer.models;
    palette.setBlocks(models.blockNames()!, (n) => models.props(n));
    if (assets.dataVersion) $in('data-version').value = String(assets.dataVersion);
    assetsLoaded = true;
    status.textContent = `Loaded ${ordered.map((f) => f.name).join(', ')} (${assets.blockstates.size} blocks)`;
    return true;
  } catch (err) {
    status.textContent = `Texture load failed: ${(err as Error).message}`;
    return false;
  }
}

$<HTMLInputElement>('load-assets').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  if (files.length && (await useAssets(files))) await saveAssetFiles(files);
};

// --- editing ---
const AIR = 'minecraft:air';
const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

type Change = [number, number, number, string];
const MAX_EDIT = 500_000;
const $in = (id: string) => $<HTMLInputElement>(id);

/** Copies of each change across the enabled mirror planes (plane at a: cell x ↔ 2a − 1 − x). */
function mirrored(changes: Change[]): Change[] {
  let out = changes;
  for (const axis of ['x', 'z'] as const) {
    if (!$in(`mirror-${axis}`).checked) continue;
    const at = Number($in(`mirror-${axis}-at`).value) || 0;
    const i = axis === 'x' ? 0 : 2;
    out = out.concat(out.map((c) => {
      const m = [...c] as Change;
      m[i] = 2 * at - 1 - c[i];
      m[3] = mirrorState(c[3], axis);
      return m;
    }));
  }
  return out;
}

/** Apply cell changes (plus mirror copies) as one undo step, re-connecting fences/panes/walls around them. */
function commit(input: Change[]) {
  const changes = mirrored(input);
  const pending = new Map<string, string>(changes.map(([x, y, z, s]) => [cellKey(x, y, z), s]));
  const get = (x: number, y: number, z: number) => pending.get(cellKey(x, y, z)) ?? world.getState(x, y, z);
  const touched = new Set<string>();
  for (const [x, y, z] of changes)
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) touched.add(cellKey(x + dx, y, z + dz));
  for (const key of touched) {
    const [x, y, z] = key.split(',').map(Number);
    const s = get(x, y, z);
    if (s === AIR) continue;
    const c = connect(s, (dx, dy, dz) => get(x + dx, y + dy, z + dz), renderer.models);
    if (c !== s) pending.set(key, c);
  }
  for (const [key, s] of pending) if (!parseState(s).name.endsWith('sign')) world.texts.delete(key);
  history.do([...pending].map(([key, s]) => {
    const [x, y, z] = key.split(',').map(Number);
    return { x, y, z, id: s === AIR ? 0 : world.idOf(s) };
  }));
}

// --- sign text ---
const signDialog = $<HTMLDialogElement>('sign-dialog');
let signAt: string | null = null;
function editSign(x: number, y: number, z: number) {
  if (viewer || !parseState(world.getState(x, y, z)).name.endsWith('sign')) return;
  signAt = cellKey(x, y, z);
  const lines = world.texts.get(signAt) ?? [];
  signDialog.querySelectorAll('input').forEach((inp, i) => (inp.value = lines[i] ?? ''));
  signDialog.showModal();
  signDialog.querySelector('input')!.focus();
}
signDialog.addEventListener('close', () => {
  if (!signAt || signDialog.returnValue !== 'save') return;
  const lines = [...signDialog.querySelectorAll('input')].map((i) => i.value.slice(0, MAX_LINE));
  if (lines.some((l) => l)) world.texts.set(signAt, lines);
  else world.texts.delete(signAt);
  signAt = null;
  world.onChange(new Set()); // autosave + sign redraw
});

function placeParts(p: Pick) {
  const slot = palette.current();
  if (!slot) return null;
  const look = renderer.camera.getWorldDirection(new THREE.Vector3());
  return derive(renderer.models, slot.name, { face: p.face, look: [look.x, look.y, look.z], hitY: p.hitY }, slot.overrides);
}

function place(p: Pick) {
  const parts = placeParts(p);
  if (!parts) return;
  const [x, y, z] = p.place;
  const cells = parts.map((q) => [x + q.dx, y + q.dy, z + q.dz, q.state] as Change);
  // like in-game: only place into empty space (both cells for doors and beds)
  if (!cells.every(([cx, cy, cz]) => world.get(cx, cy, cz) === 0)) return;
  commit(cells);
  if (parseState(cells[0][3]).name.endsWith('sign')) editSign(x, y, z); // like in-game: placing opens the editor
}

function pickBlock(p: Pick, exact: boolean) {
  if (!p.block) return;
  const { name, props } = parseState(world.getState(...p.block));
  palette.setCurrent({ name: itemName(name, (n) => renderer.models.exists(n)), overrides: exact ? props : {} });
}

// --- box tool: first click sets a corner, second click fills ---
let boxStart: { cell: [number, number, number]; remove: boolean; state: string } | null = null;
const tool = () => $<HTMLSelectElement>('tool').value as 'single' | 'box' | 'hollow';

function boxClick(p: Pick, remove: boolean) {
  const cell = remove ? p.block : p.place;
  if (!cell) return;
  if (!boxStart || boxStart.remove !== remove) {
    const state = remove ? AIR : placeParts(p)?.[0].state; // shortcut: two-cell blocks fill with their first half only
    if (state) boxStart = { cell, remove, state };
    renderer.showBox(cell, cell);
    return;
  }
  const a = boxStart.cell, b = cell, hollow = tool() === 'hollow';
  const min = a.map((v, i) => Math.min(v, b[i])), max = a.map((v, i) => Math.max(v, b[i]));
  const volume = (max[0] - min[0] + 1) * (max[1] - min[1] + 1) * (max[2] - min[2] + 1);
  if (volume > MAX_EDIT) return alert(`Box too big: ${volume} blocks (max ${MAX_EDIT}).`);
  const cells: Change[] = [];
  for (let x = min[0]; x <= max[0]; x++)
    for (let y = min[1]; y <= max[1]; y++)
      for (let z = min[2]; z <= max[2]; z++) {
        const shell = x === min[0] || x === max[0] || y === min[1] || y === max[1] || z === min[2] || z === max[2];
        if (!hollow || shell || remove) cells.push([x, y, z, boxStart.state]);
      }
  boxStart = null;
  renderer.showBox(null);
  commit(cells);
}

function edit(p: Pick, action: 'place' | 'remove' | 'pick', shift: boolean) {
  if (viewer) return;
  if (action === 'pick') return pickBlock(p, shift);
  if (tool() !== 'single') return boxClick(p, action === 'remove');
  if (action === 'place') place(p);
  else if (p.block) commit([[...p.block, AIR]]);
}

// --- first person (F): left = break, right = place, like in-game ---
const fp = new FirstPerson(renderer.camera, renderer.gl.domElement, (x, y, z) => {
  const id = world.get(x, y, z);
  return id && y <= renderer.maxY ? renderer.models.get(world.palette[id]).box : null;
});
renderer.beforeRender = (dt) => fp.update(dt);
fp.onExit = () => {
  document.body.classList.remove('fp');
  const dir = renderer.camera.getWorldDirection(new THREE.Vector3());
  renderer.controls.target.copy(renderer.camera.position).addScaledVector(dir, 8);
  renderer.controls.enabled = true;
};
function toggleFirstPerson() {
  if (fp.enabled) return fp.exit();
  renderer.controls.enabled = false;
  document.body.classList.add('fp');
  fp.enter();
}
$('fp-btn').onclick = toggleFirstPerson;
const REACH = 6;
const centerPick = () => {
  const r = canvas.getBoundingClientRect();
  return renderer.pick(r.left + r.width / 2, r.top + r.height / 2, REACH);
};

// --- input: a click without drag edits; a drag orbits ---
const canvas = renderer.gl.domElement;
let down: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 1) e.preventDefault(); // no autoscroll on middle click
  if (fp.enabled) {
    if (document.pointerLockElement !== canvas) return lockPointer(canvas);
    const p = centerPick();
    if (p) edit(p, e.button === 0 ? 'remove' : e.button === 2 ? 'place' : 'pick', e.shiftKey);
    return;
  }
  down = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', (e) => {
  if (fp.enabled || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
  down = null;
  const p = renderer.pick(e.clientX, e.clientY);
  if (p) edit(p, e.button === 0 ? 'place' : e.button === 2 ? 'remove' : 'pick', e.shiftKey);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  if (fp.enabled) palette.select((palette.selected + Math.sign(e.deltaY) + 9) % 9);
});
let hovered: Pick | null = null;
canvas.addEventListener('pointermove', (e) => {
  const p = fp.enabled ? centerPick() : renderer.pick(e.clientX, e.clientY);
  hovered = p;
  renderer.showHighlight(p?.block);
  if (boxStart && p) renderer.showBox(boxStart.cell, (boxStart.remove ? p.block : p.place) ?? boxStart.cell);
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key >= '1' && e.key <= '9') palette.select(Number(e.key) - 1);
  else if (e.code === 'KeyF') toggleFirstPerson();
  else if (e.code === 'KeyE' && hovered?.block) {
    if (fp.enabled) document.exitPointerLock();
    editSign(...hovered.block);
  }
  else if (e.key === 'Escape' && boxStart) {
    boxStart = null;
    renderer.showBox(null);
  }
});

// --- layer slice ---
const applySlice = () => {
  renderer.maxY = $in('slice-on').checked ? Number($in('slice-y').value) : Infinity;
  renderer.remeshAll();
};
$in('slice-on').onchange = applySlice;
$in('slice-y').oninput = () => $in('slice-on').checked && applySlice();
$<HTMLSelectElement>('tool').onchange = () => {
  boxStart = null;
  renderer.showBox(null);
};

window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) history.undo();
  else if (k === 'y' || (k === 'z' && e.shiftKey)) history.redo();
  else return;
  e.preventDefault();
});

// --- projects ---
async function refreshList() {
  // fetch before touching the DOM: overlapping refreshes would otherwise both append
  const projects = await listProjects();
  const ul = $('project-list');
  ul.replaceChildren();
  for (const p of projects) {
    const li = document.createElement('li');
    li.className = p.id === projectId ? 'active' : '';
    const name = document.createElement('span');
    name.textContent = p.name;
    name.title = 'Click to open, double-click to rename';
    name.onclick = () => openProject(p.id);
    name.ondblclick = () => {
      const n = prompt('Rename build', p.name)?.trim();
      if (n && p.id === projectId) {
        projectName = n;
        save();
      }
    };
    const del = document.createElement('button');
    del.textContent = '×';
    del.title = 'Delete build';
    del.onclick = async () => {
      if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
      await deleteProject(p.id);
      if (p.id === projectId) await newProject();
      else await refreshList();
    };
    li.append(name, del);
    ul.append(li);
  }
}

// Save pending edits of the current project before switching away from it.
async function flush() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = 0;
  await save();
}

async function openProject(id: string) {
  await flush();
  const build = await loadProject(id);
  if (!build) return;
  projectName = deserialize(build, world).name;
  projectId = id;
  history.reset();
  await refreshList();
}

async function newProject() {
  await flush();
  projectId = crypto.randomUUID();
  projectName = `Build ${new Date().toLocaleString()}`;
  world.clear();
  history.reset();
  await save();
}

$('new-project').onclick = () => newProject();

function download(blob: Blob, ext: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${projectName.replace(/[^\w-]+/g, '_')}.${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);
}

$('export-json').onclick = () => download(new Blob([JSON.stringify(serialize(world, projectName))], { type: 'application/json' }), 'json');

$('export-schem').onclick = async () => {
  try {
    download(await exportSchem(world, projectName, Number($in('data-version').value) || DEFAULT_DATA_VERSION), 'schem');
  } catch (err) {
    alert((err as Error).message);
  }
};

$('screenshot-btn').onclick = async () => download(await (await fetch(renderer.screenshot())).blob(), 'png');

$('materials-btn').onclick = () => {
  const rows = materials(world, (n) => itemName(n, (x) => renderer.models.exists(x)));
  const table = $<HTMLTableElement>('materials-table');
  table.replaceChildren();
  for (const [item, n] of rows) {
    const tr = table.insertRow();
    tr.insertCell().textContent = item.replace(/_/g, ' ');
    tr.insertCell().textContent = String(n);
    tr.insertCell().textContent = stacks(n);
  }
  if (!rows.length) table.insertRow().insertCell().textContent = 'The build is empty.';
  $<HTMLDialogElement>('materials-dialog').showModal();
};

$<HTMLInputElement>('import-json').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const prev = projectId;
  try {
    await flush();
    const json = JSON.parse(await file.text());
    projectId = ''; // the clear inside deserialize must not autosave over the current build
    projectName = deserialize(json, world).name;
    projectId = crypto.randomUUID();
    history.reset();
    await save();
  } catch (err) {
    projectId = prev;
    alert(`Import failed: ${(err as Error).message}`);
  }
};

// --- sharing ---
const MAX_SHARE_BYTES = 50 * 1024 * 1024;

async function openShared(url: string) {
  const status = $('viewer-title');
  try {
    const u = new URL(url, location.href);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http(s) links are supported');
    const res = await fetch(u, { credentials: 'omit' });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const text = await res.text();
    if (text.length > MAX_SHARE_BYTES) throw new Error('File too large');
    const { name, baked } = deserialize(JSON.parse(text), world);
    projectName = name;
    status.textContent = name;
    document.title = `${name} – MC Build Visualizer`;
    // no jar: draw the shared shapes in flat colors
    if (!assetsLoaded && baked) renderer.setModels(new BlockModels(whiteAtlas(), null, baked));
  } catch (err) {
    status.textContent = `Could not open shared build: ${(err as Error).message}`;
  }
}

$('save-copy').onclick = async () => {
  projectId = crypto.randomUUID();
  await save();
  location.href = location.pathname; // editor opens the newest build: this copy
};

const shareLink = () => {
  const src = $in('share-src').value.trim();
  $in('share-link').value = src ? `${location.origin}${location.pathname}?build=${encodeURIComponent(src)}` : '';
};
$in('share-src').oninput = shareLink;
$('share-copy').onclick = () => {
  shareLink();
  if ($in('share-link').value) navigator.clipboard?.writeText($in('share-link').value).catch(() => $in('share-link').select());
};
$('share-btn').onclick = () => {
  download(new Blob([JSON.stringify(serialize(world, projectName, renderer.models))], { type: 'application/json' }), 'json');
  $<HTMLDialogElement>('share-dialog').showModal();
};

const cached = await loadAssetFiles();
// Dev server on this PC serves the newest Prism jar (see vite.config.ts); cached packs still overlay it.
const res = import.meta.env.DEV ? await fetch('/__local-jar').catch(() => null) : null;
if (res?.ok) {
  const jar = new File([await res.blob()], res.headers.get('X-Jar-Name') ?? 'client.jar');
  await useAssets([jar, ...cached.filter((f) => !f.name.endsWith('.jar'))]);
} else if (cached.length) await useAssets(cached);

if (viewer) await openShared(viewer);
else {
  const existing = await listProjects();
  if (existing.length) await openProject(existing[0].id);
  else await newProject();
}

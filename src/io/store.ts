import type { BuildFileV1 } from './buildFile';

// Minimal IndexedDB key-value store for projects. No dependency needed for two operations.

export interface ProjectMeta { id: string; name: string; updated: number }

const DB = 'mc-build-visualizer';
const STORE = 'projects';
const ASSETS = 'assets';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, store = STORE): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

interface Row extends ProjectMeta { build: BuildFileV1 }

export const saveProject = (id: string, build: BuildFileV1) =>
  tx('readwrite', (s) => s.put({ id, name: build.name, updated: Date.now(), build } satisfies Row));

export const loadProject = async (id: string) => ((await tx('readonly', (s) => s.get(id))) as Row | undefined)?.build;

export const deleteProject = (id: string) => tx('readwrite', (s) => s.delete(id));

export async function listProjects(): Promise<ProjectMeta[]> {
  const rows = (await tx('readonly', (s) => s.getAll())) as Row[];
  return rows.map(({ id, name, updated }) => ({ id, name, updated })).sort((a, b) => b.updated - a.updated);
}

// The user's own jar/packs, cached locally so they load once. Never uploaded anywhere.
export const saveAssetFiles = (files: File[]) => tx('readwrite', (s) => s.put(files, 'files'), ASSETS);
export const loadAssetFiles = async () => ((await tx('readonly', (s) => s.get('files'), ASSETS)) as File[] | undefined) ?? [];

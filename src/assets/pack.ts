import JSZip from 'jszip';
import type { RawAssets } from './models';

export interface LoadedAssets extends RawAssets {
  /** PNGs keyed like sprites: "block/oak_log", "colormap/grass", "entity/chest/normal". */
  textures: Map<string, Blob>;
  /** world_version from the client jar's version.json (the schematic DataVersion). */
  dataVersion?: number;
}

const PREFIX = 'assets/minecraft/';

/**
 * Read the client jar and resource packs (zips). Later files override earlier ones,
 * so pass the vanilla jar first and packs after it.
 */
export async function loadAssets(files: Blob[]): Promise<LoadedAssets> {
  const out: LoadedAssets = { blockstates: new Map(), models: new Map(), textures: new Map() };
  for (const file of files) {
    const zip = await JSZip.loadAsync(file);
    const jobs: Promise<void>[] = [];
    const version = zip.file('version.json');
    if (version) jobs.push(version.async('string').then((s) => void (out.dataVersion = parseJson(s, 'version.json')?.world_version)));
    zip.forEach((path, entry) => {
      if (entry.dir || !path.startsWith(PREFIX)) return;
      const rel = path.slice(PREFIX.length);
      let m: RegExpExecArray | null;
      if ((m = /^blockstates\/(.+)\.json$/.exec(rel)))
        jobs.push(entry.async('string').then((s) => void out.blockstates.set(m![1], parseJson(s, path))));
      else if ((m = /^models\/(block\/.+)\.json$/.exec(rel)))
        jobs.push(entry.async('string').then((s) => void out.models.set(m![1], parseJson(s, path))));
      else if ((m = /^textures\/((?:block|colormap|entity)\/.+)\.png$/.exec(rel)))
        jobs.push(entry.async('blob').then((b) => void out.textures.set(m![1], b)));
    });
    await Promise.all(jobs);
  }
  for (const [k, v] of out.blockstates) if (v === null) out.blockstates.delete(k);
  for (const [k, v] of out.models) if (v === null) out.models.delete(k);
  if (!out.blockstates.size) throw new Error('No blockstates found. Load the Minecraft client .jar first.');
  return out;
}

// Packs from the internet can contain broken JSON; skip the file instead of failing the whole load.
function parseJson(s: string, path: string): any {
  try {
    return JSON.parse(s);
  } catch {
    console.warn(`Skipping invalid JSON: ${path}`);
    return null;
  }
}

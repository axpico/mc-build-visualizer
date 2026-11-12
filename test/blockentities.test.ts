import { describe, expect, it } from 'vitest';
import { blockEntityQuads, BLOCK_ENTITY_SPRITES } from '../src/blockentities';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { loadAssets } from '../src/assets/pack';

const all = () => true;
const bounds = (q: { pos: number[] }[]) => [0, 1, 2].map((a) => {
  const v = q.flatMap((x) => [0, 1, 2, 3].map((i) => x.pos[i * 3 + a]));
  return [Math.min(...v), Math.max(...v)].map((n) => Math.round(n * 16 * 100) / 100 || 0);
});

describe('block entities', () => {
  it('builds a chest inside its cell, front facing the state', () => {
    const q = blockEntityQuads('chest', { facing: 'north', type: 'single' }, all)!;
    expect(q).toHaveLength(18); // body, lid, latch
    expect(bounds(q)).toEqual([[1, 15], [0, 14], [0, 15]]); // latch pokes out the north side
    const south = blockEntityQuads('chest', { facing: 'south', type: 'single' }, all)!;
    expect(bounds(south)[2]).toEqual([1, 16]);
  });

  it('marks solid block entities (collision) but not banners', () => {
    expect(blockEntityQuads('chest', { facing: 'north' }, all)!.some((q) => q.cull === 'down')).toBe(true);
    expect(blockEntityQuads('red_banner', { rotation: '0' }, all)!.some((q) => q.cull)).toBe(false);
  });

  it('tints banner flags with the dye color and handles shulker facing', () => {
    const banner = blockEntityQuads('lime_banner', { rotation: '4' }, all)!;
    expect(banner.some((q) => q.sprite === 'entity/banner/base' && q.color[0] < q.color[1])).toBe(true);
    const down = blockEntityQuads('shulker_box', { facing: 'down' }, all)!;
    expect(bounds(down)).toEqual([[0, 16], [0, 16], [0, 16]]);
  });

  it('falls back to untextured when a texture is missing; ignores normal blocks', () => {
    expect(blockEntityQuads('ender_chest', { facing: 'east' }, () => false)!.every((q) => q.sprite === null)).toBe(true);
    expect(blockEntityQuads('stone', {}, all)).toBeNull();
  });

  const JAR = `${homedir()}/.local/share/PrismLauncher/libraries/com/mojang/minecraft/26.3/minecraft-26.3-client.jar`;
  it.skipIf(!existsSync(JAR))('every referenced entity texture exists in the vanilla jar', async () => {
    const a = await loadAssets([new Blob([readFileSync(JAR)])]);
    expect(BLOCK_ENTITY_SPRITES.filter((s) => !a.textures.has(s))).toEqual([]);
  }, 60_000);
});

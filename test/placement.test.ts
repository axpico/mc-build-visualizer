import { describe, expect, it } from 'vitest';
import { BlockInfo, connect, derive, mirrorState, PlaceCtx } from '../src/tools/placement';

const PROPS: Record<string, Record<string, string[]>> = {
  oak_stairs: { facing: ['north', 'east', 'south', 'west'], half: ['bottom', 'top'], shape: ['straight', 'inner_left'] },
  oak_log: { axis: ['y', 'x', 'z'] },
  stone_slab: { type: ['bottom', 'top', 'double'] },
  furnace: { facing: ['north', 'east', 'south', 'west'], lit: ['false', 'true'] },
  piston: { facing: ['north', 'east', 'south', 'west', 'up', 'down'], extended: ['false', 'true'] },
  oak_door: { facing: ['north', 'east', 'south', 'west'], half: ['lower', 'upper'], hinge: ['left', 'right'], open: ['false', 'true'] },
  red_bed: { facing: ['north', 'east', 'south', 'west'], part: ['foot', 'head'] },
  torch: {},
  wall_torch: { facing: ['north', 'east', 'south', 'west'] },
  oak_sign: { rotation: Array.from({ length: 16 }, (_, i) => String(i)) },
  oak_fence: { north: ['false', 'true'], east: ['false', 'true'], south: ['false', 'true'], west: ['false', 'true'] },
  cobblestone_wall: { north: ['none', 'low'], east: ['none', 'low'], south: ['none', 'low'], west: ['none', 'low'], up: ['false', 'true'] },
};
const info: BlockInfo = {
  props: (n) => PROPS[n] ?? {},
  exists: (n) => n in PROPS,
  isFull: (s) => s.startsWith('minecraft:stone'),
};
// camera looking north (-z) and slightly down
const ctx = (o: Partial<PlaceCtx> = {}): PlaceCtx => ({ face: 'up', look: [0, -0.3, -1], hitY: 0, ...o });
const one = (name: string, c = ctx(), ov = {}) => derive(info, name, c, ov)[0].state;

describe('derive', () => {
  it('stairs face where the player looks, upper half when clicking high on a side', () => {
    expect(one('oak_stairs')).toBe('minecraft:oak_stairs[facing=north,half=bottom,shape=straight]');
    expect(one('oak_stairs', ctx({ face: 'east', hitY: 0.8 }))).toContain('half=top');
    expect(one('oak_stairs', ctx({ face: 'down' }))).toContain('half=top');
  });
  it('logs follow the clicked face axis', () => {
    expect(one('oak_log', ctx({ face: 'west' }))).toBe('minecraft:oak_log[axis=x]');
    expect(one('oak_log', ctx({ face: 'south' }))).toBe('minecraft:oak_log[axis=z]');
  });
  it('slabs go top when clicking the underside', () => {
    expect(one('stone_slab', ctx({ face: 'down' }))).toBe('minecraft:stone_slab[type=top]');
  });
  it('furnace front and piston face the player', () => {
    expect(one('furnace')).toContain('facing=south');
    expect(one('piston', ctx({ look: [0, -1, 0] }))).toContain('facing=up');
  });
  it('doors and beds place two blocks', () => {
    const door = derive(info, 'oak_door', ctx());
    expect(door.map((p) => p.dy)).toEqual([0, 1]);
    expect(door[1].state).toContain('half=upper');
    const bed = derive(info, 'red_bed', ctx());
    expect(bed[1]).toMatchObject({ dx: 0, dz: -1 });
    expect(bed[1].state).toContain('part=head');
  });
  it('torch on a side becomes a wall torch facing away from the wall', () => {
    expect(one('torch', ctx({ face: 'east' }))).toBe('minecraft:wall_torch[facing=east]');
    expect(one('torch')).toBe('minecraft:torch');
  });
  it('signs rotate to face the player', () => {
    expect(one('oak_sign')).toBe('minecraft:oak_sign[rotation=0]'); // looking north → text faces south = rotation 0
  });
  it('overrides win', () => {
    expect(one('oak_stairs', ctx(), { facing: 'west' })).toContain('facing=west');
  });
});

describe('connect', () => {
  const grid = (cells: Record<string, string>) => (dx: number, dy: number, dz: number) => cells[`${dx},${dy},${dz}`] ?? 'minecraft:air';
  it('fences link to fences and full blocks', () => {
    const s = connect('minecraft:oak_fence[east=false,north=false,south=false,west=false]', grid({ '0,0,-1': 'minecraft:oak_fence', '1,0,0': 'minecraft:stone' }), info);
    expect(s).toBe('minecraft:oak_fence[east=true,north=true,south=false,west=false]');
  });
  it('walls drop the post on straight runs', () => {
    const s = connect('minecraft:cobblestone_wall', grid({ '0,0,-1': 'minecraft:cobblestone_wall', '0,0,1': 'minecraft:cobblestone_wall' }), info);
    expect(s).toBe('minecraft:cobblestone_wall[east=none,north=low,south=low,up=false,west=none]');
  });
  it('leaves other blocks alone', () => {
    expect(connect('minecraft:stone', grid({}), info)).toBe('minecraft:stone');
  });
});

describe('mirrorState', () => {
  it('flips facing, hinge, stair shape and side connections', () => {
    expect(mirrorState('minecraft:oak_stairs[facing=east,half=bottom,shape=inner_left]', 'x')).toBe('minecraft:oak_stairs[facing=west,half=bottom,shape=inner_right]');
    expect(mirrorState('minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]', 'z')).toBe('minecraft:oak_door[facing=south,half=lower,hinge=right,open=false]');
    expect(mirrorState('minecraft:oak_fence[east=true,north=false,south=true,west=false]', 'z')).toBe('minecraft:oak_fence[east=true,north=true,south=false,west=false]');
    expect(mirrorState('minecraft:rail[shape=ascending_east]', 'x')).toBe('minecraft:rail[shape=ascending_west]');
  });
  it('mirrors sign rotation', () => {
    expect(mirrorState('minecraft:oak_sign[rotation=4]', 'x')).toBe('minecraft:oak_sign[rotation=12]'); // west ↔ east
    expect(mirrorState('minecraft:oak_sign[rotation=0]', 'z')).toBe('minecraft:oak_sign[rotation=8]'); // south ↔ north
    expect(mirrorState('minecraft:stone', 'x')).toBe('minecraft:stone');
  });
});

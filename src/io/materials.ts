import { parseState } from '../assets/models';
import { World } from '../world/world';

const COUNT_PROPS = ['candles', 'pickles', 'eggs', 'flower_amount', 'segment_amount'];

/** Items needed to build: [item name, count], most first. Two-cell blocks count once. */
export function materials(world: World, itemOf: (name: string) => string): [string, number][] {
  const perId = new Map<number, number>();
  for (const [, , , id] of world.blocks()) perId.set(id, (perId.get(id) ?? 0) + 1);
  const totals = new Map<string, number>();
  for (const [id, n] of perId) {
    const { name, props } = parseState(world.palette[id]);
    if (props.half === 'upper' || props.part === 'head' || name === 'piston_head') continue;
    let each = 1;
    if (props.type === 'double' && name.endsWith('slab')) each = 2;
    for (const k of COUNT_PROPS) if (props[k]) each = Number(props[k]);
    const item = itemOf(name);
    totals.set(item, (totals.get(item) ?? 0) + n * each);
  }
  return [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** "200" → "3 stacks + 8" (64 per stack). */
export function stacks(n: number): string {
  const s = Math.floor(n / 64), r = n % 64;
  return s ? `${s} stack${s > 1 ? 's' : ''}${r ? ` + ${r}` : ''}` : String(r);
}

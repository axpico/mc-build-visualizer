import { wallVariant } from '../tools/placement';

export interface Slot { name: string; overrides: Record<string, string> }

const KEY = 'mcbv.hotbar';
const DEFAULT = ['stone', 'oak_planks', 'oak_log', 'glass', 'oak_stairs', 'stone_slab', 'oak_fence', 'torch', 'oak_door'];
const MAX_LIST = 200;

const pretty = (name: string) => name.replace(/_/g, ' ');

/** Search list + 9-slot hotbar + property panel for the selected slot. */
export class Palette {
  slots: (Slot | null)[] = DEFAULT.map((name) => ({ name, overrides: {} }));
  selected = 0;
  private names: string[] = [];
  private props: (name: string) => Record<string, string[]> = () => ({});

  constructor(
    private search: HTMLInputElement,
    private list: HTMLElement,
    private panel: HTMLElement,
    private hotbar: HTMLElement,
  ) {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (Array.isArray(saved) && saved.length === 9) this.slots = saved;
    } catch { /* storage blocked or corrupt: keep defaults */ }
    search.oninput = () => this.renderList();
    this.render();
  }

  setBlocks(names: string[], props: (name: string) => Record<string, string[]>) {
    // wall torches/signs are chosen automatically by placement, so hide them from the list
    const walls = new Set(names.map(wallVariant));
    this.names = names.filter((n) => !walls.has(n));
    this.props = props;
    this.render();
  }

  current(): Slot | null {
    return this.slots[this.selected];
  }

  select(i: number) {
    this.selected = i;
    this.render();
  }

  setCurrent(slot: Slot) {
    this.slots[this.selected] = slot;
    this.save();
    this.render();
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.slots));
    } catch { /* per-viewer convenience only */ }
  }

  private render() {
    this.renderHotbar();
    this.renderList();
    this.renderPanel();
  }

  private renderHotbar() {
    this.hotbar.replaceChildren(...this.slots.map((s, i) => {
      const b = document.createElement('button');
      b.className = i === this.selected ? 'slot active' : 'slot';
      b.title = s ? s.name : 'empty';
      b.innerHTML = `<kbd>${i + 1}</kbd>`;
      b.append(s ? pretty(s.name) : '—');
      b.onclick = () => this.select(i);
      return b;
    }));
  }

  private renderList() {
    const terms = this.search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const hits = this.names.filter((n) => terms.every((t) => n.includes(t)));
    const cur = this.current()?.name;
    this.list.replaceChildren(...hits.slice(0, MAX_LIST).map((n) => {
      const li = document.createElement('li');
      li.textContent = pretty(n);
      li.title = `minecraft:${n}`;
      if (n === cur) li.className = 'active';
      li.onclick = () => this.setCurrent({ name: n, overrides: {} });
      return li;
    }));
    if (hits.length > MAX_LIST) {
      const li = document.createElement('li');
      li.className = 'more';
      li.textContent = `…${hits.length - MAX_LIST} more, refine search`;
      this.list.append(li);
    }
  }

  private renderPanel() {
    const slot = this.current();
    const props = slot ? Object.entries(this.props(slot.name)) : [];
    if (!slot || !props.length) {
      this.panel.textContent = slot ? 'No properties.' : 'Empty slot.';
      return;
    }
    this.panel.replaceChildren(...props.map(([k, values]) => {
      const label = document.createElement('label');
      label.textContent = k;
      const sel = document.createElement('select');
      sel.add(new Option('auto', ''));
      for (const v of values) sel.add(new Option(v, v));
      sel.value = slot.overrides[k] ?? '';
      sel.onchange = () => {
        const overrides = { ...slot.overrides };
        if (sel.value) overrides[k] = sel.value;
        else delete overrides[k];
        this.setCurrent({ ...slot, overrides });
      };
      label.append(sel);
      return label;
    }));
  }
}

// Minimal big-endian NBT writer (only what .schem export needs).

export type Tag =
  | { type: 'byte'; value: number }
  | { type: 'short'; value: number }
  | { type: 'int'; value: number }
  | { type: 'long'; value: bigint }
  | { type: 'string'; value: string }
  | { type: 'byteArray'; value: Uint8Array }
  | { type: 'intArray'; value: number[] }
  | { type: 'list'; of: Tag['type'] | 'end'; value: Tag[] }
  | { type: 'compound'; value: Record<string, Tag> };

export const ID: Record<Tag['type'] | 'end', number> = {
  end: 0, byte: 1, short: 2, int: 3, long: 4, byteArray: 7, string: 8, list: 9, compound: 10, intArray: 11,
};

export const nbt = {
  byte: (value: number): Tag => ({ type: 'byte', value }),
  short: (value: number): Tag => ({ type: 'short', value }),
  int: (value: number): Tag => ({ type: 'int', value }),
  long: (value: bigint): Tag => ({ type: 'long', value }),
  string: (value: string): Tag => ({ type: 'string', value }),
  byteArray: (value: Uint8Array): Tag => ({ type: 'byteArray', value }),
  intArray: (value: number[]): Tag => ({ type: 'intArray', value }),
  list: (of: Tag['type'] | 'end', value: Tag[]): Tag => ({ type: 'list', of, value }),
  compound: (value: Record<string, Tag>): Tag & { type: 'compound' } => ({ type: 'compound', value }),
};

class Writer {
  private buf = new Uint8Array(1024);
  private view = new DataView(this.buf.buffer);
  len = 0;
  private need(n: number) {
    if (this.len + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number) { this.need(1); this.view.setInt8(this.len, v); this.len += 1; }
  i16(v: number) { this.need(2); this.view.setInt16(this.len, v); this.len += 2; }
  i32(v: number) { this.need(4); this.view.setInt32(this.len, v); this.len += 4; }
  i64(v: bigint) { this.need(8); this.view.setBigInt64(this.len, v); this.len += 8; }
  bytes(b: Uint8Array) { this.need(b.length); this.buf.set(b, this.len); this.len += b.length; }
  // shortcut: plain UTF-8, identical to Java's modified UTF-8 except for NUL and astral chars (not in block ids)
  str(s: string) { const b = new TextEncoder().encode(s); this.i16(b.length); this.bytes(b); }
  result() { return this.buf.slice(0, this.len); }
}

function payload(w: Writer, t: Tag) {
  switch (t.type) {
    case 'byte': return w.u8(t.value);
    case 'short': return w.i16(t.value);
    case 'int': return w.i32(t.value);
    case 'long': return w.i64(t.value);
    case 'string': return w.str(t.value);
    case 'byteArray': w.i32(t.value.length); return w.bytes(t.value);
    case 'intArray': w.i32(t.value.length); return t.value.forEach((v) => w.i32(v));
    case 'list': w.u8(ID[t.of]); w.i32(t.value.length); return t.value.forEach((v) => payload(w, v));
    case 'compound':
      for (const [k, v] of Object.entries(t.value)) { w.u8(ID[v.type]); w.str(k); payload(w, v); }
      return w.u8(0);
  }
}

/** Serialize a named root compound (uncompressed). */
export function writeNbt(root: Tag & { type: 'compound' }, name = ''): Uint8Array {
  const w = new Writer();
  w.u8(ID.compound);
  w.str(name);
  payload(w, root);
  return w.result();
}

export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

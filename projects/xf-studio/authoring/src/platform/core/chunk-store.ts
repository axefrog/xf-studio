/**
 * The look history's content-addressed chunk store (feature-module platform §3). A chunk is the JSON
 * text of one piece of a part (for eye makeup, one layer or the recipe header); equal text is stored
 * once however many Undo steps use it. Addresses come from a hash of the text; a collision is
 * detected by comparing the text and resolved with a suffix, so two different chunks never share
 * an address. Chunks are reference-counted and dropped when no step uses them. DOM-free.
 */
import type { ChunkId } from "../api/history";

/** 53-bit string hash (cyrb53), plus the length: an address, never a proof of equality. */
export function chunkAddress(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}.${text.length.toString(36)}`;
}

export class ChunkStore {
  private readonly texts = new Map<ChunkId, string>();
  private readonly refs = new Map<ChunkId, number>();
  /** `address` is replaceable so tests can force collisions. */
  constructor(private readonly address: (text: string) => string = chunkAddress) {}
  /** Store `text` (or find it) and take one reference to it. */
  put(text: string): ChunkId {
    const base = this.address(text);
    let id = base;
    for (let n = 1; this.texts.has(id) && this.texts.get(id) !== text; n++) id = `${base}~${n}`;
    if (!this.texts.has(id)) this.texts.set(id, text);
    this.refs.set(id, (this.refs.get(id) ?? 0) + 1);
    return id;
  }
  retain(id: ChunkId) {
    const count = this.refs.get(id);
    if (count === undefined) throw Error(`History chunk ${id} is missing.`);
    this.refs.set(id, count + 1);
  }
  release(id: ChunkId) {
    const count = this.refs.get(id);
    if (count === undefined) return;
    if (count > 1) { this.refs.set(id, count - 1); return; }
    this.refs.delete(id); this.texts.delete(id);
  }
  text(id: ChunkId): string {
    const text = this.texts.get(id);
    if (text === undefined) throw Error(`History chunk ${id} is missing.`);
    return text;
  }
  /** Distinct chunks held, and their total text length (UTF-16 code units). */
  stats(): { chunks: number; units: number } {
    let units = 0;
    for (const text of this.texts.values()) units += text.length;
    return { chunks: this.texts.size, units };
  }
}

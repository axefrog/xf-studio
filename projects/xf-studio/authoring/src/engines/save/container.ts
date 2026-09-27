/**
 * The save container codec, read side (research/save/save-editor-design.md §3, §8.1; knowledge/save-files.md §1). Pure and bounded; it
 * knows no node's meaning.
 *
 * Layout [source: WolvenKit `CyberpunkSaveReader.cs` at 11720772, studied only; resource: private 2.31 saves]:
 * - Header: `CSAV`, u32 save version, u32 game version, a string (empty), u64 timestamp, u32 archive version.
 * - Chunk table: `FZLC`, u32 used count, then (u32 file offset, u32 stored size, u32 expanded size) per chunk, padded to a capacity.
 *   Each chunk is `4ZLX`, u32 expanded size and an LZ4 block, or stored as is. The chunks' contents end to end are one expanded stream,
 *   addressed as if the header and table were part of it: the first chunk's contents start at its own file offset (`dataStart`).
 * - Node table, found by the footer (u32 table offset, `ENOD`): `EDON`, VLQ count, then per node a name, i32 next sibling ID, i32 first
 *   child ID, u32 offset and u32 size in the expanded stream. A node's ID is its table position, and its data starts with that ID as a
 *   u32. A parent's size includes its children.
 *
 * The image keeps the original bytes and the chunk table, so the later minimal-diff writer (design §7.2) can splice re-encoded nodes and
 * re-compress from the first changed chunk; nothing here writes.
 */
import { decodeLz4, MAX_CHUNK_BYTES } from "./lz4";
import { Reader } from "./reader";

export type SaveHeader = {
  readonly saveVersion: number;
  readonly gameVersion: number;
  readonly archiveVersion: number;
  /** The header's u64 timestamp, in decimal. */
  readonly timestamp: string;
  /** Where the chunk table starts in the file. */
  readonly tableOffset: number;
};
export type SaveChunk = {
  /** Where its stored bytes are in the file, and how many. */
  readonly offset: number;
  readonly stored: number;
  /** Where its contents start in the expanded stream, and how many. */
  readonly start: number;
  readonly size: number;
  readonly compressed: boolean;
};
export type SaveNode = {
  readonly id: number;
  readonly name: string;
  /** Where the node's data is in the expanded stream, and its size (children included). */
  readonly offset: number;
  readonly size: number;
  readonly nextId: number;
  readonly childId: number;
  readonly parent: number | null;
  readonly children: readonly number[];
  readonly depth: number;
  /** Whether the data starts with the node's own ID, as every node of a well-formed save does. */
  readonly idMatches: boolean;
};
export type SaveImage = {
  readonly bytes: Uint8Array;
  readonly header: SaveHeader;
  readonly chunks: readonly SaveChunk[];
  readonly dataStart: number;
  /** The expanded stream, addressed like node offsets (its first `dataStart` bytes are zero). */
  readonly expanded: Uint8Array;
  readonly nodeTableOffset: number;
  readonly nodes: readonly SaveNode[];
  /** Root node IDs in table order. */
  readonly roots: readonly number[];
  /** Plain notes about a tree that isn't exactly as a save's is (a node outside its parent, a sibling chain that loops). */
  readonly issues: readonly string[];
  /** Nodes with this name, in table order. */
  find(name: string): readonly SaveNode[];
  /** A node's data: its bytes, the u32 ID included. */
  data(id: number): Uint8Array;
  /** A node's data after its u32 ID and before its first child: the node's own part. */
  body(id: number): Uint8Array;
  /** Which chunk holds a stream address. */
  chunkAt(offset: number): number;
};

export class SaveFormatError extends Error { override name = "SaveFormatError"; }

/** Bounds: far above any 2.x save (170–340 nodes, 25–33 chunks, 6.5–8.5 MB expanded). */
export const SAVE_LIMITS = Object.freeze({ fileBytes: 128 * 1024 * 1024, expandedBytes: 256 * 1024 * 1024, chunks: 4096, nodes: 200_000,
  tableStart: 2 * 1024 * 1024 });

const MAGIC = 0x43534156, NODE_TABLE = 0x4e4f4445, FOOTER = 0x444f4e45;
const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);

/** The header alone (cheap): version gates run on it before anything is expanded. */
export function readSaveHeader(bytes: Uint8Array): SaveHeader {
  if (bytes.length < 40 || bytes.length > SAVE_LIMITS.fileBytes) throw new SaveFormatError("Unsupported save size");
  const r = new Reader(bytes);
  if (r.u32() !== MAGIC) throw new SaveFormatError("This is not a Cyberpunk sav.dat file");
  const saveVersion = r.u32(), gameVersion = r.u32();
  r.text();
  const timestamp = r.u64(), archiveVersion = r.u32();
  return { saveVersion, gameVersion, archiveVersion, timestamp, tableOffset: r.pos };
}

/** Open a save: header, chunks (expanded now), node table and tree. Throws `SaveFormatError` (or a bounded read error) on a bad frame. */
export function openSave(bytes: Uint8Array): SaveImage {
  const header = readSaveHeader(bytes);
  const r = new Reader(bytes);
  r.pos = header.tableOffset;
  if (ascii(r.take(4)) !== "FZLC") throw new SaveFormatError("Unsupported compression table");
  const chunkCount = r.count(SAVE_LIMITS.chunks);
  if (!chunkCount) throw new SaveFormatError("Empty save");
  const raw = Array.from({ length: chunkCount }, () => ({ offset: r.u32(), stored: r.u32(), size: r.u32() }));
  const dataStart = raw[0]!.offset;
  if (dataStart < header.tableOffset + 8 + chunkCount * 12 || dataStart > SAVE_LIMITS.tableStart || (dataStart - header.tableOffset - 8) % 12)
    throw new SaveFormatError("Invalid chunk table offsets");
  const footer = new Reader(bytes.subarray(bytes.length - 8)), nodeTableOffset = footer.u32();
  if (footer.u32() !== FOOTER || nodeTableOffset >= bytes.length - 8) throw new SaveFormatError("Invalid save footer");
  let total = dataStart, last = dataStart;
  const chunks: SaveChunk[] = [];
  for (const c of raw) {
    if (c.offset !== last || c.stored < 1 || c.size > MAX_CHUNK_BYTES || c.offset + c.stored > nodeTableOffset)
      throw new SaveFormatError("Invalid chunk boundaries");
    chunks.push({ offset: c.offset, stored: c.stored, start: total, size: c.size,
      compressed: c.stored >= 4 && ascii(bytes.subarray(c.offset, c.offset + 4)) === "4ZLX" });
    total += c.size;
    last += c.stored;
  }
  if (total > SAVE_LIMITS.expandedBytes) throw new SaveFormatError("Decompressed save exceeds the preview limit");
  const expanded = new Uint8Array(total);
  for (const c of chunks) {
    const stored = bytes.subarray(c.offset, c.offset + c.stored);
    let out: Uint8Array;
    if (c.compressed) {
      const part = new Reader(stored);
      part.take(4);
      if (part.u32() !== c.size) throw new SaveFormatError("Chunk length mismatch");
      out = decodeLz4(stored.subarray(8), c.size);
    } else {
      if (c.size !== c.stored) throw new SaveFormatError("Unsupported uncompressed chunk");
      out = stored;
    }
    expanded.set(out, c.start);
  }
  const directory = new Reader(bytes.subarray(nodeTableOffset, bytes.length - 8));
  if (directory.u32() !== NODE_TABLE) throw new SaveFormatError("Missing node directory");
  const count = directory.vlq();
  if (count < 1 || count > SAVE_LIMITS.nodes) throw new SaveFormatError("Invalid node count");
  const rows = Array.from({ length: count }, () => ({ name: directory.text(), nextId: directory.i32(), childId: directory.i32(),
    offset: directory.u32(), size: directory.u32() }));
  const { nodes, roots, issues } = buildTree(rows, expanded, dataStart);
  const byName = new Map<string, SaveNode[]>();
  for (const node of nodes) { const list = byName.get(node.name); if (list) list.push(node); else byName.set(node.name, [node]); }
  const inBounds = (node: SaveNode) => node.offset >= dataStart && node.offset + node.size <= expanded.length;
  const nodeOf = (id: number) => {
    const node = nodes[id];
    if (!node) throw new SaveFormatError(`Node ${id} doesn't exist.`);
    if (!inBounds(node)) throw new SaveFormatError(`Node ${node.name} lies outside the save's data.`);
    return node;
  };
  return {
    bytes, header, chunks, dataStart, expanded, nodeTableOffset, nodes, roots, issues,
    find: name => byName.get(name) ?? [],
    data: id => { const node = nodeOf(id); return expanded.subarray(node.offset, node.offset + node.size); },
    body: id => {
      const node = nodeOf(id);
      const first = node.children.length ? nodes[node.children[0]!]! : undefined;
      const end = first && first.offset > node.offset + 4 && first.offset <= node.offset + node.size ? first.offset : node.offset + node.size;
      return expanded.subarray(Math.min(node.offset + 4, end), end);
    },
    chunkAt: offset => {
      let lo = 0, hi = chunks.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (chunks[mid]!.start <= offset) lo = mid; else hi = mid - 1; }
      return lo;
    },
  };
}

type Row = { name: string; nextId: number; childId: number; offset: number; size: number };

/**
 * The tree from the table's sibling and child links: roots are node 0's sibling chain, each node's children its first child's chain.
 * A link out of range, a loop or a node reached twice is noted and the node stays a root, so a damaged table still lists every node.
 */
function buildTree(rows: readonly Row[], expanded: Uint8Array, dataStart: number) {
  const issues: string[] = [];
  const parent = new Array<number | null>(rows.length).fill(null), depth = new Array<number>(rows.length).fill(0);
  const children: number[][] = rows.map(() => []), placed = new Array<boolean>(rows.length).fill(false);
  const valid = (id: number) => Number.isInteger(id) && id >= 0 && id < rows.length;
  const chain = (first: number, owner: number | null, level: number): number[] => {
    const out: number[] = [];
    for (let id = first, steps = 0; id !== -1; id = rows[id]!.nextId) {
      if (!valid(id)) { issues.push(`A link points at node ${id}, which doesn't exist.`); break; }
      if (placed[id]) { issues.push(`Node ${id} (${rows[id]!.name}) is linked twice.`); break; }
      if (++steps > rows.length) break;
      placed[id] = true; parent[id] = owner; depth[id] = level; out.push(id);
    }
    return out;
  };
  const roots = valid(0) ? chain(0, null, 0) : [];
  // Children breadth-first, so a node's depth is known before its own children are placed.
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift()!, row = rows[id]!;
    if (row.childId === -1) continue;
    if (depth[id]! >= 64) { issues.push(`Node ${id} nests deeper than any save does.`); continue; }
    children[id] = chain(row.childId, id, depth[id]! + 1);
    for (const child of children[id]!) {
      const c = rows[child]!;
      if (c.offset < row.offset || c.offset + c.size > row.offset + row.size) issues.push(`Node ${child} (${c.name}) lies outside its parent ${row.name}.`);
      queue.push(child);
    }
  }
  for (let id = 0; id < rows.length; id++) if (!placed[id]) { placed[id] = true; roots.push(id); issues.push(`Node ${id} (${rows[id]!.name}) isn't linked from the tree.`); }
  const view = new DataView(expanded.buffer, expanded.byteOffset, expanded.byteLength);
  const nodes: SaveNode[] = rows.map((row, id) => ({ id, name: row.name, offset: row.offset, size: row.size, nextId: row.nextId, childId: row.childId,
    parent: parent[id]!, children: children[id]!, depth: depth[id]!,
    idMatches: row.size >= 4 && row.offset >= dataStart && row.offset + row.size <= expanded.length && view.getUint32(row.offset, true) === id }));
  return { nodes, roots, issues };
}

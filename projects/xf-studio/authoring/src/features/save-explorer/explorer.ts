/**
 * The Save Explorer's read model (research/save/save-editor-design.md phase 1): an honest, read-only look inside any save, modded or not.
 * Pure and bounded; it works on a save's bytes and the name sources it is given, and knows no node's meaning beyond its encoding:
 *
 * - the container (engines/save/container.ts) gives the node tree, sizes and chunks;
 * - `TypeDatabase_v2` (the save's own schema) and the type oracle name types and settle which package types are enums;
 * - self-describing object packages are found by their structure and decoded generically (every script system's data, mods included);
 * - `PersistencySystem2` is indexed at once and walked entry by entry; an entry the walker can't follow stays raw bytes with a reason;
 * - every other node is kept as raw bytes (a hex preview), because it has a bespoke layout this phase doesn't read.
 *
 * Mod data is shown generically: script classes grouped by their namespace, from the save's own type information. Nothing here
 * interprets one mod's data, and nothing writes. Work is done lazily per node and cached.
 */
import { decodeChunk, detectSavePackage, packageNames, type PackageFrame, type PackageValue } from "../../engines/red-object/package";
import { decodePersistencyEntry, readPersistencyIndex, type PersistDecode, type PersistencyIndex, type PersistValue } from "../../engines/red-object/persistency";
import { fnv1a64, hashText } from "../../engines/red-object/hash";
import { readTypeDatabase, type TypeDatabase } from "../../engines/red-object/type-database";
import { createTypeOracle, type EngineTypes, type TypeOracle, type TypeSourceId } from "../../engines/red-object/type-oracle";
import { openSave, type SaveImage, type SaveNode } from "../../engines/save/container";

export type NodeEncoding = "package" | "persistency" | "type-database" | "container" | "bespoke";
/**
 * `decoded`: every value read; `partial`: some values or entries kept raw; `raw`: kept as bytes (no reader yet); `failed`: its frame is
 * unreadable; `checking`: a package or the persistency node not checked yet (`check`).
 */
export type NodeStatus = "decoded" | "partial" | "raw" | "failed" | "checking";
export type TreeRow = {
  readonly id: number;
  readonly name: string;
  readonly depth: number;
  readonly parent: number | null;
  readonly children: readonly number[];
  readonly size: number;
  readonly encoding: NodeEncoding;
  readonly status: NodeStatus;
  /** One plain line: "472 objects", "63,100 entries, 99.4 % read", "kept as bytes". */
  readonly detail: string;
};
export type SaveSummary = {
  readonly saveVersion: number;
  readonly gameVersion: number;
  readonly archiveVersion: number;
  readonly nodes: number;
  readonly chunks: number;
  readonly fileBytes: number;
  readonly expandedBytes: number;
  readonly issues: readonly string[];
  /** How far the save's own schema is named, and by which sources. */
  readonly types: { readonly types: number; readonly typesNamed: number; readonly properties: number; readonly propertiesNamed: number;
    readonly engineNames: boolean; readonly scriptNames: boolean };
};
export type ObjectRef =
  | { readonly node: number; readonly kind: "chunk"; readonly index: number }
  | { readonly node: number; readonly kind: "entry"; readonly index: number };
/** One field of an inspected object, ready to show: names resolved where a source knows them, values as text. */
export type InspectField = {
  readonly name: string;
  /** The stored type's name (or its hash when no source names it). */
  readonly type?: string;
  readonly value?: string;
  /** Which source named this field or type: the save itself, the engine list, installed scripts, or none (shown as a hash). */
  readonly named?: TypeSourceId | "unnamed";
  readonly children?: readonly InspectField[];
  /** Children left out to stay bounded. */
  readonly more?: number;
  /** A handle to another object of the same package. */
  readonly link?: ObjectRef;
  readonly opaque?: boolean;
};
export type ObjectInspection = {
  readonly ref: ObjectRef;
  readonly title: string;
  readonly subtitle: string;
  readonly status: "decoded" | "partial" | "raw";
  readonly fields: readonly InspectField[];
  readonly notes: readonly string[];
  /** Raw bytes of what couldn't be read (hex, bounded). */
  readonly hex?: string;
};
export type NodeHeader = { readonly id: number; readonly name: string; readonly offset: number; readonly size: number; readonly ownBytes: number;
  readonly chunks: readonly [number, number]; readonly children: number; readonly idMatches: boolean };
export type PackageObjectRow = { readonly index: number; readonly type: string; readonly status: "decoded" | "partial" | "failed"; readonly note?: string };
export type EntryRow = { readonly index: number; readonly id: string; readonly type: string; readonly named: boolean; readonly size: number;
  readonly status: "decoded" | "raw"; readonly reason?: string };
export type NodeInspection =
  | { readonly kind: "package"; readonly node: NodeHeader; readonly variant: string; readonly trailing: number; readonly objects: readonly PackageObjectRow[];
      readonly decoded: number; readonly partial: number; readonly failed: number }
  | { readonly kind: "persistency"; readonly node: NodeHeader; readonly entries: number; readonly filled: number; readonly walked: number;
      readonly notWalked: readonly { readonly reason: string; readonly count: number }[]; readonly classes: readonly { readonly type: string; readonly count: number }[] }
  | { readonly kind: "type-database"; readonly node: NodeHeader; readonly version: number; readonly types: number; readonly typesNamed: number;
      readonly properties: number; readonly propertiesNamed: number; readonly rows: readonly { readonly name: string; readonly kind: string; readonly size: number }[] }
  | { readonly kind: "container"; readonly node: NodeHeader }
  | { readonly kind: "bespoke"; readonly node: NodeHeader; readonly hex: string; readonly note: string }
  | { readonly kind: "failed"; readonly node: NodeHeader; readonly hex: string; readonly note: string };
export type ModDataClass = { readonly type: string; readonly objects: readonly ObjectRef[]; readonly defined: boolean | null };
export type ModDataView = {
  readonly namespaces: readonly { readonly namespace: string; readonly classes: readonly ModDataClass[] }[];
  readonly scriptNames: boolean;
};
export type EntryPage = { readonly rows: readonly EntryRow[]; readonly total: number; readonly offset: number };

export type ExplorerNames = { readonly engine?: EngineTypes | null; readonly scripts?: readonly string[] | null };

/** Bounds on what one inspection returns (the view shows the rest as "N more"). */
const MAX_CHILDREN = 400, MAX_DEPTH = 24, HEX_BYTES = 512;
const number = (value: number) => value.toLocaleString("en-US");
const percent = (part: number, whole: number) => whole ? `${(Math.floor(part / whole * 1000) / 10).toFixed(1)} %` : "0 %";

/** Up to `limit` bytes as hex rows of 16, with offsets. */
export function hexPreview(bytes: Uint8Array, limit = HEX_BYTES): string {
  const rows: string[] = [];
  for (let at = 0; at < Math.min(bytes.length, limit); at += 16) {
    const part = bytes.subarray(at, Math.min(at + 16, bytes.length, limit));
    rows.push(`${at.toString(16).padStart(6, "0")}  ${[...part].map(b => b.toString(16).padStart(2, "0")).join(" ")}`);
  }
  if (bytes.length > limit) rows.push(`… ${number(bytes.length - limit)} more bytes`);
  return rows.join("\n");
}
/** A class name's namespace (the part before its last dot), or "" for a class without one. */
export const namespaceOf = (type: string) => { const at = type.lastIndexOf("."); return at > 0 ? type.slice(0, at) : ""; };

export type SaveExplorer = ReturnType<typeof openExplorer>;

/** Open a save for exploring. Throws when the container itself can't be read (the caller shows why). */
export function openExplorer(bytes: Uint8Array, names: ExplorerNames = {}) {
  const save: SaveImage = openSave(bytes);
  const node = (id: number) => save.nodes[id];
  let database: TypeDatabase | null = null;
  const schema = save.find("TypeDatabase_v2")[0];
  let databaseError: string | null = null;
  try { database = schema ? readTypeDatabase(save.data(schema.id)) : null; } catch (error) { databaseError = error instanceof Error ? error.message : "unreadable"; }
  const persistencyNode = save.find("PersistencySystem2")[0];
  // Packages are recognised by structure: a leaf node whose data after its ID is a package frame.
  const packages = new Map<number, { frame: PackageFrame; trailing: number }>();
  for (const n of save.nodes) {
    if (n.children.length || n.id === schema?.id || n.id === persistencyNode?.id || n.size < 32) continue;
    try { const found = detectSavePackage(save.data(n.id).subarray(4)); if (found) packages.set(n.id, found); } catch { /* not a package */ }
  }
  const oracle: TypeOracle = createTypeOracle({ database, engine: names.engine ?? null, names: [
    ...(names.scripts ? [{ source: "scripts" as const, names: names.scripts }] : []),
    { source: "package" as const, names: [...packages.values()].flatMap(entry => packageNames(entry.frame)) }] });
  const scriptsKnown = !!names.scripts?.length;

  const encodingOf = (n: SaveNode): NodeEncoding => n.id === schema?.id ? "type-database" : n.id === persistencyNode?.id ? "persistency"
    : packages.has(n.id) ? "package" : n.children.length ? "container" : "bespoke";
  const header = (n: SaveNode): NodeHeader => {
    const own = n.children.length ? Math.max(0, n.size - n.children.reduce((sum, child) => sum + (save.nodes[child]?.size ?? 0), 0)) : n.size;
    return { id: n.id, name: n.name, offset: n.offset, size: n.size, ownBytes: own, chunks: [save.chunkAt(n.offset), save.chunkAt(Math.max(n.offset, n.offset + n.size - 1))],
      children: n.children.length, idMatches: n.idMatches };
  };

  // ---- Packages: decoded per object, cached per node ----
  const packageCache = new Map<number, { rows: PackageObjectRow[]; decoded: number; partial: number; failed: number }>();
  const packageRows = (id: number) => {
    let cached = packageCache.get(id);
    if (cached) return cached;
    const { frame } = packages.get(id)!;
    const rows: PackageObjectRow[] = [];
    let decoded = 0, partial = 0, failed = 0;
    for (let index = 0; index < frame.chunks.length; index++) {
      const type = frame.chunks[index]!.type;
      try {
        const { skipped } = decodeChunk(frame, index, oracle);
        if (skipped.length) { partial++; rows.push({ index, type, status: "partial", note: `${skipped.length} value${skipped.length === 1 ? "" : "s"} kept as bytes` }); }
        else { decoded++; rows.push({ index, type, status: "decoded" }); }
      } catch (error) { failed++; rows.push({ index, type, status: "failed", note: error instanceof Error ? error.message : "unreadable" }); }
    }
    cached = { rows, decoded, partial, failed };
    packageCache.set(id, cached);
    return cached;
  };

  // ---- Persistency: an index at once, entries walked on demand ----
  let persistency: { body: Uint8Array; index: PersistencyIndex } | null | undefined;
  let persistencyError: string | null = null;
  const persistencyIndex = () => {
    if (persistency !== undefined) return persistency;
    if (!persistencyNode) return (persistency = null);
    try { const body = save.data(persistencyNode.id).subarray(4); persistency = { body, index: readPersistencyIndex(body) }; }
    catch (error) { persistencyError = error instanceof Error ? error.message : "unreadable"; persistency = null; }
    return persistency;
  };
  const entryCache = new Map<number, PersistDecode>();
  const entryDecode = (index: number): PersistDecode | null => {
    const p = persistencyIndex(), entry = p?.index.entries[index];
    if (!p || !entry || entry.start < 0) return null;
    let found = entryCache.get(index);
    if (!found) { found = decodePersistencyEntry(p.body, entry, oracle); if (entryCache.size < 4096) entryCache.set(index, found); }
    return found;
  };
  let persistencyStats: { walked: number; notWalked: Map<string, number>; classes: Map<string, number> } | undefined;
  const persistencyWalk = () => {
    if (persistencyStats) return persistencyStats;
    const p = persistencyIndex();
    const stats = { walked: 0, notWalked: new Map<string, number>(), classes: new Map<string, number>() };
    for (const entry of p?.index.entries ?? []) {
      if (entry.start < 0) continue;
      const type = typeName(entry.classHash);
      stats.classes.set(type, (stats.classes.get(type) ?? 0) + 1);
      const result = decodePersistencyEntry(p!.body, entry, oracle);
      if (result.ok) stats.walked++;
      else { const reason = result.reason.replace(/[0-9a-f]{12,}/g, "…").replace(/^\d+ elements/, "too many elements"); stats.notWalked.set(reason, (stats.notWalked.get(reason) ?? 0) + 1); }
    }
    return (persistencyStats = stats);
  };
  const typeName = (hash: bigint) => oracle.name(hash)?.name ?? `#${hashText(hash)}`;

  // ---- Tree ----
  let treeRows: TreeRow[] | undefined;
  const tree = (): TreeRow[] => {
    if (treeRows) return treeRows;
    treeRows = save.nodes.map(n => {
      const encoding = encodingOf(n);
      let status: NodeStatus = "raw", detail = "Kept as bytes: no reader for this node yet";
      if (encoding === "container") { status = "decoded"; detail = `${number(n.children.length)} child node${n.children.length === 1 ? "" : "s"}`; }
      if (encoding === "type-database") {
        status = database ? "decoded" : "failed";
        detail = database ? `The save's schema: ${number(database.types.length)} types, ${number(database.properties.length)} properties` : `Unreadable (${databaseError})`;
      }
      if (encoding === "package") {
        const rows = packageCache.get(n.id), count = packages.get(n.id)!.frame.chunks.length;
        status = !rows ? "checking" : rows.failed || rows.partial ? "partial" : "decoded";
        detail = `${number(count)} object${count === 1 ? "" : "s"}` + (rows && (rows.failed || rows.partial) ? `, ${number(rows.decoded)} fully read` : "");
      }
      if (encoding === "persistency") {
        const p = persistencyIndex();
        if (!p) { status = "failed"; detail = `Unreadable (${persistencyError ?? "no index"})`; }
        else if (!persistencyStats) { status = "checking"; detail = `${number(p.index.filled)} world objects`; }
        else { status = persistencyStats.walked === p.index.filled ? "decoded" : "partial";
          detail = `${number(p.index.filled)} world objects, ${percent(persistencyStats.walked, p.index.filled)} read`; }
      }
      return { id: n.id, name: n.name, depth: n.depth, parent: n.parent, children: n.children, size: n.size, encoding, status, detail };
    });
    return treeRows;
  };
  /** Nodes whose decode status isn't known yet, cheapest first. */
  const pending = () => tree().filter(row => row.status === "checking").sort((a, b) => a.size - b.size).map(row => row.id);
  /** Work out one node's decode status (decode its package objects, or walk the world objects); the tree shows it afterwards. */
  const check = (id: number) => {
    const n = node(id);
    if (!n) return;
    if (packages.has(id)) packageRows(id);
    else if (id === persistencyNode?.id) persistencyWalk();
    treeRows = undefined;
  };

  // ---- Values to inspector fields ----
  const packageField = (frame: PackageFrame, name: string, value: PackageValue, depth: number, nodeId: number, type?: string): InspectField => {
    if (value === null) return { name, ...(type ? { type } : {}), value: "Not read", opaque: true };
    if (Array.isArray(value)) {
      const shown = value.slice(0, MAX_CHILDREN);
      return { name, ...(type ? { type } : {}), value: `${number(value.length)} item${value.length === 1 ? "" : "s"}`,
        children: depth >= MAX_DEPTH ? [] : shown.map((item, i) => packageField(frame, `[${i}]`, item, depth + 1, nodeId, type?.startsWith("array:") ? type.slice(6) : undefined)),
        ...(value.length > shown.length ? { more: value.length - shown.length } : {}) };
    }
    if (typeof value === "object") {
      if ("$handle" in value) {
        const target = frame.chunks[value.$handle];
        return { name, ...(type ? { type } : {}), value: value.$handle < 0 ? "None" : target ? `→ ${target.type} #${value.$handle}` : `→ #${value.$handle} (missing)`,
          ...(target ? { link: { node: nodeId, kind: "chunk" as const, index: value.$handle } } : {}) };
      }
      if ("$opaque" in value) return { name, type: value.$opaque, value: `${number(value.bytes)} bytes, not read`, opaque: true };
      const entries = Object.entries(value.fields);
      return { name, type: type ?? value.$type, children: depth >= MAX_DEPTH ? [] : entries.slice(0, MAX_CHILDREN).map(([key, inner]) => packageField(frame, key, inner, depth + 1, nodeId, value.types?.[key])),
        ...(entries.length > MAX_CHILDREN ? { more: entries.length - MAX_CHILDREN } : {}) };
    }
    return { name, ...(type ? { type } : {}), value: String(value) };
  };
  const persistField = (name: string, named: TypeSourceId | "unnamed", type: string, value: PersistValue, depth: number): InspectField => {
    if (Array.isArray(value)) {
      const shown = value.slice(0, MAX_CHILDREN);
      return { name, named, type, value: `${number(value.length)} item${value.length === 1 ? "" : "s"}`,
        children: depth >= MAX_DEPTH ? [] : shown.map((item, i) => persistField(`[${i}]`, named, type.startsWith("array:") ? type.slice(6) : "", item, depth + 1)),
        ...(value.length > shown.length ? { more: value.length - shown.length } : {}) };
    }
    if (typeof value === "object") {
      if ("$hash" in value) return { name, named, type, value: value.name ?? `#${value.$hash}` };
      if ("$opaque" in value) return { name, named, type, value: `${number(value.bytes)} bytes, not read`, opaque: true };
      return { name, named, type: typeName(value.$class), children: depth >= MAX_DEPTH ? [] : value.props.slice(0, MAX_CHILDREN).map(prop => propField(prop, depth + 1)),
        ...(value.props.length > MAX_CHILDREN ? { more: value.props.length - MAX_CHILDREN } : {}) };
    }
    return { name, named, type, value: String(value) };
  };
  const propField = (prop: { nameHash: bigint; typeHash: bigint; value: PersistValue }, depth: number): InspectField => {
    const answer = oracle.name(prop.nameHash);
    return persistField(answer?.name ?? `#${hashText(prop.nameHash)}`, answer?.source ?? "unnamed", oracle.type(prop.typeHash)?.name ?? `#${hashText(prop.typeHash)}`, prop.value, depth);
  };

  return {
    save,
    oracle,
    summary(): SaveSummary {
      return { saveVersion: save.header.saveVersion, gameVersion: save.header.gameVersion, archiveVersion: save.header.archiveVersion, nodes: save.nodes.length,
        chunks: save.chunks.length, fileBytes: bytes.length, expandedBytes: save.expanded.length - save.dataStart, issues: save.issues,
        types: { types: oracle.stats.types, typesNamed: oracle.stats.typesNamed, properties: oracle.stats.properties, propertiesNamed: oracle.stats.propertiesNamed,
          engineNames: !!names.engine, scriptNames: scriptsKnown } };
    },
    tree,
    pending,
    check,
    node(id: number): NodeInspection | undefined {
      const n = node(id);
      if (!n) return undefined;
      const head = header(n), encoding = encodingOf(n);
      if (encoding === "container") return { kind: "container", node: head };
      if (encoding === "package") {
        const entry = packages.get(id)!, known = packageCache.has(id), rows = packageRows(id);
        if (!known) treeRows = undefined;
        return { kind: "package", node: head, variant: entry.frame.variant === "save" ? "script systems (with CRUIDs)" : "native system", trailing: entry.trailing,
          objects: rows.rows, decoded: rows.decoded, partial: rows.partial, failed: rows.failed };
      }
      if (encoding === "type-database") {
        if (!database) return { kind: "failed", node: head, hex: hexPreview(save.body(id)), note: `The save's type database couldn't be read: ${databaseError}.` };
        return { kind: "type-database", node: head, version: database.version, types: database.types.length, typesNamed: oracle.stats.typesNamed,
          properties: database.properties.length, propertiesNamed: oracle.stats.propertiesNamed,
          rows: database.types.map(type => ({ name: oracle.type(type.hash)?.name ?? `#${hashText(type.hash)}`, kind: type.kind, size: type.size }))
            .sort((a, b) => a.name.localeCompare(b.name)) };
      }
      if (encoding === "persistency") {
        const p = persistencyIndex();
        if (!p) return { kind: "failed", node: head, hex: hexPreview(save.body(id)), note: `The world-object index couldn't be read: ${persistencyError}.` };
        const known = !!persistencyStats, walk = persistencyWalk();
        if (!known) treeRows = undefined;
        return { kind: "persistency", node: head, entries: p.index.entries.length, filled: p.index.filled, walked: walk.walked,
          notWalked: [...walk.notWalked].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
          classes: [...walk.classes].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)) };
      }
      return { kind: "bespoke", node: head, hex: hexPreview(save.data(id).subarray(4)),
        note: "This node has a layout of its own that the explorer doesn't read yet, so it's shown as bytes. It's kept exactly as the game wrote it." };
    },
    /** A page of persistency entries, optionally only those whose class name contains `filter`. */
    entries(offset: number, limit: number, filter = ""): EntryPage {
      const p = persistencyIndex();
      if (!p) return { rows: [], total: 0, offset: 0 };
      const needle = filter.trim().toLowerCase();
      const matching = p.index.entries.filter(entry => entry.start >= 0 && (!needle || typeName(entry.classHash).toLowerCase().includes(needle)));
      const start = Math.max(0, Math.min(offset, Math.max(0, matching.length - 1)));
      const rows = matching.slice(start, start + Math.max(1, Math.min(limit, 500))).map(entry => {
        const result = entryDecode(entry.index)!;
        return { index: entry.index, id: hashText(entry.id), type: typeName(entry.classHash), named: !!oracle.name(entry.classHash), size: entry.size,
          status: result.ok ? "decoded" as const : "raw" as const, ...(result.ok ? {} : { reason: result.reason }) };
      });
      return { rows, total: matching.length, offset: start };
    },
    object(ref: ObjectRef): ObjectInspection | undefined {
      if (ref.kind === "chunk") {
        const entry = packages.get(ref.node), chunk = entry?.frame.chunks[ref.index];
        if (!entry || !chunk) return undefined;
        try {
          const { object, skipped } = decodeChunk(entry.frame, ref.index, oracle, { opaque: true, fieldTypes: true });
          const field = packageField(entry.frame, chunk.type, object, 0, ref.node);
          return { ref, title: chunk.type, subtitle: `Object ${ref.index} of ${node(ref.node)?.name}`, status: skipped.length ? "partial" : "decoded",
            fields: field.children ?? [], notes: skipped.length ? [`${skipped.length} value${skipped.length === 1 ? " isn't" : "s aren't"} read (a fixed array, node reference or data buffer); ${skipped.length === 1 ? "it's" : "they're"} kept as bytes.`] : [] };
        } catch (error) {
          return { ref, title: chunk.type, subtitle: `Object ${ref.index} of ${node(ref.node)?.name}`, status: "raw", fields: [],
            notes: [`This object couldn't be read: ${error instanceof Error ? error.message : "unknown layout"}`], hex: hexPreview(entry.frame.bytes.subarray(chunk.start, chunk.end)) };
        }
      }
      const p = persistencyIndex(), entry = p?.index.entries[ref.index];
      const result = entryDecode(ref.index);
      if (!entry || !result) return undefined;
      const title = typeName(entry.classHash), subtitle = `World object ${hashText(entry.id)}, ${number(entry.size)} bytes`;
      const fields = (result.ok ? result.object : result.partial).props.slice(0, MAX_CHILDREN).map(prop => propField(prop, 0));
      if (result.ok) return { ref, title, subtitle, status: "decoded", fields, notes: [] };
      return { ref, title, subtitle, status: fields.length ? "partial" : "raw", fields,
        notes: [`The rest of this entry isn't read (${result.reason}); it's kept exactly as the game wrote it.`], hex: hexPreview(result.raw) };
    },
    /**
     * Mod data, generically: every namespaced script class in the save's packages (redscript modules: `EquipmentEx.OutfitState`) and
     * world-object classes (`App.DynamicEntitySystemPS`), grouped by namespace, with whether the installed scripts still define it.
     */
    modData(): ModDataView {
      const groups = new Map<string, Map<string, ObjectRef[]>>();
      const add = (type: string, ref: ObjectRef) => {
        const namespace = namespaceOf(type);
        if (!namespace) return;
        let classes = groups.get(namespace);
        if (!classes) groups.set(namespace, classes = new Map());
        const list = classes.get(type);
        if (list) { if (list.length < 1000) list.push(ref); } else classes.set(type, [ref]);
      };
      for (const [id, entry] of packages) entry.frame.chunks.forEach((chunk, index) => add(chunk.type, { node: id, kind: "chunk", index }));
      const p = persistencyIndex();
      if (p && persistencyNode) for (const entry of p.index.entries) if (entry.start >= 0) {
        const name = oracle.name(entry.classHash)?.name;
        if (name) add(name, { node: persistencyNode.id, kind: "entry", index: entry.index });
      }
      const defined = (type: string) => scriptsKnown ? oracle.name(fnv1a64(type))?.source === "scripts" : null;
      return { scriptNames: scriptsKnown, namespaces: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([namespace, classes]) => ({ namespace,
        classes: [...classes].sort(([a], [b]) => a.localeCompare(b)).map(([type, objects]) => ({ type, objects, defined: defined(type) })) })) };
    },
  };
}

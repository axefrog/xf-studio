/**
 * The TweakDB records installed TweakXL mods declare in YAML, read the way TweakXL reads them, as an overlay on the compiled TweakDB
 * (research/character-customization/choice-icons-design.md §4.3). Pure: files in (their text, path and provider, in the route's view of
 * `r6/tweaks`), a record table and list edits out, with provenance, conflicts and gaps. Nothing here names a mod or a record: the creator's
 * icons and the pose library use it, clothing will.
 *
 * TweakXL's rules [source: TweakXL 1.11.4, commit f8da6be4: `TweakImporter.cpp`, `TweakService.cpp`, `Yaml/YamlReader*.cpp`,
 * `Batch/TweakChangeset.cpp`]:
 * - **Parsing**: yaml-cpp, which keeps every scalar as text (the field's type converts it later) and keeps node tags. The files are read
 *   with tweakxl-yaml.ts, so a label written `01` stays "01" and the list operations' tags survive. Field values are plain text, arrays and
 *   objects (`toPlain`); a consumer converts numbers and booleans by the field it reads.
 * - **Order**: files whose name starts with `_`, `#`, `$` or `!` load first, `^` last, everything else between; within a band, the
 *   directory iteration order (here: by virtual path, which NTFS iteration follows by name [hypothesis]). All files feed one changeset.
 * - **Records**: a top-level key whose value is a map with `$type` (full `gamedataX_Record` or short `X`) or `$base` (inherit every field
 *   of another record, then override). A later file setting a record again updates the fields it names; two files setting one field
 *   differently are recorded as a conflict (the later wins).
 * - **Flats**: a dotted top-level key with a plain value or list sets one field (`Record.Name.field`).
 * - **Templates**: `$instances` expands a record per instance: every `$(name)` or `${name}` in the record name and its string values is
 *   replaced (a value that is only a placeholder takes the instance value whole), names up to 512 characters.
 * - **Conditions**: `$dlc` keeps a node (a file or a record) only when the DLC is installed; `$game` (a game-version condition) is kept
 *   and recorded as a gap, since the installed version isn't compared here.
 * - **List operations** (`YamlReader::HandleMutations`): a list whose items carry the tags `!append`, `!append-once`, `!prepend`,
 *   `!prepend-once`, `!append-from`, `!prepend-from`, `!merge` (as `!append-from`), `!remove` or `!remove-all` mutates the flat instead of
 *   replacing it; untagged items in such a list are ignored (TweakXL warns). Mutations of one flat from every file accumulate in load order,
 *   separately from assignments, and apply after them (`TweakChangeset::Commit`): see `applyListEdit`.
 * - `.tweak` files (TweakXL's other format) are listed as a gap.
 */
import { mapGet, parseTweakYaml, scalarText, toPlain, type YamlNode } from "./tweakxl-yaml";

export interface TweakFile {
  /** The path below the game folder (`r6/tweaks/…`), forward slashes. */
  readonly path: string;
  /** Who supplied it (the MO2 mod, the game folder). */
  readonly provider: string;
  readonly text: string;
}
export interface OverlayRecord {
  readonly name: string;
  /** The short type (`UIIcon`), when a file gave one. */
  readonly type: string | null;
  readonly base: string | null;
  /** Plain values (tweakxl-yaml.ts `toPlain`): scalars as text, lists as arrays, maps as objects. */
  readonly fields: ReadonlyMap<string, unknown>;
  /** The files that set it, in load order. */
  readonly from: readonly string[];
}
export type ListOperation = "append" | "append-once" | "prepend" | "prepend-once" | "append-from" | "prepend-from" | "remove" | "remove-all";
export interface ListMutation {
  readonly op: ListOperation;
  /** The element (or, for the `-from` forms, the source flat's name); empty for `remove-all`. */
  readonly value: string;
  readonly file: string;
}
/** Everything the files do to one list flat (`Record.field`). */
export interface ListEdit {
  readonly flat: string;
  /** The last whole-list assignment (a list without operation tags), if any. */
  readonly assigned: { readonly values: readonly string[]; readonly file: string } | null;
  /** Mutations in load order. */
  readonly mutations: readonly ListMutation[];
}
export interface TweakOverlay {
  readonly records: ReadonlyMap<string, OverlayRecord>;
  /** A record's field, following `$base` records of the overlay (null when the overlay doesn't set it). */
  field(record: string, field: string): unknown;
  /** List flats the files assign or mutate, by flat name (`photo_mode.character.femalePoses`). */
  readonly lists: ReadonlyMap<string, ListEdit>;
  /**
   * A list flat's value after the files: `base` (the compiled TweakDB's value, null when it has none) with the assignment and mutations
   * applied (`applyListEdit`); `base` itself when no file touches it. `source` answers the `-from` forms' source flats (defaults to this
   * overlay's own answer over an empty base).
   */
  list(flat: string, base: readonly string[] | null, source?: (flat: string) => readonly string[] | null): readonly string[] | null;
  readonly conflicts: readonly { readonly record: string; readonly field: string; readonly files: readonly string[] }[];
  readonly gaps: readonly string[];
  readonly files: number;
}
export interface OverlayEnvironment { readonly dlc: ReadonlySet<string> }

const MAX_NAME = 512, MAX_INSTANCES = 100_000;
/** TweakXL's load band of a file by the first character of its name. */
export function tweakBand(path: string): 0 | 1 | 2 {
  const name = path.split("/").pop() ?? path;
  return /^[_#$!]/.test(name) ? 0 : name.startsWith("^") ? 2 : 1;
}
/** The files in TweakXL's load order. */
export const tweakOrder = <T extends { path: string }>(files: readonly T[]): T[] =>
  [...files].sort((a, b) => tweakBand(a.path) - tweakBand(b.path) || (a.path.toLowerCase() < b.path.toLowerCase() ? -1 : a.path.toLowerCase() > b.path.toLowerCase() ? 1 : 0));
/** `gamedataUIIcon_Record` → `UIIcon`. */
export const shortType = (type: string) => type.replace(/^gamedata/, "").replace(/_Record$/, "");

const OPERATIONS: Readonly<Record<string, ListOperation>> = {
  "!append": "append", "!append-once": "append-once", "!append-from": "append-from", "!merge": "append-from",
  "!prepend": "prepend", "!prepend-once": "prepend-once", "!prepend-from": "prepend-from", "!remove": "remove", "!remove-all": "remove-all",
};

/** Replace `$(name)` and `${name}` in every scalar; a scalar that is only one placeholder takes the instance value whole. */
function substitute(node: YamlNode, instance: ReadonlyMap<string, YamlNode>): YamlNode {
  if (node.kind === "scalar") {
    const whole = /^\$(?:\(([^)]+)\)|\{([^}]+)\})$/.exec(node.text);
    if (whole) { const value = instance.get(whole[1] ?? whole[2]!); return value ? (node.tag && value.kind === "scalar" ? { ...value, tag: node.tag } : value) : node; }
    const text = node.text.replace(/\$(?:\(([^)]+)\)|\{([^}]+)\})/g, (all, a: string | undefined, b: string | undefined) => {
      const value = instance.get(a ?? b!);
      return value?.kind === "scalar" ? value.text : all;
    });
    return text === node.text ? node : { ...node, text };
  }
  if (node.kind === "seq") return { ...node, items: node.items.map(item => substitute(item, instance)) };
  return { ...node, entries: node.entries.map(([key, value]) => [key, substitute(value, instance)] as const) };
}
const substituteText = (text: string, instance: ReadonlyMap<string, YamlNode>) =>
  (substitute({ kind: "scalar", text, tag: null, style: "plain" }, instance) as { text?: string }).text ?? text;

/** A list's operations, or null when no item carries an operation tag (a plain assignment). */
function mutationsOf(node: YamlNode, file: string, gaps: string[], where: string): ListMutation[] | null {
  if (node.kind !== "seq" || !node.items.some(item => item.tag && item.tag.length > 1)) return null;
  const out: ListMutation[] = [];
  for (const item of node.items) {
    if (!item.tag || item.tag.length <= 1) continue;
    const op = OPERATIONS[item.tag];
    if (!op) { gaps.push(`${file}: ${where} has an unknown list operation ${item.tag}.`); continue; }
    const value = scalarText(item);
    if (op !== "remove-all" && value === null) { gaps.push(`${file}: ${where} has a ${item.tag} without a value.`); continue; }
    out.push({ op, value: value ?? "", file });
  }
  return out;
}

/**
 * A list after one flat's edit, as `TweakChangeset::Commit` applies it (single-level: no `$base` chain of mutated lists [hypothesis: pose and
 * creator lists have none]):
 * 1. the value is the last assignment, else `base` (a list no file assigns and the TweakDB lacks starts empty);
 * 2. deletions: each `!remove` value, and for `!remove-all` every element of `base` (resolved before assignments commit), removes its first
 *    occurrence;
 * 3. prepends: every `!prepend`/`!prepend-once` element in load order at the front (in that order), then every `!prepend-from` source's
 *    elements not already present;
 * 4. appends: the same at the end with `!append`/`!append-once`, then `!append-from` (and `!merge`).
 * A `-once` element or a `-from` element already in the list is skipped. Values compare as text (the pose lists are `array:String`).
 */
export function applyListEdit(base: readonly string[] | null, edit: ListEdit | undefined, source: (flat: string) => readonly string[] | null = () => null): string[] | null {
  if (!edit) return base ? [...base] : null;
  const list = [...(edit.assigned?.values ?? base ?? [])];
  const deletions = new Set<string>();
  for (const mutation of edit.mutations) {
    if (mutation.op === "remove") deletions.add(mutation.value);
    if (mutation.op === "remove-all") for (const value of base ?? []) deletions.add(value);
  }
  const indices = new Set<number>();
  for (const value of deletions) { const at = list.indexOf(value); if (at >= 0) indices.add(at); }
  for (const at of [...indices].sort((a, b) => b - a)) list.splice(at, 1);
  const insert = (ops: readonly ListOperation[], mergeOp: ListOperation, start: number) => {
    let at = start;
    for (const mutation of edit.mutations) {
      if (!ops.includes(mutation.op)) continue;
      if (mutation.op.endsWith("-once") && list.includes(mutation.value)) continue;
      list.splice(at++, 0, mutation.value);
    }
    for (const mutation of edit.mutations) {
      if (mutation.op !== mergeOp) continue;
      for (const value of source(mutation.value) ?? []) if (!list.includes(value)) list.splice(at++, 0, value);
    }
  };
  insert(["prepend", "prepend-once"], "prepend-from", 0);
  insert(["append", "append-once"], "append-from", list.length);
  return list;
}

export function readTweakOverlay(files: readonly TweakFile[], environment: OverlayEnvironment = { dlc: new Set() }): TweakOverlay {
  const records = new Map<string, { name: string; type: string | null; base: string | null; fields: Map<string, unknown>; from: string[]; setBy: Map<string, string> }>();
  const lists = new Map<string, { flat: string; assigned: { values: string[]; file: string } | null; mutations: ListMutation[] }>();
  const conflicts: { record: string; field: string; files: string[] }[] = [];
  const gaps: string[] = [];
  const keep = (node: YamlNode, where: string) => {
    const dlc = scalarText(mapGet(node, "$dlc"));
    if (mapGet(node, "$dlc") && !environment.dlc.has((dlc ?? "").toUpperCase())) return false;
    if (mapGet(node, "$game")) gaps.push(`${where}: a $game condition is not compared with the installed game version; the node is read.`);
    return true;
  };
  const record = (name: string, file: TweakFile) => {
    let known = records.get(name);
    if (!known) { known = { name, type: null, base: null, fields: new Map(), from: [], setBy: new Map() }; records.set(name, known); }
    if (known.from.at(-1) !== file.path) known.from.push(file.path);
    return known;
  };
  const listOf = (flat: string) => {
    let edit = lists.get(flat);
    if (!edit) { edit = { flat, assigned: null, mutations: [] }; lists.set(flat, edit); }
    return edit;
  };
  const set = (target: ReturnType<typeof record>, field: string, node: YamlNode, file: TweakFile) => {
    const flat = `${target.name}.${field}`;
    const mutations = mutationsOf(node, file.path, gaps, flat);
    if (mutations) { listOf(flat).mutations.push(...mutations); return; }
    if (node.kind === "seq" && node.tag && node.tag.length > 1) gaps.push(`${file.path}: ${flat} tags the whole list with ${node.tag}; TweakXL reads only item tags, so the list replaces the value.`);
    const value = toPlain(node);
    if (Array.isArray(value)) listOf(flat).assigned = { values: value.map(item => typeof item === "string" ? item : JSON.stringify(item)), file: file.path };
    const before = target.setBy.get(field);
    if (before && before !== file.path && JSON.stringify(target.fields.get(field)) !== JSON.stringify(value)) {
      const known = conflicts.find(entry => entry.record === target.name && entry.field === field);
      if (known) { if (!known.files.includes(file.path)) known.files.push(file.path); }
      else conflicts.push({ record: target.name, field, files: [before, file.path] });
    }
    target.fields.set(field, value);
    target.setBy.set(field, file.path);
  };
  const define = (name: string, body: YamlNode & { kind: "map" }, file: TweakFile) => {
    if (!name || name.length > MAX_NAME || !keep(body, `${file.path}: ${name}`)) return;
    const target = record(name, file);
    const type = scalarText(mapGet(body, "$type")), base = scalarText(mapGet(body, "$base"));
    if (type) target.type = shortType(type);
    if (base) target.base = base;
    for (const [field, value] of body.entries) if (!field.startsWith("$")) set(target, field, value, file);
  };
  let tweakFiles = 0;
  for (const file of tweakOrder(files)) {
    if (/\.tweak$/i.test(file.path)) { gaps.push(`${file.path}: a .tweak file (TweakXL's other format) is not read.`); continue; }
    tweakFiles++;
    let document: YamlNode | null;
    try { document = parseTweakYaml(file.text); }
    catch (error) { gaps.push(`${file.path}: not readable YAML (${(error as Error).message.slice(0, 120)}).`); continue; }
    if (document?.kind !== "map" || !keep(document, file.path)) continue;
    for (const [key, value] of document.entries) {
      if (key.startsWith("$")) continue;
      if (value.kind === "map" && (mapGet(value, "$type") || mapGet(value, "$base") || mapGet(value, "$instances"))) {
        const instancesNode = mapGet(value, "$instances");
        if (!instancesNode) { define(key, value, file); continue; }
        const instances = instancesNode.kind === "seq" ? instancesNode.items.filter(item => item.kind === "map").slice(0, MAX_INSTANCES) : [];
        const template = { ...value, entries: value.entries.filter(([field]) => field !== "$instances") };
        for (const instance of instances) {
          const values = new Map(instance.kind === "map" ? instance.entries : []);
          define(substituteText(key, values), substitute(template, values) as YamlNode & { kind: "map" }, file);
        }
      } else if (key.includes(".") && value.kind !== "map") {
        // A flat: `Record.Name.field: value`.
        const at = key.lastIndexOf(".");
        set(record(key.slice(0, at), file), key.slice(at + 1), value, file);
      }
    }
  }
  const field = (name: string, wanted: string, depth = 0): unknown => {
    const known = records.get(name);
    if (!known || depth > 16) return null;
    if (known.fields.has(wanted)) return known.fields.get(wanted);
    return known.base ? field(known.base, wanted, depth + 1) : null;
  };
  const frozen = new Map<string, OverlayRecord>([...records].map(([name, entry]) => [name, { name, type: entry.type, base: entry.base, fields: entry.fields, from: entry.from }]));
  const selfSource = (flat: string, depth = 0): readonly string[] | null => depth > 16 ? null : applyListEdit(null, lists.get(flat), next => selfSource(next, depth + 1));
  return {
    records: frozen, field: (name, wanted) => field(name, wanted), lists, conflicts, gaps, files: tweakFiles,
    list: (flat, base, source = flat => selfSource(flat)) => applyListEdit(base, lists.get(flat), source),
  };
}

/** A `UIIcon` record's atlas path and part from the overlay, or null when the overlay doesn't define it. */
export function overlayIcon(overlay: TweakOverlay, record: string): { atlasPath: string | null; part: string | null } | null {
  if (!overlay.records.has(record)) return null;
  const path = overlay.field(record, "atlasResourcePath"), part = overlay.field(record, "atlasPartName");
  return { atlasPath: typeof path === "string" && path ? path : null, part: typeof part === "string" && part ? part : typeof part === "number" ? String(part) : null };
}

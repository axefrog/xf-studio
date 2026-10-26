// The capability registry's tool (capabilities/README.md): checks the registry and renders its pages.
//
//   bun tools/capabilities.ts validate                 checks every file; readable errors, exit 1 on any
//   bun tools/capabilities.ts render                   writes capabilities/CAPABILITIES.md
//   bun tools/capabilities.ts render --check           exits 1 when CAPABILITIES.md is out of date
//   bun tools/capabilities.ts render --html <dir>      also writes <dir>/index.html (one self-contained page)
//   bun tools/capabilities.ts changes --since <date>   a plain digest of the changelog for a status update
//
// validate checks the JSON Schemas (a small local validator for the subset the schemas use), unique ids and the area
// prefix of each id, known areas and consumers, depends_on and parent (resolved, no cycles), surface.commands against
// the command catalogue, verification.rows against the test card, docs links (files and anchors), code and test paths
// of merged items, the changelog (schema, time order, month files) and that every item's updated date has a changelog
// line touching it on or after that date. tools/test/capabilities.test.ts runs it on the real registry.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const PROJECT_DIR = resolve(import.meta.dir, "..");
export const REPO_DIR = resolve(PROJECT_DIR, "..", "..");
export const CAP_DIR = join(PROJECT_DIR, "capabilities");
export const TEST_CARD = join(REPO_DIR, "research", "runtime", "runtime-bridge-test-card.md");
/** The generated page's path relative to the repository root, for links. */
const PAGE_DIR_FROM_ROOT = "projects/xf-runtime-bridge/capabilities";

type Json = Record<string, any>;
export type Item = Json & { id: string; area: string; stage: string; evidence: string; health: string; priority: string; updated: string };
export type Change = Json & { at: string; by: string; kind: string; summary: string; items?: string[] };
export type Registry = { schema: string; owner: string; areas: { id: string; title: string; summary: string }[]; consumers: { id: string; title: string; kind: string; requirements_doc?: string }[] };

export type Loaded = {
  registry: Registry;
  /** Items by file: items/<area>.json. */
  itemFiles: { file: string; area: string; items: unknown; text?: string }[];
  /** Untriaged asks: requests/<consumer>.json. */
  requestFiles: { file: string; consumer: string; items: unknown; text?: string }[];
  /** Changelog lines in file order: changelog/<yyyy-mm>.jsonl. */
  changes: { file: string; line: number; text: string }[];
  schemas: { item: Json; registry: Json; change: Json };
  /** Errors met while reading (unparseable JSON). */
  readErrors: string[];
};

export type Context = {
  /** Catalogue command names. */
  commands: ReadonlySet<string>;
  /** Test-card row ids. */
  rows: ReadonlySet<string>;
  /** The repository root, for docs, code and test paths; null skips the path checks. */
  repoDir: string | null;
  /** The bridge project's directory (code and test paths are relative to it). */
  projectDir: string | null;
};

export const STAGES = ["requested", "proposed", "planned", "building", "built", "merged", "released", "retired"] as const;
export const EVIDENCE = ["none", "offline", "partial", "proven", "regressed"] as const;
export const HEALTH = ["unknown", "works", "caveats", "degraded", "broken"] as const;
export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
const SEVERITIES = ["high", "medium", "low"] as const;
const LEVELS = ["blocking", "needs", "wants"] as const;
const CLOSED_ISSUE = new Set(["fixed", "wontfix"]);
const AXIS_KINDS = new Set(["stage", "evidence", "health", "priority"]);

// ---------------------------------------------------------------------------------------------------------------
// Reading

function readJson(path: string, errors: string[], label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${label}: not valid JSON (${(error as Error).message})`);
    return undefined;
  }
}

export function load(capDir = CAP_DIR): Loaded {
  const readErrors: string[] = [];
  const schema = (name: string) => readJson(join(capDir, "schema", name), readErrors, `schema/${name}`) as Json;
  const registry = readJson(join(capDir, "registry.json"), readErrors, "registry.json") as Registry;
  const list = (dir: string, ext: string) => (existsSync(join(capDir, dir)) ? readdirSync(join(capDir, dir)).filter((f) => f.endsWith(ext)).sort() : []);
  const text = (dir: string, f: string) => readFileSync(join(capDir, dir, f), "utf8").replace(/\r\n/g, "\n");
  const itemFiles = list("items", ".json").map((f) => ({ file: `items/${f}`, area: f.slice(0, -5), items: readJson(join(capDir, "items", f), readErrors, `items/${f}`), text: text("items", f) }));
  const requestFiles = list("requests", ".json").map((f) => ({ file: `requests/${f}`, consumer: f.slice(0, -5), items: readJson(join(capDir, "requests", f), readErrors, `requests/${f}`), text: text("requests", f) }));
  const changes: Loaded["changes"] = [];
  for (const f of list("changelog", ".jsonl")) {
    readFileSync(join(capDir, "changelog", f), "utf8").split(/\r?\n/).forEach((text, i) => {
      if (text.trim()) changes.push({ file: `changelog/${f}`, line: i + 1, text });
    });
  }
  return { registry, itemFiles, requestFiles, changes, schemas: { item: schema("item.schema.json"), registry: schema("registry.schema.json"), change: schema("changelog.schema.json") }, readErrors };
}

/** Every first-cell token of a Markdown table row in the test card: its row ids (CS8181, ST7, B318-1, 11, ...). */
export function testCardRows(text: string): Set<string> {
  const rows = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\|\s*\**([A-Za-z0-9][A-Za-z0-9.-]*)/.exec(line);
    if (match) rows.add(match[1]!.replace(/[.-]+$/, ""));
  }
  return rows;
}

export async function realContext(): Promise<Context> {
  const { CATALOGUE } = await import("./api/catalogue.ts");
  return {
    commands: new Set(CATALOGUE.map((c: { name: string }) => c.name)),
    rows: testCardRows(readFileSync(TEST_CARD, "utf8")),
    repoDir: REPO_DIR,
    projectDir: PROJECT_DIR,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// A small JSON Schema validator: the subset the registry's schemas use (type, properties, required,
// additionalProperties false, enum, const, pattern, maxLength, items, format date and date-time).

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function isDate(value: string): boolean {
  const m = DATE.exec(value);
  if (!m) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.getUTCMonth() + 1 === Number(m[2]) && d.getUTCDate() === Number(m[3]);
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

export function checkSchema(schema: Json, value: unknown, path: string, errors: string[]): void {
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: must be ${JSON.stringify(schema.const)}`);
    return;
  }
  if (schema.type) {
    const actual = typeOf(value);
    const ok = schema.type === actual || (schema.type === "number" && actual === "integer");
    if (!ok) {
      errors.push(`${path}: expected ${schema.type}, found ${actual}`);
      return;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: '${String(value)}' is not one of ${schema.enum.join(", ")}`);
  if (typeof value === "string") {
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength} characters (${value.length})`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: '${value}' doesn't match ${schema.pattern}`);
    if (schema.format === "date" && !isDate(value)) errors.push(`${path}: '${value}' is not a date (yyyy-mm-dd)`);
    if (schema.format === "date-time" && (!DATE_TIME.test(value) || Number.isNaN(Date.parse(value)))) errors.push(`${path}: '${value}' is not an ISO 8601 date-time with an offset`);
  }
  if (Array.isArray(value) && schema.items) value.forEach((entry, i) => checkSchema(schema.items, entry, `${path}[${i}]`, errors));
  if (typeOf(value) === "object") {
    const object = value as Json;
    for (const key of schema.required ?? []) if (!(key in object)) errors.push(`${path}: missing ${key}`);
    const properties = schema.properties ?? {};
    for (const [key, entry] of Object.entries(object)) {
      if (key in properties) checkSchema(properties[key], entry, path ? `${path}.${key}` : key, errors);
      else if (schema.additionalProperties === false) errors.push(`${path || "(top)"}: unknown field '${key}'`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The canonical file format. Every write goes through it, so a change touches only the lines it changes: keys in the
// schema's order (unknown keys after, in their own order), two-space indentation, and small things on one line (an
// array of short strings, an object of plain values that fits in 160 characters).

const INLINE_WIDTH = 160;

function propertySchema(schema: Json | undefined, key: string): Json | undefined {
  return schema?.properties?.[key];
}

/** The value with every object's keys in its schema's order. */
export function canonical(value: unknown, schema?: Json): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonical(entry, schema?.items));
  if (typeOf(value) !== "object") return value;
  const object = value as Json;
  const known = Object.keys(schema?.properties ?? {}).filter((k) => k in object);
  const rest = Object.keys(object).filter((k) => !known.includes(k));
  const out: Json = {};
  for (const key of [...known, ...rest]) out[key] = canonical(object[key], propertySchema(schema, key));
  return out;
}

function inline(value: unknown): string | null {
  if (typeOf(value) !== "object" && !Array.isArray(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    const parts = value.map((v) => (typeOf(v) === "object" || Array.isArray(v) ? null : JSON.stringify(v)));
    if (parts.some((p) => p === null)) return null;
    return `[${parts.join(", ")}]`;
  }
  const parts: string[] = [];
  for (const [k, v] of Object.entries(value as Json)) {
    const part = inline(v);
    if (part === null || (typeOf(v) === "object" && Object.keys(v as Json).length > 0)) return null;
    parts.push(`${JSON.stringify(k)}: ${part}`);
  }
  return parts.length ? `{ ${parts.join(", ")} }` : "{}";
}

/** JSON in the registry's canonical layout; depth 0 and 1 objects (the file and its items) are never inlined. */
export function formatJson(value: unknown, indent = "", depth = 0): string {
  const one = depth >= 2 ? inline(value) : typeOf(value) === "object" || Array.isArray(value) ? null : JSON.stringify(value);
  if (one !== null && indent.length + one.length <= INLINE_WIDTH) return one;
  const next = indent + "  ";
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    // Arrays of primitives that don't fit on one line: one entry per line.
    return `[\n${value.map((v) => next + formatJson(v, next, depth + 1)).join(",\n")}\n${indent}]`;
  }
  if (typeOf(value) === "object") {
    const entries = Object.entries(value as Json);
    if (!entries.length) return "{}";
    return `{\n${entries.map(([k, v]) => `${next}${JSON.stringify(k)}: ${formatJson(v, next, depth + 1)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/** A whole items or requests file in the canonical format. */
export function formatItems(items: unknown[], itemSchema: Json): string {
  return formatJson(items.map((i) => canonical(i, itemSchema))) + "\n";
}

/** One changelog line in the canonical format. */
export function formatChange(change: Change, changeSchema: Json): string {
  return JSON.stringify(canonical(change, changeSchema));
}

// ---------------------------------------------------------------------------------------------------------------
// Validation

/** GitHub's heading slug rules, as tools/check_links.py applies them. */
export function slug(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll("`", "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\- ]/gu, "")
    .replaceAll(" ", "-");
}

const anchorCache = new Map<string, Set<string>>();
export function anchorsOf(path: string): Set<string> {
  let found = anchorCache.get(path);
  if (!found) {
    const body = readFileSync(path, "utf8").replace(/^(```|~~~)[\s\S]*?^\1/gm, "");
    found = new Set<string>();
    const seen = new Map<string, number>();
    for (const m of body.matchAll(/^#{1,6}\s+(.*?)\s*#*\s*$/gm)) {
      const base = slug(m[1]!);
      const n = seen.get(base) ?? 0;
      found.add(n === 0 ? base : `${base}-${n}`);
      seen.set(base, n + 1);
    }
    for (const m of body.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) found.add(m[1]!);
    anchorCache.set(path, found);
  }
  return found;
}

function findCycle(graph: Map<string, string[]>): string[] | null {
  const state = new Map<string, number>(); // 1 visiting, 2 done
  const stack: string[] = [];
  const visit = (node: string): string[] | null => {
    state.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) continue;
      if (state.get(next) === 1) return [...stack.slice(stack.indexOf(next)), next];
      if (!state.has(next)) {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    state.set(node, 2);
    return null;
  };
  for (const node of [...graph.keys()].sort()) {
    if (!state.has(node)) {
      const cycle = visit(node);
      if (cycle) return cycle;
    }
  }
  return null;
}

/** Every item and request with the file it came from (entries that aren't objects are skipped; the schema reports them). */
function entries(data: Loaded): { file: string; item: Item; request: boolean }[] {
  const out: { file: string; item: Item; request: boolean }[] = [];
  for (const f of data.itemFiles) if (Array.isArray(f.items)) for (const item of f.items) if (typeOf(item) === "object") out.push({ file: f.file, item: item as Item, request: false });
  for (const f of data.requestFiles) if (Array.isArray(f.items)) for (const item of f.items) if (typeOf(item) === "object") out.push({ file: f.file, item: item as Item, request: true });
  return out;
}

export function parseChanges(data: Loaded, errors: string[] = []): Change[] {
  const out: Change[] = [];
  for (const c of data.changes) {
    try {
      out.push(JSON.parse(c.text) as Change);
    } catch (error) {
      errors.push(`${c.file}:${c.line}: not valid JSON (${(error as Error).message})`);
    }
  }
  return out;
}

export function validate(data: Loaded, context: Context): string[] {
  const errors: string[] = [...data.readErrors];
  if (!data.registry || !data.schemas.item) return errors;

  // The registry.
  checkSchema(data.schemas.registry, data.registry, "registry.json", errors);
  const areas = new Set((data.registry.areas ?? []).map((a) => a.id));
  const consumers = new Set((data.registry.consumers ?? []).map((c) => c.id));
  if (!consumers.has(data.registry.owner)) errors.push(`registry.json: the owner '${data.registry.owner}' is not a consumer`);
  for (const [label, ids] of [["area", data.registry.areas.map((a) => a.id)], ["consumer", data.registry.consumers.map((c) => c.id)]] as const) {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) errors.push(`registry.json: the ${label} '${id}' is listed twice`);
      seen.add(id);
    }
  }

  // Files.
  for (const f of data.itemFiles) {
    if (!areas.has(f.area)) errors.push(`${f.file}: '${f.area}' is not an area in registry.json`);
    if (f.items !== undefined && !Array.isArray(f.items)) errors.push(`${f.file}: must be an array of items`);
  }
  for (const f of data.requestFiles) {
    if (!consumers.has(f.consumer)) errors.push(`${f.file}: '${f.consumer}' is not a consumer in registry.json`);
    if (f.items !== undefined && !Array.isArray(f.items)) errors.push(`${f.file}: must be an array of items`);
  }

  // The tool's own format: a file that differs was edited by hand (the README: every edit goes through this tool).
  for (const f of [...data.itemFiles, ...data.requestFiles]) {
    if (Array.isArray(f.items) && f.text !== undefined && f.text !== formatItems(f.items, data.schemas.item)) {
      errors.push(`${f.file}: not in the tool's format (edited by hand?): make edits with bun tools/capabilities.ts, or run its format command`);
    }
  }

  // Items, one by one.
  const all = entries(data);
  const byId = new Map<string, { file: string; item: Item }>();
  for (const { file, item, request } of all) {
    const where = `${file}: ${typeof item.id === "string" ? item.id : "(no id)"}`;
    const schemaErrors: string[] = [];
    checkSchema(data.schemas.item, item, "", schemaErrors);
    for (const e of schemaErrors) errors.push(`${where}: ${e}`);
    if (typeof item.id !== "string") continue;
    if (byId.has(item.id)) errors.push(`${where}: the id is already used in ${byId.get(item.id)!.file}`);
    else byId.set(item.id, { file, item });
    const prefix = item.id.split(".")[0];
    if (!request) {
      const fileArea = file.slice("items/".length, -".json".length);
      if (item.area !== fileArea) errors.push(`${where}: area '${item.area}' but the file is ${file}`);
      if (prefix !== fileArea) errors.push(`${where}: the id's area prefix '${prefix}' doesn't match ${file}`);
    } else {
      if (item.stage !== "requested") errors.push(`${where}: a request must have stage 'requested'`);
      if (prefix !== item.area) errors.push(`${where}: the id's area prefix '${prefix}' doesn't match its area '${item.area}'`);
    }
    if (typeof item.area === "string" && !areas.has(item.area)) errors.push(`${where}: '${item.area}' is not an area in registry.json`);
    if ((item.priority === "P0" || item.priority === "P1") && !item.priority_reason) errors.push(`${where}: ${item.priority} needs a priority_reason`);
    if ((item.stage === "building" || item.stage === "built") && !item.branch) errors.push(`${where}: stage '${item.stage}' needs the branch it lives on`);
    const rows: Json[] = item.verification?.rows ?? [];
    if (item.evidence === "proven" && !rows.some((r) => r.verdict === "pass")) errors.push(`${where}: evidence 'proven' needs at least one test-card row that passed (offline tests never prove a capability)`);
    if (item.evidence === "proven" && rows.some((r) => r.verdict === "fail")) errors.push(`${where}: evidence 'proven' but a row's latest verdict is fail`);
    for (const [i, demand] of (item.demand ?? []).entries()) {
      if (!consumers.has(demand.consumer)) errors.push(`${where}: demand[${i}]: '${demand.consumer}' is not a consumer in registry.json`);
    }
    for (const command of item.surface?.commands ?? []) {
      if (!context.commands.has(command)) errors.push(`${where}: surface.commands: '${command}' is not in the command catalogue`);
    }
    for (const [i, row] of rows.entries()) {
      if (typeof row.row === "string" && !context.rows.has(row.row)) errors.push(`${where}: verification.rows[${i}]: '${row.row}' is not a row of the test card`);
      if (row.verdict && row.verdict !== "unrun" && !row.session) errors.push(`${where}: verification.rows[${i}]: a ${row.verdict} verdict needs the session that gave it`);
    }
    if (context.repoDir) {
      for (const doc of item.docs ?? []) {
        const [path, fragment] = String(doc).split("#", 2) as [string, string | undefined];
        const full = join(context.repoDir, path);
        if (!existsSync(full)) errors.push(`${where}: docs: '${path}' doesn't exist`);
        else if (fragment && path.endsWith(".md") && !anchorsOf(full).has(fragment.toLowerCase())) errors.push(`${where}: docs: '${path}' has no heading '#${fragment}'`);
      }
    }
    if (context.projectDir && (item.stage === "merged" || item.stage === "released")) {
      for (const path of [...(item.surface?.code ?? []), ...(item.verification?.tests ?? [])]) {
        if (!existsSync(join(context.projectDir, path))) errors.push(`${where}: '${path}' doesn't exist in the bridge project (a merged item's code and tests must)`);
      }
    }
  }

  // References between items.
  const depends = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const { file, item } of all) {
    if (typeof item.id !== "string") continue;
    for (const dep of item.depends_on ?? []) {
      if (dep === item.id) errors.push(`${file}: ${item.id}: depends on itself`);
      else if (!byId.has(dep)) errors.push(`${file}: ${item.id}: depends_on '${dep}' is not an item`);
    }
    if (item.parent !== undefined) {
      if (item.parent === item.id) errors.push(`${file}: ${item.id}: is its own parent`);
      else if (!byId.has(item.parent)) errors.push(`${file}: ${item.id}: parent '${item.parent}' is not an item`);
    }
    depends.set(item.id, item.depends_on ?? []);
    parents.set(item.id, item.parent ? [item.parent] : []);
  }
  const depCycle = findCycle(depends);
  if (depCycle) errors.push(`depends_on has a cycle: ${depCycle.join(" -> ")}`);
  const parentCycle = findCycle(parents);
  if (parentCycle) errors.push(`parent has a cycle: ${parentCycle.join(" -> ")}`);

  // The changelog.
  const changes = data.changes;
  let previous: { at: number; where: string } | null = null;
  const removed = new Set<string>();
  const parsed: { change: Change; where: string }[] = [];
  for (const c of changes) {
    const where = `${c.file}:${c.line}`;
    let change: Change;
    try {
      change = JSON.parse(c.text);
    } catch (error) {
      errors.push(`${where}: not valid JSON (${(error as Error).message})`);
      continue;
    }
    const schemaErrors: string[] = [];
    checkSchema(data.schemas.change, change, "", schemaErrors);
    for (const e of schemaErrors) errors.push(`${where}: ${e}`);
    if (!schemaErrors.length && c.text !== formatChange(change, data.schemas.change)) errors.push(`${where}: not in the tool's format (edited by hand?)`);
    if (typeof change.at !== "string") continue;
    const month = c.file.slice("changelog/".length, -".jsonl".length);
    if (change.at.slice(0, 7) !== month) errors.push(`${where}: dated ${change.at.slice(0, 10)}, but the file is for ${month}`);
    const at = Date.parse(change.at);
    if (previous && at < previous.at) errors.push(`${where}: earlier than ${previous.where} (lines are appended in time order)`);
    if (!Number.isNaN(at)) previous = { at, where };
    if (typeof change.by === "string" && !consumers.has(change.by)) errors.push(`${where}: by '${change.by}' is not a consumer in registry.json`);
    if (AXIS_KINDS.has(change.kind) && (change.from === undefined || change.to === undefined)) errors.push(`${where}: a ${change.kind} change gives from and to`);
    if (change.kind === "removed") for (const id of change.items ?? []) removed.add(id);
    parsed.push({ change, where });
  }
  for (const { change, where } of parsed) {
    for (const id of change.items ?? []) if (!byId.has(id) && !removed.has(id)) errors.push(`${where}: '${id}' is not an item (and no line removes it)`);
  }
  for (const { file, item } of all) {
    if (typeof item.id !== "string" || typeof item.updated !== "string") continue;
    const touched = parsed.some(({ change }) => (change.items ?? []).includes(item.id) && typeof change.at === "string" && change.at.slice(0, 10) >= item.updated);
    if (!touched) errors.push(`${file}: ${item.id}: updated ${item.updated}, but no changelog line touches it on or after that date`);
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------------------------
// Shared views for the pages

export type View = {
  registry: Registry;
  items: Item[];
  changes: Change[];
  /** The newest changelog date: the reference date for ages, so a render depends only on the files. */
  asOf: string;
};

export function view(data: Loaded): View {
  const items: Item[] = [];
  for (const area of data.registry.areas) {
    const file = data.itemFiles.find((f) => f.area === area.id);
    if (file && Array.isArray(file.items)) items.push(...(file.items as Item[]));
  }
  for (const f of data.requestFiles) if (Array.isArray(f.items)) items.push(...(f.items as Item[]));
  const changes = parseChanges(data);
  const asOf = changes.reduce((max, c) => (c.at.slice(0, 10) > max ? c.at.slice(0, 10) : max), "0000-00-00");
  return { registry: data.registry, items, changes, asOf };
}

const days = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));

export type DebtRow = { item: Item; since: string; age: number };
/** Merged, released or built items with no game evidence (none or offline), oldest first. */
export function evidenceDebt(v: View): DebtRow[] {
  const rows: DebtRow[] = [];
  for (const item of v.items) {
    if (!["built", "merged", "released"].includes(item.stage) || !["none", "offline"].includes(item.evidence)) continue;
    // Since the first line that added it or moved it to built or beyond.
    const lines = v.changes.filter((c) => (c.items ?? []).includes(item.id) && (c.kind === "added" || (c.kind === "stage" && ["built", "merged", "released"].includes(String(c.to)))));
    const since = lines.length ? lines.map((c) => c.at.slice(0, 10)).sort()[0]! : item.updated;
    rows.push({ item, since, age: days(since, v.asOf) });
  }
  return rows.sort((a, b) => b.age - a.age || a.item.id.localeCompare(b.item.id));
}

export type IssueRow = { item: Item; issue: Json };
export function openIssues(v: View): IssueRow[] {
  const rows: IssueRow[] = [];
  for (const item of v.items) for (const issue of item.known_issues ?? []) if (!CLOSED_ISSUE.has(issue.status)) rows.push({ item, issue });
  return rows.sort((a, b) => SEVERITIES.indexOf(a.issue.severity) - SEVERITIES.indexOf(b.issue.severity));
}

export type DemandRow = { item: Item; demand: Json };
/** Unmet demand per consumer (registry order), blocking first. */
export function unmetDemand(v: View): Map<string, DemandRow[]> {
  const out = new Map<string, DemandRow[]>();
  for (const consumer of v.registry.consumers) {
    const rows: DemandRow[] = [];
    for (const item of v.items) for (const demand of item.demand ?? []) if (demand.consumer === consumer.id && !demand.met) rows.push({ item, demand });
    rows.sort((a, b) => LEVELS.indexOf(a.demand.level) - LEVELS.indexOf(b.demand.level));
    if (rows.length) out.set(consumer.id, rows);
  }
  return out;
}

export function counts<T extends string>(items: Item[], key: "stage" | "evidence" | "health" | "priority", order: readonly T[]): [T, number][] {
  return order.map((value) => [value, items.filter((i) => i[key] === value).length] as [T, number]);
}

// ---------------------------------------------------------------------------------------------------------------
// The Markdown page

const cell = (text: unknown) => String(text ?? "").replaceAll("|", "\\|").replace(/\r?\n/g, " ");
const link = (doc: string) => {
  const [path, fragment] = doc.split("#", 2) as [string, string | undefined];
  const up = PAGE_DIR_FROM_ROOT.split("/").map(() => "..").join("/");
  return `[${doc}](${up}/${path}${fragment ? `#${fragment}` : ""})`;
};
const itemLink = (id: string) => `[\`${id}\`](#${id})`;

export function renderMarkdown(v: View): string {
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);
  push(
    "<!-- GENERATED by tools/capabilities.ts from capabilities/registry.json, items/, requests/ and changelog/. Do not edit by hand: change the data and run `bun tools/capabilities.ts render`. -->",
    "",
    "# Bridge capabilities",
    "",
    `> **Generated page; do not edit.** The data is in [registry.json](registry.json), [items/](items) and [changelog/](changelog), and the rules in [README.md](README.md). As of ${v.asOf}, the newest changelog line.`,
    "",
    "## Summary",
    "",
    `${v.items.length} capabilities in ${v.registry.areas.length} areas.`,
    "",
  );
  const axis = (title: string, rows: [string, number][]) => {
    push(`| ${title} | ${rows.map(([k]) => k).join(" | ")} |`, `|---|${rows.map(() => "---:").join("|")}|`, `| items | ${rows.map(([, n]) => n).join(" | ")} |`, "");
  };
  axis("Stage", counts(v.items, "stage", STAGES));
  axis("Evidence", counts(v.items, "evidence", EVIDENCE));
  axis("Health", counts(v.items, "health", HEALTH));
  axis("Priority", counts(v.items, "priority", PRIORITIES));

  const debt = evidenceDebt(v);
  push("### Evidence debt", "", `Built, merged or released capabilities with no game evidence (none or offline): ${debt.length}. Age is in days to ${v.asOf}.`, "");
  if (debt.length) {
    push("| Capability | Stage | Evidence | Since (version) | Age |", "|---|---|---|---|---:|");
    for (const d of debt) push(`| ${itemLink(d.item.id)} ${cell(d.item.title)} | ${d.item.stage} | ${d.item.evidence} | ${d.since}${d.item.since ? ` (${d.item.since})` : ""} | ${d.age} d |`);
    push("");
  }

  const issues = openIssues(v);
  push("### Open known issues", "", `${issues.length} not yet fixed and verified, by severity.`, "");
  if (issues.length) {
    push("| Severity | Status | Capability | Issue | Ref |", "|---|---|---|---|---|");
    for (const { item, issue } of issues) push(`| ${issue.severity} | ${issue.status} | ${itemLink(item.id)} | ${cell(issue.summary)} | ${cell(issue.ref)} |`);
    push("");
  }

  const demand = unmetDemand(v);
  push("### Unmet demand", "", "Per consumer, blocking first.", "");
  for (const consumer of v.registry.consumers) {
    const rows = demand.get(consumer.id);
    if (!rows) continue;
    const byLevel = LEVELS.map((l) => `${rows.filter((r) => r.demand.level === l).length} ${l}`).join(", ");
    push(`#### ${consumer.title}`, "", `${rows.length} open (${byLevel}).`, "", "| Level | Ref | Milestone | Capability | Stage | Evidence | Need |", "|---|---|---|---|---|---|---|");
    for (const { item, demand: d } of rows) push(`| ${d.level} | ${cell(d.ref)} | ${cell(d.milestone)} | ${itemLink(item.id)} | ${item.stage} | ${item.evidence} | ${cell(d.note)} |`);
    push("");
  }

  for (const area of v.registry.areas) {
    const items = v.items.filter((i) => i.area === area.id);
    push(`## ${area.title}`, "", `${area.summary} (area \`${area.id}\`, ${items.length} capabilities)`, "");
    if (!items.length) continue;
    push("| Capability | Kind | Stage | Evidence | Health | Priority |", "|---|---|---|---|---|---|");
    for (const i of items) push(`| ${i.parent ? "↳ " : ""}${itemLink(i.id)} ${cell(i.title)} | ${i.kind} | ${i.stage} | ${i.evidence} | ${i.health} | ${i.priority} |`);
    push("");
    for (const i of items) renderItem(i, push);
  }
  return out.join("\n") + "\n";
}

function renderItem(i: Item, push: (...lines: string[]) => void): void {
  push(`<a id="${i.id}"></a>`, "", `### ${i.title}`, "", `\`${i.id}\` · ${i.kind} · stage **${i.stage}** · evidence **${i.evidence}** · health **${i.health}** · ${i.priority}`, "", i.summary, "");
  const facts: string[] = [];
  if (i.priority_reason) facts.push(`- **Why ${i.priority}:** ${i.priority_reason}`);
  const version = [i.since && `since ${i.since}`, i.changed_in && `changed in ${i.changed_in}`, i.branch && `branch \`${i.branch}\``].filter(Boolean).join(", ");
  if (version) facts.push(`- **Version:** ${version}`);
  if (i.parent) facts.push(`- **Part of:** ${itemLink(i.parent)}`);
  if (i.depends_on?.length) facts.push(`- **Depends on:** ${i.depends_on.map(itemLink).join(", ")}`);
  const s = i.surface ?? {};
  if (s.commands?.length) facts.push(`- **Commands:** ${s.commands.map((c: string) => `\`${c}\``).join(", ")}`);
  if (s.events?.length) facts.push(`- **Events:** ${s.events.map((c: string) => `\`${c}\``).join(", ")}`);
  if (s.config?.length) facts.push(`- **Config:** ${s.config.map((c: string) => `\`${c}\``).join(", ")}`);
  if (s.code?.length) facts.push(`- **Code:** ${s.code.map((c: string) => `\`${c}\``).join(", ")}`);
  for (const d of i.demand ?? []) facts.push(`- **Demand (${d.consumer}, ${d.level}${d.ref ? `, ${d.ref}` : ""}${d.milestone ? `, ${d.milestone}` : ""}${d.met ? `, met ${d.met}` : ""}):** ${d.note ?? ""}`);
  for (const r of i.verification?.rows ?? []) facts.push(`- **Row ${r.row}:** ${r.verdict}${r.session ? ` (${r.session}${r.build ? `, ${r.build}` : ""}${r.date ? `, ${r.date}` : ""})` : ""}${r.note ? `: ${r.note}` : ""}`);
  if (i.verification?.tests?.length) facts.push(`- **Tests:** ${i.verification.tests.map((t: string) => `\`${t}\``).join(", ")}`);
  for (const l of i.limits ?? []) facts.push(`- **Limit:** ${l}`);
  for (const q of i.quirks ?? []) facts.push(`- **Quirk:** ${q}`);
  for (const k of i.known_issues ?? []) facts.push(`- **Issue (${k.severity}, ${k.status}${k.ref ? `, ${k.ref}` : ""}):** ${k.summary}`);
  for (const u of i.unknowns ?? []) facts.push(`- **Unknown:** ${u.question}${u.settle_by ? ` Settle by: ${u.settle_by}.` : ""}${u.needs_game ? " Needs the game." : ""}`);
  for (const m of i.improvements ?? []) facts.push(`- **Could improve${m.value ? ` (value ${m.value}${m.effort ? `, effort ${m.effort}` : ""})` : ""}:** ${m.summary}`);
  if (i.notes) facts.push(`- **Notes:** ${i.notes}`);
  if (i.docs?.length) facts.push(`- **Docs:** ${i.docs.map(link).join(", ")}`);
  facts.push(`- **Updated:** ${i.updated}`);
  push(...facts, "");
}

// ---------------------------------------------------------------------------------------------------------------
// The HTML page: one self-contained file, inline CSS and script, the data inline, no fetches.

const escapeScript = (json: string) => json.replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");

export function renderHtml(v: View): string {
  const data = escapeScript(JSON.stringify({ registry: v.registry, items: v.items, changes: v.changes, asOf: v.asOf, debt: evidenceDebt(v).map((d) => ({ id: d.item.id, since: d.since, age: d.age })) }));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bridge capabilities</title>
<style>
:root { color-scheme: light dark; --bg:#f6f5f2; --panel:#ffffff; --ink:#1d1f23; --muted:#5d636d; --line:#d9d6cf; --accent:#a35b00; --chip:#eeebe4;
  --ok:#1f7a3f; --warn:#9a6200; --bad:#b3261e; --info:#2c5aa0; }
:root[data-theme="dark"] { --bg:#15171b; --panel:#1d2025; --ink:#e8e6e1; --muted:#9aa0a8; --line:#33373e; --accent:#f0b340; --chip:#2a2e35;
  --ok:#6fcf8f; --warn:#f0b340; --bad:#f2817a; --info:#8db4f0; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#15171b; --panel:#1d2025; --ink:#e8e6e1; --muted:#9aa0a8; --line:#33373e;
  --accent:#f0b340; --chip:#2a2e35; --ok:#6fcf8f; --warn:#f0b340; --bad:#f2817a; --info:#8db4f0; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { padding:20px 16px 8px; max-width:1200px; margin:0 auto; display:flex; gap:12px; align-items:baseline; flex-wrap:wrap; }
header h1 { margin:0; font-size:22px; } header .asof { color:var(--muted); }
header button { margin-left:auto; }
main { max-width:1200px; margin:0 auto; padding:0 16px 40px; }
button, select { font:inherit; color:var(--ink); background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:4px 10px; }
button[aria-selected="true"] { border-color:var(--accent); color:var(--accent); }
.tabs { display:flex; gap:6px; margin:8px 0 12px; }
.filters { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
.filters label { display:flex; flex-direction:column; font-size:12px; color:var(--muted); gap:2px; }
.stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:10px; margin-bottom:14px; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:10px 12px; }
.card h3 { margin:0 0 6px; font-size:13px; color:var(--muted); font-weight:600; }
.bars div { display:flex; justify-content:space-between; gap:8px; } .bars span:last-child { font-variant-numeric:tabular-nums; }
table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line); border-radius:8px; overflow:hidden; }
th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
th { font-size:12px; color:var(--muted); font-weight:600; }
tr.item { cursor:pointer; } tr.item:hover { background:var(--chip); }
tr.detail td { background:var(--bg); } .detail ul { margin:4px 0; padding-left:18px; }
.chip { display:inline-block; padding:0 6px; border-radius:4px; background:var(--chip); font-size:12px; white-space:nowrap; }
.e-proven, .h-works { color:var(--ok); } .e-partial, .h-caveats { color:var(--warn); } .e-regressed, .h-broken, .h-degraded, .p-P0 { color:var(--bad); }
.p-P1 { color:var(--warn); } .e-none, .e-offline, .h-unknown { color:var(--muted); }
code { font:12px ui-monospace, Consolas, monospace; }
.muted { color:var(--muted); } .area { margin:18px 0 6px; font-size:16px; }
.scroll { overflow-x:auto; }
@media (max-width: 640px) { .hide-narrow { display:none; } }
</style>
</head>
<body>
<header><h1>Bridge capabilities</h1><span class="asof" id="asof"></span><button id="theme" type="button">Theme</button></header>
<main>
<div class="tabs" role="tablist"><button role="tab" aria-selected="true" data-tab="items">Capabilities</button><button role="tab" aria-selected="false" data-tab="changes">Changelog</button></div>
<section id="items-tab">
<div class="stats" id="stats"></div>
<div class="filters" id="filters"></div>
<div id="list"></div>
</section>
<section id="changes-tab" hidden><div class="scroll" id="changes"></div></section>
</main>
<script type="application/json" id="data">${data}</script>
<script>
(function () {
  var D = JSON.parse(document.getElementById("data").textContent);
  var root = document.documentElement;
  try { var saved = localStorage.getItem("xfb-cap-theme"); if (saved) root.dataset.theme = saved; } catch (e) {}
  document.getElementById("theme").onclick = function () {
    var dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("xfb-cap-theme", root.dataset.theme); } catch (e) {}
  };
  document.getElementById("asof").textContent = D.items.length + " capabilities, as of " + D.asOf;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var ORDER = { stage: ["requested","proposed","planned","building","built","merged","released","retired"], evidence: ["none","offline","partial","proven","regressed"], health: ["unknown","works","caveats","degraded","broken"] };
  var filters = { area: "", stage: "", evidence: "", health: "", consumer: "" };
  var options = {
    area: D.registry.areas.map(function (a) { return [a.id, a.title]; }),
    stage: ORDER.stage.map(function (s) { return [s, s]; }),
    evidence: ORDER.evidence.map(function (s) { return [s, s]; }),
    health: ORDER.health.map(function (s) { return [s, s]; }),
    consumer: D.registry.consumers.map(function (c) { return [c.id, c.title]; })
  };
  var f = document.getElementById("filters");
  Object.keys(options).forEach(function (key) {
    var label = document.createElement("label"); label.textContent = key;
    var sel = document.createElement("select");
    sel.innerHTML = '<option value="">all</option>' + options[key].map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + "</option>"; }).join("");
    sel.onchange = function () { filters[key] = sel.value; draw(); };
    label.appendChild(sel); f.appendChild(label);
  });
  function match(i) {
    return (!filters.area || i.area === filters.area) && (!filters.stage || i.stage === filters.stage) && (!filters.evidence || i.evidence === filters.evidence) &&
      (!filters.health || i.health === filters.health) && (!filters.consumer || (i.demand || []).some(function (d) { return d.consumer === filters.consumer; }));
  }
  function stats(items) {
    var cards = ["stage", "evidence", "health"].map(function (key) {
      return '<div class="card"><h3>' + key + '</h3><div class="bars">' + ORDER[key].map(function (v) {
        var n = items.filter(function (i) { return i[key] === v; }).length;
        return n ? '<div><span class="' + key[0] + "-" + v + '">' + v + "</span><span>" + n + "</span></div>" : "";
      }).join("") + "</div></div>";
    });
    var debt = D.debt.filter(function (d) { return items.some(function (i) { return i.id === d.id; }); }).length;
    var issues = 0; items.forEach(function (i) { (i.known_issues || []).forEach(function (k) { if (k.status !== "fixed" && k.status !== "wontfix") issues++; }); });
    var unmet = 0; items.forEach(function (i) { (i.demand || []).forEach(function (d) { if (!d.met) unmet++; }); });
    cards.push('<div class="card"><h3>attention</h3><div class="bars"><div><span>evidence debt</span><span>' + debt + '</span></div><div><span>open issues</span><span>' + issues + '</span></div><div><span>unmet demand</span><span>' + unmet + "</span></div></div></div>");
    document.getElementById("stats").innerHTML = cards.join("");
  }
  function list(arr, label) { return arr && arr.length ? "<b>" + label + "</b><ul>" + arr.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul>" : ""; }
  function detail(i) {
    var s = i.surface || {};
    var parts = ['<p>' + esc(i.summary) + "</p>"];
    if (i.priority_reason) parts.push("<p><b>Why " + esc(i.priority) + ":</b> " + esc(i.priority_reason) + "</p>");
    var meta = [i.since && "since " + i.since, i.changed_in && "changed in " + i.changed_in, i.branch && "branch " + i.branch, i.parent && "part of " + i.parent, (i.depends_on || []).length && "depends on " + i.depends_on.join(", ")].filter(Boolean);
    if (meta.length) parts.push('<p class="muted">' + esc(meta.join(" · ")) + "</p>");
    if ((s.commands || []).length) parts.push("<p><b>Commands:</b> " + s.commands.map(function (c) { return "<code>" + esc(c) + "</code>"; }).join(", ") + "</p>");
    parts.push(list((i.demand || []).map(function (d) { return esc(d.consumer + " · " + d.level + (d.ref ? " · " + d.ref : "") + (d.milestone ? " · " + d.milestone : "") + (d.met ? " · met " + d.met : "") + ": " + (d.note || "")); }), "Demand"));
    parts.push(list(((i.verification || {}).rows || []).map(function (r) { return "<code>" + esc(r.row) + "</code> " + esc(r.verdict + (r.session ? " (" + r.session + (r.build ? ", " + r.build : "") + ")" : "") + (r.note ? ": " + r.note : "")); }), "Rows"));
    parts.push(list((i.limits || []).map(esc), "Limits"));
    parts.push(list((i.quirks || []).map(esc), "Quirks"));
    parts.push(list((i.known_issues || []).map(function (k) { return esc(k.severity + ", " + k.status + (k.ref ? ", " + k.ref : "") + ": " + k.summary); }), "Known issues"));
    parts.push(list((i.unknowns || []).map(function (u) { return esc(u.question + (u.settle_by ? " Settle by: " + u.settle_by + "." : "")); }), "Unknowns"));
    parts.push(list((i.improvements || []).map(function (m) { return esc(m.summary); }), "Improvements"));
    if (i.notes) parts.push("<p><b>Notes:</b> " + esc(i.notes) + "</p>");
    parts.push(list((i.docs || []).map(function (d) { return "<code>" + esc(d) + "</code>"; }), "Docs"));
    return parts.join("");
  }
  function draw() {
    var items = D.items.filter(match);
    stats(items);
    var html = [];
    D.registry.areas.forEach(function (a) {
      var rows = items.filter(function (i) { return i.area === a.id; });
      if (!rows.length) return;
      html.push('<h2 class="area">' + esc(a.title) + ' <span class="muted">(' + rows.length + ")</span></h2>");
      html.push('<div class="scroll"><table><thead><tr><th>Capability</th><th>Stage</th><th>Evidence</th><th>Health</th><th>Priority</th><th class="hide-narrow">Kind</th></tr></thead><tbody>');
      rows.forEach(function (i) {
        html.push('<tr class="item" data-id="' + esc(i.id) + '"><td>' + (i.parent ? "↳ " : "") + esc(i.title) + '<br><code class="muted">' + esc(i.id) + "</code></td>" +
          '<td><span class="chip">' + esc(i.stage) + '</span></td><td class="e-' + esc(i.evidence) + '">' + esc(i.evidence) + '</td><td class="h-' + esc(i.health) + '">' + esc(i.health) +
          '</td><td class="p-' + esc(i.priority) + '">' + esc(i.priority) + '</td><td class="hide-narrow">' + esc(i.kind) + "</td></tr>");
        html.push('<tr class="detail" data-for="' + esc(i.id) + '" hidden><td colspan="6">' + detail(i) + "</td></tr>");
      });
      html.push("</tbody></table></div>");
    });
    if (!items.length) html.push('<p class="muted">Nothing matches these filters.</p>');
    var listEl = document.getElementById("list");
    listEl.innerHTML = html.join("");
    listEl.querySelectorAll("tr.item").forEach(function (tr) {
      tr.onclick = function () { var d = listEl.querySelector('tr.detail[data-for="' + tr.dataset.id + '"]'); d.hidden = !d.hidden; };
    });
  }
  function drawChanges() {
    var rows = D.changes.slice().reverse().map(function (c) {
      var axis = c.from !== undefined ? " (" + esc(JSON.stringify(c.from)) + " → " + esc(JSON.stringify(c.to)) + ")" : "";
      return "<tr><td>" + esc(c.at.slice(0, 16).replace("T", " ")) + "</td><td>" + esc(c.by) + '</td><td><span class="chip">' + esc(c.kind) + "</span>" + axis + "</td><td>" + esc(c.summary) +
        '<br><span class="muted">' + esc((c.items || []).join(", ")) + "</span></td></tr>";
    });
    document.getElementById("changes").innerHTML = "<table><thead><tr><th>When</th><th>Who</th><th>Kind</th><th>What</th></tr></thead><tbody>" + rows.join("") + "</tbody></table>";
  }
  document.querySelectorAll('[role="tab"]').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('[role="tab"]').forEach(function (x) { x.setAttribute("aria-selected", String(x === b)); });
      document.getElementById("items-tab").hidden = b.dataset.tab !== "items";
      document.getElementById("changes-tab").hidden = b.dataset.tab !== "changes";
    };
  });
  draw(); drawChanges();
})();
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------------------------------------------
// The changelog digest

export function digest(changes: Change[], since: string, until?: string): string {
  const picked = changes.filter((c) => c.at.slice(0, 10) >= since && (!until || c.at.slice(0, 10) <= until));
  if (!picked.length) return `No capability changes since ${since}.\n`;
  const out = [`Capability changes since ${since}${until ? ` until ${until}` : ""}: ${picked.length}.`];
  let day = "";
  for (const c of picked) {
    if (c.at.slice(0, 10) !== day) {
      day = c.at.slice(0, 10);
      out.push("", day);
    }
    const axis = c.from !== undefined || c.to !== undefined ? ` ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}` : "";
    const items = c.items?.length ? ` [${c.items.length > 6 ? `${c.items.slice(0, 6).join(", ")} and ${c.items.length - 6} more` : c.items.join(", ")}]` : "";
    out.push(`- ${c.kind}${axis} (${c.by}): ${c.summary}${items}`);
  }
  return out.join("\n") + "\n";
}

// ---------------------------------------------------------------------------------------------------------------
// Command line

export const PAGE = join(CAP_DIR, "CAPABILITIES.md");

const USAGE = `usage: bun tools/capabilities.ts <command> ... (capabilities/README.md, "Editing", has an example of each)
  validate | render [--check] [--html <dir>] | changes --since <yyyy-mm-dd> [--until <yyyy-mm-dd>]
  show <id> | list [--area --stage --evidence --health --priority --kind --consumer]
  add <area> <id> --title --summary --kind [...] | set <id> <field> <value> | stage|evidence|health|priority <id> <value> [--reason --ref]
  demand <id> --level [--ref --milestone --note] | demand-met <id> [--ref] | request <consumer> <id> --title --summary --kind
  issue add|update|close <id> ... | quirk|limit add <id> <text> | unknown add <id> --question | improve add <id> --summary
  verdict <row> <verdict> --session [--build --date --note --item --apply] | triage <request> --into <id> | rename <old> <new>
  retire <id> --by <id> | format
  every edit takes --as <consumer> (default runtime-bridge, the owner)`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const flag = (name: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (command === "validate") {
    const errors = validate(load(), await realContext());
    if (errors.length) {
      console.error(`capabilities: ${errors.length} problem(s):`);
      for (const e of errors) console.error(`  ${e}`);
      return 1;
    }
    const v = view(load());
    console.log(`capabilities: ok (${v.items.length} items, ${v.changes.length} changelog lines)`);
    return 0;
  }
  if (command === "render") {
    const data = load();
    const errors = validate(data, await realContext());
    if (errors.length) {
      console.error(`capabilities: fix these first (bun tools/capabilities.ts validate):`);
      for (const e of errors) console.error(`  ${e}`);
      return 1;
    }
    const v = view(data);
    const page = renderMarkdown(v);
    if (rest.includes("--check")) {
      const current = existsSync(PAGE) ? readFileSync(PAGE, "utf8").replace(/\r\n/g, "\n") : "";
      if (current !== page) {
        console.error("capabilities: CAPABILITIES.md is out of date; run bun tools/capabilities.ts render");
        return 1;
      }
      console.log("capabilities: CAPABILITIES.md is current");
    } else {
      writeFileSync(PAGE, page);
      console.log(`capabilities: wrote ${PAGE}`);
    }
    const html = flag("--html");
    if (html) {
      mkdirSync(html, { recursive: true });
      writeFileSync(join(html, "index.html"), renderHtml(v));
      console.log(`capabilities: wrote ${join(html, "index.html")}`);
    }
    return 0;
  }
  if (command === "changes") {
    const since = flag("--since");
    if (!since || !isDate(since)) {
      console.error("usage: bun tools/capabilities.ts changes --since <yyyy-mm-dd> [--until <yyyy-mm-dd>]");
      return 2;
    }
    const until = flag("--until");
    process.stdout.write(digest(view(load()).changes, since, until));
    return 0;
  }
  const edit = await import("./capabilities-edit.ts");
  if ((edit.EDIT_COMMANDS as readonly string[]).includes(command ?? "")) {
    const result = await edit.runEdit(argv);
    process.stdout.write(result.out);
    process.stderr.write(result.err);
    return result.code;
  }
  console.error(USAGE);
  return 2;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));

// Edits to the capability registry (capabilities/README.md, "Editing"). Every edit goes through here, never by hand:
// it loads the whole registry, applies the change in memory, sets the item's updated date, appends the matching
// changelog line, runs the full validation on the result, and only then writes, each file through a temporary file and
// a rename, in the canonical format so diffs stay small, together with the regenerated CAPABILITIES.md. A change that
// would fail validation writes nothing and says why. The whole edit holds an exclusive lock (.edit.lock, with stale-lock
// takeover), and publication is a journalled transaction (.edit-journal.json): the temp files are recorded before they
// are written, a commit mark follows the last one, and recovery on the next start rolls back an unfinished write or
// completes a committed one, so no edit lands without its changelog line. --as <consumer> (default runtime-bridge, the owner) says who is editing: a consumer may change only its own
// demand entries and its own requests/<consumer>.json.
//
// tools/capabilities.ts dispatches here; tools/test/capabilities.test.ts drives runEdit on a scratch copy.

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CAP_DIR, EVIDENCE, HEALTH, PRIORITIES, STAGES, canonical, formatChange, formatItems, formatJson, itemDigest, load, realContext, renderMarkdown, validate, view,
  type Change, type Context, type Item, type Loaded,
} from "./capabilities.ts";

type Json = Record<string, any>;

export class EditError extends Error {}

export type EditOptions = {
  capDir?: string;
  /** The validation context (catalogue commands, test-card rows, paths); the real one by default. */
  context?: Context;
  /** The time of the edit, ISO 8601 with an offset; now (once the lock is held) by default. */
  at?: string;
  /** How long to wait for another edit's lock before refusing (10 s by default). */
  lockWaitMs?: number;
  /** Failure injection for the tests: called before each temp-file write, the commit mark and each rename; may throw. */
  fault?: (step: "temp" | "commit" | "rename", path: string) => void;
};

export type EditResult = { code: number; out: string; err: string };

/** Now as ISO 8601 with the local offset, to the second. */
export function localNow(date = new Date()): string {
  const off = -date.getTimezoneOffset();
  const local = new Date(date.getTime() + off * 60_000).toISOString().slice(0, 19);
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Arguments: positionals and --flags; a flag may repeat (lists) and a bare flag is true.

type Args = { positional: string[]; flags: Map<string, string[]> };

export function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq > 0 ? arg.slice(2, eq) : arg.slice(2);
      let value: string;
      if (eq > 0) value = arg.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) value = argv[++i]!;
      else value = "true";
      flags.set(name, [...(flags.get(name) ?? []), value]);
    } else positional.push(arg);
  }
  return { positional, flags };
}

const one = (a: Args, name: string): string | undefined => a.flags.get(name)?.at(-1);
const need = (a: Args, name: string, what: string): string => {
  const v = one(a, name);
  if (v === undefined || v === "true") throw new EditError(`${what} needs --${name}`);
  return v;
};
const list = (a: Args, name: string): string[] | undefined => {
  const values = a.flags.get(name);
  return values ? values.flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean) : undefined;
};
const pos = (a: Args, n: number, what: string): string => {
  const v = a.positional[n];
  if (v === undefined) throw new EditError(`${what}`);
  return v;
};

// ---------------------------------------------------------------------------------------------------------------
// The registry in memory

type State = {
  capDir: string;
  data: Loaded;
  /** items/<area>.json, by area. */
  items: Map<string, Item[]>;
  /** requests/<consumer>.json, by consumer. */
  requests: Map<string, Item[]>;
  /** Files whose content changes. */
  dirtyItems: Set<string>;
  dirtyRequests: Set<string>;
  lines: Change[];
  as: string;
  at: string;
  messages: string[];
};

function loadState(capDir: string, as: string, at: string): State {
  const data = load(capDir);
  if (data.readErrors.length) throw new EditError(`the registry can't be read:\n  ${data.readErrors.join("\n  ")}`);
  const items = new Map<string, Item[]>();
  for (const area of data.registry.areas) items.set(area.id, []);
  for (const f of data.itemFiles) items.set(f.area, structuredClone(f.items as Item[]));
  const requests = new Map<string, Item[]>();
  for (const f of data.requestFiles) requests.set(f.consumer, structuredClone(f.items as Item[]));
  if (!data.registry.consumers.some((c) => c.id === as)) throw new EditError(`--as '${as}' is not a consumer in registry.json (${data.registry.consumers.map((c) => c.id).join(", ")})`);
  return { capDir, data, items, requests, dirtyItems: new Set(), dirtyRequests: new Set(), lines: [], as, at, messages: [] };
}

const isOwner = (s: State) => s.as === s.data.registry.owner;
function ownerOnly(s: State, what: string): void {
  if (!isOwner(s)) throw new EditError(`${what} is an owner field: only ${s.data.registry.owner} changes it (you are --as ${s.as}). Say what looks wrong in a message to the owner instead.`);
}

type Found = { item: Item; area?: string; consumer?: string };
function find(s: State, id: string): Found | undefined {
  for (const [area, items] of s.items) {
    const item = items.find((i) => i.id === id);
    if (item) return { item, area };
  }
  for (const [consumer, items] of s.requests) {
    const item = items.find((i) => i.id === id);
    if (item) return { item, consumer };
  }
  return undefined;
}
function get(s: State, id: string): Found {
  const found = find(s, id);
  if (!found) throw new EditError(`'${id}' is not an item or a request (bun tools/capabilities.ts list shows them)`);
  return found;
}
function touch(s: State, found: Found): void {
  found.item.updated = s.at.slice(0, 10);
  if (found.area) s.dirtyItems.add(found.area);
  if (found.consumer) s.dirtyRequests.add(found.consumer);
}
function log(s: State, change: Omit<Change, "at" | "by">, refs?: string[]): void {
  const line: Change = { at: s.at, by: s.as, ...change } as Change;
  if (refs?.length) line.refs = refs;
  s.lines.push(line);
}

const oneOf = <T extends string>(value: string, allowed: readonly T[], what: string): T => {
  if (!allowed.includes(value as T)) throw new EditError(`${what} '${value}' is not one of ${allowed.join(", ")}`);
  return value as T;
};

// ---------------------------------------------------------------------------------------------------------------
// Commands

const OWNER_FIELDS_BLOCKED = new Set(["id", "area", "demand", "updated"]);

function cmdAdd(s: State, a: Args): void {
  ownerOnly(s, "Adding an item");
  const area = pos(a, 0, "usage: add <area> <id> --title <t> --summary <s> --kind <kind> [--stage --evidence --health --priority --reason ...]");
  const id = pos(a, 1, "add needs the new item's id");
  if (!s.items.has(area)) throw new EditError(`'${area}' is not an area in registry.json`);
  if (find(s, id)) throw new EditError(`'${id}' already exists`);
  const item: Item = {
    id, title: need(a, "title", "add"), summary: need(a, "summary", "add"), area, kind: need(a, "kind", "add"),
    stage: one(a, "stage") ?? "proposed", evidence: one(a, "evidence") ?? "none", health: one(a, "health") ?? "unknown",
    priority: one(a, "priority") ?? "P3", updated: s.at.slice(0, 10),
  } as Item;
  const optional: [string, string | string[] | undefined][] = [
    ["priority_reason", one(a, "reason")], ["parent", one(a, "parent")], ["branch", one(a, "branch")], ["since", one(a, "since")],
    ["changed_in", one(a, "changed-in")], ["depends_on", list(a, "depends")], ["docs", list(a, "doc")], ["notes", one(a, "notes")],
  ];
  for (const [key, value] of optional) if (value !== undefined) item[key] = value;
  const surface: Json = {};
  for (const key of ["commands", "events", "config", "code"]) {
    const value = key === "config" ? a.flags.get(key) : list(a, key);
    if (value) surface[key] = value;
  }
  if (Object.keys(surface).length) item.surface = surface;
  s.items.get(area)!.push(item);
  s.dirtyItems.add(area);
  log(s, { kind: "added", items: [id], summary: one(a, "summary-line") ?? `Added: ${item.title}.` }, list(a, "ref"));
}

/** A JSON value from the command line: JSON when it parses, otherwise the text itself. */
function parseValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function setPath(target: Json, path: string[], value: unknown): unknown {
  let node = target;
  for (const key of path.slice(0, -1)) {
    if (typeof node[key] !== "object" || node[key] === null) node[key] = {};
    node = node[key];
  }
  const last = path.at(-1)!;
  const before = node[last];
  if (value === null) delete node[last];
  else node[last] = value;
  return before;
}

function cmdSet(s: State, a: Args, axis?: "stage" | "evidence" | "health" | "priority"): void {
  const id = pos(a, 0, axis ? `usage: ${axis} <id> <value> [--reason <why>] [--ref <ref>] [--summary <sentence>]` : "usage: set <id> <field> <value>");
  const field = axis ?? pos(a, 1, "set needs a field (e.g. title, branch, surface.commands)");
  const raw = pos(a, axis ? 1 : 2, axis ? `${axis} needs a value` : "set needs a value (JSON, or plain text; null removes the field)");
  const path = field.split(".");
  if (OWNER_FIELDS_BLOCKED.has(path[0]!)) throw new EditError(path[0] === "demand" ? "demand entries change through the demand and demand-met commands" : `'${path[0]}' can't be set (use rename for the id, add for a new item; updated is set by every edit)`);
  ownerOnly(s, `'${field}'`);
  const found = get(s, id);
  const isAxis = path.length === 1 && ["stage", "evidence", "health", "priority"].includes(field);
  const value = isAxis ? raw : parseValue(raw);
  if (isAxis) oneOf(raw, ({ stage: STAGES, evidence: EVIDENCE, health: HEALTH, priority: PRIORITIES } as const)[field as "stage"], field);
  const before = setPath(found.item, path, value);
  if (JSON.stringify(before) === JSON.stringify(value)) throw new EditError(`${id}: ${field} is already ${JSON.stringify(value)}`);
  const reason = one(a, "reason");
  if (field === "priority" && reason) found.item.priority_reason = reason;
  if (field === "priority" && (value === "P2" || value === "P3") && !reason) delete found.item.priority_reason;
  if (field === "stage" && value === "retired") throw new EditError("use retire <id> --by <replacement> for a retirement");
  touch(s, found);
  const summary = one(a, "summary") ?? (isAxis ? `${found.item.title}: ${field} ${String(before)} to ${String(value)}${reason ? ` (${reason})` : ""}.` : `${found.item.title}: ${field} changed.`);
  log(s, isAxis ? { kind: field, items: [id], from: before, to: value, summary } : { kind: "detail", items: [id], summary }, list(a, "ref"));
}

function cmdDemand(s: State, a: Args): void {
  const id = pos(a, 0, "usage: demand <id> --level blocking|needs|wants [--ref <their id>] [--milestone M4] [--note <their words>] [--as <consumer>]");
  const found = get(s, id);
  const level = oneOf(need(a, "level", "demand"), ["blocking", "needs", "wants"] as const, "level");
  const ref = one(a, "ref");
  const demand: Json[] = (found.item.demand ??= []);
  const existing = demand.find((d) => d.consumer === s.as && (d.ref ?? null) === (ref ?? null));
  const entry: Json = existing ?? { consumer: s.as, level, since: s.at.slice(0, 10) };
  entry.level = level;
  if (ref !== undefined) entry.ref = ref;
  for (const key of ["milestone", "note"]) {
    const value = one(a, key);
    if (value !== undefined) entry[key] = value;
  }
  delete entry.met;
  if (!existing) demand.push(entry);
  touch(s, found);
  log(s, { kind: "demand", items: [id], summary: one(a, "summary") ?? `${s.as} ${existing ? "updates its" : "adds a"} ${level} demand${ref ? ` (${ref})` : ""} on ${found.item.title}.` });
}

function cmdDemandMet(s: State, a: Args): void {
  const id = pos(a, 0, "usage: demand-met <id> [--ref <their id>] [--consumer <id>, owner only] [--as <consumer>]");
  const found = get(s, id);
  const consumer = one(a, "consumer") ?? s.as;
  if (consumer !== s.as && !isOwner(s)) throw new EditError(`only ${consumer} (or the owner) marks ${consumer}'s demand met`);
  const ref = one(a, "ref");
  const matches = (found.item.demand ?? []).filter((d: Json) => d.consumer === consumer && (ref === undefined || d.ref === ref) && !d.met);
  if (!matches.length) throw new EditError(`${id} has no open demand from ${consumer}${ref ? ` with ref ${ref}` : ""}`);
  if (matches.length > 1 && ref === undefined) throw new EditError(`${id} has ${matches.length} open demands from ${consumer}: name one with --ref (${matches.map((d: Json) => d.ref ?? "(none)").join(", ")})`);
  matches[0].met = s.at.slice(0, 10);
  touch(s, found);
  log(s, { kind: "demand", items: [id], summary: `${consumer}'s demand${matches[0].ref ? ` ${matches[0].ref}` : ""} on ${found.item.title} is met.` });
}

function pickEntry(entries: Json[], key: string, what: string): Json {
  const byIndex = /^\d+$/.test(key) ? entries[Number(key) - 1] : undefined;
  const byRef = entries.filter((e) => e.ref === key);
  if (byIndex) return byIndex;
  if (byRef.length === 1) return byRef[0]!;
  throw new EditError(`no single ${what} '${key}': give its number (1 to ${entries.length}) or its ref`);
}

function cmdIssue(s: State, a: Args): void {
  ownerOnly(s, "Known issues");
  const action = pos(a, 0, "usage: issue add|update|close <id> ...");
  const id = pos(a, 1, `issue ${action} needs an item id`);
  const found = get(s, id);
  const issues: Json[] = (found.item.known_issues ??= []);
  let summary: string;
  if (action === "add") {
    const issue: Json = { summary: need(a, "summary", "issue add"), severity: oneOf(need(a, "severity", "issue add"), ["high", "medium", "low"] as const, "severity"), status: oneOf(one(a, "status") ?? "open", ["open", "fixing", "fixed-unverified", "fixed", "wontfix"] as const, "status"), since: s.at.slice(0, 10) };
    const ref = one(a, "ref");
    if (ref) issue.ref = ref;
    issues.push(issue);
    summary = `New ${issue.severity} issue on ${found.item.title}: ${issue.summary}`;
  } else if (action === "update" || action === "close") {
    const issue = pickEntry(issues, pos(a, 2, `issue ${action} needs the issue's number or ref`), "issue");
    const status = action === "close" ? oneOf(one(a, "status") ?? "fixed", ["fixed", "wontfix"] as const, "status") : one(a, "status");
    if (status) issue.status = oneOf(status, ["open", "fixing", "fixed-unverified", "fixed", "wontfix"] as const, "status");
    const severity = one(a, "severity");
    if (severity) issue.severity = oneOf(severity, ["high", "medium", "low"] as const, "severity");
    for (const key of ["summary", "ref"]) if (one(a, key) && action === "update") issue[key] = one(a, key);
    summary = `${found.item.title}: issue ${issue.ref ?? ""} ${action === "close" ? `closed (${issue.status})` : `now ${issue.status}, ${issue.severity}`}.`.replace("  ", " ");
  } else throw new EditError(`issue ${action}: use add, update or close`);
  if (summary.length > 300) summary = `${summary.slice(0, 296)}...`;
  touch(s, found);
  log(s, { kind: "issue", items: [id], summary }, list(a, "log-ref"));
}

function cmdListField(s: State, a: Args, kind: "quirk" | "limit" | "unknown" | "improve"): void {
  ownerOnly(s, `${kind === "improve" ? "Improvements" : `${kind[0]!.toUpperCase()}${kind.slice(1)}s`}`);
  const action = pos(a, 0, `usage: ${kind} add <id> ...`);
  if (action !== "add") throw new EditError(`${kind} ${action}: only add exists; remove one with set <id> <field> <json list>`);
  const id = pos(a, 1, `${kind} add needs an item id`);
  const found = get(s, id);
  let what: string;
  if (kind === "quirk" || kind === "limit") {
    const text = a.positional.slice(2).join(" ") || need(a, "text", `${kind} add`);
    const field = kind === "quirk" ? "quirks" : "limits";
    (found.item[field] ??= []).push(text);
    what = text;
  } else if (kind === "unknown") {
    const entry: Json = { question: need(a, "question", "unknown add") };
    if (one(a, "settle-by")) entry.settle_by = one(a, "settle-by");
    if (one(a, "needs-game")) entry.needs_game = one(a, "needs-game") !== "false";
    (found.item.unknowns ??= []).push(entry);
    what = entry.question;
  } else {
    const entry: Json = { summary: need(a, "summary", "improve add") };
    if (one(a, "value")) entry.value = oneOf(one(a, "value")!, ["high", "medium", "low"] as const, "value");
    if (one(a, "effort")) entry.effort = oneOf(one(a, "effort")!, ["small", "medium", "large"] as const, "effort");
    (found.item.improvements ??= []).push(entry);
    what = entry.summary;
  }
  touch(s, found);
  const label = { quirk: "A quirk", limit: "A limit", unknown: "An open question", improve: "A possible improvement" }[kind];
  log(s, { kind: "detail", items: [id], summary: `${label} for ${found.item.title}: ${what}`.slice(0, 300) });
}

/** The evidence a set of row verdicts suggests. */
export function suggestEvidence(current: string, verdicts: string[]): string {
  const passed = verdicts.filter((v) => v === "pass").length;
  const failed = verdicts.some((v) => v === "fail");
  if (current === "proven" && failed) return "regressed";
  if (passed && passed === verdicts.length) return "proven";
  if (passed || verdicts.includes("partial")) return current === "proven" ? "proven" : "partial";
  return current;
}

function cmdVerdict(s: State, a: Args): void {
  ownerOnly(s, "Verdicts");
  const row = pos(a, 0, "usage: verdict <row> <unrun|pass|partial|fail|inconclusive|skipped> --session <s> [--build <b>] [--date <d>] [--note <n>] [--item <id>] [--apply]");
  const verdict = oneOf(pos(a, 1, "verdict needs a verdict"), ["unrun", "pass", "partial", "fail", "inconclusive", "skipped"] as const, "verdict");
  const only = list(a, "item");
  const targets: Found[] = [];
  for (const [area, items] of s.items) for (const item of items) if ((item.verification?.rows ?? []).some((r: Json) => r.row === row) && (!only || only.includes(item.id))) targets.push({ item, area });
  if (only) for (const id of only) if (!targets.some((t) => t.item.id === id)) {
    // An item that doesn't list the row yet: --item adds it.
    const found = get(s, id);
    (found.item.verification ??= {}).rows ??= [];
    found.item.verification.rows.push({ row, verdict: "unrun" });
    targets.push(found);
  }
  if (!targets.length) throw new EditError(`no item lists row ${row} (add it to one with --item <id>)`);
  const session = one(a, "session");
  if (verdict !== "unrun" && !session) throw new EditError(`a ${verdict} verdict needs --session`);
  for (const found of targets) {
    for (const r of found.item.verification.rows as Json[]) {
      if (r.row !== row) continue;
      for (const key of ["session", "build", "date", "note"]) delete r[key];
      r.verdict = verdict;
      if (session) r.session = session;
      if (one(a, "build")) r.build = one(a, "build");
      r.date = one(a, "date") ?? s.at.slice(0, 10);
      if (verdict === "unrun") delete r.date;
      if (one(a, "note")) r.note = one(a, "note");
    }
    touch(s, found);
    const verdicts = (found.item.verification.rows as Json[]).map((r) => r.verdict);
    const suggested = suggestEvidence(found.item.evidence, verdicts);
    log(s, { kind: "detail", items: [found.item.id], summary: `Row ${row}: ${verdict}${session ? ` (${session})` : ""} on ${found.item.title}.` });
    if (suggested !== found.item.evidence) {
      if (a.flags.has("apply")) {
        const before = found.item.evidence;
        found.item.evidence = suggested;
        log(s, { kind: "evidence", items: [found.item.id], from: before, to: suggested, summary: `${found.item.title}: evidence ${before} to ${suggested} after row ${row}.` });
      } else s.messages.push(`suggestion: ${found.item.id} evidence ${found.item.evidence} -> ${suggested} (run: evidence ${found.item.id} ${suggested}, or repeat with --apply)`);
    }
  }
}

function cmdRequest(s: State, a: Args): void {
  const consumer = pos(a, 0, "usage: request <consumer> <area.name> --title <t> --summary <s> --kind <kind> [--level needs] [--ref] [--milestone] [--note]");
  const id = pos(a, 1, "request needs the ask's id (<area>.<name>)");
  if (consumer !== s.as && !isOwner(s)) throw new EditError(`only ${consumer} (or the owner) files asks in requests/${consumer}.json`);
  if (!s.data.registry.consumers.some((c) => c.id === consumer)) throw new EditError(`'${consumer}' is not a consumer in registry.json`);
  if (find(s, id)) throw new EditError(`'${id}' already exists`);
  const area = id.split(".")[0]!;
  if (!s.items.has(area)) throw new EditError(`the id's area '${area}' is not an area in registry.json`);
  const demand: Json = { consumer, level: oneOf(one(a, "level") ?? "needs", ["blocking", "needs", "wants"] as const, "level"), since: s.at.slice(0, 10) };
  for (const key of ["ref", "milestone", "note"]) if (one(a, key)) demand[key] = one(a, key);
  const item = { id, title: need(a, "title", "request"), summary: need(a, "summary", "request"), area, kind: need(a, "kind", "request"), stage: "requested", evidence: "none", health: "unknown", priority: "P3", demand: [demand], updated: s.at.slice(0, 10) } as Item;
  if (!s.requests.has(consumer)) s.requests.set(consumer, []);
  s.requests.get(consumer)!.push(item);
  s.dirtyRequests.add(consumer);
  log(s, { kind: "added", items: [id], summary: `${consumer} asks for: ${item.title}.` });
}

function removeFrom(s: State, found: Found): void {
  if (found.area) {
    const items = s.items.get(found.area)!;
    items.splice(items.indexOf(found.item), 1);
    s.dirtyItems.add(found.area);
  } else if (found.consumer) {
    const items = s.requests.get(found.consumer)!;
    items.splice(items.indexOf(found.item), 1);
    s.dirtyRequests.add(found.consumer);
  }
}

function cmdTriage(s: State, a: Args): void {
  ownerOnly(s, "Triage");
  const requestId = pos(a, 0, "usage: triage <request id> --into <item id> [--stage proposed|planned] [--priority P2]");
  const into = need(a, "into", "triage");
  const request = get(s, requestId);
  if (!request.consumer) throw new EditError(`'${requestId}' is an item, not a request`);
  // Into its own id is a promotion: the request becomes an item under the same id, so every reference stays valid.
  const target = into === requestId ? undefined : find(s, into);
  if (target && target.consumer) throw new EditError(`'${into}' is another request; triage into an item`);
  removeFrom(s, request);
  if (target) {
    // Merge: carry the request's demand across.
    const demand: Json[] = (target.item.demand ??= []);
    for (const d of request.item.demand ?? []) if (!demand.some((x) => x.consumer === d.consumer && (x.ref ?? null) === (d.ref ?? null))) demand.push(d);
    touch(s, target);
    log(s, { kind: "removed", items: [requestId], summary: `${request.consumer}'s ask '${request.item.title}' is merged into ${into}.` });
    log(s, { kind: "demand", items: [into], summary: `${request.consumer}'s demand from its ask ${requestId} now sits on ${target.item.title}.` });
  } else {
    const area = into.split(".")[0]!;
    if (!s.items.has(area)) throw new EditError(`the id's area '${area}' is not an area in registry.json`);
    const item = { ...request.item, id: into, area, stage: one(a, "stage") ?? "proposed", priority: one(a, "priority") ?? request.item.priority, updated: s.at.slice(0, 10) } as Item;
    oneOf(item.stage, STAGES, "stage");
    s.items.get(area)!.push(item);
    s.dirtyItems.add(area);
    if (into !== requestId) {
      log(s, { kind: "removed", items: [requestId], summary: `${request.consumer}'s ask is triaged as ${into}.` });
      retarget(s, requestId, into);
    }
    log(s, { kind: "added", items: [into], summary: `${into === requestId ? "Promoted" : "Triaged"} from ${request.consumer}'s ask: ${item.title} (stage ${item.stage}).` });
  }
}

/** Every depends_on and parent naming `from` now names `to`; the items it changed (other than `except`). */
function retarget(s: State, from: string, to: string, except?: Item): string[] {
  const refs: string[] = [];
  for (const [owner, group] of [...[...s.items].map(([k, v]) => [{ area: k }, v] as const), ...[...s.requests].map(([k, v]) => [{ consumer: k }, v] as const)]) {
    for (const item of group) {
      let changed = false;
      if (item.parent === from) (item.parent = to), (changed = true);
      if (item.depends_on?.includes(from)) (item.depends_on = item.depends_on.map((d: string) => (d === from ? to : d))), (changed = true);
      if (changed && item !== except) {
        touch(s, { item, ...owner });
        refs.push(item.id);
      }
    }
  }
  if (refs.length && !except) log(s, { kind: "detail", items: refs, summary: `References to ${from} now name ${to}.` });
  return refs;
}

function cmdRename(s: State, a: Args): void {
  ownerOnly(s, "Renaming");
  const from = pos(a, 0, "usage: rename <old id> <new id>");
  const to = pos(a, 1, "rename needs the new id");
  if (find(s, to)) throw new EditError(`'${to}' already exists`);
  const found = get(s, from);
  const area = to.split(".")[0]!;
  if (!s.items.has(area)) throw new EditError(`the new id's area '${area}' is not an area in registry.json`);
  found.item.id = to;
  if (found.area && area !== found.area) {
    removeFrom(s, found);
    found.item.area = area;
    s.items.get(area)!.push(found.item);
    found.area = area;
  } else if (found.consumer) found.item.area = area;
  touch(s, found);
  const refs = retarget(s, from, to, found.item);
  log(s, { kind: "removed", items: [from], summary: `Renamed to ${to}.` });
  log(s, { kind: "added", items: [to], summary: `Renamed from ${from}.` });
  if (refs.length) log(s, { kind: "detail", items: refs, summary: `References to ${from} now name ${to}.` });
}

function cmdRetire(s: State, a: Args): void {
  ownerOnly(s, "Retiring");
  const id = pos(a, 0, "usage: retire <id> --by <replacement id> [--reason <why>]");
  const by = one(a, "by");
  const found = get(s, id);
  if (by && !find(s, by)) throw new EditError(`the replacement '${by}' is not an item`);
  const before = found.item.stage;
  if (before === "retired") throw new EditError(`${id} is already retired`);
  found.item.stage = "retired";
  const note = by ? `Retired, replaced by ${by}.` : `Retired${one(a, "reason") ? `: ${one(a, "reason")}` : "."}`;
  found.item.notes = found.item.notes ? `${found.item.notes} ${note}` : note;
  touch(s, found);
  log(s, { kind: "retired", items: by ? [id, by] : [id], from: before, to: "retired", summary: `${found.item.title}: ${note}` });
}

/** Records the digest baseline: one line naming every item whose newest line has no digest (the migration to digests). */
function cmdAudit(s: State, a: Args): void {
  ownerOnly(s, "The digest baseline");
  if (!a.flags.has("baseline")) throw new EditError("usage: audit --baseline (records a digest for every item whose newest changelog line has none)");
  const parsed = s.data.changes.map((c) => JSON.parse(c.text) as Change);
  const ids: string[] = [];
  for (const group of [...s.items.values(), ...s.requests.values()]) {
    for (const item of group) {
      const last = [...parsed].reverse().find((c) => (c.items ?? []).includes(item.id) && c.kind !== "removed");
      if (!last?.digests?.[item.id]) ids.push(item.id);
    }
  }
  if (!ids.length) throw new EditError("every item's newest changelog line already has its digest; a mismatch means a change without its line: redo it through the tool");
  log(s, {
    kind: "schema", items: ids,
    summary: one(a, "summary") ?? "Changelog lines now carry each named item's digest (and verification rows can be marked optional); this line records the baseline digest of every item.",
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Commit: validate the whole result, then write atomically.

function render(s: State): { files: Map<string, string>; data: Loaded } {
  const files = new Map<string, string>();
  const schema = s.data.schemas.item;
  for (const area of s.dirtyItems) files.set(join(s.capDir, "items", `${area}.json`), formatItems(s.items.get(area)!, schema));
  for (const consumer of s.dirtyRequests) files.set(join(s.capDir, "requests", `${consumer}.json`), formatItems(s.requests.get(consumer)!, schema));
  // Each new line records the digests of the items it names, as they are after the whole edit.
  for (const line of s.lines) {
    if (line.kind === "removed" || !line.items?.length) continue;
    const digests: Record<string, string> = {};
    for (const id of line.items) {
      const found = find(s, id);
      if (found) digests[id] = itemDigest(found.item, schema);
    }
    if (Object.keys(digests).length) line.digests = digests;
  }
  const byMonth = new Map<string, string[]>();
  for (const line of s.lines) {
    const month = line.at.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), formatChange(line, s.data.schemas.change)]);
  }
  for (const [month, lines] of byMonth) {
    const path = join(s.capDir, "changelog", `${month}.jsonl`);
    const prior = existsSync(path) ? readFileSync(path, "utf8").replace(/\r\n/g, "\n") : "";
    files.set(path, prior + (prior && !prior.endsWith("\n") ? "\n" : "") + lines.join("\n") + "\n");
  }
  // The result as validate() reads it, without touching the disk.
  const data: Loaded = {
    ...s.data,
    itemFiles: [...s.items].filter(([area, items]) => items.length || s.data.itemFiles.some((f) => f.area === area)).map(([area, items]) => ({ file: `items/${area}.json`, area, items, text: formatItems(items, schema) })).sort((x, y) => x.file.localeCompare(y.file)),
    requestFiles: [...s.requests].map(([consumer, items]) => ({ file: `requests/${consumer}.json`, consumer, items, text: formatItems(items, schema) })).sort((x, y) => x.file.localeCompare(y.file)),
    changes: [
      ...s.data.changes,
      ...s.lines.map((line, i) => ({ file: `changelog/${line.at.slice(0, 7)}.jsonl`, line: 1_000_000 + i, text: formatChange(line, s.data.schemas.change) })),
    ],
    journal: false,
  };
  // The page is regenerated in the same write, so it can never drift from the data.
  files.set(join(s.capDir, "CAPABILITIES.md"), renderMarkdown(view(data)));
  return { files, data };
}

export const JOURNAL = ".edit-journal.json";
export const LOCK = ".edit.lock";
/** A lock older than this is stale whoever holds it (an edit takes well under a second). */
const LOCK_STALE_MS = 10 * 60_000;

type Journal = { state: "writing" | "commit"; files: { path: string; temp: string }[] };

function writeJournal(capDir: string, journal: Journal): void {
  const path = join(capDir, JOURNAL);
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, JSON.stringify(journal, null, 2) + "\n");
  renameSync(temp, path);
}

const removeIfThere = (path: string) => {
  if (existsSync(path)) unlinkSync(path);
};

/**
 * Publishes the files as one transaction. The journal lists every temp file before any is written; a failure while
 * writing removes them and publishes nothing. The commit mark follows the last temp; from then on the renames are
 * completed, now or by recover() on the next start, so data never lands without its changelog line.
 */
export function publish(capDir: string, files: Map<string, string>, fault?: EditOptions["fault"]): void {
  const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const entries = [...files.keys()].map((path) => ({ path, temp: `${path}.tmp-${stamp}` }));
  const journal: Journal = { state: "writing", files: entries.map((e) => ({ path: relativeTo(capDir, e.path), temp: relativeTo(capDir, e.temp) })) };
  writeJournal(capDir, journal);
  try {
    for (const { path, temp } of entries) {
      fault?.("temp", path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(temp, files.get(path)!);
    }
    fault?.("commit", join(capDir, JOURNAL));
    writeJournal(capDir, { ...journal, state: "commit" });
  } catch (error) {
    for (const { temp } of entries) removeIfThere(temp);
    removeIfThere(join(capDir, JOURNAL));
    throw error;
  }
  try {
    for (const { path, temp } of entries) {
      fault?.("rename", path);
      renameSync(temp, path);
    }
  } catch (error) {
    throw new Error(`the edit was interrupted while publishing (${(error as Error).message}); the next run of the tool completes it`);
  }
  removeIfThere(join(capDir, JOURNAL));
}

function relativeTo(capDir: string, path: string): string {
  return path.slice(capDir.length + 1).replaceAll("\\", "/");
}

/** Finishes or undoes an interrupted publish; a message when there was one. Run under the lock, before loading. */
export function recover(capDir: string): string {
  // A journal's own temp file is from a crash before the journal existed: nothing was written under it.
  for (const f of existsSync(capDir) ? readdirSync(capDir) : []) if (f.startsWith(`${JOURNAL}.tmp-`)) unlinkSync(join(capDir, f));
  const path = join(capDir, JOURNAL);
  if (!existsSync(path)) return "";
  const journal = JSON.parse(readFileSync(path, "utf8")) as Journal;
  if (journal.state === "commit") {
    for (const f of journal.files) if (existsSync(join(capDir, f.temp))) renameSync(join(capDir, f.temp), join(capDir, f.path));
  } else {
    for (const f of journal.files) removeIfThere(join(capDir, f.temp));
  }
  unlinkSync(path);
  return journal.state === "commit"
    ? `recovered: an interrupted edit was completed (${journal.files.length} file(s))`
    : "recovered: an interrupted edit was rolled back (nothing had been published)";
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Takes the registry's exclusive lock, waiting up to waitMs; a lock whose process is gone, or that is too old, is taken over. */
function acquireLock(capDir: string, waitMs: number): () => void {
  const path = join(capDir, LOCK);
  const token = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, token, started: new Date().toISOString() }));
      closeSync(fd);
      return () => {
        try {
          if (JSON.parse(readFileSync(path, "utf8")).token === token) unlinkSync(path);
        } catch {
          /* already gone */
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    let holder: { pid?: number; started?: string } = {};
    try {
      holder = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      // Being written this instant, or damaged: stale only once it is a few seconds old.
      try {
        if (Date.now() - statSync(path).mtimeMs > 5_000) holder = { pid: -1 };
      } catch {
        continue;
      }
    }
    const age = holder.started ? Date.now() - Date.parse(holder.started) : 0;
    if ((holder.pid !== undefined && (holder.pid < 0 || !alive(holder.pid))) || age > LOCK_STALE_MS) {
      removeIfThere(path);
      continue;
    }
    if (Date.now() >= deadline) throw new EditError(`another edit holds the registry (process ${holder.pid ?? "unknown"}, since ${holder.started ?? "unknown"}); try again in a moment`);
    Bun.sleepSync(20 + Math.floor(Math.random() * 30));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Reads

function cmdShow(s: State, a: Args): string {
  const found = get(s, pos(a, 0, "usage: show <id>"));
  return `${found.area ? `items/${found.area}.json` : `requests/${found.consumer}.json`}\n${formatJson(canonical(found.item, s.data.schemas.item))}\n`;
}

function cmdList(s: State, a: Args): string {
  const filters: [string, string | undefined][] = ["area", "stage", "evidence", "health", "priority", "kind"].map((k) => [k, one(a, k)]);
  const consumer = one(a, "consumer");
  const rows: string[] = [];
  const all = [...[...s.items.values()].flat(), ...[...s.requests.values()].flat()];
  for (const item of all) {
    if (filters.some(([k, v]) => v !== undefined && item[k] !== v)) continue;
    if (consumer && !(item.demand ?? []).some((d: Json) => d.consumer === consumer && !d.met)) continue;
    rows.push(`${item.id.padEnd(36)} ${item.stage.padEnd(9)} ${item.evidence.padEnd(9)} ${item.health.padEnd(8)} ${item.priority}  ${item.title}`);
  }
  return `${rows.join("\n")}\n${rows.length} of ${all.length}\n`;
}

// ---------------------------------------------------------------------------------------------------------------

export const EDIT_COMMANDS = ["add", "set", "stage", "evidence", "health", "priority", "demand", "demand-met", "issue", "quirk", "limit", "unknown", "improve", "verdict", "request", "triage", "rename", "retire", "audit", "format", "recover", "show", "list"] as const;

export async function runEdit(argv: string[], options: EditOptions = {}): Promise<EditResult> {
  const [command, ...rest] = argv;
  const a = parseArgs(rest);
  const as = one(a, "as") ?? "runtime-bridge";
  const capDir = options.capDir ?? CAP_DIR;
  let release: (() => void) | undefined;
  try {
    // The lock covers everything from loading to publication, so concurrent edits never overwrite each other.
    release = acquireLock(capDir, options.lockWaitMs ?? 10_000);
    const recovered = recover(capDir);
    const note = recovered ? `${recovered}\n` : "";
    const s = loadState(capDir, as, options.at ?? localNow());
    if (command === "recover") return { code: 0, out: note || "nothing to recover\n", err: "" };
    if (command === "show") return { code: 0, out: note + cmdShow(s, a), err: "" };
    if (command === "list") return { code: 0, out: note + cmdList(s, a), err: "" };
    const context = options.context ?? (await realContext());
    if (command === "format") {
      ownerOnly(s, "Reformatting");
      for (const area of s.items.keys()) if (s.data.itemFiles.some((f) => f.area === area)) s.dirtyItems.add(area);
      for (const consumer of s.requests.keys()) s.dirtyRequests.add(consumer);
      // Changelog lines are rewritten in place in their canonical form (no new line: a format is not a change).
      const { files, data } = render(s);
      const byFile = new Map<string, string[]>();
      for (const c of s.data.changes) byFile.set(c.file, [...(byFile.get(c.file) ?? []), formatChange(JSON.parse(c.text), s.data.schemas.change)]);
      for (const [file, lines] of byFile) files.set(join(capDir, file), lines.join("\n") + "\n");
      data.changes = s.data.changes.map((c) => ({ ...c, text: formatChange(JSON.parse(c.text), s.data.schemas.change) }));
      files.set(join(capDir, "CAPABILITIES.md"), renderMarkdown(view(data)));
      const errors = validate(data, context);
      publish(capDir, files, options.fault);
      return { code: errors.length ? 1 : 0, out: `${note}formatted ${files.size} file(s)\n`, err: errors.length ? `still invalid after formatting:\n  ${errors.join("\n  ")}\n` : "" };
    }
    switch (command) {
      case "add": cmdAdd(s, a); break;
      case "set": cmdSet(s, a); break;
      case "stage": case "evidence": case "health": case "priority": cmdSet(s, a, command); break;
      case "demand": cmdDemand(s, a); break;
      case "demand-met": cmdDemandMet(s, a); break;
      case "issue": cmdIssue(s, a); break;
      case "quirk": case "limit": case "unknown": case "improve": cmdListField(s, a, command); break;
      case "verdict": cmdVerdict(s, a); break;
      case "request": cmdRequest(s, a); break;
      case "triage": cmdTriage(s, a); break;
      case "rename": cmdRename(s, a); break;
      case "retire": cmdRetire(s, a); break;
      case "audit": cmdAudit(s, a); break;
      default: throw new EditError(`unknown command '${command}' (${EDIT_COMMANDS.join(", ")})`);
    }
    const { files, data } = render(s);
    // Only problems the edit introduces refuse it, so the tool can also repair a registry that is already invalid.
    const before = new Set(validate(s.data, context));
    const errors = validate(data, context);
    const introduced = errors.filter((e) => !before.has(e));
    if (introduced.length) {
      return { code: 1, out: note + s.messages.map((m) => `${m}\n`).join(""), err: `nothing written: the result would not validate:\n  ${introduced.join("\n  ")}\n` };
    }
    publish(capDir, files, options.fault);
    const remaining = errors.length ? [`note: ${errors.length} problem(s) from before this edit remain (bun tools/capabilities.ts validate)`] : [];
    const out = note + [...s.lines.map((l) => `logged: ${l.kind} ${(l.items ?? []).length > 6 ? `${l.items!.length} items` : (l.items ?? []).join(", ")}: ${l.summary}`), ...s.messages, ...remaining].join("\n") + "\n";
    return { code: 0, out, err: "" };
  } catch (error) {
    if (error instanceof EditError) return { code: 1, out: "", err: `refused: ${error.message}\n` };
    return { code: 1, out: "", err: `failed: ${(error as Error).message}\n` };
  } finally {
    release?.();
  }
}

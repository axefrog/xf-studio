// Closed, versioned predicates over observations. Property paths select plain data; nothing evaluates code.
import { bool, int, num, obj, str, validate, type JsonSchema } from "../api/schema.ts";
import type { ActorWindow, EventWindow, FileEvidence, Json, ValueWindow } from "./windows.ts";

export type Candidate = { plugin_version: string; build_commit: string; natives: number; write_classes: string[] };
type EventMatch = { kind: string; subject?: string; message_id?: number };
type AssertionMeta = { do: "assert"; label?: string; row?: string; evidence_grade?: "state" | "geometry"; bind?: string; continue_on_error?: boolean };
/** Runtime observations after schema-2 reference resolution. Serialized steps are checked by assertionSchema. */
export type AssertionSpec = AssertionMeta & (
  | { check: "equals"; actual: unknown; expected: unknown }
  | { check: "range"; actual: number; min: number; max: number }
  | { check: "restored"; actual: unknown; baseline: unknown }
  | { check: "no_loss"; window: EventWindow }
  | { check: "no_event"; window: EventWindow; kind: string; subject?: string; message_id?: number }
  | { check: "sequence"; window: EventWindow; events: EventMatch[] }
  | { check: "eventually"; window: ValueWindow; path: string; expected: unknown }
  | { check: "stable_for"; window: ValueWindow; path: string; expected: unknown; duration_s: number; max_gap_ms?: number }
  | { check: "rects_disjoint"; rects: { x: number; y: number; width: number; height: number }[] }
  | { check: "moves_forward"; window: ActorWindow; min_distance_m?: number; max_backwards_s?: number; min_forward_fraction?: number; turn_deadline_s?: number }
  | { check: "actor_arrived"; window: ActorWindow; max_range_m: number }
  | { check: "actor_released"; window: ActorWindow; endpoint_tolerance_m?: number }
  | { check: "bridge_ready"; actual: unknown; candidate: Candidate; logs: unknown }
);

export type Verdict = "PASS" | "FAIL" | "INCONCLUSIVE" | "NOT RUN";
export type AssertionResult = {
  row: string; subcheck: string; predicate: string; version: 1; evidence_grade: "state" | "geometry";
  verdict: Verdict; expected: unknown; actual: unknown; source_time: unknown; evidence: (string | FileEvidence)[]; missing: string[];
  inputs: unknown;
};
const value: JsonSchema = {}; // JSON data only, never an executable expression.
const window = str("A bound observation window");
const fields: Record<string, Record<string, JsonSchema>> = {
  equals: { actual: value, expected: value }, range: { actual: value, min: num("Minimum"), max: num("Maximum") },
  restored: { actual: value, baseline: value }, no_loss: { window },
  eventually: { window, path: str("Property path"), expected: value },
  stable_for: { window, path: str("Property path"), expected: value, duration_s: num("Stable duration", 0.25, 120), max_gap_ms: num("Largest allowed gap", 250, 10000) },
  no_event: { window, kind: str("Event kind"), subject: str("Returned actor handle"), message_id: int("Returned question ID", 1) },
  sequence: { window, events: { type: "array", minItems: 1, maxItems: 32, items: obj({ kind: str("Event kind"), subject: str("Actor"), message_id: int("Question", 1) }, ["kind"]) } },
  rects_disjoint: { rects: { type: "array", minItems: 2, maxItems: 64, items: obj({ x: num("x"), y: num("y"), width: num("width", 0.001), height: num("height", 0.001) }, ["x", "y", "width", "height"]) } },
  moves_forward: { window, min_distance_m: num("Displacement window", 0.25, 2), max_backwards_s: num("Backwards failure threshold", 0.25, 2), min_forward_fraction: num("Forward fraction", 0.5, 1), turn_deadline_s: num("Initial turn budget", 0, 3.5) },
  actor_arrived: { window, max_range_m: num("Arrival range", 0.3, 10) },
  actor_released: { window, endpoint_tolerance_m: num("Last observed point to destination", 0.3, 5) },
  bridge_ready: {
    actual: value,
    candidate: obj({ plugin_version: str("Version"), build_commit: str("Full manifest commit", { pattern: "^[a-f0-9]{40}$" }),
      natives: int("Candidate native count", 1, 1000), write_classes: { type: "array", minItems: 1, maxItems: 16, items: str("Write class") } }, ["plugin_version", "build_commit", "natives", "write_classes"]),
    logs: value,
  },
};
const required: Record<string, string[]> = {
  equals: ["actual", "expected"], range: ["actual", "min", "max"], restored: ["actual", "baseline"], no_loss: ["window"],
  eventually: ["window", "path", "expected"], stable_for: ["window", "path", "expected", "duration_s"],
  no_event: ["window", "kind"], sequence: ["window", "events"], rects_disjoint: ["rects"], moves_forward: ["window"],
  actor_arrived: ["window", "max_range_m"], actor_released: ["window"], bridge_ready: ["actual", "candidate", "logs"],
};
export function assertionSchema(check: string): JsonSchema | undefined {
  return Object.hasOwn(fields, check) ? obj({ ...fields[check], do: { type: "string", enum: ["assert"] }, check: { type: "string", enum: [check] },
    label: str("Label"), row: str("Card row"), evidence_grade: { type: "string", enum: ["state", "geometry"] },
    continue_on_error: bool("Continue"), bind: str("Binding") }, ["do", "check", ...required[check]]) : undefined;
}

export const REFERENCE = /^\$([A-Za-z][A-Za-z0-9_]*)(?:\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*))?$/;
export function select(value: unknown, path: string): unknown {
  if (!path) return value;
  for (const key of path.split(".")) {
    if (["__proto__", "constructor", "prototype"].includes(key) || value === null || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
    value = (value as Json)[key];
  }
  return value;
}
export function resolveBindings(value: unknown, bindings: Record<string, unknown>): any {
  if (typeof value === "string" && value.startsWith("$")) {
    const match = REFERENCE.exec(value);
    if (!match || !Object.hasOwn(bindings, match[1])) throw new Error(`Unbound reference ${value}`);
    const found = select(bindings[match[1]], match[2] ?? "");
    if (found === undefined) throw new Error(`Missing bound property ${value}`);
    return structuredClone(found);
  }
  if (Array.isArray(value)) return value.map((v) => resolveBindings(v, bindings));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveBindings(v, bindings)]));
  return value;
}

/** Validate everything except values resolved from an earlier result. Resolved inputs are validated again before use. */
export function validateBound(schema: JsonSchema, value: unknown, known: Set<string>, path = "input"): string[] {
  if (typeof value === "string" && value.startsWith("$")) {
    const ref = REFERENCE.exec(value);
    return !ref || !known.has(ref[1]) || ref[2]?.split(".").some((s) => ["__proto__", "constructor", "prototype"].includes(s)) ? [`${path}: invalid or forward reference ${value}`] : [];
  }
  if (schema.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const problems: string[] = [];
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) problems.push(`${path}.${key} is required`);
    for (const [key, child] of Object.entries(value)) {
      if (!schema.properties || !Object.hasOwn(schema.properties, key)) { if (schema.additionalProperties === false) problems.push(`${path}.${key}: unknown field`); }
      else problems.push(...validateBound(schema.properties[key], child, known, `${path}.${key}`));
    }
    return problems;
  }
  if (schema.type === "array" && Array.isArray(value)) {
    const problems = validate({ ...schema, items: undefined }, value, path);
    if (schema.items) value.forEach((v, i) => problems.push(...validateBound(schema.items!, v, known, `${path}.${i}`)));
    return problems;
  }
  // Unconstrained JSON data may still contain references. Check those too.
  if (!schema.type && value && typeof value === "object") return Object.entries(value).flatMap(([key, v]) => validateBound({}, v, known, `${path}.${key}`));
  return validate(schema, value, path);
}

const same = (a: unknown, b: unknown): boolean => {
  if (a === undefined || b === undefined) return false;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return Object.is(a, b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && same((a as Json)[k], (b as Json)[k]));
};
const point = (p: unknown): p is number[] => Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === "number" && Number.isFinite(v));
const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const matchEvent = (e: Json, match: Json) => e.kind === match.kind && (match.subject === undefined || e.data?.who === match.subject) && (match.message_id === undefined || e.data?.message_id === match.message_id);

/** Parses only diagnostic lines; these are never the locomotion oracle. */
export function facingTimeline(log: string, subject: string, sid?: string): { line: number; text: string; kind: string; before?: string; after?: string; at: string | null; clock_ms: number | null }[] {
  return log.split(/\r?\n/).flatMap((text, i) => {
    if (sid && !text.includes(`sid=${sid} `)) return [];
    const stamp = /\[([^\]]*?(\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?[^\]]*)\]/.exec(text);
    const time = { at: stamp?.[1] ?? null, clock_ms: stamp ? ((Number(stamp[2]) * 60 + Number(stamp[3])) * 60 + Number(stamp[4])) * 1000 + Number((stamp[5] ?? "").padEnd(3, "0").slice(0, 3)) : null };
    const at = text.indexOf(`npc ${subject} `);
    if (at < 0) return [];
    const body = text.slice(at + `npc ${subject} `.length);
    if (body.startsWith("command turn sent")) return [{ line: i + 1, text, kind: "turn_sent", ...time }];
    if (body.startsWith("command move sent")) return [{ line: i + 1, text, kind: "move_sent", ...time }];
    const clear = /^facing target cleared \(([^)]+)\): (.*)$/.exec(body);
    if (!clear) return [];
    const states = clear[2].split(/,\s*/);
    return [{ line: i + 1, text, kind: `facing_clear_${clear[1]}`, before: states[0], after: states[1], ...time }];
  });
}

export function evaluateAssertion(spec: AssertionSpec): AssertionResult;
export function evaluateAssertion(spec: Json): AssertionResult {
  const report: AssertionResult = { row: spec.row ?? spec.label ?? "unlabelled", subcheck: spec.label ?? spec.check,
    predicate: spec.check, version: 1, evidence_grade: spec.evidence_grade ?? (spec.check === "rects_disjoint" ? "geometry" : "state"), verdict: "INCONCLUSIVE",
    expected: null, actual: null, source_time: null, evidence: [], missing: [], inputs: null };
  const finish = (verdict: Verdict, actual: unknown, expected: unknown, missing: string[] = []) => Object.assign(report, { verdict, actual, expected, missing });
  const schema = assertionSchema(spec.check);
  if (!schema) return finish("INCONCLUSIVE", null, null, ["Unknown predicate"]);
  // Windows and log snapshots are structured observations at execution, not reference strings.
  const runtimeSchema = structuredClone(schema);
  if (runtimeSchema.properties?.window) runtimeSchema.properties.window = {};
  const problems = validate(runtimeSchema, spec);
  if (problems.length) return finish("INCONCLUSIVE", null, null, problems);
  const w = spec.window as (ActorWindow & ValueWindow) | undefined;
  if (w) {
    report.source_time = { clock: "tools_monotonic_ms", start: w.started_ms ?? null, end: w.ended_ms ?? null,
      source_event_ms: w.events?.map((e) => e.t_ms) ?? [], source_timestamps: false };
    report.evidence = ["step.result.window (private manifest)"];
  }
  switch (spec.check) {
    case "equals": case "restored": {
      const expected = spec.check === "restored" ? spec.baseline : spec.expected;
      return finish(spec.actual === undefined || expected === undefined ? "INCONCLUSIVE" : same(spec.actual, expected) ? "PASS" : "FAIL", spec.actual, expected);
    }
    case "range": return finish(typeof spec.actual !== "number" || !Number.isFinite(spec.actual) || spec.min > spec.max ? "INCONCLUSIVE" :
      spec.actual >= spec.min && spec.actual <= spec.max ? "PASS" : "FAIL", spec.actual, { min: spec.min, max: spec.max });
    case "rects_disjoint": {
      const collisions: number[][] = [];
      spec.rects.forEach((a: Json, i: number) => spec.rects.slice(i + 1).forEach((b: Json, j: number) => {
        if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) collisions.push([i, i + j + 1]);
      }));
      return finish(collisions.length ? "FAIL" : "PASS", collisions, "No overlap; complete measured geometry supplied by caller");
    }
    case "no_loss": return finish(!w?.cursor || !w.complete || !w.cursor.complete || w.cursor.dropped !== 0 ? "INCONCLUSIVE" : "PASS", w?.cursor ?? null, { dropped: 0, complete: true }, w?.cursor?.missing ?? ["No complete cursor/window"]);
    case "no_event": case "sequence": {
      if (!Array.isArray(w?.events)) return finish("INCONCLUSIVE", null, spec, ["No event window"]);
      const events = w.events;
      const complete = w.complete && w.cursor?.complete && w.cursor.dropped === 0;
      if (spec.check === "no_event") {
        const hits = events.filter((e) => matchEvent(e, spec));
        return finish(hits.length ? "FAIL" : complete ? "PASS" : "INCONCLUSIVE", hits, spec.kind, complete ? [] : ["Absence requires complete history and a closed interval"]);
      }
      let next = 0;
      for (const e of events) if (next < spec.events.length && matchEvent(e, spec.events[next])) next++;
      return finish(!complete ? "INCONCLUSIVE" : next === spec.events.length ? "PASS" : "FAIL", { matched: next }, spec.events, complete ? [] : ["Incomplete event history"]);
    }
    case "eventually": case "stable_for": {
      if (!Array.isArray(w?.samples)) return finish("INCONCLUSIVE", null, spec.expected, ["No sampled read window"]);
      const samples = (w as ValueWindow).samples;
      const missing = samples.some((s) => select(s.value, spec.path) === undefined);
      if (spec.check === "eventually") {
        const hit = samples.find((s) => same(select(s.value, spec.path), spec.expected));
        return finish(hit ? "PASS" : !w.complete || missing ? "INCONCLUSIVE" : "FAIL", hit ?? samples.at(-1), spec.expected);
      }
      const gap = spec.max_gap_ms ?? 1000;
      let start: number | undefined, longest = 0, prior = -Infinity, hasGap = false;
      for (const s of samples) {
        if (prior !== -Infinity && s.t_ms - prior > gap) hasGap = true;
        if (!same(select(s.value, spec.path), spec.expected)) start = undefined;
        else {
          if (start === undefined || s.t_ms - prior > gap) start = s.t_ms;
          longest = Math.max(longest, s.t_ms - start);
        }
        prior = s.t_ms;
      }
      return finish(!w.complete || missing ? "INCONCLUSIVE" : longest >= spec.duration_s * 1000 ? "PASS" : hasGap ? "INCONCLUSIVE" : "FAIL", { longest_ms: longest, has_gap: hasGap }, spec.duration_s * 1000);
    }
    case "moves_forward": return evaluateWalk(spec, report);
    case "actor_arrived": {
      const event = w?.events?.find((e) => e.kind === "npc.arrived" && e.data?.who === w.subject);
      const last = w?.samples?.at(-1)?.actor;
      const range = event?.data?.distance_v;
      const failures = w?.events?.filter((e) => e.data?.who === w.subject && ["npc.blocked", "npc.move_failed", "npc.auto_released"].includes(e.kind)) ?? [];
      return finish(!w?.complete || !last || typeof range !== "number" ? "INCONCLUSIVE" : range > spec.max_range_m || failures.length || last.motion ? "FAIL" : "PASS",
        { distance_v: range, motion: last?.motion ?? null, failures }, { max_range_m: spec.max_range_m, terminal: "npc.arrived" });
    }
    case "actor_released": {
      const releases = w?.events?.filter((e) => e.data?.who === w.subject && e.kind === "npc.released") ?? [];
      const bad = w?.events?.filter((e) => e.data?.who === w.subject && ["npc.auto_released", "npc.move_failed", "npc.blocked", "npc.handed_back"].includes(e.kind)) ?? [];
      const lastPresent = w?.samples?.filter((s) => s.actor).at(-1)?.actor;
      const end = lastPresent?.position, goal = w?.result?.to;
      const remaining = point(end) && point(goal) ? distance(end, goal) : null;
      const gone = w?.samples?.at(-1)?.actor === null;
      const expected = { released_once: true, how: "walk_away", absent_after: true, endpoint_tolerance_m: spec.endpoint_tolerance_m ?? 2.5 };
      return finish(bad.length || releases.length > 1 || releases.some((e) => e.data?.how !== "walk_away") ? "FAIL" :
        !w?.complete || remaining === null || !releases.length ? "INCONCLUSIVE" : gone && remaining <= expected.endpoint_tolerance_m ? "PASS" : "FAIL",
        { releases, unexpected_events: bad, absent: gone, endpoint_distance_m: remaining, sampling: w?.sampling }, expected);
    }
    case "bridge_ready": {
      const info = spec.actual, candidate = spec.candidate, logs = spec.logs;
      const expected = { ...candidate, build_dirty: false, allow_writes: true };
      const actual = { plugin_version: info?.plugin_version, build_commit: info?.build_commit, build_dirty: info?.build_dirty,
        write_classes: info?.bridge?.write_classes, allow_writes: info?.bridge?.allow_writes, natives: logs?.natives, errors: logs?.errors };
      const mismatch = actual.plugin_version !== candidate.plugin_version || actual.build_commit !== candidate.build_commit || actual.build_dirty !== false ||
        actual.allow_writes !== true || !Array.isArray(actual.write_classes) || !same([...actual.write_classes].sort(), [...candidate.write_classes].sort()) ||
        (logs?.natives !== undefined && logs.natives !== candidate.natives) || logs?.errors?.length;
      return finish(mismatch ? "FAIL" : !logs?.complete || logs?.natives === undefined ? "INCONCLUSIVE" : "PASS", actual, expected, logs?.missing ?? []);
    }
  }
  return finish("INCONCLUSIVE", null, null, ["Unknown predicate"]);
}

function evaluateWalk(spec: Json, report: AssertionResult): AssertionResult {
  const w = spec.window as ActorWindow;
  const minDistance = spec.min_distance_m ?? 0.25, maxBackwards = spec.max_backwards_s ?? 0.5, minFraction = spec.min_forward_fraction ?? 0.9;
  const turnBudget = (spec.turn_deadline_s ?? 3.25) * 1000;
  report.expected = { min_distance_m: minDistance, speed_min_m_s: 0.3, dot_forward: 0.5, dot_backwards: -0.5, min_forward_fraction: minFraction, max_backwards_s: maxBackwards, turn_deadline_ms: turnBudget };
  if (!w?.samples?.length || !w.subject) { report.missing = ["No actor samples"]; return report; }
  const missing: string[] = [...w.missing];
  let forward_s = 0, backwards_s = 0, sideways_s = 0, travelling_s = 0, total_distance_m = 0, longest_backwards_s = 0, backwardsRun = 0;
  let anchor = w.samples[0], aligned_ms: number | null = null, movement_ms: number | null = null;
  const goal = w.action === "npc.release" ? w.result.to : null;
  if (w.action === "npc.release" && !point(goal)) missing.push("Missing release destination; initial turn cannot be measured");
  const initial = w.samples[0].actor;
  const goalYaw = point(goal) && point(initial?.position) ? Math.atan2(-(goal[0] - initial.position[0]), goal[1] - initial.position[1]) * 180 / Math.PI : null;
  for (let i = 0; i < w.samples.length; i++) {
    const s = w.samples[i], a = s.actor;
    if (!a) { if (i !== w.samples.length - 1 || w.action !== "npc.release") missing.push("Actor disappeared before terminal evidence"); continue; }
    if (!point(a.position) || typeof a.yaw !== "number" || !Number.isFinite(a.yaw)) { missing.push("Missing position/yaw"); continue; }
    if (goalYaw !== null && aligned_ms === null && angle(a.yaw, goalYaw) <= 30) aligned_ms = s.t_ms - w.started_ms;
    if (!point(anchor.actor?.position)) { anchor = s; continue; }
    const d = distance(a.position, anchor.actor!.position), dt = (s.t_ms - anchor.t_ms) / 1000;
    // The capped initial turn and stationary time contribute no travelling time. Keep sub-0.25 m
    // moving displacements accumulated, rather than mistaking a slow walk for no motion.
    if (d < 0.01) { anchor = s; continue; }
    if (d < minDistance || dt <= 0) continue;
    if (movement_ms === null) movement_ms = s.t_ms - w.started_ms;
    const speed = d / dt;
    if (speed >= 0.3) {
      // Current root yaw versus displacement. Sub-tick animation and head direction remain unobserved.
      const dotAt = (yaw: number) => ((a.position[0] - anchor.actor!.position[0]) * -Math.sin(yaw * Math.PI / 180) +
        (a.position[1] - anchor.actor!.position[1]) * Math.cos(yaw * Math.PI / 180)) / d;
      const dot = dotAt(a.yaw);
      if (!Number.isFinite(dot)) missing.push("Missing window-start yaw");
      else {
        travelling_s += dt; total_distance_m += d;
        if (dot > 0.5) { forward_s += dt; backwardsRun = 0; }
        else if (dot < -0.5) { backwards_s += dt; backwardsRun += dt; longest_backwards_s = Math.max(longest_backwards_s, backwardsRun); }
        else { sideways_s += dt; backwardsRun = 0; }
      }
    } else backwardsRun = 0;
    anchor = s;
  }
  if (!w.complete) missing.push("Incomplete full walk interval");
  if (travelling_s < 0.5 || total_distance_m < minDistance) missing.push("Insufficient observed displacement");
  const turn = goalYaw === null ? null : { goal_yaw: goalYaw, initial_yaw: initial?.yaw, aligned_ms, movement_ms,
    reached: aligned_ms !== null && aligned_ms <= turnBudget && (movement_ms === null || aligned_ms <= movement_ms) };
  const fraction = travelling_s > 0 ? forward_s / travelling_s : 0;
  report.actual = { subject: w.subject, turn, forward_s, backwards_s, sideways_s, travelling_s, total_distance_m, longest_backwards_s, forward_fraction: fraction, sampling: w.sampling };
  report.missing = [...new Set(missing)];
  report.verdict = longest_backwards_s >= maxBackwards || (travelling_s >= 0.5 && fraction < minFraction) || (turn && !turn.reached && aligned_ms !== null) ? "FAIL" :
    missing.length || (turn && !turn.reached) ? "INCONCLUSIVE" : "PASS";
  return report;
}

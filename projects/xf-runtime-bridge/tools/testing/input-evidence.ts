// Evidence checks only: this module cannot acquire a receiver, call a native or submit input.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import type { AssertionResult } from "./assertions.ts";
import type { Json } from "./windows.ts";

const EXE = "a7de82945c03e041fc7339fcf9066224d98db2f5d80fea50f7947bb350a60991";
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const rva = (v: unknown): boolean => typeof v === "string" && /^0x[0-9a-f]+$/i.test(v) && BigInt(v) > 0n;
const matches = (actual: any, expected: any): boolean => {
  if (expected === null || typeof expected !== "object") return Object.is(actual, expected);
  if (!actual || typeof actual !== "object" || Array.isArray(actual) !== Array.isArray(expected)) return false;
  if (Array.isArray(expected) && actual.length !== expected.length) return false;
  return Object.keys(expected).every((key) => Object.hasOwn(actual, key) && matches(actual[key], expected[key]));
};

/** Load a pinned PRIVATE debugger trace. A status response/fixture flag is never a trace. */
export function readR1Trace(reference: unknown): Json {
  const ref = reference as Json;
  if (!ref || !text(ref.path) || !/^[a-f0-9]{64}$/.test(ref.sha256 ?? "")) return { missing: ["Supply the private trace path and its SHA-256"] };
  try {
    const stat = statSync(ref.path);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return { missing: ["Trace is not a bounded regular file"] };
    const raw = readFileSync(ref.path);
    const hash = createHash("sha256").update(raw).digest("hex");
    if (hash !== ref.sha256) return { invalid: "Trace hash differs from the approved capture" };
    return { trace: JSON.parse(raw.toString("utf8")), file: { kind: "r1_readonly_trace", path: ref.path, bytes: raw.length, sha256: hash, modified_at: stat.mtime.toISOString() } };
  } catch { return { missing: ["Private trace is missing or invalid JSON"] }; }
}

export function evaluateInputEvidence(spec: Json, report: AssertionResult): AssertionResult {
  const finish = (verdict: AssertionResult["verdict"], actual: unknown, expected: unknown, missing: string[] = []) => Object.assign(report, { verdict, actual, expected, missing });
  if (spec.check === "event_count") {
    const w = spec.window;
    if (!Array.isArray(w?.events)) return finish("INCONCLUSIVE", null, spec.count, ["No event window"]);
    if (spec.data !== undefined && (!spec.data || typeof spec.data !== "object" || Array.isArray(spec.data))) return finish("INCONCLUSIVE", null, spec.count, ["data must be an object"]);
    if (spec.data && Object.keys(spec.data).length && w.events.some((e: Json) => e.kind === spec.kind && (!e.data || e.data.cut === true))) return finish("INCONCLUSIVE", null, spec.count, ["Matching event payload is missing or truncated"]);
    const hits = w.events.filter((e: Json) => e.kind === spec.kind && (!spec.data || Object.keys(spec.data).length === 0 || matches(e.data, spec.data)));
    const complete = w.complete && w.cursor?.complete && w.cursor.dropped === 0;
    return finish(!complete ? "INCONCLUSIVE" : hits.length === spec.count ? "PASS" : "FAIL", hits, { kind: spec.kind, data: spec.data ?? {}, count: spec.count }, complete ? [] : ["Exact counts require complete history and a closed interval"]);
  }
  if (spec.check === "save_delta") {
    const after = spec.actual, before = spec.baseline;
    const valid = (v: Json) => v?.ready === true && Array.isArray(v.names) && v.names.every(text) && new Set(v.names).size === v.names.length;
    if (!valid(before) || !valid(after)) return finish("INCONCLUSIVE", null, "One added total; no removals in the overlapping save window", ["Both settled save lists are required"]);
    const full = (v: Json) => v.count === undefined ? v.names.length : v.count;
    if (![before, after].every(v => Number.isSafeInteger(full(v)) && full(v) >= v.names.length))
      return finish("INCONCLUSIVE", null, "One new save", ["Invalid total save count"]);
    const shared = before.names.filter((n: string) => after.names.includes(n));
    const oldest = shared.at(-1);
    if (!oldest && before.names.length && (full(before) > before.names.length || full(after) > after.names.length))
      return finish("INCONCLUSIVE", null, "Overlapping save windows", ["No overlapping window"]);
    const beforeOverlap = oldest ? before.names.slice(0, before.names.indexOf(oldest) + 1) : before.names;
    const afterOverlap = oldest ? after.names.slice(0, after.names.indexOf(oldest) + 1) : after.names;
    const removed = beforeOverlap.filter((n: string) => !after.names.includes(n));
    // Complete lists also prove removals beyond the shared interval.
    if (full(after) === after.names.length) for (const n of before.names) if (!after.names.includes(n) && !removed.includes(n)) removed.push(n);
    const added = afterOverlap.filter((n: string) => !before.names.includes(n));
    const addedTotal = full(after) - full(before);
    return finish(addedTotal === 1 && removed.length === 0 ? "PASS" : "FAIL", { added, added_total: addedTotal, removed }, { added_total: 1, removed: 0 });
  }
  const capture = spec.actual, t = capture?.trace;
  report.evidence = capture?.file ? [capture.file] : [];
  report.expected = "Complete read-only receiver/implementation/lifecycle evidence, NOT ABI commissioning";
  if (capture?.invalid) return finish("FAIL", capture.invalid, report.expected);
  if (!capture?.file || !t || t.schema !== "xfb/r1-readonly-trace-1") return finish("INCONCLUSIVE", null, report.expected, capture?.missing ?? ["No pinned native trace; input_probe/status is insufficient"]);
  if (t.exe_sha256 !== EXE || t.game !== "2.31" || t.sid !== spec.sid) return finish("FAIL", { game: t.game, exe_sha256: t.exe_sha256, sid: t.sid }, report.expected, ["Wrong executable or session"]);
  if (t.read_only !== true || !Array.isArray(t.synthetic_submissions) || t.synthetic_submissions.length !== 0) return finish("FAIL", t.synthetic_submissions ?? null, report.expected, ["R1 row forbids synthetic input and test-native calls"]);
  if (!Array.isArray(t.records) || !t.records.length) return finish("INCONCLUSIVE", null, report.expected, ["No source records"]);
  const records: Json[] = t.records;
  const missing: string[] = [];
  let prior = -1;
  for (const record of records) {
    if (!Number.isFinite(record.t_ms) || record.t_ms < prior || !Number.isSafeInteger(record.thread_id) || record.thread_id <= 0 || !text(record.evidence)) missing.push("Every ordered record needs source time, thread ID and native evidence excerpt/reference");
    prior = record.t_ms;
  }
  const acquired = records.find((r) => r.kind === "receiver_acquired" && text(r.receiver) && text(r.owner) && text(r.receiver_type) && r.owner_member_offset === "0x10" && rva(r.acquisition_rva) && text(r.ownership_evidence));
  if (!acquired) missing.push("Concrete receiver acquisition/type/owner and lifetime evidence at owner +0x10");
  const sameReceiver = (r: Json) => acquired && r.receiver === acquired.receiver;
  for (const kind of ["dispatch_implementation", "release_implementation", "axis_zero_implementation"]) {
    const implementation = records.find((r) => r.kind === kind && sameReceiver(r) && rva(r.target_rva) && text(r.abi_evidence) &&
      (kind === "release_implementation" ? r.helper_rva === "0x29b63f0" && r.caller_rva === "0x29c3bec" : r.vtable_slot === "0x1f8"));
    if (!implementation) missing.push(`Resolved ${kind} target and inspected ABI evidence`);
  }
  for (const context of ["pause", "handover", "load"]) {
    if (!records.some((r) => r.kind === "lifecycle" && sameReceiver(r) && r.context === context && text(r.lifetime_evidence))) missing.push(`${context} receiver ownership/neutralisation lifetime evidence`);
  }
  if (!records.some((r) => r.kind === "receiver_teardown" && sameReceiver(r) && acquired && r.t_ms > acquired.t_ms && text(r.lifetime_evidence))) missing.push("Teardown paired with the acquired receiver");
  report.source_time = { clock: "native trace source t_ms", start: records[0]?.t_ms, end: records.at(-1)?.t_ms };
  return finish(missing.length ? "INCONCLUSIVE" : "PASS", { records: records.length, receiver: acquired?.receiver ?? null, adapter_enabled: false }, report.expected, [...new Set(missing)]);
}

// Schema-2 session additions, kept separate from schema-1 command/capture compatibility.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findCommand } from "../api/catalogue.ts";
import { bool, num, obj, str, validate, type JsonSchema } from "../api/schema.ts";
import { assertionSchema, evaluateAssertion, facingTimeline, resolveBindings, validateBound, type AssertionResult, type AssertionSpec } from "./assertions.ts";
import { readR1Trace } from "./input-evidence.ts";
import { captureCursor, clock, observeActor, observeEvents, observeValues, read, readLogs, waitForEvent, WINDOW_READS,
  type Clock, type EventCursor, type Json, type TestApi } from "./windows.ts";

export const SCRIPT_SCHEMA_2 = "xfb/session-script-2";
const bindName = str("Binding name", { pattern: "^[A-Za-z][A-Za-z0-9_]*$" });
const meta = { do: str("Step"), label: str("Label"), bind: bindName, continue_on_error: bool("Continue on failure") };
const logPathsSchema = obj({ plugin: str("Plugin log"), redscript: str("Compiler log") }, ["plugin", "redscript"]);
export const TEST_STEP_KINDS = new Set(["cursor", "await", "events", "observe", "assert"]);
const schemas: Record<string, JsonSchema> = {
  cursor: obj(meta, ["do", "bind"]),
  await: obj({ ...meta, cursor: str("Bound cursor"), kind: str("Event kind"), subject: str("Actor"), message_id: num("Question ID", 1), timeout_s: num("Deadline", 1, 600) }, ["do", "cursor", "kind", "timeout_s", "bind"]),
  events: obj({ ...meta, cursor: str("Bound cursor"), duration_s: num("Complete interval", 0.25, 120) }, ["do", "cursor", "duration_s", "bind"]),
  observe: obj({ ...meta, command: { type: "string", enum: ["npc.move", "npc.release", ...WINDOW_READS] }, input: {},
    subject: str("Actor"), timeout_s: num("Actor deadline", 1, 120), duration_s: num("Read interval", 0.25, 120), interval_ms: num("Polling interval", 250, 10000) }, ["do", "command", "bind"]),
};

export function planTestStep(step: Json, known: Set<string>): string[] {
  const schema = step.do === "assert" ? assertionSchema(step.check) : schemas[step.do];
  if (!schema) return ["Unknown test step or assertion"];
  const problems = validateBound(schema, step, known);
  if (step.do === "assert") {
    if (step.check === "bridge_ready") {
      problems.push(...validateBound(logPathsSchema, step.logs, known));
      if (step.continue_on_error) problems.push("bridge_ready is a stop gate and cannot continue on error");
    }
    if (["eventually", "stable_for"].includes(step.check) && (typeof step.path !== "string" || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(step.path))) problems.push("Assertion path must select plain properties");
  }
  if (step.do === "await") {
    const wait = findCommand("session.wait")!;
    if (typeof step.kind === "string" && !step.kind.startsWith("$")) problems.push(...validate(wait.input.properties!.kinds!, [step.kind]));
    if (step.kind === "answer" && step.message_id === undefined) problems.push("An answer wait requires the returned message_id");
    if (String(step.kind).startsWith("npc.") && step.subject === undefined) problems.push("An NPC wait requires the returned actor subject");
  }
  if (["await", "events"].includes(step.do) && (typeof step.cursor !== "string" || !/^\$[A-Za-z][A-Za-z0-9_]*$/.test(step.cursor))) problems.push("cursor must name a standalone saved cursor binding");
  for (const key of ["subject", "message_id"]) if (step[key] !== undefined && (typeof step[key] !== "string" || !step[key].startsWith("$"))) problems.push(`${key} must use a returned binding`);
  if (step.do === "observe") {
    const command = findCommand(step.command);
    if (command) problems.push(...validateBound(command.input, step.input ?? {}, known));
    if (["npc.move", "npc.release"].includes(step.command)) {
      if (step.subject === undefined || step.timeout_s === undefined) problems.push("Actor observation requires subject and timeout_s");
      if (step.duration_s !== undefined) problems.push("Actor observation uses timeout_s, not duration_s");
      if (typeof step.interval_ms === "number" && step.interval_ms > 2000) problems.push("Actor interval_ms must be at most 2000");
      if (step.command === "npc.release" && step.input?.how !== "walk_away") problems.push("Observe release requires how: walk_away");
    } else {
      if (step.duration_s === undefined) problems.push("Read observation requires duration_s");
      if (step.subject !== undefined || step.timeout_s !== undefined) problems.push("Read observation takes no actor subject/timeout_s");
      if (step.command === "game.saves" && (step.interval_ms ?? 3500) < 3500) problems.push("Save-list polling must be at least 3500 ms");
    }
  }
  return problems;
}

export function validateBindingName(step: Json, known: Set<string>): string[] {
  if (step.bind === undefined) return [];
  const problems = validate(bindName, step.bind);
  if (known.has(step.bind)) problems.push(`Binding ${step.bind} is already defined`);
  if (!problems.length) known.add(step.bind);
  return problems;
}

export type TestStepResult = { ok: boolean; result: unknown; error?: { code: string; message: string } };
export class TestSession {
  readonly bindings: Record<string, unknown>;
  private readonly statePath: string;
  private readonly fingerprint: string;
  private sid: string | undefined;
  constructor(private api: TestApi, script: Json, outDir: string, resume: boolean, private time: Clock = clock) {
    this.statePath = join(outDir, "bindings.json");
    this.fingerprint = createHash("sha256").update(JSON.stringify(script)).digest("hex");
    this.bindings = Object.create(null);
    this.bindings.fixture = structuredClone(script.fixtures ?? {});
    if (resume && existsSync(this.statePath)) {
      const state = JSON.parse(readFileSync(this.statePath, "utf8"));
      if (state.schema !== "xfb/session-bindings-1" || state.fingerprint !== this.fingerprint) throw new Error("Resume bindings belong to a different script/fixture");
      Object.assign(this.bindings, state.bindings); this.sid = state.sid;
    }
  }
  async verifyIdentity(signal?: AbortSignal) {
    const info = await read(this.api, "bridge.info", {}, signal);
    if (!info.sid || (this.sid && info.sid !== this.sid)) throw new Error("Session changed: saved actor handles, answers and cursors cannot be reused");
    this.sid = info.sid;
  }
  resolve(value: unknown) { return resolveBindings(value, this.bindings); }
  save() {
    const temporary = `${this.statePath}.tmp`;
    writeFileSync(temporary, JSON.stringify({ schema: "xfb/session-bindings-1", fingerprint: this.fingerprint, sid: this.sid, bindings: this.bindings }, null, 2) + "\n");
    renameSync(temporary, this.statePath);
  }
  bind(name: unknown, result: unknown) {
    if (typeof name === "string") { this.bindings[name] = structuredClone(result); this.save(); }
  }
  private advance(reference: unknown, cursor: EventCursor) {
    // A cursor is a standalone binding, so checkpoint it without changing a command result's identity.
    if (typeof reference === "string" && /^\$[A-Za-z][A-Za-z0-9_]*$/.test(reference)) this.bind(reference.slice(1), cursor);
  }
  async execute(raw: Json, signal?: AbortSignal): Promise<TestStepResult> {
    const step = this.resolve(raw) as Json;
    if (step.do !== "assert") {
      const schema = structuredClone(schemas[step.do]);
      if (schema.properties?.cursor) schema.properties.cursor = {};
      const problems = validate(schema, step);
      if (problems.length) throw new Error(problems.join("; "));
    }
    let result: unknown, ok = true;
    if (step.do === "cursor") result = await captureCursor(this.api, signal);
    else if (step.do === "await") {
      result = await waitForEvent(this.api, step.cursor, { kind: step.kind, subject: step.subject, message_id: step.message_id }, step.timeout_s, signal, this.time);
      this.advance(raw.cursor, (result as Json).cursor);
      ok = (result as Json).complete && (result as Json).events.some((e: Json) => e.kind === step.kind &&
        (step.subject === undefined || e.data?.who === step.subject) && (step.message_id === undefined || e.data?.message_id === step.message_id));
    } else if (step.do === "events") {
      result = await observeEvents(this.api, step.cursor, step.duration_s, signal, this.time);
      this.advance(raw.cursor, (result as Json).cursor); ok = (result as Json).complete;
    } else if (step.do === "observe") {
      const command = findCommand(step.command)!;
      const problems = validate(command.input, step.input ?? {});
      if (problems.length) throw new Error(problems.join("; "));
      result = ["npc.move", "npc.release"].includes(step.command) ?
        await observeActor(this.api, step.subject, step.command, step.input, step.timeout_s, signal, this.time, step.interval_ms ?? 250,
          (cursor) => this.bind(raw.bind, { cursor, complete: false, missing: ["Action observation in progress"] })) :
        await observeValues(this.api, step.command, step.input ?? {}, step.duration_s, step.interval_ms ?? (step.command === "game.saves" ? 3500 : 250), signal, this.time);
      // Keep incomplete windows for the following assertion/report, but stop unless explicitly continued.
      ok = (result as Json).complete;
    } else if (step.do === "assert") {
      if (step.check === "r1_trace") step.actual = readR1Trace(step.actual);
      if (step.check === "bridge_ready") {
        const problems = validate(logPathsSchema, step.logs);
        if (problems.length) throw new Error(problems.join("; "));
        step.logs = readLogs(step.logs, step.actual);
      }
      result = evaluateAssertion(step as AssertionSpec);
      (result as AssertionResult).inputs = raw;
      (result as AssertionResult).evidence = [raw.window, raw.actual, raw.baseline].filter((v) => typeof v === "string" && v.startsWith("$")).map((v) => `bindings.${v.slice(1)}`);
      if (!(result as AssertionResult).source_time) (result as AssertionResult).source_time = { clock: "tools_monotonic_ms", evaluated_ms: this.time.now(), source_timestamp_available: false };
      if (step.check === "bridge_ready") (result as AssertionResult).evidence = step.logs.evidence ?? [];
      if (step.check === "r1_trace") (result as AssertionResult).evidence = step.actual.file ? [step.actual.file] : [];
      ok = (result as AssertionResult).verdict === "PASS";
    } else throw new Error("Unknown test step");
    this.bind(raw.bind, result);
    return { ok, result, ...(!ok ? { error: { code: "assertion_not_passed", message: `${step.label ?? step.do}: ${(result as Json).verdict ?? "incomplete observation"}` } } : {}) };
  }
  async diagnostics(paths: unknown): Promise<unknown> {
    if (!paths) return undefined;
    const info = await read(this.api, "bridge.info");
    const logs = readLogs(this.resolve(paths), info);
    const sessionLog = await read(this.api, "session.log", { tail: 500, sources: ["bridge"] });
    const subjects = new Set(Object.values(this.bindings).filter((v: any) => v && typeof v.who === "string").map((v: any) => v.who as string));
    return { complete: logs.complete, missing: logs.missing, errors: logs.errors, evidence: logs.evidence, session_log: sessionLog,
      facing_timeline: [...subjects].map((subject) => ({ subject, clock: "plugin log local wall time; uncalibrated to tools monotonic time", entries: facingTimeline(logs.plugin_text, subject, info.sid) })) };
  }
}

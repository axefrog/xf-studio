// Scripted in-game sessions: runs a JSON script of steps through the command API and writes a
// report folder with every screenshot and a manifest.json.
//
//   bun tools/session.ts <script.json> [--dry-run] [--out <dir>] [--from <step label>] [--until <step label>] [--no-echo]
// Schema 2 adds bind: "name", $name.property references, cursor/await/events/observe/assert steps
// and --fixtures <private.json>. See testing/fixtures/actor-release.json. Bindings/cursors are
// checkpointed in the report folder; --from may reuse them only for the same script and bridge session.
//
// Script format (schema "xfb/session-script-1"):
//   {
//     "schema": "xfb/session-script-1",
//     "name": "session-2", "title": "...", "card": "experiments/020-session-2/README.md",
//     "requires": ["photo mode open", ...],            // shown before the run, recorded in the manifest
//     "defaults": { "capture": { "region": "face" } },  // merged into every step of that kind
//     "steps":   [ { "do": "...", "label": "...", ...input }, ... ],
//     "restore": [ ...steps run at the end even after a failure ]
//   }
// Step kinds ("do"): "set camera" (photo.camera.set), "set light" (photo.light.set),
// "apply cc" (cc.apply), "frame" (photo.frame), "capture" (capture.screenshot), "burst"
// (capture.burst), "wait" ({"ms": n}), "note" ({"text"}),
// "ask" ({"text"}: something the player must do or judge), and "run" ({"command": "<any catalogue
// command>", "input": {...}}), so every command in the catalogue is scriptable. Every other key
// of a step is the command's input. A failed step stops the run (then "restore" runs) unless it
// says "continue_on_error": true, or "expect_error": "<code>" names the refusal it expects.
//
// An "ask" may name, in "replaced_by", the command expected to take it over once the bridge can do
// that step itself (for example "photo.open"); dry runs and the manifest show it.
//
// "ask" steps split a session into parts. Run interactively (a terminal), the runner shows the
// text and waits for Enter. Run by a harness (no terminal), it stops cleanly at the ask, without
// running "restore", and prints the --from label that continues after it; the report folder
// (--out) collects every part's run in one manifest.json.
//
// Notes and asks are also shown to the player in the game (ui.message, on the bridge's status surface),
// so the maintainer can follow the session without leaving the game: a note for 20 s, an ask until it is
// answered (then the messages are cleared), plus a line when the run starts and ends. Best effort: a
// bridge that isn't there, or a build without ui.message, changes nothing (the record says echoed: false).
// --no-echo switches it off.
//
// Ctrl+C stops the run after the command in flight (a wait, an ask or a game.wait ends at once),
// runs "restore" once and records the run as "interrupted"; a second Ctrl+C exits immediately.
// While it runs, the runner holds an advisory lock (tools/session-lock.ts) beside session.json,
// and the MCP server refuses bridge commands in plain words until it is released.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { findCommand } from "./api/catalogue.ts";
import { CommandApi, type CommandOutcome } from "./api/command-api.ts";
import { bool, str, validate, type JsonSchema } from "./api/schema.ts";
import { acquireSessionLock, sessionRunningMessage } from "./session-lock.ts";
import { validateBound } from "./testing/assertions.ts";
import { planTestStep, SCRIPT_SCHEMA_2, TEST_STEP_KINDS, TestSession, validateBindingName } from "./testing/script.ts";
import type { Clock } from "./testing/windows.ts";
export { SCRIPT_SCHEMA_2 } from "./testing/script.ts";

export const SCRIPT_SCHEMA = "xfb/session-script-1";

export const STEP_COMMANDS: Record<string, string> = {
  "set camera": "photo.camera.set",
  "set light": "photo.light.set",
  "apply cc": "cc.apply",
  frame: "photo.frame",
  capture: "capture.screenshot",
  burst: "capture.burst",
};
const STEP_META = new Set(["do", "label", "continue_on_error", "command", "input", "expect_error", "text", "replaced_by", "bind", "if_bound", "allow_error"]);

export type Step = { do: string; label?: string; continue_on_error?: boolean; command?: string; input?: Record<string, unknown>; expect_error?: string; replaced_by?: string; [key: string]: unknown };
export type SessionScript = {
  schema: string;
  name: string;
  title?: string;
  card?: string;
  requires?: string[];
  defaults?: Record<string, Record<string, unknown>>;
  /** Schema 2 only: plain fixture data referenced as $fixture.<property>. */
  fixtures?: Record<string, unknown>;
  /** Schema 2 only: current plugin/compiler log paths, kept in the private invocation fixture. */
  diagnostic_logs?: { plugin: string; redscript: string };
  steps: Step[];
  restore?: Step[];
};

export type PlannedStep = { index: number; phase: "steps" | "restore"; label: string; kind: string; command?: string; input?: Record<string, unknown>; ms?: number; text?: string; step: Step };

export type RunOutcome = "complete" | "failed" | "paused" | "interrupted";

/** Resolves every step to a command and input, and checks each input against the catalogue schema. */
export function planScript(script: SessionScript): { plan: PlannedStep[]; problems: string[] } {
  const problems: string[] = [];
  const v2 = script.schema === SCRIPT_SCHEMA_2;
  if (script.schema !== SCRIPT_SCHEMA && !v2) problems.push(`schema must be "${SCRIPT_SCHEMA}" or "${SCRIPT_SCHEMA_2}"`);
  const known = new Set(["fixture"]);
  if (v2) {
    const allowed = new Set(["schema", "name", "title", "card", "requires", "defaults", "steps", "restore", "fixtures", "diagnostic_logs"]);
    for (const key of Object.keys(script)) if (!allowed.has(key)) problems.push(`script: unknown field ${key}`);
  } else if (script.fixtures || script.diagnostic_logs) problems.push("fixtures/diagnostic_logs require schema 2");
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(script.name ?? "")) problems.push("name must be 1-60 letters, digits, '.', '_' or '-'");
  const plan: PlannedStep[] = [];
  if (!Array.isArray(script.steps) || (script.restore !== undefined && !Array.isArray(script.restore))) return { plan, problems: [...problems, "steps/restore must be arrays"] };
  const add = (phase: "steps" | "restore", steps: Step[] | undefined) => {
    for (const step of steps ?? []) {
      if (!step || typeof step !== "object" || Array.isArray(step)) { problems.push(`${phase}: each step must be an object`); continue; }
      const index = plan.length + 1;
      const label = step.label ?? `${phase === "restore" ? "restore-" : ""}${index}`;
      const where = `step ${index} (${label})`;
      const kind = step.do;
      if (v2 && TEST_STEP_KINDS.has(kind)) {
        for (const problem of planTestStep(step, known)) problems.push(`${where}: ${problem}`);
        for (const problem of validateBindingName(step, known)) problems.push(`${where}: ${problem}`);
        plan.push({ index, phase, label, kind, step });
        continue;
      }
      if (!v2 && ["bind", "if_bound", "allow_error"].some((key) => step[key] !== undefined)) problems.push(`${where}: result bindings and restore guards require schema 2`);
      const own = Object.fromEntries(Object.entries(step).filter(([key]) => !STEP_META.has(key)));
      if (v2) {
        const metadata: Record<string, JsonSchema> = { label: str("Step label"), continue_on_error: bool("Continue"), command: str("Command"),
          expect_error: str("Expected refusal"), allow_error: str("Allowed refusal"), if_bound: str("Restore binding"), text: str("Text") };
        for (const [key, schema] of Object.entries(metadata)) if (step[key] !== undefined) problems.push(...validate(schema, step[key]).map((p) => `${where}: ${p}`));
        const keys = new Set(["do", "label", "continue_on_error", ...(kind === "run" ? ["command", "input", "expect_error", "bind", "if_bound", "allow_error"] : kind === "wait" ? ["ms"] : kind === "ask" ? ["text", "replaced_by"] : kind === "note" ? ["text"] : [...STEP_META, ...Object.keys(findCommand(STEP_COMMANDS[kind] ?? "")?.input.properties ?? {})])]);
        for (const key of Object.keys(step)) if (!keys.has(key)) problems.push(`${where}: unknown field ${key}`);
        if (step.if_bound !== undefined && (phase !== "restore" || typeof step.if_bound !== "string" || !known.has(step.if_bound))) problems.push(`${where}: if_bound must name an earlier binding, in restore only`);
        if (step.allow_error !== undefined && (phase !== "restore" || typeof step.allow_error !== "string")) problems.push(`${where}: allow_error is a restore-only refusal code`);
      }
      if (kind === "wait") {
        const ms = Number(step.ms);
        if (v2 && typeof step.ms !== "number") problems.push(`${where}: ms must be a number`);
        if (!(ms >= 0 && ms <= 120000)) problems.push(`${where}: wait needs "ms" between 0 and 120000`);
        plan.push({ index, phase, label, kind, ms, step });
        continue;
      }
      if (kind === "note" || kind === "ask") {
        if (!step.text) problems.push(`${where}: ${kind} needs "text"`);
        if (kind === "ask" && phase === "restore") problems.push(`${where}: restore steps can't ask the player anything`);
        if (step.replaced_by !== undefined && (kind !== "ask" || typeof step.replaced_by !== "string" || !/^[a-z]+(\.[a-z]+)+$/.test(step.replaced_by))) {
          problems.push(`${where}: replaced_by belongs on an ask and names a command such as photo.open`);
        }
        plan.push({ index, phase, label, kind, text: String(step.text ?? ""), step });
        continue;
      }
      const commandName = kind === "run" ? step.command : STEP_COMMANDS[kind];
      if (!commandName) {
        problems.push(`${where}: unknown step "${kind}" (use ${[...Object.keys(STEP_COMMANDS), "wait", "note", "ask", "run"].join(", ")})`);
        continue;
      }
      const command = findCommand(commandName);
      if (!command) {
        problems.push(`${where}: no command "${commandName}"`);
        continue;
      }
      const input = { ...(script.defaults?.[kind] ?? {}), ...(kind === "run" ? (step.input ?? {}) : own) };
      if ((kind === "capture" || kind === "burst" || (kind === "run" && (commandName === "capture.screenshot" || commandName === "capture.burst"))) && input.name === undefined) {
        input.name = label.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80);
      }
      for (const problem of v2 ? validateBound(command.input, input, known) : validate(command.input, input)) problems.push(`${where}: ${problem}`);
      if (v2) {
        if (commandName === "session.wait" && input.after === undefined) problems.push(`${where}: schema 2 waits require a cursor captured before the action`);
        for (const key of ["who", "message_id"] as const) {
          if (input[key] !== undefined && (typeof input[key] !== "string" || !String(input[key]).startsWith("$"))) problems.push(`${where}: ${key} must use a returned binding`);
        }
        for (const problem of validateBindingName(step, known)) problems.push(`${where}: ${problem}`);
      }
      plan.push({ index, phase, label, kind, command: command.name, input, step });
    }
  };
  add("steps", script.steps);
  add("restore", script.restore);
  const labels = plan.map((p) => p.label);
  for (const label of new Set(labels)) if (labels.filter((l) => l === label).length > 1) problems.push(`label "${label}" is used more than once`);
  return { plan, problems };
}

type StepRecord = {
  index: number;
  phase: string;
  label: string;
  kind: string;
  command?: string;
  input?: Record<string, unknown>;
  started_at: string;
  ms: number;
  ok: boolean;
  skipped?: boolean;
  result?: unknown;
  error?: unknown;
  undo?: string;
  files?: Record<string, string>;
  replaced_by?: string;
  echoed?: boolean;
};

export type SessionRunOptions = {
  api: CommandApi;
  outDir: string;
  /** Start at this step label (earlier steps are skipped). */
  from?: string;
  /** Stop after this step label (restore does not run: the session continues later). */
  until?: string;
  /** How an "ask" step is answered: resolve when the player is done. Without one, the run pauses at the ask. */
  ask?: (text: string, label: string) => Promise<void>;
  log?: (line: string) => void;
  scriptPath?: string;
  /**
   * Stops the run (Ctrl+C): the current wait, ask or game.wait ends, the remaining steps are
   * skipped, and "restore" runs once. A command already sent to the game finishes first.
   */
  signal?: AbortSignal;
  /** Show notes and asks in the game through ui.message (default true). */
  echo?: boolean;
  /** Test-only clock injection for deterministic observation replays. */
  clock?: Clock;
};

/** Seconds a note stays up in the game; an ask stays until answered (at most ui.message's 600 s). */
export const ECHO_NOTE_SECONDS = 20;
export const ECHO_ASK_SECONDS = 600;

/** Resolves after ms, or at once when the signal aborts. */
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolveSleep) => {
    if (signal?.aborted) return resolveSleep();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolveSleep();
    }
    signal?.addEventListener("abort", done, { once: true });
  });

/** Settles with the promise, or with "aborted" when the signal aborts first. */
function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T | "aborted"> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve("aborted");
  return new Promise((resolveRace, rejectRace) => {
    const onAbort = () => resolveRace("aborted");
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolveRace(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        rejectRace(error);
      },
    );
  });
}

export async function runScript(
  script: SessionScript,
  options: SessionRunOptions,
): Promise<{ ok: boolean; outcome: RunOutcome; next?: string; manifestPath: string; records: StepRecord[] }> {
  const log = options.log ?? ((line: string) => console.log(line));
  const { plan, problems } = planScript(script);
  for (const [flag, label] of [
    ["--from", options.from],
    ["--until", options.until],
  ] as const) {
    if (label !== undefined && !plan.some((p) => p.phase === "steps" && p.label === label)) problems.push(`${flag}: no step labelled "${label}"`);
  }
  if (problems.length) throw new Error(`script problems:\n  ${problems.join("\n  ")}`);
  mkdirSync(options.outDir, { recursive: true });
  const api = options.api;
  const testing = script.schema === SCRIPT_SCHEMA_2 ? new TestSession(api, script, options.outDir, options.from !== undefined, options.clock) : undefined;
  if (testing) await testing.verifyIdentity(options.signal);
  const records: StepRecord[] = [];
  const snapshot = async (name: string) => {
    const outcome = await api.run(name, {}, { source: "session" });
    return outcome.ok ? outcome.result : { error: outcome.error };
  };
  // The player's view: notes and asks under the bridge's in-game label (best effort, never a failure).
  const echo = async (input: Record<string, unknown>) => {
    if (options.echo === false) return false;
    try {
      const outcome = await api.run("ui.message", input, { source: "session" });
      return outcome.ok;
    } catch {
      return false;
    }
  };
  const startedAt = new Date().toISOString();
  const before = { bridge: await snapshot("bridge.info"), game: await snapshot("game.status") };
  await echo({ text: `XF session: ${script.title ?? script.name}${options.from ? ` (from ${options.from})` : ""}`, level: "info", seconds: 10 });

  let failed = false;
  let interrupted = false;
  let crash: string | null = null;
  let paused: { at: string; next?: string; text?: string } | null = null;
  // An ask shown in the game and not yet answered: cleared in the finally below, however the run ends (RB-64).
  let askShown = false;
  let skipping = options.from !== undefined;
  const signal = options.signal;
  const steps = plan.filter((p) => p.phase === "steps");
  const nextLabel = (planned: PlannedStep) => steps[steps.indexOf(planned) + 1]?.label;
  const skip = (planned: PlannedStep, ok: boolean) =>
    records.push({ index: planned.index, phase: planned.phase, label: planned.label, kind: planned.kind, started_at: new Date().toISOString(), ms: 0, ok, skipped: true,
      ...(testing ? { result: { verdict: "NOT RUN", missing: ["Step skipped"] } } : {}) });

  const runStep = async (planned: PlannedStep, stepSignal?: AbortSignal) => {
    const started = performance.now();
    const record: StepRecord = { index: planned.index, phase: planned.phase, label: planned.label, kind: planned.kind, started_at: new Date().toISOString(), ms: 0, ok: true };
    if (testing && typeof planned.step.if_bound === "string" && !Object.hasOwn(testing.bindings, planned.step.if_bound)) {
      skip(planned, true); return records.at(-1)!;
    }
    try { if (testing && TEST_STEP_KINDS.has(planned.kind)) {
      const outcome = await testing.execute({ ...planned.step, label: planned.label }, stepSignal);
      record.ok = outcome.ok; record.result = outcome.result; record.error = outcome.error;
    } else if (planned.kind === "wait") {
      await sleep(planned.ms!, stepSignal);
    } else if (planned.kind === "note") {
      record.result = planned.text;
      log(`     note: ${planned.text}`);
      record.echoed = await echo({ text: planned.text!.slice(0, 500), level: "info", seconds: ECHO_NOTE_SECONDS });
    } else if (planned.kind === "ask") {
      record.result = planned.text;
      if (planned.step.replaced_by) record.replaced_by = planned.step.replaced_by;
      log(`     ASK: ${planned.text}`);
      record.echoed = await echo({ text: planned.text!.slice(0, 500), level: "ask", seconds: ECHO_ASK_SECONDS });
      askShown = askShown || record.echoed === true;
      if (options.ask) {
        await untilAborted(options.ask(planned.text!, planned.label), stepSignal);
        if (askShown && !stepSignal?.aborted) {
          await echo({ clear: true });
          askShown = false;
        }
      } else {
        paused = { at: planned.label, next: nextLabel(planned), text: planned.text };
        record.skipped = true;
      }
    } else {
      const input = testing ? testing.resolve(planned.input!) : planned.input!;
      const outcome: CommandOutcome = await api.run(planned.command!, input, { source: "session", captureRoot: options.outDir, signal: stepSignal });
      record.command = planned.command;
      record.input = input;
      record.ok = outcome.ok;
      if (outcome.ok) {
        record.result = outcome.result;
        testing?.bind(planned.step.bind, outcome.result);
        if (outcome.undo) record.undo = outcome.undo;
        const capture = outcome.result as { full?: { path: string }; view?: { path: string }; contact_sheet?: { path: string }; manifest?: string };
        if (capture?.full?.path && capture.view?.path) {
          record.files = { full: relative(options.outDir, capture.full.path), view: relative(options.outDir, capture.view.path) };
        } else if (capture?.contact_sheet?.path && capture.manifest) {
          record.files = { sheet: relative(options.outDir, capture.contact_sheet.path), manifest: relative(options.outDir, capture.manifest) };
        }
        if (planned.step.expect_error) {
          record.ok = false;
          record.error = { code: "unexpected_success", message: `Expected the game to refuse this with ${planned.step.expect_error}, but it went ahead.` };
        }
      } else {
        record.error = outcome.error;
        if (planned.step.expect_error && outcome.error.code === planned.step.expect_error) record.ok = true;
        if (testing && planned.step.allow_error === outcome.error.code) record.ok = true;
      }
    } } catch (error) {
      if (!testing) throw error;
      record.ok = false;
      record.error = { code: stepSignal?.aborted ? "interrupted" : "observation_failed", message: String(error) };
      record.result = { verdict: "INCONCLUSIVE", missing: [String(error)] };
    }
    if (stepSignal?.aborted && planned.phase === "steps") {
      record.ok = false;
      record.error = { code: "interrupted", message: "Stopped by the user (Ctrl+C)." };
    }
    record.ms = Math.round(performance.now() - started);
    records.push(record);
    const status = record.skipped ? "WAIT" : record.ok ? "OK  " : "FAIL";
    const detail = record.ok ? "" : ` ${(record.error as { message?: string })?.message ?? ""}`;
    log(`${status} ${String(planned.index).padStart(3)} ${planned.label} (${planned.kind}${record.command ? ` ${record.command}` : ""}) ${record.ms}ms${detail}`);
    return record;
  };

  try {
    for (const planned of steps) {
      if (skipping && planned.label !== options.from) {
        skip(planned, true);
        continue;
      }
      skipping = false;
      if (!failed && !paused && signal?.aborted) {
        interrupted = true;
        failed = true;
        log("Stopped by the user; the remaining steps are skipped.");
      }
      if (failed || paused) {
        skip(planned, !failed);
        continue;
      }
      const record = await runStep(planned, signal);
      if (signal?.aborted) {
        interrupted = true;
        failed = true;
        continue;
      }
      if (!record.ok && !planned.step.continue_on_error) failed = true;
      if (planned.label === options.until && !failed && !paused) paused = { at: planned.label, next: nextLabel(planned) };
    }
  } catch (error) {
    crash = (error as Error)?.message ?? String(error);
    failed = true;
    log(`The session stopped on an unexpected error: ${crash}`);
  } finally {
    // An ask still on screen (interrupted while waiting, a crash, or a pause at an ask) is taken down
    // first; a paused run shows its own closing line below instead (RB-64).
    if (askShown) {
      await echo({ clear: true });
      askShown = false;
    }
    // Restore runs exactly once, after a finished, failed, interrupted or crashed run, and never
    // when the run only paused at an ask (the session continues later). It isn't interrupted by
    // the same Ctrl+C; the command line exits at once on a second one.
    if (!paused) {
      for (const planned of plan.filter((p) => p.phase === "restore")) {
        try {
          await runStep(planned);
        } catch (error) {
          log(`restore step ${planned.label} failed: ${(error as Error)?.message ?? error}`);
        }
      }
    }
  }

  const restore = { ran: !paused, ok: records.filter((r) => r.phase === "restore").every((r) => r.ok),
    steps: records.filter((r) => r.phase === "restore").map((r) => ({ label: r.label, ok: r.ok, skipped: r.skipped ?? false })) };
  if (testing && !restore.ok) failed = true;
  let diagnostics: unknown;
  if (testing && script.diagnostic_logs) {
    try {
      diagnostics = await testing.diagnostics(script.diagnostic_logs);
      const health = diagnostics as { complete: boolean; errors: unknown[] };
      if (!health.complete || health.errors.length) failed = true;
    } catch (error) { diagnostics = { missing: [String(error)] }; failed = true; }
  }
  // The closing line, always (RB-64): a paused run says where it waits and what it waits for.
  if (paused) {
    await echo({ text: `XF session paused at "${paused.at}"${paused.text ? `: ${paused.text}` : ""}`.slice(0, 500), level: "ask", seconds: ECHO_ASK_SECONDS });
  } else {
    await echo({ text: `XF session ${interrupted ? "stopped" : failed ? "stopped early" : "complete"}: ${script.title ?? script.name}`, level: failed ? "warn" : "done", seconds: 15 });
  }
  const after = { bridge: await snapshot("bridge.info"), game: await snapshot("game.status") };
  api.close();
  const outcome: RunOutcome = interrupted ? "interrupted" : failed ? "failed" : paused ? "paused" : "complete";
  const run = {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    ...(options.from ? { from: options.from } : {}),
    ...(options.until ? { until: options.until } : {}),
    outcome,
    ...(crash ? { error: crash } : {}),
    ...(paused ? { paused_at: paused.at, continue_from: paused.next ?? null } : {}),
    ok: !failed && records.every((r) => r.ok || r.skipped),
    before,
    after,
    ...(testing ? { bindings: testing.bindings, diagnostics, restore } : {}),
    // Steps skipped only because of --from are left out; skipped asks and failures stay.
    steps: records.filter((r) => !(r.skipped && r.ok && r.kind !== "ask")),
  };
  // One manifest per report folder: each part of a session (between asks) adds its run.
  const manifestPath = join(options.outDir, "manifest.json");
  let runs: unknown[] = [];
  if (existsSync(manifestPath)) {
    try {
      const previous = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (previous?.script?.name === script.name && Array.isArray(previous.runs)) runs = previous.runs;
    } catch {
      // A damaged manifest is replaced.
    }
  }
  runs.push(run);
  const manifest = {
    schema: "xfb/session-report-2",
    script: { name: script.name, title: script.title, card: script.card, path: options.scriptPath, requires: script.requires ?? [] },
    runs,
    notes: [
      "Screenshots are external window captures (what was on screen, after ReShade and overlays), 8-bit. Each step's result records the source window size, crop and scale.",
      "Write steps list how to undo them. Saving/loading only happens if the script explicitly requests those commands.",
      ...(testing ? ["Assertion PASS covers the named state/geometry predicate, not rendered pixels, animation or audio. NPC reads use the existing 4 Hz cache; read cadence is measured, source timestamps are unavailable."] : []),
    ],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return { ok: run.ok, outcome, next: paused?.next, manifestPath, records };
}

async function askOnTerminal(text: string) {
  process.stdout.write(`\n>>> ${text}\n>>> Press Enter when done (Ctrl+C stops the session). `);
  await new Promise<void>((resolveAsk) => {
    const onData = () => {
      process.stdin.off("data", onData);
      process.stdin.pause();
      resolveAsk();
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const valued = ["--out", "--from", "--until", "--runtime-dir", "--fixtures"];
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const scriptPath = args.find((a, i) => !a.startsWith("--") && !valued.includes(args[i - 1]));
  if (!scriptPath || !existsSync(scriptPath)) {
    console.error("usage: bun tools/session.ts <script.json> [--dry-run] [--fixtures <private.json>] [--out <dir>] [--from <step label>] [--until <step label>] [--no-ask] [--no-echo]");
    process.exit(2);
  }
  const script = JSON.parse(readFileSync(scriptPath, "utf8")) as SessionScript;
  if (option("--fixtures")) script.fixtures = { ...script.fixtures, ...JSON.parse(readFileSync(option("--fixtures")!, "utf8")) };
  const { plan, problems } = planScript(script);
  console.log(`${script.title ?? script.name}: ${plan.length} steps${script.card ? ` (card: ${script.card})` : ""}`);
  for (const need of script.requires ?? []) console.log(`  requires: ${need}`);
  if (problems.length) {
    console.error(`\nThe script has problems:\n  ${problems.join("\n  ")}`);
    process.exit(2);
  }
  if (args.includes("--dry-run")) {
    for (const p of plan) {
      const later = p.step.replaced_by ? ` [later: ${p.step.replaced_by}]` : "";
      const what = p.command ? ` -> ${p.command} ${JSON.stringify(p.input)}` : p.ms !== undefined ? ` ${p.ms} ms` : TEST_STEP_KINDS.has(p.kind) ?
        ` ${JSON.stringify(Object.fromEntries(Object.entries(p.step).filter(([key]) => key !== "do" && key !== "label")))}` : ` ${p.text}${later}`;
      console.log(`  ${String(p.index).padStart(3)} ${p.phase === "restore" ? "[restore] " : ""}${p.label}: ${p.kind}${what}`);
    }
    console.log("\nDry run: the script is valid. Nothing was sent to the game.");
    process.exit(0);
  }
  const stampText = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = resolve(option("--out") ?? join(import.meta.dir, "..", "captures", "sessions", `${script.name}-${stampText}`));
  const interactive = Boolean(process.stdin.isTTY) && !args.includes("--no-ask");
  const api = new CommandApi({ runtimeDir: option("--runtime-dir") });
  // The advisory lock keeps the MCP server off the bridge while this session drives the game.
  const lock = acquireSessionLock(api.runtimeDir, script.name);
  if ("heldBy" in lock) {
    console.error("\n" + sessionRunningMessage(lock.heldBy).replace(/ Screenshots still work.*$/, "") + " Only one session can run at a time.");
    process.exit(2);
  }
  // Ctrl+C: stop after the current command and run "restore" once (leave photo mode, which also
  // shows its menu again); a second Ctrl+C exits at once.
  const stop = new AbortController();
  process.on("SIGINT", () => {
    if (stop.signal.aborted) {
      console.error("\nStopped without finishing restore. Check the game: leave photo mode and load the safety save if needed.");
      process.exit(130);
    }
    console.error("\nStopping: finishing the current command, then running the restore steps (Ctrl+C again to quit at once).");
    stop.abort();
  });
  const result = await runScript(script, {
    signal: stop.signal,
    api,
    outDir,
    from: option("--from"),
    until: option("--until"),
    ask: interactive ? askOnTerminal : undefined,
    echo: !args.includes("--no-echo"),
    scriptPath: basename(scriptPath),
  });
  lock.release();
  if (result.outcome === "paused") {
    console.log(result.next ? `\nPaused. Continue with:\n  bun tools/session.ts ${scriptPath} --out "${outDir}" --from ${result.next}` : "\nPaused after the last step.");
    console.log(`Report so far: ${result.manifestPath}`);
    process.exit(0);
  }
  console.log(`\n${result.outcome === "complete" ? "Session complete" : result.outcome === "interrupted" ? "Session stopped by Ctrl+C (restore ran)" : "Session stopped early"}: ${result.manifestPath}`);
  if (result.outcome === "interrupted") process.exit(130);
  process.exit(result.ok ? 0 : 1);
}

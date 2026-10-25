// Schema 3 session scripts: rows with verdicts, run unattended on top of the plan module (testing/plan.ts).
//
// A script is setup steps, a list of rows and teardown steps. Each row has an id, a title, requirements, steps (plan
// steps: retry, alternatives, branches, fallback and deadlines), pass checks and cleanup steps, and ends with one
// verdict: PASS, FAIL, PARTIAL or SKIP(reason), with its evidence files. One row's failure never stalls the batch: a
// failed step skips its row (on_fail skip_row, the default), fails it (fail_row: the step's failure is the finding),
// carries on (continue) or stops the batch (stop), and the next row starts after the row's cleanup.
//
// Before each row the runner brings the staged bridge's config.ini to what the row requires (config.set with a
// backup) and restarts the game when a value it reads at load changed (theme, motion, the overlay): close it
// cleanly, launch it through MO2, wait for the bridge, load the save, press past the start prompt. Those prelude
// steps are plan data too, so the dry run shows them. A handed_over refusal or the commit tripwire stops the batch
// cleanly; the teardown always runs (the supervisor cleared, the recorder stopped, actors released, messages
// cleared, the ink panel put back, config.ini restored).
//
// The executor below maps actions to the command API (one persistent writer connection), the host adapter
// (testing/host.ts) and the schema-2 test steps (testing/script.ts). Verdicts and evidence are this layer's; the
// plan module knows nothing of them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { findCommand } from "../api/catalogue.ts";
import type { CommandApi } from "../api/command-api.ts";
import { decodePng, diffStats, crop } from "../capture/image.ts";
import { validateBound } from "./assertions.ts";
import { ConfigEditor, readIni, stagedConfigPath, type IniValues } from "./config-ini.ts";
import { cetWindowRect, decodeCetBinding, keysLabel, parseCetBindings, parseKeys, type Host } from "./host.ts";
import { checkMatch, checkPlan, describePlan, matches, realClock, resolveRefs, runPlan, type Action, type ExecContext, type Executor, type Match, type Outcome, type Plan, type PlanClock, type PlanResult, type ReportEntry, type Step } from "./plan.ts";
import { planTestStep, TEST_STEP_KINDS, TestSession } from "./script.ts";
import { captureCursor, waitForEvent } from "./windows.ts";

export const SCRIPT_SCHEMA_3 = "xfb/session-script-3";
export const REPORT_SCHEMA_3 = "xfb/session-report-3";

/** What a row needs. config: a staged config.ini key (the runner sets it); binding: a CET binding (equals: a key chord); fixture: a private value. */
export type Requirement = { config?: string; equals?: string; binding?: string; fixture?: string; note?: string };
/** A pass check over a bound result: match (plan Match against the value) or captured (its files exist). */
export type PassCheck = { label: string; ref: string; match?: Match; captured?: boolean };
export type SessionOnFail = "skip_row" | "fail_row" | "continue" | "stop";
/** A plan step in the session vocabulary (on_fail skip_row, fail_row, continue or stop). */
export type SessionStep = Omit<Step, "on_fail"> & { on_fail?: SessionOnFail | Step["on_fail"] };
export type Row = {
  id: string;
  title: string;
  requires?: Requirement[];
  steps: SessionStep[];
  pass?: PassCheck[];
  cleanup?: SessionStep[];
  deadline_ms?: number;
  /** Who judges what the captures show (for example "XF · Studio's UI review"): the verdict covers the state and the evidence. */
  judged_by?: string;
  /** restart: the game is restarted before the next row (the row stops the bridge, for example). */
  after?: "restart";
};
export type BatchScript = {
  schema: string;
  name: string;
  title?: string;
  card?: string;
  requires?: string[];
  fixtures?: Record<string, unknown>;
  setup?: SessionStep[];
  rows: Row[];
  teardown?: SessionStep[];
};
export type Verdict = "PASS" | "FAIL" | "PARTIAL" | "SKIP";

// ---- Action kinds ---------------------------------------------------------------------------------------

/** Step kinds that are catalogue commands with the step's own fields as input (schema 1's vocabulary). */
export const COMMAND_KINDS: Record<string, string> = {
  "set camera": "photo.camera.set", "set light": "photo.light.set", "apply cc": "cc.apply", frame: "photo.frame", capture: "capture.screenshot", burst: "capture.burst",
};
/** Every other action, with its fields (required ones first in each list). */
export const LOCAL_KINDS: Record<string, { required: string[]; optional: string[]; help: string }> = {
  run: { required: ["command"], optional: ["input", "expect_error"], help: "any catalogue command" },
  wait: { required: ["ms"], optional: [], help: "a pause (the clock)" },
  note: { required: ["text"], optional: [], help: "a line in the log and in the game" },
  ask: { required: ["text"], optional: ["choices", "seconds"], help: "a question in the game, answered with the answer keys or the CET button; value {label, choice}" },
  set: { required: ["value"], optional: [], help: "keep a value (with bind)" },
  "capture.compare": { required: ["a", "b"], optional: ["rect", "min_changed", "max_changed"], help: "how much two captures differ in an area (diff of their full files)" },
  "host.running": { required: [], optional: [], help: "is the game running; value {running, pid}" },
  "host.launch": { required: [], optional: [], help: "start the game through MO2 with the fixture's profile and arguments" },
  "host.close": { required: [], optional: [], help: "close the game's window (CloseMainWindow) and wait for the process to end" },
  "host.wait_exit": { required: [], optional: [], help: "wait for the game's process to end" },
  "host.key": { required: [], optional: ["keys", "binding"], help: "a guarded key or chord, sent only while the game is the foreground window" },
  "host.window": { required: [], optional: [], help: "the game window's size and place, the monitors, and derived capture areas (regions.cet_window)" },
  "host.commit": { required: [], optional: [], help: "the machine's free commit (GB) against the floor" },
  "config.set": { required: ["values"], optional: [], help: "set staged config.ini keys (backed up; restored at the end)" },
  "config.read": { required: [], optional: [], help: "the staged config.ini's values" },
  "config.restore": { required: [], optional: [], help: "put config.ini back as it was before the run" },
  "actors.release_all": { required: [], optional: [], help: "release every actor the bridge directs (npc.status, then npc.release despawn)" },
};

/** The command a step's action calls, or undefined (a local, host or test action). */
export function commandOf(action: Record<string, unknown>): string | undefined {
  if (action.do === "run") return typeof action.command === "string" ? action.command : undefined;
  return COMMAND_KINDS[action.do as string];
}

// ---- Planning --------------------------------------------------------------------------------------------

const SESSION_ON_FAIL: Record<string, "continue" | "end" | "stop"> = { skip_row: "end", fail_row: "end", continue: "continue", stop: "stop" };

/** Session steps to plan steps: on_fail skip_row/fail_row become end (fail_row labels are kept for the verdict). */
export function toPlanSteps(steps: SessionStep[] | undefined, failRow: Set<string>, where: string, problems: string[]): Step[] {
  return (steps ?? []).map((step) => {
    if (!step || typeof step !== "object") return step as Step;
    const out = { ...step } as Step;
    if (out.on_fail !== undefined) {
      const mapped = SESSION_ON_FAIL[out.on_fail as string];
      if (!mapped) problems.push(`${where}: on_fail is skip_row, fail_row, continue or stop (got ${String(out.on_fail)})`);
      if ((out.on_fail as string) === "fail_row") {
        if (typeof out.label !== "string") problems.push(`${where}: a fail_row step needs a label`);
        else failRow.add(out.label);
      }
      out.on_fail = mapped ?? "end";
    }
    for (const key of ["fallback", "together", "sequence"] as const) if (Array.isArray(out[key])) out[key] = toPlanSteps(out[key] as Step[], failRow, where, problems);
    if (Array.isArray(out.alternatives)) out.alternatives = (out.alternatives as Step[][]).map((route) => toPlanSteps(route, failRow, where, problems));
    if (Array.isArray(out.outcomes)) out.outcomes = (out.outcomes as Step["outcomes"])!.map((b) => (b && Array.isArray(b.run) ? { ...b, run: toPlanSteps(b.run, failRow, where, problems) } : b));
    return out;
  });
}

/** Every bind name in the script (so $references may point forward across rows' text, checked again at run time). */
function bindNames(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => bindNames(v, out));
  else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (key === "bind" && typeof v === "string") out.add(v);
      bindNames(v, out);
    }
  }
  return out;
}

/** The action checker for checkPlan: known kinds, catalogue commands and their inputs, host fields, schema-2 steps. */
export function makeActionChecker(known: Set<string>) {
  return (action: Action, where: string): string[] => {
    const problems: string[] = [];
    const kind = action.do;
    if (TEST_STEP_KINDS.has(kind)) {
      for (const problem of planTestStep({ ...action, bind: action.bind ?? "x" }, new Set([...known, "x"]))) if (!/is already defined|forward reference/.test(problem)) problems.push(`${where}: ${problem}`);
      return problems;
    }
    const command = commandOf(action);
    if (kind === "run" || COMMAND_KINDS[kind]) {
      const def = command ? findCommand(command) : undefined;
      if (!def) return [`${where}: no command "${command}"`];
      const input = kind === "run" ? (action.input ?? {}) : Object.fromEntries(Object.entries(action).filter(([k]) => k !== "do"));
      for (const problem of validateBound(def.input, input, known)) problems.push(`${where}: ${problem}`);
      if (kind === "run") for (const key of Object.keys(action)) if (!["do", "command", "input", "expect_error"].includes(key)) problems.push(`${where}: unknown field ${key}`);
      if ((kind === "capture" || kind === "burst") && typeof action.name !== "string") problems.push(`${where}: a ${kind} step names its files (name)`);
      return problems;
    }
    const spec = LOCAL_KINDS[kind];
    if (!spec) return [`${where}: unknown action "${kind}" (use run, ${Object.keys(COMMAND_KINDS).join(", ")}, ${Object.keys(LOCAL_KINDS).filter((k) => k !== "run").join(", ")} or a test step)`];
    for (const key of spec.required) if (action[key] === undefined) problems.push(`${where}: ${kind} needs ${key}`);
    for (const key of Object.keys(action)) if (key !== "do" && !spec.required.includes(key) && !spec.optional.includes(key)) problems.push(`${where}: unknown field ${key} for ${kind}`);
    if (kind === "host.key") {
      if ((action.keys === undefined) === (action.binding === undefined)) problems.push(`${where}: host.key takes keys or binding`);
      if (typeof action.keys === "string" && !action.keys.startsWith("$")) { try { parseKeys(action.keys); } catch (error) { problems.push(`${where}: ${(error as Error).message}`); } }
      if (action.binding !== undefined && (typeof action.binding !== "string" || !/^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(action.binding))) problems.push(`${where}: binding is mod.name as CET's bindings.json has it (cet.overlay_key)`);
    }
    if (kind === "wait" && !(typeof action.ms === "number" && action.ms >= 0 && action.ms <= 600_000)) problems.push(`${where}: wait ms is 0 to 600000`);
    if (kind === "config.set" && (!action.values || typeof action.values !== "object")) problems.push(`${where}: config.set values is {"section.key": value}`);
    return problems;
  };
}

export type PlannedBatch = { setup: Plan; rows: { row: Row; plan: Plan; failRow: Set<string> }[]; teardown: Plan; problems: string[] };

/** Validates a schema-3 script and turns it into plans (setup, one per row, teardown). */
export function planBatch(script: BatchScript): PlannedBatch {
  const problems: string[] = [];
  if (script.schema !== SCRIPT_SCHEMA_3) problems.push(`schema must be "${SCRIPT_SCHEMA_3}"`);
  const allowed = new Set(["schema", "name", "title", "card", "requires", "fixtures", "setup", "rows", "teardown"]);
  for (const key of Object.keys(script ?? {})) if (!allowed.has(key)) problems.push(`script: unknown field ${key}`);
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(script?.name ?? "")) problems.push("name must be 1-60 letters, digits, '.', '_' or '-'");
  if (!Array.isArray(script?.rows) || !script.rows.length) return { setup: { id: "setup", steps: [] }, rows: [], teardown: { id: "teardown", steps: [] }, problems: [...problems, "rows must be a non-empty list"] };
  const known = new Set(["fixture", "board", "cast", ...bindNames(script)]);
  const checker = makeActionChecker(known);
  const plan = (id: string, steps: SessionStep[] | undefined, extra: Partial<Plan> = {}, failRow = new Set<string>()) => {
    const p: Plan = { id, steps: toPlanSteps(steps, failRow, id, problems), ...extra };
    for (const problem of checkPlan(p, checker)) problems.push(`${id}: ${problem}`);
    return p;
  };
  const setup = plan("setup", script.setup);
  const ids = new Set<string>();
  const names = new Map<string, string>();
  const rows = script.rows.map((row, i) => {
    const where = `row ${i + 1}${row?.id ? ` (${row.id})` : ""}`;
    if (!row || typeof row !== "object") { problems.push(`${where}: a row must be an object`); return { row, plan: { id: "x", steps: [] }, failRow: new Set<string>() }; }
    for (const key of Object.keys(row)) if (!["id", "title", "requires", "steps", "pass", "cleanup", "deadline_ms", "judged_by", "after"].includes(key)) problems.push(`${where}: unknown field ${key}`);
    if (typeof row.id !== "string" || !/^[A-Za-z0-9._-]{1,60}$/.test(row.id)) problems.push(`${where}: id must be 1-60 letters, digits, '.', '_' or '-'`);
    if (ids.has(row.id)) problems.push(`${where}: id is used more than once`);
    ids.add(row.id);
    if (typeof row.title !== "string" || !row.title) problems.push(`${where}: needs a title`);
    for (const need of row.requires ?? []) {
      const kinds = ["config", "binding", "fixture"].filter((k) => (need as Record<string, unknown>)[k] !== undefined);
      if (kinds.length > 1 || (!kinds.length && need.note === undefined)) problems.push(`${where}: a requirement is one of config, binding or fixture (a note may explain it), or a note alone`);
      if (need.config !== undefined && (typeof need.config !== "string" || !/^[a-z_]+\.[a-z_]+$/.test(need.config) || need.equals === undefined)) problems.push(`${where}: a config requirement is {config: "section.key", equals: value}`);
    }
    for (const check of row.pass ?? []) {
      if (typeof check.label !== "string" || typeof check.ref !== "string" || !check.ref.startsWith("$")) problems.push(`${where}: a pass check has a label and a $ref`);
      if ((check.match === undefined) === (check.captured === undefined)) problems.push(`${where}: a pass check has match or captured`);
      if (check.match !== undefined) checkMatch(check.match, `${where} pass ${check.label}`, problems);
      const name = String(check.ref).slice(1).split(".")[0];
      if (!known.has(name)) problems.push(`${where}: pass check ${check.label} reads ${check.ref}, which no step binds`);
    }
    if (row.after !== undefined && row.after !== "restart") problems.push(`${where}: after is restart`);
    const failRow = new Set<string>();
    const p = plan(row.id, row.steps, { ...(row.deadline_ms ? { deadline_ms: row.deadline_ms } : {}), ...(row.cleanup ? { finally: toPlanSteps(row.cleanup, failRow, where, problems) } : {}) }, failRow);
    // Capture names are the evidence's file names: one per capture across the script.
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") {
        const v = value as Record<string, unknown>;
        if ((v.do === "capture" || v.do === "burst") && typeof v.name === "string") {
          if (names.has(v.name) && names.get(v.name) !== row.id) problems.push(`${where}: capture name ${v.name} is also used in ${names.get(v.name)}`);
          names.set(v.name, row.id);
        }
        Object.values(v).forEach(walk);
      }
    };
    walk(row.steps);
    return { row, plan: p, failRow };
  });
  const teardown = plan("teardown", script.teardown);
  return { setup, rows, teardown, problems };
}

// ---- The prelude: config and the game's lifecycle, as plan data --------------------------------------------

/** Config keys a row requires that differ from the values given. */
export function configNeeds(row: Row, values: IniValues): Record<string, string> {
  const needs: Record<string, string> = {};
  for (const need of row.requires ?? []) if (need.config && values[need.config] !== String(need.equals)) needs[need.config] = String(need.equals);
  return needs;
}

/** Launch through MO2, wait for the process and the bridge, then load the save and press past the start prompt (or, read-only, wait for the menu). */
export function launchSteps(load: boolean): Step[] {
  return [
    { label: "launch", do: "host.launch", outcomes: [{ name: "already_running", match: { code: "already_running" }, result: "ok" }] },
    { label: "process", do: "host.running", until: { path: "running", equals: true }, interval_ms: 2000, deadline_ms: 120_000 },
    { label: "bridge", do: "run", command: "bridge.ping", input: {}, until: { ok: true }, interval_ms: 2000, deadline_ms: 180_000 },
    ...(load
      ? [
          { label: "load", do: "run", command: "game.load", input: { name: "$fixture.save", discard_unsaved: true, continue_wait_s: 120 }, bind: "load", deadline_ms: 150_000,
            retry: { times: 2, backoff_ms: 5000, on: { code: ["timeout", "busy", "bridge_busy", "game_loading", "rate_limited"] } },
            alternatives: [[{ do: "run", command: "game.load", input: { latest: true, discard_unsaved: true, continue_wait_s: 120 }, bind: "load", deadline_ms: 150_000 }]] },
          { label: "press-any-key", do: "host.key", keys: "Space", when: { match: { ref: "$load.reached", equals: "press_any_key" } },
            retry: { times: 5, backoff_ms: 3000, on: { code: "not_foreground" } },
            outcomes: [{ name: "behind", match: { code: "not_foreground" }, run: [{ do: "note", text: "The game isn't in front, so the runner can't press past the start prompt: click into the game (or press Space)." }] }],
            on_fail: "continue" as const },
          { label: "gameplay", do: "run", command: "game.wait", input: { phase: "gameplay", timeout_ms: 180_000 }, deadline_ms: 190_000 },
        ]
      : [{ label: "menu", do: "run", command: "game.wait", input: { phase: ["main_menu", "gameplay"], timeout_ms: 120_000 }, deadline_ms: 130_000 }]),
  ] as Step[];
}

/** Close the game cleanly: its window's close, then (if it asks) Enter to confirm; then wait for the process to end. */
export function closeSteps(): Step[] {
  return [
    { label: "close", do: "host.close", deadline_ms: 90_000, alternatives: [[{ do: "host.key", keys: "Enter", on_fail: "continue" }, { do: "host.wait_exit", deadline_ms: 60_000 }]] },
  ];
}

/** The steps that bring the game to a row's config: set the keys, restart when they changed (or a restart is due), launch when it isn't running. */
export function preludeSteps(needs: Record<string, string>, restart: boolean, load: boolean): Step[] {
  const changes = Object.keys(needs).length > 0;
  return [
    ...(changes ? [{ label: "config", do: "config.set", values: needs }] : []),
    ...(changes || restart ? [{ label: "restart", sequence: [...closeSteps(), ...launchSteps(load)], when: { check: { do: "host.running" }, match: { path: "running", equals: true } } }] : []),
    { label: "start", sequence: launchSteps(load), when: { check: { do: "host.running" }, match: { path: "running", equals: false } } },
  ] as Step[];
}

/** The built-in teardown, after the script's own: every step best effort. */
export function builtinTeardown(): Step[] {
  return [
    { label: "supervisor", do: "run", command: "supervisor.clear", input: {}, on_fail: "continue" },
    { label: "recorder", do: "run", command: "test.record.stop", input: {}, on_fail: "continue" },
    { label: "actors", do: "actors.release_all", on_fail: "continue" },
    { label: "messages", do: "run", command: "ui.message", input: { clear: true }, on_fail: "continue" },
    { label: "ink-panel", do: "run", command: "ui.hud", input: { reset: true }, on_fail: "continue" },
    { label: "photo-mode", do: "run", command: "photo.exit", input: {}, when: { check: { do: "run", command: "game.status", input: {} }, match: { path: "phase", equals: "photo_mode" } }, on_fail: "continue" },
    { label: "config", do: "config.restore", on_fail: "continue" },
  ] as Step[];
}

/** The config each row starts from, simulated from a starting config (the staged file): what changes and restarts the order needs. */
export function simulateConfig(rows: Row[], start: IniValues): { row: string; needs: Record<string, string>; restart: boolean }[] {
  const values = { ...start };
  let restartDue = false;
  return rows.map((row) => {
    const needs = configNeeds(row, values);
    Object.assign(values, needs);
    const out = { row: row.id, needs, restart: Object.keys(needs).length > 0 || restartDue };
    restartDue = row.after === "restart";
    return out;
  });
}

const needsLoad = (values: IniValues) => values["bridge.allow_writes"] !== "false";

/** "section.key" values as {section: {key: value}}. */
export function nestIni(values: IniValues): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [name, value] of Object.entries(values)) {
    const dot = name.indexOf(".");
    (out[name.slice(0, dot)] ??= {})[name.slice(dot + 1)] = value;
  }
  return out;
}

// ---- The executor ---------------------------------------------------------------------------------------

export type BatchContext = {
  api: CommandApi;
  host: Host;
  outDir: string;
  fixtures: Record<string, unknown>;
  clock: PlanClock;
  log: (line: string) => void;
  echo: boolean;
  config?: ConfigEditor;
  /** Reads the CET bindings file (fixtures game_dir); tests pass their own text. */
  readCetBindings?: () => string | null;
  /** The commit floor in GB (fixtures commit_floor_gb, default 4) and how often it is read. */
  commitFloorGb?: number;
  commitEveryMs?: number;
};

const GB = 1024 ** 3;
const HANDED_OVER = "The game was handed to the player (session.handover: the commit tripwire, the player or another tool), so every change is refused until session.resume. The batch stopped here.";

/** Executes plan actions for the session runner; keeps each row's evidence and every refused key press. */
export class SessionExecutor implements Executor {
  testing: TestSession;
  evidence: string[] = [];
  refusals: { at: string; keys: string; reason: string }[] = [];
  stopReason: string | undefined;
  private rowDir: string;
  private commitInFlight: Promise<void> | null = null;
  private lastCommitRead = -Infinity;
  lastFreeGb: number | null = null;

  constructor(private readonly c: BatchContext, script: BatchScript) {
    this.testing = new TestSession(c.api, { ...script, fixtures: c.fixtures } as never, c.outDir, false, c.clock);
    this.rowDir = c.outDir;
  }

  get bindings() {
    return this.testing.bindings as Record<string, unknown>;
  }

  startRow(id: string) {
    this.evidence = [];
    this.rowDir = join(this.c.outDir, id);
    mkdirSync(this.rowDir, { recursive: true });
  }

  /** The commit tripwire, in the background: read every commitEveryMs; under the floor, hand the game over once and stop. */
  private watchCommit() {
    if (this.commitInFlight || this.c.clock.now() - this.lastCommitRead < (this.c.commitEveryMs ?? 10_000)) return;
    this.lastCommitRead = this.c.clock.now();
    this.commitInFlight = (async () => {
      const free = await this.c.host.freeCommitBytes().catch(() => null);
      this.lastFreeGb = free === null ? null : free / GB;
      const floor = this.c.commitFloorGb ?? 4;
      if (free !== null && free < floor * GB && !this.stopReason) {
        this.stopReason = `The commit tripwire tripped: free commit ${(free / GB).toFixed(1)} GB is under the ${floor} GB floor. The runner handed the game over (session.handover) and stopped.`;
        await this.c.api.run("session.handover", { note: "commit tripwire" }, { source: "session" }).catch(() => undefined);
      }
    })().finally(() => { this.commitInFlight = null; });
  }

  private async echo(input: Record<string, unknown>) {
    if (!this.c.echo) return false;
    try { return (await this.c.api.run("ui.message", input, { source: "session" })).ok; } catch { return false; }
  }

  private async gamePid() {
    return (await this.c.host.gameProcess())?.pid;
  }

  private keysFor(action: Action): { vks: number[]; label: string } | { error: string } {
    if (typeof action.keys === "string") {
      try { const vks = parseKeys(action.keys); return { vks, label: keysLabel(vks) }; } catch (error) { return { error: (error as Error).message }; }
    }
    const [mod, name] = String(action.binding).split(".");
    const text = this.c.readCetBindings?.() ?? null;
    if (text === null) return { error: "CET's bindings.json couldn't be read (fixtures game_dir)" };
    const value = parseCetBindings(text)[mod]?.[name];
    const vks = value === undefined ? [] : decodeCetBinding(value);
    return vks.length ? { vks, label: keysLabel(vks) } : { error: `CET has no key bound for ${action.binding}` };
  }

  async run(action: Action, context: ExecContext): Promise<Outcome> {
    this.watchCommit();
    if (this.stopReason) return { ok: false, code: "tripwire", message: this.stopReason, halt: this.stopReason };
    const kind = action.do;
    try {
      if (TEST_STEP_KINDS.has(kind)) {
        // Schema-2 steps resolve and checkpoint their own references (cursors advance in place).
        const result = await this.testing.execute({ ...context.raw, label: context.step, ...(context.bind ? { bind: context.bind } : { bind: `step_${context.step.replace(/[^A-Za-z0-9]/g, "_")}` }) }, context.signal);
        return { ok: result.ok, code: result.error?.code, message: result.error?.message, value: result.result };
      }
      const command = commandOf(action);
      if (command) return await this.runCommand(command, kind === "run" ? ((action.input as Record<string, unknown>) ?? {}) : Object.fromEntries(Object.entries(action).filter(([k]) => k !== "do")), action.expect_error as string | undefined, context);
      switch (kind) {
        case "wait":
          await this.c.clock.sleep(Number(action.ms), context.signal);
          return { ok: true };
        case "note":
          this.c.log(`     note: ${action.text}`);
          await this.echo({ text: String(action.text).slice(0, 500), level: "info", seconds: 20 });
          return { ok: true };
        case "set":
          return { ok: true, value: action.value };
        case "ask":
          return await this.ask(action, context);
        case "capture.compare":
          return this.compare(action);
        case "host.running": {
          const pid = await this.gamePid();
          return { ok: true, value: { running: pid !== undefined, ...(pid !== undefined ? { pid } : {}) } };
        }
        case "host.launch": {
          const mo2 = this.c.fixtures.mo2 as { exe?: string; profile?: string; executable?: string; arguments?: string } | undefined;
          if (!mo2?.exe || !mo2.profile || !mo2.executable) return { ok: false, code: "fixture_missing", message: "The fixtures file needs mo2.exe, mo2.profile and mo2.executable to launch the game." };
          if ((await this.gamePid()) !== undefined) return { ok: false, code: "already_running", message: "The game is already running." };
          const started = await this.c.host.launch({ exe: mo2.exe, profile: mo2.profile, executable: mo2.executable, arguments: mo2.arguments });
          return { ok: true, value: { command: started.command } };
        }
        case "host.close": {
          const pid = await this.gamePid();
          if (pid === undefined) return { ok: true, value: { closed: true, was_running: false } };
          if (!(await this.c.host.requestClose(pid))) return { ok: false, code: "no_window", message: "The game has no window to close." };
          return await this.waitExit(pid, context);
        }
        case "host.wait_exit": {
          const pid = await this.gamePid();
          return pid === undefined ? { ok: true, value: { closed: true } } : await this.waitExit(pid, context);
        }
        case "host.key": {
          const keys = this.keysFor(action);
          if ("error" in keys) return { ok: false, code: "no_key", message: keys.error };
          const sent = await this.c.host.pressKeys(keys.vks, keys.label);
          if (!sent.sent) {
            this.refusals.push({ at: context.step, keys: keys.label, reason: sent.refused ?? "refused" });
            return { ok: false, code: sent.refused?.includes("XFB_NO_INPUT") ? "input_disabled" : "not_foreground", message: `${keys.label} wasn't sent: ${sent.refused}`, value: sent };
          }
          return { ok: true, value: sent };
        }
        case "host.window": {
          const pid = await this.gamePid();
          const window = pid === undefined ? null : await this.c.host.window(pid);
          if (!window) return { ok: false, code: "no_window", message: "The game's window wasn't found." };
          const monitors = await this.c.host.monitors().catch(() => []);
          return { ok: true, value: { ...window, monitors, regions: { cet_window: cetWindowRect(window.width, window.height) } } };
        }
        case "host.commit": {
          const free = await this.c.host.freeCommitBytes();
          const floor = this.c.commitFloorGb ?? 4;
          if (free === null) return { ok: false, code: "unreadable", message: "The machine's commit counters couldn't be read." };
          return { ok: free >= floor * GB, code: free >= floor * GB ? undefined : "below_floor", value: { free_gb: Number((free / GB).toFixed(1)), floor_gb: floor } };
        }
        case "config.set": {
          if (!this.c.config?.exists()) return { ok: false, code: "no_config", message: "The staged config.ini wasn't found (fixtures staged_mod)." };
          const result = this.c.config.set(action.values as Record<string, string>);
          return { ok: true, value: { ...result, restart_needed: result.changed.length > 0 } };
        }
        case "config.read":
          if (!this.c.config?.exists()) return { ok: false, code: "no_config", message: "The staged config.ini wasn't found (fixtures staged_mod)." };
          // Nested by section, so a match's path reads overlay.enabled.
          return { ok: true, value: nestIni(this.c.config.read()) };
        case "config.restore":
          return { ok: true, value: this.c.config?.restore() ?? { restored: false, reason: "no staged config" } };
        case "actors.release_all": {
          const status = await this.c.api.run("npc.status", {}, { source: "session", signal: context.signal });
          if (!status.ok) return { ok: false, code: status.error.code, message: status.error.message };
          const actors = ((status.result as { npcs?: { who?: string }[] })?.npcs ?? []).map((n) => n.who).filter((w): w is string => typeof w === "string");
          const released: string[] = [];
          for (const who of actors) if ((await this.c.api.run("npc.release", { who, how: "despawn" }, { source: "session" })).ok) released.push(who);
          return { ok: released.length === actors.length, value: { actors, released } };
        }
      }
      return { ok: false, code: "unknown_action", message: `No action "${kind}".` };
    } catch (error) {
      return { ok: false, code: context.signal.aborted ? "cancelled" : "runner_error", message: String((error as Error)?.message ?? error) };
    }
  }

  private async runCommand(command: string, input: Record<string, unknown>, expectError: string | undefined, context: ExecContext): Promise<Outcome> {
    const outcome = await this.c.api.run(command, input, { source: "session", captureRoot: this.rowDir, signal: context.signal });
    if (!outcome.ok) {
      if (outcome.error.code === "handed_over") return { ok: false, code: "handed_over", message: outcome.error.message, halt: HANDED_OVER };
      if (expectError && outcome.error.code === expectError) return { ok: true, code: outcome.error.code, value: { refused: outcome.error } };
      return { ok: false, code: outcome.error.code, message: outcome.error.message };
    }
    if (expectError) return { ok: false, code: "unexpected_success", message: `Expected ${expectError}, but it went ahead.`, value: outcome.result };
    const capture = outcome.result as { full?: { path: string }; view?: { path: string }; contact_sheet?: { path: string }; manifest?: string };
    for (const file of [capture?.full?.path, capture?.view?.path, capture?.contact_sheet?.path, capture?.manifest]) if (typeof file === "string") this.evidence.push(relative(this.c.outDir, file));
    return { ok: true, value: outcome.result };
  }

  private async waitExit(pid: number, context: ExecContext): Promise<Outcome> {
    const started = this.c.clock.now();
    while (!context.signal.aborted) {
      const now = await this.c.host.gameProcess();
      if (!now || now.pid !== pid) return { ok: true, value: { closed: true, ms: Math.round(this.c.clock.now() - started) } };
      if (this.c.clock.now() + 2000 >= context.deadline) break;
      await this.c.clock.sleep(2000, context.signal);
    }
    return { ok: false, code: "still_running", message: "The game is still running." };
  }

  /** A question in the game: the answer comes through the event stream (answer keys or the CET window's button). */
  private async ask(action: Action, context: ExecContext): Promise<Outcome> {
    const cursor = await captureCursor(this.c.api, context.signal);
    const choices = Array.isArray(action.choices) ? action.choices : undefined;
    const seconds = Math.min(600, Math.max(5, Number(action.seconds ?? Math.round((context.deadline - this.c.clock.now()) / 1000))));
    const posted = await this.c.api.run("ui.message", { text: String(action.text).slice(0, 600), level: "ask", seconds, ...(choices ? { choices } : {}) }, { source: "session" });
    if (!posted.ok) return { ok: false, code: posted.error.code, message: posted.error.message, ...(posted.error.code === "handed_over" ? { halt: HANDED_OVER } : {}) };
    const id = (posted.result as { id?: number }).id;
    this.c.log(`     ASK (in game, id ${id}): ${action.text}`);
    const window = await waitForEvent(this.c.api, cursor, { kind: "answer", message_id: id }, Math.max(1, (context.deadline - this.c.clock.now()) / 1000 - 1), context.signal, this.c.clock);
    const answer = window.events.find((e) => e.kind === "answer" && e.data?.message_id === id);
    if (!answer) {
      await this.c.api.run("ui.message", { withdraw: id }, { source: "session" }).catch(() => undefined);
      return { ok: false, code: "no_answer", message: "Nobody answered in time.", value: { message_id: id } };
    }
    return { ok: true, value: { message_id: id, label: answer.data?.label, choice: answer.data?.choice, via: answer.data?.via } };
  }

  /** How much two captures differ (mean and changed share) inside an area of their full-resolution files. */
  private compare(action: Action): Outcome {
    const file = (v: unknown) => (typeof v === "string" ? v : (v as { full?: { path?: string } })?.full?.path);
    const [a, b] = [file(action.a), file(action.b)];
    if (!a || !b || !existsSync(a) || !existsSync(b)) return { ok: false, code: "no_capture", message: "Both captures' full files are needed." };
    let [pa, pb] = [decodePng(readFileSync(a)), decodePng(readFileSync(b))];
    const rect = action.rect as { x: number; y: number; width: number; height: number } | undefined;
    if (rect) {
      const fit = (p: typeof pa) => crop(p, { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.min(rect.width, p.width - Math.max(0, rect.x)), height: Math.min(rect.height, p.height - Math.max(0, rect.y)) });
      [pa, pb] = [fit(pa), fit(pb)];
    }
    if (pa.width !== pb.width || pa.height !== pb.height) return { ok: false, code: "size_mismatch", message: "The captures differ in size." };
    const stats = diffStats(pa, pb);
    const min = action.min_changed as number | undefined, max = action.max_changed as number | undefined;
    const ok = (min === undefined || stats.changed_fraction >= min) && (max === undefined || stats.changed_fraction <= max);
    return { ok, code: ok ? undefined : "difference_out_of_range", value: { ...stats, changed: stats.changed_fraction >= (min ?? 0.01) } };
  }
}

// ---- Verdicts ---------------------------------------------------------------------------------------------

export type CheckResult = { label: string; result: "pass" | "fail" | "not_evaluated"; detail?: string };

/** One pass check against the bindings; a ref the row didn't bind itself is not evidence for it. */
export function evaluateCheck(check: PassCheck, bindings: Record<string, unknown>, fresh: (name: string) => boolean): CheckResult {
  const name = check.ref.slice(1).split(".")[0];
  if (!Object.hasOwn(bindings, name) || !fresh(name)) return { label: check.label, result: "not_evaluated", detail: `${check.ref} wasn't bound in this row` };
  const missing: string[] = [];
  const value = resolveRefs(check.ref, bindings, missing);
  if (missing.length) return { label: check.label, result: "not_evaluated", detail: `${check.ref} has no such property` };
  if (check.captured) {
    const files = [(value as { full?: { path?: string } })?.full?.path, (value as { contact_sheet?: { path?: string } })?.contact_sheet?.path].filter((f): f is string => typeof f === "string");
    return files.length && files.every((f) => existsSync(f)) ? { label: check.label, result: "pass" } : { label: check.label, result: "fail", detail: "no capture file" };
  }
  return matches(check.match!, { ok: true, value }, bindings) ? { label: check.label, result: "pass" } : { label: check.label, result: "fail", detail: `${check.ref} = ${JSON.stringify(value)?.slice(0, 200)}` };
}

/**
 * The row's verdict from its plan's close and its checks. FAIL: a fail_row step failed, or every evaluated check
 * failed. PARTIAL: some checks passed and some didn't (or couldn't be evaluated), or the row couldn't finish but a
 * check passed. SKIP(reason): the row couldn't be set up and no check passed. PASS: the plan completed and every
 * check passed (with no checks: the plan completed).
 */
export function verdictOf(close: Pick<PlanResult, "status" | "outcome" | "reason" | "last_step">, checks: CheckResult[], failRow: Set<string>): { verdict: Verdict; reason?: string } {
  const passed = checks.filter((c) => c.result === "pass").length;
  const failed = checks.filter((c) => c.result === "fail");
  const unevaluated = checks.filter((c) => c.result === "not_evaluated");
  if (close.status !== "done") {
    const decisive = [...failRow].some((label) => close.last_step === label || close.reason?.startsWith(`${label}:`));
    if (close.status === "failed" && decisive) return { verdict: "FAIL", reason: close.reason };
    if (passed) return { verdict: "PARTIAL", reason: `stopped early: ${close.reason}` };
    return { verdict: "SKIP", reason: close.status === "cancelled" ? "interrupted" : close.status === "stopped" ? `stopped: ${close.reason}` : `could not run: ${close.reason}` };
  }
  if (!checks.length) return close.outcome === "completed" ? { verdict: "PASS" } : { verdict: "PARTIAL", reason: "some steps failed and were passed over" };
  if (failed.length && !passed) return { verdict: "FAIL", reason: failed.map((c) => `${c.label}: ${c.detail ?? "failed"}`).join("; ") };
  if (failed.length || unevaluated.length) {
    if (!passed) return { verdict: "SKIP", reason: `no evidence: ${unevaluated.map((c) => c.detail).join("; ")}` };
    return { verdict: "PARTIAL", reason: [...failed, ...unevaluated].map((c) => `${c.label}: ${c.detail ?? c.result}`).join("; ") };
  }
  return close.outcome === "completed" ? { verdict: "PASS" } : { verdict: "PASS", reason: "every check passed; some steps failed and were passed over" };
}

// ---- Running a batch -----------------------------------------------------------------------------------

export type RowRecord = {
  id: string;
  title: string;
  verdict: Verdict;
  reason?: string;
  judged_by?: string;
  evidence: string[];
  checks: CheckResult[];
  prelude?: { status: string; reason?: string };
  close?: { outcome: string; status: string; reason?: string; last_step?: string };
  started_at?: string;
  ms?: number;
  reports: ReportEntry[];
};
export type BatchRunOptions = {
  api: CommandApi;
  host: Host;
  outDir: string;
  fixtures?: Record<string, unknown>;
  clock?: PlanClock;
  signal?: AbortSignal;
  log?: (line: string) => void;
  /** Only these row ids (the rest are SKIP(not selected)). */
  rows?: string[];
  echo?: boolean;
  scriptPath?: string;
  readCetBindings?: () => string | null;
  commitEveryMs?: number;
  preflight?: unknown;
};
export type BatchResult = { ok: boolean; outcome: "complete" | "stopped" | "interrupted"; halt?: string; rows: RowRecord[]; manifestPath: string; reportPath: string };

/** Runs a schema-3 script: setup, every row with its prelude and verdict, then the teardown, writing the report as it goes. */
export async function runBatch(script: BatchScript, options: BatchRunOptions): Promise<BatchResult> {
  const planned = planBatch(script);
  if (planned.problems.length) throw new Error(`script problems:\n  ${planned.problems.join("\n  ")}`);
  const log = options.log ?? ((line: string) => console.log(line));
  const clock = options.clock ?? realClock;
  const fixtures = { ...(script.fixtures ?? {}), ...(options.fixtures ?? {}) };
  mkdirSync(options.outDir, { recursive: true });
  const config = typeof fixtures.staged_mod === "string" ? new ConfigEditor(stagedConfigPath(fixtures.staged_mod), join(options.outDir, "config-backup")) : undefined;
  const readCetBindings = options.readCetBindings ?? (() => {
    const path = typeof fixtures.game_dir === "string" ? join(fixtures.game_dir, "bin", "x64", "plugins", "cyber_engine_tweaks", "bindings.json") : "";
    return path && existsSync(path) ? readFileSync(path, "utf8") : null;
  });
  const executor = new SessionExecutor({ api: options.api, host: options.host, outDir: options.outDir, fixtures, clock, log, echo: options.echo !== false, config, readCetBindings,
    commitFloorGb: typeof fixtures.commit_floor_gb === "number" ? fixtures.commit_floor_gb : 4, commitEveryMs: options.commitEveryMs }, script);
  const bindings = executor.bindings;
  const signal = options.signal ?? new AbortController().signal;
  const startedAt = new Date().toISOString();
  const records: RowRecord[] = [];
  let halt: string | undefined;
  const reportOf = (result: PlanResult) => ({ outcome: result.outcome, status: result.status, reason: result.reason, last_step: result.last_step });
  const plan = (p: Plan, extra: Partial<Parameters<typeof runPlan>[1]> = {}) => runPlan(p, { executor, clock, signal, bindings, ...extra });
  const write = (setup?: PlanResult, teardown?: PlanResult, finished = false) => writeReports(script, options, { startedAt, finished, halt, setup, teardown, rows: records, executor, config, interrupted: signal.aborted });

  log(`${script.title ?? script.name}: ${planned.rows.length} rows`);
  await executor.run({ do: "note", text: `XF session: ${script.title ?? script.name} (${planned.rows.length} rows)` }, { signal, deadline: clock.now() + 10_000, plan: "start", step: "start", attempt: 1, raw: { do: "note" } }).catch(() => undefined);
  const setup = await plan(planned.setup);
  if (setup.status === "stopped") halt = setup.reason;
  const setupFailed = setup.status !== "done" ? `setup didn't finish: ${setup.reason}` : undefined;
  let restartDue = false;
  for (const { row, plan: rowPlan, failRow } of planned.rows) {
    const started = clock.now();
    const record: RowRecord = { id: row.id, title: row.title, verdict: "SKIP", evidence: [], checks: [], reports: [], started_at: new Date().toISOString(), ...(row.judged_by ? { judged_by: row.judged_by } : {}) };
    records.push(record);
    if (options.rows && !options.rows.includes(row.id)) { record.reason = "not selected"; continue; }
    if (signal.aborted) { record.reason = "interrupted"; continue; }
    if (halt) { record.reason = `not reached: ${halt}`; continue; }
    if (setupFailed) { record.reason = setupFailed; continue; }
    const unmet = (row.requires ?? []).flatMap((need) => {
      if (need.fixture && fixtures[need.fixture] === undefined) return [`the fixtures file has no ${need.fixture}`];
      if (need.binding) {
        const text = readCetBindings();
        const [mod, name] = need.binding.split(".");
        const value = text ? parseCetBindings(text)[mod]?.[name] : undefined;
        if (!value) return [`CET has no key bound for ${need.binding}`];
        if (need.equals !== undefined) {
          const want = String(resolveRefs(need.equals, bindings));
          try { if (keysLabel(decodeCetBinding(value)) !== keysLabel(parseKeys(want))) return [`CET's ${need.binding} is ${keysLabel(decodeCetBinding(value))}, not ${want}`]; } catch (error) { return [String(error)]; }
        }
      }
      if (need.config && !config?.exists()) return ["the staged config.ini isn't reachable (fixtures staged_mod)"];
      return [];
    });
    if (unmet.length) { record.reason = `requires: ${unmet.join("; ")}`; continue; }
    log(`--- ${row.id}: ${row.title}`);
    executor.startRow(row.id);
    // The prelude: the row's config, a restart if anything read at load changed, a launch if the game isn't running.
    const current = config?.exists() ? config.read() : {};
    const needs = configNeeds(row, current);
    const prelude = await plan({ id: `${row.id}.prelude`, steps: preludeSteps(needs, restartDue, needsLoad({ ...current, ...needs })) });
    record.prelude = { status: prelude.status, reason: prelude.reason };
    record.reports.push(...prelude.reports);
    restartDue = false;
    if (prelude.status !== "done") {
      halt = prelude.status === "stopped" ? prelude.reason : `the game couldn't be brought to ${row.id}'s set-up: ${prelude.reason}`;
      record.reason = `could not set up: ${prelude.reason}`;
      write(setup);
      continue;
    }
    const before = new Map(Object.entries(bindings));
    const result = await plan(rowPlan);
    record.close = reportOf(result);
    record.reports.push(...result.reports);
    record.checks = (row.pass ?? []).map((check) => evaluateCheck(check, bindings, (name) => !before.has(name) || before.get(name) !== bindings[name]));
    Object.assign(record, verdictOf(result, record.checks, failRow));
    record.evidence = [...executor.evidence];
    record.ms = Math.round(clock.now() - started);
    log(`${record.verdict.padEnd(7)} ${row.id}${record.reason ? `: ${record.reason}` : ""}`);
    if (result.status === "stopped") halt = result.reason;
    restartDue = row.after === "restart";
    write(setup);
  }
  // The teardown: the script's own steps, then the built-in ones; always, each best effort.
  const teardownPlan: Plan = { id: "teardown", steps: [...planned.teardown.steps.map((s) => ({ ...s, on_fail: "continue" as const })), ...builtinTeardown()] };
  // A halt (handed_over, the tripwire) must not stop the teardown itself: each step is tried and its refusal recorded.
  executor.stopReason = undefined;
  const teardownExecutor: Executor = { run: async (action, context) => ({ ...(await executor.run(action, context)), halt: undefined }) };
  const teardown = await runPlan(teardownPlan, { executor: teardownExecutor, clock, bindings });
  await executor.run({ do: "note", text: `XF session ${halt ? "stopped" : "complete"}: ${script.title ?? script.name}` }, { signal: new AbortController().signal, deadline: clock.now() + 10_000, plan: "end", step: "end", attempt: 1, raw: { do: "note" } }).catch(() => undefined);
  const paths = write(setup, teardown, true);
  options.api.close();
  const outcome = signal.aborted ? "interrupted" : halt ? "stopped" : "complete";
  return { ok: !halt && !signal.aborted && records.every((r) => r.verdict === "PASS" || r.reason === "not selected"), outcome, halt, rows: records, ...paths };
}

// ---- Reports ---------------------------------------------------------------------------------------------

type ReportState = { startedAt: string; finished: boolean; halt?: string; setup?: PlanResult; teardown?: PlanResult; rows: RowRecord[]; executor: SessionExecutor; config?: ConfigEditor; interrupted: boolean };

/** The detours a run took (retries, other routes, branches, fallbacks): the session's friction, found automatically. */
export function detoursOf(reports: ReportEntry[]): string[] {
  const out: string[] = [];
  const attempts = new Map<string, number>();
  for (const entry of reports) if (entry.kind === "attempt") attempts.set(`${entry.plan}#${entry.step}`, Math.max(attempts.get(`${entry.plan}#${entry.step}`) ?? 0, entry.attempt));
  for (const entry of reports) {
    if (entry.kind !== "step") continue;
    const name = `${entry.label ?? entry.step}`;
    const tries = attempts.get(`${entry.plan}#${entry.step}`) ?? 1;
    const notes = [
      tries > 1 ? `${tries} attempts` : "",
      typeof entry.route === "number" && entry.route > 1 ? `route ${entry.route}` : "",
      entry.branch && !/^branch \d+$/.test(String(entry.branch)) ? `branch ${entry.branch}` : entry.branch ? String(entry.branch) : "",
      entry.fallback ? "fallback" : "",
      entry.unanticipated ? "UNANTICIPATED outcome" : "",
      entry.guard === "unmet" ? "precondition unmet" : "",
    ].filter(Boolean);
    if (notes.length && (tries > 1 || entry.route !== 1 || entry.fallback || entry.unanticipated || entry.guard === "unmet")) out.push(`${entry.plan} ${name}: ${notes.join(", ")} (${entry.status}${entry.code ? `, ${entry.code}` : ""})`);
  }
  return out;
}

function writeReports(script: BatchScript, options: BatchRunOptions, s: ReportState) {
  const manifestPath = join(options.outDir, "manifest.json");
  const reportPath = join(options.outDir, "report.md");
  const counts = Object.fromEntries((["PASS", "FAIL", "PARTIAL", "SKIP"] as const).map((v) => [v, s.rows.filter((r) => r.verdict === v).length]));
  const all = [...(s.setup?.reports ?? []), ...s.rows.flatMap((r) => r.reports), ...(s.teardown?.reports ?? [])];
  const manifest = {
    schema: REPORT_SCHEMA_3,
    script: { name: script.name, title: script.title, card: script.card, path: options.scriptPath, requires: script.requires ?? [] },
    run: { started_at: s.startedAt, ...(s.finished ? { finished_at: new Date().toISOString() } : { in_progress: true }), outcome: s.interrupted ? "interrupted" : s.halt ? "stopped" : s.finished ? "complete" : "running", ...(s.halt ? { halt: s.halt } : {}), counts },
    ...(options.preflight ? { preflight: options.preflight } : {}),
    setup: s.setup ? { close: { outcome: s.setup.outcome, status: s.setup.status, reason: s.setup.reason }, reports: s.setup.reports } : null,
    rows: s.rows,
    teardown: s.teardown ? { close: { outcome: s.teardown.outcome, status: s.teardown.status }, reports: s.teardown.reports } : null,
    key_refusals: s.executor.refusals,
    detours: detoursOf(all),
    free_commit_gb: s.executor.lastFreeGb,
    notes: [
      "Screenshots are external window captures (what was on screen, after ReShade and overlays), 8-bit; each capture's result in the reports records the window size, crop and scale.",
      "A verdict covers the named state checks and that the evidence was captured; what a capture shows is judged by the row's judged_by where named.",
      "Report entries are keyed by plan, step and attempt; a step revisited by a goto carries ~n.",
    ],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  const lines = [
    `# ${script.title ?? script.name}`,
    "",
    `Run ${s.startedAt}${s.finished ? ` to ${new Date().toISOString()}` : " (in progress)"}: ${manifest.run.outcome}. PASS ${counts.PASS}, FAIL ${counts.FAIL}, PARTIAL ${counts.PARTIAL}, SKIP ${counts.SKIP}.${script.card ? ` Card: ${script.card}.` : ""}`,
    ...(s.halt ? ["", `**Stopped:** ${s.halt}`] : []),
    "",
    "| Row | Title | Verdict | Why | Evidence |",
    "|---|---|---|---|---|",
    ...s.rows.map((r) => `| ${r.id} | ${r.title.replace(/\|/g, "/")} | ${r.verdict === "SKIP" ? `SKIP` : r.verdict} | ${(r.reason ?? "").replace(/\|/g, "/").slice(0, 300)}${r.judged_by && r.verdict !== "SKIP" ? ` (judged by ${r.judged_by})` : ""} | ${r.evidence.filter((e) => /\.full\.png$|sheet|manifest/.test(e)).length} files |`),
    "",
    "## Detours taken (the friction log's automatic part)",
    "",
    ...(manifest.detours.length ? manifest.detours.map((d) => `- ${d}`) : ["- none: every step took its first route"]),
    "",
    "## Key presses refused",
    "",
    ...(s.executor.refusals.length ? s.executor.refusals.map((r) => `- ${r.at}: ${r.keys} (${r.reason})`) : ["- none"]),
    "",
    "## Config",
    "",
    `- ${s.config ? (s.teardown ? "config.ini was restored by the teardown when this run had changed it (see the teardown's config step)" : "config.ini may still hold this run's values: the teardown hasn't run yet") : "no staged config.ini in the fixtures"}`,
    "",
  ];
  writeFileSync(reportPath, lines.join("\n"));
  return { manifestPath, reportPath };
}

// ---- The dry run ------------------------------------------------------------------------------------------

/** The full branch tree: setup, each row's prelude (simulated from the staged config when it is readable), steps, checks, cleanup, and the teardown. */
export function describeBatch(script: BatchScript, staged?: IniValues): string[] {
  const planned = planBatch(script);
  const lines: string[] = [`${script.title ?? script.name}: ${planned.rows.length} rows${script.card ? ` (card: ${script.card})` : ""}`];
  for (const need of script.requires ?? []) lines.push(`  requires: ${need}`);
  if (planned.setup.steps.length) { lines.push("setup:"); lines.push(...describePlan(planned.setup, "  ")); }
  const simulated = staged ? simulateConfig(planned.rows.map((r) => r.row), staged) : undefined;
  let values = { ...(staged ?? {}) };
  planned.rows.forEach(({ row, plan }, i) => {
    lines.push(`row ${row.id}: ${row.title}${row.judged_by ? ` [judged by ${row.judged_by}]` : ""}`);
    for (const need of row.requires ?? []) lines.push(`  requires ${need.config ? `${need.config} = ${need.equals}` : need.binding ? `CET binding ${need.binding}${need.equals ? ` = ${need.equals}` : ""}` : need.fixture ? `fixture ${need.fixture}` : need.note}`);
    if (simulated) {
      const sim = simulated[i];
      Object.assign(values, sim.needs);
      if (Object.keys(sim.needs).length || sim.restart) {
        lines.push(`  prelude (from the staged config): ${Object.entries(sim.needs).map(([k, v]) => `${k} = ${v}`).join(", ") || "restart due"}`);
        lines.push(...describePlan({ id: "p", steps: preludeSteps(sim.needs, sim.restart, needsLoad(values)) }, "    "));
      } else lines.push("  prelude: config already right; launch only if the game isn't running");
    } else lines.push("  prelude: config checked at run time (no staged config given)");
    lines.push(...describePlan(plan, "  "));
    for (const check of row.pass ?? []) lines.push(`  pass: ${check.label}: ${check.ref} ${check.captured ? "captured" : JSON.stringify(check.match)}`);
  });
  lines.push("teardown:");
  lines.push(...describePlan({ id: "teardown", steps: [...planned.teardown.steps, ...builtinTeardown()] }, "  "));
  return lines;
}

export { readIni };

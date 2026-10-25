// The plan: a plain-data decision model for anything that acts in the game and has to cope with what happens.
//
// A plan is a list of steps. Each step may have a precondition (when), an action (the rest of the step's
// fields, opaque here), anticipated outcomes (branches), bounded retries, alternative routes, a fallback and a
// deadline, and it ends ok, failed or skipped. The plan ends with exactly one closing report: completed, partial
// or abandoned, with the reason and the last step reached.
//
// Everything is data (no closures), so a plan serialises to JSON and could later be executed by in-game code at
// frame rate. This module knows nothing about the bridge, tests, verdicts, files or the command line: an
// executor performs actions and reads state, a clock tells the time, and the caller receives the report stream.
// Consumers: the session runner (tools/session.ts, rows with verdicts on top), and later the supervisor's actor
// policies, the Story Engine's scenes (roles, a shared blackboard, the failure ladder) and a realtime controller.
// The executor performs, observes and reports; it never changes anyone's record of what happened.
//
// Step fields (control; every other field is the action, handed to the executor unchanged after $references
// are resolved):
//   label          a name; top-level labels are goto targets and restart points
//   roles          the cast roles this step directs (a joint beat names several); informational and checked
//   when           precondition {check?: action, match, wait_ms?, interval_ms?, otherwise?: skip|fail|fallback}.
//                  Without check, match reads the bindings (the blackboard is $board). Read immediately before
//                  acting; an executor that can check on the executing frame does it inside its own action
//                  (game.wait). otherwise: skip (default) passes the step by, fail goes straight to on_fail (the
//                  step never started, so its fallback doesn't run), fallback runs the step's fallback.
//   until          poll the action every interval_ms until its outcome matches (bounded by deadline_ms)
//   success        what counts as success (default: the outcome is ok)
//   deadline_ms    each attempt's limit (default 60 s); nothing waits forever
//   retry          {times, backoff_ms?, factor?, max_backoff_ms?, on?: match}: rung 1 of the failure ladder
//   alternatives   other routes (step lists), tried in order when the action's route fails: rung 2
//   outcomes       anticipated outcomes: [{name?, match, observe?: action, run?: steps, goto?: label,
//                  result?: ok|fail|stop}], first match wins. With exhaustive (step or plan), an outcome no
//                  branch names is reported as unanticipated and takes the fallback.
//   fallback       steps run when the step still failed
//   on_fail        continue | end (abandon the plan: the ladder's later rungs follow) | stop (end everything)
//   together       sub-steps started at once and joined (a joint beat); they share the step's blackboard
//   sequence       sub-steps run in order as one step (a block: its alternatives, branches and fallback apply)
//   bind           keep the outcome's value under this name ($name.path in later steps)
//   end            ok | fail | stop: a control step that ends the plan here (with reason)
// The plan: {id, cast?, steps, exhaustive?, deadline_ms?, max_steps?, on_abandon?: {ask?, dissolve?}, finally?}.
// on_abandon is the ladder's rungs 3 and 4: ask (report and ask the owner, e.g. to drop a rung; the default
// answer is taken only when the owner doesn't answer by the deadline) and dissolve (steps). finally is rung 5,
// release: it runs once at the end, however the plan ended.

export const PLAN_SCHEMA = "xfb/plan-1";

export type Json = Record<string, unknown>;
/** An action: opaque to the plan, interpreted by the executor. */
export type Action = Json & { do: string };
/** What an action came to. halt asks every plan to stop (the game was handed back, memory ran out). */
export type Outcome = { ok: boolean; code?: string; message?: string; value?: unknown; halt?: string };

/** A predicate over an outcome (or, with ref, over the bindings). Plain data; nothing evaluates code. */
export type Match = {
  ok?: boolean;
  code?: string | string[];
  /** A property path into the outcome's value. */
  path?: string;
  /** A $reference into the bindings instead ($board.v.in_view, $shot.full.path). */
  ref?: string;
  equals?: unknown;
  one_of?: unknown[];
  exists?: boolean;
  min?: number;
  max?: number;
  /** A substring of a string, or an element of an array. */
  contains?: unknown;
  /** Some element of the selected array matches this (its path is relative to the element): one event of a window. */
  some?: Match;
  all?: Match[];
  any?: Match[];
  not?: Match;
};

export type Retry = { times: number; backoff_ms?: number; factor?: number; max_backoff_ms?: number; on?: Match };
export type Guard = { check?: Action; match: Match; wait_ms?: number; interval_ms?: number; otherwise?: "skip" | "fail" | "fallback" };
export type Branch = { name?: string; match: Match; observe?: Action; run?: Step[]; goto?: string; result?: "ok" | "fail" | "stop" };
export type OnFail = "continue" | "end" | "stop";

export type Step = Json & {
  label?: string;
  do?: string;
  roles?: string[];
  when?: Guard;
  until?: Match;
  interval_ms?: number;
  success?: Match;
  deadline_ms?: number;
  retry?: Retry;
  alternatives?: Step[][];
  outcomes?: Branch[];
  exhaustive?: boolean;
  fallback?: Step[];
  on_fail?: OnFail;
  together?: Step[];
  sequence?: Step[];
  bind?: string;
  end?: "ok" | "fail" | "stop";
  reason?: string;
};

export type Ask = { question: string; choices: string[]; default: string; deadline_ms?: number };
export type Plan = {
  schema?: string;
  id: string;
  cast?: string[];
  steps: Step[];
  exhaustive?: boolean;
  deadline_ms?: number;
  max_steps?: number;
  on_abandon?: { ask?: Ask; dissolve?: Step[] };
  finally?: Step[];
};

export const CONTROL_KEYS: ReadonlySet<string> = new Set([
  "label", "roles", "when", "until", "interval_ms", "success", "deadline_ms", "retry", "alternatives", "outcomes",
  "exhaustive", "fallback", "on_fail", "together", "sequence", "bind", "end", "reason",
]);

/** The executor's context for one attempt. raw is the action before $references were resolved. */
export type ExecContext = { signal: AbortSignal; deadline: number; plan: string; step: string; attempt: number; board?: unknown; raw: Action; bind?: string };
export interface Executor {
  run(action: Action, context: ExecContext): Promise<Outcome>;
  /** The blackboard: read once per step and shared by every role in it (as $board). */
  snapshot?(context: { signal: AbortSignal; plan: string; step: string }): Promise<unknown>;
}
export type PlanClock = { now(): number; sleep(ms: number, signal?: AbortSignal): Promise<void> };
export const realClock: PlanClock = {
  now: () => performance.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
      const timer = setTimeout(done, Math.max(0, ms));
      signal?.addEventListener("abort", done, { once: true });
    }),
};

/** One entry of a plan's report stream. key is idempotent: the same report sent twice has the same key. */
export type ReportEntry = {
  key: string;
  plan: string;
  step: string;
  label?: string;
  attempt: number;
  kind: "attempt" | "step" | "escalate" | "close";
  at_ms: number;
  [field: string]: unknown;
};
export type Closing = "completed" | "partial" | "abandoned";
export type PlanStatus = "done" | "failed" | "stopped" | "cancelled";
export type PlanResult = {
  plan: string;
  status: PlanStatus;
  outcome: Closing;
  reason?: string;
  last_step?: string;
  decision?: string;
  bindings: Record<string, unknown>;
  reports: ReportEntry[];
  /** Report callbacks that threw (isolated: the plan, its release and its close went on). */
  report_errors?: string[];
};
export type DecisionRequest = { plan: string; step?: string; reason?: string; question: string; choices: string[] };
export type RunPlanOptions = {
  executor: Executor;
  clock?: PlanClock;
  /** One signal cancels the plan (and every plan sharing it: a save load). */
  signal?: AbortSignal;
  /** Initial bindings (fixtures, earlier results); the plan adds to this object. */
  bindings?: Record<string, unknown>;
  /** Role -> actor: who plays each role in this run (a substitute can take a role). Bound as $cast. */
  cast?: Record<string, unknown>;
  /** Restart (never resume) at this top-level label; at_ms is when that phase began on the clock (the deadline counts from it). */
  start?: { step: string; at_ms?: number };
  report?: (entry: ReportEntry) => void;
  /** The owner's answer to an escalation (rung 3); undefined or no answer by the deadline takes the default. */
  decide?: (request: DecisionRequest, signal: AbortSignal) => Promise<string | undefined>;
  defaultDeadlineMs?: number;
  /** finally's own limit, so release runs even after a cancel (default 30 s). */
  finallyDeadlineMs?: number;
};

export const DEFAULT_DEADLINE_MS = 60_000;
export const MAX_DEADLINE_MS = 3_600_000;

// ---- Matching ----------------------------------------------------------------------------------------

const REF = /^\$([A-Za-z][A-Za-z0-9_]*)((?:\.[A-Za-z0-9_]+)*)$/;
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);

/** A property path ("a.b.0") into plain data; undefined when any part is missing. */
export function selectPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  for (const key of path.split(".")) {
    if (UNSAFE.has(key) || value === null || typeof value !== "object" || !Object.hasOwn(value as object, key)) return undefined;
    value = (value as Json)[key];
  }
  return value;
}

/** Resolves "$name.path" strings anywhere in value; unresolvable ones are listed in missing. */
export function resolveRefs(value: unknown, bindings: Record<string, unknown>, missing: string[] = []): unknown {
  if (typeof value === "string" && value.startsWith("$")) {
    const match = REF.exec(value);
    if (!match) return value;
    const found = Object.hasOwn(bindings, match[1]) ? selectPath(bindings[match[1]], match[2].slice(1)) : undefined;
    if (found === undefined) missing.push(value);
    return found === undefined ? value : structuredClone(found);
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, bindings, missing));
  // A key may be a reference too (a role map keyed by the actor bound at run time): it resolves to a string.
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [REF.test(k) ? String(resolveRefs(k, bindings, missing)) : k, resolveRefs(v, bindings, missing)]));
  return value;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Whether an outcome matches. Values in the match may be $references into the bindings. */
export function matches(match: Match, outcome: Outcome, bindings: Record<string, unknown> = {}): boolean {
  if (match.all && !match.all.every((m) => matches(m, outcome, bindings))) return false;
  if (match.any && !match.any.some((m) => matches(m, outcome, bindings))) return false;
  if (match.not && matches(match.not, outcome, bindings)) return false;
  if (match.ok !== undefined && outcome.ok !== match.ok) return false;
  if (match.code !== undefined && !(Array.isArray(match.code) ? match.code : [match.code]).includes(outcome.code ?? "")) return false;
  const tests = ["equals", "one_of", "exists", "min", "max", "contains", "some"].some((key) => (match as Json)[key] !== undefined);
  if (!tests) return true;
  const subject = match.ref !== undefined ? resolveRefs(match.ref, bindings) : selectPath(outcome.value, match.path);
  const value = match.ref !== undefined && subject === match.ref ? undefined : subject;
  const expect = (x: unknown) => resolveRefs(x, bindings);
  if (match.exists !== undefined && (value !== undefined && value !== null) !== match.exists) return false;
  if (match.equals !== undefined && !same(value, expect(match.equals))) return false;
  if (match.one_of !== undefined && !(expect(match.one_of) as unknown[]).some((v) => same(v, value))) return false;
  if (match.min !== undefined && !(typeof value === "number" && value >= (expect(match.min) as number))) return false;
  if (match.max !== undefined && !(typeof value === "number" && value <= (expect(match.max) as number))) return false;
  if (match.some !== undefined && !(Array.isArray(value) && value.some((element) => matches(match.some!, { ok: true, value: element }, bindings)))) return false;
  if (match.contains !== undefined) {
    const needle = expect(match.contains);
    if (typeof value === "string") { if (!value.includes(String(needle))) return false; }
    else if (Array.isArray(value)) { if (!value.some((v) => same(v, needle))) return false; }
    else return false;
  }
  return true;
}

// ---- Checking -------------------------------------------------------------------------------------------

const MATCH_KEYS = new Set(["ok", "code", "path", "ref", "equals", "one_of", "exists", "min", "max", "contains", "some", "all", "any", "not"]);
const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const inRange = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

export function checkMatch(match: unknown, where: string, problems: string[]) {
  if (!isObject(match)) { problems.push(`${where}: a match must be an object`); return; }
  for (const key of Object.keys(match)) if (!MATCH_KEYS.has(key)) problems.push(`${where}: unknown match field ${key}`);
  for (const key of ["all", "any"] as const) {
    if (match[key] === undefined) continue;
    if (!Array.isArray(match[key])) problems.push(`${where}.${key} must be a list`);
    else (match[key] as unknown[]).forEach((m, i) => checkMatch(m, `${where}.${key}[${i}]`, problems));
  }
  if (match.not !== undefined) checkMatch(match.not, `${where}.not`, problems);
  if (match.some !== undefined) checkMatch(match.some, `${where}.some`, problems);
  if (match.one_of !== undefined && !Array.isArray(match.one_of) && !(typeof match.one_of === "string" && match.one_of.startsWith("$"))) problems.push(`${where}.one_of must be a list`);
  if (match.ref !== undefined && (typeof match.ref !== "string" || !REF.test(match.ref))) problems.push(`${where}.ref must be a $reference`);
  if (match.path !== undefined && (typeof match.path !== "string" || !/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/.test(match.path))) problems.push(`${where}.path must be a plain property path`);
}

export type ActionChecker = (action: Action, where: string) => string[];

/** Every problem with a plan, in plain words; checkAction validates each action (the consumer's own catalogue). */
export function checkPlan(plan: Plan, checkAction: ActionChecker = () => []): string[] {
  const problems: string[] = [];
  if (!isObject(plan)) return ["a plan must be an object"];
  if (typeof plan.id !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(plan.id)) problems.push("plan id must be 1-80 letters, digits, '.', '_' or '-'");
  if (!Array.isArray(plan.steps)) return [...problems, "plan steps must be a list"];
  const cast = new Set(plan.cast ?? []);
  const labels = new Map<string, number>();
  plan.steps.forEach((step) => { if (isObject(step) && typeof step.label === "string") labels.set(step.label, (labels.get(step.label) ?? 0) + 1); });
  for (const [label, count] of labels) if (count > 1) problems.push(`label "${label}" is used more than once`);
  const gotos: [string, string][] = [];
  const walk = (steps: unknown, where: string, depth: number) => {
    if (!Array.isArray(steps)) { problems.push(`${where}: must be a list of steps`); return; }
    if (depth > 6) { problems.push(`${where}: nested more than six levels`); return; }
    steps.forEach((step, i) => {
      const at = `${where}[${i + 1}]${isObject(step) && step.label ? ` (${step.label})` : ""}`;
      if (!isObject(step)) { problems.push(`${at}: a step must be an object`); return; }
      const kinds = ["do", "end", "together", "sequence"].filter((k) => step[k] !== undefined);
      if (kinds.length !== 1) problems.push(`${at}: a step has exactly one of do, end, together or sequence`);
      if (step.retry !== undefined && (step.together !== undefined || step.sequence !== undefined)) problems.push(`${at}: a block doesn't retry (give its steps their own retry, or an alternative)`);
      if (step.end !== undefined && !["ok", "fail", "stop"].includes(step.end as string)) problems.push(`${at}: end is ok, fail or stop`);
      if (step.do !== undefined && typeof step.do !== "string") problems.push(`${at}: do must be a string`);
      if (step.deadline_ms !== undefined && !inRange(step.deadline_ms, 1, MAX_DEADLINE_MS)) problems.push(`${at}: deadline_ms must be 1 to ${MAX_DEADLINE_MS}`);
      if (step.interval_ms !== undefined && !inRange(step.interval_ms, 10, 600_000)) problems.push(`${at}: interval_ms must be 10 to 600000`);
      if (step.on_fail !== undefined && !["continue", "end", "stop"].includes(step.on_fail as string)) problems.push(`${at}: on_fail is continue, end or stop`);
      if (step.bind !== undefined && (typeof step.bind !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(step.bind) || ["board", "cast"].includes(step.bind))) problems.push(`${at}: bind must be a plain name (not board or cast)`);
      for (const role of (step.roles as unknown[]) ?? []) if (!cast.has(role as string)) problems.push(`${at}: role ${String(role)} is not in the plan's cast`);
      if (step.retry !== undefined) {
        const retry = step.retry as Json;
        if (!isObject(retry) || !inRange(retry.times, 0, 20)) problems.push(`${at}: retry.times must be 0 to 20`);
        else {
          if (retry.backoff_ms !== undefined && !inRange(retry.backoff_ms, 0, 600_000)) problems.push(`${at}: retry.backoff_ms must be 0 to 600000`);
          if (retry.factor !== undefined && !inRange(retry.factor, 1, 4)) problems.push(`${at}: retry.factor must be 1 to 4`);
          if (retry.on !== undefined) checkMatch(retry.on, `${at}.retry.on`, problems);
        }
      }
      if (step.when !== undefined) {
        const guard = step.when as Json;
        if (!isObject(guard)) problems.push(`${at}: when must be an object`);
        else {
          checkMatch(guard.match, `${at}.when.match`, problems);
          if (guard.check !== undefined) { if (!isObject(guard.check) || typeof guard.check.do !== "string") problems.push(`${at}: when.check must be an action`); else problems.push(...checkAction(guard.check as Action, `${at}.when.check`)); }
          if (guard.wait_ms !== undefined && !inRange(guard.wait_ms, 0, MAX_DEADLINE_MS)) problems.push(`${at}: when.wait_ms out of range`);
          if (guard.otherwise !== undefined && !["skip", "fail", "fallback"].includes(guard.otherwise as string)) problems.push(`${at}: when.otherwise is skip, fail or fallback`);
        }
      }
      if (step.until !== undefined) checkMatch(step.until, `${at}.until`, problems);
      if (step.success !== undefined) checkMatch(step.success, `${at}.success`, problems);
      if (step.alternatives !== undefined) {
        if (!Array.isArray(step.alternatives)) problems.push(`${at}: alternatives must be a list of step lists`);
        else (step.alternatives as unknown[]).forEach((route, r) => walk(route, `${at}.alternatives[${r + 1}]`, depth + 1));
      }
      if (step.outcomes !== undefined) {
        if (!Array.isArray(step.outcomes)) problems.push(`${at}: outcomes must be a list`);
        else (step.outcomes as unknown[]).forEach((branch, b) => {
          const bw = `${at}.outcomes[${b + 1}]`;
          if (!isObject(branch)) { problems.push(`${bw}: must be an object`); return; }
          checkMatch(branch.match, `${bw}.match`, problems);
          if (branch.observe !== undefined) { if (!isObject(branch.observe) || typeof branch.observe.do !== "string") problems.push(`${bw}: observe must be an action`); else problems.push(...checkAction(branch.observe as Action, `${bw}.observe`)); }
          if (branch.run !== undefined) walk(branch.run, `${bw}.run`, depth + 1);
          if (branch.goto !== undefined) gotos.push([bw, String(branch.goto)]);
          if (branch.result !== undefined && !["ok", "fail", "stop"].includes(branch.result as string)) problems.push(`${bw}: result is ok, fail or stop`);
          if (branch.run === undefined && branch.goto === undefined && branch.result === undefined && branch.name === undefined) problems.push(`${bw}: a branch names, runs, goes to or decides something`);
        });
      }
      if (step.fallback !== undefined) walk(step.fallback, `${at}.fallback`, depth + 1);
      if (step.together !== undefined) walk(step.together, `${at}.together`, depth + 1);
      if (step.sequence !== undefined) walk(step.sequence, `${at}.sequence`, depth + 1);
      if (typeof step.do === "string") {
        const action = actionOf(step as Step);
        problems.push(...checkAction(action, at));
        const missing: string[] = [];
        for (const ref of refsIn(action)) if (ref.startsWith("$cast.") && !cast.has(ref.split(".")[1])) missing.push(ref);
        if (missing.length) problems.push(`${at}: ${missing.join(", ")} name no role in the plan's cast`);
      }
    });
  };
  walk(plan.steps, "steps", 0);
  if (plan.on_abandon?.dissolve) walk(plan.on_abandon.dissolve, "on_abandon.dissolve", 0);
  if (plan.on_abandon?.ask) {
    const ask = plan.on_abandon.ask;
    if (!Array.isArray(ask.choices) || !ask.choices.includes(ask.default)) problems.push("on_abandon.ask: the default must be one of its choices");
  }
  if (plan.finally) walk(plan.finally, "finally", 0);
  for (const [where, label] of gotos) if (!labels.has(label)) problems.push(`${where}: goto "${label}" names no top-level step`);
  if (plan.deadline_ms !== undefined && !inRange(plan.deadline_ms, 1, 24 * MAX_DEADLINE_MS)) problems.push("plan deadline_ms out of range");
  return problems;
}

/** The action of a step: every field that isn't a control field. */
export function actionOf(step: Step): Action {
  return Object.fromEntries(Object.entries(step).filter(([key]) => !CONTROL_KEYS.has(key))) as Action;
}

function refsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string" && REF.test(value)) out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => refsIn(v, out));
  else if (isObject(value)) Object.values(value).forEach((v) => refsIn(v, out));
  return out;
}

// ---- Describing (the dry run's branch tree) ---------------------------------------------------------------

const brief = (value: unknown) => {
  const text = JSON.stringify(value);
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
};
const describeMatch = (m: Match): string => brief(m);

/** The plan as an indented tree, one line per node: what runs, and every branch it may take. */
export function describePlan(plan: Plan, indent = ""): string[] {
  const lines: string[] = [];
  const steps = (list: Step[] | undefined, pad: string) => list?.forEach((step, i) => node(step, `${i + 1}`, pad));
  const node = (step: Step, n: string, pad: string) => {
    const head = step.end ? `end ${step.end}${step.reason ? `: ${step.reason}` : ""}` : step.together ? "together" : step.sequence ? "in order" : `${step.do} ${brief(Object.fromEntries(Object.entries(actionOf(step)).filter(([k]) => k !== "do")))}`;
    lines.push(`${pad}${n}${step.label ? ` [${step.label}]` : ""}${step.roles?.length ? ` <${step.roles.join(", ")}>` : ""} ${head}`);
    const sub = `${pad}    `;
    if (step.when) lines.push(`${sub}when ${step.when.check ? `${step.when.check.do} ` : ""}${describeMatch(step.when.match)}${step.when.wait_ms ? ` (waits up to ${step.when.wait_ms} ms)` : ""}, otherwise ${step.when.otherwise ?? "skip"}`);
    if (step.until) lines.push(`${sub}until ${describeMatch(step.until)} every ${step.interval_ms ?? 1000} ms`);
    if (step.deadline_ms) lines.push(`${sub}deadline ${step.deadline_ms} ms`);
    if (step.retry) lines.push(`${sub}retry ${step.retry.times}x, ${step.retry.backoff_ms ?? 500} ms x${step.retry.factor ?? 2}${step.retry.on ? ` on ${describeMatch(step.retry.on)}` : ""}`);
    step.together?.forEach((child, i) => node(child, `${n}.${i + 1}`, sub));
    step.sequence?.forEach((child, i) => node(child, `${n}.${i + 1}`, sub));
    step.alternatives?.forEach((route, r) => {
      lines.push(`${sub}else route ${r + 2}:`);
      route.forEach((child, i) => node(child, `${n}.r${r + 2}.${i + 1}`, `${sub}    `));
    });
    step.outcomes?.forEach((branch) => {
      const what = [branch.goto ? `goto ${branch.goto}` : "", branch.result ? `result ${branch.result}` : ""].filter(Boolean).join(", ");
      lines.push(`${sub}if${branch.name ? ` (${branch.name})` : ""} ${branch.observe ? `${branch.observe.do} ` : ""}${describeMatch(branch.match)}${what ? ` -> ${what}` : ""}`);
      branch.run?.forEach((child, i) => node(child, `${n}.b.${i + 1}`, `${sub}    `));
    });
    if (step.exhaustive) lines.push(`${sub}otherwise: unanticipated -> fallback`);
    if (step.fallback) {
      lines.push(`${sub}fallback:`);
      step.fallback.forEach((child, i) => node(child, `${n}.f.${i + 1}`, `${sub}    `));
    }
    if (step.on_fail && step.on_fail !== "end") lines.push(`${sub}on fail: ${step.on_fail}`);
  };
  steps(plan.steps, indent);
  if (plan.on_abandon) {
    if (plan.on_abandon.ask) lines.push(`${indent}on abandon: ask "${plan.on_abandon.ask.question}" [${plan.on_abandon.ask.choices.join(" | ")}], default ${plan.on_abandon.ask.default}`);
    if (plan.on_abandon.dissolve) { lines.push(`${indent}on abandon, dissolve:`); steps(plan.on_abandon.dissolve, `${indent}    `); }
  }
  if (plan.finally) { lines.push(`${indent}finally (release):`); steps(plan.finally, `${indent}    `); }
  return lines;
}

// ---- Running --------------------------------------------------------------------------------------------

type ListResult = { status: "ok" | "failed" | "stopped" | "ended"; jump?: string; outcome?: Outcome; reason?: string; end?: "ok" | "fail" | "stop" };
type Run = {
  plan: Plan;
  options: RunPlanOptions;
  clock: PlanClock;
  signal: AbortSignal;
  bindings: Record<string, unknown>;
  reports: ReportEntry[];
  keys: Set<string>;
  visits: Map<string, number>;
  steps: number;
  deadline: number;
  lastStep?: string;
  continued: number;
  halt?: string;
  reportErrors: string[];
};

/**
 * An attempt's own signal: aborted by the caller's signal or at the deadline. expired settles at whichever comes
 * first; done() cancels the deadline's sleep once the attempt settled (so a fake clock's time never jumps).
 */
const linked = (signal: AbortSignal | undefined, deadlineMs: number, clock: PlanClock) => {
  const controller = new AbortController();
  const timer = new AbortController();
  let settle!: () => void;
  const expired = new Promise<void>((resolve) => (settle = resolve));
  const stop = () => { controller.abort(); settle(); };
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  void clock.sleep(Math.max(0, deadlineMs), timer.signal).then(() => { if (!timer.signal.aborted) stop(); });
  return { signal: controller.signal, expired, done: () => { timer.abort(); signal?.removeEventListener("abort", stop); } };
};

function emit(run: Run, entry: Omit<ReportEntry, "key" | "plan" | "at_ms"> & { key?: string }) {
  const key = entry.key ?? `${run.plan.id}#${entry.step}@${entry.attempt}:${entry.kind}`;
  if (run.keys.has(key)) return;
  run.keys.add(key);
  const full = { ...entry, key, plan: run.plan.id, at_ms: Math.round(run.clock.now()) } as ReportEntry;
  run.reports.push(full);
  // A consumer's report callback that throws must never stop the plan, its release or its close.
  try {
    run.options.report?.(full);
  } catch (error) {
    run.reportErrors.push(`${key}: ${String((error as Error)?.message ?? error)}`);
  }
}

/** One call to the executor, bounded by its deadline, the enclosing blocks' (limit, absolute) and the plan's. */
async function perform(run: Run, raw: Action, path: string, attempt: number, deadlineMs: number, board: unknown, bind?: string, limit = Infinity): Promise<Outcome> {
  if (run.halt) return { ok: false, code: "halted", message: run.halt, halt: run.halt };
  if (run.signal.aborted) return { ok: false, code: "cancelled", message: "The plan was cancelled." };
  const remaining = Math.min(deadlineMs, run.deadline - run.clock.now(), limit - run.clock.now());
  if (remaining <= 0) return { ok: false, code: "deadline", message: "The plan's deadline passed." };
  const missing: string[] = [];
  const action = resolveRefs(raw, run.bindings, missing) as Action;
  if (missing.length) return { ok: false, code: "unbound", message: `Not bound yet: ${missing.join(", ")}` };
  const bound = linked(run.signal, remaining, run.clock);
  try {
    const outcome = await Promise.race([
      run.options.executor.run(action, { signal: bound.signal, deadline: run.clock.now() + remaining, plan: run.plan.id, step: path, attempt, board, raw, bind }).catch((error) => ({ ok: false, code: "executor_error", message: String((error as Error)?.message ?? error) }) as Outcome),
      bound.expired.then(() => new Promise<Outcome>((resolve) => setTimeout(() => resolve(run.signal.aborted ? { ok: false, code: "cancelled", message: "The plan was cancelled." } : { ok: false, code: "deadline", message: `No outcome within ${Math.round(remaining)} ms.` }), 0))),
    ]);
    if (outcome.halt && !run.halt) run.halt = outcome.halt;
    return outcome;
  } finally {
    bound.done();
  }
}

const succeeded = (step: Step, outcome: Outcome, bindings: Record<string, unknown>) => (step.success ? matches(step.success, outcome, bindings) : outcome.ok);

/** The step's own route: until-polling, then bounded retries with backoff. */
async function primary(run: Run, step: Step, path: string, board: unknown, limit = Infinity): Promise<Outcome> {
  const raw = actionOf(step);
  const deadlineMs = step.deadline_ms ?? run.options.defaultDeadlineMs ?? DEFAULT_DEADLINE_MS;
  const retry = step.retry;
  let outcome: Outcome = { ok: false, code: "not_run" };
  const left = () => Math.min(limit, run.deadline) - run.clock.now();
  for (let attempt = 1; attempt <= 1 + (retry?.times ?? 0); attempt++) {
    const started = run.clock.now();
    if (step.until) {
      const stopAt = Math.min(started + deadlineMs, limit, run.deadline);
      for (;;) {
        outcome = await perform(run, raw, path, attempt, Math.max(1, stopAt - run.clock.now()), board, step.bind, limit);
        if (matches(step.until, outcome, run.bindings)) { outcome = { ...outcome, ok: true }; break; }
        if (outcome.halt || run.signal.aborted || ["cancelled", "halted"].includes(outcome.code ?? "")) break;
        if (run.clock.now() + (step.interval_ms ?? 1000) >= stopAt) { outcome = { ok: false, code: "deadline", message: `Not reached within ${deadlineMs} ms.`, value: outcome.value }; break; }
        await run.clock.sleep(Math.min(step.interval_ms ?? 1000, Math.max(0, stopAt - run.clock.now())), run.signal);
      }
    } else {
      outcome = await perform(run, raw, path, attempt, deadlineMs, board, step.bind, limit);
    }
    emit(run, { kind: "attempt", step: path, label: step.label, attempt, route: 1, action: raw.do, ok: outcome.ok, code: outcome.code, message: outcome.message, value: outcome.value, ms: Math.round(run.clock.now() - started) });
    if (succeeded(step, outcome, run.bindings) || outcome.halt || run.signal.aborted) break;
    if (retry?.on && !matches(retry.on, outcome, run.bindings)) break;
    if (attempt <= (retry?.times ?? 0)) {
      const wait = Math.min(retry!.max_backoff_ms ?? 10_000, (retry!.backoff_ms ?? 500) * (retry!.factor ?? 2) ** (attempt - 1));
      // No backoff past the time that is left: the next attempt would only meet the deadline.
      if (wait >= left()) { outcome = { ...outcome, ok: false, code: outcome.code ?? "deadline" }; break; }
      await run.clock.sleep(wait, run.signal);
    }
  }
  return outcome;
}

async function guardHolds(run: Run, step: Step, path: string, board: unknown, limit = Infinity): Promise<boolean> {
  const guard = step.when!;
  const stopAt = Math.min(run.clock.now() + (guard.wait_ms ?? 0), limit, run.deadline);
  for (let attempt = 1; ; attempt++) {
    const outcome = guard.check ? await perform(run, guard.check, `${path}/when`, attempt, Math.max(1, (guard.wait_ms ?? 0) || DEFAULT_DEADLINE_MS), board, undefined, limit) : { ok: true, value: run.bindings };
    const met = matches(guard.match, outcome, run.bindings);
    if (met || run.clock.now() >= stopAt || run.halt || run.signal.aborted) return met;
    await run.clock.sleep(Math.min(guard.interval_ms ?? 500, Math.max(1, stopAt - run.clock.now())), run.signal);
  }
}

/** Runs one step (at any depth). */
async function runStep(run: Run, step: Step, path: string, inherited?: unknown, limit = Infinity): Promise<ListResult> {
  run.steps++;
  if (run.steps > (run.plan.max_steps ?? 1000)) return { status: "ended", end: "fail", reason: `More than ${run.plan.max_steps ?? 1000} steps ran (a goto loop?).` };
  const visit = (run.visits.get(path) ?? 0) + 1;
  run.visits.set(path, visit);
  const vpath = visit > 1 ? `${path}~${visit}` : path;
  run.lastStep = step.label ?? vpath;
  const record = (status: string, extra: Json = {}) => emit(run, { kind: "step", step: vpath, label: step.label, attempt: visit, status, ...extra });
  if (step.end) {
    record(step.end === "ok" ? "ok" : "failed", { end: step.end, reason: step.reason });
    return { status: "ended", end: step.end, reason: step.reason };
  }
  // The blackboard: one read per step, shared by all its roles (a together step's children inherit it).
  let board = inherited;
  if (board === undefined && run.options.executor.snapshot && !run.signal.aborted) {
    // Bounded like any action: a read that hangs can't hold the plan past its deadline or a cancel.
    const limit = linked(run.signal, Math.max(0, Math.min(run.options.defaultDeadlineMs ?? DEFAULT_DEADLINE_MS, run.deadline - run.clock.now())), run.clock);
    try {
      board = await Promise.race([
        run.options.executor.snapshot({ signal: limit.signal, plan: run.plan.id, step: vpath }),
        limit.expired.then(() => ({ unavailable: run.signal.aborted ? "cancelled" : "the blackboard read ran out of time" })),
      ]);
    } catch (error) {
      board = { unavailable: String(error) };
    } finally {
      limit.done();
    }
    if (run.signal.aborted) { record("failed", { code: "cancelled" }); return { status: "failed", reason: "cancelled" }; }
  }
  if (board !== undefined) run.bindings.board = board;
  // A block's deadline_ms is an absolute limit for everything inside it (each action's own is per attempt).
  const until = (step.together || step.sequence) && step.deadline_ms !== undefined ? Math.min(limit, run.clock.now() + step.deadline_ms) : limit;
  if (step.when && !(await guardHolds(run, step, vpath, board, limit))) {
    if ((step.when.otherwise ?? "skip") === "skip") { record("skipped", { guard: "unmet" }); return { status: "ok" }; }
    const unmet: Outcome = { ok: false, code: "precondition", message: "The precondition was not met." };
    // fallback: the step's fallback (and branches) act on it; fail: straight to on_fail, since the step never started.
    if (step.when.otherwise === "fallback") return finish(run, step, vpath, visit, unmet, board, record, { guard: "unmet" }, limit);
    return finish(run, { ...step, fallback: undefined, outcomes: undefined }, vpath, visit, unmet, board, record, { guard: "unmet" }, limit);
  }
  let outcome: Outcome = { ok: false, code: "not_run" };
  let route = 1;
  if (step.together) {
    const children = await Promise.all(step.together.map((child, i) => runStep(run, child, `${vpath}/t${i + 1}`, board ?? null, until)));
    // A child's stop, end or goto goes up as it is: the parent's on_fail never swallows it.
    const control = children.find((c) => c.status === "stopped") ?? children.find((c) => c.status === "ended") ?? children.find((c) => c.jump);
    if (control) {
      record(control.status === "ok" ? "ok" : "failed", { route, control: control.status === "ok" ? `goto ${control.jump}` : control.status });
      return control;
    }
    const failedChild = children.find((c) => c.status !== "ok");
    outcome = failedChild ? { ok: false, code: "joint_failed", message: failedChild.reason ?? failedChild.outcome?.message } : { ok: true, value: children.map((c) => c.outcome?.value) };
  } else if (step.sequence) {
    const result = await runList(run, step.sequence, `${vpath}/s`, board, until);
    if (result.jump || result.status === "stopped" || result.status === "ended") return result;
    outcome = result.status === "ok" ? { ...(result.outcome ?? { ok: true }), ok: true } : { ...(result.outcome ?? { ok: false }), ok: false, code: result.outcome?.code ?? "block_failed", message: result.reason };
  }
  if (!step.together && !step.sequence) outcome = await primary(run, step, vpath, board, limit);
  // Rung 2, for every kind of step (an action, a block, a joint beat): alternative routes, in order, while the route before failed.
  for (let r = 0; !succeeded(step, outcome, run.bindings) && !outcome.halt && !run.signal.aborted && r < (step.alternatives?.length ?? 0); r++) {
    route = r + 2;
    const result = await runList(run, step.alternatives![r], `${vpath}/r${route}`, board, until);
    if (result.jump || result.status === "stopped" || result.status === "ended") return result;
    outcome = result.status === "ok" ? { ...(result.outcome ?? { ok: true }), ok: true } : (result.outcome ?? { ok: false, code: "route_failed" });
  }
  if (until < limit && run.clock.now() >= until && !succeeded(step, outcome, run.bindings)) outcome = { ...outcome, ok: false, code: "deadline", message: `The block's ${step.deadline_ms} ms ran out.` };
  return finish(run, step, vpath, visit, outcome, board, record, { route }, limit);
}

/** Branches, the fallback and on_fail, after the step's routes. */
async function finish(run: Run, step: Step, path: string, visit: number, outcome: Outcome, board: unknown, record: (status: string, extra?: Json) => void, extra: Json, limit = Infinity): Promise<ListResult> {
  if (step.bind && outcome.value !== undefined) run.bindings[step.bind] = structuredClone(outcome.value);
  let ok = succeeded(step, outcome, run.bindings);
  let jump: string | undefined;
  let branchName: string | undefined;
  let anticipated = !step.outcomes?.length;
  if (outcome.halt) { record("failed", { ...extra, code: outcome.code, halt: outcome.halt }); return { status: "stopped", outcome, reason: outcome.halt }; }
  // A cancel ends the plan here: no branch or fallback acts on a world that is going away.
  if (run.signal.aborted) { record("failed", { ...extra, code: "cancelled" }); return { status: "failed", outcome, reason: "cancelled" }; }
  for (const [b, branch] of (step.outcomes ?? []).entries()) {
    const subject = branch.observe ? await perform(run, branch.observe, `${path}/b${b + 1}/observe`, 1, DEFAULT_DEADLINE_MS, board, undefined, limit) : outcome;
    if (!matches(branch.match, subject, run.bindings)) continue;
    anticipated = true;
    branchName = branch.name ?? `branch ${b + 1}`;
    if (branch.run) {
      const result = await runList(run, branch.run, `${path}/b${b + 1}`, board, limit);
      if (result.jump || result.status === "stopped" || result.status === "ended") { record(result.status === "ok" ? "ok" : "failed", { ...extra, branch: branchName }); return result; }
      ok = result.status === "ok";
      if (result.outcome) outcome = result.outcome;
    }
    if (branch.goto) { jump = branch.goto; ok = true; }
    if (branch.result === "ok") ok = true;
    if (branch.result === "fail") ok = false;
    if (branch.result === "stop") { record("failed", { ...extra, branch: branchName, stop: true }); return { status: "stopped", outcome, reason: `${step.label ?? path}: ${branchName} stops the plan` }; }
    break;
  }
  const unanticipated = !anticipated && (step.exhaustive ?? run.plan.exhaustive ?? false);
  if (unanticipated) ok = false;
  let fellBack = false;
  if (!ok && step.fallback) {
    fellBack = true;
    const result = await runList(run, step.fallback, `${path}/f`, board, limit);
    if (result.jump || result.status === "stopped" || result.status === "ended") { record(result.status === "ok" ? "ok" : "failed", { ...extra, ...(branchName ? { branch: branchName } : {}), fallback: true, unanticipated }); return result; }
    ok = result.status === "ok";
    if (result.outcome) outcome = result.outcome;
  }
  record(ok ? "ok" : "failed", { ...extra, code: outcome.code, message: outcome.message, ...(branchName ? { branch: branchName } : {}), ...(unanticipated ? { unanticipated: true } : {}), ...(fellBack ? { fallback: true } : {}) });
  if (ok) return { status: "ok", outcome, jump };
  const onFail = step.on_fail ?? "end";
  if (onFail === "continue") { run.continued++; return { status: "ok", outcome: { ...outcome, ok: false } }; }
  return { status: onFail === "stop" ? "stopped" : "failed", outcome, reason: `${step.label ?? path}: ${outcome.code ?? "failed"}${outcome.message ? ` (${outcome.message})` : ""}${unanticipated ? " (unanticipated outcome)" : ""}` };
}

/** A nested list of steps (a route, a branch, a fallback). A jump goes up to the plan's top level. */
async function runList(run: Run, steps: Step[], path: string, board: unknown, limit = Infinity): Promise<ListResult> {
  let last: Outcome | undefined;
  for (const [i, step] of steps.entries()) {
    const result = await runStep(run, step, `${path}/${i + 1}`, board, limit);
    if (result.status !== "ok" || result.jump) return result;
    last = result.outcome;
  }
  return { status: "ok", outcome: last };
}

/**
 * Runs a plan to its one closing report. Cancelling the signal ends it (abandoned, reason cancelled) and finally
 * still runs, under its own deadline. A start label restarts the plan at that step: nothing of an earlier run
 * is carried over.
 */
export async function runPlan(plan: Plan, options: RunPlanOptions): Promise<PlanResult> {
  const clock = options.clock ?? realClock;
  const signal = options.signal ?? new AbortController().signal;
  const bindings = options.bindings ?? Object.create(null);
  if (options.cast) bindings.cast = structuredClone(options.cast);
  const startedAt = options.start?.at_ms ?? clock.now();
  const run: Run = { plan, options, clock, signal, bindings, reports: [], keys: new Set(), visits: new Map(), steps: 0, continued: 0, reportErrors: [],
    deadline: plan.deadline_ms ? startedAt + plan.deadline_ms : Infinity };
  let index = 0;
  if (options.start) {
    index = plan.steps.findIndex((s) => s.label === options.start!.step);
    if (index < 0) throw new Error(`No top-level step labelled "${options.start.step}"`);
  }
  let status: PlanStatus = "done";
  let reason: string | undefined;
  let decision: string | undefined;
  let lastStep: string | undefined;
  // Whatever happens in the steps (an exception included), the release runs and the one close is reported.
  try {
  while (index < plan.steps.length) {
    if (signal.aborted) { status = "cancelled"; reason = "cancelled"; break; }
    if (clock.now() >= run.deadline) { status = "failed"; reason = "The plan's deadline passed."; break; }
    const result = await runStep(run, plan.steps[index], plan.steps[index].label ?? String(index + 1));
    if (result.jump) { index = plan.steps.findIndex((s) => s.label === result.jump); continue; }
    if (result.status === "ended") { status = result.end === "ok" ? "done" : result.end === "stop" ? "stopped" : "failed"; reason = result.reason; break; }
    if (result.status === "stopped") { status = "stopped"; reason = result.reason; break; }
    if (result.status === "failed") { status = signal.aborted ? "cancelled" : "failed"; reason = signal.aborted ? "cancelled" : result.reason; break; }
    index++;
  }
  if (run.halt) { status = "stopped"; reason = run.halt; }
  lastStep = run.lastStep;
  // Rungs 3 and 4: report and ask (the default only when nobody answers in time), then dissolve.
  if (status !== "done" && plan.on_abandon && !run.halt) {
    const ask = plan.on_abandon.ask;
    if (ask) {
      let answer: string | undefined;
      if (options.decide && !signal.aborted) {
        const limit = linked(undefined, ask.deadline_ms ?? 5000, clock);
        try {
          answer = await Promise.race([options.decide({ plan: plan.id, step: lastStep, reason, question: ask.question, choices: ask.choices }, limit.signal), limit.expired.then(() => undefined)]);
        } catch { answer = undefined; } finally { limit.done(); }
      }
      decision = answer !== undefined && ask.choices.includes(answer) ? answer : ask.default;
      emit(run, { kind: "escalate", step: lastStep ?? "-", attempt: 1, question: ask.question, decision, forced: answer === undefined || !ask.choices.includes(answer), reason });
    }
    if (plan.on_abandon.dissolve && (decision === undefined || decision === "dissolve") && !signal.aborted) await runList(run, plan.on_abandon.dissolve, "dissolve", undefined);
  }
  } catch (error) {
    status = "failed";
    reason = `the plan failed: ${String((error as Error)?.message ?? error)}`;
    lastStep ??= run.lastStep;
  } finally {
    // Rung 5, release: always, bounded by its own deadline even after a cancel or an exception.
    if (plan.finally?.length) {
      const own = new AbortController();
      // Its own step budget: a plan that ran out of steps (a goto loop) must still release.
      const releaseRun: Run = { ...run, steps: 0, signal: own.signal, halt: undefined, deadline: clock.now() + (options.finallyDeadlineMs ?? 30_000) };
      for (const [i, step] of plan.finally.entries()) {
        try { await runStep(releaseRun, { ...step, on_fail: "continue" }, `finally/${i + 1}`, null); } catch (error) { run.reportErrors.push(`finally/${i + 1}: ${String((error as Error)?.message ?? error)}`); }
      }
      run.steps += releaseRun.steps;
    }
  }
  const outcome: Closing = status === "done" ? (run.continued ? "partial" : "completed") : decision !== undefined && decision !== "dissolve" && decision !== "abandon" ? "partial" : "abandoned";
  emit(run, { kind: "close", step: "close", attempt: 1, outcome, status, reason, last_step: lastStep, decision, ...(run.reportErrors.length ? { report_errors: run.reportErrors.length } : {}) });
  return { plan: plan.id, status, outcome, reason, last_step: lastStep, decision, bindings, reports: run.reports, ...(run.reportErrors.length ? { report_errors: run.reportErrors } : {}) };
}

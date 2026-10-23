// The NPC scenario runner (bridge 0.8; research/runtime/npc-direction-design.md §6): a scene is data an agent or a script
// writes, checks and replays, never code. A scenario names its actors (each an XF cast) and lists steps:
//
//   {"do": "npc.<command>", "who": "<actor>", ...the command's own input}     one npc command (catalogue-checked)
//   {"wait": "npc.<event>", "who": "<actor>", "max_s": 10, "as": "<name>"}   block until that event (or give up)
//   {"on": "<name>", "cases": {"0": [...], "1": [...], "timeout": [...]}}     branch on a remembered answer
//   {"pause": 1.5}                                                             wait a moment
//   {"note": "text"}                                                           a line in the report only
//
// Actor names stand in for handles everywhere: "who", and the target fields to, target, at and face. A do step's own
// refusal fails the scene, except optional steps and a gesture without the XF gesture carrier (carrier_missing), which are
// skipped with a warning (the scene still runs, as the design allows). A wait that runs out fails the scene, except a wait
// with "as" (the answer is then "timeout") or "optional". However the scene ends (done, failed, stopped), every actor it
// brought in is released, each one it ever spawned (a name spawned again while its first actor is still out is refused).
// A wait for npc.choice takes only the answer to the choices the scene showed last for that actor (its hub), never an
// earlier set's late timeout. Between polls the runner lets the bridge's main pipe go, so other XF tools can call meanwhile.
//
//   bun tools/npc/scenario.ts <scene.json> [--dry-run]      (or the catalogue's npc.scenario, through MCP or the CLI)

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CommandContext } from "../api/catalogue.ts";
import { COMMANDS_080_NPC, NPC_CASTS, NPC_WAIT_KINDS } from "../api/catalogue080npc.ts";
import { validate } from "../api/schema.ts";

export const SCENARIO_DIR = resolve(import.meta.dir, "scenarios");

type Json = Record<string, any>;
export type Step = Json;
export type Scenario = {
  scenario: string;
  title?: string;
  requires?: Json;
  actors: Record<string, { cast: string; label?: string }>;
  steps: Step[];
};

export type ScenarioReport = {
  scenario: string;
  ok: boolean;
  dry_run: boolean;
  outcome: "done" | "failed" | "stopped" | "checked";
  why?: string;
  actors: Record<string, string>;
  answers: Record<string, string>;
  warnings: string[];
  steps: Json[];
  events: Json[];
  released: string[];
  seconds: number;
};

const TARGET_FIELDS = ["to", "target", "at", "face", "away_from"] as const;
const TIMEOUT_CASES = ["timeout", "withdrawn", "walked_away"] as const;

class ScenarioError extends Error {
  constructor(
    message: string,
    readonly code = "scenario_invalid",
  ) {
    super(message);
  }
}

function commandDef(name: string) {
  return COMMANDS_080_NPC.find((c) => c.name === name && c.bridge);
}

/** Checks a scenario's shape and every do step's input against the catalogue, without touching the game. Returns problems. */
export function checkScenario(scenario: Scenario): string[] {
  const problems: string[] = [];
  if (!scenario || typeof scenario !== "object") return ["the scenario must be a JSON object"];
  if (typeof scenario.scenario !== "string" || !/^[a-z0-9_]{1,64}$/.test(scenario.scenario)) problems.push("scenario must be a short lowercase name");
  const actors = scenario.actors ?? {};
  if (typeof actors !== "object" || Object.keys(actors).length === 0) problems.push("actors must name at least one actor");
  if (Object.keys(actors).length > 3) problems.push("at most 3 actors (the bridge's limit)");
  for (const [name, actor] of Object.entries(actors)) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(name) || /^[ap][0-9]+$/.test(name) || name === "v" || name === "all") problems.push(`actor name "${name}" must be a plain lowercase word (not v, all or a handle)`);
    if (!NPC_CASTS.includes(actor?.cast as (typeof NPC_CASTS)[number])) problems.push(`actor "${name}" needs a cast: ${NPC_CASTS.join(", ")}`);
  }
  if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) problems.push("steps must be a non-empty list");
  const names = new Set<string>();
  const walk = (steps: Step[], path: string, depth: number) => {
    if (depth > 4) {
      problems.push(`${path}: branches nest at most four deep`);
      return;
    }
    steps.forEach((step, i) => {
      const at = `${path}[${i}]`;
      const kinds = ["do", "wait", "on", "pause", "note"].filter((k) => k in step);
      if (kinds.length !== 1) {
        problems.push(`${at}: a step is exactly one of do, wait, on, pause or note`);
        return;
      }
      const who = step.who as string | undefined;
      if (who !== undefined && who !== "all" && !(who in actors)) problems.push(`${at}: who "${who}" isn't one of the actors`);
      if ("do" in step) {
        const def = commandDef(step.do);
        if (!def) {
          problems.push(`${at}: "${step.do}" isn't an npc command a scene can run`);
          return;
        }
        if (step.do === "npc.spawn") {
          if (!who || who === "all") problems.push(`${at}: npc.spawn needs who (the actor it brings in)`);
        }
        const input = inputFor(step, Object.fromEntries(Object.keys(actors).map((n) => [n, "a1"])), actors);
        for (const problem of validate(def.input, input)) problems.push(`${at} (${step.do}): ${problem}`);
      } else if ("wait" in step) {
        if (!NPC_WAIT_KINDS.includes(step.wait)) problems.push(`${at}: wait for one of ${NPC_WAIT_KINDS.join(", ")}`);
        if (step.max_s !== undefined && !(typeof step.max_s === "number" && step.max_s > 0 && step.max_s <= 600)) problems.push(`${at}: max_s must be 0 to 600 seconds`);
        if (step.as !== undefined) {
          if (!/^[a-z][a-z0-9_]{0,31}$/.test(step.as)) problems.push(`${at}: as must be a plain name`);
          names.add(step.as);
        }
      } else if ("on" in step) {
        if (!names.has(step.on)) problems.push(`${at}: on "${step.on}" needs an earlier wait with as: "${step.on}"`);
        if (!step.cases || typeof step.cases !== "object" || Object.keys(step.cases).length === 0) problems.push(`${at}: cases must map answers to steps`);
        for (const [answer, branch] of Object.entries(step.cases ?? {})) {
          if (!Array.isArray(branch)) problems.push(`${at}.cases.${answer}: must be a list of steps`);
          else walk(branch as Step[], `${at}.cases.${answer}`, depth + 1);
        }
      } else if ("pause" in step) {
        if (!(typeof step.pause === "number" && step.pause >= 0 && step.pause <= 60)) problems.push(`${at}: pause must be 0 to 60 seconds`);
      }
    });
  };
  if (Array.isArray(scenario.steps)) walk(scenario.steps, "steps", 0);
  return problems;
}

export function loadScenario(path: string): Scenario {
  let scenario: Scenario;
  try {
    scenario = JSON.parse(readFileSync(path, "utf8")) as Scenario;
  } catch (error) {
    throw Object.assign(new Error(`can't read ${path}`), { plain: { code: "scenario_invalid", message: `The scene file can't be read as JSON (${(error as Error).message}).` } });
  }
  return scenario;
}

/** A do step's command input: the step without its runner keys, actor names turned into handles. */
function inputFor(step: Step, handles: Record<string, string>, actors: Scenario["actors"]): Json {
  const { do: name, optional: _optional, ...rest } = step;
  const input: Json = { ...rest };
  if (name === "npc.spawn") {
    const actor = actors[step.who];
    delete input.who;
    input.cast = actor?.cast;
    if (actor?.label && input.label === undefined) input.label = actor.label;
  } else if (typeof step.who === "string") {
    input.who = step.who === "all" ? "all" : handles[step.who] ?? step.who;
  }
  for (const field of TARGET_FIELDS) {
    if (typeof input[field] === "string" && input[field] in actors) input[field] = handles[input[field]] ?? input[field];
  }
  return input;
}

type Exec = { ok: true; result: Json } | { ok: false; error: { code: string; message: string } };

/** One npc command through the catalogue's own check and parameter mapping, straight to the bridge (a scene runs inside a
 * command, so it can't queue another one on the command API). */
async function execute(context: CommandContext, name: string, input: Json): Promise<Exec> {
  const def = commandDef(name)!;
  const problems = validate(def.input, input);
  if (problems.length) return { ok: false, error: { code: "bad_input", message: problems.join(" ") } };
  const params = def.bridge!.params ? def.bridge!.params(input) : input;
  // The Sol review of 0.8.9, finding 2: a scene's own steps carry its signal, so a stopped scene sends nothing more; the
  // clean-up's releases (runScenario's finally) call the bridge without it.
  const response = await context.api.callBridge(def.bridge!.method, params, context.cid, def.bridge!.timeoutMs?.(input), context.signal);
  return response.ok ? { ok: true, result: response.result as Json } : { ok: false, error: response.error as { code: string; message: string } };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((done) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      done();
    }, { once: true });
  });

export type RunOptions = { dryRun?: boolean; pollMs?: number; log?: (line: string) => void };

export async function runScenario(scenario: Scenario, context: CommandContext, options: RunOptions = {}): Promise<ScenarioReport> {
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 100) / 10;
  const report: ScenarioReport = {
    scenario: String(scenario?.scenario ?? ""),
    ok: false,
    dry_run: options.dryRun === true,
    outcome: "failed",
    actors: {},
    answers: {},
    warnings: [],
    steps: [],
    events: [],
    released: [],
    seconds: 0,
  };
  const problems = checkScenario(scenario);
  if (problems.length) {
    throw Object.assign(new Error(problems[0]), { plain: { code: "scenario_invalid", message: `The scene isn't valid: ${problems.join("; ")}.` } });
  }
  const log = options.log ?? (() => undefined);
  if (options.dryRun) {
    const list = (steps: Step[], indent: string) => {
      for (const step of steps) {
        if ("on" in step) {
          report.steps.push({ plan: `${indent}on ${step.on}` });
          for (const [answer, branch] of Object.entries(step.cases as Record<string, Step[]>)) {
            report.steps.push({ plan: `${indent}  case ${answer}` });
            list(branch, `${indent}    `);
          }
        } else {
          const kind = ["do", "wait", "pause", "note"].find((k) => k in step)!;
          report.steps.push({ plan: `${indent}${kind} ${kind === "pause" ? `${step.pause} s` : kind === "note" ? step.note : step[kind]}${step.who ? ` (${step.who})` : ""}` });
        }
      }
    };
    list(scenario.steps, "");
    report.ok = true;
    report.outcome = "checked";
    report.seconds = seconds();
    return report;
  }

  const handles: Record<string, string> = {};
  // Every actor the scene spawned, in order (the review's finding 7: a name spawned twice must not hide the first from the
  // clean-up).
  const spawned: { name: string; handle: string }[] = [];
  // The hub of the choices each actor showed last (the review's finding 6).
  const lastHub: Record<string, number> = {};
  const lastLine: Record<string, string> = {};
  const readingUntil: Record<string, { line: string; until: number }> = {};
  const consumed = new Set<number>();
  const pollMs = options.pollMs ?? 250;
  const latest = await context.api.callBridge("session.events", { since: 0, limit: 1 }, context.cid);
  let cursor = latest.ok ? Number((latest.result as Json).latest ?? 0) : 0;
  const seen: Json[] = [];
  const readEvents = async () => {
    const read = await context.api.callBridge("session.events", { since: cursor, limit: 100, kinds: [...NPC_WAIT_KINDS] }, context.cid);
    if (!read.ok) return;
    const events = ((read.result as Json).events as Json[] | undefined) ?? [];
    cursor = Number((read.result as Json).next ?? cursor);
    for (const event of events) {
      seen.push(event);
      report.events.push({ at_s: seconds(), kind: event.kind, who: event.data?.who, data: event.data });
    }
  };
  // The review's finding 9: let the main pipe go while the runner waits, as session.wait does.
  const idle = async (ms: number) => {
    context.api.release();
    await sleep(ms, context.signal);
  };
  const isGone = (handle: string) => seen.some((e) => (e.kind === "npc.released" || e.kind === "npc.lost" || e.kind === "npc.auto_released") && e.data?.who === handle);
  const handleOf = (name: string) => handles[name];
  const nameOf = (handle: string) => Object.entries(handles).find(([, h]) => h === handle)?.[0] ?? handle;

  const runSteps = async (steps: Step[]): Promise<void> => {
    for (const step of steps) {
      if (context.signal?.aborted) throw new ScenarioError("the scene was stopped", "stopped");
      const began = seconds();
      if ("note" in step) {
        report.steps.push({ note: step.note, at_s: began });
        log(`note: ${step.note}`);
        continue;
      }
      if ("pause" in step) {
        await idle(step.pause * 1000);
        report.steps.push({ pause: step.pause, at_s: began });
        continue;
      }
      if ("on" in step) {
        const answer = report.answers[step.on] ?? "timeout";
        const cases = step.cases as Record<string, Step[]>;
        const branch = cases[answer] ?? (TIMEOUT_CASES.includes(answer as (typeof TIMEOUT_CASES)[number]) ? cases.timeout : undefined) ?? cases.default;
        const branchName = !branch ? null : answer in cases ? answer : branch === cases.timeout ? "timeout" : "default";
        report.steps.push({ on: step.on, answer, branch: branchName, at_s: began });
        if (branch) await runSteps(branch);
        continue;
      }
      if ("do" in step) {
        const input = inputFor(step, handles, scenario.actors);
        if (step.do !== "npc.spawn" && typeof step.who === "string" && step.who !== "all" && !handleOf(step.who)) {
          throw new ScenarioError(`${step.who} hasn't been brought in yet (a npc.spawn step must come first)`);
        }
        if (step.do === "npc.spawn" && handles[step.who]) {
          await readEvents();
          if (!isGone(handles[step.who]!)) {
            throw new ScenarioError(`${step.who} is already out (${handles[step.who]}); release it before spawning that name again`);
          }
        }
        // 0.8.9 (session 15's NC1: a line was replaced before it could be read): a line or a set of choices waits until the
        // same speaker's last text line has had its time on screen (its npc.said), at most that line's seconds and 2 more.
        const speaker = step.who ?? "";
        const reading = readingUntil[speaker];
        if ((step.do === "npc.say" || step.do === "npc.choices") && reading && !step.hide) {
          while (Date.now() < reading.until && !context.signal?.aborted) {
            await readEvents();
            if (seen.some((e) => e.kind === "npc.said" && e.data?.line === reading.line)) break;
            await idle(pollMs);
          }
          delete readingUntil[speaker];
          if (context.signal?.aborted) throw new ScenarioError("the scene was stopped", "stopped");
        }
        const out = await execute(context, step.do, input);
        if (!out.ok && context.signal?.aborted) throw new ScenarioError("the scene was stopped", "stopped");
        const entry: Json = { do: step.do, who: step.who, at_s: began, ok: out.ok, took_s: Math.round((seconds() - began) * 10) / 10 };
        if (out.ok) {
          if (step.do === "npc.spawn") {
            handles[step.who] = String(out.result.who);
            spawned.push({ name: step.who, handle: handles[step.who]! });
            report.actors[step.who] = handles[step.who];
          }
          if (step.do === "npc.choices" && typeof out.result.hub === "number") lastHub[step.who ?? ""] = out.result.hub;
          if (step.do === "npc.say" && out.result.line) lastLine[step.who ?? ""] = String(out.result.line); // "" : a voice with no body
          if (step.do === "npc.say" && out.result.line && typeof step.text === "string") {
            readingUntil[step.who ?? ""] = { line: String(out.result.line), until: Date.now() + (Number(out.result.seconds ?? 4) + 2) * 1000 };
          }
          entry.result = out.result;
          report.steps.push(entry);
          log(`${step.do} ${step.who ?? ""}: ok`);
          continue;
        }
        entry.error = out.error;
        report.steps.push(entry);
        const skippable = step.optional === true || (step.do === "npc.act" && out.error.code === "carrier_missing");
        if (skippable) {
          report.warnings.push(`${step.do} for ${step.who} was skipped: ${out.error.message}`);
          log(`${step.do} ${step.who ?? ""}: skipped (${out.error.code})`);
          continue;
        }
        if (out.error.code === "too_far") {
          // 0.8.9: speech never plays to an empty street; the scene stops and its actors are released (below).
          throw new ScenarioError(`${step.who} wasn't near V, so the scene stopped before ${step.do === "npc.choices" ? "the choices" : "the line"}: ${out.error.message}`, out.error.code);
        }
        throw new ScenarioError(`${step.do} for ${step.who ?? "the scene"} was refused: ${out.error.message}`, out.error.code);
      }
      if ("wait" in step) {
        const handle = step.who ? handleOf(step.who) : undefined;
        if (step.who && !handle) throw new ScenarioError(`${step.who} hasn't been brought in yet, so there is nothing to wait for`);
        const deadline = Date.now() + (step.max_s ?? 30) * 1000;
        const hub = step.wait === "npc.choice" ? lastHub[step.who ?? ""] : undefined;
        let found: Json | undefined;
        while (!found && Date.now() < deadline && !context.signal?.aborted) {
          await readEvents();
          found = seen.find(
            (e) =>
              !consumed.has(e.seq) &&
              e.kind === step.wait &&
              (!handle || e.data?.who === handle) &&
              (hub === undefined || e.data?.hub === hub) &&
              (step.wait !== "npc.said" || !lastLine[step.who ?? ""] || step.any === true || e.data?.line === lastLine[step.who ?? ""]),
          );
          if (!found) await idle(pollMs);
        }
        if (context.signal?.aborted) throw new ScenarioError("the scene was stopped", "stopped");
        if (found) {
          consumed.add(found.seq);
          const entry: Json = { wait: step.wait, who: step.who, at_s: began, waited_s: Math.round((seconds() - began) * 10) / 10, event: found.data };
          if (step.as) {
            const d = found.data ?? {};
            report.answers[step.as] = d.index !== undefined ? String(d.index) : d.walked_away ? "walked_away" : d.withdrawn ? "withdrawn" : "timeout";
            entry.answer = report.answers[step.as];
            if (d.label) entry.label = d.label;
          }
          report.steps.push(entry);
          log(`wait ${step.wait} ${step.who ?? ""}: ${entry.answer ?? "done"}`);
          continue;
        }
        report.steps.push({ wait: step.wait, who: step.who, at_s: began, timed_out: true });
        if (step.as) {
          report.answers[step.as] = "timeout";
          continue;
        }
        if (step.optional) {
          report.warnings.push(`no ${step.wait} for ${step.who ?? "the scene"} within ${step.max_s ?? 30} s`);
          continue;
        }
        throw new ScenarioError(`no ${step.wait} for ${step.who ?? "the scene"} within ${step.max_s ?? 30} s`, "scenario_timeout");
      }
    }
  };

  try {
    await runSteps(scenario.steps);
    report.ok = true;
    report.outcome = "done";
  } catch (error) {
    const code = (error as ScenarioError).code;
    report.outcome = code === "stopped" ? "stopped" : "failed";
    report.why = (error as Error).message;
  } finally {
    // Release every actor the scene brought in and that isn't gone already.
    await readEvents().catch(() => undefined);
    for (const { name, handle } of spawned) {
      if (isGone(handle)) {
        report.released.push(name);
        continue;
      }
      const walking = handles[name] === handle && report.steps.some((s) => s.do === "npc.release" && s.who === name && s.ok);
      if (walking && report.outcome === "done") {
        // walk_away still under way: give it its time, then make sure.
        const deadline = Date.now() + 25_000;
        while (Date.now() < deadline) {
          await readEvents().catch(() => undefined);
          if (seen.some((e) => e.kind === "npc.released" && e.data?.who === handle)) break;
          context.api.release();
          await sleep(pollMs);
        }
        if (seen.some((e) => e.kind === "npc.released" && e.data?.who === handle)) {
          report.released.push(name);
          continue;
        }
      }
      const out = await context.api.callBridge("npc.release", { who: handle, how: "despawn" }, context.cid).catch(() => ({ ok: false }) as const);
      report.released.push(name);
      if (!out.ok) report.warnings.push(`${nameOf(handle)} couldn't be released by the scene (the kill switch or a load removes it)`);
    }
    report.seconds = seconds();
  }
  return report;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: bun tools/npc/scenario.ts <scene.json | name> [--dry-run]");
    process.exit(2);
  }
  const path = file.endsWith(".json") ? resolve(file) : join(SCENARIO_DIR, `${file}.json`);
  const { CommandApi } = await import("../api/command-api.ts");
  const api = new CommandApi();
  const outcome = await api.run("npc.scenario", { file: path, dry_run: args.includes("--dry-run") }, { source: "scenario-cli" });
  console.log(JSON.stringify(outcome, null, 2));
  process.exit(outcome.ok && (outcome.result as ScenarioReport).ok ? 0 : 1);
}

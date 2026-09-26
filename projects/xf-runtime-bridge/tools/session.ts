// Scripted in-game sessions: runs a JSON script of steps through the command API and writes a
// report folder with every screenshot and a manifest.json.
//
//   bun tools/session.ts <script.json> [--dry-run] [--out <dir>] [--from <step label>]
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
// "apply cc" (cc.apply), "capture" (capture.screenshot), "wait" ({"ms": n}), "note" ({"text"}),
// and "run" ({"command": "<any catalogue command>", "input": {...}}), so every command in the
// catalogue is scriptable. Every other key of a step is the command's input. A failed step stops
// the run (then "restore" runs) unless it says "continue_on_error": true.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { findCommand } from "./api/catalogue.ts";
import { CommandApi, type CommandOutcome } from "./api/command-api.ts";
import { validate } from "./api/schema.ts";

export const SCRIPT_SCHEMA = "xfb/session-script-1";

export const STEP_COMMANDS: Record<string, string> = {
  "set camera": "photo.camera.set",
  "set light": "photo.light.set",
  "apply cc": "cc.apply",
  capture: "capture.screenshot",
};
const STEP_META = new Set(["do", "label", "continue_on_error", "command", "input", "expect_error"]);

export type Step = { do: string; label?: string; continue_on_error?: boolean; command?: string; input?: Record<string, unknown>; expect_error?: string; [key: string]: unknown };
export type SessionScript = {
  schema: string;
  name: string;
  title?: string;
  card?: string;
  requires?: string[];
  defaults?: Record<string, Record<string, unknown>>;
  steps: Step[];
  restore?: Step[];
};

export type PlannedStep = { index: number; phase: "steps" | "restore"; label: string; kind: string; command?: string; input?: Record<string, unknown>; ms?: number; text?: string; step: Step };

/** Resolves every step to a command and input, and checks each input against the catalogue schema. */
export function planScript(script: SessionScript): { plan: PlannedStep[]; problems: string[] } {
  const problems: string[] = [];
  if (script.schema !== SCRIPT_SCHEMA) problems.push(`schema must be "${SCRIPT_SCHEMA}"`);
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(script.name ?? "")) problems.push("name must be 1-60 letters, digits, '.', '_' or '-'");
  const plan: PlannedStep[] = [];
  const add = (phase: "steps" | "restore", steps: Step[] | undefined) => {
    for (const step of steps ?? []) {
      const index = plan.length + 1;
      const label = step.label ?? `${phase === "restore" ? "restore-" : ""}${index}`;
      const where = `step ${index} (${label})`;
      const kind = step.do;
      const own = Object.fromEntries(Object.entries(step).filter(([key]) => !STEP_META.has(key)));
      if (kind === "wait") {
        const ms = Number(step.ms);
        if (!(ms >= 0 && ms <= 120000)) problems.push(`${where}: wait needs "ms" between 0 and 120000`);
        plan.push({ index, phase, label, kind, ms, step });
        continue;
      }
      if (kind === "note") {
        plan.push({ index, phase, label, kind, text: String(step.text ?? ""), step });
        continue;
      }
      const commandName = kind === "run" ? step.command : STEP_COMMANDS[kind];
      if (!commandName) {
        problems.push(`${where}: unknown step "${kind}" (use ${[...Object.keys(STEP_COMMANDS), "wait", "note", "run"].join(", ")})`);
        continue;
      }
      const command = findCommand(commandName);
      if (!command) {
        problems.push(`${where}: no command "${commandName}"`);
        continue;
      }
      const input = { ...(script.defaults?.[kind] ?? {}), ...(kind === "run" ? (step.input ?? {}) : own) };
      if (kind === "capture" && input.name === undefined) input.name = label.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80);
      for (const problem of validate(command.input, input)) problems.push(`${where}: ${problem}`);
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
  files?: { full: string; view: string };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runScript(
  script: SessionScript,
  options: { api: CommandApi; outDir: string; from?: string; log?: (line: string) => void; scriptPath?: string },
): Promise<{ ok: boolean; manifestPath: string; records: StepRecord[] }> {
  const log = options.log ?? ((line: string) => console.log(line));
  const { plan, problems } = planScript(script);
  if (problems.length) throw new Error(`script problems:\n  ${problems.join("\n  ")}`);
  mkdirSync(options.outDir, { recursive: true });
  const api = options.api;
  const records: StepRecord[] = [];
  const snapshot = async (name: string) => {
    const outcome = await api.run(name, {}, { source: "session" });
    return outcome.ok ? outcome.result : { error: outcome.error };
  };
  const startedAt = new Date().toISOString();
  const before = { bridge: await snapshot("bridge.info"), game: findCommand("game.status") ? await snapshot("game.status") : null };

  let failed = false;
  let skipping = options.from !== undefined;
  for (const planned of plan) {
    if (skipping && planned.phase === "steps") {
      if (planned.label !== options.from) {
        records.push({ index: planned.index, phase: planned.phase, label: planned.label, kind: planned.kind, started_at: new Date().toISOString(), ms: 0, ok: true, skipped: true });
        continue;
      }
      skipping = false;
    }
    if (failed && planned.phase === "steps") {
      records.push({ index: planned.index, phase: planned.phase, label: planned.label, kind: planned.kind, started_at: new Date().toISOString(), ms: 0, ok: false, skipped: true });
      continue;
    }
    const started = performance.now();
    const record: StepRecord = { index: planned.index, phase: planned.phase, label: planned.label, kind: planned.kind, started_at: new Date().toISOString(), ms: 0, ok: true };
    if (planned.kind === "wait") {
      await sleep(planned.ms!);
    } else if (planned.kind === "note") {
      record.result = planned.text;
      log(`     note: ${planned.text}`);
    } else {
      const input = planned.input!;
      const outcome: CommandOutcome = await api.run(planned.command!, input, { source: "session", captureRoot: options.outDir });
      record.command = planned.command;
      record.input = input;
      record.ok = outcome.ok;
      if (outcome.ok) {
        record.result = outcome.result;
        if (outcome.undo) record.undo = outcome.undo;
        const capture = outcome.result as { full?: { path: string }; view?: { path: string } };
        if (capture?.full?.path && capture.view?.path) {
          record.files = { full: relative(options.outDir, capture.full.path), view: relative(options.outDir, capture.view.path) };
        }
      } else {
        record.error = outcome.error;
        if (planned.step.expect_error && outcome.error.code === planned.step.expect_error) record.ok = true;
      }
    }
    record.ms = Math.round(performance.now() - started);
    records.push(record);
    const status = record.ok ? "OK  " : "FAIL";
    const detail = record.ok ? "" : ` ${(record.error as { message?: string })?.message ?? ""}`;
    log(`${status} ${String(planned.index).padStart(3)} ${planned.label} (${planned.kind}${record.command ? ` ${record.command}` : ""}) ${record.ms}ms${detail}`);
    if (!record.ok && !planned.step.continue_on_error && planned.phase === "steps") failed = true;
  }

  const after = { bridge: await snapshot("bridge.info"), game: findCommand("game.status") ? await snapshot("game.status") : null };
  api.close();
  const manifest = {
    schema: "xfb/session-report-1",
    script: { name: script.name, title: script.title, card: script.card, path: options.scriptPath, requires: script.requires ?? [] },
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    ok: !failed && records.every((r) => r.ok || r.skipped),
    before,
    after,
    steps: records,
    notes: [
      "Screenshots are external window captures (what was on screen, after ReShade and overlays), 8-bit. Each step's result records the source window size, crop and scale.",
      "Nothing in a session saves the game. Write steps list how to undo them.",
    ],
  };
  const manifestPath = join(options.outDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return { ok: manifest.ok, manifestPath, records };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const scriptPath = args.find((a, i) => !a.startsWith("--") && !["--out", "--from", "--runtime-dir"].includes(args[i - 1]));
  if (!scriptPath || !existsSync(scriptPath)) {
    console.error("usage: bun tools/session.ts <script.json> [--dry-run] [--out <dir>] [--from <step label>]");
    process.exit(2);
  }
  const script = JSON.parse(readFileSync(scriptPath, "utf8")) as SessionScript;
  const { plan, problems } = planScript(script);
  console.log(`${script.title ?? script.name}: ${plan.length} steps${script.card ? ` (card: ${script.card})` : ""}`);
  for (const need of script.requires ?? []) console.log(`  requires: ${need}`);
  if (problems.length) {
    console.error(`\nThe script has problems:\n  ${problems.join("\n  ")}`);
    process.exit(2);
  }
  if (args.includes("--dry-run")) {
    for (const p of plan) console.log(`  ${String(p.index).padStart(3)} ${p.phase === "restore" ? "[restore] " : ""}${p.label}: ${p.kind}${p.command ? ` -> ${p.command} ${JSON.stringify(p.input)}` : p.ms !== undefined ? ` ${p.ms} ms` : ` ${p.text}`}`);
    console.log("\nDry run: the script is valid. Nothing was sent to the game.");
    process.exit(0);
  }
  const stampText = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = resolve(option("--out") ?? join(import.meta.dir, "..", "captures", "sessions", `${script.name}-${stampText}`));
  const api = new CommandApi({ runtimeDir: option("--runtime-dir") });
  const { ok, manifestPath } = await runScript(script, { api, outDir, from: option("--from"), scriptPath: basename(scriptPath) });
  console.log(`\n${ok ? "Session complete" : "Session stopped early"}: ${manifestPath}`);
  process.exit(ok ? 0 : 1);
}

// --preflight: everything about a schema-3 batch that can be known before the game starts, checked offline.
//
// For the staged build (the MO2 mod folder in the fixtures): its version and commit against these tools, that its
// DLL answers every bridge method the script's commands use, and that its config allows their write classes. For the
// staged config.ini: what each row needs set, in order, and how many restarts that costs. For the keys the script
// presses: CET's bindings.json (packed virtual keys, the first in the high bits). Then the machine's free commit
// against the floor, whether another writer holds the bridge (only when the game is running), and the
// frame-generation modules that make motion auto read reduced.
//
// Each item is ok, fix (the runner does it itself: config.set and a restart), warn, info or blocker (named plainly,
// for a person to fix). Nothing here writes a file, launches anything or sends a key.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findCommand, type Permission } from "../api/catalogue.ts";
import { lockAlive, readSessionLock } from "../session-lock.ts";
import { builtinTeardown, commandOf, launchSteps, closeSteps, planBatch, simulateConfig, type BatchScript } from "./batch.ts";
import { readIni, stagedConfigPath, stagedDllPath, stagedManifestPath } from "./config-ini.ts";
import { currentProcessBreakawayBlocked, JOB_BREAKAWAY_MESSAGE } from "./host.ts";
import { decodeCetBinding, keysLabel, parseCetBindings, parseKeys } from "./host.ts";
import { resolveRefs, type Step } from "./plan.ts";

export type PreflightStatus = "ok" | "fix" | "warn" | "info" | "blocker";
export type PreflightItem = { status: PreflightStatus; check: string; detail: string };
export type PreflightResult = { items: PreflightItem[]; fixes: number; restarts: number; blockers: number; ready: boolean };

/** The frame-generation modules the plugin looks for (native/src/core/Win32.cpp); the game loads them from its bin/x64. */
export const FRAME_GENERATION_MODULES = ["sl.dlss_g.dll", "ffx_frameinterpolation_x64.dll", "libxess_fg.dll", "nvngx_dlssg.dll"];

/** The write class a permission needs in config.ini's allow_write_classes (none for reads, messages and controls). */
export const WRITE_CLASS: Partial<Record<Permission, string>> = {
  "write-photo": "photo", "write-world": "world", "write-character": "character", "write-inventory": "inventory", "write-save": "save",
  "write-showroom": "showroom", "write-player": "player", "act-player": "act", "write-npc": "npc", "write-dm": "dm",
};

export type PreflightOptions = {
  script: BatchScript;
  fixtures: Record<string, unknown>;
  /** The bridge project folder (package.json; git for the staged commit). */
  projectDir: string;
  runtimeDir: string;
  freeCommitBytes: () => Promise<number | null>;
  gameRunning: () => Promise<boolean>;
  /** Inspect the current runner process; tests supply a fake. */
  breakawayBlocked?: () => Promise<boolean>;
  /** Asks the bridge whether another writer holds it; only called while the game runs. */
  writerBusy?: () => Promise<{ busy: boolean; detail: string }>;
  /** Commit hashes and runtime files changed since; tests pass their own. */
  git?: (args: string[]) => string | null;
  readText?: (path: string) => string | null;
  readBytes?: (path: string) => Buffer | null;
  listDir?: (path: string) => string[];
};

const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);
const readBytes = (path: string) => (existsSync(path) ? readFileSync(path) : null);
const list = (path: string) => (existsSync(path) ? readdirSync(path) : []);

/** Every step of the script with the runner's own prelude and teardown steps, flattened (routes, branches, fallbacks, blocks). */
export function allSteps(steps: Step[] | undefined, out: Step[] = []): Step[] {
  for (const step of steps ?? []) {
    out.push(step);
    allSteps(step.fallback, out);
    allSteps(step.together, out);
    allSteps(step.sequence, out);
    for (const route of step.alternatives ?? []) allSteps(route, out);
    for (const branch of step.outcomes ?? []) { allSteps(branch.run, out); if (branch.observe) out.push(branch.observe as Step); }
    if (step.when?.check) out.push(step.when.check as Step);
  }
  return out;
}

/**
 * Whether a DLL carries a method name as a NUL-terminated string (how the dispatcher's literals are stored): whole, or
 * only as the tail of a longer one (the linker merges a literal into another that ends with it: "ping" lives inside
 * "native.ping" in 0.8.22), which is likely but not certain.
 */
export function dllHasString(dll: Buffer, name: string): "whole" | "tail" | "embedded" | false {
  if (dll.includes(Buffer.from(`\0${name}\0`, "latin1"))) return "whole";
  if (dll.includes(Buffer.from(`${name}\0`, "latin1"))) return "tail";
  // A short name can be compiled into code as an immediate (a small std::string built in place: "ui.state" in 0.8.22).
  return dll.includes(Buffer.from(name, "latin1")) ? "embedded" : false;
}

export async function preflight(options: PreflightOptions): Promise<PreflightResult> {
  const items: PreflightItem[] = [];
  const add = (status: PreflightStatus, check: string, detail: string) => items.push({ status, check, detail });
  try {
    const blocked = await (options.breakawayBlocked ?? (async () => currentProcessBreakawayBlocked()))();
    add(blocked ? "blocker" : "ok", "Windows job", blocked ? JOB_BREAKAWAY_MESSAGE : "the runner's Windows job permits launching through MO2");
  } catch (error) { add("blocker", "Windows job", String((error as Error)?.message ?? error)); }
  const text = options.readText ?? read;
  const bytes = options.readBytes ?? readBytes;
  const git = options.git ?? ((args: string[]) => {
    const out = spawnSync("git", args, { cwd: options.projectDir, encoding: "utf8", windowsHide: true });
    return out.status === 0 ? out.stdout.trim() : null;
  });
  const f = options.fixtures;
  const planned = planBatch(options.script);
  if (planned.problems.length) add("blocker", "script", `${planned.problems.length} problems: ${planned.problems.slice(0, 3).join("; ")}`);
  const rows = planned.rows.map((r) => r.row);
  const steps = allSteps([...planned.setup.steps, ...planned.rows.flatMap((r) => [...r.plan.steps, ...(r.plan.finally ?? [])]), ...planned.teardown.steps, ...builtinTeardown(), ...launchSteps(true), ...closeSteps()]);

  // Fixtures.
  const mo2 = f.mo2 as { exe?: string; profile?: string; executable?: string; arguments?: string } | undefined;
  const staged = typeof f.staged_mod === "string" ? f.staged_mod : undefined;
  const gameDir = typeof f.game_dir === "string" ? f.game_dir : undefined;
  if (!staged) add("blocker", "fixtures", "No staged_mod: the runner can't read or set the staged config.ini or check the build.");
  if (!gameDir) add("warn", "fixtures", "No game_dir: CET's key bindings and the frame-generation modules can't be checked.");
  if (!mo2?.exe || !mo2.profile || !mo2.executable) add("warn", "fixtures", "No mo2 {exe, profile, executable}: the runner can't launch or restart the game itself.");
  else add(text(mo2.exe) === null && !existsSync(mo2.exe) ? "blocker" : "ok", "MO2", `${mo2.profile} through ${mo2.exe.split(/[\\/]/).pop()}${mo2.arguments ? ` with ${mo2.arguments}` : ""}`);
  if (f.save === undefined) add("info", "fixtures", "No save named: loads use the latest save of the playthrough.");

  // The staged build.
  const tools = JSON.parse(text(join(options.projectDir, "package.json")) ?? "{}").version as string | undefined;
  let classes: string[] | null = null;
  let stagedValues: Record<string, string> | null = null;
  let stagedCommit: string | undefined;
  // The script's own steps (not the runner's built-in prelude and teardown): what it asks of the build.
  const scriptSteps = allSteps([...planned.setup.steps, ...planned.rows.flatMap((r) => [...r.plan.steps, ...(r.plan.finally ?? [])]), ...planned.teardown.steps]);
  let manifest: { version?: string; variant?: string; commit?: string; source_tree_clean?: boolean; allow_test_hooks?: boolean; autonomous_test_hooks?: boolean; files?: { path?: string; sha256?: string }[] } | undefined;
  if (staged) {
    const manifestText = text(stagedManifestPath(staged));
    if (!manifestText) add("blocker", "staged build", `No manifest.json in the staged mod (${stagedManifestPath(staged).split(/[\\/]/).slice(-4).join("/")}).`);
    else {
      manifest = JSON.parse(manifestText) as NonNullable<typeof manifest>;
      const version = manifest.version === tools ? "ok" : "warn";
      add(version, "staged build", `${manifest.version} ${manifest.variant} (commit ${manifest.commit?.slice(0, 8)}${manifest.source_tree_clean === false ? ", dirty" : ""}); these tools are ${tools}`);
      if (manifest!.variant !== "writes") add("blocker", "staged build", `The staged build is the ${manifest.variant} package; the batch's changes need the -writes package in the test profile.`);
      if (manifest.commit) {
        const known = git(["cat-file", "-e", `${manifest.commit}^{commit}`]) !== null;
        if (known) stagedCommit = manifest.commit;
        if (!known) add("warn", "staged build", "Its commit isn't in this checkout, so what changed since can't be listed.");
        else {
          const changed = (git(["diff", "--name-only", manifest.commit, "HEAD", "--", "native", "redscript", "redscript-dm", "redscript-input", "cet", "tweaks"]) ?? "").split(/\r?\n/).filter(Boolean);
          add(changed.length ? "warn" : "ok", "staged vs source", changed.length ? `${changed.length} runtime files changed since the staged commit (${changed.slice(0, 4).join(", ")}${changed.length > 4 ? ", ..." : ""}): rebuild and restage if the batch tests them` : "no runtime source changed since the staged commit");
        }
      }
    }
    const dll = bytes(stagedDllPath(staged));
    const methods = new Map<string, string[]>();
    for (const step of steps) {
      const command = commandOf(step as Record<string, unknown>);
      const def = command ? findCommand(command) : undefined;
      if (def?.bridge?.method) methods.set(def.bridge.method, [...(methods.get(def.bridge.method) ?? []), command!]);
    }
    // The manifest must describe this very binary (its sha256), from a clean tree, before its commit's source can speak for it.
    const dllHash = dll ? createHash("sha256").update(dll).digest("hex") : undefined;
    const listed = manifest?.files?.find((f) => f.path === "red4ext/plugins/XFRuntimeBridge/XFRuntimeBridge.dll")?.sha256;
    const tied = dllHash !== undefined && listed === dllHash && manifest?.source_tree_clean === true;
    if (dll && manifest) add(tied ? "ok" : "blocker", "staged binary", tied ? `XFRuntimeBridge.dll is the one its manifest lists (sha256 ${dllHash!.slice(0, 12)}), built from a clean tree`
      : listed === undefined ? "The manifest doesn't list the DLL's hash, so nothing ties this binary to a build: restage from a packaged zip."
      : listed !== dllHash ? `The staged DLL (sha256 ${dllHash!.slice(0, 12)}) isn't the one its manifest lists (${listed.slice(0, 12)}): it was replaced after packaging; restage.`
      : "The manifest says the build came from a dirty tree, so its commit doesn't describe the binary: rebuild from a clean commit.");
    if (!dll) add("blocker", "staged build", "No XFRuntimeBridge.dll in the staged mod.");
    else {
      // Not in the DLL's text: the staged commit's own source registering it also counts (a name split across immediates),
      // but only when the manifest is tied to this binary.
      const registered = (m: string) => tied && stagedCommit !== undefined && git(["grep", "-q", "-F", `Register({"${m}"`, stagedCommit, "--", "native/src/core", "native/src/plugin"]) !== null;
      const missing = [...methods.keys()].filter((m) => !dllHasString(dll, m) && !registered(m));
      const tails = [...methods.keys()].filter((m) => ["tail", "embedded", false].includes(dllHasString(dll, m)) && !missing.includes(m));
      add(missing.length ? "blocker" : "ok", "commands", missing.length ? `The staged DLL doesn't answer ${missing.map((m) => `${m} (${methods.get(m)![0]})`).join(", ")}: stage a build that has them`
        : `the staged DLL answers all ${methods.size} bridge methods the script's commands use${tails.length ? ` (${tails.join(", ")} not as a plain string: found merged, compiled in, or registered by the staged commit's source)` : ""}`);
    }
    const configText = text(stagedConfigPath(staged));
    if (!configText) add("blocker", "config", "No config.ini in the staged mod.");
    else {
      stagedValues = readIni(configText);
      classes = (stagedValues["bridge.allow_write_classes"] ?? "photo, world, character").split(",").map((c) => c.trim()).filter(Boolean);
      if (stagedValues["bridge.allow_writes"] !== "true") add("warn", "config", "The staged config has allow_writes off: every change the batch makes is refused until a row sets it.");
    }
    // The test gates: the recorder (telemetry, always on), test probes and the event-armed captures need the autonomous
    // -writes package and allow_test_hooks in its config.
    const hookCommands = [...new Set(scriptSteps.flatMap((st) => {
      const c = commandOf(st as Record<string, unknown>);
      // 0.8.22: overlay.set's diagnostics test figure is a test hook too.
      if (c === "overlay.set" && (st.input as { diagnostics_cpu_ms?: unknown } | undefined)?.diagnostics_cpu_ms !== undefined) return ["overlay.set diagnostics_cpu_ms"];
      // A press on the CET window's Pause changes / Resume changes button is a test hook (the bridge refuses it test_hooks_off otherwise).
      if (c === "cet.panel" && (st.input as { press?: unknown } | undefined)?.press !== undefined) return ["cet.panel press"];
      return c && (/^test\./.test(c) || ["game.catchup", "capture.arm", "game.lifecycle.probe"].includes(c)) ? [c] : [];
    }))];
    const builtWithHooks = manifest?.allow_test_hooks === true && manifest?.autonomous_test_hooks === true;
    const configHooks = stagedValues?.["bridge.allow_test_hooks"] === "true";
    if (manifest && stagedValues) {
      const gap = [...(builtWithHooks ? [] : ["the staged build isn't the autonomous -writes package (manifest allow_test_hooks and autonomous_test_hooks)"]), ...(configHooks ? [] : ["config.ini's [bridge] allow_test_hooks isn't true"])];
      if (!gap.length) add("ok", "test hooks", "the autonomous build with allow_test_hooks: the recorder and test probes are available");
      else if (hookCommands.length) add("blocker", "test hooks", `${gap.join("; ")}, and the script uses ${hookCommands.slice(0, 4).join(", ")}: stage the autonomous -writes package`);
      else add("warn", "test hooks", `${gap.join("; ")}: telemetry runs without the recorder`);
    }
  }

  // Write classes: what the commands need against what the config allows (a safety decision, never changed by the runner).
  if (classes) {
    const needed = new Map<string, string[]>();
    for (const step of steps) {
      const command = commandOf(step as Record<string, unknown>);
      const cls = command ? WRITE_CLASS[findCommand(command)?.permission as Permission] : undefined;
      if (cls) needed.set(cls, [...new Set([...(needed.get(cls) ?? []), command!])]);
    }
    const refused = [...needed.keys()].filter((c) => !classes!.includes(c));
    add(refused.length ? "blocker" : "ok", "write classes", refused.length ? `config.ini's allow_write_classes lacks ${refused.map((c) => `${c} (${needed.get(c)![0]})`).join(", ")}; that's the maintainer's call, so the runner won't add it` : `allowed: ${[...needed.keys()].join(", ") || "none needed"}`);
  }

  // Config, row by row: what the runner will set, and the restarts it costs.
  // The first row's config goes in before the launch when the game isn't running yet; every later change (or a due restart) restarts it.
  const running = await options.gameRunning();
  let restarts = 0;
  if (stagedValues) {
    const plan = simulateConfig(rows, stagedValues);
    let first = true;
    for (const step of plan) {
      if (!Object.keys(step.needs).length && !step.restart) { first = false; continue; }
      const restart = first ? running && step.restart : step.restart;
      if (restart) restarts++;
      add("fix", `config before ${step.row}`, `${Object.entries(step.needs).map(([k, v]) => `${k} = ${v}`).join(", ") || "(nothing)"}${restart ? ", then a restart" : " before the launch"} (the runner does this)`);
      first = false;
    }
    if (!plan.some((p) => Object.keys(p.needs).length)) add("ok", "config", "the staged config already has what every row needs");
  }

  // Keys: CET's bindings for every binding the script presses or requires, and the fixtures' chords.
  const bindingsPath = gameDir ? join(gameDir, "bin", "x64", "plugins", "cyber_engine_tweaks", "bindings.json") : undefined;
  const bindingsText = bindingsPath ? text(bindingsPath) : null;
  const cet = bindingsText ? parseCetBindings(bindingsText) : null;
  const wanted = new Map<string, string | undefined>();
  for (const row of rows) for (const need of row.requires ?? []) if (need.binding) wanted.set(need.binding, need.equals === undefined ? undefined : String(resolveRefs(need.equals, { fixture: f })));
  for (const step of steps) if (step.do === "host.key" && typeof step.binding === "string" && !wanted.has(step.binding)) wanted.set(step.binding, undefined);
  for (const [binding, equals] of wanted) {
    if (!cet) { add("blocker", `key ${binding}`, "CET's bindings.json couldn't be read (fixtures game_dir)."); continue; }
    const [mod, name] = binding.split(".");
    const value = cet[mod]?.[name];
    const keys = value === undefined ? [] : decodeCetBinding(value);
    if (!keys.length) { add("blocker", `key ${binding}`, `CET has no key bound for ${binding}: bind it in the CET overlay's Bindings tab.`); continue; }
    let match = true;
    if (equals !== undefined) { try { match = keysLabel(parseKeys(equals)) === keysLabel(keys); } catch { match = false; } }
    add(match ? "ok" : "blocker", `key ${binding}`, `${keysLabel(keys)} (0x${value!.toString(16).padStart(16, "0")})${match ? "" : `, but the fixtures say ${equals}`}`);
  }
  for (const step of steps) {
    if (step.do !== "host.key" || typeof step.keys !== "string") continue;
    const keys = String(resolveRefs(step.keys, { fixture: f }));
    try { parseKeys(keys); } catch (error) { add("blocker", `key ${step.keys}`, (error as Error).message); }
  }

  // Memory, the writer seat and the session lock.
  const free = await options.freeCommitBytes();
  const floor = typeof f.commit_floor_gb === "number" ? f.commit_floor_gb : 4;
  const gameGb = typeof f.game_commit_gb === "number" ? f.game_commit_gb : 16;
  if (free === null) add("warn", "memory", "The machine's commit counters couldn't be read.");
  else {
    const gb = free / 1024 ** 3;
    add(gb < floor ? "blocker" : !running && gb < floor + gameGb ? "warn" : "ok", "memory",
      `${gb.toFixed(1)} GB of commit free (floor ${floor} GB${running ? "" : `; the game takes about ${gameGb} GB more once it runs`})`);
  }
  const lock = readSessionLock(options.runtimeDir);
  if (lock && lockAlive(lock)) add("blocker", "session lock", `Another session runner holds the bridge (${lock.script ?? "a script"}, pid ${lock.pid}).`);
  if (running) {
    const writer = await (options.writerBusy?.() ?? Promise.resolve({ busy: false, detail: "not checked" }));
    add(writer.busy ? "blocker" : "ok", "writer", writer.busy ? `Another tool holds the bridge's writer seat (bridge_busy): ${writer.detail}. Close it (the MCP server: /reload-plugins after its session) first.` : `the writer seat is free (${writer.detail})`);
  } else add("info", "writer", "The game isn't running: the writer seat is checked when the bridge first answers.");

  // Rows that need the player (marked manual): named, so the session plan can put a person there for them.
  const manual = rows.filter((r) => r.manual).map((r) => r.id);
  add("info", "manual rows", manual.length ? `${manual.join(", ")} need the player (they ask and wait)` : "none: every row runs without the player");

  // Recording lifetimes: a row's own recorder must outlast the row (its expected span, or its waits added up).
  for (const entry of planned.rows) {
    const row = entry.row;
    const flat = allSteps(entry.plan.steps);
    const starts = flat.filter((st) => commandOf(st as Record<string, unknown>) === "test.record.start");
    if (!starts.length) continue;
    const lifetime = Math.min(...starts.map((st) => Number((st.input as { duration_s?: number } | undefined)?.duration_s ?? 60)));
    const waited = flat.reduce((sum, st) => sum + (st.do === "wait" ? Number(st.ms ?? 0) / 1000 : st.do === "await" ? Number(st.timeout_s ?? 0) : st.do === "events" ? Number(st.duration_s ?? 0) : 0), 0);
    const span = row.expected_s ?? waited;
    if (span > lifetime) add("warn", `recording ${row.id}`, `the row may run ${Math.round(span)} s but its recorder lives ${lifetime} s: raise duration_s (at most 1800), or reuse the batch's recorder ($recorder), which rolls to a new run`);
    else add("ok", `recording ${row.id}`, `recorder lifetime ${lifetime} s covers the row's ${Math.round(span)} s`);
  }

  // Frame generation: motion auto reads reduced while a module is loaded.
  const modules = gameDir ? (options.listDir ?? list)(join(gameDir, "bin", "x64")).filter((n) => FRAME_GENERATION_MODULES.includes(n.toLowerCase())) : [];
  if (modules.length) {
    // A row's motion: set at load (a config requirement) or live (an overlay.set in its steps).
    const motionOf = (id: string, wanted: string) => {
      const entry = planned.rows.find((r) => r.row.id === id)!;
      return (entry.row.requires ?? []).some((n) => n.config === "overlay.motion" && n.equals === wanted) ||
        allSteps(entry.plan.steps).some((st) => commandOf(st as Record<string, unknown>) === "overlay.set" && (st.input as { motion?: string } | undefined)?.motion === wanted);
    };
    const auto = rows.filter((r) => motionOf(r.id, "auto")).map((r) => r.id);
    const full = rows.filter((r) => motionOf(r.id, "full")).map((r) => r.id);
    add("info", "frame generation", `${modules.join(", ")} in the game folder: motion auto reads reduced (reason frame_generation)${auto.length ? ` for ${auto.join(", ")}` : ""}; ${full.length ? `${full.length} rows set motion = full for animation` : "no row sets motion = full"}.`);
  } else if (gameDir) add("info", "frame generation", "no frame-generation module in the game folder");

  const blockers = items.filter((i) => i.status === "blocker").length;
  return { items, fixes: items.filter((i) => i.status === "fix").length, restarts, blockers, ready: blockers === 0 };
}

/** The preflight as a plain table. */
export function formatPreflight(result: PreflightResult, title: string): string {
  const width = Math.min(28, Math.max(...result.items.map((i) => i.check.length)));
  return [
    `Preflight: ${title}`,
    "",
    ...result.items.map((i) => `  ${(i.status === "blocker" ? "BLOCKER" : i.status).padEnd(8)} ${i.check.padEnd(width)}  ${i.detail}`),
    "",
    `${result.fixes} planned fixes (${result.restarts} restarts), ${result.blockers} blockers: ${result.ready ? "ready to run." : "not ready: fix the blockers first."}`,
  ].join("\n");
}

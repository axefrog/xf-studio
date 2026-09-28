/**
 * Parity harness for XF Studio's facial solver (src/engines/facial-rig/solver.ts; research/animation/facial-solver-spec.md §9). It builds
 * the specification's cases from the rig, the facial setup and the game's clips, asks the pinned IO Suite solver for its answers through our
 * own wrapper (tools/facial_solver_server.py, spoken to as a black box over its line protocol, with `"outputs": true`), stores inputs and
 * answers as a local fixture (game-derived: an ignored folder), and compares XF Studio's solver against it per group.
 *
 *   bun tools/facial-solver-oracle.ts [--generate] [--fixture <dir>] [--intake <research/consumers>] [--game <folder>] [--report <file>]
 *
 * --generate runs the oracle (Python and the IO Suite checkout: XFS_FACIAL_SOLVER, XFS_PYTHON, or the developer layout) under the memory
 * guard; without it the existing fixture is compared. XF Studio's side reads the rig and setup from the game's files with its own reader
 * (the extracted resources in the intake), so the native reading is part of what is checked. The opt-in test
 * tests/facial-solver-oracle.test.ts replays the same fixture.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { clipTracksFromKeys, type ClipTracks } from "../src/engines/facial-rig/anim-tracks";
import { compileFacialRig, type CompiledFacialRig } from "../src/engines/facial-rig/solver";
import { decodeAnimClip, readAnimSetIndex } from "../src/native/anim-set";
import type { Decompress } from "../src/native/kark";
import { loadGameOodle } from "../src/native/oodle";
import { readResource } from "../src/native/resource-document";
import { buildCases, compareFixture, type FixtureIndex, maleCases, type OracleCase, type OracleClips, readFixture, TOLERANCE, type GroupReport } from "./facial-oracle-cases";
import { configuredGameRoot } from "./configured-game-root";

const AUTHORING = resolve(import.meta.dir, "..");
/** The primary checkout (a worktree's intakes live there): the parent of git's common directory. */
export function primaryCheckout(): string {
  const result = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: AUTHORING, encoding: "utf8" });
  const common = result.status === 0 ? result.stdout.trim() : "";
  return common ? dirname(common) : resolve(AUTHORING, "..", "..", "..");
}
export const DEFAULT_FIXTURE = join(AUTHORING, "data", "facial-oracle");

/** The local intake's files (research/consumers/*, ignored). */
export function intakePaths(intake: string) {
  const female = join(intake, "cc-idle"), male = join(intake, "game-blink");
  const head = "base/characters/head/player_base_heads/player_female_average/h0_000_pwa_c__basehead";
  return {
    rigJson: join(female, "json", "h0_000_pwa_c__basehead_skeleton.rig.json"),
    setupJson: join(female, "json", "h0_000_pwa_c__basehead_rigsetup.facialsetup.json"),
    maleSetupJson: join(male, "json", "h0_001_ma_c__player_rigsetup.facialsetup.json"),
    rig: join(female, "extracted", head, "h0_000_pwa_c__basehead_skeleton.rig"),
    setup: join(female, "extracted", head, "h0_000_pwa_c__basehead_rigsetup.facialsetup"),
    maleSetup: join(male, "extracted", "base/characters/head/pma/h0_001_ma_c__player/h0_001_ma_c__player_rigsetup.facialsetup"),
    additives: join(male, "extracted", "base/animations/facial/generic/interactive_scene/generic_facial_additives.anims"),
    uiFace: join(female, "extracted", "base/animations/ui/female/ui_female_face.anims"),
    photomode: join(male, "extracted", "base/animations/ui/photomode/photomode_female_facial.anims"),
  };
}

/** A resource's document through XF Studio's own reader. */
function nativeDocument(path: string, decompress: Decompress): unknown {
  return readResource(new Uint8Array(readFileSync(path)), decompress, { buffers: "trim" }).document;
}

/** One clip's float tracks through the native clip reader. */
function nativeClip(path: string, name: string, decompress: Decompress): { tracks: ClipTracks; type: string } | null {
  if (!existsSync(path)) return null;
  const clip = decodeAnimClip(new Uint8Array(readFileSync(path)), name, decompress);
  return clip ? { tracks: clipTracksFromKeys(clip.duration, clip.trackKeys, clip.constTrackKeys), type: clip.animationType } : null;
}

export function loadClips(paths: ReturnType<typeof intakePaths>, decompress: Decompress): OracleClips {
  const expressions = new Map<string, { tracks: ClipTracks; type: string }>();
  if (existsSync(paths.photomode)) {
    const bytes = new Uint8Array(readFileSync(paths.photomode));
    for (const info of readAnimSetIndex(bytes).clips) {
      if (!info.name.startsWith("facial_")) continue;
      const clip = decodeAnimClip(bytes, info.name, decompress);
      if (clip) expressions.set(info.name, { tracks: clipTracksFromKeys(clip.duration, clip.trackKeys, clip.constTrackKeys), type: clip.animationType });
    }
  }
  return { blink: nativeClip(paths.additives, "additive__blink_normal__01", decompress)?.tracks,
    idle: nativeClip(paths.uiFace, "ui_closeup_shot", decompress)?.tracks, idleEyes: nativeClip(paths.uiFace, "ui_closeup_shot_eyes", decompress)?.tracks,
    expressions };
}

/** Run the oracle over `cases` (batches of at most 256 frames) and write the fixture. */
export async function generateFixture(options: { dir: string; cases: OracleCase[]; rigJson: string; setupJson: string; addon: string; python: string;
  guard: string; tracks: number; joints: number; label: string }): Promise<void> {
  const script = join(AUTHORING, "tools", "facial_solver_server.py");
  const child = Bun.spawn([options.python, options.guard, "--limit", "1", "--", options.python, script, "--addon", options.addon, "--rig", options.rigJson,
    "--setup", options.setupJson], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  const reader = child.stdout.getReader(), decoder = new TextDecoder();
  let buffer = "";
  const line = async (): Promise<Record<string, unknown>> => {
    for (;;) {
      const at = buffer.indexOf("\n");
      if (at >= 0) {
        const text = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1);
        if (!text) continue;
        try { return JSON.parse(text) as Record<string, unknown>; } catch { console.error(`oracle: ${text.slice(0, 200)}`); continue; }
      }
      const { value, done } = await reader.read();
      if (done) throw Error("The oracle stopped.");
      buffer += decoder.decode(value, { stream: true });
    }
  };
  const ready = await line();
  if (ready.ready !== true) throw Error(`The oracle didn't start: ${String(ready.error)}`);
  const frames = options.cases.flatMap(item => item.frames), T = options.tracks, J = options.joints, F = frames.length;
  const inputs = new Float32Array(F * T), q = new Float32Array(F * J * 4), t = new Float32Array(F * J * 3), o = new Float32Array(F * T);
  frames.forEach((frame, i) => inputs.set(frame, i * T));
  const f32 = (text: unknown) => { const b = Buffer.from(String(text), "base64"); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  let ms = 0;
  for (let start = 0, id = 1; start < F; start += 256, id++) {
    const batch = frames.slice(start, start + 256);
    child.stdin.write(JSON.stringify({ id, outputs: true, frames: batch.map(frame => Array.from(frame)) }) + "\n");
    await child.stdin.flush();
    const answer = await line();
    if (answer.id !== id || typeof answer.error === "string") throw Error(`The oracle refused batch ${id}: ${String(answer.error)}`);
    q.set(f32(answer.q), start * J * 4); t.set(f32(answer.t), start * J * 3); o.set(f32(answer.o), start * T);
    ms += Number(answer.ms);
  }
  child.stdin.end();
  await child.exited;
  mkdirSync(options.dir, { recursive: true });
  let at = 0;
  const index: FixtureIndex = { setup: options.label, rig: "h0_000_pwa_c__basehead_skeleton.rig", tracks: T, joints: J,
    cases: options.cases.map(item => { const entry = { group: item.group, name: item.name, start: at, count: item.frames.length }; at += item.frames.length; return entry; }) };
  writeFileSync(join(options.dir, "cases.json"), JSON.stringify({ ...index, oracleMs: Math.round(ms), frames: F }, null, 1));
  for (const [name, data] of [["inputs.f32", inputs], ["q.f32", q], ["t.f32", t], ["o.f32", o]] as const) writeFileSync(join(options.dir, name), new Uint8Array(data.buffer));
  console.log(`${options.label}: ${options.cases.length} cases, ${F} frames; oracle solve time ${Math.round(ms)} ms.`);
}

export function printReport(label: string, reports: GroupReport[]) {
  console.log(`\n${label}`);
  for (const g of reports) {
    const pass = g.passed === g.cases ? "PASS" : "FAIL";
    console.log(`  ${g.group}: ${g.passed}/${g.cases} cases (${g.frames} frames) ${pass}; worst rotation ${g.worst.rotation.toExponential(2)} rad, translation ${g.worst.translation.toExponential(2)} m, tracks ${g.worst.tracks.toExponential(2)}`);
    for (const failure of g.failures.slice(0, 6)) console.log(`      ${failure}`);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => { const at = args.indexOf(name); if (at < 0) return null; const value = args[at + 1]; args.splice(at, 2); return value ?? null; };
  const generate = args.includes("--generate");
  const fixture = resolve(flag("--fixture") ?? DEFAULT_FIXTURE), intake = resolve(flag("--intake") ?? join(primaryCheckout(), "research", "consumers"));
  const game = flag("--game") ?? configuredGameRoot(), report = flag("--report");
  const paths = intakePaths(intake);
  const oodle = loadGameOodle(game);
  const compile = (setupPath: string, setupJson: string): { rig: CompiledFacialRig; setupRoot: unknown } => {
    const nativeRig = existsSync(paths.rig), nativeSetup = existsSync(setupPath);
    const rigDoc = nativeRig ? nativeDocument(paths.rig, oodle.decompress) : JSON.parse(readFileSync(paths.rigJson, "utf8"));
    const setupDoc = nativeSetup ? nativeDocument(setupPath, oodle.decompress) : JSON.parse(readFileSync(setupJson, "utf8"));
    console.log(`Compiling from ${nativeRig && nativeSetup ? "XF Studio's own reading of the game files" : "WolvenKit JSON"}.`);
    return { rig: compileFacialRig(rigDoc, setupDoc), setupRoot: (setupDoc as { Data: { RootChunk: unknown } }).Data.RootChunk };
  };
  const female = compile(paths.setup, paths.setupJson), male = existsSync(paths.maleSetup) || existsSync(paths.maleSetupJson) ? compile(paths.maleSetup, paths.maleSetupJson) : null;
  if (generate) {
    const { locateFacialSolver } = await import("../src/facial-host");
    const python = process.env.XFS_PYTHON || join(process.env.LOCALAPPDATA ?? "", "Python", "pythoncore-3.14-64", "python.exe");
    const location = locateFacialSolver({ env: { ...process.env, XFS_PYTHON: python, XFS_FACIAL_SOLVER_ORACLE: "1" }, repoRoot: primaryCheckout(),
      script: join(AUTHORING, "tools", "facial_solver_server.py") });
    if (!("addon" in location)) { console.error("The IO Suite checkout or Python wasn't found (XFS_FACIAL_SOLVER, XFS_PYTHON)."); process.exit(2); }
    const guard = join(primaryCheckout(), "tools", "memory_guard.py");
    const clips = loadClips(paths, oodle.decompress);
    const cases = buildCases(female.rig, female.setupRoot, clips);
    await generateFixture({ dir: join(fixture, "female"), cases, rigJson: paths.rigJson, setupJson: paths.setupJson, addon: location.addon, python: location.python,
      guard, tracks: female.rig.trackNames.length, joints: female.rig.jointNames.length, label: "h0_000_pwa_c__basehead_rigsetup.facialsetup" });
    if (male && existsSync(paths.maleSetupJson))
      await generateFixture({ dir: join(fixture, "male"), cases: maleCases(male.rig, male.setupRoot, clips), rigJson: paths.rigJson, setupJson: paths.maleSetupJson,
        addon: location.addon, python: location.python, guard, tracks: male.rig.trackNames.length, joints: male.rig.jointNames.length, label: "h0_001_ma_c__player_rigsetup.facialsetup" });
  }
  const results: Record<string, GroupReport[]> = {};
  for (const [name, compiled] of [["female", female], ["male", male]] as const) {
    const data = compiled && readFixture(join(fixture, name));
    if (!compiled || !data) { console.log(`No ${name} fixture at ${join(fixture, name)}; run with --generate.`); continue; }
    results[name] = compareFixture(compiled.rig, data);
    printReport(`${name} (${data.index.setup}), tolerances ${TOLERANCE.rotation} rad / ${TOLERANCE.translation} m / ${TOLERANCE.tracks}`, results[name]!);
  }
  if (report) writeFileSync(report, JSON.stringify({ tool: "facial-solver-oracle", tolerance: TOLERANCE, results }, null, 2) + "\n");
  process.exit(Object.values(results).flat().every(g => g.passed === g.cases) ? 0 : 1);
}

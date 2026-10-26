// Schema 3 session scripts: rows with verdicts, run unattended on top of the plan module (testing/plan.ts).
//
// A script is setup steps, a list of rows and teardown steps. Each row has an id, a title, requirements, steps (plan
// steps: retry, alternatives, branches, fallback and deadlines), pass checks and cleanup steps, and ends with one
// verdict: PASS, CAPTURED, FAIL, PARTIAL or SKIP(reason), with its evidence files. CAPTURED is a row judged by someone
// else (judged_by, XF · Studio's UI review): its state checks and captures held, and it awaits that review; such a
// row is never PASS on a capture's existence. One row's failure never stalls the batch: a
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
import { dirname, join, relative } from "node:path";
import { findCommand } from "../api/catalogue.ts";
import type { CommandApi } from "../api/command-api.ts";
import { decodePng, diffStats, crop } from "../capture/image.ts";
import { validateBound } from "./assertions.ts";
import { ConfigEditor, readIni, stagedConfigPath, stagedManifestPath, type IniValues } from "./config-ini.ts";
import { burstBytes, cetLineRect, cetWindowRect, decodeCetBinding, inkPanelRect, keysLabel, parseCetBindings, parseKeys, xfBoxRect, type Host } from "./host.ts";
import { BURST_MEMORY_LIMIT } from "../capture/capture.ts";
import { checkMatch, checkPlan, describePlan, matches, realClock, resolveRefs, runPlan, type Action, type ExecContext, type Executor, type Match, type Outcome, type Plan, type PlanClock, type PlanResult, type ReportEntry, type Step } from "./plan.ts";
import { planTestStep, TEST_STEP_KINDS, TestSession } from "./script.ts";
import { captureCursor, waitForEvent } from "./windows.ts";
import { tripReason } from "../commit-tripwire.ts";
import { scriptHash } from "./loop.ts";
import { ALL_CHANNELS, DEFAULT_HALT_PATTERNS, Telemetry, earlierSummaries, mergeSummaries, type RowTelemetry } from "./telemetry.ts";

export const SCRIPT_SCHEMA_3 = "xfb/session-script-3";
export const REPORT_SCHEMA_3 = "xfb/session-report-3";

/** What a row needs. config: a staged config.ini key (the runner sets it); binding: a CET binding (equals: a key chord); fixture: a private value. */
/**
 * What a row needs before it runs. A fixture requirement with equals needs that exact value (an opt-in flag:
 * equals true, so false or absent never opts in); without equals, the fixture must be given (not absent, null or false).
 */
export type Requirement = { config?: string; equals?: string | boolean | number; binding?: string; fixture?: string; note?: string };
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
  /** This row's own halt kinds, instead of the batch's ([] for none). */
  halt_on?: string[];
  /** Values the row's record and the report list (a recorder run id, a distance): {label, ref}. */
  facts?: { label: string; ref: string }[];
  /**
   * whole-batch: the row owns no session time. It is judged at the end, over the batch's always-on telemetry
   * ($telemetry: every channel's records and invalid samples, the gaps, the coverage loss, the rows they fell in),
   * after the last row and before the teardown; its steps only read and compute.
   */
  passive?: "whole-batch";
  /** The row's expected span in seconds (a player's free roam, a soak), for the recorder-lifetime warning. */
  expected_s?: number;
  /** The row needs the player (an ask it waits on): allowed only when marked, and the preflight lists it. */
  manual?: boolean;
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
  /** Which significant bugs stop the batch early (see HALT_KINDS; --halt-on overrides). */
  halt_on?: string[];
  /** More plugin log patterns (regular expressions) that count as a draw_call halt. */
  halt_patterns?: string[];
};
export type Verdict = "PASS" | "CAPTURED" | "FAIL" | "PARTIAL" | "SKIP";
/** A verdict that counts as done (nothing to re-run): PASS, or CAPTURED awaiting its review. */
export const DONE_VERDICTS: ReadonlySet<Verdict> = new Set(["PASS", "CAPTURED"]);

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
  "ink.rect": { required: ["events", "window"], optional: ["margin"], help: "the ink panel's rectangle in window pixels, from the last laid-out ink_tree event of an events window (panel_rect in the root's units, root_px and screen); value {x, y, width, height}" },
  "capture.surface": { required: ["plate", "text"], optional: ["capture", "rect", "name", "route", "min_plate", "min_text", "tolerance", "plate_alt", "luma_rule"],
    help: "is a themed surface in frame: the share of its plate and text colours in an area, in a capture, every frame of a burst, or a fresh probe capture (name); fails surface_missing" },
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
  pick: { required: ["from"], optional: ["where", "index"], help: "an element of a list (a bound result's array) that matches where, the index-th such (default 0); value the element" },
  "bridge.candidate": { required: [], optional: [], help: "does the running bridge match the staged candidate (its build commit, dirty flag and version against the staged manifest, its allow_writes and write classes against the staged config.ini); value {matches, mismatches}" },
  stamp: { required: [], optional: [], help: "the wall-clock time now; value {ms} (milliseconds since the epoch, as a burst's frames are timed)" },
  "burst.covers": { required: ["burst", "times"], optional: [], help: "whether every wall-clock time (stamp ms) falls between a burst's first and last frame; value {covers, first_ms, last_ms, outside}" },
  "host.windows_animations": { required: [], optional: [], help: "Windows' own Animation effects setting (SPI_GETCLIENTAREAANIMATION), read, never changed; value {on}" },
  "recorder.span": { required: ["run"], optional: [], help: "a recorder run's span from the v channel: V's distance travelled over every catch-up page" },
  "overlay.restore": { required: [], optional: [], help: "put the overlay's live look back as this game session started it (the first overlay.set's undo)" },
};

type Rgb = [number, number, number];

/**
 * How much of an area is a themed surface's plate colour and its text colour (each channel within tolerance), and
 * whether that makes the surface present. A UI plate is a large flat area of one colour with text in another; a game
 * scene behind an empty area is neither (the review packet's empty burst frames). The defaults (within 7 per channel,
 * at least 15 % of the area) separate every scripted-session-1 frame with its surface (XF box 19-36 %, CET window
 * 29-78 %) from every frame without it (at most 12 %); the CET line's crop is mostly scene, so its rows pass their own
 * min_plate (dark 0.18, light 0.03). Text is measured and reported, and required only when min_text says so.
 */
/** A brightness rule for a translucent surface whose plate never matches its theme colour exactly (the CET line: its plate
 * blends with the scene behind it). light_text: the share of greyish pixels at least as bright as light text (luma >= 150,
 * channel spread <= 45); light_plate: the share of a cream plate (luma >= 215, spread <= 30). Calibrated on the ST8 frames
 * of scripted session 1 and the ST re-runs at the CET line's crop: dark, 0.00 % without the line and 0.43-0.92 % with it;
 * light, a 0.2 % cream plate without it and 12-43 % with it. */
export type LumaRule = { kind: "light_text" | "light_plate"; min: number };
export function surfaceStats(pixels: { width: number; height: number; rgb: Uint8Array }, o: { plate: Rgb; plateAlt?: Rgb[]; text: Rgb; tolerance?: number; minPlate?: number; minText?: number; lumaRule?: LumaRule }) {
  const tol = o.tolerance ?? 7, textTol = tol * 2;
  let plate = 0, text = 0, luma = 0;
  const n = pixels.width * pixels.height;
  // plate_alt: colours that count as the surface too (the ink panel's answers are yellow, or red while they flash).
  const plates = [o.plate, ...(o.plateAlt ?? [])];
  for (let i = 0; i < n; i++) {
    const r = pixels.rgb[i * 3], g = pixels.rgb[i * 3 + 1], b = pixels.rgb[i * 3 + 2];
    if (o.lumaRule) {
      const l = (r + g + b) / 3, spread = Math.max(r, g, b) - Math.min(r, g, b);
      if (o.lumaRule.kind === "light_text" ? l >= 150 && spread <= 45 : l >= 215 && spread <= 30) luma++;
    }
    if (plates.some((c) => Math.abs(r - c[0]) <= tol && Math.abs(g - c[1]) <= tol && Math.abs(b - c[2]) <= tol)) plate++;
    else if (Math.abs(r - o.text[0]) <= textTol && Math.abs(g - o.text[1]) <= textTol && Math.abs(b - o.text[2]) <= textTol) text++;
  }
  const plate_fraction = n ? plate / n : 0, text_fraction = n ? text / n : 0, luma_fraction = n ? luma / n : 0;
  const present = o.lumaRule ? luma_fraction >= o.lumaRule.min : plate_fraction >= (o.minPlate ?? 0.15) && text_fraction >= (o.minText ?? 0);
  return { plate_fraction: Math.round(plate_fraction * 10000) / 10000, text_fraction: Math.round(text_fraction * 100000) / 100000, ...(o.lumaRule ? { luma_fraction: Math.round(luma_fraction * 100000) / 100000, luma_rule: o.lumaRule.kind } : {}), present };
}

/**
 * The ink panel's rectangle in the game window's pixels, from the panel's own report: the last laid-out ink_tree event
 * (redscript XFRuntimeBridgePhotoPanel Tree: panel_rect is left, top, width, height in the root's units; root_size the
 * root's size in those units; root_px its corners in the global ink space, which spans screen), with a margin.
 */
export function inkRect(action: Record<string, unknown>): { ok: boolean; code?: string; message?: string; value?: unknown } {
  type Tree = { when?: string; panel_rect?: number[]; root_size?: number[]; root_px?: number[]; screen?: number[]; showing?: boolean };
  const events = ((action.events as { events?: { kind?: string; data?: Tree }[] } | undefined)?.events ?? []).filter((e) => e.kind === "ink_tree" && e.data?.when === "laid_out");
  const win = action.window as { width?: number; height?: number } | undefined;
  const tree = events.at(-1)?.data;
  if (!tree || !win?.width || !win.height) return { ok: false, code: "no_layout", message: "No laid-out ink_tree event in the window (the panel didn't report where it went)." };
  const [l, t, w, h] = tree.panel_rect ?? [], [rw, rh] = tree.root_size ?? [], [x1, y1, x2, y2] = tree.root_px ?? [];
  if (![l, t, w, h, rw, rh, x1, y1, x2, y2].every((v) => typeof v === "number" && Number.isFinite(v)) || rw <= 0 || rh <= 0 || w <= 0 || h <= 0) return { ok: false, code: "no_layout", message: "The ink_tree event lacks the panel's rectangle." };
  if (tree.showing === false) return { ok: false, code: "panel_hidden", message: "The ink panel reports it isn't showing." };
  const [sx, sy] = tree.screen ?? [];
  const kx = (typeof sx === "number" && sx > 0 ? win.width / sx : 1), ky = (typeof sy === "number" && sy > 0 ? win.height / sy : 1);
  const ux = (x2 - x1) / rw, uy = (y2 - y1) / rh;
  const margin = Number(action.margin ?? 16);
  const left = Math.max(0, Math.floor((x1 + l * ux) * kx - margin)), top = Math.max(0, Math.floor((y1 + t * uy) * ky - margin));
  const right = Math.min(win.width, Math.ceil((x1 + (l + w) * ux) * kx + margin)), bottom = Math.min(win.height, Math.ceil((y1 + (t + h) * uy) * ky + margin));
  if (right - left < 8 || bottom - top < 8) return { ok: false, code: "off_screen", message: "The ink panel's reported rectangle is off the window." };
  return { ok: true, value: { x: left, y: top, width: right - left, height: bottom - top } };
}

/** The largest game window the bursts are planned for (3840 x 1600, the maintainer's ultrawide). */
const NOMINAL_WINDOW = { width: 3840, height: 1600 };

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
      if (kind === "burst" || command === "capture.burst") {
        const burst = (kind === "run" ? action.input : action) as { rect?: unknown; rect_normalized?: unknown; region?: string; frames?: number } | undefined;
        const frames = Number(burst?.frames ?? 10);
        const literal = burst?.rect && typeof burst.rect === "object" ? (burst.rect as { width: number; height: number }) : undefined;
        const uncropped = !burst?.rect && !burst?.rect_normalized && (!burst?.region || burst.region === "full");
        const at = literal ?? (uncropped ? NOMINAL_WINDOW : undefined);
        if (at && burstBytes(at, frames) > BURST_MEMORY_LIMIT) problems.push(`${where}: this burst would hold ${Math.round(burstBytes(at, frames) / 1048576)} MB (${at.width}x${at.height}, ${frames} frames; the cap is ${BURST_MEMORY_LIMIT / 1048576} MB): crop it to the surface it judges (host.window's regions)`);
      }
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
  const allowed = new Set(["schema", "name", "title", "card", "requires", "fixtures", "setup", "rows", "teardown", "halt_on", "halt_patterns"]);
  try { parseHaltOn(script?.halt_on); } catch (error) { problems.push(String((error as Error).message).replace("--halt-on", "halt_on")); }
  for (const pattern of script?.halt_patterns ?? []) { try { new RegExp(pattern); } catch { problems.push(`halt_patterns: ${pattern} isn't a regular expression`); } }
  for (const key of Object.keys(script ?? {})) if (!allowed.has(key)) problems.push(`script: unknown field ${key}`);
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(script?.name ?? "")) problems.push("name must be 1-60 letters, digits, '.', '_' or '-'");
  if (!Array.isArray(script?.rows) || !script.rows.length) return { setup: { id: "setup", steps: [] }, rows: [], teardown: { id: "teardown", steps: [] }, problems: [...problems, "rows must be a non-empty list"] };
  const known = new Set(["fixture", "board", "cast", "recorder", "telemetry", ...bindNames(script)]);
  const checker = makeActionChecker(known);
  const plan = (id: string, steps: SessionStep[] | undefined, extra: Partial<Plan> = {}, failRow = new Set<string>()) => {
    const p: Plan = { id, steps: toPlanSteps(steps, failRow, id, problems), ...extra };
    for (const problem of checkPlan(p, checker)) problems.push(`${id}: ${problem}`);
    return p;
  };
  const setup = plan("setup", script.setup);
  if (JSON.stringify([script.setup ?? [], script.teardown ?? []]).includes('"do":"ask"')) problems.push("setup and teardown never ask the player (only a row marked manual: true may)");
  const ids = new Set<string>();
  const names = new Map<string, string>();
  const rows = script.rows.map((row, i) => {
    const where = `row ${i + 1}${row?.id ? ` (${row.id})` : ""}`;
    if (!row || typeof row !== "object") { problems.push(`${where}: a row must be an object`); return { row, plan: { id: "x", steps: [] }, failRow: new Set<string>() }; }
    for (const key of Object.keys(row)) if (!["id", "title", "requires", "steps", "pass", "cleanup", "deadline_ms", "judged_by", "after", "halt_on", "facts", "passive", "expected_s", "manual"].includes(key)) problems.push(`${where}: unknown field ${key}`);
    for (const fact of row.facts ?? []) {
      if (typeof fact?.label !== "string" || typeof fact.ref !== "string" || !fact.ref.startsWith("$")) problems.push(`${where}: a fact is {label, ref: "$binding.path"}`);
      else if (!known.has(fact.ref.slice(1).split(".")[0])) problems.push(`${where}: fact ${fact.label} reads ${fact.ref}, which no step binds`);
    }
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
    if (row.passive !== undefined && row.passive !== "whole-batch") problems.push(`${where}: passive is whole-batch`);
    // No row may need the player unless it says so: an ask waits for a person.
    if (row.manual !== true && JSON.stringify([row.steps ?? [], row.cleanup ?? []]).includes('"do":"ask"')) problems.push(`${where}: an ask waits for the player: show the question without waiting (run ui.message), or mark the row manual: true`);
    // A recorder's lifetime is always the script's choice: the bridge's default (60 s) cut scripted session 1's free roam short.
    for (const start of JSON.stringify(row.steps ?? []).match(/\{"do":"run","command":"test\.record\.start","input":\{[^}]*\}/g) ?? []) {
      if (!/"duration_s":/.test(start)) problems.push(`${where}: test.record.start sets duration_s (the bridge's default is 60 s): size it to the row's expected span, at most 1800`);
    }
    if (row.expected_s !== undefined && !(typeof row.expected_s === "number" && row.expected_s > 0 && row.expected_s <= 24 * 3600)) problems.push(`${where}: expected_s is the row's expected span in seconds`);
    if (row.passive && JSON.stringify(row.steps ?? []).match(/"do":"(?!set|wait|note)[^"]+"/)) problems.push(`${where}: a whole-batch passive row only reads and computes (set, wait, note)`);
    if (row.halt_on !== undefined) { try { parseHaltOn(row.halt_on.length ? row.halt_on : ["none"]); } catch (error) { problems.push(`${where}: ${String((error as Error).message).replace("--halt-on", "halt_on")}`); } }
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
  // The runner's own steps (the prelude in both load modes, the built-in teardown) meet the same checks as the script's.
  for (const steps of [preludeSteps({ "overlay.enabled": "true" }, true, true), preludeSteps({}, true, false), builtinTeardown()]) {
    for (const problem of checkPlan({ id: "runner", steps }, checker)) problems.push(`the runner's own steps: ${problem}`);
  }
  return { setup, rows, teardown, problems };
}

// ---- The prelude: config and the game's lifecycle, as plan data --------------------------------------------

/** Config keys a row requires that differ from the values given. */
export function configNeeds(row: Row, values: IniValues): Record<string, string> {
  const needs: Record<string, string> = {};
  for (const need of row.requires ?? []) if (need.config && values[need.config] !== String(need.equals)) needs[need.config] = String(need.equals);
  return needs;
}

/** Phases in which the game has finished starting (the main menu, or a world). */
export const BOOTED_PHASES = ["main_menu", "gameplay", "menu", "paused", "photo_mode", "character_menu"];
/** What a starting game answers before it is ready: waited through, never a reason to stop. */
export const STILL_STARTING = ["game_not_running", "timeout", "busy", "bridge_busy", "game_loading", "rate_limited", "not_ready"];
export const LAUNCH_BLOCKED = "MO2 cannot launch the game; inspect the new Windows error in mo_interface.log.";

/** Launch through MO2 and wait for the game's process; MO2's "Cannot launch program" dialog fails at once. */
export function startSteps(): Step[] {
  return [
    { label: "launch", do: "host.launch", outcomes: [{ name: "already_running", match: { code: "already_running" }, result: "ok" }] },
    { label: "process", do: "host.running", until: { any: [{ path: "running", equals: true }, { path: "launch_blocked", exists: true }] }, interval_ms: 2000, deadline_ms: 120_000,
      outcomes: [{ name: "launch_blocked", match: { path: "launch_blocked", exists: true }, result: "fail" }] },
  ] as Step[];
}

/**
 * A running game made ready, whoever launched it (so a next attempt adopts a healthy game): the bridge answering,
 * the game past its start (the main menu or a world, up to 240 s, pressing past a start screen if it waits there),
 * then (with load) the save loaded from the main menu (a game that hasn't finished starting is waited for and
 * retried, never a stop), the press-any-key prompt passed, and normal play.
 */
export function readySteps(load: boolean): Step[] {
  const status = { do: "run", command: "game.status", input: {} };
  const booted = (deadline: number) => ({ do: "run", command: "game.status", input: {}, until: { path: "phase", one_of: BOOTED_PHASES }, interval_ms: 2500, deadline_ms: deadline, bind: "boot" });
  const loadRetry = { times: 12, backoff_ms: 3000, factor: 1.5, max_backoff_ms: 15_000, on: { code: STILL_STARTING } };
  return [
    { label: "bridge", do: "run", command: "bridge.ping", input: {}, until: { ok: true }, interval_ms: 2000, deadline_ms: 180_000 },
    { label: "booted", ...booted(240_000),
      alternatives: [[
        { do: "host.key", keys: "Space", on_fail: "continue" },
        booted(60_000),
      ]] },
    ...(load
      ? [
          { label: "load", do: "run", command: "game.load", input: { name: "$fixture.save", discard_unsaved: true, continue_wait_s: 85 }, bind: "load", deadline_ms: 150_000,
            when: { check: status, match: { path: "phase", equals: "main_menu" } },
            retry: loadRetry,
            alternatives: [[{ do: "run", command: "game.load", input: { latest: true, discard_unsaved: true, continue_wait_s: 85 }, bind: "load", deadline_ms: 150_000, retry: loadRetry }]] },
          { label: "press-any-key", do: "host.key", keys: "Space", when: { check: status, match: { path: "prompt_state", equals: "initial_continue" } },
            retry: { times: 5, backoff_ms: 3000, on: { code: "not_foreground" } },
            outcomes: [{ name: "behind", match: { code: "not_foreground" }, run: [{ do: "note", text: "The game isn't in front, so the runner can't press past the start prompt: click into the game (or press Space)." }] }],
            on_fail: "continue" as const },
          { label: "gameplay", do: "run", command: "game.wait", input: { phase: "gameplay", timeout_ms: 180_000 }, deadline_ms: 190_000 },
        ]
      : []),
  ] as Step[];
}

/** Launch through MO2, then make the game ready (readySteps). */
export function launchSteps(load: boolean): Step[] {
  return [...startSteps(), ...readySteps(load)];
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
    // A running game is adopted only if its bridge is the staged candidate (a --loop restage may have replaced the
    // build, or config.ini, since it started): otherwise it closes, and the start below launches the staged one.
    { label: "candidate", when: { check: { do: "host.running" }, match: { path: "running", equals: true } }, sequence: [
      { label: "candidate-bridge", do: "run", command: "bridge.ping", input: {}, until: { ok: true }, interval_ms: 2000, deadline_ms: 120_000, on_fail: "continue" },
      { label: "candidate-check", do: "bridge.candidate", on_fail: "continue", outcomes: [
        { name: "nothing_staged", match: { code: "no_candidate" }, result: "ok" },
        { name: "stale", match: { path: "matches", equals: false }, run: [
          { do: "note", text: "The running game's bridge isn't the staged candidate (an earlier build or settings): the runner restarts it." },
          ...closeSteps(),
        ] },
      ] },
    ] },
    ...(changes ? [{ label: "config", do: "config.set", values: needs }] : []),
    ...(changes || restart ? [{ label: "restart", sequence: [...closeSteps(), ...startSteps()], when: { check: { do: "host.running" }, match: { path: "running", equals: true } } }] : []),
    { label: "start", sequence: startSteps(), when: { check: { do: "host.running" }, match: { path: "running", equals: false } } },
    // Always: a game that is already running (an earlier attempt's, or the player's) is adopted and made ready.
    ...readySteps(load),
  ] as Step[];
}

/** The built-in teardown, after the script's own: every step best effort. */
export function builtinTeardown(): Step[] {
  return [
    { label: "supervisor", do: "run", command: "supervisor.clear", input: {}, on_fail: "continue" },
    { label: "recorder", do: "run", command: "test.record.stop", input: {}, on_fail: "continue" },
    { label: "actors", do: "actors.release_all", on_fail: "continue" },
    { label: "overlay", do: "overlay.restore", on_fail: "continue" },
    { label: "messages", do: "run", command: "ui.message", input: { clear: true }, on_fail: "continue" },
    { label: "ink-panel", do: "run", command: "ui.hud", input: { reset: true }, on_fail: "continue" },
    { label: "photo-mode", do: "run", command: "photo.exit", input: {}, when: { check: { do: "run", command: "game.status", input: {} }, match: { path: "phase", equals: "photo_mode" } }, on_fail: "continue" },
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

// ---- The commit monitor ----------------------------------------------------------------------------------

/**
 * The commit tripwire, owned by the batch: it reads the machine's free commit every everyMs on its own loop (so a
 * long action can't hide a fall), and under the floor hands the game over once (session.handover), records the
 * reason and aborts its signal, which the batch's plans run under, so active work stops. stop() ends it before the
 * teardown, so no reading during cleanup can gate the restore.
 */
export class CommitMonitor {
  reason: string | undefined;
  lastFreeGb: number | null = null;
  private readonly trip = new AbortController();
  private readonly halt = new AbortController();
  private loop: Promise<void> | undefined;
  constructor(private readonly o: { host: Host; api: Pick<CommandApi, "run">; clock: PlanClock; floorGb: number; everyMs: number }) {}
  get signal() {
    return this.trip.signal;
  }
  start() {
    this.loop ??= (async () => {
      while (!this.halt.signal.aborted && !this.reason) {
        const free = await this.o.host.freeCommitBytes().catch(() => null);
        if (this.halt.signal.aborted) break;
        this.lastFreeGb = free === null ? null : free / GB;
        if (free !== null && free < this.o.floorGb * GB) {
          this.reason = `The commit tripwire tripped: free commit ${(free / GB).toFixed(1)} GB is under the ${this.o.floorGb} GB floor. The runner handed the game over (session.handover) and stopped.`;
          // The tripwire's own words (commit-tripwire.ts), so every refusal the handover causes names it.
          await this.o.api.run("session.handover", { note: tripReason(free / GB, this.o.floorGb) }, { source: "session" }).catch(() => undefined);
          this.trip.abort();
          break;
        }
        await this.o.clock.sleep(this.o.everyMs, this.halt.signal);
      }
    })();
    return this;
  }
  async stop() {
    this.halt.abort();
    await this.loop;
  }
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
  /**
   * A second, observational API for captures that leave the overlay alone (clear_overlay false): its lifetime is
   * its own, so a session.handover in the same beat (which supersedes the writer's in-flight work) can't cancel
   * the burst recording it.
   */
  observer?: Pick<CommandApi, "run">;
};

const GB = 1024 ** 3;
/**
 * A refusal that says to wait ("Wait for its npc.spawned event and try again", "try again in a moment"): the state it
 * names is on its way, so the runner waits and retries the same command (1 s, then 2 s apart, for at most 15 s and
 * never past the step's deadline) before the step sees a failure.
 */
export const WAIT_AND_RETRY = /\bwait for\b|\btry again in a moment\b|\bwait a moment\b|\bin a few frames\b/i;
const WAIT_AND_RETRY_MS = 15_000;
const CANCELLED: Outcome = { ok: false, code: "cancelled", message: "The step was cancelled before its side effect." };
const HANDED_OVER = "The game was handed to the player (session.handover: the commit tripwire, the player or another tool), so every change is refused until session.resume. The batch stopped here.";

/** Executes plan actions for the session runner; keeps each row's evidence and every refused key press. */
export class SessionExecutor implements Executor {
  testing: TestSession;
  evidence: string[] = [];
  refusals: { at: string; keys: string; reason: string }[] = [];
  stopReason: string | undefined;
  private rowDir: string;
  /** The batch's commit monitor (set by runBatch): a trip refuses every further action. */
  monitor?: CommitMonitor;
  /** Run before each launch (the batch keeps the plugin logs so far: a new game session starts a new log). */
  beforeLaunch?: () => void;

  /** Every API path the executor takes (commands, schema-2 steps, questions, releases) goes through this, so a handed_over refusal is seen on any of them. */
  private readonly api: Pick<CommandApi, "run">;
  private handedOver = false;
  /** The overlay's look as this game session started it: each key from the first overlay.set that changed it. */
  private overlayUndo: Record<string, unknown> = {};

  constructor(private readonly c: BatchContext, script: BatchScript) {
    this.api = {
      run: (async (name: string, input: unknown, options?: Parameters<CommandApi["run"]>[2]) => {
        const out = await c.api.run(name, input, options);
        if (!out.ok && out.error.code === "handed_over") this.handedOver = true;
        return out;
      }) as CommandApi["run"],
    };
    this.testing = new TestSession(this.api, { ...script, fixtures: c.fixtures } as never, c.outDir, false, c.clock);
    this.rowDir = c.outDir;
  }

  /** The teardown's start: earlier stops no longer gate actions (each teardown step is tried and recorded). */
  clearStops() {
    this.stopReason = undefined;
    this.handedOver = false;
    // The stopped commit monitor is detached too: its trip stays on the batch's halt (the report), and must not refuse the
    // teardown's own steps.
    this.monitor = undefined;
  }

  get bindings() {
    return this.testing.bindings as Record<string, unknown>;
  }

  startRow(id: string) {
    this.evidence = [];
    this.rowDir = join(this.c.outDir, id);
    mkdirSync(this.rowDir, { recursive: true });
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
    const outcome = await this.perform(action, context);
    if (this.handedOver && !outcome.halt) {
      this.stopReason ??= HANDED_OVER;
      return { ...outcome, ok: false, code: "handed_over", message: outcome.message ?? HANDED_OVER, halt: HANDED_OVER };
    }
    return outcome;
  }

  private async perform(action: Action, context: ExecContext): Promise<Outcome> {
    const tripped = this.stopReason ?? this.monitor?.reason;
    if (tripped) return { ok: false, code: "tripwire", message: tripped, halt: tripped };
    const kind = action.do;
    try {
      if (TEST_STEP_KINDS.has(kind)) {
        // Schema-2 steps resolve and checkpoint their own references (cursors advance in place).
        const result = await this.testing.execute({ ...context.raw, label: context.step, ...(context.bind ? { bind: context.bind } : { bind: `step_${context.step.replace(/[^A-Za-z0-9]/g, "_")}` }) }, context.signal);
        // A wait that ended says how: its deadline (timeout), or early (the question withdrawn, the history incomplete,
        // a refusal), which is not the same thing as nobody answering.
        if (!result.ok && (kind === "await" || kind === "events")) {
          const window = result.result as { timed_out?: boolean; aborted?: boolean; complete?: boolean; cursor?: { missing?: string[] } } | undefined;
          const why = window?.cursor?.missing?.join("; ");
          if (window?.timed_out) return { ok: false, code: "timeout", message: "The wait reached its deadline with nothing matching.", value: window };
          if (window?.aborted) return { ok: false, code: "cancelled", message: "The wait was cancelled.", value: window };
          return { ok: false, code: "wait_ended_early", message: `The wait ended before its deadline${why ? ` (${why})` : " (the question was withdrawn, or the bridge refused the wait)"}.`, value: window };
        }
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
        case "capture.surface":
          return await this.surface(action, context);
        case "host.running": {
          const pid = await this.gamePid();
          // A launch failure's current log diagnosis ends the wait; don't guess antivirus from the dialog's title.
          const blocked = pid === undefined ? await this.c.host.launchBlocked().catch(() => null) : null;
          return { ok: !blocked, ...(blocked ? { code: "launch_blocked", message: blocked } : {}), value: { running: pid !== undefined, ...(pid !== undefined ? { pid } : {}), ...(blocked ? { launch_blocked: blocked } : {}) } };
        }
        case "host.launch": {
          const mo2 = this.c.fixtures.mo2 as { exe?: string; profile?: string; executable?: string; arguments?: string } | undefined;
          if (!mo2?.exe || !mo2.profile || !mo2.executable) return { ok: false, code: "fixture_missing", message: "The fixtures file needs mo2.exe, mo2.profile and mo2.executable to launch the game." };
          if ((await this.gamePid()) !== undefined) return { ok: false, code: "already_running", message: "The game is already running." };
          if (context.signal.aborted) return CANCELLED;
          try { this.beforeLaunch?.(); } catch { /* keeping logs never blocks a launch */ }
          const started = await this.c.host.launch({ exe: mo2.exe, profile: mo2.profile, executable: mo2.executable, arguments: mo2.arguments }, context.signal);
          // A new game session starts from config.ini: nothing live to put back from the last one.
          if (started.started) this.overlayUndo = {};
          if (!started.started && started.error?.startsWith("already_running")) return { ok: false, code: "already_running", message: started.error };
          if (!started.started) return context.signal.aborted ? CANCELLED : { ok: false, code: "launch_failed", message: `MO2 didn't start${started.error ? ` (${started.error})` : ""}: check mo2.exe in the fixtures.` };
          return { ok: true, value: { command: started.command } };
        }
        case "host.close": {
          const pid = await this.gamePid();
          if (pid === undefined) return { ok: true, value: { closed: true, was_running: false } };
          if (context.signal.aborted) return CANCELLED;
          if (!(await this.c.host.requestClose(pid, context.signal))) return context.signal.aborted ? CANCELLED : { ok: false, code: "no_window", message: "The game has no window to close." };
          return await this.waitExit(pid, context);
        }
        case "host.wait_exit": {
          const pid = await this.gamePid();
          return pid === undefined ? { ok: true, value: { closed: true } } : await this.waitExit(pid, context);
        }
        case "host.key": {
          const keys = this.keysFor(action);
          if ("error" in keys) return { ok: false, code: "no_key", message: keys.error };
          if (context.signal.aborted) return CANCELLED;
          const sent = await this.c.host.pressKeys(keys.vks, keys.label, context.signal);
          if (!sent.sent && context.signal.aborted) return CANCELLED;
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
          return { ok: true, value: { ...window, monitors, regions: { cet_window: cetWindowRect(window.width, window.height), xf_box: xfBoxRect(window.width, window.height),
            cet_line: cetLineRect(window.width, window.height), ink_panel: inkPanelRect(window.width, window.height) } } };
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
        case "config.restore": {
          const restored = this.c.config?.restore() ?? { restored: false, reason: "no staged config" };
          const fine = restored.restored || restored.reason === "unchanged by this run";
          return { ok: fine, ...(fine ? {} : { code: "not_restored", message: restored.reason }), value: restored };
        }
        case "pick": {
          // The list came resolved; where is a plan Match against each element (its path relative to the element).
          if (!Array.isArray(action.from)) return { ok: false, code: "not_a_list", message: "pick's from is not a list." };
          const where = action.where as Match | undefined;
          const eligible = action.from.filter((element) => !where || matches(where, { ok: true, value: element }, this.bindings));
          const index = Number(action.index ?? 0);
          if (index >= eligible.length) return { ok: false, code: "none_eligible", message: `Only ${eligible.length} of ${action.from.length} match${index ? ` (wanted the ${index + 1}th)` : ""}.`, value: { eligible: eligible.length, of: action.from.length } };
          return { ok: true, value: eligible[index] };
        }
        case "stamp":
          return { ok: true, value: { ms: Date.now() } };
        case "ink.rect":
          return inkRect(action);
        case "bridge.candidate":
          return await this.candidate(context);
        case "burst.covers": {
          const burst = action.burst as { started_at?: string; frames?: { at_ms?: number }[] } | undefined;
          const start = Date.parse(burst?.started_at ?? "");
          const ats = (burst?.frames ?? []).map((f) => f.at_ms).filter((a): a is number => typeof a === "number");
          const times = Array.isArray(action.times) ? action.times as unknown[] : [];
          if (!Number.isFinite(start) || !ats.length) return { ok: false, code: "no_burst", message: "The burst's start and frame times are needed." };
          if (times.some((t) => typeof t !== "number")) return { ok: false, code: "no_times", message: "Every time must be a stamp's ms (a step before didn't run)." };
          const first = start + Math.min(...ats), last = start + Math.max(...ats);
          const outside = (times as number[]).flatMap((t, i) => (t >= first && t <= last ? [] : [i]));
          return { ok: true, value: { covers: !outside.length, first_ms: first, last_ms: last, times, outside } };
        }
        case "host.windows_animations": {
          const on = await this.c.host.windowsAnimations();
          return on === null ? { ok: false, code: "unreadable", message: "Windows' animation setting couldn't be read." } : { ok: true, value: { on } };
        }
        case "recorder.span": {
          const run = Number(action.run);
          let input: Record<string, unknown> = { run, now: false };
          let distance = 0, pages = 0, more = true;
          let first: unknown, last: unknown;
          while (more && pages < 50 && !context.signal.aborted) {
            const page = await this.api.run("game.catchup", input, { source: "session", signal: context.signal });
            if (!page.ok) return { ok: false, code: page.error.code, message: page.error.message };
            pages++;
            const value = page.result as { v?: { distance_m?: number; latest?: unknown; path?: unknown[] }; more?: boolean; cursor?: unknown };
            distance += Number(value.v?.distance_m ?? 0);
            first ??= value.v?.path?.[0];
            last = value.v?.latest ?? last;
            more = value.more === true;
            input = { cursor: value.cursor, now: false };
          }
          return { ok: true, value: { run, distance_m: Math.round(distance * 10) / 10, pages, complete: !more, first, last } };
        }
        case "overlay.restore": {
          const keys = Object.keys(this.overlayUndo);
          if (!keys.length) return { ok: true, value: { restored: false, reason: "this game session's look wasn't changed live" } };
          const back = await this.api.run("overlay.set", this.overlayUndo, { source: "session", signal: context.signal });
          if (!back.ok) return { ok: false, code: back.error.code, message: back.error.message };
          this.overlayUndo = {};
          return { ok: true, value: { restored: true, keys, result: back.result } };
        }
        case "actors.release_all": {
          const status = await this.api.run("npc.status", {}, { source: "session", signal: context.signal });
          if (!status.ok) return { ok: false, code: status.error.code, message: status.error.message };
          const actors = ((status.result as { npcs?: { who?: string }[] })?.npcs ?? []).map((n) => n.who).filter((w): w is string => typeof w === "string");
          const released: string[] = [];
          for (const who of actors) if ((await this.api.run("npc.release", { who, how: "despawn" }, { source: "session" })).ok) released.push(who);
          return { ok: released.length === actors.length, value: { actors, released } };
        }
      }
      return { ok: false, code: "unknown_action", message: `No action "${kind}".` };
    } catch (error) {
      // A refusal thrown by a read helper ("npc.move: npc_busy: ...") keeps its code; only the runner's own failures are runner_error.
      const message = String((error as Error)?.message ?? error);
      const refused = /^[a-z][a-z0-9_.]*: ([a-z][a-z0-9_]*): /.exec(message)?.[1];
      return { ok: false, code: context.signal.aborted ? "cancelled" : refused ?? "runner_error", message };
    }
  }

  private async runCommand(command: string, input: Record<string, unknown>, expectError: string | undefined, context: ExecContext): Promise<Outcome> {
    const observing = this.c.observer && ["capture.screenshot", "capture.burst"].includes(command) && input.clear_overlay === false;
    const api = observing ? this.c.observer! : this.api;
    let outcome = await api.run(command, input, { source: "session", captureRoot: this.rowDir, signal: context.signal });
    // Waited through: a refusal that names what to wait for is retried while that time lasts.
    const waitUntil = Math.min(this.c.clock.now() + WAIT_AND_RETRY_MS, context.deadline - 500);
    let waited = 0;
    for (let pause = 1000; !outcome.ok && outcome.error.code !== expectError && outcome.error.code !== "handed_over" && WAIT_AND_RETRY.test(outcome.error.message ?? "") &&
      this.c.clock.now() + pause < waitUntil && !context.signal.aborted; pause = Math.min(2000, pause * 2)) {
      await this.c.clock.sleep(pause, context.signal);
      waited += pause;
      outcome = await api.run(command, input, { source: "session", captureRoot: this.rowDir, signal: context.signal });
    }
    if (!outcome.ok && waited) outcome = { ...outcome, error: { ...outcome.error, message: `${outcome.error.message} (still so after waiting ${Math.round(waited / 1000)} s)` } };
    if (!outcome.ok) {
      if (outcome.error.code === "handed_over") return { ok: false, code: "handed_over", message: outcome.error.message, halt: HANDED_OVER };
      if (expectError && outcome.error.code === expectError) return { ok: true, code: outcome.error.code, value: { refused: outcome.error } };
      return { ok: false, code: outcome.error.code, message: outcome.error.message };
    }
    if (expectError) return { ok: false, code: "unexpected_success", message: `Expected ${expectError}, but it went ahead.`, value: outcome.result };
    if (command === "overlay.set") {
      // Keep each key's value from before its first live change, for the teardown's overlay.restore.
      const undo = (outcome.result as { undo?: { params?: Record<string, unknown> } })?.undo?.params ?? {};
      for (const [k, v] of Object.entries(undo)) if (!Object.hasOwn(this.overlayUndo, k)) this.overlayUndo[k] = v;
    }
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
    const cursor = await captureCursor(this.api, context.signal);
    const choices = Array.isArray(action.choices) ? action.choices : undefined;
    const seconds = Math.min(600, Math.max(5, Number(action.seconds ?? Math.round((context.deadline - this.c.clock.now()) / 1000))));
    const posted = await this.api.run("ui.message", { text: String(action.text).slice(0, 600), level: "ask", seconds, ...(choices ? { choices } : {}) }, { source: "session" });
    if (!posted.ok) return { ok: false, code: posted.error.code, message: posted.error.message, ...(posted.error.code === "handed_over" ? { halt: HANDED_OVER } : {}) };
    const id = (posted.result as { id?: number }).id;
    this.c.log(`     ASK (in game, id ${id}): ${action.text}`);
    const window = await waitForEvent(this.api, cursor, { kind: "answer", message_id: id }, Math.max(1, (context.deadline - this.c.clock.now()) / 1000 - 1), context.signal, this.c.clock);
    const answer = window.events.find((e) => e.kind === "answer" && e.data?.message_id === id);
    if (!answer) {
      await this.api.run("ui.message", { withdraw: id }, { source: "session" }).catch(() => undefined);
      if (window.timed_out) return { ok: false, code: "no_answer", message: "Nobody answered in time.", value: { message_id: id } };
      return { ok: false, code: "wait_ended_early", message: "The question went before anyone answered (withdrawn, or the wait refused).", value: { message_id: id, missing: window.cursor.missing } };
    }
    return { ok: true, value: { message_id: id, label: answer.data?.label, choice: answer.data?.choice, via: answer.data?.via } };
  }

  /**
   * Whether a themed surface (the XF box, the CET window or line: each a plate in the theme's WindowBg with text in its
   * Text colour) is in frame: in a capture, in every frame of a burst, or in a fresh small probe capture (name, rect).
   * A frame shows it when at least min_plate of the area is the plate colour and min_text the text colour.
   */
  private async surface(action: Action, context: ExecContext): Promise<Outcome> {
    const rect = action.rect as { x: number; y: number; width: number; height: number } | undefined;
    let subject = action.capture as unknown;
    let cropped = false;
    if (subject === undefined) {
      if (typeof action.name !== "string") return { ok: false, code: "bad_input", message: "capture.surface needs a capture or a probe name." };
      const probe = await this.runCommand("capture.screenshot", { name: action.name, clear_overlay: false, ...(action.route ? { route: action.route } : {}), ...(rect ? { rect } : {}) }, undefined, context);
      if (!probe.ok) return probe;
      subject = probe.value;
      cropped = true;
    }
    type Shot = { full?: { path?: string }; crop?: { region?: string } };
    const burst = subject as { frames?: { record?: Shot }[]; crop?: { region?: string } };
    const shot = subject as Shot;
    const files = Array.isArray(burst?.frames) ? burst.frames.map((f) => f.record?.full?.path) : [typeof subject === "string" ? subject : shot?.full?.path];
    // A burst or capture taken with a rect (or a named region) is already the area: the rect applies to full windows only.
    const region = Array.isArray(burst?.frames) ? burst.crop?.region : shot?.crop?.region;
    if (region && region !== "full") cropped = true;
    if (!files.length || files.some((f) => typeof f !== "string" || !existsSync(f))) return { ok: false, code: "no_capture", message: "The capture's files are needed." };
    const options = { plate: action.plate as Rgb, plateAlt: action.plate_alt as Rgb[] | undefined, text: action.text as Rgb, tolerance: Number(action.tolerance ?? 7), minPlate: Number(action.min_plate ?? 0.15), minText: Number(action.min_text ?? 0), lumaRule: action.luma_rule as LumaRule | undefined };
    const per = files.map((file) => {
      let pixels = decodePng(readFileSync(file as string));
      if (rect && !cropped) pixels = crop(pixels, { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.min(rect.width, pixels.width - Math.max(0, rect.x)), height: Math.min(rect.height, pixels.height - Math.max(0, rect.y)) });
      return surfaceStats(pixels, options);
    });
    const absent = per.flatMap((p, i) => (p.present ? [] : [i + 1]));
    const value = { present: !absent.length, frames: per.length, absent, plate_fraction: Math.min(...per.map((p) => p.plate_fraction)), text_fraction: Math.min(...per.map((p) => p.text_fraction)), per };
    if (!absent.length) return { ok: true, value };
    const worst = per[absent[0] - 1];
    return { ok: false, code: "surface_missing", message: `The surface isn't in frame${per.length > 1 ? ` in frame${absent.length > 1 ? "s" : ""} ${absent.join(", ")} of ${per.length}` : ""} (plate ${(worst.plate_fraction * 100).toFixed(1)} % of the area, text ${(worst.text_fraction * 100).toFixed(2)} %).`, value };
  }

  /**
   * Whether the running game's bridge is the staged candidate: a game left running by an earlier attempt (a --loop
   * restage between them) may carry the previous binary or the settings it loaded. Compared: build_commit, build_dirty
   * and plugin_version against the staged manifest, bridge.allow_writes and write_classes against the staged config.ini.
   */
  private async candidate(context: ExecContext): Promise<Outcome> {
    const staged = this.c.fixtures.staged_mod;
    if (typeof staged !== "string" || !existsSync(stagedManifestPath(staged))) return { ok: false, code: "no_candidate", message: "No staged manifest to compare with (fixtures staged_mod)." };
    let manifest: { version?: string; commit?: string; source_tree_clean?: boolean };
    try { manifest = JSON.parse(readFileSync(stagedManifestPath(staged), "utf8")); } catch { return { ok: false, code: "no_candidate", message: "The staged manifest couldn't be read." }; }
    const config = existsSync(stagedConfigPath(staged)) ? readIni(readFileSync(stagedConfigPath(staged), "utf8")) : {};
    const info = await this.api.run("bridge.info", {}, { source: "session", signal: context.signal });
    if (!info.ok) return { ok: false, code: info.error.code, message: info.error.message };
    const live = info.result as { build_commit?: string; build_dirty?: boolean; plugin_version?: string; bridge?: { allow_writes?: boolean; write_classes?: string[] } };
    const mismatches: string[] = [];
    const commit = (live.build_commit ?? "").toLowerCase(), want = (manifest.commit ?? "").toLowerCase();
    const n = Math.min(commit.length, want.length);
    if (want && (n < 7 || commit.slice(0, n) !== want.slice(0, n))) mismatches.push(`build ${commit.slice(0, 8) || "?"} is running, the staged build is ${want.slice(0, 8)}`);
    if (typeof manifest.source_tree_clean === "boolean" && typeof live.build_dirty === "boolean" && live.build_dirty === manifest.source_tree_clean) mismatches.push(`the running build is ${live.build_dirty ? "dirty" : "clean"}, the staged one ${manifest.source_tree_clean ? "clean" : "dirty"}`);
    if (manifest.version && live.plugin_version && manifest.version !== live.plugin_version) mismatches.push(`version ${live.plugin_version} is running, ${manifest.version} is staged`);
    if (config["bridge.allow_writes"] !== undefined && live.bridge?.allow_writes !== undefined && String(live.bridge.allow_writes) !== config["bridge.allow_writes"]) mismatches.push(`allow_writes ${live.bridge.allow_writes} was loaded, config.ini says ${config["bridge.allow_writes"]}`);
    if (config["bridge.allow_write_classes"] !== undefined && Array.isArray(live.bridge?.write_classes)) {
      const want = new Set(config["bridge.allow_write_classes"].split(",").map((c) => c.trim()).filter(Boolean));
      const have = new Set(live.bridge.write_classes);
      if (want.size !== have.size || [...want].some((c) => !have.has(c))) mismatches.push(`write classes ${[...have].join(", ")} were loaded, config.ini says ${[...want].join(", ")}`);
    }
    return { ok: true, value: { matches: !mismatches.length, mismatches } };
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
 * check passed (with no checks: the plan completed). CAPTURED instead of PASS when the row is judged by someone else
 * (judgedBy): the states and captures held, and what they show awaits that review.
 */
export function verdictOf(close: Pick<PlanResult, "status" | "outcome" | "reason" | "last_step">, checks: CheckResult[], failRow: Set<string>, judgedBy?: string): { verdict: Verdict; reason?: string } {
  const out = rawVerdict(close, checks, failRow);
  if (out.verdict !== "PASS" || !judgedBy) return out;
  return { verdict: "CAPTURED", reason: `awaiting ${judgedBy}${out.reason ? `; ${out.reason}` : ""}` };
}

function rawVerdict(close: Pick<PlanResult, "status" | "outcome" | "reason" | "last_step">, checks: CheckResult[], failRow: Set<string>): { verdict: Verdict; reason?: string } {
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
  /** Cleanup steps that failed: what they were to undo may still be in place (the run is then never ok). */
  cleanup_failed?: string[];
  reason?: string;
  judged_by?: string;
  evidence: string[];
  checks: CheckResult[];
  facts?: { label: string; value: unknown }[];
  prelude?: { status: string; reason?: string };
  close?: { outcome: string; status: string; reason?: string; last_step?: string };
  telemetry?: RowTelemetry;
  attempt?: number;
  started_at?: string;
  ms?: number;
  reports: ReportEntry[];
  /** This row's records from earlier attempts of the same session (the loop reran it). */
  earlier?: Omit<RowRecord, "earlier" | "reports">[];
};

// ---- Halting early on a significant bug ---------------------------------------------------------------

/**
 * The failures that make the rest of a batch pointless or misleading: the game gone (a crash), the bridge gone
 * (not after a row that stops it on purpose), a draw call that failed or the overlay stopping (the plugin log's
 * halt patterns), an exception in the runner, and the same failure across N rows. --halt-on (or the script's
 * halt_on, or a row's) chooses them; handed_over and the commit tripwire always stop a batch.
 */
export const HALT_KINDS = ["crash", "bridge_lost", "draw_call", "runner_error", "repeated"] as const;
export type HaltPolicy = { kinds: Set<string>; repeated: number };
export type Halt = { kind: string; reason: string; row?: string; evidence: string[]; rerun: string[] };

/** "crash,bridge_lost,draw_call,runner_error,repeated:3", "all" (the default, repeated after 3 rows) or "none". */
export function parseHaltOn(text: string | string[] | undefined): HaltPolicy {
  const parts = (Array.isArray(text) ? text : (text ?? "all").split(",")).map((p) => p.trim()).filter(Boolean);
  const kinds = new Set<string>();
  let repeated = 3;
  for (const part of parts) {
    if (part === "none") continue;
    if (part === "all") { HALT_KINDS.forEach((k) => kinds.add(k)); continue; }
    const [kind, n] = part.split(":");
    if (!(HALT_KINDS as readonly string[]).includes(kind)) throw new Error(`--halt-on: unknown kind ${kind} (use ${HALT_KINDS.join(", ")}, all or none)`);
    kinds.add(kind);
    if (kind === "repeated" && n !== undefined) {
      repeated = Number(n);
      if (!Number.isInteger(repeated) || repeated < 2 || repeated > 50) throw new Error("--halt-on: repeated:N takes 2 to 50");
    }
  }
  return { kinds, repeated };
}

/** A failure's signature for the repeated check: the plan's failing code, without the row's own labels. */
export function failureSignature(record: RowRecord): string | undefined {
  if (DONE_VERDICTS.has(record.verdict) || !record.close || record.close.status === "done") return undefined;
  const code = /^[^:]+: ([a-z_]+)/.exec(record.close.reason ?? "")?.[1];
  return code && !["cancelled", "deadline"].includes(code) ? code : record.close.reason?.includes("deadline") ? "deadline" : code;
}

const closesTheGame = (row: Row) => JSON.stringify(row.steps).includes('"host.close"');
/** A row that stops the bridge on purpose (bridge.kill in its steps, or after: restart): its silence is not a lost bridge, and the next row restarts. */
const stopsTheBridge = (row: Row) => row.after === "restart" || JSON.stringify(row.steps).includes('"command":"bridge.kill"');

// ---- Running a batch -----------------------------------------------------------------------------------

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
  /** Which significant bugs end the batch early (default: all of them, repeated after 3 rows). */
  haltOn?: HaltPolicy;
  /** Close the game cleanly after a halt (default true; never after handed_over: the player has the game). */
  closeOnHalt?: boolean;
  /** The command that continues after a halt, given the rows still to run (resume.json records it). */
  resumeCommand?: (rows: string[]) => string;
  /** Bridge pings before the bridge counts as lost (default 3, 2 s apart). */
  bridgeProbes?: number;
  /** The observational API for overlay-preserving captures (see BatchContext.observer). */
  observer?: Pick<CommandApi, "run"> & { close?: () => void };
};
export type BatchResult = {
  ok: boolean;
  outcome: "complete" | "stopped" | "interrupted";
  halt?: string;
  haltInfo?: Halt;
  attempt: number;
  remaining: string[];
  rows: RowRecord[];
  /** Cleanup that failed (the report, the teardown, config.ini's restore): the batch is not ok when any did. */
  cleanupErrors: string[];
  manifestPath: string;
  reportPath: string;
  resumePath: string;
};

type PreviousRun = { attempts: unknown[]; rows: RowRecord[] } | undefined;

/** The report folder's earlier attempts of this script (the loop continues into the same folder). */
function previousRun(outDir: string, name: string): PreviousRun {
  const path = join(outDir, "manifest.json");
  if (!existsSync(path)) return undefined;
  try {
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    if (manifest?.schema !== REPORT_SCHEMA_3 || manifest.script?.name !== name) return undefined;
    return { attempts: Array.isArray(manifest.attempts) ? manifest.attempts : [], rows: Array.isArray(manifest.rows) ? manifest.rows : [] };
  } catch {
    return undefined;
  }
}

/** Runs a schema-3 script: setup, every row with its prelude, telemetry and verdict, then the teardown, writing the report as it goes. */
export async function runBatch(script: BatchScript, options: BatchRunOptions): Promise<BatchResult> {
  const planned = planBatch(script);
  if (planned.problems.length) throw new Error(`script problems:\n  ${planned.problems.join("\n  ")}`);
  // A row asked for that the script doesn't have is an error, never silently nothing.
  const unknownRows = (options.rows ?? []).filter((id) => !planned.rows.some((r) => r.row.id === id));
  if (unknownRows.length) throw new Error(`rows not in the script: ${unknownRows.join(", ")}`);
  const log = options.log ?? ((line: string) => console.log(line));
  const clock = options.clock ?? realClock;
  const fixtures = { ...(script.fixtures ?? {}), ...(options.fixtures ?? {}) };
  mkdirSync(options.outDir, { recursive: true });
  const previous = previousRun(options.outDir, script.name);
  const attempt = (previous?.attempts.length ?? 0) + 1;
  const policy = options.haltOn ?? parseHaltOn(script.halt_on);
  const config = typeof fixtures.staged_mod === "string" ? new ConfigEditor(stagedConfigPath(fixtures.staged_mod), join(options.outDir, `config-backup-a${attempt}`)) : undefined;
  const readCetBindings = options.readCetBindings ?? (() => {
    const path = typeof fixtures.game_dir === "string" ? join(fixtures.game_dir, "bin", "x64", "plugins", "cyber_engine_tweaks", "bindings.json") : "";
    return path && existsSync(path) ? readFileSync(path, "utf8") : null;
  });
  const executor = new SessionExecutor({ api: options.api, observer: options.observer, host: options.host, outDir: options.outDir, fixtures, clock, log, echo: options.echo !== false, config, readCetBindings,
    commitFloorGb: typeof fixtures.commit_floor_gb === "number" ? fixtures.commit_floor_gb : 4, commitEveryMs: options.commitEveryMs }, script);
  const logs = fixtures.logs as { plugin_dir?: string } | undefined;
  const telemetry = new Telemetry({ api: options.api, host: options.host, outDir: options.outDir, attempt, clock,
    // Under MO2 the game's new files (its logs among them) land in MO2's overwrite folder, so that is looked at first.
    pluginLogDirs: [logs?.plugin_dir, typeof (fixtures.mo2 as { exe?: string } | undefined)?.exe === "string" ? join(dirname((fixtures.mo2 as { exe: string }).exe), "overwrite", "red4ext", "logs") : undefined,
      typeof fixtures.game_dir === "string" ? join(fixtures.game_dir, "red4ext", "logs") : undefined].filter((d): d is string => typeof d === "string"),
    haltPatterns: [...DEFAULT_HALT_PATTERNS, ...((script.halt_patterns ?? fixtures.halt_patterns ?? []) as string[])] });
  const bindings = executor.bindings;
  const signal = options.signal ?? new AbortController().signal;
  const monitor = new CommitMonitor({ host: options.host, api: options.api, clock, floorGb: typeof fixtures.commit_floor_gb === "number" ? fixtures.commit_floor_gb : 4, everyMs: options.commitEveryMs ?? 10_000 });
  executor.monitor = monitor;
  executor.beforeLaunch = () => { telemetry.keepLogs(); };
  const startedAt = new Date().toISOString();
  const records: RowRecord[] = [];
  // Set by stopWith (also from closures), so its type is declared wide.
  let halt = undefined as Halt | undefined;
  const stopWith = (kind: string, reason: string, row?: string, evidence: string[] = [], rerun: string[] = row ? [row] : []) => {
    halt ??= { kind, reason, row, evidence, rerun };
  };
  const kindOfStop = (reason: string | undefined) => (reason?.includes("handed to the player") ? "handed_over" : reason?.includes("tripwire tripped") ? "tripwire" : "stopped");
  const reportOf = (result: PlanResult) => ({ outcome: result.outcome, status: result.status, reason: result.reason, last_step: result.last_step });
  // The batch's plans run under the caller's signal and the commit monitor's: a trip interrupts the work in hand.
  const work = new AbortController();
  const interrupt = () => work.abort();
  for (const s of [signal, monitor.signal]) { if (s.aborted) interrupt(); else s.addEventListener("abort", interrupt, { once: true }); }
  const plan = (p: Plan, extra: Partial<Parameters<typeof runPlan>[1]> = {}) => runPlan(p, { executor, clock, signal: work.signal, bindings, ...extra });
  const remaining = () => {
    const rerun = new Set(halt?.rerun ?? []);
    return planned.rows.map((r) => r.row.id).filter((id) => {
      const record = records.find((r) => r.id === id);
      if (options.rows && !options.rows.includes(id)) return false;
      return rerun.has(id) || !record || /^(not reached|interrupted)/.test(record.reason ?? "");
    });
  };
  // Writing the report must never stop the run or its cleanup: a failure is recorded and the run goes on.
  const cleanupErrors: string[] = [];
  const fallbackPaths = { manifestPath: join(options.outDir, "manifest.json"), reportPath: join(options.outDir, "report.md") };
  const write = (setup?: PlanResult, teardown?: PlanResult, finished = false) => {
    try {
      return writeReports(script, options, { startedAt, finished, halt, setup, teardown, rows: records, executor, config, configRestore, interrupted: signal.aborted, attempt, previous, remaining: remaining(), cleanupErrors });
    } catch (error) {
      const text = `the report couldn't be written: ${String((error as Error)?.message ?? error)}`;
      if (!cleanupErrors.includes(text)) cleanupErrors.push(text);
      return fallbackPaths;
    }
  };
  let setup: PlanResult | undefined;
  let configRestore: { restored: boolean; reason?: string } | undefined;

  // Everything that can change the game runs inside this try; the finally below always tears down, restores
  // config.ini and closes the connection, whatever was thrown.
  monitor.start();
  try {
  log(`${script.title ?? script.name}: ${planned.rows.length} rows (attempt ${attempt})`);
  await executor.run({ do: "note", text: `XF session: ${script.title ?? script.name} (${planned.rows.length} rows)` }, { signal, deadline: clock.now() + 10_000, plan: "start", step: "start", attempt: 1, raw: { do: "note" } }).catch(() => undefined);
  setup = await plan(planned.setup);
  if (setup.status === "stopped") stopWith(kindOfStop(setup.reason), setup.reason ?? "setup stopped");
  const setupFailed = setup.status !== "done" ? `setup didn't finish: ${setup.reason}` : undefined;
  // The recorder from the start when the game already runs; otherwise from the first row's launch.
  await telemetry.ensureRecorder().catch(() => undefined);
  telemetry.markRow();
  let restartDue = false;
  const failures = new Map<string, string[]>();
  for (const { row, plan: rowPlan, failRow } of planned.rows) {
    const started = clock.now();
    const record: RowRecord = { id: row.id, title: row.title, verdict: "SKIP", evidence: [], checks: [], reports: [], attempt, started_at: new Date().toISOString(), ...(row.judged_by ? { judged_by: row.judged_by } : {}) };
    records.push(record);
    if (options.rows && !options.rows.includes(row.id)) { record.reason = "not selected"; continue; }
    if (row.passive) { record.reason = "judged at the end over the whole batch's telemetry"; continue; }
    if (signal.aborted) { record.reason = "interrupted"; continue; }
    if (halt) { record.reason = `not reached: ${halt.reason}`; continue; }
    if (setupFailed) { record.reason = setupFailed; continue; }
    try {
      const unmet = (row.requires ?? []).flatMap((need) => {
        if (need.fixture) {
          const value = fixtures[need.fixture];
          if (need.equals !== undefined && value !== need.equals) return [`the fixtures file's ${need.fixture} is ${value === undefined ? "absent" : JSON.stringify(value)}, not ${JSON.stringify(need.equals)}${need.note ? ` (${need.note})` : ""}`];
          if (need.equals === undefined && (value === undefined || value === null || value === false)) return [`the fixtures file has no ${need.fixture}`];
        }
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
      // A load stops the recorder (load_requested): the run the batch holds is stale, and the next ensureRecorder starts afresh.
      if (prelude.reports.some((e) => e.kind === "step" && e.label === "load" && e.status === "ok")) telemetry.invalidate();
      restartDue = false;
      if (monitor.reason) stopWith("tripwire", monitor.reason, row.id);
      if (prelude.status !== "done") {
        stopWith(prelude.status === "stopped" ? kindOfStop(prelude.reason) : "prelude", prelude.status === "stopped" ? prelude.reason ?? "stopped" : `the game couldn't be brought to ${row.id}'s set-up: ${prelude.reason}`, row.id);
        record.reason = `could not set up: ${prelude.reason}`;
        record.telemetry = await telemetry.collect(`${row.id}`);
        write(setup);
        continue;
      }
      // Telemetry: the recorder again after a restart (a new bridge session), and the row's slice from here.
      const recorder = await telemetry.ensureRecorder();
      if (recorder.restarted) log(`     recorder run ${recorder.run} on every channel`);
      // A row that would start its own recorder can reuse the batch's ($recorder.run), which covers every channel.
      if (recorder.run !== undefined) bindings.recorder = { run: recorder.run, channels: ALL_CHANNELS };
      const before = new Map(Object.entries(bindings));
      const result = await plan(rowPlan);
      record.close = reportOf(result);
      record.reports.push(...result.reports);
      record.checks = (row.pass ?? []).map((check) => evaluateCheck(check, bindings, (name) => !before.has(name) || before.get(name) !== bindings[name]));
      Object.assign(record, verdictOf(result, record.checks, failRow, row.judged_by));
      if (result.release_failed?.length) {
        record.cleanup_failed = result.release_failed;
        record.reason = `${record.reason ? `${record.reason}; ` : ""}cleanup failed: ${result.release_failed.join("; ")}`;
        cleanupErrors.push(`${row.id}'s cleanup: ${result.release_failed.join("; ")}`);
      }
      record.evidence = [...executor.evidence];
      record.telemetry = await telemetry.collect(row.id);
      if (row.facts) record.facts = row.facts.map((fact) => {
        const missing: string[] = [];
        const value = resolveRefs(fact.ref, bindings, missing);
        return { label: fact.label, value: missing.length ? null : value };
      });
      record.ms = Math.round(clock.now() - started);
      log(`${record.verdict.padEnd(7)} ${row.id}${record.reason ? `: ${record.reason}` : ""}`);
      if (monitor.reason) stopWith("tripwire", monitor.reason, row.id);
      if (result.status === "stopped") stopWith(kindOfStop(result.reason), result.reason ?? "stopped", row.id);
      restartDue = stopsTheBridge(row);
      // Significant bugs: the batch stops here rather than piling misleading rows on top.
      const kinds = row.halt_on ? new Set(row.halt_on) : policy.kinds;
      if (!halt && kinds.has("runner_error") && /runner_error|executor_error/.test(record.close.reason ?? "")) stopWith("runner_error", `the runner failed in ${row.id}: ${record.close.reason}`, row.id, [record.telemetry.dir]);
      if (!halt && kinds.has("draw_call") && record.telemetry.log_matches.length) stopWith("draw_call", `the plugin log reports a failure during ${row.id}: ${record.telemetry.log_matches[0]}`, row.id, [record.telemetry.dir, ...record.telemetry.log_matches]);
      if (!halt && (kinds.has("crash") || kinds.has("bridge_lost"))) {
        const game = await options.host.gameProcess();
        if (!game && kinds.has("crash") && !closesTheGame(row)) stopWith("crash", `the game is no longer running after ${row.id} (a crash?)`, row.id, [record.telemetry.dir]);
        else if (game && kinds.has("bridge_lost") && !stopsTheBridge(row)) {
          let alive = false;
          for (let probe = 0; probe < (options.bridgeProbes ?? 3) && !alive; probe++) {
            if (probe) await clock.sleep(2000, signal);
            alive = (await options.api.run("bridge.ping", {}, { source: "session" })).ok;
          }
          if (!alive) stopWith("bridge_lost", `the bridge stopped answering after ${row.id} while the game still runs`, row.id, [record.telemetry.dir]);
        }
      }
      const signature = failureSignature(record);
      if (signature) {
        const rows = [...(failures.get(signature) ?? []), row.id];
        failures.set(signature, rows);
        if (!halt && kinds.has("repeated") && rows.length >= policy.repeated) stopWith("repeated", `${rows.length} rows failed the same way (${signature}): ${rows.join(", ")}`, row.id, rows.map((id) => records.find((r) => r.id === id)?.telemetry?.dir ?? id), rows);
      }
    } catch (error) {
      record.reason = `the runner failed: ${String((error as Error)?.stack ?? error).slice(0, 600)}`;
      if (policy.kinds.has("runner_error")) stopWith("runner_error", `the runner failed in ${row.id}: ${(error as Error)?.message ?? error}`, row.id, [String((error as Error)?.stack ?? error)]);
    }
    const stopped = halt as Halt | undefined;
    if (stopped) log(`HALT (${stopped.kind}): ${stopped.reason}`);
    write(setup);
  }
  } catch (error) {
    stopWith("runner_error", `the runner failed: ${String((error as Error)?.message ?? error)}`, undefined, [String((error as Error)?.stack ?? error)]);
  }
  // The teardown: the script's own steps, then the built-in ones; always, each best effort. A halt (handed_over,
  // the tripwire) must not stop the teardown itself: each step is tried and its refusal recorded.
  const attemptCleanup = async (what: string, work: () => Promise<unknown>) => {
    try { await work(); } catch (error) { cleanupErrors.push(`${what}: ${String((error as Error)?.message ?? error)}`); }
  };
  // The monitor stops first: a low reading during cleanup must not gate the teardown or the restore.
  await attemptCleanup("commit monitor", () => monitor.stop());
  if (monitor.reason) stopWith("tripwire", monitor.reason);
  await attemptCleanup("telemetry", () => telemetry.finish());
  // Whole-batch passive rows: judged on every attempt (whichever rows it ran) over the evidence of every attempt so far
  // (mergeSummaries), with no session time of their own: an earlier attempt's verdict never stands for a later one.
  bindings.telemetry = mergeSummaries([...earlierSummaries(options.outDir, attempt), { attempt, summary: telemetry.summary() }]);
  for (const { row, plan: rowPlan, failRow } of planned.rows.filter((r) => r.row.passive)) {
    const record = records.find((r) => r.id === row.id)!;
    await attemptCleanup(`passive row ${row.id}`, async () => {
      const before = new Map(Object.entries(bindings));
      const result = await runPlan(rowPlan, { executor, clock, bindings });
      record.close = reportOf(result);
      record.reports.push(...result.reports);
      record.checks = (row.pass ?? []).map((check) => evaluateCheck(check, bindings, (name) => name === "telemetry" || !before.has(name) || before.get(name) !== bindings[name]));
      record.reason = undefined;
      Object.assign(record, verdictOf(result, record.checks, failRow, row.judged_by));
      if (row.facts) record.facts = row.facts.map((fact) => { const missing: string[] = []; const value = resolveRefs(fact.ref, bindings, missing); return { label: fact.label, value: missing.length ? null : value }; });
      log(`${record.verdict.padEnd(7)} ${row.id} (over the whole batch)${record.reason ? `: ${record.reason}` : ""}`);
    });
  }
  const teardownPlan: Plan = { id: "teardown", steps: [...planned.teardown.steps.map((s) => ({ ...s, on_fail: "continue" as const })), ...builtinTeardown()] };
  executor.clearStops();
  const teardownExecutor: Executor = { run: async (action, context) => ({ ...(await executor.run(action, context)), halt: undefined }) };
  let teardown: PlanResult | undefined;
  await attemptCleanup("teardown", async () => {
    teardown = await runPlan(teardownPlan, { executor: teardownExecutor, clock, bindings });
    // Each teardown step that failed is an unresolved cleanup: never an ok run.
    for (const e of teardown.reports) if (e.kind === "step" && e.status === "failed" && !String(e.step).includes("/")) cleanupErrors.push(`teardown ${e.label ?? e.step}: ${e.code ?? "failed"}${e.message ? ` (${String(e.message).slice(0, 160)})` : ""}`);
  });
  await attemptCleanup("closing note", () => executor.run({ do: "note", text: `XF session ${halt ? "stopped" : "complete"}: ${script.title ?? script.name}` }, { signal: new AbortController().signal, deadline: clock.now() + 10_000, plan: "end", step: "end", attempt: 1, raw: { do: "note" } }));
  // A fast exit: close the game cleanly, so the fix can go in and the next attempt starts fresh.
  await attemptCleanup("closing the game", async () => {
    // A prelude that stopped with a healthy game (its bridge answers) leaves it running: the next attempt adopts it.
    const adoptable = halt?.kind === "prelude" && (await options.host.gameProcess()) && (await options.api.run("bridge.ping", {}, { source: "session" })).ok;
    if (adoptable) log("Keeping the game: it runs and its bridge answers, so the next attempt adopts it.");
    if (halt && halt.kind !== "handed_over" && !adoptable && options.closeOnHalt !== false && (await options.host.gameProcess())) {
      log("Closing the game after the halt.");
      const closed = await runPlan({ id: "halt-close", steps: closeSteps() }, { executor: teardownExecutor, clock });
      teardown?.reports.push(...closed.reports);
    }
  });
  // The plugin logs of the whole attempt, whole, now the game has closed (or still runs, adopted next time).
  await attemptCleanup("plugin logs", async () => {
    telemetry.keepLogs();
    if (telemetry.keptLogs.length) log(`Kept ${telemetry.keptLogs.length} plugin log${telemetry.keptLogs.length > 1 ? "s" : ""} in ${join(options.outDir, "logs", `a${attempt}`)}`);
    else log("No plugin log was written during this attempt in the folders the fixtures name (logs.plugin_dir, mo2.exe's overwrite, game_dir).");
  });
  // config.ini goes back directly, past the executor's stop gates, and its outcome is recorded either way.
  if (config) {
    try {
      configRestore = config.restore();
      if (!configRestore.restored && configRestore.reason !== "unchanged by this run") cleanupErrors.push(`config.ini wasn't restored: ${configRestore.reason}`);
    } catch (error) {
      configRestore = { restored: false, reason: String((error as Error)?.message ?? error) };
      cleanupErrors.push(`config.ini wasn't restored: ${configRestore.reason}`);
    }
  }
  const paths = write(setup, teardown, true);
  const left = remaining();
  const resumePath = join(options.outDir, "resume.json");
  await attemptCleanup("resume.json", async () => writeFileSync(resumePath, JSON.stringify({
    schema: "xfb/session-resume-1",
    script: { name: script.name, path: options.scriptPath, sha256: scriptHash(script) },
    attempt,
    finished_at: new Date().toISOString(),
    outcome: signal.aborted ? "interrupted" : halt ? "halted" : "complete",
    ...(halt ? { halt } : {}),
    rows_done: records.filter((r) => r.reason !== "not selected" && !left.includes(r.id)).map((r) => ({ id: r.id, verdict: r.verdict, ...(r.reason ? { reason: r.reason } : {}) })),
    rows_remaining: left,
    command: left.length ? (options.resumeCommand?.(left) ?? `bun tools/session.ts ${options.scriptPath ?? "<script.json>"} --fixtures <private.json> --out "${options.outDir}" --rows ${left.join(",")}`) : null,
    plugin_logs: telemetry.keptLogs.map((p) => relative(options.outDir, p)),
    ...(cleanupErrors.length ? { cleanup_errors: cleanupErrors } : {}),
  }, null, 2) + "\n"));
  await attemptCleanup("closing the connection", async () => { options.api.close(); options.observer?.close?.(); });
  const outcome = signal.aborted ? "interrupted" : halt ? "stopped" : "complete";
  return { ok: !halt && !signal.aborted && !cleanupErrors.length && records.every((r) => DONE_VERDICTS.has(r.verdict) || r.reason === "not selected"), outcome, halt: halt?.reason, haltInfo: halt, attempt, remaining: left, rows: records, cleanupErrors, ...paths, resumePath };
}

// ---- Reports ---------------------------------------------------------------------------------------------

type ReportState = {
  startedAt: string; finished: boolean; halt?: Halt; setup?: PlanResult; teardown?: PlanResult; rows: RowRecord[]; executor: SessionExecutor; config?: ConfigEditor;
  interrupted: boolean; attempt: number; previous: PreviousRun; remaining: string[]; cleanupErrors: string[];
  configRestore?: { restored: boolean; reason?: string };
};

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
  // One report across every attempt: each row shows its latest run, with the earlier ones beside it.
  const earlierRows = s.previous?.rows ?? [];
  const merged: RowRecord[] = s.rows.map((record) => {
    const before = earlierRows.find((r) => r.id === record.id);
    const ranHere = record.reason !== "not selected";
    const latest = ranHere || !before ? record : before;
    const history = [...(before?.earlier ?? []), ...(before && ranHere ? [Object.fromEntries(Object.entries(before).filter(([k]) => k !== "earlier" && k !== "reports")) as Omit<RowRecord, "earlier" | "reports">] : [])];
    return history.length ? { ...latest, earlier: history } : latest;
  });
  const counts = Object.fromEntries((["PASS", "CAPTURED", "FAIL", "PARTIAL", "SKIP"] as const).map((v) => [v, merged.filter((r) => r.verdict === v).length]));
  const all = [...(s.setup?.reports ?? []), ...s.rows.flatMap((r) => r.reports), ...(s.teardown?.reports ?? [])];
  const outcome = s.interrupted ? "interrupted" : s.halt ? "halted" : s.finished ? "complete" : "running";
  const thisAttempt = {
    attempt: s.attempt, started_at: s.startedAt, ...(s.finished ? { finished_at: new Date().toISOString() } : { in_progress: true }), outcome,
    ...(s.halt ? { halt: s.halt } : {}), rows_run: s.rows.filter((r) => r.reason !== "not selected").map((r) => r.id), remaining: s.remaining,
    telemetry: `telemetry/a${s.attempt}`, key_refusals: s.executor.refusals, detours: detoursOf(all), free_commit_gb: s.executor.monitor?.lastFreeGb ?? null,
    ...(options.preflight ? { preflight: options.preflight } : {}),
    setup: s.setup ? { close: { outcome: s.setup.outcome, status: s.setup.status, reason: s.setup.reason }, reports: s.setup.reports } : null,
    teardown: s.teardown ? { close: { outcome: s.teardown.outcome, status: s.teardown.status }, reports: s.teardown.reports } : null,
  };
  const attempts = [...((s.previous?.attempts ?? []) as (typeof thisAttempt)[]), thisAttempt];
  const manifest = {
    schema: REPORT_SCHEMA_3,
    script: { name: script.name, title: script.title, card: script.card, path: options.scriptPath, requires: script.requires ?? [] },
    run: { attempts: attempts.length, outcome, counts, ...(s.halt ? { halt: s.halt } : {}), ...(s.cleanupErrors.length ? { cleanup_errors: s.cleanupErrors } : {}), ...(s.configRestore ? { config_restore: s.configRestore } : {}) },
    attempts,
    rows: merged,
    notes: [
      "Screenshots are external window captures (what was on screen, after ReShade and overlays), 8-bit; each capture's result in the reports records the window size, crop and scale.",
      "PASS covers the row's own checks. A row with judged_by is at best CAPTURED: its named states were verified through the bridge before each capture and its surfaces found in frame, and what the captures show awaits that review.",
      "Report entries are keyed by plan, step and attempt; a step revisited by a goto carries ~n. Each row's telemetry folder holds its slice of the recorder, the plugin log, overlay_state, bridge_info and memory.",
    ],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  const memory = (r: RowRecord) => (r.telemetry?.memory ? `${r.telemetry.memory.free_commit_gb ?? "?"} GB free${r.telemetry.memory.game_handles ? `, ${r.telemetry.memory.game_handles} handles` : ""}` : "");
  const lines = [
    `# ${script.title ?? script.name}`,
    "",
    `${attempts.length} attempt${attempts.length > 1 ? "s" : ""}, the latest ${s.startedAt}${s.finished ? ` to ${new Date().toISOString()}` : " (in progress)"}: ${outcome}. PASS ${counts.PASS}, CAPTURED (awaiting review) ${counts.CAPTURED}, FAIL ${counts.FAIL}, PARTIAL ${counts.PARTIAL}, SKIP ${counts.SKIP}.${script.card ? ` Card: ${script.card}.` : ""}`,
    ...(s.cleanupErrors.length ? ["", `**Cleanup failed:** ${s.cleanupErrors.join("; ")}`] : []),
    ...(s.halt ? ["", `**Halted (${s.halt.kind}):** ${s.halt.reason}`, ...s.halt.evidence.slice(0, 8).map((e) => `- ${e}`), "", s.remaining.length ? `Still to run: ${s.remaining.join(", ")} (resume.json has the command).` : ""] : []),
    "",
    "| Row | Title | Verdict | Why | Evidence | Telemetry |",
    "|---|---|---|---|---|---|",
    ...merged.map((r) => `| ${r.id} | ${r.title.replace(/\|/g, "/")} | ${r.verdict}${r.earlier?.length ? ` (attempt ${r.attempt}; earlier ${r.earlier.map((e) => e.verdict).join(", ")})` : ""} | ${(r.reason ?? "").replace(/\|/g, "/").slice(0, 300)}${r.judged_by && r.verdict !== "SKIP" ? ` (judged by ${r.judged_by})` : ""} | ${r.evidence.filter((e) => /\.full\.png$|sheet|manifest/.test(e)).length} files | ${r.telemetry ? `${r.telemetry.dir.replace(/\\/g, "/")} ${memory(r)}` : ""} |`),
    "",
    "## Attempts",
    "",
    ...attempts.map((a) => `- Attempt ${a.attempt} (${a.started_at}): ${a.outcome}${a.halt ? `, halted (${a.halt.kind}): ${a.halt.reason}` : ""}; ran ${a.rows_run.length} rows.`),
    "",
    ...(merged.some((r) => r.facts?.length) ? ["## Row facts", "", ...merged.filter((r) => r.facts?.length).map((r) => `- ${r.id}: ${r.facts!.map((f) => `${f.label} ${JSON.stringify(f.value)}`).join("; ")}`), ""] : []),
    "## Detours taken this attempt (the friction log's automatic part)",
    "",
    ...(thisAttempt.detours.length ? thisAttempt.detours.map((d) => `- ${d}`) : ["- none: every step took its first route"]),
    "",
    "## Key presses refused this attempt",
    "",
    ...(s.executor.refusals.length ? s.executor.refusals.map((r) => `- ${r.at}: ${r.keys} (${r.reason})`) : ["- none"]),
    "",
    "## Config",
    "",
    `- ${!s.config ? "no staged config.ini in the fixtures" : !s.configRestore ? "config.ini may still hold this run's values: the run hasn't finished" : s.configRestore.restored ? "config.ini was restored to its state before the run" : s.configRestore.reason === "unchanged by this run" ? "config.ini was not changed by this run" : `config.ini was NOT restored: ${s.configRestore.reason}`}`,
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

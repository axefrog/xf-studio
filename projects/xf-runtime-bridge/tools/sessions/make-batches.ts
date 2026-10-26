// Generates the schema-3 batch scripts (tools/session.ts, testing/batch.ts) from one place, so their repeated parts
// (setting the overlay's look live, opening the CET overlay with its capture-based check, the XF box set-up, photo
// mode's routes) stay consistent:
//
//   bun tools/sessions/make-batches.ts        writes st-styling.json and borg4-smoke.json beside this file
//
// st-styling.json: the test card's "In-game styling (0.8.22)" rows ST1-ST13, dark then light, as one unattended
// batch. What it anticipates, from what the Borg 4 session ran into and what 0.8.22 added since:
//   - the staged config has [overlay] enabled = false: every row requires enabled = true and diagnostics = true, so
//     the runner sets them once before the launch (config.set);
//   - theme, motion and drawing switch live (overlay.set, in memory): each row sets its own look first, so it holds
//     after any restart, checks overlay_state shows it, and waits 2.5 s for the CET window and line to repaint. An
//     overlay that was off at load answers needs_restart: that branch sets config.ini and restarts, then sets the
//     look again;
//   - the only restart left: read-only (allow_writes = false) is read at load. Stopped is bridge.kill, so the dark
//     stopped row comes last among the writes rows (its restart is the read-only one) and the light one ends the run;
//   - frame-generation modules are loaded here, so motion auto reads reduced: the pulse and settle rows set motion
//     full, ST3 reduced, and ST9a reads auto against frame generation on purpose;
//   - the CET overlay opens with the fixtures' cet_overlay_key (Ctrl+` here; the preflight checks CET's
//     bindings.json agrees); a capture-based comparison of the CET window's area before and after the key is the
//     alternative evidence when overlay.state's cet_open doesn't follow (ST13 checks it does);
//   - the CET window draws at the bottom left: the crop comes from host.window's regions.cet_window, derived from
//     the window size;
//   - the ink panel's answer flash (ST11) fires only in photo mode, with ui.hud modal, a waiting question, and Esc;
//   - answer_keys = IK_F6 only, required by every row;
//   - photo.open has its routes: the key (retried while the game isn't in front), the posted key, then a note asking
//     the player and a wait for photo mode;
//   - a question is answered with F6 (CET closed) or the CET window's button (the player, as the fallback);
//   - the XF box shows only while the HUD is hidden or the ink panel is off and CET is closed: its rows hide the
//     ink panel (ui.hud show false) and keep the CET line out (cet_label false); the CET line rows switch the XF
//     box off live (overlay.set enabled false);
//   - Paused is session.handover (the bridge pauses its changes) and session.resume;
//   - the Diagnostics header, CET's Reload all mods and the Windows animation setting need the player's hand: an
//     in-game question asks; ST9b and ST10 (alt-Enter) run only when the fixtures opt in.
// The teardown puts the overlay's live look back (the first overlay.set's undo) and restores config.ini.
// borg4-smoke.json: the Borg 4 PASS rows as a short regression smoke (B318-1, B318-3, B318-4, CS8181, DI2, DI3, CRS).

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeSteps, launchSteps } from "../testing/batch.ts";

type Json = Record<string, unknown>;
const key = (row: string, name: string) => `${row.replace(/[^A-Za-z0-9]/g, "_")}_${name}`;
const ref = (row: string, name: string, path = "") => `$${key(row, name)}${path ? `.${path}` : ""}`;
const CARD = "research/runtime/runtime-bridge-test-card.md#in-game-styling-0822";
const STUDIO = "XF · Studio's UI review (the style guide's In-game surfaces specimens)";

// ---- Config ---------------------------------------------------------------------------------------------------

type Theme = "dark" | "light";
type Motion = "auto" | "reduced" | "full";
const cfg = (pairs: Record<string, string>) => Object.entries(pairs).map(([config, equals]) => ({ config, equals }));
const common = { "ui.answer_keys": "IK_F6", "overlay.scale_percent": "100", "overlay.enabled": "true", "overlay.diagnostics": "true" };
/** What every ST row needs at load: the overlay on (so its look can switch live), and writes on or off. */
const atLoad = (writes = true) => cfg({ ...common, "bridge.allow_writes": String(writes) });
const cetKey = { binding: "cet.overlay_key", equals: "$fixture.cet_overlay_key" };

// ---- Repeated parts ----------------------------------------------------------------------------------------

/** In normal play: wait for it, or leave photo mode first. */
const inPlay = (row: string): Json => ({
  label: `${row}-play`, do: "run", command: "game.wait", input: { phase: "gameplay", timeout_ms: 20_000 }, deadline_ms: 25_000,
  alternatives: [[{ do: "run", command: "photo.exit", input: {} }, { do: "run", command: "game.wait", input: { phase: "gameplay", timeout_ms: 20_000 }, deadline_ms: 25_000 }]],
});
/** At the main menu or in play (read-only rows: the bridge can't load a save without writes). */
const atMenuOrPlay = (row: string): Json => ({ label: `${row}-ready`, do: "run", command: "game.wait", input: { phase: ["main_menu", "gameplay", "menu"], timeout_ms: 60_000 }, deadline_ms: 65_000 });
const windowOf = (row: string): Json => ({ label: `${row}-window`, do: "host.window", bind: "win" });

/**
 * The row's look, live: overlay.set, then overlay_state showing it in force (bound as <row>_overlay), then 2.5 s for
 * the CET window and line to take it with their next info refresh. needs_restart (an overlay off at load): set
 * config.ini, restart, and set the look again.
 */
const look = (row: string, theme: Theme, motion: Motion, enabled = true, writes = true): Json[] => {
  const input = { theme, motion, enabled, diagnostics: true };
  return [
    { label: `${row}-look`, do: "run", command: "overlay.set", input, bind: key(row, "look"),
      outcomes: [{ name: "needs_restart", match: { code: "needs_restart" }, run: [
        { do: "note", text: `${row}: the overlay was off at load, so it can't switch live: config.ini gets it and the game restarts once.` },
        { do: "config.set", values: { "overlay.enabled": "true", "overlay.diagnostics": "true" } },
        ...closeSteps(), ...launchSteps(writes),
        { do: "run", command: "overlay.set", input, bind: key(row, "look") },
      ] }] },
    { label: `${row}-in-force`, do: "run", command: "overlay.state", input: {}, until: { all: [{ path: "theme", equals: theme }, { path: "motion.setting", equals: motion }] },
      interval_ms: 250, deadline_ms: 3000, bind: key(row, "overlay") },
    { label: `${row}-repaint`, do: "wait", ms: 2500 },
    // The window's size, for the crops of this row's captures and bursts (regions.xf_box, cet_line, cet_window, ink_panel).
    { label: `${row}-look-window`, do: "host.window", bind: "win" },
  ];
};

/** A guarded key: retried while the game isn't in front, then a note to the player and a longer patient retry. */
const press = (label: string, keys: string, extra: Json = {}): Json => ({
  label, do: "host.key", keys, retry: { times: 2, backoff_ms: 1500, on: { code: "not_foreground" } },
  outcomes: [{ name: "game_behind", match: { code: "not_foreground" }, run: [
    { do: "note", text: "The game isn't the front window, so the runner's key press was held back: click into the game window." },
    { do: "host.key", keys, retry: { times: 10, backoff_ms: 3000, factor: 1, on: { code: "not_foreground" } } },
  ] }],
  ...extra,
});

/** Opens the CET overlay and confirms it: overlay.state's cet_open, or else a capture of the CET window's area that differs from before. */
const cetOpen = (row: string): Json[] => [
  { label: `${row}-cet-before`, do: "capture", name: `${row}-cet-before`, clear_overlay: false, bind: key(row, "cetBefore") },
  press(`${row}-cet-key`, "$fixture.cet_overlay_key"),
  { label: `${row}-cet-flag`, do: "set", value: true, bind: "cetOpen" },
  { label: `${row}-cet-seen`, do: "run", command: "overlay.state", input: {}, until: { path: "cet_open", equals: true }, interval_ms: 250, deadline_ms: 2000, bind: key(row, "cetState"),
    alternatives: [[
      { do: "wait", ms: 500 },
      { do: "capture", name: `${row}-cet-check`, clear_overlay: false, bind: key(row, "cetCheck") },
      { do: "capture.compare", a: ref(row, "cetBefore"), b: ref(row, "cetCheck"), rect: "$win.regions.cet_window", min_changed: 0.15, bind: key(row, "cetSeen") },
    ]] },
];
/** Closes the CET overlay if this run opened it (cleanup: always). */
const cetClose = (row: string, label = "cet-close"): Json[] => [
  { label: `${row}-${label}`, do: "host.key", keys: "$fixture.cet_overlay_key", when: { match: { ref: "$cetOpen", equals: true } }, retry: { times: 3, backoff_ms: 2000, on: { code: "not_foreground" } } },
  { label: `${row}-${label}-flag`, do: "set", value: false, bind: "cetOpen" },
];
/** A full capture plus its crop to the CET window (both evidence). */
const cetShot = (row: string, name: string, bind: string): Json[] => [
  { label: `${row}-${name}`, do: "capture", name, clear_overlay: false, bind: key(row, bind) },
  { label: `${row}-${name}-crop`, do: "run", command: "capture.recrop", input: { path: ref(row, bind, "full.path"), rect: "$win.regions.cet_window", name: `${name}-crop` }, on_fail: "continue" },
];
/** The XF box as the status surface: ink panel off, CET line off (CET closed). */
const xfBox = (row: string): Json[] => [
  { label: `${row}-xfbox`, do: "run", command: "ui.hud", input: { show: false, cet_label: false }, bind: key(row, "hud") },
];
/** The CET line as the status surface: the XF box off (live), the ink panel off, the line on. */
const cetLine = (row: string): Json => ({ label: `${row}-line`, do: "run", command: "ui.hud", input: { show: false, cet_label: true }, bind: key(row, "hud") });
const hudBack = (row: string): Json => ({ label: `${row}-hud-back`, do: "run", command: "ui.hud", input: { reset: true } });
const overlayState = (row: string, name = "overlay"): Json => ({ label: `${row}-${name}`, do: "run", command: "overlay.state", input: {}, bind: key(row, name) });
const captured = (label: string, row: string, bind: string) => ({ label, ref: ref(row, bind), captured: true });
const check = (label: string, row: string, bind: string, path: string, match: Json) => ({ label, ref: ref(row, bind, path), match });
const resume = (row: string): Json => ({ label: `${row}-resume`, do: "run", command: "session.resume", input: {} });

// ---- The ST rows -------------------------------------------------------------------------------------------

/** Motion auto against frame generation, the CET line under it, the Windows half of ST9 (opt-in), and ST13's cet_open. */
function firstRows(): Json[] {
  const requires = [...atLoad(), cetKey];
  let row = "ST9a-dark";
  const rows: Json[] = [{ id: row, title: "Motion auto with frame generation loaded reads reduced (ST9, the frame-generation half)", requires,
    steps: [inPlay(row), ...look(row, "dark", "auto")],
    pass: [check("setting auto", row, "overlay", "motion.setting", { equals: "auto" }), check("reduced", row, "overlay", "motion.effective", { equals: "reduced" }),
      check("because of frame generation", row, "overlay", "motion.reason", { equals: "frame_generation" }), check("frame-generation modules listed", row, "overlay", "frame_generation_modules.0", { exists: true })] }];
  row = "ST8-dark-auto";
  rows.push({ id: row, title: "CET line connected with motion auto under frame generation: a still dot (the Borg 4 ST8 repeat)", requires, judged_by: STUDIO,
    steps: [inPlay(row), ...look(row, "dark", "auto", false), cetLine(row),
      { label: `${row}-burst`, do: "burst", name: "ST8-cetline-connected-auto-dark", frames: 6, interval_ms: 240, clear_overlay: false, rect: "$win.regions.cet_line", bind: key(row, "burst") }],
    pass: [captured("the still dot", row, "burst")], cleanup: [hudBack(row)] });
  row = "ST9b-dark";
  rows.push({ id: row, title: "Motion auto follows Windows' Animation effects within 2 s (ST9, the Windows half; the player changes the setting)",
    requires: [...requires, { fixture: "allow_windows_animation_check", note: "the player turns Windows' Animation effects off and back; set allow_windows_animation_check in the fixtures to run it" }],
    steps: [inPlay(row), ...look(row, "dark", "auto"),
      { label: `${row}-off`, do: "ask", text: "ST9: please turn Windows' Settings > Accessibility > Visual effects > Animation effects OFF, then press Done.", choices: ["Done"], deadline_ms: 300_000 },
      { label: `${row}-follows`, do: "run", command: "overlay.state", input: {}, until: { path: "motion.reason", equals: "windows_animations_off" }, interval_ms: 500, deadline_ms: 5000, bind: key(row, "off"), on_fail: "fail_row" },
      { label: `${row}-on`, do: "ask", text: "ST9: thank you. Please turn Animation effects back ON, then press Done.", choices: ["Done"], deadline_ms: 300_000, on_fail: "continue" }],
    pass: [check("reduced by Windows", row, "off", "motion.reason", { equals: "windows_animations_off" })] });
  row = "ST13-dark";
  const state = (name: string): Json => ({ label: `${row}-${name}`, do: "run", command: "overlay.state", input: {}, bind: key(row, name) });
  rows.push({ id: row, title: "cet_open follows CET's overlay with the XF box off: false, true, false, then true after CET's Reload all mods", requires,
    steps: [inPlay(row), ...look(row, "dark", "full", false), state("closed1"),
      press(`${row}-open`, "$fixture.cet_overlay_key"), { label: `${row}-opened`, do: "set", value: true, bind: "cetOpen" }, { label: `${row}-w1`, do: "wait", ms: 700 }, state("open1"),
      ...cetClose(row, "close1"), { label: `${row}-w2`, do: "wait", ms: 700 }, state("closed2"),
      press(`${row}-open2`, "$fixture.cet_overlay_key"), { label: `${row}-opened2`, do: "set", value: true, bind: "cetOpen" },
      // The answer comes before the reload (a reload rebuilds the XF Runtime Bridge window and its question).
      { label: `${row}-reload`, do: "ask", text: "ST13: press Done, then within 10 s press Reload all mods in the CET overlay (leave the overlay open).", choices: ["Done"], deadline_ms: 180_000 },
      { label: `${row}-reloading`, do: "wait", ms: 12_000 },
      { label: `${row}-after-reload`, do: "run", command: "overlay.state", input: {}, until: { path: "cet_open", equals: true }, interval_ms: 500, deadline_ms: 8000, bind: key(row, "reloaded"), on_fail: "continue" }],
    pass: [check("closed: false", row, "closed1", "cet_open", { equals: false }), check("open: true", row, "open1", "cet_open", { equals: true }),
      check("closed again: false", row, "closed2", "cet_open", { equals: false }), check("after the reload, open: true", row, "reloaded", "cet_open", { equals: true })],
    cleanup: [...cetClose(row)] });
  return rows;
}

/** The rows with changes allowed, for one theme, all switched live. */
function writesRows(theme: Theme): Json[] {
  const rows: Json[] = [];
  const requires = [...atLoad(), cetKey];
  let row = `ST8-${theme}-connected`;
  rows.push({ id: row, title: `CET line, connected, motion full (${theme})`, requires, judged_by: STUDIO,
    steps: [inPlay(row), ...look(row, theme, "full", false), cetLine(row),
      { label: `${row}-burst`, do: "burst", name: `ST8-cetline-connected-${theme}`, frames: 12, interval_ms: 200, clear_overlay: false, rect: "$win.regions.cet_line", bind: key(row, "burst") }],
    pass: [check("motion full in force", row, "overlay", "motion.effective", { equals: "full" }), captured("the pulse burst", row, "burst")],
    cleanup: [hudBack(row)] });
  row = `ST8-${theme}-paused`;
  rows.push({ id: row, title: `CET line, paused (${theme})`, requires, judged_by: STUDIO,
    steps: [inPlay(row), ...look(row, theme, "full", false), cetLine(row),
      { label: `${row}-pause`, do: "run", command: "session.handover", input: { note: `${row}: the paused CET line`, restore_ui: false } },
      { label: `${row}-wait`, do: "wait", ms: 800 },
      { label: `${row}-shot`, do: "capture", name: `ST8-cetline-paused-${theme}`, clear_overlay: false, bind: key(row, "shot") }],
    pass: [captured("the paused line", row, "shot")],
    cleanup: [resume(row), hudBack(row)] });

  const n = theme === "dark" ? "ST1" : "ST2";
  row = `${n}-${theme}`;
  rows.push({ id: row, title: `The XF box with diagnostics, motion full (${theme})`, requires, judged_by: STUDIO,
    steps: [inPlay(row), ...look(row, theme, "full"), ...xfBox(row),
      // The question shows in the box while it is captured (the card's "the question and its keys"); the player's answer is the visibility check.
      { label: `${row}-ask-and-shoot`, together: [
        { do: "ask", text: `${n}: is the XF box fully visible, or partly cut off?`, choices: ["Fully visible", "Partly cut off"], deadline_ms: 90_000, bind: key(row, "answer"), on_fail: "continue" },
        { sequence: [{ do: "wait", ms: 800 }, { do: "capture", name: `${n}-xfbox-diagnostics-${theme}`, clear_overlay: false, bind: key(row, "shot") }] },
      ] }],
    pass: [check("the overlay draws", row, "overlay", "drawing_now", { equals: true }), check(`theme ${theme}`, row, "overlay", "theme", { equals: theme }),
      check("motion full", row, "overlay", "motion.effective", { equals: "full" }), captured("the XF box", row, "shot"),
      check("the player saw it whole", row, "answer", "label", { equals: "Fully visible" })],
    cleanup: [{ label: `${row}-clear`, do: "run", command: "ui.message", input: { clear: true } }, hudBack(row)] });

  row = `ST4-${theme}-changes`;
  rows.push({ id: row, title: `The dot's pulse with changes allowed, motion full (${theme})`, requires, judged_by: STUDIO,
    steps: [inPlay(row), ...look(row, theme, "full"), ...xfBox(row),
      { label: `${row}-burst`, do: "burst", name: `ST4-xfbox-pulse-changes-${theme}`, frames: 12, interval_ms: 200, clear_overlay: false, rect: "$win.regions.xf_box", bind: key(row, "burst") }],
    pass: [check("motion full", row, "overlay", "motion.effective", { equals: "full" }), captured("the pulse burst (12 x 200 ms, one 2.4 s period)", row, "burst")],
    cleanup: [hudBack(row)] });

  row = `ST5-${theme}`;
  rows.push({ id: row, title: `The settle on a change of state, and none for a second change within 2 s (${theme})`, requires, judged_by: STUDIO,
    steps: [inPlay(row), ...look(row, theme, "full"), ...xfBox(row),
      { label: `${row}-change`, together: [
        { do: "burst", name: `ST5-xfbox-settle-${theme}`, frames: 20, interval_ms: 100, clear_overlay: false, rect: "$win.regions.xf_box", bind: key(row, "burst") },
        { sequence: [{ do: "wait", ms: 300 }, { do: "run", command: "session.handover", input: { note: `${row}: settle`, restore_ui: false } }, { do: "wait", ms: 700 }, { do: "run", command: "session.resume", input: {} }] },
      ] }],
    pass: [check("motion full", row, "overlay", "motion.effective", { equals: "full" }), captured("the settle burst (change at 0.3 s, second change at 1.0 s)", row, "burst"),
      // The handover in the same beat must not cut the burst short: every frame, over the whole span.
      check("all 20 frames", row, "burst", "frames.19", { exists: true }), check("over about 2 s", row, "burst", "timing.first_to_last_ms", { min: 1700 })],
    cleanup: [resume(row), hudBack(row)] });

  row = `ST6-${theme}-chips`;
  rows.push({ id: row, title: `The chips: Changes allowed, then Paused (${theme})`, requires, judged_by: STUDIO,
    steps: [inPlay(row), ...look(row, theme, "full"), windowOf(row), ...cetOpen(row), ...cetShot(row, `ST6-cet-chip-changes-${theme}`, "changes"),
      { label: `${row}-pause`, do: "run", command: "session.handover", input: { note: `${row}: the Paused chip`, restore_ui: false } },
      { label: `${row}-wait`, do: "wait", ms: 800 },
      ...cetShot(row, `ST6-cet-chip-paused-${theme}`, "paused")],
    pass: [captured("Changes allowed", row, "changes"), captured("Paused", row, "paused")],
    cleanup: [resume(row), ...cetClose(row)] });

  row = `ST7-${theme}-running`;
  rows.push({ id: row, title: `The CET window running with changes allowed, and the disabled Send (ST12) (${theme})`, requires, judged_by: STUDIO,
    steps: [inPlay(row), ...look(row, theme, "full"), windowOf(row), ...cetOpen(row), ...cetShot(row, `ST7-cet-running-${theme}`, "running")],
    pass: [captured("the window", row, "running")],
    cleanup: [...cetClose(row)] });

  row = `ST7-${theme}-question`;
  rows.push({ id: row, title: `The CET window: a question waiting (it breathes), then answered with F6 (${theme})`, requires, judged_by: STUDIO,
    steps: [inPlay(row), ...look(row, theme, "full"), windowOf(row), ...cetOpen(row),
      { label: `${row}-cursor`, do: "cursor", bind: key(row, "cursor") },
      { label: `${row}-ask`, do: "run", command: "ui.message", input: { level: "ask", text: `${row}: a waiting question (the runner answers it with F6).`, choices: ["First", "Second", "Third"], seconds: 180 }, bind: key(row, "q") },
      { label: `${row}-wait1`, do: "wait", ms: 600 },
      ...cetShot(row, `ST7-cet-question-a-${theme}`, "qa"),
      { label: `${row}-wait2`, do: "wait", ms: 1200 },
      ...cetShot(row, `ST7-cet-question-b-${theme}`, "qb"),
      { label: `${row}-breathes`, do: "capture.compare", a: ref(row, "qa"), b: ref(row, "qb"), rect: "$win.regions.cet_window", bind: key(row, "breath"), on_fail: "continue" },
      ...cetClose(row),
      press(`${row}-f6`, "F6"),
      { label: `${row}-answer`, do: "await", cursor: ref(row, "cursor"), kind: "answer", message_id: ref(row, "q", "id"), timeout_s: 8, bind: key(row, "answer"),
        alternatives: [[
          { do: "note", text: `${row}: F6 didn't answer the question. Please answer it: F6, or the first answer's button in the XF Runtime Bridge window (CET overlay).` },
          { do: "await", cursor: ref(row, "cursor"), kind: "answer", message_id: ref(row, "q", "id"), timeout_s: 120, bind: key(row, "answer") },
        ]] },
      { label: `${row}-window2`, do: "host.window", bind: "win" },
      press(`${row}-reopen`, "$fixture.cet_overlay_key"),
      { label: `${row}-reopened`, do: "set", value: true, bind: "cetOpen" },
      { label: `${row}-settle`, do: "wait", ms: 700 },
      ...cetShot(row, `ST7-cet-answered-${theme}`, "answered")],
    pass: [captured("waiting (first)", row, "qa"), captured("waiting (1.2 s later)", row, "qb"),
      check("the waiting card breathes (the two frames differ in the window)", row, "breath", "changed_fraction", { min: 0.00001 }),
      check("answered", row, "answer", "complete", { equals: true }), captured("answered", row, "answered")],
    cleanup: [{ label: `${row}-clear`, do: "run", command: "ui.message", input: { clear: true } }, ...cetClose(row)] });

  row = `ST7-${theme}-diagnostics`;
  rows.push({ id: row, title: `The CET window with the DIAGNOSTICS header open (${theme}; the player opens it)`, requires, judged_by: STUDIO,
    steps: [inPlay(row), ...look(row, theme, "full"), windowOf(row), ...cetOpen(row),
      { label: `${row}-ask`, do: "ask", text: `${row}: please click the DIAGNOSTICS header in the XF Runtime Bridge window to open it, then press Done.`, choices: ["Done"], deadline_ms: 180_000 },
      { label: `${row}-settle`, do: "wait", ms: 500 },
      ...cetShot(row, `ST7-cet-diagnostics-${theme}`, "diag")],
    pass: [captured("Diagnostics open", row, "diag")],
    cleanup: [...cetClose(row)] });

  row = `ST11-${theme}`;
  rows.push({ id: row, title: `The ink panel's answer flash in photo mode (modal, a waiting question, Esc) (${theme})`, requires, judged_by: STUDIO,
    steps: [inPlay(row), ...look(row, theme, "full"),
      { label: `${row}-photo`, do: "run", command: "photo.open", input: {}, deadline_ms: 12_000, retry: { times: 2, backoff_ms: 2000, on: { code: "not_foreground" } },
        alternatives: [
          [{ do: "run", command: "photo.open", input: { route: "postmessage" }, deadline_ms: 12_000 }],
          [{ do: "note", text: `${row}: please open photo mode (your photo-mode key); the runner waits.` }, { do: "run", command: "game.wait", input: { phase: "photo_mode", timeout_ms: 120_000 }, deadline_ms: 125_000 }],
        ] },
      { label: `${row}-prefs`, do: "wait", ms: 2000 },
      { label: `${row}-modal`, do: "run", command: "ui.hud", input: { show: true, modal: true, layer: "photo_menu" }, bind: key(row, "hud") },
      { label: `${row}-ask`, do: "run", command: "ui.message", input: { level: "ask", text: `${row}: the answers flash when Esc is pressed (no answer needed).`, choices: ["Yes", "No"], seconds: 120 }, bind: key(row, "q") },
      { label: `${row}-wait`, do: "wait", ms: 600 },
      { label: `${row}-flash`, together: [
        { do: "burst", name: `ST11-ink-flash-${theme}`, frames: 14, interval_ms: 50, clear_overlay: false, rect: "$win.regions.ink_panel", bind: key(row, "burst") },
        { sequence: [{ do: "wait", ms: 150 }, press(`${row}-esc`, "Esc")] },
      ] },
      { label: `${row}-held`, do: "run", command: "game.status", input: {}, bind: key(row, "after") }],
    pass: [captured("the flash burst (14 x 50 ms)", row, "burst"), check("modal held photo mode's exit", row, "after", "phase", { equals: "photo_mode" })],
    cleanup: [{ label: `${row}-clear`, do: "run", command: "ui.message", input: { clear: true } }, { label: `${row}-unmodal`, do: "run", command: "ui.hud", input: { modal: false } }, hudBack(row),
      { label: `${row}-exit`, do: "run", command: "photo.exit", input: {}, when: { check: { do: "run", command: "game.status", input: {} }, match: { path: "phase", equals: "photo_mode" } } }] });

  if (theme === "dark") {
    row = "ST10-dark";
    rows.push({ id: row, title: "Fonts baked once: overlay.state across a window-mode change (alt-Enter twice)", requires: [...requires, { fixture: "allow_alt_enter", note: "alt-Enter changes the window mode; set allow_alt_enter in the fixtures to run it" }],
      steps: [inPlay(row), ...look(row, theme, "full"), ...xfBox(row), overlayState(row, "before"), press(`${row}-toggle`, "Alt+Enter"), { label: `${row}-w1`, do: "wait", ms: 5000 }, overlayState(row, "mid"),
        press(`${row}-back`, "Alt+Enter"), { label: `${row}-w2`, do: "wait", ms: 5000 }, overlayState(row, "after"), windowOf(row)],
      pass: [check("a resize was seen", row, "after", "resizes", { min: 1 }), check("frames kept rising", row, "after", "frames", { min: ref(row, "mid", "frames") }),
        check("still drawing", row, "after", "drawing_now", { equals: true })],
      cleanup: [hudBack(row)] });
  }

  row = `ST3-${theme}`;
  rows.push({ id: row, title: `The XF box with motion reduced: a still dot, no settle (${theme})`, requires, judged_by: STUDIO,
    steps: [inPlay(row), ...look(row, theme, "reduced"), ...xfBox(row),
      { label: `${row}-still`, do: "burst", name: `ST3-xfbox-reduced-${theme}`, frames: 6, interval_ms: 240, clear_overlay: false, rect: "$win.regions.xf_box", bind: key(row, "still") },
      { label: `${row}-change`, together: [
        { do: "burst", name: `ST3-xfbox-reduced-settle-${theme}`, frames: 10, interval_ms: 100, clear_overlay: false, rect: "$win.regions.xf_box", bind: key(row, "settle") },
        { sequence: [{ do: "wait", ms: 300 }, { do: "run", command: "session.handover", input: { note: `${row}: no settle under reduced`, restore_ui: false } }, { do: "wait", ms: 400 }, { do: "run", command: "session.resume", input: {} }] },
      ] }],
    pass: [check("motion reduced", row, "overlay", "motion.effective", { equals: "reduced" }), check("by the setting", row, "overlay", "motion.reason", { equals: "setting" }),
      captured("still dot (6 x 240 ms)", row, "still"), captured("no wash on a change", row, "settle"),
      check("all 10 settle frames", row, "settle", "frames.9", { exists: true }), check("over about 1 s", row, "settle", "timing.first_to_last_ms", { min: 800 })],
    cleanup: [resume(row), hudBack(row)] });
  return rows;
}

/** Stopped: the CET window with Reconnect and the Stopped chip (ST7, ST6), then the stopped CET line (ST8), from one bridge.kill. */
function stoppedRow(theme: Theme, writes: boolean): Json {
  const row = `ST7-${theme}-stopped`;
  return { id: row, title: `Stopped (one bridge.kill): the CET window with Reconnect, the Stopped chip, the stopped CET line (ST7, ST6, ST8) (${theme})`,
    requires: [...atLoad(writes), cetKey], judged_by: STUDIO, ...(writes ? { after: "restart" } : {}),
    steps: [writes ? inPlay(row) : atMenuOrPlay(row), ...look(row, theme, "full", false, writes), cetLine(row), windowOf(row), ...cetOpen(row),
      { label: `${row}-kill`, do: "run", command: "bridge.kill", input: {} }, { label: `${row}-wait`, do: "wait", ms: 800 },
      ...cetShot(row, `ST7-cet-stopped-${theme}`, "stopped"), ...cetShot(row, `ST6-cet-chip-stopped-${theme}`, "chip"),
      ...cetClose(row, "cet-close-for-line"), { label: `${row}-line-wait`, do: "wait", ms: 800 },
      { label: `${row}-line-shot`, do: "capture", name: `ST8-cetline-stopped-${theme}`, clear_overlay: false, bind: key(row, "line") }],
    pass: [captured("stopped, with Reconnect", row, "stopped"), captured("the Stopped chip", row, "chip"), captured("the stopped CET line", row, "line")],
    cleanup: [...cetClose(row)] };
}

/** Read-only (the one restart: allow_writes is read at load): the chip, the window, the pulse; at the main menu. */
function readOnlyRows(theme: Theme): Json[] {
  const requires = [...atLoad(false), cetKey];
  let row = `ST6-${theme}-readonly`;
  const rows: Json[] = [{ id: row, title: `Read-only: the chip and the CET window running read-only (ST6, ST7) (${theme}; at the menu)`, requires, judged_by: STUDIO,
    steps: [atMenuOrPlay(row), ...look(row, theme, "full", true, false), windowOf(row), ...cetOpen(row), ...cetShot(row, `ST6-cet-chip-readonly-${theme}`, "chip"), ...cetShot(row, `ST7-cet-running-readonly-${theme}`, "running")],
    pass: [captured("Read-only chip", row, "chip"), captured("running read-only", row, "running")],
    cleanup: [...cetClose(row)] }];
  row = `ST4-${theme}-readonly`;
  rows.push({ id: row, title: `The dot's pulse, connected and read-only, motion full (${theme}; the XF box at the menu)`, requires, judged_by: STUDIO,
    steps: [atMenuOrPlay(row), ...look(row, theme, "full", true, false),
      { label: `${row}-burst`, do: "burst", name: `ST4-xfbox-pulse-readonly-${theme}`, frames: 12, interval_ms: 200, clear_overlay: false, rect: "$win.regions.xf_box", bind: key(row, "burst") }],
    pass: [check("motion full", row, "overlay", "motion.effective", { equals: "full" }), check("the XF box draws", row, "overlay", "drawing_now", { equals: true }), captured("the pulse burst", row, "burst")] });
  return rows;
}

function stScript(): Json {
  return {
    schema: "xfb/session-script-3",
    name: "st-styling-0822",
    title: "In-game styling (0.8.22): ST1-ST13, dark then light, the look switched live",
    card: CARD,
    requires: [
      "The XF test profile with the bridge's autonomous -writes build staged (0.8.22 with overlay.set); the runner sets config.ini's [overlay] enabled and diagnostics once and restores the file at the end.",
      "A private fixtures file (--fixtures): mo2 {exe, profile, executable, arguments: -skipStartScreen}, game_dir, staged_mod, save, cet_overlay_key (Ctrl+` here), commit_floor_gb.",
      "Borderless windowed, the game window in front; Windows' Do Not Disturb on (focus-taking toasts stopped the Borg 4 key press).",
      "Captures are evidence for XF · Studio's UI review; a PASS here means the state and the capture, not the design verdict.",
    ],
    setup: [
      { label: "cet-closed", do: "set", value: false, bind: "cetOpen" },
      { label: "commit", do: "host.commit", on_fail: "stop" },
    ],
    rows: [...firstRows(), ...writesRows("dark"), ...writesRows("light"), stoppedRow("dark", true), ...readOnlyRows("dark"), ...readOnlyRows("light"), stoppedRow("light", false)],
    teardown: [{ label: "cet", do: "host.key", keys: "$fixture.cet_overlay_key", when: { match: { ref: "$cetOpen", equals: true } } }],
  };
}

// ---- The Borg 4 regression smoke ---------------------------------------------------------------------------

function smokeScript(): Json {
  const writes = cfg({ "bridge.allow_writes": "true" });
  const quiet = { phase: "gameplay", combat: false, vehicle: false };
  const rows: Json[] = [];
  // B318-1 owns no session time: it is judged at the end over the batch's always-on recorder (every channel, every
  // row), so a soak never makes the player watch V stand still.
  let row = "B318-1";
  rows.push({ id: row, title: "No invalid heartbeats over the whole batch: every channel's samples valid, no coverage gaps (passive, judged at the end)", passive: "whole-batch",
    steps: [{ label: `${row}-telemetry`, do: "set", value: "$telemetry", bind: key(row, "all") }],
    pass: [
      check("the recorder ran and was read", row, "all", "runs.0", { exists: true }),
      check("every page read (no catch-up refused)", row, "all", "unread", { equals: [] }),
      check("no invalid samples", row, "all", "coverage.invalid", { equals: 0 }),
      ...["subtitles", "voice", "face", "ui"].map((ch) => ({ label: `${ch}: no invalid samples`, ref: ref(row, "all"), match: { any: [{ path: `channels.${ch}.invalid`, equals: 0 }, { path: `channels.${ch}`, exists: false }] } })),
      check("no gaps", row, "all", "gaps", { equals: [] }),
    ],
    facts: [
      { label: "runs", ref: ref(row, "all", "runs") }, { label: "pages", ref: ref(row, "all", "pages") }, { label: "gaps", ref: ref(row, "all", "gaps") },
      { label: "coverage loss", ref: ref(row, "all", "coverage") }, { label: "invalid samples by row", ref: ref(row, "all", "invalid_in") }, { label: "gaps by row", ref: ref(row, "all", "gaps_in") },
    ] });

  row = "B318-3";
  rows.push({ id: row, title: "phone.call auto_answer: answered with no key press, the call ends by itself", requires: writes,
    steps: [inPlay(row), { label: `${row}-cursor`, do: "cursor", bind: key(row, "cursor") },
      { label: `${row}-call`, do: "run", command: "phone.call", input: { contact: "coach", auto_answer: true, ring_s: 30, lines: [{ text: "Smoke check: this call answers itself." }], when: quiet }, bind: key(row, "call"),
        retry: { times: 3, backoff_ms: 5000, on: { code: "precondition_failed" } } },
      // The call's whole life in the event feed: rung, answered by the bridge, ended by itself (its lines done), all for this call.
      { label: `${row}-window`, do: "events", cursor: ref(row, "cursor"), duration_s: 25, bind: key(row, "window") },
      { label: `${row}-state`, do: "run", command: "phone.state", input: {}, bind: key(row, "state") }],
    pass: [
      { label: "answered by the bridge, this call", ref: ref(row, "window"), match: { path: "events", some: { all: [{ path: "kind", equals: "dm.phone" }, { path: "data.what", equals: "auto_answer" }, { path: "data.call", equals: ref(row, "call", "call") }] } } },
      // Ended by itself, and never missed, declined, failed or hung up on the way.
      { label: "ended by itself, this call", ref: ref(row, "window"), match: { all: [
        { path: "events", some: { all: [{ path: "kind", equals: "dm.phone" }, { path: "data.what", equals: "ended" }, { path: "data.call", equals: ref(row, "call", "call") }] } },
        { not: { path: "events", some: { all: [{ path: "data.call", equals: ref(row, "call", "call") }, { path: "data.what", one_of: ["missed", "declined", "failed", "hung_up"] }] } } },
      ] } },
    ],
    cleanup: [{ label: `${row}-end`, do: "run", command: "phone.end", input: {} }] });

  row = "B318-4";
  rows.push({ id: row, title: "The XF panel hides while the call widget is up", requires: writes,
    steps: [inPlay(row), { label: `${row}-panel`, do: "run", command: "ui.hud", input: { show: true } },
      { label: `${row}-call`, do: "run", command: "phone.call", input: { contact: "coach", auto_answer: false, ring_s: 20, lines: [{ text: "Smoke check: ringing." }], when: quiet }, retry: { times: 3, backoff_ms: 5000, on: { code: "precondition_failed" } } },
      { label: `${row}-ringing`, do: "run", command: "ui.state", input: {}, until: { path: "phone_open", equals: true }, interval_ms: 500, deadline_ms: 10_000, bind: key(row, "ui"), on_fail: "fail_row" },
      { label: `${row}-shot`, do: "capture", name: "B318-4-ringing", clear_overlay: false, bind: key(row, "shot") }],
    pass: [check("phone_open while ringing", row, "ui", "phone_open", { equals: true }), captured("the ringing widget, uncovered", row, "shot")],
    cleanup: [{ label: `${row}-end`, do: "run", command: "phone.end", input: {} }, hudBack(row)] });

  row = "CS8181";
  rows.push({ id: row, title: "A hostile melee fighter engages by itself", requires: writes,
    steps: [inPlay(row), { label: `${row}-health`, do: "run", command: "player.status", input: {}, bind: key(row, "before") },
      { label: `${row}-cursor`, do: "cursor", bind: key(row, "cursor") },
      { label: `${row}-spawn`, do: "run", command: "npc.spawn", input: { cast: "fighter_melee", ahead_m: 8, attitude: "hostile", reactions: "game" }, bind: key(row, "fighter"),
        alternatives: [[{ do: "run", command: "npc.spawn", input: { cast: "fighter_melee", ahead_m: 6, attitude: "hostile", reactions: "game" }, bind: key(row, "fighter") }]] },
      { label: `${row}-engaged`, do: "await", cursor: ref(row, "cursor"), kind: "npc.handed_back", subject: ref(row, "fighter", "who"), timeout_s: 30, bind: key(row, "engaged"), on_fail: "fail_row" }],
    pass: [check("handed back to the game's combat", row, "engaged", "complete", { equals: true })],
    cleanup: [{ label: `${row}-release`, do: "run", command: "npc.release", input: { who: ref(row, "fighter", "who"), how: "despawn" }, when: { match: { ref: ref(row, "fighter"), exists: true } } }] });

  // beforeDeclare runs once the actors stand and before the incident is declared (DI3 turns V away there).
  // Actors appear over a few frames after npc.spawn answers (an action on one before its npc.spawned is refused
  // npc_not_spawned), so the fixture waits for both npc.spawned events before it declares or moves anyone.
  const fixture = (r: string, id: string, beforeDeclare: Json[] = []): Json[] => [
    // One cursor per wait: a wait advances its cursor past what it read, which would hide the other actor's event.
    { label: `${r}-spawn-cursor-mark`, do: "cursor", bind: key(r, "markCursor") },
    { label: `${r}-spawn-cursor-thief`, do: "cursor", bind: key(r, "thiefCursor") },
    { label: `${r}-mark`, do: "run", command: "npc.spawn", input: { cast: "woman_corpo", ahead_m: 7, side_m: -1.5, label: "Mark" }, bind: key(r, "mark") },
    { label: `${r}-thief`, do: "run", command: "npc.spawn", input: { cast: "man_lowlife", ahead_m: 7, side_m: 2.5, label: "Thief" }, bind: key(r, "thief") },
    { label: `${r}-mark-in`, do: "await", cursor: ref(r, "markCursor"), kind: "npc.spawned", subject: ref(r, "mark", "who"), timeout_s: 20, bind: key(r, "markIn") },
    { label: `${r}-thief-in`, do: "await", cursor: ref(r, "thiefCursor"), kind: "npc.spawned", subject: ref(r, "thief", "who"), timeout_s: 20, bind: key(r, "thiefIn") },
    ...beforeDeclare,
    // An id is refused (duplicate_id) while the bridge remembers it: a second id is the other route.
    { label: `${r}-declare`, do: "run", command: "incidents.declare", input: { id, kind: "pickpocket", roles: { [ref(r, "thief", "who")]: "thief", [ref(r, "mark", "who")]: "mark" }, ttl_s: 45 }, bind: key(r, "declared"),
      alternatives: [[{ do: "run", command: "incidents.declare", input: { id: `${id}b`, kind: "pickpocket", roles: { [ref(r, "thief", "who")]: "thief", [ref(r, "mark", "who")]: "mark" }, ttl_s: 45 }, bind: key(r, "declared") }]] },
    { label: `${r}-cursor`, do: "cursor", bind: key(r, "cursor") },
    { label: `${r}-take`, do: "run", command: "npc.move", input: { who: ref(r, "thief", "who"), to: ref(r, "mark", "who"), stop_m: 0.8 } },
    { label: `${r}-arrived`, do: "await", cursor: ref(r, "cursor"), kind: "npc.arrived", subject: ref(r, "thief", "who"), timeout_s: 30, bind: key(r, "arrived") },
    { label: `${r}-line`, do: "run", command: "npc.say", input: { who: ref(r, "thief", "who"), text: "(lifts the wallet)", style: "overhead", seconds: 3 } },
    { label: `${r}-turn`, do: "run", command: "npc.turn", input: { who: ref(r, "thief", "who"), to: "v" }, on_fail: "continue" },
    { label: `${r}-beat`, do: "wait", ms: 4000 },
    { label: `${r}-close`, do: "run", command: "incidents.close", input: { id: ref(r, "declared", "id") }, bind: key(r, "closed") },
  ];
  const release = (r: string): Json[] => ["thief", "mark"].map((who) => ({ label: `${r}-release-${who}`, do: "run", command: "npc.release", input: { who: ref(r, who, "who"), how: "despawn" }, when: { match: { ref: ref(r, who), exists: true } } }));
  row = "DI2";
  rows.push({ id: row, title: "A declared pickpocketing, seen: one witness.report", requires: writes,
    steps: [inPlay(row), ...fixture(row, "pp-smoke-2"), { label: `${row}-list`, do: "run", command: "incidents.list", input: { declared: true, limit: 8 }, bind: key(row, "list") }],
    pass: [check("closed with a report", row, "closed", "outcome", { one_of: ["report", "report_queued"] })],
    cleanup: release(row) });
  row = "DI3";
  rows.push({ id: row, title: "V turned away: witness.unwitnessed (not_in_view), no report", requires: writes,
    // The actors are placed in front of V first; then V turns away, and the incident is declared and played behind her.
    steps: [inPlay(row), ...fixture(row, "pp-smoke-3", [
      { label: `${row}-away`, do: "run", command: "player.look", input: { yaw: 180, relative: true, when: quiet }, retry: { times: 2, backoff_ms: 3000, on: { code: "precondition_failed" } } },
      { label: `${row}-settle`, do: "wait", ms: 1500 },
    ])],
    pass: [check("unwitnessed", row, "closed", "outcome", { equals: "unwitnessed" }), check("because V wasn't looking", row, "closed", "unwitnessed_reason", { equals: "not_in_view" })],
    cleanup: [...release(row), { label: `${row}-look-stop`, do: "run", command: "player.look.stop", input: {} }] });

  row = "CRS";
  rows.push({ id: row, title: "Crowd substitution out of view, then released with restore", requires: writes,
    steps: [inPlay(row), { label: `${row}-list`, do: "run", command: "npc.list", input: { radius_m: 30 }, bind: key(row, "crowd") },
      { label: `${row}-cursor`, do: "cursor", bind: key(row, "cursor") },
      { label: `${row}-swap`, do: "run", command: "npc.substitute", input: { look_at: true }, bind: key(row, "swap"),
        alternatives: [
          [{ do: "run", command: "player.look", input: { yaw: 90, relative: true, when: quiet } }, { do: "wait", ms: 1500 }, { do: "run", command: "npc.substitute", input: { look_at: true }, bind: key(row, "swap") }],
          // Walkers move on (npc_not_found: isn't near V any more): up to three fresh picks from a new list, each a
          // different eligible walker (in the crowd, alive, not protected or busy, 8 to 30 m away).
          ...[0, 1, 2].map((n) => [
            { do: "run", command: "npc.list", input: { radius_m: 30 }, bind: key(row, `list${n}`) },
            { do: "pick", from: ref(row, `list${n}`, "npcs"), index: n, bind: key(row, `pick${n}`), where: { all: [
              { path: "crowd", equals: true }, { path: "dead", equals: false }, { path: "protected", equals: false },
              { any: [{ path: "busy", exists: false }, { path: "busy", equals: "" }] }, { path: "distance", min: 8, max: 30 },
            ] } },
            { do: "run", command: "npc.substitute", input: { id: ref(row, `pick${n}`, "id") }, bind: key(row, "swap") },
          ]),
        ],
        outcomes: [{ name: "nobody_suitable", match: { code: ["no_target", "not_found", "too_far", "npc_busy", "npc_protected"] }, result: "fail" }] },
      { label: `${row}-swapped`, do: "await", cursor: ref(row, "cursor"), kind: "npc.substituted", subject: ref(row, "swap", "who"), timeout_s: 20, bind: key(row, "swapped"), on_fail: "fail_row" },
      { label: `${row}-release`, do: "run", command: "npc.release", input: { who: ref(row, "swap", "who"), how: "despawn", restore: true }, bind: key(row, "released") }],
    pass: [check("swapped", row, "swapped", "complete", { equals: true })],
    cleanup: [{ label: `${row}-cleanup`, do: "run", command: "npc.release", input: { who: ref(row, "swap", "who"), how: "despawn" }, when: { match: { all: [{ ref: ref(row, "swap"), exists: true }, { ref: ref(row, "released"), exists: false }] } } }] });

  return {
    schema: "xfb/session-script-3",
    name: "borg4-smoke",
    title: "Borg 4 regression smoke: B318-1, B318-3, B318-4, CS8181, DI2, DI3, CRS",
    card: "research/runtime/runtime-bridge-test-card.md#borg-3-regressions-0818",
    requires: [
      "The XF test profile with the -writes build; V in an open, quiet street with crowd walkers about; a throwaway save.",
      "A private fixtures file (--fixtures) as for st-styling (mo2, game_dir, staged_mod, save).",
    ],
    setup: [{ label: "commit", do: "host.commit", on_fail: "stop" }],
    rows,
    teardown: [],
  };
}

// ---- Free roam for XF · Holotable's replay -----------------------------------------------------------------

/**
 * free-roam.json: one passive row, FR1, for the replay proof of concept (every recorded run so far had V standing
 * still). The recorder runs on v, actors, camera and incidents (and supervisor where the build takes it; the batch's
 * own recorder, on every channel, is reused when it already runs), the player is asked to walk a block and drive
 * across a district (the row drives nothing meanwhile, so it doesn't hand over: a handover's notice would also take the
 * question down), and the answer is waited for up to 10 minutes; a wait that ends early is never read as "no
 * answer". Then stop the recorder and read the run's span from the v channel.
 */
function freeRoamScript(): Json {
  const row = "FR1-free-roam";
  const channels = ["v", "actors", "camera", "incidents"];
  const start = (withSupervisor: boolean): Json => ({ do: "run", command: "test.record.start", input: { channels: withSupervisor ? [...channels, "supervisor"] : channels, duration_s: 1800 }, bind: key(row, "rec") });
  const answered = (label: string) => ({ path: "events", some: { all: [{ path: "kind", equals: "answer" }, { path: "data.label", equals: label }] } });
  return {
    schema: "xfb/session-script-3",
    name: "free-roam",
    title: "Free roam for XF · Holotable's live world view (FR1)",
    card: "research/runtime/runtime-bridge-test-card.md#before-the-session-coordinator",
    requires: [
      "The XF test profile with the autonomous -writes build (the recorder needs allow_test_hooks); V in the open with a vehicle to hand.",
      "A private fixtures file (--fixtures) as for the other batches. Passive: no XF actors, no writes beyond the message, the handover and the recorder.",
    ],
    setup: [{ label: "commit", do: "host.commit", on_fail: "stop" }],
    rows: [{
      id: row,
      title: "Free roam: walk about a block, then drive across a district, with the recorder on (the player plays; the row drives nothing)",
      requires: cfg({ "bridge.allow_writes": "true" }),
      steps: [
        inPlay(row),
        { label: `${row}-recorder`, ...start(true),
          // Without the supervisor channel where the build refuses it; the batch's recorder when one already runs.
          alternatives: [[start(false)]],
          outcomes: [{ name: "batch_recorder", match: { code: "recording_busy" }, run: [{ do: "set", value: "$recorder", bind: key(row, "rec") }] }] },
        { label: `${row}-cursor`, do: "cursor", bind: key(row, "cursor") },
        { label: `${row}-ask`, do: "run", command: "ui.message", input: { level: "ask", text: "Free roam for the live world view: walk about a block, then drive across a district. Answer Done when finished (about 5 minutes).", choices: ["Done", "Skip"], seconds: 600 }, bind: key(row, "q") },
        { label: `${row}-answer`, do: "await", cursor: ref(row, "cursor"), kind: "answer", message_id: ref(row, "q", "id"), timeout_s: 600, deadline_ms: 610_000, bind: key(row, "answer"),
          outcomes: [
            { name: "done", match: answered("Done") },
            { name: "skipped", match: answered("Skip"), run: [{ end: "fail", reason: "the player chose Skip" }] },
            { name: "no_answer", match: { code: "timeout" }, run: [{ end: "fail", reason: "no answer within 10 minutes" }] },
          ],
          // Anything else ended the wait early: never read as "no answer".
          fallback: [{ end: "fail", reason: "the wait for the answer ended before its deadline (the question withdrawn, or the wait refused): see the row's reports" }] },
        { label: `${row}-stop`, do: "run", command: "test.record.stop", input: {}, on_fail: "continue" },
        { label: `${row}-span`, do: "recorder.span", run: ref(row, "rec", "run"), bind: key(row, "span") },
      ],
      pass: [
        // The run as the span read it: a Skip or a missed deadline never reaches the span, so the row is a SKIP, not a partial pass.
        { label: "a recorder run", ref: ref(row, "span"), match: { path: "run", exists: true } },
        { label: "V moved at least 100 m", ref: ref(row, "span"), match: { path: "distance_m", min: 100 } },
      ],
      facts: [{ label: "recorder run", ref: ref(row, "rec", "run") }, { label: "V's distance (m)", ref: ref(row, "span", "distance_m") }, { label: "catch-up pages", ref: ref(row, "span", "pages") }],
      // However the row ends (Skip, the deadline, a stop), the question comes down and the recorder stops.
      cleanup: [
        { label: `${row}-clear`, do: "run", command: "ui.message", input: { clear: true } },
        { label: `${row}-stop-always`, do: "run", command: "test.record.stop", input: {}, when: { match: { ref: ref(row, "span"), exists: false } } },
      ],
    }],
    teardown: [],
  };
}

const here = import.meta.dir;
for (const [file, script] of [["st-styling.json", stScript()], ["borg4-smoke.json", smokeScript()], ["free-roam.json", freeRoamScript()]] as const) {
  writeFileSync(join(here, file), JSON.stringify(script, null, 2) + "\n");
  console.log(`wrote ${file}: ${(script.rows as unknown[]).length} rows`);
}

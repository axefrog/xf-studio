// Bridge 0.6's commands (session 6's findings and the standing directives): the agent's own view of the game
// (scene.read, scene.report), the session event stream (session.events, session.log, session.note), handing the game to
// the player and taking it back (session.handover, session.resume), contact sheets (capture.sheet), behaviours that run in
// the plugin at tick rate (behave.*), player control phase 1 (player.*) and the read-only input probe. catalogue.ts places
// them in the catalogue; only types come from there, so the two modules don't load each other.

import type { CommandContext, CommandDef, CommandResult } from "./catalogue.ts";
import { bool, int, num, obj, oneOf, str, type JsonSchema } from "./schema.ts";
import { captureWindow, checkedCapturePath, CaptureError, DEFAULT_CAPTURE_ROOT } from "../capture/capture.ts";
import { NAMED_REGIONS } from "../capture/regions.ts";
import { maxCellWidth, readCell, renderSheet, shrinkCell, writeSheet, type SheetCell } from "../capture/sheet.ts";
import { decodePng } from "../capture/image.ts";
import { runSceneReport } from "../scene/report.ts";
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";

type Json = Record<string, any>;

const planError = (code: string, message: string, detail?: unknown) =>
  Object.assign(new Error(message), { plain: { code, message, ...(detail !== undefined ? { detail: typeof detail === "string" ? detail : JSON.stringify(detail) } : {}) } });

async function call(context: CommandContext, method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<Json> {
  const response = await context.api.callBridge(method, params, context.cid, timeoutMs);
  if (!response.ok) throw Object.assign(new Error(response.error.message), { plain: response.error });
  return response.result as Json;
}

/** A bridge call that may fail without failing the command: the answer, or {error}. */
async function attempt(context: CommandContext, method: string, params: Record<string, unknown>): Promise<Json> {
  const response = await context.api.callBridge(method, params, context.cid);
  return response.ok ? (response.result as Json) : { error: response.error };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const point3 = (description: string): JsonSchema => ({ type: "array", description, items: num("A coordinate in metres."), minItems: 3, maxItems: 3 });

// --- the XF overlay out of captures ------------------------------------------------------------

/**
 * Runs a capture with the bridge's own overlay out of the picture (0.6, session 6's friction): the coordinator's ui.message
 * lines are cleared and the ink HUD panel and the CET label are switched off for the moment of the capture, then the panel
 * comes back as it was. Without a bridge (or a bridge too old for ui.hud) the capture just runs.
 */
export async function withOverlayCleared<T>(context: CommandContext, run: () => T | Promise<T>): Promise<{ value: T; overlay: Json }> {
  if (!context.api.session()) return { value: await run(), overlay: { cleared: false, why: "the game bridge isn't running" } };
  const cleared = await attempt(context, "ui.message", { clear: true });
  const hud = await attempt(context, "ui.hud", { show: false, cet_label: false });
  const restore = hud.error ? null : ((hud.undo as Json | undefined)?.params as Json | undefined) ?? null;
  if (!hud.error) await sleep(120); // the panel's next frames (the overlay pulls every sixth tick)
  try {
    return { value: await run(), overlay: { cleared: !cleared.error, messages_cleared: cleared.cleared ?? null, panel_hidden: !hud.error } };
  } finally {
    if (restore) await attempt(context, "ui.hud", restore);
  }
}

// --- session ------------------------------------------------------------------------------------

/**
 * The last `count` non-empty lines of a text file, read backwards in chunks (RB-91: session.log used to read whole command
 * logs on every call, and follow mode calls it often). A line torn by a concurrent append is skipped by the caller.
 */
export function tailLines(path: string, count: number, chunk = 64 * 1024): string[] {
  if (count <= 0) return [];
  const fd = openSync(path, "r");
  try {
    let position = fstatSync(fd).size;
    let text = "";
    let lines: string[] = [];
    while (position > 0) {
      const size = Math.min(chunk, position);
      position -= size;
      const buffer = Buffer.alloc(size);
      readSync(fd, buffer, 0, size, position);
      text = buffer.toString("utf8") + text;
      lines = text.split(/\r?\n/);
      // The first piece may be a line cut at the chunk boundary: it counts only once the file's start is reached.
      if (lines.slice(1).filter((l) => l.trim()).length >= count) break;
    }
    const complete = position > 0 ? lines.slice(1) : lines;
    return complete.filter((l) => l.trim()).slice(-count);
  } finally {
    closeSync(fd);
  }
}

function toolsLog(context: CommandContext, tail: number): Json[] {
  const dir = context.api.auditDir;
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => /^commands-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().slice(-2);
  const lines: Json[] = [];
  // Newest file first, and only as many lines as the tail needs.
  for (const file of files.reverse()) {
    const wanted = tail - lines.length;
    if (wanted <= 0) break;
    const parsed: Json[] = [];
    for (const line of tailLines(join(dir, file), wanted)) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        // a torn line
      }
    }
    lines.unshift(...parsed);
  }
  return lines.slice(-tail).map((entry) => ({
    source: "tools",
    at: entry.at,
    kind: entry.event === "note" ? "note" : entry.event === "done" ? "write" : entry.event,
    text: entry.event === "note" ? String(entry.text ?? "") : `${entry.command ?? ""} ${entry.event ?? ""}${entry.code ? ": " + entry.code : ""}`,
    ...(entry.cid ? { cid: entry.cid } : {}),
  }));
}

async function runSessionLog(input: Json, context: CommandContext): Promise<CommandResult> {
  const tail = (input.tail as number | undefined) ?? 50;
  const sources = new Set((input.sources as string[] | undefined) ?? ["bridge", "tools"]);
  const kinds = input.kinds as string[] | undefined;
  const out: Json = { events: [] };
  if (sources.has("bridge") && context.api.session()) {
    let since = input.since as number | undefined;
    if (since === undefined) {
      const head = await attempt(context, "session.events", { since: 0, limit: 1 });
      since = head.error ? 0 : Math.max(0, Number(head.latest ?? 0) - tail);
    }
    let read = await attempt(context, "session.events", { since, limit: tail, ...(kinds ? { kinds } : {}) });
    const follow = (input.follow_ms as number | undefined) ?? 0;
    const started = performance.now();
    while (!read.error && follow > 0 && !(read.events as Json[]).length && performance.now() - started < follow) {
      await sleep(250);
      read = await attempt(context, "session.events", { since, limit: tail, ...(kinds ? { kinds } : {}) });
    }
    if (read.error) out.bridge_error = read.error;
    else {
      out.next = read.next;
      out.latest = read.latest;
      if (read.dropped) out.dropped = read.dropped;
      out.events.push(...(read.events as Json[]).map((e) => ({ source: "bridge", ...e })));
    }
  } else if (sources.has("bridge")) {
    out.bridge_error = { code: "no_bridge", message: "The game bridge isn't running, so only the tools' own log is shown." };
  }
  if (sources.has("tools")) {
    const mine = toolsLog(context, tail).filter((e) => !kinds || kinds.includes(e.kind));
    out.events.push(...mine);
  }
  out.events.sort((a: Json, b: Json) => String(a.at).localeCompare(String(b.at)));
  out.events = out.events.slice(-tail);
  return { value: out };
}

async function runSessionNote(input: Json, context: CommandContext): Promise<CommandResult> {
  const text = String(input.text);
  const level = (input.level as string | undefined) ?? "info";
  const bridge = context.api.session() ? await attempt(context, "session.note", { text, level, ...(input.data ? { data: input.data } : {}) }) : { error: { code: "no_bridge" } };
  context.api.audit({ event: "note", command: "session.note", cid: context.cid, text, level });
  let shown: Json | null = null;
  if (input.show === true && !bridge.error) shown = await attempt(context, "ui.message", { text, level: level === "done" ? "done" : level === "warn" ? "warn" : level === "ask" ? "ask" : "info", seconds: 10 });
  return { value: { recorded_in: bridge.error ? ["tools"] : ["bridge", "tools"], ...(bridge.error ? { bridge: bridge.error } : { seq: bridge.seq }), ...(shown ? { shown: !shown.error } : {}), undo: null } };
}

/**
 * session.handover: gives the game to the player in one step (session 6 took several): behaviours stopped, photo mode's
 * menu and cursor shown again, the showroom's rigs cleared if asked (lights: clear, so the player lights the heads with
 * photo mode's own lights), then every bridge write refused until session.resume; a line in the game says so, and the
 * event stream records it.
 */
async function runHandover(input: Json, context: CommandContext): Promise<CommandResult> {
  const steps: Json[] = [];
  const step = async (what: string, method: string, params: Record<string, unknown>) => {
    const result = await attempt(context, method, params);
    steps.push({ step: what, ok: !result.error, ...(result.error ? { why: result.error.code } : {}) });
    return result;
  };
  await step("stop behaviours", "behave.stop", { all: true, reason: "handover" });
  const status = await attempt(context, "game.status", {});
  if (input.restore_ui !== false && status.phase === "photo_mode" && (status.photo_ui_hidden === true || status.cursor_hidden === true)) {
    await step("show photo mode's menu and cursor", "photo.hud.hide", { hidden: false, cursor: true });
  }
  if (input.lights === "clear") await step("clear the showroom's rigs", "showroom.clear", { what: "lights" });
  // bridge.handover also gives V back (RB-82): the effects the bridge put on her lifted and any look ended, as player_stop
  // does, in the same step that starts refusing writes.
  const handed = await call(context, "bridge.handover", { on: true, ...(input.note ? { note: input.note } : {}) });
  const released = handed.player_released as Json | null | undefined;
  if (released !== undefined) {
    steps.push({
      step: "give V back (the bridge's effects lifted, any look ended)",
      ok: released !== null && released.released !== false,
      ...(released && released.released === false ? { why: released.why } : { removed: released?.removed ?? [] }),
    });
  }
  await attempt(context, "ui.message", { text: "Handed over: the game is yours. XF automation is paused until the session resumes.", level: "ask", seconds: 15 });
  return { value: { handed_over: true, was: handed.was, steps, note: input.note ?? null, undo: { method: "session.resume", params: {} } } };
}

async function runResume(input: Json, context: CommandContext): Promise<CommandResult> {
  const resumed = await call(context, "bridge.handover", { on: false, ...(input.note ? { note: input.note } : {}) });
  await attempt(context, "ui.message", { text: "Resumed: XF automation continues.", level: "done", seconds: 6 });
  return { value: { handed_over: false, was: resumed.was, undo: { method: "session.handover", params: {} } } };
}

// --- capture.sheet -------------------------------------------------------------------------------

async function runCaptureSheet(input: Json, context: CommandContext): Promise<CommandResult> {
  const cellsIn = input.cells as { label: string; path?: string }[];
  const root = context.captureRoot ?? DEFAULT_CAPTURE_ROOT;
  mkdirSync(root, { recursive: true });
  const cells: SheetCell[] = [];
  let overlay: Json | null = null;
  // Each picture is shrunk to the widest cell this sheet can have as soon as it is decoded (RB-91).
  const widest = maxCellWidth(cellsIn.length, { columns: input.columns as number | undefined, maxWidth: (input.max_width as number | undefined) ?? 2400 });
  try {
    for (const [i, cell] of cellsIn.entries()) {
      if (cell.path) {
        cells.push(readCell(checkedCapturePath(root, cell.path), cell.label, widest));
        continue;
      }
      // No path: take the picture now (the XF overlay out of it).
      const shot = await withOverlayCleared(context, () =>
        captureWindow({ target: context.api.captureTarget(), region: input.region ? ({ name: input.region } as never) : undefined, name: `${(input.name as string | undefined) ?? "sheet"}-${String(i + 1).padStart(2, "0")}`, outDir: root, route: "auto" }),
      );
      overlay = shot.overlay;
      cells.push({ label: cell.label, pixels: shrinkCell(decodePng(new Uint8Array(readFileSync(shot.value.full.path))), widest), source: shot.value.full.path });
    }
  } catch (error) {
    if (error instanceof CaptureError) throw planError(error.code === "bad_file" ? "bad_input" : `capture_${error.code}`, error.message);
    throw error;
  }
  const sheet = renderSheet(cells, { columns: input.columns as number | undefined, maxWidth: (input.max_width as number | undefined) ?? 2400, title: input.title as string | undefined });
  const written = writeSheet(root, (input.name as string | undefined) ?? "sheet", sheet, { title: input.title ?? null });
  return {
    value: { sheet: written, cells: sheet.cells, ...(overlay ? { overlay } : {}) },
    images: [{ path: written.png, width: written.width, height: written.height, mimeType: "image/png", role: "view" }],
  };
}

// --- the catalogue's new entries ------------------------------------------------------------------

const REPORT_INCLUDE = ["camera", "subjects", "lights", "frame", "world", "ui"];

export const SCENE_COMMANDS: CommandDef[] = [
  {
    name: "scene.read",
    title: "Read the scene (raw)",
    description:
      "The bridge's raw reading of what the camera sees: the active camera's place, direction, field of view and aspect, three calibration points through the game's own projection, V (or her photo-mode stand-in), the NPCs within radius of V (nearest first, with a sight-line check from the camera to each face), XF Finish Showroom's heads and rigs, photo mode's three lights (place, direction, sight line to V's face), the time and rain, and the UI (menus, photo mode's menu and cursor, the interaction and dialogue choices the HUD offers). points (up to 32 world points) are projected by the game itself. scene_report turns this into bounds, margins, light shares and checks.",
    permission: "read",
    input: obj({
      parts: { type: "array", description: "Which parts (default all): camera, v, npcs, showroom, lights, world, ui.", items: oneOf("A part.", ["camera", "v", "npcs", "showroom", "lights", "world", "ui"]), maxItems: 7 },
      radius: num("NPCs within this many metres of V, 0 to 60. Default 20.", 0, 60),
      max_npcs: int("At most this many NPCs, 0 to 32. Default 8.", 0, 32),
      occlusion: bool("Check the sight line from the camera to each face (default true)."),
      points: { type: "array", description: "World points to project with the game's own projection.", items: point3("A world point [x, y, z]."), maxItems: 32 },
      piece_eyes: point3("A showroom head's eyes in its own frame (default [0, 0.0497, 1.691], the showroom build's)."),
    }),
    bridge: { method: "scene.read" },
  },
  {
    name: "scene.report",
    title: "Report what the camera sees",
    description:
      "The agent's own view of the shot, to read instead of a screenshot: the camera (place, direction, pitch, field of view, photo mode's exposure, and whether the projection was calibrated by the game); each subject (V, NPCs near her, the showroom's heads) with its screen bounds (window heights from the centre, x right, y down), the fraction in frame, its margins to each edge, whether static geometry blocks the camera's view of its face, its distance, which way it faces (0 = the camera) and, for V in photo mode, her expression and pose; the lights at the focus subject's face (photo mode's lights and the showroom's rig lights: on, place, whether they reach it, an estimated share); with include frame, statistics of the focus subject's region in a fresh screenshot (mean luminance, clipped highlights, crushed shadows); and the world and UI state. warnings lists what looks wrong (a blocked face, a subject cut by the frame).",
    permission: "read",
    input: obj({
      include: { type: "array", description: "What to report (default camera, subjects, lights, world, ui; frame takes a screenshot).", items: oneOf("A section.", REPORT_INCLUDE), maxItems: 6 },
      subjects: { type: "array", description: "Which subjects (default v, npcs, showroom).", items: oneOf("A kind of subject.", ["v", "npcs", "showroom"]), maxItems: 3 },
      bounds: oneOf("The box judged for each subject: face (default), head or body.", ["face", "head", "body"]),
      focus: str("The subject the lights and frame statistics are judged at: v, piece:<index> or an NPC's id (default: the first showroom head, else V).", { maxLength: 80 }),
      radius: num("NPCs within this many metres of V, 0 to 60. Default 20.", 0, 60),
      max_npcs: int("At most this many NPCs, 0 to 32. Default 8.", 0, 32),
      manifest: str("A showroom build's folder or manifest.json, to judge its rig lights.", { maxLength: 1024 }),
      frame: { ...obj({ subject: str("The subject whose region is measured (default: focus).", { maxLength: 80 }), max_width: int("Measure on a copy this wide, 160 to 3840 px. Default 960.", 160, 3840) }), description: "With include frame: which region, and at what size." },
    }),
    local: async (input, context) => ({ value: await runSceneReport(input, context) }),
  },
  {
    name: "session.events",
    title: "Read the session's event stream",
    description:
      "What happened in the game session, in order, from the bridge's own record: every write it answered (with its undo) or refused, the kill switch, handovers and resumes, behaviours starting, progressing and stopping (with why and what they gave back), and notes (from session_note or a button in the game). Give since (the next value of the last read) to read only what came after.",
    permission: "read",
    input: obj({
      since: int("Only events after this sequence number (default 0: the oldest kept).", 0),
      limit: int("At most this many events, 1 to 500. Default 100.", 1, 500),
      kinds: { type: "array", description: "Only these kinds (write, refused, kill, handover, resume, behaviour, note).", items: str("An event kind.", { maxLength: 32 }), maxItems: 16 },
    }),
    bridge: { method: "session.events" },
  },
  {
    name: "session.log",
    title: "Read or follow the session log",
    description:
      "The session's log in one list: the bridge's event stream and the tools' own record of commands (and notes), merged by time; the last tail entries (default 50). follow_ms waits up to that long for something new from the game, for tailing.",
    permission: "read",
    input: obj({
      tail: int("How many entries, 1 to 500. Default 50.", 1, 500),
      since: int("Bridge events after this sequence number (a previous answer's next).", 0),
      kinds: { type: "array", description: "Only these kinds.", items: str("An event kind.", { maxLength: 32 }), maxItems: 16 },
      sources: { type: "array", description: "bridge, tools, or both (default).", items: oneOf("A source.", ["bridge", "tools"]), maxItems: 2 },
      follow_ms: int("Wait up to this long for new bridge events, 0 to 30000 ms. Default 0.", 0, 30000),
    }),
    local: runSessionLog,
  },
  {
    name: "session.note",
    title: "Add a note to the session log",
    description: "Adds a line to the session's event stream (and the tools' own log), for a finding, a question or a marker between steps; show also puts it on screen under the in-game label for 10 s. Changes nothing in the game.",
    permission: "notify",
    input: obj(
      {
        text: str("The note, one line.", { minLength: 1, maxLength: 500 }),
        level: oneOf("info (default), warn, ask or done.", ["info", "warn", "ask", "done"]),
        show: bool("Also show it on screen under the in-game label (default false)."),
      },
      ["text"],
    ),
    undo: "A note stays in the log; it changes nothing.",
    local: runSessionNote,
  },
  {
    name: "session.handover",
    title: "Hand the game to the player",
    description:
      "Gives the game to the player in one step: stops every behaviour, shows photo mode's menu and cursor again if the bridge hid them, clears the showroom's light rigs if lights is clear (so the player lights the heads with photo mode's own lights), then pauses the bridge and gives V back as player_stop does (every effect the bridge put on her, such as a crouch or a glide's movement hold, lifted; any look it started ended): every change it is asked for is refused until session_resume. A line in the game says so, and the session log records it. Reads, notes and the kill switch still work.",
    permission: "control",
    input: obj({
      lights: oneOf("keep (default) or clear the showroom's rigs.", ["keep", "clear"]),
      restore_ui: bool("Show photo mode's menu and cursor again (default true)."),
      note: str("Why, for the log (for example what the player should judge).", { maxLength: 200 }),
    }),
    undo: "session_resume gives the bridge its changes back.",
    local: runHandover,
  },
  {
    name: "session.resume",
    title: "Take the game back from the player",
    description: "Ends a handover: the bridge may change the game again (within what its settings allow). A line in the game says so, and the session log records it.",
    permission: "control",
    input: obj({ note: str("What the player did or decided, for the log.", { maxLength: 200 }) }),
    undo: "session_handover hands over again.",
    local: runResume,
  },
  {
    name: "capture.sheet",
    title: "Make a labelled contact sheet",
    description:
      "Puts named captures side by side in one labelled grid and writes it to disk with a manifest (which file is in which cell): each cell is an earlier capture (path: its .full.png or viewing copy in the capture folder) or, without a path, a screenshot taken now (region, with the XF overlay out of the picture). For comparisons such as finish close-ups or a highlight sweep.",
    permission: "read",
    input: obj(
      {
        cells: {
          type: "array",
          description: "The cells, left to right, top to bottom.",
          items: { description: "One cell.", ...obj({ label: str("The label under the picture.", { minLength: 1, maxLength: 80 }), path: str("An earlier capture's .png in the capture folder (omit to take one now).", { maxLength: 1024 }) }, ["label"]) },
          minItems: 1,
          maxItems: 48,
        },
        title: str("A title across the top.", { maxLength: 120 }),
        columns: int("Cells per row, 1 to 8. Default up to 4.", 1, 8),
        region: oneOf("For cells taken now: the area to keep (as capture_screenshot).", Object.keys(NAMED_REGIONS)),
        max_width: int("The sheet's width at most, 320 to 8000 px. Default 2400.", 320, 8000),
        name: str("Short label for the files (letters, digits, '.', '_', '-').", { pattern: "^[A-Za-z0-9._-]{1,60}$", maxLength: 60 }),
      },
      ["cells"],
    ),
    local: runCaptureSheet,
  },
];

const behaviourLimits: Record<string, JsonSchema> = {
  max_s: num("Stop after this many seconds, 0.1 to 600. Default 60 (a look: its duration plus 5 s; a glide: at most 30).", 0.1, 600),
  every_ticks: int("Act every this many game ticks, 1 to 60 (default 2 for a turntable, 3 for keep_framed, else 1).", 1, 60),
};

export const BEHAVE_COMMANDS: CommandDef[] = [
  {
    name: "behave.turntable",
    title: "Turn showroom heads or rigs continuously",
    description:
      "A behaviour: the showroom's heads (or their light rigs, or both) turn continuously at deg_per_s, in the game at frame rate, until revolutions are done, max_s passes or behave_stop; then they turn back where they were unless return is false. Its progress and its end are in session_events.",
    permission: "write-showroom",
    input: obj({
      target: oneOf("pieces (default), rigs or both.", ["pieces", "rigs", "both"]),
      pieces: { type: "array", description: "Which heads by lineup index (default all).", items: int("A head's index.", 0, 23), maxItems: 24 },
      deg_per_s: num("Degrees a second, -360 to 360 (positive turns them to their left). Default 30.", -360, 360),
      revolutions: num("Stop after this many turns, 0.01 to 100.", 0.01, 100),
      return: bool("Turn them back where they were at the end (default true)."),
      ...behaviourLimits,
    }),
    undo: "behave_stop with its id (the heads turn back); the kill switch and loading a save stop it too.",
    bridge: { method: "behave.turntable" },
  },
  {
    name: "behave.look",
    title: "Turn V's view over time",
    description:
      "A behaviour: V's view turns towards a point (at) or to yaw and pitch (absolute degrees; turn for relative) over duration_s through the game's own look-at, watched each tick until it is within tolerance_deg (reached) or runs out (not_reached: the player's own mouse or stick breaks a look, as it breaks the game's). Normal play only.",
    permission: "write-player",
    input: obj({
      at: point3("A world point to look at [x, y, z]."),
      yaw: num("The view's yaw, degrees (0 along the world's +Y, counter-clockwise).", -360, 360),
      pitch: num("The view's pitch, degrees (up positive), -85 to 85.", -85, 85),
      turn: { ...obj({ yaw: num("Turn by this yaw, degrees.", -360, 360), pitch: num("Tilt by this pitch, degrees.", -170, 170) }), description: "A relative turn instead of absolute angles." },
      duration_s: num("How long the turn takes, 0.05 to 5 s. Default 1.", 0.05, 5),
      tolerance_deg: num("Close enough, 0.2 to 10 degrees. Default 2.", 0.2, 10),
      ...behaviourLimits,
    }),
    undo: "behave_stop ends it; player_look back to the earlier angles (in player_state) turns the view back.",
    bridge: { method: "behave.look" },
  },
  {
    name: "behave.glide.path",
    title: "Glide V along a walkable path",
    description:
      "A behaviour: V moves along the game's own walkable path (navmesh) to a point (to) or an offset from her (forward, right), at speed_m_s, by a teleport every tick, with her own movement held off meanwhile. V is checked every tick: it stops when she arrives, when the player's own input moves her (user_took_over: movement, jump, crouch, sprint, dodge or camera), when she is no longer free to move (combat, a vehicle, a scene, a fall or landing, swimming, a workspot, a takedown, a carried body), at max_s (at most 30 s) or on behave_stop, and gives her movement back. No walk animation plays (animated: false). At most 50 m of path. Normal play only.",
    permission: "write-player",
    input: obj({
      to: point3("The world point to glide to [x, y, z]."),
      offset: { ...obj({ forward: num("Metres ahead of V.", -50, 50), right: num("Metres to V's right.", -50, 50) }), description: "Where to go, from V (instead of to)." },
      speed_m_s: num("Speed, 0.2 to 6 m/s. Default 1.4 (a walk).", 0.2, 6),
      ...behaviourLimits,
    }),
    undo: "behave_stop ends it; its stop event carries a player_teleport undo back to the start.",
    bridge: { method: "behave.glide.path", timeoutMs: () => 5000 },
  },
  {
    name: "behave.keep.framed",
    title: "Keep a subject framed as the camera moves",
    description:
      "A behaviour: keeps a subject at a frame position (at, window heights from the centre; default the centre) while the camera moves. subject piece: a showroom head is moved onto the camera's view ray at distance_m (default its distance at the start), facing the camera, exactly from the camera's pose (needs the showroom permission too). subject v: in photo mode, V's placement (left/right, up/down) is steered from a measured response, as photo_frame measures it, refined after each step. Stops at max_s or on behave_stop; its stop event carries the undo.",
    permission: "write-photo",
    input: obj({
      subject: oneOf("piece (a showroom head, default) or v (V in photo mode).", ["piece", "v"]),
      piece: int("The showroom head's index, with subject piece.", 0, 23),
      at: { ...obj({ x: num("Across, window heights from the centre (right positive).", -1.2, 1.2), y: num("Down, window heights from the centre.", -0.5, 0.5) }), description: "Where in the frame (default the centre)." },
      distance_m: num("A head's eyes this far from the camera, 0.3 to 20 m (default: as at the start).", 0.3, 20),
      tolerance: num("Close enough, 0.002 to 0.2 window heights. Default 0.02.", 0.002, 0.2),
      max_step: num("V's largest placement step, 0.01 to 0.5. Default 0.1.", 0.01, 0.5),
      piece_eyes: point3("A showroom head's eyes in its own frame (default the showroom build's)."),
      ...behaviourLimits,
    }),
    undo: "behave_stop ends it; the stop event's undo puts V's placement back (a head stays where it was last put; showroom_spawn resets the lineup).",
    bridge: { method: "behave.keep.framed" },
  },
  {
    name: "behave.stop",
    title: "Stop behaviours",
    description: "Stops one behaviour (id) or all of them. Each stops on the next game tick and gives back what it held (a turntable turns its heads back, a glide gives V her movement back); session_events says how each ended.",
    permission: "control",
    input: obj({ id: int("The behaviour's id (from its start or behave_list).", 1), all: bool("true: stop every behaviour."), reason: str("Why, for the log.", { maxLength: 64 }) }),
    undo: "Start the behaviour again.",
    bridge: { method: "behave.stop" },
  },
  {
    name: "behave.list",
    title: "List running behaviours",
    description: "The behaviours running in the game now: id, kind, target, state, how long they have run and a summary (how far a head has turned, a glide travelled, a look's remaining angle).",
    permission: "read",
    input: obj({}),
    bridge: { method: "behave.list" },
  },
];

const playerBusyNote =
  "It checks V first and refuses with the reason (in_combat, in_vehicle, in_scene, player_busy while she jumps, slides, falls or lands, swims, sits in a workspot, takes someone down or carries a body, or a menu or photo mode is open; player_state's busy_state says which).";

export const PLAYER_COMMANDS: CommandDef[] = [
  {
    name: "player.state",
    title: "Read V's state",
    description:
      "V in the world: position, facing (yaw), the camera's place, direction, yaw and pitch, the player state machine (locomotion, high level, scene tier, vehicle, combat), whether she is in combat, a vehicle, a scene or a dialogue, why the bridge wouldn't move her now (busy), what she is looking at (with whether it is an interaction target), the effects the bridge put on her and the behaviours running.",
    permission: "read",
    input: obj({}),
    bridge: { method: "player.state" },
  },
  {
    name: "player.teleport",
    title: "Teleport V",
    description:
      `Moves V to a world point (position) or an offset from her (forward, right, up along her facing), and/or turns her (yaw absolute, turn relative), through the game's own teleport. By default the point snaps to walkable ground within 2 m and is refused where there is none (no_ground); ground exact skips the snap at your own risk. Either way a point more than 0.5 m away is refused where the world isn't loaded (not_streamed). At most 50 m unless far; at most two teleports a second. The answer reads her place back two ticks later (held). ${playerBusyNote}`,
    permission: "write-player",
    input: obj({
      position: point3("The world point [x, y, z]."),
      offset: { ...obj({ forward: num("Metres ahead of V.", -50, 50), right: num("Metres to V's right.", -50, 50), up: num("Metres up.", -10, 10) }), description: "Where to, from V (instead of position)." },
      yaw: num("Face this yaw, degrees (0 along the world's +Y, counter-clockwise).", -360, 360),
      turn: num("Turn by this many degrees (left positive).", -360, 360),
      ground: oneOf("snap (default: walkable ground within 2 m) or exact (no snap; the world must still be loaded there).", ["snap", "exact"]),
      far: bool("Allow more than 50 m (the destination must be loaded)."),
    }),
    undo: "The result's undo teleports V back to where she stood, facing the same way; loading the save undoes it too.",
    bridge: { method: "player.teleport" },
  },
  {
    name: "player.look",
    title: "Turn V's view",
    description:
      `Turns V's view to yaw and pitch (degrees; relative adds them to the current view) or towards a world point (at): instant (her facing by a teleport in place, the pitch by a very short look-at) or smooth over duration_s (the game's own look-at, which the player's mouse or stick breaks). Answers the angles reached and whether they are within 2 degrees. Normal play only. ${playerBusyNote}`,
    permission: "write-player",
    input: obj({
      yaw: num("Yaw, degrees (0 along the world's +Y, counter-clockwise).", -360, 360),
      pitch: num("Pitch, degrees (up positive; -85 to 85 unless relative).", -170, 170),
      relative: bool("Add yaw and pitch to the current view (default false)."),
      at: point3("Look at this world point [x, y, z] instead."),
      mode: oneOf("instant (default) or smooth.", ["instant", "smooth"]),
      duration_s: num("A smooth look's time, 0.05 to 5 s. Default 1.", 0.05, 5),
    }),
    undo: "The result's undo turns the view back to the earlier angles.",
    bridge: { method: "player.look", timeoutMs: () => 8000 },
  },
  {
    name: "player.look.stop",
    title: "End a look",
    description: "Ends a look the bridge started (smooth or behave_look), where the view is now.",
    permission: "write-player",
    input: obj({}),
    undo: "Nothing to undo.",
    bridge: { method: "player.look.stop" },
  },
  {
    name: "player.stop",
    title: "Stop everything the bridge does with V",
    description: "Stops every behaviour, ends any look and lifts every effect the bridge put on V (a crouch, a glide's movement hold). Always allowed, like the kill switch, which does the same.",
    permission: "control",
    input: obj({}),
    undo: "Start what you need again.",
    bridge: { method: "player.stop" },
  },
  {
    name: "player.interact.list",
    title: "List what V can interact with",
    description: "What the HUD offers now: the world interaction prompt (its title and choices, each with its index, label, input action and whether it is held) and any dialogue choices, plus which hub is active and which line is selected. Selecting a choice needs an input channel (research).",
    permission: "read",
    input: obj({}),
    bridge: { method: "player.interact.list" },
  },
  {
    name: "player.action",
    title: "Do a system-driven action",
    description:
      `One of the actions the game's systems can do without input: crouch and stand (the game's own forced crouch, as a sniper nest uses it; only the bridge's own is lifted), weapon.draw, weapon.holster and weapon.slot (1-3) through the equipment system's own requests, menu.open (inventory, map, journal, perks, crafting, or the wardrobe screen) and menu.close. Jumping, sprinting and dodging need an input channel (research). ${playerBusyNote}`,
    permission: "write-player",
    input: obj(
      {
        name: oneOf("The action.", ["crouch", "stand", "weapon.draw", "weapon.holster", "weapon.slot", "menu.open", "menu.close"]),
        slot: int("With weapon.slot: the weapon slot 1-3.", 1, 3),
        menu: oneOf("With menu.open: which menu.", ["inventory", "map", "journal", "perks", "crafting", "wardrobe"]),
      },
      ["name"],
    ),
    undo: "The result's undo does the opposite (stand, weapon.holster, menu.close); player_stop and the kill switch lift a crouch too.",
    bridge: { method: "player.action" },
  },
  {
    name: "input.probe",
    title: "Probe the game's test input system",
    description:
      "Read-only research for input without window focus: whether the game has CD PROJEKT RED's functional-test system and its fake-input functions (their parameter counts and, for offline disassembly, where their code is in the executable), the related player, navigation and UI test functions, whether that system exists in the game now, whether the game window is in front, and which module the game's pad-input import resolves to. Calls none of them.",
    permission: "read",
    input: obj({}),
    bridge: { method: "input.probe" },
  },
];


const presetValue = (what: string, min: number, max: number) => num(`${what}, ${min} to ${max}.`, min, max);

/** photo.camera.preset (research): the second route to placing photo mode's camera (session 6: moving its entity didn't hold). */
export const PRESET_COMMAND: CommandDef = {
  name: "photo.camera.preset",
  title: "Rewrite a photo-mode camera preset (research)",
  description:
    "Research, for placing photo mode's camera where the bridge wants it: rewrites one of photo mode's camera presets (1-9; the XF test profile's own are 6-9) in the running game through TweakXL (values: dist, pitchDeg, yawDeg, rollDeg, distUpDown, distLeftRight, fov), selects it (through Customization first, so photo mode applies it again) and reads the camera back four frames later: camera_moved_m and camera_after say whether photo mode read the new values. Nothing is saved; the undo writes the earlier values back and selects the earlier preset. Needs TweakXL (detected, never installed).",
  permission: "write-photo",
  input: obj({
    preset: int("The camera preset, 1 to 9. Default 9.", 1, 9),
    values: {
      description: "The preset's values to write (any of them).",
      ...obj({
        dist: presetValue("Distance (the game's presets use negative values, in front of V)", -20, 20),
        pitchDeg: presetValue("Pitch, degrees", -89, 89),
        yawDeg: presetValue("Yaw, degrees", -180, 180),
        rollDeg: presetValue("Roll, degrees", -180, 180),
        distUpDown: presetValue("Up/down offset", -5, 5),
        distLeftRight: presetValue("Left/right offset", -5, 5),
        fov: presetValue("Field of view, degrees", 1, 120),
      }),
    },
    select: bool("Select the preset afterwards (default true)."),
    camera_preset: int("Select this preset instead (the undo; 0 is Customization).", 0, 9),
  }),
  undo: "The result's undo writes the earlier values back and selects the earlier preset; restarting the game drops the changes too.",
  bridge: { method: "photo.camera.preset", timeoutMs: () => 10000 },
};

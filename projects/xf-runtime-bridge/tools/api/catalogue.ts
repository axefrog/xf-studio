// The command catalogue: the single source of truth for what XF tools can ask the game to do.
// Each entry has a name, plain-language text for end users, an input schema, a permission class
// and either a bridge method or a local handler. The MCP server, the CLI and the session runner
// all derive their tools and commands from this list, so a command added here appears everywhere
// (tests/catalogue.test.ts checks that the MCP tool list equals this catalogue).
//
// Permission classes (data for a future consent screen):
//   read             looks at the game or its window; changes nothing
//   write-photo      changes photo mode only (camera, lights, expression, its UI); gone when photo mode closes
//   write-world      changes the world around V (time of day, time flow)
//   write-character  changes V's appearance
//   control          changes only the bridge itself (the kill switch)
// The game side enforces the real gate: every write is refused unless the bridge's config.ini
// has allow_writes = true, which only the dedicated test profile sets.

import { captureBurst, captureWindow, CaptureError, grabForAnalysis, recrop, type CaptureRecord } from "../capture/capture.ts";
import { NAMED_REGIONS, type RegionSpec } from "../capture/regions.ts";
import type { CommandApi, ImageRef } from "./command-api.ts";
import { frame, FramingError, FRAMINGS, type CameraApplied, type FramingAdapter, type FrameOptions, type SubjectReading } from "./framing.ts";
import { CAMERA_PRESETS, expandCamera } from "./presets.ts";
import { KeySendError, readPhotoModeBinding, virtualKey, type KeyRoute } from "../input/photo-key.ts";
import { bool, int, num, obj, oneOf, str, type JsonSchema } from "./schema.ts";

/** Game phases game.status reports (XFBridgeActions.Phase in the redscript layer). */
export const PHASES = ["starting", "main_menu", "loading", "gameplay", "photo_mode", "character_menu", "menu", "paused", "shutting_down"] as const;

export type Permission = "read" | "write-photo" | "write-world" | "write-character" | "control";

export const PERMISSIONS: Record<Permission, { label: string; description: string }> = {
  read: { label: "Look", description: "Reads what the game is doing, or takes a screenshot of its window. Changes nothing." },
  "write-photo": {
    label: "Control photo mode",
    description: "Opens and closes photo mode and changes its camera, lights, expression and on-screen menu. Nothing outlives photo mode.",
  },
  "write-world": { label: "Change the world", description: "Changes the in-game time of day or stops time. Undo by setting it back." },
  "write-character": { label: "Change V's appearance", description: "Changes a character-creator option while the appearance screen is open." },
  control: { label: "Stop the bridge", description: "Switches the game bridge off until the game restarts. Always allowed." },
};

export type CommandResult = { value: unknown; images?: ImageRef[] };
export type CommandContext = { api: CommandApi; cid: string; captureRoot: string; signal?: AbortSignal };

export type CommandDef = {
  /** Canonical dotted name, e.g. "photo.camera.set". */
  name: string;
  title: string;
  /** Plain-language description for end users and AI clients. */
  description: string;
  permission: Permission;
  input: JsonSchema;
  /** How to undo a write, in plain words. */
  undo?: string;
  bridge?: { method: string; params?: (input: Record<string, unknown>) => Record<string, unknown> };
  local?: (input: Record<string, unknown>, context: CommandContext) => Promise<CommandResult>;
};

/** MCP (and the Claude API) allow only [A-Za-z0-9_-] in tool names: dots become underscores. */
export const toolName = (command: CommandDef | string) => (typeof command === "string" ? command : command.name).replaceAll(".", "_");

// --- shared input pieces -------------------------------------------------------------------------

const rectProps = (unit: string, integer: boolean, max?: number): JsonSchema =>
  obj(
    {
      x: (integer ? int : num)(`Left edge, ${unit}`, 0, max),
      y: (integer ? int : num)(`Top edge, ${unit}`, 0, max),
      width: (integer ? int : num)(`Width, ${unit}`, integer ? 1 : 0, max),
      height: (integer ? int : num)(`Height, ${unit}`, integer ? 1 : 0, max),
    },
    ["x", "y", "width", "height"],
  );

const regionInput: Record<string, JsonSchema> = {
  region: oneOf(
    `Named area to keep: ${Object.entries(NAMED_REGIONS)
      .map(([name, text]) => `${name} (${text})`)
      .join("; ")}. Default: full.`,
    Object.keys(NAMED_REGIONS),
  ),
  rect: { ...rectProps("in pixels of the game window", true, 16384), description: "Area to keep, in pixels of the game window (instead of region)." },
  rect_normalized: {
    ...rectProps("as a fraction of the window (0 to 1)", false, 1),
    description: "Area to keep, as fractions of the window's width and height from 0 to 1 (instead of region).",
  },
  max_width: int("Largest width of the returned picture, in pixels. Default: 1280 on the long side.", 16, 16384),
  max_height: int("Largest height of the returned picture, in pixels.", 16, 16384),
  scale: num("Shrink the returned picture by this factor (0.01 to 1) instead of a size limit.", 0.01, 1),
  name: str("Short label for the files (letters, digits, '.', '_', '-').", { pattern: "^[A-Za-z0-9._-]{1,80}$", maxLength: 80 }),
};

function regionOf(input: Record<string, unknown>): RegionSpec | undefined {
  const given = ["region", "rect", "rect_normalized"].filter((key) => input[key] !== undefined);
  if (given.length > 1) throw planError("bad_input", "Give only one of region, rect or rect_normalized.");
  if (input.rect) return { pixels: input.rect as never };
  if (input.rect_normalized) return { normalized: input.rect_normalized as never };
  if (input.region) return { name: input.region as never };
  return undefined;
}

function viewOf(input: Record<string, unknown>) {
  if (input.scale === undefined && input.max_width === undefined && input.max_height === undefined) return undefined;
  return {
    ...(input.max_width !== undefined ? { maxWidth: input.max_width as number } : {}),
    ...(input.max_height !== undefined ? { maxHeight: input.max_height as number } : {}),
    ...(input.scale !== undefined ? { scale: input.scale as number } : {}),
  };
}

function planError(code: string, message: string) {
  return Object.assign(new Error(message), { plain: { code, message } });
}

function captureResult(record: CaptureRecord): CommandResult {
  return {
    value: record,
    images: [{ path: record.view.path, width: record.view.width, height: record.view.height, mimeType: "image/png", role: "view" }],
  };
}

function captureFailure(error: unknown): never {
  if (error instanceof CaptureError) throw planError(error.code === "bad_region" || error.code === "bad_file" ? "bad_input" : `capture_${error.code}`, error.message);
  throw error;
}

function wrapCapture(run: () => CaptureRecord): CommandResult {
  try {
    return captureResult(run());
  } catch (error) {
    captureFailure(error);
  }
}

/** Sends one bridge method from inside a local command; a refusal becomes a plain error. */
async function bridgeCall(context: CommandContext, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await context.api.callBridge(method, params, context.cid);
  if (!response.ok) throw Object.assign(new Error(response.error.message), { plain: response.error });
  return response.result as Record<string, unknown>;
}

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * photo.open: presses the player's photo-mode key in the game window (the one input the tools may
 * send; approved for the test profile), after the bridge says V is in the world and photo mode is
 * allowed, then waits for photo mode.
 */
async function runPhotoOpen(input: Record<string, unknown>, context: CommandContext): Promise<CommandResult> {
  const status = await bridgeCall(context, "game.status", {});
  const phase = String(status.phase);
  if (phase === "photo_mode") return { value: { changed: false, note: "Photo mode was already open." } };
  if (phase !== "gameplay") throw planError("not_in_gameplay", `Photo mode opens only from normal play; the game is in ${phase}. Close menus first.`);
  if (status.photo_mode_can_open === false) {
    throw planError("photo_not_allowed", "The game doesn't allow photo mode right now (combat, a scene or a vehicle?). Nothing was sent.");
  }
  const binding = readPhotoModeBinding();
  const vk = virtualKey(binding.name);
  if (vk === null) throw planError("key_unsupported", `The photo mode key is bound to ${binding.name}, which the bridge can't send. Ask the player to press it.`);
  const target = context.api.keyTarget();
  if (!target) throw planError("no_window", "The game has no visible window to send the key to.");
  const route = ((input.route as string | undefined) ?? "sendinput") as KeyRoute;
  let sent;
  try {
    sent = await context.api.keySender()(target, vk, route);
  } catch (error) {
    if (error instanceof KeySendError) throw planError(error.code, error.message);
    throw error;
  }
  const timeout = (input.timeout_ms as number | undefined) ?? 5000;
  const started = performance.now();
  for (;;) {
    await sleepMs(250);
    const now = await bridgeCall(context, "game.status", {});
    if (String(now.phase) === "photo_mode") {
      return {
        value: { changed: true, key: binding.name, key_source: binding.source, ...sent, waited_ms: Math.round(performance.now() - started), undo: { method: "photo.exit", params: {} } },
      };
    }
    if (performance.now() - started >= timeout) {
      throw planError(
        "photo_open_timeout",
        `The photo mode key (${binding.name}) was sent, but photo mode didn't open within ${Math.round(timeout / 1000)} s. Ask the player to press it; game_wait with phase photo_mode then continues.`,
      );
    }
  }
}

/** photo.frame: builds the framing adapter over the bridge and the window capture, then runs the loop. */
async function runFrame(input: Record<string, unknown>, context: CommandContext): Promise<CommandResult> {
  let hudUndo: Record<string, unknown> | null = null;
  const adapter: FramingAdapter = {
    subject: async (offset) => (await bridgeCall(context, "photo.subject", offset)) as unknown as SubjectReading,
    setCamera: async (values) => ((await bridgeCall(context, "photo.camera.set", values)).applied as CameraApplied[] | undefined) ?? [],
    grab: async () => {
      if (!hudUndo) {
        // The capture route compares captures, so the menu and cursor are hidden first (and restored after).
        const hidden = await bridgeCall(context, "photo.hud.hide", { hidden: true, cursor: true });
        hudUndo = ((hidden.undo as { params?: Record<string, unknown> } | null)?.params ?? { hidden: false, cursor: true }) as Record<string, unknown>;
        await sleepMs(500);
      }
      try {
        return grabForAnalysis(context.api.captureTarget(), 960);
      } catch (error) {
        captureFailure(error);
      }
    },
    pose: async () => {
      const state = await bridgeCall(context, "photo.state", { menu: true });
      const menu = (state.menu as { key: number; value?: number; min?: number; max?: number }[] | undefined) ?? [];
      const item = (key: number) => menu.find((m) => m.key === key);
      const fov = item(1);
      if (!fov || typeof fov.value !== "number") return null;
      const range = (key: number): [number, number] | undefined => {
        const m = item(key);
        return m && typeof m.min === "number" && typeof m.max === "number" ? [m.min, m.max] : undefined;
      };
      const ranges = Object.fromEntries(
        (
          [
            ["fov", range(1)],
            ["yaw", range(7)],
            ["lr", range(8)],
            ["ud", range(37)],
          ] as const
        ).filter(([, r]) => r),
      );
      return { fov: fov.value, yaw: item(7)?.value ?? 0, lr: item(8)?.value ?? 0, ud: item(37)?.value ?? 0, ranges };
    },
  };
  let lookAtBefore: number | undefined;
  let presetBefore: number | undefined;
  try {
    if (input.xf_preset && input.camera_preset !== undefined) throw planError("bad_input", "Give xf_preset or camera_preset, not both.");
    const target = (input.target as FrameOptions["target"]) ?? "face";
    const preset = input.xf_preset ? FRAMINGS[target].xf_preset : (input.camera_preset as number | undefined);
    if (preset !== undefined) {
      // A camera preset first (attribute 23): it puts the camera at a fixed offset from V, so the
      // framing loop only fine-tunes. XF presets 7-9 come from the test profile's TweakXL file.
      const set = await bridgeCall(context, "photo.camera.set", { camera_preset: preset });
      const applied = ((set.applied as CameraApplied[] | undefined) ?? [])[0];
      if (applied && applied.before_known !== false && typeof applied.before === "number" && applied.before >= 0) presetBefore = Math.round(applied.before);
      await sleepMs(800);
    }
    if (input.look_at !== undefined && input.look_at !== "keep") {
      const set = await bridgeCall(context, "photo.camera.set", { look_at: input.look_at === "off" ? 0 : 1 });
      const applied = ((set.applied as CameraApplied[] | undefined) ?? [])[0];
      if (applied && applied.before_known !== false && typeof applied.before === "number" && applied.before >= 0) lookAtBefore = Math.round(applied.before);
      await sleepMs(300);
    }
    const options: FrameOptions = {
      target,
      ...(input.span_m !== undefined ? { span_m: input.span_m as number } : {}),
      ...(input.offset !== undefined ? { offset: input.offset as FrameOptions["offset"] } : {}),
      ...(input.position !== undefined ? { position: input.position as FrameOptions["position"] } : {}),
      ...(input.face_camera !== undefined ? { face_camera: input.face_camera as boolean } : {}),
      ...(input.yaw_offset !== undefined ? { yaw_offset: input.yaw_offset as number } : {}),
      ...(input.method !== undefined ? { method: input.method as FrameOptions["method"] } : {}),
      ...(input.max_steps !== undefined ? { max_steps: input.max_steps as number } : {}),
      ...(input.tolerance !== undefined ? { tolerance: input.tolerance as number } : {}),
    };
    const result = await frame(adapter, options);
    if (lookAtBefore !== undefined || presetBefore !== undefined) {
      result.undo = {
        method: "photo.camera.set",
        params: { ...(presetBefore !== undefined ? { camera_preset: presetBefore } : {}), ...(result.undo?.params ?? {}), ...(lookAtBefore !== undefined ? { look_at: lookAtBefore } : {}) },
      };
    }
    return { value: preset !== undefined ? { ...result, camera_preset: preset } : result };
  } catch (error) {
    if (error instanceof FramingError) throw planError(error.code, error.message);
    throw error;
  } finally {
    if (hudUndo) await bridgeCall(context, "photo.hud.hide", hudUndo).catch(() => undefined);
  }
}

// --- the catalogue -------------------------------------------------------------------------------

export const CATALOGUE: readonly CommandDef[] = [
  // Bridge
  {
    name: "bridge.ping",
    title: "Check the game connection",
    description: "Checks that the game is running with XF Runtime Bridge and answering. Changes nothing.",
    permission: "read",
    input: obj(),
    bridge: { method: "ping" },
  },
  {
    name: "bridge.info",
    title: "Bridge details",
    description: "Shows the bridge and game versions, whether changes are allowed (allow_writes), and connection counts.",
    permission: "read",
    input: obj(),
    bridge: { method: "bridge.info" },
  },
  {
    name: "bridge.kill",
    title: "Switch the bridge off",
    description:
      "Emergency stop: switches the game bridge off until the game restarts. Nothing can reach the game through it afterwards. The game itself keeps running.",
    permission: "control",
    input: obj(),
    undo: "Restart the game to switch the bridge on again.",
    bridge: { method: "bridge.kill" },
  },

  // Capture (runs outside the game; works even when the bridge is off)
  {
    name: "capture.screenshot",
    title: "Screenshot the game",
    description:
      "Takes a screenshot of the game window from outside the game (what is on screen, including ReShade and overlays). Optionally keeps only an area (region, rect or rect_normalized). Saves the area at full resolution and returns a smaller copy for viewing (at most 1280 px on the long side unless max_width, max_height or scale says otherwise) plus the path of the full-resolution file.",
    permission: "read",
    input: obj({
      ...regionInput,
      route: oneOf(
        "How to grab the window. auto (default) reads Windows' copy of the game window, then the screen if the game is in front; printwindow and screen force one route.",
        ["auto", "printwindow", "screen"],
      ),
    }),
    local: async (input, { api, captureRoot }) =>
      wrapCapture(() =>
        captureWindow({
          target: api.captureTarget(),
          region: regionOf(input),
          view: viewOf(input),
          route: (input.route as "auto" | "printwindow" | "screen" | undefined) ?? "auto",
          name: input.name as string | undefined,
          outDir: captureRoot,
        }),
      ),
  },
  {
    name: "capture.recrop",
    title: "Crop a saved screenshot",
    description:
      "Cuts an area out of an earlier screenshot's full-resolution file (the .full.png path a screenshot returned) without taking a new one, and returns it at viewing size. Coordinates refer to that saved image.",
    permission: "read",
    input: obj({ path: str("The .full.png file of an earlier screenshot.", { maxLength: 1024 }), ...regionInput }, ["path"]),
    local: async (input, { captureRoot }) =>
      wrapCapture(() =>
        recrop({ path: input.path as string, region: regionOf(input), view: viewOf(input), name: input.name as string | undefined, root: captureRoot }),
      ),
  },
  {
    name: "capture.burst",
    title: "Screenshot a short burst",
    description:
      "Takes several screenshots of the same area in quick succession (frames, interval_ms apart) for flicker and motion checks: saves every frame like a screenshot, a contact sheet of all of them, and one manifest with the actual timings and how much each frame differs from the previous and the first. Returns the contact sheet for viewing.",
    permission: "read",
    input: obj({
      ...regionInput,
      frames: int("How many frames, 2 to 120. Default 10.", 2, 120),
      interval_ms: int("Target time between frames in milliseconds (0 = as fast as possible). Default 100.", 0, 10000),
      route: oneOf("How to grab the window (see capture_screenshot).", ["auto", "printwindow", "screen"]),
    }),
    local: async (input, { api, captureRoot, signal }) => {
      try {
        const record = await captureBurst({
          target: api.captureTarget(),
          region: regionOf(input),
          view: viewOf(input),
          route: (input.route as "auto" | "printwindow" | "screen" | undefined) ?? "auto",
          name: (input.name as string | undefined) ?? "burst",
          outDir: captureRoot,
          frames: (input.frames as number | undefined) ?? 10,
          intervalMs: (input.interval_ms as number | undefined) ?? 100,
          signal,
        });
        return {
          value: record,
          images: [{ path: record.contact_sheet.path, width: record.contact_sheet.width, height: record.contact_sheet.height, mimeType: "image/png", role: "view" }],
        };
      } catch (error) {
        captureFailure(error);
      }
    },
  },

  // Game state (read-only)
  {
    name: "game.status",
    title: "What the game is doing",
    description:
      "Says what the game is doing right now (phase: starting, main_menu, loading, gameplay, photo_mode, character_menu, menu or paused), the game version, whether V is in the world, whether photo mode is open or allowed, whether saving is locked, and whether changes are allowed at all (allow_writes).",
    permission: "read",
    input: obj(),
    bridge: { method: "game.status" },
  },
  {
    name: "game.wait",
    title: "Wait for a game phase",
    description:
      "Waits until the game reaches one of the given phases (for example photo_mode after asking the player to open it, or character_menu at a mirror), checking twice a second. Use it between steps that depend on something the player does.",
    permission: "read",
    input: obj(
      {
        phase: {
          type: "array",
          description: "Phases to wait for (any one of them).",
          items: oneOf("A game phase.", PHASES),
          minItems: 1,
          maxItems: PHASES.length,
        },
        timeout_ms: int("How long to wait, in milliseconds (default 60000, at most 600000).", 0, 600000),
      },
      ["phase"],
    ),
    local: async (input, { api, cid, signal }) => {
      const wanted = input.phase as string[];
      const timeout = (input.timeout_ms as number | undefined) ?? 60000;
      const started = performance.now();
      let last = "unknown";
      for (;;) {
        const status = await api.callBridge("game.status", {}, cid);
        if (!status.ok) throw Object.assign(new Error(status.error.message), { plain: status.error });
        last = String((status.result as { phase?: string }).phase);
        if (wanted.includes(last)) return { value: { phase: last, waited_ms: Math.round(performance.now() - started) } };
        if (performance.now() - started >= timeout) {
          throw planError("wait_timeout", `The game didn't reach ${wanted.join(" or ")} within ${Math.round(timeout / 1000)} s; it is in ${last}.`);
        }
        if (signal?.aborted) throw planError("interrupted", "Stopped before the game reached the phase.");
        await new Promise((r) => setTimeout(r, 500));
        if (signal?.aborted) throw planError("interrupted", "Stopped before the game reached the phase.");
      }
    },
  },
  {
    name: "player.appearance",
    title: "V's appearance settings",
    description:
      "Reads V's character-creator state: body and voice, life path and hair-length tags. While the appearance screen (a mirror) is open it also lists every option with its current value; give option to see one option's full list of values. check asks whether V's finalized look has particular options (group and option names).",
    permission: "read",
    input: obj({
      option: str("One option's internal name or on-screen label (appearance screen only).", { maxLength: 128 }),
      check: {
        type: "array",
        description: "Options to look for in V's finalized look.",
        maxItems: 16,
        items: {
          ...obj({ group: str("Customization group name.", { maxLength: 128 }), option: str("Option name.", { maxLength: 128 }), fpp: bool("First-person variant.") }, ["group", "option"]),
          description: "One option to look for.",
        },
      },
    }),
    bridge: { method: "player.appearance" },
  },
  {
    name: "photo.state",
    title: "Photo mode state",
    description:
      "Whether photo mode is open or allowed, and (with menu) every photo-mode menu item the game set up: its number, label, range or options and current value. options adds each option list (for example every expression with its value).",
    permission: "read",
    input: obj({ menu: bool("Include the menu items."), options: bool("Include every option list (implies menu).") }),
    bridge: { method: "photo.state" },
  },

  // Photo mode (changes vanish when photo mode closes)
  {
    name: "photo.open",
    title: "Open photo mode",
    description:
      "Opens photo mode by pressing the player's own photo mode key in the game window (read from the game's key bindings, N by default): the only key the XF tools ever send, and only to the game window. It checks first that V is in the world and the game allows photo mode, brings the game window to the front if needed and refuses if it can't, then waits until photo mode is open.",
    permission: "write-photo",
    input: obj({
      route: oneOf("sendinput (default: a key press, the game window must be in front) or postmessage (research: posted to the game window only).", ["sendinput", "postmessage"]),
      timeout_ms: int("How long to wait for photo mode after the key, in milliseconds (default 5000).", 500, 30000),
    }),
    undo: "photo.exit.",
    local: runPhotoOpen,
  },
  {
    name: "photo.enter",
    title: "Open photo mode (restricted route)",
    description:
      "Use photo_open instead. The game offers no way to open the full photo mode from inside, so without a route this answers that the photo mode key is needed (photo_open presses it). route quest opens a restricted photo mode (first-person camera only, no V tab) and is kept for research only.",
    permission: "write-photo",
    input: obj({
      route: oneOf("How to open photo mode: auto (the default; answers that the player must press the photo mode key until a proper route exists) or quest (research only: a restricted photo mode).", ["auto", "quest"]),
    }),
    undo: "photo.exit.",
    bridge: { method: "photo.enter" },
  },
  {
    name: "photo.exit",
    title: "Leave photo mode",
    description: "Leaves photo mode, discarding its settings as the game always does.",
    permission: "write-photo",
    input: obj(),
    undo: "photo.open (photo-mode settings start fresh).",
    bridge: { method: "photo.exit" },
  },
  {
    name: "photo.camera.set",
    title: "Frame the photo-mode shot",
    description: `Sets the photo-mode camera: a named preset (${Object.entries(CAMERA_PRESETS)
      .map(([name, preset]) => `${name}: ${preset.description}${preset.calibrated ? "" : " (not yet calibrated)"}`)
      .join("; ")}) and/or explicit values: field of view, roll, focus distance, aperture, depth of field, autofocus, film grain, chromatic aberration, photo mode's own camera preset, and V's placement in front of the camera (subject: yaw, left_right, near_far, up_down). Values are checked against the ranges photo mode itself offers. reset puts everything back to how photo mode opened.`,
    permission: "write-photo",
    input: obj({
      preset: oneOf("A named framing; explicit values override it.", Object.keys(CAMERA_PRESETS)),
      camera_preset: int("Photo mode's own camera preset: 0 Customization, 1-9 its presets (in the XF test profile 7 face, 8 eyes, 9 head and shoulders). Applied before the other values.", 0, 9),
      fov: num("Field of view in degrees (photo mode allows 5 to 90).", 1, 180),
      roll: num("Camera roll in degrees.", -360, 360),
      focal_distance: num("Focus distance in metres.", 0, 1000),
      aperture: num("Aperture (f-number).", 0, 100),
      dof: bool("Depth of field on or off."),
      autofocus: bool("Autofocus on or off."),
      look_at: int("V's look-at option value (see photo_state options).", 0, 1000),
      look_at_part: int("What V looks with: 1 head, 2 eyes (see photo_state options).", 0, 1000),
      grain: num("Film grain, 0 to 1 (0 = off).", 0, 1),
      chromatic_aberration: num("Chromatic aberration, -2 to 2 (0 = off).", -2, 2),
      subject: {
        description: "V's placement in front of the camera (photo mode's pose tab).",
        ...obj({
        yaw: num("V's rotation in degrees.", -360, 360),
        left_right: num("V's sideways offset.", -1000, 1000),
        near_far: num("V's distance offset.", -1000, 1000),
        up_down: num("V's height offset.", -1000, 1000),
        }),
      },
      reset: bool("Put every camera and placement setting back to how photo mode opened."),
    }),
    undo: "the result's undo parameters restore each previous value; reset (or the open-defaults preset) restores how photo mode opened.",
    bridge: { method: "photo.camera.set", params: expandCamera },
  },
  {
    name: "photo.light.set",
    title: "Adjust a photo-mode light",
    description:
      "Selects photo-mode light 1, 2 or 3, switches it on or off, picks spot or ambient, and sets its brightness, range, cone angles and colour (hue 0-360, saturation, luminosity). Lights start off each time photo mode opens. The light can't be moved; to light V from another side, turn V (photo_frame with yaw_offset, look-at off).",
    permission: "write-photo",
    input: obj(
      {
        light: int("Which light: 1, 2 or 3.", 1, 3),
        on: bool("Switch the light on (true) or off (false)."),
        type: oneOf("The kind of light: spot or ambient.", ["spot", "ambient"]),
        shadow: bool("The light casts shadows (true) or not."),
        brightness: num("Brightness, 0 to 100.", 0, 100),
        range: num("Range, 0 to 100.", 0, 100),
        inner_angle: num("Inner cone angle in degrees.", 0, 180),
        outer_angle: num("Outer cone angle in degrees.", 0, 180),
        hue: num("Colour hue, 0 to 360.", 0, 360),
        saturation: num("Colour saturation, 0 to 100.", 0, 100),
        luminosity: num("Colour luminosity, 0 to 100.", 0, 100),
        select_after: int("Select this light (1, 2 or 3) in the menu once the values are set; the undo uses it to put the menu's selection back.", 1, 3),
      },
      ["light"],
    ),
    undo: "the result's undo parameters restore that light's previous values (including on/off and type) and the menu's previous light selection.",
    bridge: { method: "photo.light.set" },
  },
  {
    name: "photo.hud.hide",
    title: "Hide the photo-mode interface",
    description:
      "Fades the photo-mode menus out for a clean screenshot (hidden: true, the default) or back in (hidden: false), and hides or shows the mouse cursor with them (cursor: false leaves the cursor alone). Wait about half a second before capturing.",
    permission: "write-photo",
    input: obj({ hidden: bool("true hides, false shows. Default true."), cursor: bool("Also hide or show the mouse cursor. Default true.") }),
    undo: "photo.hud.hide with hidden: false; leaving photo mode (or the kill switch) always shows the menu and cursor again.",
    bridge: { method: "photo.hud.hide" },
  },
  {
    name: "photo.expression.set",
    title: "Set V's photo-mode expression",
    description:
      "Sets V's facial expression in photo mode by its value (faceId), exactly as the photo-mode expression list does. photo_state with options lists every expression and its value; a value not in the list is refused.",
    permission: "write-photo",
    input: obj({ faceId: int("The expression's value.", 0, 100000) }, ["faceId"]),
    undo: "the result's undo parameters restore the previous expression.",
    bridge: { method: "photo.expression.set" },
  },
  {
    name: "photo.subject",
    title: "Where V and the camera are",
    description:
      "Reads where V's head is in the world and on screen (plus an optional point relative to it: up, forward and right in metres), the photo-mode camera's position, directions, field of view and aspect ratio, and V's current placement values. photo_frame uses it; it changes nothing.",
    permission: "read",
    input: obj({
      up: num("Metres above V's head joint (world vertical).", -2, 2),
      forward: num("Metres in front of V's head joint (V's facing).", -2, 2),
      right: num("Metres to V's right of the head joint.", -2, 2),
    }),
    bridge: { method: "photo.subject" },
  },
  {
    name: "photo.frame",
    title: "Frame V automatically",
    description: `Frames V in photo mode without hand-tuned values: turns V to face the camera (plus yaw_offset degrees for a light sweep), puts the target (${Object.entries(
      FRAMINGS,
    )
      .map(([name, f]) => `${name}: ${f.description}`)
      .join("; ")}) at the centre of the window (or at position) and sets the field of view so span_m metres fill the window height. It measures where V is through the game's camera (or, if that isn't available, from window captures, more roughly) and corrects in a few steps. The result records the chosen values and an undo.`,
    permission: "write-photo",
    input: obj({
      target: oneOf("What to frame. Default face.", Object.keys(FRAMINGS)),
      span_m: num("World height in metres that fills the window height (default: 0.2 eyes, 0.36 face, 0.8 head-and-shoulders).", 0.02, 5),
      offset: {
        description: "The target point relative to V's head joint, in metres (overrides the framing's own).",
        ...obj({ up: num("Metres up.", -2, 2), forward: num("Metres forward (V's facing).", -2, 2), right: num("Metres to V's right.", -2, 2) }),
      },
      position: {
        description: "Where the target should sit, as fractions of the window (default the centre).",
        ...obj({ x: num("0 left edge, 1 right edge.", 0, 1), y: num("0 top edge, 1 bottom edge.", 0, 1) }),
      },
      xf_preset: bool("First select the framing's XF camera preset (7 face, 8 eyes, 9 head and shoulders; needs the test profile's preset file), then fine-tune."),
      camera_preset: int("First select this photo-mode camera preset (0-9), then fine-tune.", 0, 9),
      face_camera: bool("Turn V to face the camera first. Default true."),
      yaw_offset: num("Degrees V turns away from facing the camera (counter-clockwise seen from above), for light sweeps.", -90, 90),
      look_at: oneOf("V's look-at before framing: keep (default), off (V's head follows the body, for light sweeps) or camera.", ["keep", "off", "camera"]),
      method: oneOf("auto (default: the game's camera, else window captures), project (the game's camera only) or capture (window captures only).", ["auto", "project", "capture"]),
      max_steps: int("Most correction steps (default 6).", 1, 12),
      tolerance: num("Allowed centring error as a fraction of the window height (default 0.01).", 0.001, 0.2),
    }),
    undo: "the result's undo puts the field of view, V's rotation and placement (and look-at and camera preset) back as they were.",
    local: runFrame,
  },

  // Character
  {
    name: "cc.apply",
    title: "Change one appearance option",
    description:
      "While the appearance screen is open (at a mirror or ripperdoc), sets one character-creator option to a value, exactly as clicking it does: option is the option's internal name or on-screen label (for example XF), index counts from 0. It never confirms: the player keeps the look by confirming, or backs out to discard every change. Refused anywhere else.",
    permission: "write-character",
    input: obj({ option: str("The option's internal name or on-screen label.", { maxLength: 128 }), index: int("The value, counting from 0.", 0, 100000) }, ["option", "index"]),
    undo: "cc.apply with the previous index (in the result's undo), or Back in the appearance screen, which discards every change made there.",
    bridge: { method: "cc.apply" },
  },
  {
    name: "cc.confirm",
    title: "Confirm the appearance screen",
    description:
      "Presses Confirm on the open appearance screen (mirror or ripperdoc), keeping the look in the running game and closing the screen. Only in the XF test profile, and only in sessions that end by loading the safety save; saving stays locked while the change is live. Refused on a creator opened in new-game mode, where Confirm wouldn't keep the look.",
    permission: "write-character",
    input: obj(),
    undo: "Load the safety save (the look stays in the running game until then).",
    bridge: { method: "cc.confirm" },
  },
  {
    name: "cc.back",
    title: "Leave the appearance screen without keeping changes",
    description: "Presses Back on the open appearance screen and confirms it, discarding every change made there and closing the screen. Only in the XF test profile.",
    permission: "write-character",
    input: obj(),
    undo: "Nothing to undo: the changes made on the screen were discarded.",
    bridge: { method: "cc.back" },
  },

  // World
  {
    name: "world.time.set",
    title: "Set the time of day",
    description:
      "Sets the in-game clock (hours, minutes, seconds) while V is in the world, or restores an exact earlier time with total_seconds. Changing the clock can trigger timed events in quests, so use a disposable save.",
    permission: "write-world",
    input: obj({
      hours: int("Hour, 0 to 23.", 0, 23),
      minutes: int("Minute, 0 to 59.", 0, 59),
      seconds: int("Second, 0 to 59.", 0, 59),
      total_seconds: int("An exact earlier time from a previous result's undo.", 0, 2147483647),
    }),
    undo: "world.time.set with total_seconds from the result's undo.",
    bridge: { method: "world.time.set" },
  },
  {
    name: "world.pause",
    title: "Freeze the world",
    description:
      "Freezes everything around V (paused: true), the way the appearance screen does, or unfreezes it (paused: false). Only in normal play: photo mode and the appearance screen already freeze the world.",
    permission: "write-world",
    input: obj({ paused: bool("true freezes, false unfreezes.") }, ["paused"]),
    undo: "world.pause with paused: false; the kill switch also unfreezes.",
    bridge: { method: "world.pause" },
  },
];

export function findCommand(name: string): CommandDef | undefined {
  return CATALOGUE.find((command) => command.name === name || toolName(command) === name);
}

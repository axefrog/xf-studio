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

import { captureWindow, CaptureError, recrop, type CaptureRecord } from "../capture/capture.ts";
import { NAMED_REGIONS, type RegionSpec } from "../capture/regions.ts";
import type { CommandApi, ImageRef } from "./command-api.ts";
import { CAMERA_PRESETS, expandCamera } from "./presets.ts";
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
export type CommandContext = { api: CommandApi; cid: string; captureRoot: string };

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

function wrapCapture(run: () => CaptureRecord): CommandResult {
  try {
    return captureResult(run());
  } catch (error) {
    if (error instanceof CaptureError) throw planError(error.code === "bad_region" || error.code === "bad_file" ? "bad_input" : `capture_${error.code}`, error.message);
    throw error;
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
    local: async (input, { api, cid }) => {
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
        await new Promise((r) => setTimeout(r, 500));
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
        items: obj({ group: str("Customization group name.", { maxLength: 128 }), option: str("Option name.", { maxLength: 128 }), fpp: bool("First-person variant.") }, ["group", "option"]),
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
    name: "photo.enter",
    title: "Open photo mode",
    description:
      "Opens photo mode from normal play, the way the game's own quest scripts do (needs Codeware). If it can't, the player can press the photo mode key instead; game.wait with phase photo_mode then continues.",
    permission: "write-photo",
    input: obj(),
    undo: "photo.exit.",
    bridge: { method: "photo.enter" },
  },
  {
    name: "photo.exit",
    title: "Leave photo mode",
    description: "Leaves photo mode, discarding its settings as the game always does.",
    permission: "write-photo",
    input: obj(),
    undo: "photo.enter (photo-mode settings start fresh).",
    bridge: { method: "photo.exit" },
  },
  {
    name: "photo.camera.set",
    title: "Frame the photo-mode shot",
    description: `Sets the photo-mode camera: a named preset (${Object.entries(CAMERA_PRESETS)
      .map(([name, preset]) => `${name}: ${preset.description}${preset.calibrated ? "" : " (not yet calibrated)"}`)
      .join("; ")}) and/or explicit values: field of view, roll, focus distance, aperture, depth of field, autofocus, and V's placement in front of the camera (subject: yaw, left_right, near_far, up_down). Values are checked against the ranges photo mode itself offers. reset puts everything back to how photo mode opened.`,
    permission: "write-photo",
    input: obj({
      preset: oneOf("A named framing; explicit values override it.", Object.keys(CAMERA_PRESETS)),
      fov: num("Field of view in degrees (photo mode allows 5 to 90).", 1, 180),
      roll: num("Camera roll in degrees.", -360, 360),
      focal_distance: num("Focus distance in metres.", 0, 1000),
      aperture: num("Aperture (f-number).", 0, 100),
      dof: bool("Depth of field on or off."),
      autofocus: bool("Autofocus on or off."),
      look_at: int("V's look-at option value (see photo_state options).", 0, 1000),
      look_at_part: int("What V looks with: 0 upper body, 1 head, 2 eyes.", 0, 1000),
      subject: obj({
        yaw: num("V's rotation in degrees.", -360, 360),
        left_right: num("V's sideways offset.", -1000, 1000),
        near_far: num("V's distance offset.", -1000, 1000),
        up_down: num("V's height offset.", -1000, 1000),
      }),
      reset: bool("Put every camera and placement setting back to how photo mode opened."),
    }),
    undo: "the result's undo parameters restore each previous value; reset (or the open-defaults preset) restores how photo mode opened.",
    bridge: { method: "photo.camera.set", params: expandCamera },
  },
  {
    name: "photo.light.set",
    title: "Adjust a photo-mode light",
    description:
      "Selects photo-mode light 1, 2 or 3 and sets its brightness, range, cone angles and colour (hue 0-360, saturation, luminosity). Placing or switching lights on still needs the photo-mode menu.",
    permission: "write-photo",
    input: obj(
      {
        light: int("Which light: 1, 2 or 3.", 1, 3),
        brightness: num("Brightness, 0 to 100.", 0, 100),
        range: num("Range, 0 to 100.", 0, 100),
        inner_angle: num("Inner cone angle in degrees.", 0, 180),
        outer_angle: num("Outer cone angle in degrees.", 0, 180),
        hue: num("Colour hue, 0 to 360.", 0, 360),
        saturation: num("Colour saturation, 0 to 100.", 0, 100),
        luminosity: num("Colour luminosity, 0 to 100.", 0, 100),
      },
      ["light"],
    ),
    undo: "the result's undo parameters restore that light's previous values.",
    bridge: { method: "photo.light.set" },
  },
  {
    name: "photo.hud.hide",
    title: "Hide the photo-mode interface",
    description: "Fades the photo-mode menus out for a clean screenshot (hidden: true, the default) or back in (hidden: false). Wait about half a second before capturing.",
    permission: "write-photo",
    input: obj({ hidden: bool("true hides, false shows. Default true.") }),
    undo: "photo.hud.hide with hidden: false; reopening photo mode always shows it.",
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

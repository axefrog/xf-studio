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
import { bool, int, num, obj, oneOf, str, type JsonSchema } from "./schema.ts";

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
];

export function findCommand(name: string): CommandDef | undefined {
  return CATALOGUE.find((command) => command.name === name || toolName(command) === name);
}

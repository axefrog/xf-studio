// The command catalogue: the single source of truth for what XF tools can ask the game to do.
// Each entry has a name, plain-language text for end users, an input schema, a permission class
// and either a bridge method or a local handler. The MCP server, the CLI and the session runner
// all derive their tools and commands from this list, so a command added here appears everywhere
// (tests/catalogue.test.ts checks that the MCP tool list equals this catalogue).
//
// Permission classes (data for a future consent screen):
//   read             looks at the game or its window; changes nothing
//   notify           shows a short message in the bridge's own in-game label; changes nothing in the game
//   write-photo      changes photo mode only (camera, lights, expression, its UI); gone when photo mode closes
//   write-world      changes the world around V (time of day, time flow)
//   write-character  changes V's appearance
//   write-inventory  changes V's clothing and inventory (off in the bridge's config.ini until the maintainer approves it)
//   write-save       makes a manual save or loads one
//   write-showroom   spawns, turns and removes XF Finish Showroom's test heads and light rigs (the test profile only)
//   control          changes only the bridge itself (the kill switch)
// The game side enforces the real gate: every write is refused unless the bridge's config.ini
// has allow_writes = true, which only the dedicated test profile sets.

import { captureBurst, captureWindow, CaptureError, grabForAnalysis, recrop, type CaptureRecord } from "../capture/capture.ts";
import { NAMED_REGIONS, type RegionSpec } from "../capture/regions.ts";
import type { CommandApi, ImageRef } from "./command-api.ts";
import { frame, FramingError, FRAMINGS, LENSES, type CameraApplied, type FramingAdapter, type FrameOptions, type SubjectReading } from "./framing.ts";
import { CAMERA_PRESETS, expandCamera } from "./presets.ts";
import { KeySendError, readPhotoModeBinding, virtualKey, type FocusPolicy, type KeyRoute } from "../input/photo-key.ts";
import { plainBridgeError } from "./errors.ts";
import { summarizeSettings, type SettingsGroups } from "./options.ts";
import { bool, int, num, obj, oneOf, str, type JsonSchema } from "./schema.ts";
import { isMatch, matchLabel } from "./labels.ts";
import { runShowroomLight, runShowroomRotate, runShowroomSpawn } from "../showroom/commands.ts";
import { eyesOf, facingOf, toWorld, type Vec3 as ShowroomVec3 } from "../showroom/plan.ts";

/** game.status refusals game.wait waits through: the engine not ticking for a moment while a save loads (0.5.2). */
const WAIT_THROUGH = new Set(["timeout", "timeout_after_start", "busy", "game_not_running", "game_loading"]);

/** Game phases game.status reports (XFBridgeActions.Phase in the redscript layer). */
export const PHASES = ["starting", "main_menu", "loading", "gameplay", "photo_mode", "character_menu", "menu", "paused", "shutting_down"] as const;

export type Permission = "read" | "notify" | "write-photo" | "write-world" | "write-character" | "write-inventory" | "write-save" | "write-showroom" | "control";

export const PERMISSIONS: Record<Permission, { label: string; description: string }> = {
  read: { label: "Look", description: "Reads what the game is doing, or takes a screenshot of its window. Changes nothing." },
  notify: {
    label: "Show messages in the game",
    description: "Shows short messages to the player under the bridge's status label in the game. Changes nothing in the game; the messages fade by themselves.",
  },
  "write-photo": {
    label: "Control photo mode",
    description: "Opens and closes photo mode and changes its camera, lights, expression and on-screen menu. Nothing outlives photo mode.",
  },
  "write-world": { label: "Change the world", description: "Changes the in-game time of day or stops time. Undo by setting it back." },
  "write-character": {
    label: "Change V's appearance",
    description: "Opens the appearance screen, changes its options and camera, and confirms or leaves it (opening and leaving only in the XF test profile).",
  },
  "write-inventory": {
    label: "Change V's clothing",
    description:
      "Equips and unequips V's clothing, and can add a test item to V's inventory (and remove it again). Off in the bridge's settings until the maintainer allows it; undo by equipping the earlier item.",
  },
  "write-save": {
    label: "Save and load the game",
    description:
      "Makes a new manual save (never overwrites one) or loads a save, which discards everything since it. Saving is refused while the bridge's own changes are live unless explicitly overridden.",
  },
  "write-showroom": {
    label: "Set up the finish showroom",
    description:
      "Spawns XF Finish Showroom's mannequin heads and their light rigs in front of V, turns them and removes them again. Nothing is saved: clearing, the kill switch or loading a save removes them. Off in the bridge's settings except in the XF test profile.",
  },
  control: {
    label: "Stop the bridge",
    description: "Switches the game bridge off until it is reconnected from inside the game (test builds) or the game restarts. Always allowed.",
  },
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
  /** timeoutMs: how long the tools wait for the bridge's answer, for a method that waits on the game (default: the client's 8 s). */
  bridge?: { method: string; params?: (input: Record<string, unknown>) => Record<string, unknown>; timeoutMs?: (input: Record<string, unknown>) => number };
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

/** pose.live.apply: the catalogue's list of {joint, rotation} becomes the bridge's map of joint to rotation. */
export function livePoseParams(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (Array.isArray(input.joints)) {
    const joints: Record<string, unknown> = {};
    for (const entry of input.joints as { joint: string; rotation: number[] }[]) {
      if (Object.hasOwn(joints, entry.joint)) throw planError("bad_input", `Joint ${entry.joint} is given twice.`);
      joints[entry.joint] = entry.rotation;
    }
    out.joints = joints;
  }
  if (input.hips !== undefined) out.hips = input.hips;
  if (input.restore !== undefined) out.restore = input.restore;
  return out;
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
  // The key press changes the game like a photo write, so it follows the bridge's own write gate:
  // allow_writes and the photo class in the plugin's config.ini.
  const classes = Array.isArray(status.write_classes) ? (status.write_classes as string[]) : [];
  if (status.allow_writes !== true || !classes.includes("photo")) throw Object.assign(new Error("writes"), { plain: plainBridgeError(status.allow_writes === true ? "write_class_disabled" : "writes_disabled") });
  // The in-game panel can pause writes; the key press is a write too.
  if (status.writes_paused === true) throw Object.assign(new Error("writes"), { plain: plainBridgeError("writes_paused") });
  const phase = String(status.phase);
  if (phase === "photo_mode") return { value: { changed: false, note: "Photo mode was already open." } };
  if (phase !== "gameplay") throw planError("not_in_gameplay", `Photo mode opens only from normal play; the game is in ${phase}. Close menus first.`);
  // Only an explicit yes lets the key go (RB-36): a missing or unreadable answer is a no.
  if (status.photo_mode_can_open !== true) {
    throw planError("photo_not_allowed", "The game doesn't allow photo mode right now (combat, a scene or a vehicle?), or didn't say it does. Nothing was sent.");
  }
  let binding;
  try {
    binding = readPhotoModeBinding();
  } catch (error) {
    if (error instanceof KeySendError) throw planError(error.code, error.message);
    throw error;
  }
  const vk = virtualKey(binding.name);
  if (vk === null) throw planError("key_unsupported", `The photo mode key is bound to ${binding.name}, which the bridge can't send safely (it isn't a letter, digit, function or navigation key). Ask the player to press it.`);
  const target = context.api.keyTarget();
  if (!target) throw planError("no_window", "The game has no visible window to send the key to.");
  const route = ((input.route as string | undefined) ?? "sendinput") as KeyRoute;
  const focus = ((input.focus as string | undefined) ?? "require") as FocusPolicy;
  // Checked again at the last moment, after the window came forward (RB-37): if the game left normal
  // play or stopped allowing photo mode meanwhile, the key isn't sent.
  const beforeSend = async () => {
    const now = await bridgeCall(context, "game.status", {});
    if (String(now.phase) !== "gameplay" || now.photo_mode_can_open !== true) {
      throw planError("photo_not_allowed", `The game changed while its window came to the front (it is in ${String(now.phase)}), so the key wasn't sent. Try again from normal play.`);
    }
  };
  let sent;
  try {
    sent = await context.api.keySender()(target, vk, route, { beforeSend, focus });
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
        value: {
          changed: true,
          key: binding.name,
          key_source: binding.source,
          ...sent,
          ...(route === "sendinput" ? { focus } : {}),
          ...(sent.focused_by_bridge
            ? { warning: "The bridge brought the game window to the front (focus: bring_to_front); anything the player was typing elsewhere at that moment went to the game." }
            : {}),
          waited_ms: Math.round(performance.now() - started),
          undo: { method: "photo.exit", params: {} },
        },
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
    // Between the reads that wait for a change to take (the stand-in and the camera move a frame later).
    pause: async (ms) => {
      await sleepMs(ms);
    },
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
  let rollBefore: number | undefined;
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
      // A camera preset carries its own roll, and another mod's presets can override the XF ones (session 3:
      // Portrait Enhancer's presets 5-9 roll the camera 90 degrees). Level the camera unless asked not to.
      if (input.keep_roll !== true) {
        const levelled = await bridgeCall(context, "photo.camera.set", { roll: 0 });
        const roll = ((levelled.applied as CameraApplied[] | undefined) ?? [])[0];
        if (roll && roll.before_known !== false && typeof roll.before === "number") rollBefore = roll.before;
        await sleepMs(300);
      }
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
      ...(input.lens !== undefined ? { lens: input.lens as FrameOptions["lens"] } : {}),
      ...(preset !== undefined ? { camera_preset_selected: true } : {}),
      ...(input.method !== undefined ? { method: input.method as FrameOptions["method"] } : {}),
      ...(input.max_steps !== undefined ? { max_steps: input.max_steps as number } : {}),
      ...(input.tolerance !== undefined ? { tolerance: input.tolerance as number } : {}),
    };
    const result = await frame(adapter, options);
    if (lookAtBefore !== undefined || presetBefore !== undefined || rollBefore !== undefined) {
      result.undo = {
        method: "photo.camera.set",
        params: {
          ...(presetBefore !== undefined ? { camera_preset: presetBefore } : {}),
          ...(rollBefore !== undefined ? { roll: rollBefore } : {}),
          ...(result.undo?.params ?? {}),
          ...(lookAtBefore !== undefined ? { look_at: lookAtBefore } : {}),
        },
      };
    }
    if (rollBefore !== undefined && Math.abs(rollBefore) > 0.5) result.notes.unshift(`The camera preset rolled the camera ${Math.round(rollBefore)} degrees; it was levelled (keep_roll keeps it).`);
    return { value: preset !== undefined ? { ...result, camera_preset: preset } : result };
  } catch (error) {
    // Every failure path puts back what this call changed (RB-68): the framing loop has already put back the
    // field of view and V's placement; the camera preset, roll and look-at set here go back now, in one call
    // with the loop's own undo (the preset first, as photo.camera.set applies it), like the success undo.
    const framing = error instanceof FramingError ? error : null;
    const frameUndo = framing?.restore?.undo?.params ?? {};
    const own = {
      ...(presetBefore !== undefined ? { camera_preset: presetBefore } : {}),
      ...(rollBefore !== undefined ? { roll: rollBefore } : {}),
      ...(lookAtBefore !== undefined ? { look_at: lookAtBefore } : {}),
    };
    let restoreNote = "";
    let restored = framing?.restore?.restored ?? true;
    const undo = Object.keys(own).length ? { method: "photo.camera.set", params: { ...own, ...frameUndo } } : (framing?.restore?.undo ?? null);
    if (Object.keys(own).length) {
      try {
        await bridgeCall(context, "photo.camera.set", undo!.params);
        restoreNote = ` The ${Object.keys(own).map((k) => k.replace("_", " ")).join(", ")} set before framing ${Object.keys(own).length === 1 ? "was" : "were"} put back too.`;
      } catch (restoreError) {
        restored = false;
        restoreNote = ` Putting the ${Object.keys(own).map((k) => k.replace("_", " ")).join(", ")} back failed (${(restoreError as Error).message}); the undo is ${JSON.stringify(undo!.params)}.`;
      }
    }
    if (framing || restoreNote) {
      // The steps taken so far, the undo and what was put back go with the refusal (and into the command log).
      const plain = (error as { plain?: { code?: string } }).plain;
      const code = framing ? framing.code : (plain?.code ?? "failed");
      const message = `${(error as Error).message}${restoreNote}`;
      const detail = { ...(framing?.steps.length ? { steps: framing.steps } : {}), undo, restored, ...(framing?.restore?.unknown.length ? { not_restored: framing.restore.unknown } : {}) };
      throw Object.assign(new Error(message), { plain: { code, message, detail: JSON.stringify(detail) } });
    }
    throw error;
  } finally {
    if (hudUndo) await bridgeCall(context, "photo.hud.hide", hudUndo).catch(() => undefined);
  }
}

/**
 * The camera position and look-at point photo.camera.place asks for (0.5.2): a world point, V's head, or a showroom
 * head's eyes as the target; the camera at a world position, or distance_m from the target at azimuth_deg (from the
 * way the target faces, counter-clockwise seen from above, as photo.light.set's azimuth) and elevation_deg. Pure.
 */
export function cameraPlacement(
  target: ShowroomVec3,
  facing: ShowroomVec3,
  input: { position?: number[]; distance_m?: number; azimuth_deg?: number; elevation_deg?: number },
): { position: ShowroomVec3; look_at: ShowroomVec3 } {
  if (input.position) return { position: input.position as ShowroomVec3, look_at: target };
  const d = input.distance_m ?? 1.5, az = ((input.azimuth_deg ?? 0) * Math.PI) / 180, el = ((input.elevation_deg ?? 0) * Math.PI) / 180;
  const n = Math.hypot(facing[0], facing[1]) || 1;
  const fx = facing[0] / n, fy = facing[1] / n;
  const dx = fx * Math.cos(az) - fy * Math.sin(az), dy = fx * Math.sin(az) + fy * Math.cos(az);
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return {
    position: [round(target[0] + d * Math.cos(el) * dx), round(target[1] + d * Math.cos(el) * dy), round(target[2] + d * Math.sin(el))],
    look_at: target.map(round) as ShowroomVec3,
  };
}

/** photo.camera.place: resolves the target (a point, V's head, or a showroom head's eyes), then asks the bridge to move the camera. */
async function runCameraPlace(input: Record<string, unknown>, context: CommandContext): Promise<CommandResult> {
  const given = ["look_at", "target", "piece"].filter((key) => input[key] !== undefined);
  if (given.length !== 1) throw planError("bad_input", "Give one target: look_at (a world point), target: v (V's head) or piece (a showroom head's index).");
  if (input.position !== undefined && (input.distance_m !== undefined || input.azimuth_deg !== undefined || input.elevation_deg !== undefined))
    throw planError("bad_input", "Give position, or distance_m with azimuth_deg and elevation_deg, not both.");
  let target: ShowroomVec3;
  let facing: ShowroomVec3 = [0, 1, 0];
  if (input.look_at !== undefined) {
    target = input.look_at as ShowroomVec3;
  } else if (input.target === "v") {
    const subject = await bridgeCall(context, "photo.subject", { up: 0.075, forward: 0.09, right: 0 });
    const t = subject.target as { x: number; y: number; z: number };
    const f = subject.subject_forward as { x: number; y: number; z: number };
    target = [t.x, t.y, t.z];
    facing = [f.x, f.y, 0];
  } else {
    const state = await bridgeCall(context, "showroom.state", {});
    const piece = ((state.pieces as { index: number; position: ShowroomVec3; yaw: number }[] | undefined) ?? []).find((p) => p.index === input.piece);
    if (!piece) throw planError("no_such_piece", `The showroom has no head ${String(input.piece)}; showroom_state lists them.`);
    target = toWorld(piece.position, piece.yaw, eyesOf([0, -0.0403, 1.6397]));
    facing = facingOf(piece.yaw);
  }
  const placement = cameraPlacement(target, facing, input as { position?: number[]; distance_m?: number; azimuth_deg?: number; elevation_deg?: number });
  const placed = await bridgeCall(context, "photo.camera.place", placement);
  return { value: { ...placement, ...placed } };
}

/** photo.light.set: place {camera: true} goes to the bridge as "camera" (the schema has no string-or-object). */
export function lightParams(input: Record<string, unknown>): Record<string, unknown> {
  const place = input.place as Record<string, unknown> | undefined;
  if (!place) return input;
  const given = ["camera", "world", "azimuth", "elevation", "distance"].filter((key) => place[key] !== undefined);
  if (place.camera !== undefined && given.length > 1) throw planError("bad_input", "Give place.camera alone, or a position (azimuth, elevation, distance, or world).");
  if (place.world !== undefined && given.length > 1) throw planError("bad_input", "Give place.world alone, or azimuth, elevation and distance.");
  if (place.camera === false) throw planError("bad_input", "place.camera takes true (put the light where the camera is now).");
  return place.camera === true ? { ...input, place: "camera" } : input;
}

/** game.load: exactly one of latest and name, and discard_unsaved: true (RB-56). */
function loadParams(input: Record<string, unknown>): Record<string, unknown> {
  if ((input.latest === true) === (input.name !== undefined)) throw planError("bad_input", "Give latest: true or a save's name (one of them).");
  if (input.latest === false) throw planError("bad_input", "latest takes true (the most recent save); give a name instead to load another.");
  if (input.discard_unsaved !== true)
    throw planError("bad_input", "Loading a save discards everything since it, unsaved progress included, and the game won't ask first. Pass discard_unsaved: true to load anyway.");
  return input;
}

// The client's wait for game.save and game.load, derived from the server's worst case (RB-55; the
// formulas are in native/src/core/Writes.hpp, and tools/test/catalogue.test.ts checks these constants
// against that header and GameThreadQueue.hpp).
/** The longest game-thread step: request_timeout_ms (default 2000) plus the queue's running grace (1000). */
export const SERVER_STEP_MS = 2000 + 1000;
export const SAVE_UNLOCK_WAIT_MS = 3000; // writes::kSaveUnlockWaitMs
export const SAVE_LIST_WAIT_MS = 5000; // writes::kSaveListWaitMs
/** The pipe's round trip and the bridge thread's own work, on top of the server's worst case. */
export const CLIENT_SLACK_MS = 2000;
/** game.save: timeout_ms + the unlock wait + 5 steps (prepare, a status overshoot twice, save, relock). */
export const saveClientTimeoutMs = (timeoutMs = 20000) => timeoutMs + SAVE_UNLOCK_WAIT_MS + 5 * SERVER_STEP_MS + CLIENT_SLACK_MS;
/** game.load: the list wait + 3 steps (list, a status overshoot, load). */
export const loadClientTimeoutMs = () => SAVE_LIST_WAIT_MS + 3 * SERVER_STEP_MS + CLIENT_SLACK_MS;

/** cc.apply: exactly one of index, value and label (the schema can't say "one of", so the tools check it too). */
function characterApplyParams(input: Record<string, unknown>): Record<string, unknown> {
  const given = ["index", "value", "label"].filter((key) => input[key] !== undefined);
  if (given.length !== 1)
    throw planError("bad_input", given.length ? "Give one of index, value or label." : "Give index (counting from 0), value (the value's name or on-screen label) or label (the name the creator shows, loosely matched).");
  return input;
}

const listText = (items: { index: number; text: string }[]) => items.map((c) => `${c.index} ${c.text}`).join(", ");

/**
 * cc.apply with label (0.4.2): reads the option's values (player.appearance with option), finds the one whose
 * name or on-screen label matches (labels.ts), and applies it by index; the answer names the index chosen.
 */
async function runCharacterApply(input: Record<string, unknown>, context: CommandContext): Promise<CommandResult> {
  const params = characterApplyParams(input);
  if (params.label === undefined) return { value: await bridgeCall(context, "cc.apply", params) };
  const option = String(params.option);
  const read = await bridgeCall(context, "player.appearance", { option });
  const described = read.option as { name?: string; values?: string[]; labels?: string[] } | undefined;
  if (!described || !Array.isArray(described.values)) {
    throw planError("not_in_character_menu", "The appearance screen isn't open, so the option's values can't be read. Open it (cc_open), then try again.");
  }
  const candidates = described.values.map((value, index) => ({ index, texts: [described.labels?.[index] ?? "", value] }));
  const wanted = String(params.label);
  const match = matchLabel(candidates, wanted);
  if (!isMatch(match)) {
    if (match.ambiguous) throw planError("bad_input", `More than one value of ${option} matches "${wanted}": ${listText(match.candidates)}. Give more of the name, or its index.`);
    const some = candidates.slice(0, 8).map((c) => ({ index: c.index, text: c.texts.find(Boolean) ?? "" }));
    throw planError("bad_input", `No value of ${option} is called "${wanted}" (${candidates.length} values; the first: ${listText(some)}). player_appearance with option lists them all.`);
  }
  // The row and the value read above go with the index, so the bridge refuses (stale_match) if the slot's row
  // in use or the value at that index changed in between, instead of landing in another row's list (RB-71).
  const expected = {
    ...(typeof described.name === "string" && described.name ? { expect_option: described.name } : {}),
    ...(typeof described.values[match.index] === "string" && described.values[match.index] ? { expect_value: described.values[match.index] } : {}),
  };
  const applied = await bridgeCall(context, "cc.apply", { option, index: match.index, ...expected });
  return { value: { ...applied, index: match.index, label: match.text, label_matched_by: match.matched_by } };
}

/**
 * photo.expression.set (0.4.2): by faceId (the menu's value for the option, which is its position in the
 * list, not the face table index) or by label (the name the expression list shows, matched as cc.apply's
 * label is). The answer names the menu value and, where photo.state reports it, the face table index.
 */
async function runExpressionSet(input: Record<string, unknown>, context: CommandContext): Promise<CommandResult> {
  const given = ["faceId", "label"].filter((key) => input[key] !== undefined);
  if (given.length !== 1) throw planError("bad_input", given.length ? "Give faceId or label, not both." : "Give faceId (the menu's value, from photo_state options) or label (the expression's name).");
  if (input.faceId !== undefined) return { value: await bridgeCall(context, "photo.expression.set", { faceId: input.faceId }) };
  const state = await bridgeCall(context, "photo.state", { options: true });
  const menu = (state.menu as { key: number; options?: { data: number; text: string; table_index?: number }[] }[] | undefined) ?? [];
  const options = menu.find((item) => item.key === 28)?.options;
  if (!options?.length) throw planError("unavailable", "Photo mode's expression list hasn't been seen yet. Open the V tab's expressions once (or reopen photo mode), then try again.");
  const wanted = String(input.label);
  const match = matchLabel(options.map((o, index) => ({ index, texts: [o.text] })), wanted);
  if (!isMatch(match)) {
    if (match.ambiguous) throw planError("bad_input", `More than one expression matches "${wanted}": ${match.candidates.map((c) => c.text).join(", ")}. Give more of the name.`);
    throw planError("bad_input", `No expression is called "${wanted}" in photo mode's list (${options.length} expressions; photo_state with options lists them).`);
  }
  const chosen = options[match.index];
  const applied = await bridgeCall(context, "photo.expression.set", { faceId: chosen.data });
  return {
    value: { ...applied, label: chosen.text, label_matched_by: match.matched_by, menu_value: chosen.data, ...(chosen.table_index !== undefined ? { table_index: chosen.table_index } : {}) },
  };
}

/** game.options.read: the bridge's raw answer plus a plain summary of the settings a capture depends on. */
async function runOptionsRead(input: Record<string, unknown>, context: CommandContext): Promise<CommandResult> {
  const raw = await bridgeCall(context, "game.options.read", input);
  const settings = raw.settings as { groups?: SettingsGroups } | undefined;
  return { value: settings ? { summary: summarizeSettings(settings.groups), ...raw } : raw };
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
      "Emergency stop: switches the game bridge off and puts back what it left switched on (a frozen world, a hidden photo-mode menu, a live-posed carrier). Nothing can reach the game through it afterwards, until the player presses Reconnect in the game's XF Runtime Bridge window (Cyber Engine Tweaks overlay, test builds) or restarts the game. The game itself keeps running.",
    permission: "control",
    input: obj(),
    undo: "In the game, press Reconnect in the XF Runtime Bridge window (Cyber Engine Tweaks overlay; test builds), or restart the game.",
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
        // While a save loads the engine may not tick for a moment: a step that timed out or found the queue busy is
        // the loading screen, not a failure (0.5.2), so the wait goes on.
        if (!status.ok && !WAIT_THROUGH.has(status.error.code)) throw Object.assign(new Error(status.error.message), { plain: status.error });
        last = status.ok ? String((status.result as { phase?: string }).phase) : "loading";
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
      "Reads V's character-creator state: body and voice, life path and hair-length tags. While the appearance screen (a mirror) is open it also lists every option with its current value; give option to see one option's full list of values. Outside the screen the game's option list isn't live, so only those flags are: the answer adds last_creator_reading, the last full list read on the screen this game session with its age in seconds (not live: a Back after it discarded its changes), when there is one. check asks whether V's finalized look has particular options (group and option names).",
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
    name: "game.options.read",
    title: "Graphics and render settings",
    description:
      "Reads the settings that change how V looks in a screenshot, without changing any: the upscaler and its mode (DLAA among them), frame generation, ray and path tracing, subsurface-scattering quality, HDR and the camera effects (film grain, chromatic aberration, depth of field, lens flares, motion blur, vignette), as a short summary plus every setting of those graphics and display groups. With Cyber Engine Tweaks loaded it also reads the game's hidden character render options (hair, skin, rim light and eyes; for example what a rendering preset mod changed), or names given in names.",
    permission: "read",
    input: obj({
      settings: bool("Read the graphics and display settings. Default true."),
      render_options: bool("Read the hidden character render options through Cyber Engine Tweaks. Default true."),
      groups: {
        type: "array",
        description: "Only these settings groups (default all of them).",
        items: oneOf("A settings group.", ["/graphics/presets", "/graphics/advanced", "/graphics/raytracing", "/graphics/basic", "/graphics/performance", "/video/display"]),
        minItems: 1,
        maxItems: 6,
      },
      names: {
        type: "array",
        description: "Render options to read instead of the default character set, as Category/Name (for example Editor/Characters/Hair/GlobalLight/R).",
        items: str("A render option, Category/Name.", { pattern: "^[A-Za-z0-9_]+(/[A-Za-z0-9_]+)+$", maxLength: 128 }),
        minItems: 1,
        maxItems: 128,
      },
    }),
    local: runOptionsRead,
  },
  {
    name: "photo.state",
    title: "Photo mode state",
    description:
      "Whether photo mode is open or allowed, and (with menu) every photo-mode menu item the game set up: its number, label, range or options and current value. options adds each option list (for example every expression with its menu value, data, and its face table index, table_index, with table_index_by saying whether it was matched by the expression's name or, less surely, by its position; the expression item's face_table says how many of photo mode's expression records were listed and could be read, so an option without table_index is explained).",
    permission: "read",
    input: obj({ menu: bool("Include the menu items."), options: bool("Include every option list (implies menu).") }),
    bridge: { method: "photo.state" },
  },

  // Photo mode (changes vanish when photo mode closes)
  {
    name: "photo.open",
    title: "Open photo mode",
    description:
      "Opens photo mode by pressing the player's own photo mode key in the game window (read from the game's key bindings, N by default): the only key the XF tools ever send, and only to the game window. It checks first that V is in the world and the game allows photo mode, and by default sends only while the game window is already in front: otherwise it refuses (not_foreground) without touching any window, since bringing the game forward catches whatever the player is typing elsewhere. focus: bring_to_front brings it forward first (the old behaviour). Then it waits until photo mode is open. The game has no in-engine way to open the full photo mode that is known to be safe (see the knowledge base), so the key stays the route.",
    permission: "write-photo",
    input: obj({
      route: oneOf("sendinput (default: a key press, the game window must be in front) or postmessage (research: posted to the game window only, never changes focus; whether the game reacts is untested).", ["sendinput", "postmessage"]),
      focus: oneOf("sendinput only: require (default: send only while the game window is already in front, else refuse and touch nothing) or bring_to_front (bring the game window forward first; anything the player is typing elsewhere goes to the game).", ["require", "bring_to_front"]),
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
      .join("; ")}) and/or explicit values: field of view, roll, focus distance, aperture, depth of field, autofocus, film grain, chromatic aberration, the effects page's exposure, contrast, vignette and highlights, photo mode's own camera preset, and V's placement in front of the camera (subject: yaw, left_right, near_far, up_down). Values are checked against the ranges photo mode itself offers. reset puts everything back to how photo mode opened.`,
    permission: "write-photo",
    input: obj({
      preset: oneOf("A named framing; explicit values override it.", Object.keys(CAMERA_PRESETS)),
      camera_preset: int("Photo mode's own camera preset: 0 Customization, 1-9 its presets (in the XF test profile 6 full body, 7 face, 8 eyes, 9 head and shoulders). Applied before the other values.", 0, 9),
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
      exposure: num("Exposure (the effects page, menu 10): photo mode offers -2.2 to 2.2, 0 = unchanged. Lifts a dark scene for a capture.", -10, 10),
      contrast: num("Contrast (the effects page, menu 11), in photo mode's own range (0 = unchanged).", -10, 10),
      vignette: num("Vignette (the effects page, menu 12), in photo mode's own range.", -10, 10),
      highlights: num("Highlights (the effects page, menu 24), in photo mode's own range.", -10, 10),
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
    name: "photo.camera.place",
    title: "Place the photo-mode camera (research)",
    description:
      "Research (0.5.2): moves photo mode's own camera to a place and aims it, instead of moving V in front of it (photo mode's menu only moves V: up_down, near_far and left_right). Target: look_at (a world point), target v (V's eyes) or piece (a showroom head's eyes, for framing the finish showroom). Where: position (a world point), or distance_m from the target (default 1.5) at azimuth_deg (from the way the target faces, counter-clockwise seen from above: 0 in front, 90 its left) and elevation_deg. The camera's entity is moved with the teleportation facility, then the active camera is read a few frames later: held says whether photo mode kept it there (session 6's question; if not, photo mode places its camera itself and nothing is left to undo). Within 30 m of V, in photo mode only.",
    permission: "write-photo",
    input: obj({
      look_at: { type: "array", description: "A world point to aim at, [x, y, z] metres.", items: num("A coordinate.", -100000, 100000), minItems: 3, maxItems: 3 },
      target: oneOf("v: aim at V's eyes.", ["v"]),
      piece: int("Aim at this showroom head's eyes (its lineup index).", 0, 23),
      position: { type: "array", description: "Where the camera goes, [x, y, z] world metres (instead of distance_m).", items: num("A coordinate.", -100000, 100000), minItems: 3, maxItems: 3 },
      distance_m: num("Metres from the target, 0.2 to 10. Default 1.5.", 0.2, 10),
      azimuth_deg: num("Degrees around the target from the way it faces, counter-clockwise seen from above (0 in front). Default 0.", -180, 180),
      elevation_deg: num("Degrees above the target's level (negative: below). Default 0.", -60, 60),
    }),
    undo: "the result's undo puts the camera back where it was, looking the same way; closing photo mode resets the camera anyway.",
    local: runCameraPlace,
  },
  {
    name: "photo.light.set",
    title: "Adjust a photo-mode light",
    description:
      "Selects photo-mode light 1, 2 or 3, switches it on or off, sets its shadow, brightness, range, cone angles and colour (hue 0-360, saturation, luminosity), and can place it (place). Lights start off each time photo mode opens, and photo mode puts a light where the camera is when it switches on. place: {camera: true} switches it off and on so it moves to where the camera is now (after framing); {azimuth, elevation, distance} puts it about V's head and aims it at V (research: the result says whether photo mode kept it there); {world: [x, y, z]} is the undo's form. type (spot or ambient) is skipped with a note where the game's menu has no type row (game 2.31).",
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
        place: {
          description: "Where to put the light: camera (where the camera is now), or about V's head (azimuth, elevation, distance, aimed at V), or a world position (world).",
          ...obj({
            camera: bool("true: switch the light off and on again so photo mode puts it where the camera is now."),
            azimuth: num("Degrees around V's head measured from the way V's photo-mode stand-in faces (not from the camera), counter-clockwise seen from above: 0 in front of V's face, 90 V's left, -90 V's right, 180 straight behind the head (the head then blocks the light from the camera's side). After photo_frame, the camera sits at azimuth yaw_offset (0 when V faces it), so a light at azimuth yaw_offset comes from the camera's side and one at yaw_offset plus or minus 180 from straight behind V. Default 0.", -180, 180),
            elevation: num("Degrees above V's head level. Default 15.", -80, 80),
            distance: num("Metres from V's head. Default 1.2.", 0.2, 10),
            world: { type: "array", description: "A world position [x, y, z] in metres (the undo's form).", items: num("A coordinate.", -100000, 100000), minItems: 3, maxItems: 3 },
          }),
        },
      },
      ["light"],
    ),
    undo: "the result's undo parameters restore that light's previous values (including on/off), its earlier position and the menu's previous light selection.",
    bridge: { method: "photo.light.set", params: lightParams },
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
      "Sets V's facial expression in photo mode exactly as the photo-mode expression list does: by label (the expression's name as the list shows it, for example Static: Sleeping; case and punctuation don't matter) or by faceId, the menu's value for it. The menu's value is the expression's position in the list, which differs from the face table index the face animation uses when an expression pack is installed (session 4: Static: Sleeping was menu value 56, table index 60); photo_state with options lists both for every expression. A value not in the list is refused.",
    permission: "write-photo",
    input: obj({
      faceId: int("The expression's menu value (its data in photo_state options; not the table index).", 0, 100000),
      label: str("The expression's name as the list shows it, instead of faceId.", { minLength: 1, maxLength: 128 }),
    }),
    undo: "the result's undo parameters restore the previous expression.",
    local: runExpressionSet,
  },
  {
    name: "photo.expression.index",
    title: "Apply a photo-mode face index (research)",
    description:
      "Research tool for the expression editor: applies a photo-mode face table index (photo_state options' table_index, not the menu value) to V directly, the way photo mode feeds its face animation, without going through the expression list. It acts on V's photo-mode stand-in, where session 4 found the face rig; target head (the head item) is refused, since it has no face rig and the index changed nothing there. Whether the face changed shows only in a screenshot. By default only a table index of the expression list is accepted, and only one photo_state found by the expression's name (table_index_verified); one known only by list position (table_index_by position, which session 4 showed isn't the table index with an expression pack) is refused (unverified_index) unless force: true. unlisted: true allows any index (sparse-index checks). The answer's index_by says how the index was checked. Photo mode only, in the XF test profile.",
    permission: "write-photo",
    input: obj(
      {
        index: int("The face index to apply.", 0, 100000),
        target: oneOf("puppet (V's photo-mode stand-in, the default and the only one with a face rig). head is refused (no_effect): the head item has no face rig.", ["puppet", "head"]),
        unlisted: bool("Allow an index the photo-mode expression list doesn't offer. Default false."),
        force: bool("Allow an index the list offers only by list position (unverified). Default false."),
      },
      ["index"],
    ),
    undo: "the result's undo selects the expression the photo-mode menu shows again (photo_expression_set); leaving photo mode also resets it.",
    bridge: { method: "photo.expression.index" },
  },
  {
    name: "photo.pose.set",
    title: "Select a photo-mode pose",
    description:
      "Selects V's photo-mode pose through the menu, as the player does: by pose record (record, for example xfs_live_carrier or PhotoModePoses.idle_stand_01), by the labels the menu shows (pose, optionally with category), or by option data from photo_state (category_value with pose_value). Photo mode only.",
    permission: "write-photo",
    input: obj({
      record: str("A pose record: its id (xfs_live_carrier) or full name (PhotoModePoses.xfs_live_carrier).", { pattern: "^[A-Za-z0-9_.]{1,128}$", maxLength: 128 }),
      pose: str("The pose's label as the menu shows it.", { maxLength: 128 }),
      category: str("The category's label as the menu shows it (with pose).", { maxLength: 128 }),
      category_value: int("The category's option data (photo_state), with pose_value.", 0, 1000000),
      pose_value: int("The pose's option data (photo_state), with category_value.", 0, 1000000),
    }),
    undo: "the result's undo selects the earlier category and pose again; leaving photo mode also resets the pose.",
    bridge: { method: "photo.pose.set" },
  },
  {
    name: "pose.live.read",
    title: "Check the live-pose carrier in memory (research)",
    description:
      "Research tool for live posing: finds a loaded animation clip in the game's memory (by default the XF live carrier from the test package, while photo mode shows it) and checks that its keys are laid out as the bridge expects: counts, key runs, joint indices and the carrier contract (one constant rotation key per joint). If anything differs it stops and lists every mismatch; otherwise it returns the decoded keys and a hash to compare with the Studio's offline decode (expect_hash). Changes nothing.",
    permission: "read",
    input: obj({
      set: str("The animation set's depot path (default: the XF carrier's).", { pattern: "^[A-Za-z0-9_.\\\\/-]{7,216}$", maxLength: 216 }),
      clip: str("The clip's name (default: xfs_live_carrier).", { pattern: "^[A-Za-z0-9_.-]{1,128}$", maxLength: 128 }),
      expect_hash: str("The carrier build's keys_hash (16 hex digits), to compare.", { pattern: "^[0-9a-f]{16}$", maxLength: 16 }),
    }),
    bridge: { method: "pose.live.read" },
  },
  {
    name: "pose.live.apply",
    title: "Pose V live through the carrier (research)",
    description:
      "Research tool for live posing: writes joint rotations (unit quaternions [x, y, z, w], by joint name or index) and optionally the Hips translation into the XF live carrier clip in the game's memory, so the photo-mode pose changes without a reload if the engine reads those keys every frame (the experiment's question). Only in the XF test profile's -writes build (allow_live_pose), in photo mode with the carrier selected (photo_pose_set record xfs_live_carrier), and only after the same layout checks as pose_live_read. restore: true puts the carrier's own keys back.",
    permission: "write-photo",
    input: obj({
      joints: {
        type: "array",
        description: "The joints to set, each a joint name (or index) and a rotation.",
        items: {
          description: "One joint: its name (or index) and its rotation.",
          ...obj(
          {
            joint: str("The joint's name in the rig (for example RightForeArm), or its index.", { pattern: "^[A-Za-z0-9_]{1,64}$", maxLength: 64 }),
            rotation: {
              type: "array",
              description: "A unit quaternion [x, y, z, w] in the joint's local space.",
              items: num("A component.", -1.01, 1.01),
              minItems: 4,
              maxItems: 4,
            },
          },
          ["joint", "rotation"],
          ),
        },
        minItems: 1,
        maxItems: 128,
      },
      hips: { type: "array", description: "The Hips joint's translation [x, y, z] in metres.", items: num("A coordinate, in metres.", -3, 3), minItems: 3, maxItems: 3 },
      restore: bool("Put the carrier's own keys back instead."),
    }),
    undo: "pose_live_apply with restore: true (the result's undo); the kill switch also puts the carrier's keys back, and leaving photo mode unloads the carrier.",
    bridge: { method: "pose.live.apply", params: livePoseParams },
  },
  {
    name: "face.rig.read",
    title: "Read V's photo-mode face setup",
    description:
      "Reads how V's face is animated in photo mode, for the expression editor: finds the named parts (components) of V's photo-mode head item (target: head, the default) or stand-in (puppet) and reports, for each, its kind, the facial setup, animation graph and rig it uses and its animation sets with priorities, as resource path hashes the Studio can label. Photo mode only; changes nothing.",
    permission: "read",
    input: obj({
      target: oneOf("Whose parts to read: head (V's photo-mode head item, default) or puppet (the stand-in).", ["head", "puppet"]),
      components: {
        type: "array",
        description: "Part names to look for (default: face_rig, man_face_base_animations, PhotomodeAnimations).",
        items: str("A part name (letters, digits and _).", { pattern: "^[A-Za-z0-9_]{1,64}$", maxLength: 64 }),
        minItems: 1,
        maxItems: 16,
      },
    }),
    bridge: { method: "face.rig.read" },
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
      .join("; ")}) at the centre of the window (or at position) and sets the field of view so span_m metres fill the window height. Each frame starts from its lens's known pose (face and eyes: a portrait lens from about 2 m, so repeated frames never drift) and stays within the lens's limits, or is refused. Any refusal or failure part-way puts back everything it changed whose earlier value the game reported (the field of view, V's placement, and the camera preset, roll and look-at it set), names anything it couldn't, and carries the undo in its detail. It measures where V is through the game's camera (or, if that isn't available, from window captures, more roughly) and corrects in a few steps; converged also needs V to face the requested direction within 3 degrees (residual.facing_deg). The result records the lens, the camera's distance, the chosen values and an undo.`,
    permission: "write-photo",
    input: obj({
      target: oneOf("What to frame. Default face.", Object.keys(FRAMINGS)),
      span_m: num("World height in metres that fills the window height (default: 0.2 eyes, 0.36 face, 0.8 head-and-shoulders, 2 full-body).", 0.02, 5),
      offset: {
        description: "The target point relative to V's head joint, in metres (overrides the framing's own).",
        ...obj({ up: num("Metres up.", -2, 2), forward: num("Metres forward (V's facing).", -2, 2), right: num("Metres to V's right.", -2, 2) }),
      },
      position: {
        description: "Where the target should sit, as fractions of the window (default the centre).",
        ...obj({ x: num("0 left edge, 1 right edge.", 0, 1), y: num("0 top edge, 1 bottom edge.", 0, 1) }),
      },
      xf_preset: bool("First select the framing's XF camera preset (6 full body, 7 face, 8 eyes, 9 head and shoulders; needs the test profile's preset file), then fine-tune."),
      camera_preset: int("First select this photo-mode camera preset (0-9), then fine-tune.", 0, 9),
      keep_roll: bool("Keep the camera preset's own roll. Default false: the camera is levelled (roll 0) after selecting a preset."),
      face_camera: bool("Turn V to face the camera first. Default true."),
      yaw_offset: num("Degrees V turns away from facing the camera (counter-clockwise seen from above), for light sweeps and profile checks: 90 shows V's right side, 180 the back of V's head. Photo Mode Ex keeps V's rotation within -180 to 180.", -180, 180),
      lens: oneOf(
        `Where the frame starts and the limits it keeps: ${Object.entries(LENSES)
          .map(([name, lens]) => `${name}: ${lens.description}`)
          .join("; ")}. Default: portrait for face and eyes, keep for the others and after a camera preset. A frame that would need to leave its lens's limits is refused (framing_bound) with the camera put back.`,
        Object.keys(LENSES),
      ),
      look_at: oneOf("V's look-at before framing: keep (default), off (V's head follows the body, for light sweeps) or camera.", ["keep", "off", "camera"]),
      method: oneOf("auto (default: the game's camera, else window captures), project (the game's camera only) or capture (window captures only).", ["auto", "project", "capture"]),
      max_steps: int("Most correction steps (default 6).", 1, 12),
      tolerance: num("Allowed centring error as a fraction of the window height (default 0.01).", 0.001, 0.2),
    }),
    undo: "the result's undo puts the field of view, V's rotation and placement (and look-at, roll and camera preset) back as they were.",
    local: runFrame,
  },

  // Character
  {
    name: "cc.open",
    title: "Open the appearance screen",
    description:
      "Opens the appearance screen (the mirror's character creator) from normal play, the way a mirror does, and waits until it is open. mode mirror (the default) allows the rows a mirror allows (hair, make-up, eye colour, piercings and the XF rows); ripperdoc also allows the face-shape, skin and cyberware rows. edit_mode new_game opens it in the new-game edit mode instead, as Character Customization Anywhere's F12 did in session 4: every row can change, the world isn't frozen, and Confirm still keeps the look; which edit mode avoids the stuck, half-open creator is a session 5 question. If the wait runs out, the request is withdrawn and the pause menu may open instead (Esc closes it). Refused in combat, a scene, a vehicle or a menu, when the player isn't V (a Johnny section), and until the game has registered the bridge's own save lock (it locks saving itself, until a save is loaded). If the wait runs out after the game took the request, the answer says the screen may still open (check game_status). Only in the XF test profile.",
    permission: "write-character",
    input: obj({
      mode: oneOf("Which rows can be changed: mirror (default) or ripperdoc (adds the eye shape, nose, skin and cyberware rows).", ["mirror", "ripperdoc"]),
      edit_mode: oneOf(
        "The creator's edit mode: edit_tag (default: the mode's own tag, HairDresser or Ripperdoc, which freezes the world while the screen is open) or new_game (the NewGame tag Character Customization Anywhere's F12 ran with in session 4: every row editable, no freeze; not with mode ripperdoc).",
        ["edit_tag", "new_game"],
      ),
      timeout_ms: int("How long to wait for the screen, in milliseconds (default 5000).", 500, 15000),
    }),
    undo: "cc.back (or Back in the appearance screen) discards every change made there and closes it.",
    bridge: { method: "cc.open", timeoutMs: (input) => ((input.timeout_ms as number | undefined) ?? 5000) + 6000 },
  },
  {
    name: "cc.apply",
    title: "Change one appearance option",
    description:
      "While the appearance screen is open (at a mirror or ripperdoc), sets one character-creator option to a value, exactly as clicking it does. option is the option's internal name, its on-screen label (for example XF) or its slot (for example piercings_color or makeupLips_color, the colour row of whichever style is chosen: a colour row named by its own name, such as makeupLips_08, belongs to one style and is refused unless that style is chosen). Give index (counting from 0), value (a value's internal name or on-screen label, where 5 and 05 are the same position; a word such as gold also finds the one value whose name contains it) or label (the name the creator shows, matched loosely: case, spaces and punctuation don't matter, and every word given must appear, so Grace Bob V4 finds Grace - Side Swept Bob - V4); the answer gives the index chosen. It never confirms: the player keeps the look by confirming, or backs out to discard every change. Refused anywhere else.",
    permission: "write-character",
    input: obj(
      {
        option: str("The option's internal name, on-screen label or slot.", { maxLength: 128 }),
        index: int("The value, counting from 0.", 0, 100000),
        value: str("The value's internal name or on-screen label, instead of index.", { maxLength: 128 }),
        label: str("The value's name as the creator shows it, matched loosely (see above), instead of index.", { minLength: 1, maxLength: 128 }),
        expect_option: str("With index: the option row read before (player_appearance's option name); refused (stale_match) if option now resolves to another row. label does this itself.", { minLength: 1, maxLength: 128 }),
        expect_value: str("With index: the value's internal name read before at that index; refused (stale_match) if it has another name now. label does this itself.", { minLength: 1, maxLength: 256 }),
      },
      ["option"],
    ),
    undo: "cc.apply with the previous index (in the result's undo), or Back in the appearance screen, which discards every change made there.",
    local: runCharacterApply,
  },
  {
    name: "cc.page",
    title: "Point the appearance screen's camera",
    description:
      "Moves the open appearance screen's camera to one part of V, as hovering over a row does: skin, hair, eyes, teeth, nose, lips, jaw, head, nails, body, or default (where the screen started). Changing an option through cc_apply already moves it to that option's part; this is for looking without changing anything.",
    permission: "write-character",
    input: obj(
      { page: oneOf("The part of V to look at.", ["skin", "hair", "eyes", "teeth", "nose", "lips", "jaw", "head", "nails", "body", "default"]) },
      ["page"],
    ),
    undo: "cc.page with page default (the camera's earlier part can't be read).",
    bridge: { method: "cc.page" },
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
    name: "inventory.equip",
    title: "Equip a clothing item on V",
    description:
      "Equips a clothing item on V by its item record (for example Items.Helmet_01_basic_01), as the inventory screen does, and waits until the slot shows it. With add_if_missing, an item V doesn't have is added to V's inventory first (and remembered, so inventory_unequip can remove it again). Clothing slots only (Head, Face, OuterChest, InnerChest, Legs, Feet, Outfit); only in normal play, not in combat or a scene. When an active wardrobe outfit (or a hidden area) decides what the slot shows, the item is equipped but doesn't draw: the answer says so (hidden_by_outfit, outfit) and wardrobe_equip is the next step. Needs the inventory permission, which the bridge's settings keep off until the maintainer allows it.",
    permission: "write-inventory",
    input: obj(
      {
        item: str("The item record, for example Items.Helmet_01_basic_01.", { pattern: "^[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)+$", maxLength: 128 }),
        slot: oneOf("The clothing slot, checked against the item's own (optional).", ["Head", "Face", "OuterChest", "InnerChest", "Legs", "Feet", "Outfit"]),
        add_if_missing: bool("Add the item to V's inventory if V doesn't have it. Default false."),
      },
      ["item"],
    ),
    undo: "the result's undo equips the earlier item again, or empties the slot (removing an item the bridge added); loading a save also undoes it.",
    bridge: { method: "inventory.equip", timeoutMs: () => 15000 },
  },
  {
    name: "wardrobe.state",
    title: "Read V's wardrobe outfit",
    description:
      "The wardrobe outfit V wears (set 1-7, or 0 for none) and, for each clothing area (Head, Face, OuterChest, InnerChest, Legs, Feet), what it shows: outfit (the outfit's item), hidden (nothing: the outfit leaves the area empty, or headgear is hidden), equipped or empty; plus what is equipped there and the wardrobe's stored outfits. An active outfit overrides what the equipment slots show, which is why an equipped helmet can stay invisible.",
    permission: "read",
    input: obj({}),
    bridge: { method: "wardrobe.state" },
  },
  {
    name: "wardrobe.equip",
    title: "Change V's wardrobe outfit",
    description:
      "Changes what V's clothing shows through the wardrobe, as the wardrobe screen does (the equipment system's own requests; stored outfits are never edited or saved): set applies outfit 1-7; clear takes the outfit off, so V shows what is equipped; item shows that clothing item in its area of the active outfit (the item must be in V's inventory or the wardrobe); area with show equipped makes that area show what is equipped there, and show hidden hides it; restore (the undo) puts back exactly the outfit and each area a snapshot recorded. Waits until the wardrobe shows the change. Only in normal play, not in combat or a scene. Needs the inventory permission; the kill switch puts back the wardrobe as it was before the bridge's first change.",
    permission: "write-inventory",
    input: obj({
      set: int("Apply this wardrobe outfit (1-7; wardrobe_state lists the stored ones).", 1, 7),
      clear: bool("true: take the active outfit off."),
      item: str("Show this clothing item record in its area of the active outfit, for example Items.Helmet_01_basic_01.", { pattern: "^[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)+$", maxLength: 128 }),
      area: oneOf("The clothing area for show.", ["Head", "Face", "OuterChest", "InnerChest", "Legs", "Feet"]),
      show: oneOf("With area: equipped (the area shows what is equipped there) or hidden (nothing).", ["equipped", "hidden"]),
      restore: {
        description: "A wardrobe_equip answer's undo: the outfit (0 none) and what each area showed.",
        ...obj(
          {
            set: int("The outfit that was active, 0 for none.", 0, 7),
            slots: {
              type: "array",
              description: "What each area showed.",
              items: {
                description: "One area as the snapshot had it.",
                ...obj(
                {
                  area: oneOf("The clothing area.", ["Head", "Face", "OuterChest", "InnerChest", "Legs", "Feet"]),
                  item: str("The outfit's item in the area (empty: none).", { maxLength: 128 }),
                  hidden: bool("Whether the area was hidden."),
                },
                ["area"],
                ),
              },
              maxItems: 6,
            },
          },
          ["set"],
        ),
      },
    }),
    undo: "the result's undo (wardrobe_equip with restore) puts the outfit and every area back exactly; the kill switch restores the wardrobe as it was before the bridge's first change.",
    bridge: { method: "wardrobe.equip", timeoutMs: () => 15000 },
  },
  {
    name: "inventory.unequip",
    title: "Take off a clothing item",
    description:
      "Takes off what V wears in one clothing slot (slot), or the given item (item), and waits until the slot is empty. remove_added also takes the item out of V's inventory, but only an item the bridge itself added this session. Needs the inventory permission.",
    permission: "write-inventory",
    input: obj({
      slot: oneOf("The clothing slot to empty.", ["Head", "Face", "OuterChest", "InnerChest", "Legs", "Feet", "Outfit"]),
      item: str("The item record to take off (instead of slot).", { pattern: "^[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)+$", maxLength: 128 }),
      remove_added: bool("Also remove the item from V's inventory if the bridge added it (with item). Default false."),
    }),
    undo: "the result's undo equips the earlier item again.",
    bridge: { method: "inventory.unequip", timeoutMs: () => 15000 },
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

  // Saves
  {
    name: "game.save",
    title: "Make a manual save",
    description:
      "Makes one new manual save, as the save menu's empty slot does, and waits for the game to confirm it (the game names it ManualSave-<n>; name is only a label for the logs). Never overwrites or deletes a save. Only from normal play. While the bridge's own changes are live it keeps saving locked, and this is refused unless override_lock is true: the save then keeps those changes, and the lock goes back on afterwards. Needs the save permission.",
    permission: "write-save",
    input: obj({
      name: str("A label for the logs (letters, digits, spaces, '.', '_', '-').", { pattern: "^[A-Za-z0-9 ._-]{1,64}$", maxLength: 64 }),
      override_lock: bool("Save even though the bridge's changes are live (they are kept in the save). Default false."),
      timeout_ms: int("How long to wait for the game to confirm the save, in milliseconds (default 20000).", 2000, 60000),
    }),
    undo: "None: a save can't be unsaved. Delete it in the game's Load menu if it isn't wanted.",
    bridge: { method: "game.save", timeoutMs: (input) => saveClientTimeoutMs((input.timeout_ms as number | undefined) ?? 20000) },
  },
  {
    name: "game.load",
    title: "Load a save",
    description:
      "Loads the most recent save of this playthrough (latest: true, the game's quick load) or one save by its name in the game's list (for example ManualSave-12); an unknown name is refused with some of the names the game lists. Everything since that save is discarded, unsaved progress and the bridge's save lock with it, and the game doesn't ask first, so discard_unsaved: true is required. From normal play or the pause menu, not photo mode or the appearance screen. Wait with game_wait for phase gameplay afterwards. Needs the save permission.",
    permission: "write-save",
    input: obj(
      {
        latest: bool("true: load the most recent save of this playthrough."),
        name: str("A save's name as the game lists it (for example ManualSave-12).", { pattern: "^[A-Za-z0-9 ._-]{1,64}$", maxLength: 64 }),
        discard_unsaved: bool("Must be true: everything since that save, unsaved progress included, is discarded."),
      },
      ["discard_unsaved"],
    ),
    undo: "None: loading discards everything since that save.",
    bridge: { method: "game.load", params: loadParams, timeoutMs: () => loadClientTimeoutMs() },
  },

  // The player's view
  {
    name: "ui.message",
    title: "Show a message in the game",
    description:
      "Shows a short message to the player under the bridge's status label in the top-left corner of the game (drawn by the bridge's Cyber Engine Tweaks layer, so the player never has to leave the game): one line of up to 200 characters, for seconds seconds (default 8). At most four show at once; a new one pushes out the oldest. level colours it: info, ask (something for the player to do), warn or done. clear: true removes them all. The kill switch clears them too.",
    permission: "notify",
    input: obj({
      text: str("The message: one short line (at most 200 characters are shown).", { minLength: 1, maxLength: 500 }),
      seconds: int("How long it shows, 1 to 600 seconds. Default 8.", 1, 600),
      level: oneOf("info (default), ask, warn or done.", ["info", "ask", "warn", "done"]),
      clear: bool("Remove every message first (alone: only that)."),
    }),
    undo: "ui.message with clear: true; messages also fade by themselves.",
    bridge: { method: "ui.message" },
  },

  // World
  {
    name: "world.time.set",
    title: "Set the time of day",
    description:
      "Sets the in-game clock (hours, minutes, seconds) while V is in the world or the appearance screen is open (to compare the screen's light at different times of day without leaving it), or restores an exact earlier time with total_seconds. In photo mode it sets photo mode's own time of day instead (the Environment tab's slider, hours and minutes only; a photo-mode setting, so the photo write class must be allowed too). Whether the world's clock is as before once photo mode closes is not established yet (game_status's world_time_seconds shows it). target photo or world names the clock: a photo-mode undo carries target photo, so replayed after photo mode closes it changes nothing rather than the world's clock. Changing the world clock can trigger timed events in quests, so use a disposable save.",
    permission: "write-world",
    input: obj({
      hours: int("Hour, 0 to 23.", 0, 23),
      minutes: int("Minute, 0 to 59.", 0, 59),
      seconds: int("Second, 0 to 59.", 0, 59),
      total_seconds: int("An exact earlier time from a previous result's undo (the world's clock only).", 0, 2147483647),
      target: oneOf("Which clock: world (refused in photo mode) or photo (photo mode's own time of day; outside photo mode nothing changes). Default: photo in photo mode, else world.", ["world", "photo"]),
    }),
    undo: "the result's undo: the world's clock with total_seconds (target world), or photo mode's time of day in hours and minutes (target photo), which changes nothing once photo mode has closed.",
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

  // XF Finish Showroom (bridge 0.5; the showroom write class, test profile only)
  {
    name: "showroom.spawn",
    title: "Set out the finish showroom",
    description:
      "Spawns XF Finish Showroom's mannequin heads, one per makeup preset of a showroom build (its folder or manifest.json from tools/build_showroom_package.ts), each on a black pedestal: in an arc about the camera (default; every head faces it) or a row across the view, spacing_m apart, each head's eyes distance_m from the camera (in photo mode) or V's eyes, as photo_frame's distance_m measures to V, and at height_m above V's ground (default: the camera's height with the camera as anchor, so the heads look straight into it; a head's natural height with V as anchor). Needs Codeware in the game and the showroom's archive staged. Nothing is saved: showroom.clear, the kill switch or loading a save removes them.",
    permission: "write-showroom",
    input: obj({
      manifest: str("The showroom build's folder, or its manifest.json.", { maxLength: 1024 }),
      manifests: { type: "array", description: "Several showroom builds' folders or manifests, to set out their presets together.", items: str("A showroom build's folder or manifest.json.", { maxLength: 1024 }), minItems: 1, maxItems: 4 },
      presets: { type: "array", description: "Which presets, by name, preset ID or appearance, in lineup order. Default: all of them (at most 24).", items: str("A preset's name, ID or appearance.", { maxLength: 120 }), minItems: 1, maxItems: 24 },
      layout: oneOf("arc (default): on a circle about the camera or V, each head facing it. row: a straight line across the view, all facing back along it.", ["arc", "row"]),
      spacing_m: num("Distance between neighbouring heads, 0.3 to 5 m. Default 0.7.", 0.3, 5),
      distance_m: num("How far each head's eyes are from the camera (or V's eyes), 0.8 to 10 m, in 3D. Default 2.5.", 0.8, 10),
      height_m: num("The heads' eye height above V's ground, 0.5 to 3.2 m. Default: the camera's height (anchor camera), else a head's natural 1.69 m. The pedestals reach 1.5 m below a head's natural place, so a head raised more than that ends in the air.", 0.5, 3.2),
      lateral_m: num("Shift the whole lineup to the right as the camera or V sees it (negative: left), -5 to 5 m. With distance_m equal to photo_frame's distance_m (the camera to V's face), a head at lateral 0.6 stands beside her on the same arc and appears at her scale. Default 0.", -5, 5),
      anchor: oneOf("camera (default in photo mode) or v (default in normal play).", ["camera", "v"]),
      replace: bool("Remove the heads set out earlier first (default true)."),
    }),
    undo: "showroom.clear with what: pieces (or all); loading a save also removes them.",
    local: runShowroomSpawn,
  },
  {
    name: "showroom.light",
    title: "Light the finish showroom",
    description:
      "Spawns a light rig built from the game's own character-creator rig (native lumens, falloff, cones and shadows): rig creator (all 15 lights), creator_face (the 13 that reach the head, no shadows) or key (the key light alone). target each (default) gives every head its own rig in its own frame, so each gets the same light; piece lights one head; v lights V the same way, for the fidelity check. Rigs of neighbouring heads also light each other: the answer estimates by how much and warns above 5 %. Rigs stay put when heads turn, so a turn sweeps the highlights.",
    permission: "write-showroom",
    input: obj(
      {
        manifest: str("The showroom build's folder, or its manifest.json (its rig entity is used).", { maxLength: 1024 }),
        rig: oneOf("creator (default), creator_face or key.", ["creator", "creator_face", "key"]),
        target: oneOf("each (default): a rig per head; piece: the head given by piece; v: V herself.", ["each", "piece", "v"]),
        piece: int("The head's index in the lineup (0 is the first), with target piece.", 0, 23),
        replace: bool("Remove the rigs placed earlier first (default true)."),
      },
      ["manifest"],
    ),
    undo: "showroom.clear with what: lights.",
    local: runShowroomLight,
  },
  {
    name: "showroom.rotate",
    title: "Turn the showroom heads",
    description:
      "Turns showroom heads on their pedestals: yaw_deg relative to how they were set out (0 faces the camera or V as at spawn, positive turns them to their left), delta_deg from where they are now, or a turntable sweep from from_deg to to_deg in steps (default -60 to 60 in 7 steps), waiting settle_ms at each and, with capture, taking a screenshot of region (default the whole window) at each step. Light rigs don't turn, so the highlights sweep across each face. After a sweep the heads go back where they were unless return is false.",
    permission: "write-showroom",
    input: obj({
      pieces: { type: "array", description: "Which heads by lineup index (default all).", items: int("A head's index (0 is the first).", 0, 23), minItems: 1, maxItems: 24 },
      yaw_deg: num("Yaw relative to how the heads were set out, -180 to 180.", -180, 180),
      delta_deg: num("Turn by this much from where they are now, -180 to 180.", -180, 180),
      sweep: {
        ...obj({
          from_deg: num("First angle, relative to how the heads were set out. Default -60.", -180, 180),
          to_deg: num("Last angle. Default 60.", -180, 180),
          steps: int("How many angles, 1 to 36, evenly spaced. Default 7.", 1, 36),
          settle_ms: int("Wait at each angle before the screenshot, 0 to 5000 ms. Default 400.", 0, 5000),
          capture: bool("Take a screenshot at each angle (default false)."),
          region: oneOf("The area each screenshot keeps (as capture_screenshot). Default: the whole window.", Object.keys(NAMED_REGIONS)),
          name: str("Short label for the screenshots' files.", { pattern: "^[A-Za-z0-9._-]{1,60}$", maxLength: 60 }),
          return: bool("Turn the heads back where they were afterwards (default true)."),
        }),
        description: "A turntable sweep instead of one turn.",
      },
    }),
    undo: "showroom.rotate with yaw_deg 0 faces them as set out; a result's undo turns them back exactly.",
    local: runShowroomRotate,
  },
  {
    name: "showroom.clear",
    title: "Clear the finish showroom",
    description: "Removes the showroom's heads (what: pieces), its light rigs (lights) or both (all, the default). The kill switch and loading a save do the same.",
    permission: "write-showroom",
    input: obj({ what: oneOf("all (default), pieces or lights.", ["all", "pieces", "lights"]) }),
    undo: "showroom.spawn and showroom.light set them out again.",
    bridge: { method: "showroom.clear" },
  },
  {
    name: "showroom.state",
    title: "Read the finish showroom",
    description: "Lists the showroom heads and light rigs the bridge spawned: their preset, place, yaw and whether they are in the world yet, and whether Codeware is loaded.",
    permission: "read",
    input: obj({}),
    bridge: { method: "showroom.state" },
  },
];

export function findCommand(name: string): CommandDef | undefined {
  return CATALOGUE.find((command) => command.name === name || toolName(command) === name);
}

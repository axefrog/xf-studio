// The showroom's catalogue commands that run in the tools (showroom.spawn, showroom.rotate, showroom.light): each reads the
// showroom build's manifest and the bridge's anchor or state, plans with plan.ts, then sends the bridge's own showroom
// methods (showroom.place, showroom.turn, showroom.lights), which check and spawn. Captures for a turntable sweep are taken
// here, from outside the game, like capture.screenshot.

import { captureWindow, CaptureError, type CaptureRecord } from "../capture/capture.ts";
import type { CommandContext, CommandResult } from "../api/catalogue.ts";
import {
  choosePieces, eyesOf, facingOf, PEDESTAL_BELOW_M, planError, planLayout, planOnRay, readShowroom, spill, spacingFor, toWorld, yawFacing,
  type Anchor, type Placement, type RigPlacement, type RigProfile, type Showroom, type Vec3,
} from "./plan.ts";
import { calibrate, modelFromFov, poseOf, project, type Calibration, type CameraModel, type CameraPose } from "../scene/camera.ts";
import { frameOf } from "../scene/report.ts";

type Json = Record<string, any>;

async function call(context: CommandContext, method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<Json> {
  const response = await context.api.callBridge(method, params, context.cid, timeoutMs);
  if (!response.ok) throw Object.assign(new Error(response.error.message), { plain: response.error });
  return response.result as Json;
}

const CODEWARE_MISSING = "The showroom spawns its heads and lights through Codeware, which the game hasn't loaded. Install Codeware 1.20 or newer from its official release page (the bridge never installs it), then restart the game.";

async function anchorOf(context: CommandContext, wanted: string | undefined): Promise<{ anchor: Anchor; from: string; raw: Json }> {
  const raw = await call(context, "showroom.anchor", {});
  if (raw.codeware !== true) throw planError("codeware_missing", CODEWARE_MISSING);
  const v = raw.v as { position: Vec3; forward: Vec3 } | undefined;
  if (!v) throw planError("unavailable", "The bridge couldn't find V in the world; load a save and try again.");
  const camera = raw.camera as { position: Vec3; forward: Vec3 } | undefined;
  const from = wanted ?? (raw.phase === "photo_mode" && camera ? "camera" : "v");
  if (from === "camera" && !camera) throw planError("unavailable", "The camera's place isn't known right now; use anchor v.");
  const source = from === "camera" ? camera! : v;
  return { anchor: { origin: source.position, forward: source.forward, ground: v.position[2] }, from, raw };
}

const manifestsOf = (input: Json): Showroom[] => {
  const paths = [...(input.manifest ? [input.manifest as string] : []), ...((input.manifests as string[] | undefined) ?? [])];
  if (!paths.length) throw planError("bad_input", "Give manifest: the showroom build's folder or its manifest.json (from tools/build_showroom_package.ts).");
  return paths.map(readShowroom);
};

/**
 * showroom.spawn: the chosen presets' heads in a row or an arc in front of V or the camera. Distances run from the camera
 * (or V's eyes) to each head's eyes. With the camera as anchor and no height_m (0.6), the middle head's eyes go exactly on
 * the camera's view ray through the window's centre at distance_m, the rest at the same distance and elevation angle
 * (planOnRay), and every head's eyes are projected back into the frame to check it: by the game's own projection
 * (scene.read) where the bridge has it, else by the camera model. height_m (eyes above V's ground) keeps the 0.5.2 layout;
 * with V as anchor the heads stand at their natural height.
 */
export async function runShowroomSpawn(input: Json, context: CommandContext): Promise<CommandResult> {
  const showrooms = manifestsOf(input);
  const pieces = choosePieces(showrooms, input.presets as string[] | undefined);
  const { anchor, from, raw } = await anchorOf(context, input.anchor as string | undefined);
  const layout = (input.layout as "row" | "arc" | undefined) ?? "arc";
  const spacing = (input.spacing_m as number | undefined) ?? 0.7, distance = (input.distance_m as number | undefined) ?? 2.5;
  const lateral = (input.lateral_m as number | undefined) ?? 0;
  const eyes = eyesOf(showrooms[0]!.headJoint);
  const pose = poseOf(raw.camera);
  const onRay = from === "camera" && input.height_m === undefined && pose !== null;
  let placements: Placement[];
  let heightFrom: string;
  let height: number;
  if (onRay) {
    placements = planOnRay(pose!, pieces.length, layout, spacing, distance, lateral, eyes);
    const mid = placements[Math.floor((placements.length - 1) / 2)]!;
    height = Math.round((mid.eyes![2] - anchor.ground) * 1000) / 1000;
    heightFrom = "camera_ray";
  } else {
    const cameraZ = (raw.camera as { position: Vec3 } | undefined)?.position[2];
    const defaultHeight = from === "camera" && cameraZ !== undefined ? cameraZ - anchor.ground : eyes[2];
    height = Math.round(((input.height_m as number | undefined) ?? defaultHeight) * 1000) / 1000;
    const anchorEye = from === "camera" ? anchor.origin[2] : anchor.ground + eyes[2];
    placements = planLayout(anchor, pieces.length, layout, spacing, distance, lateral, { eyes, height, anchorEye });
    heightFrom = input.height_m !== undefined ? "given" : from === "camera" ? "camera" : "natural";
  }
  const raise = Math.round((height - eyes[2]) * 1000) / 1000;
  const notes: string[] = [];
  if (raise > PEDESTAL_BELOW_M) notes.push(`The heads stand ${raise} m above their natural height; the pedestals reach only ${PEDESTAL_BELOW_M} m down, so they end in the air.`);
  if (raise < -0.3) notes.push(`The heads stand ${-raise} m below their natural height, so their pedestals and necks may be under the floor.`);
  const items = placements.map((p, i) => ({ index: p.index, template: pieces[i]!.template, appearance: pieces[i]!.appearance, label: pieces[i]!.name,
    x: p.position[0], y: p.position[1], z: p.position[2], yaw: p.yaw }));
  const placed = await call(context, "showroom.place", { items, replace: input.replace !== false }, 30000);
  const projected = pose ? await projectEyes(context, pose, placements.map((p) => p.eyes!)) : null;
  if (projected?.some((p) => !p.in_frame)) notes.push(`Head ${projected.filter((p) => !p.in_frame).map((p) => p.index).join(", ")} is outside the frame (projected eyes); fewer heads, a smaller spacing_m or a larger distance_m brings it in.`);
  return { value: { anchor: from, layout, spacing_m: spacing, distance_m: distance, lateral_m: lateral, height_m: height,
    height_from: heightFrom, raised_m: raise,
    measured_to: "each head's eyes, from the camera (or V's eyes)",
    pieces: items.map((item, i) => ({ index: item.index, label: item.label, appearance: item.appearance, position: [item.x, item.y, item.z], eyes: placements[i]!.eyes, yaw: item.yaw,
      ...(projected ? { eyes_on_screen: projected[i] } : {}) })),
    ...(projected ? { projection: { by: projected[0]?.by, units: "window heights from the window's centre, x right, y down; in frame while |y| <= 0.5 and |x| <= aspect/2" } } : {}),
    ...(notes.length ? { notes } : {}),
    ...placed } };
}

/**
 * Where each head's eyes land in the frame: the game's own projection (scene.read with points, 0.6) when the bridge
 * answers it, else the camera model from the anchor's pose.
 */
async function projectEyes(context: CommandContext, pose: CameraPose, points: Vec3[]) {
  let model: CameraModel = modelFromFov(pose);
  let game: { x: number; y: number }[] | null = null;
  try {
    const read = await call(context, "scene.read", { points, parts: ["camera"] });
    const camera = poseOf(read.camera) ?? pose;
    model = calibrate(camera, read.calibration as Calibration | undefined);
    const shown = (read.points as { screen: unknown }[] | undefined) ?? [];
    if (shown.length === points.length && read.calibration) {
      const toFrame = frameOf(read.calibration as Calibration, camera.aspect);
      game = shown.map((p) => toFrame(p.screen as never));
    }
  } catch {
    // An older bridge (no scene.read) or a refusal: the model alone.
  }
  return points.map((point, index) => {
    const m = project(model, point);
    const g = game?.[index];
    const at = g ?? { x: m.x, y: m.y };
    return { index, x: Math.round(at.x * 1e4) / 1e4, y: Math.round(at.y * 1e4) / 1e4, in_frame: !m.behind && Math.abs(at.y) <= 0.5 && Math.abs(at.x) <= model.aspect / 2,
      by: g ? "game" : model.by === "game" ? "model (calibrated by the game)" : "model (field of view read as vertical)" };
  });
}

type StatePiece = { index: number; label: string; appearance: string; position: Vec3; yaw: number; base_yaw: number; spawned: boolean };

/** showroom.light: a creator-style rig on each head, one head, or V. */
export async function runShowroomLight(input: Json, context: CommandContext): Promise<CommandResult> {
  if (input.rig === "none") {
    // 0.6 (session 6's friction): the rigs off, the heads kept, so the player lights them with photo mode's own lights.
    const cleared = await call(context, "showroom.clear", { what: "lights" });
    return { value: { rig: "none", ...cleared, undo: null, undo_note: "showroom_light with a rig lights the heads again" } };
  }
  const showrooms = manifestsOf(input);
  const showroom = showrooms[0]!;
  const profile = ((input.rig as RigProfile | undefined) ?? "creator") as RigProfile;
  const rig = showroom.rigs[profile];
  const target = (input.target as string | undefined) ?? (input.piece !== undefined ? "piece" : "each");
  const state = await call(context, "showroom.state", {});
  if (state.codeware !== true) throw planError("codeware_missing", CODEWARE_MISSING);
  const heads = (state.pieces as StatePiece[]) ?? [];
  let rigs: RigPlacement[];
  if (target === "v") {
    const { raw } = await anchorOf(context, "v");
    const v = raw.v as { position: Vec3; forward: Vec3 };
    rigs = [{ index: -1, position: v.position, yaw: Math.round(yawFacing(v.forward) * 1e4) / 1e4 }];
  } else {
    if (!heads.length) throw planError("no_showroom", "The showroom has no heads to light; run showroom.spawn first.");
    const chosen = target === "piece" ? heads.filter((h) => h.index === input.piece) : heads;
    if (!chosen.length) throw planError("no_such_piece", `The showroom has no piece ${String(input.piece)}.`);
    // The rig stays where the head was set down, facing the way it was spawned, so turning the head sweeps the highlights.
    rigs = chosen.map((h) => ({ index: h.index, position: h.position, yaw: h.base_yaw }));
  }
  const spills = rigs.length > 1 ? spill(rig.lights, rigs, showroom.headJoint) : [];
  const worst = spills.length ? Math.max(...spills.map((s) => s.share)) : 0;
  const items = rigs.map((r) => ({ index: r.index, template: showroom.rigEntity, appearance: rig.appearance, label: `${profile} rig`,
    x: r.position[0], y: r.position[1], z: r.position[2], yaw: r.yaw }));
  const placed = await call(context, "showroom.lights", { items, replace: input.replace !== false }, 30000);
  const advice = worst >= 0.05
    ? `Each head also gets about ${Math.round(worst * 100)} % of its own rig's light from its neighbours' rigs. For identical light, use rig key, light fewer heads, or spawn them at least ${spacingFor(rig.lights, showroom.headJoint, rigs.length)} m apart.`
    : undefined;
  return { value: { rig: profile, target, lights_per_rig: rig.lights.length, rigs: items.map((i) => ({ for: i.index, position: [i.x, i.y, i.z], yaw: i.yaw })),
    ...(spills.length ? { spill: spills, spill_worst: worst } : {}), ...(advice ? { warning: advice } : {}), ...placed } };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** showroom.rotate: turn heads to a yaw relative to how they were set down, by a delta, or through a sweep with captures. */
export async function runShowroomRotate(input: Json, context: CommandContext): Promise<CommandResult> {
  const state = await call(context, "showroom.state", {});
  const heads = ((state.pieces as StatePiece[]) ?? []).filter((h) => !input.pieces || (input.pieces as number[]).includes(h.index));
  if (!heads.length) throw planError("no_showroom", "The showroom has no such heads; run showroom.spawn first.");
  const turnTo = async (yawOf: (h: StatePiece) => number) =>
    call(context, "showroom.turn", { turns: heads.map((h) => ({ index: h.index, yaw: normalise(yawOf(h)) })) });
  const sweep = input.sweep as Json | undefined;
  if (!sweep) {
    if ((input.yaw_deg === undefined) === (input.delta_deg === undefined)) throw planError("bad_input", "Give yaw_deg, delta_deg or sweep.");
    const turned = input.yaw_deg !== undefined ? await turnTo((h) => h.base_yaw + (input.yaw_deg as number)) : await turnTo((h) => h.yaw + (input.delta_deg as number));
    return { value: turned };
  }
  const from = (sweep.from_deg as number | undefined) ?? -60, to = (sweep.to_deg as number | undefined) ?? 60, steps = (sweep.steps as number | undefined) ?? 7;
  const settle = (sweep.settle_ms as number | undefined) ?? 400;
  const startYaws = new Map(heads.map((h) => [h.index, h.yaw]));
  const frames: Json[] = [], images: NonNullable<CommandResult["images"]> = [];
  try {
    for (let i = 0; i < steps; i++) {
      const angle = steps === 1 ? from : from + ((to - from) * i) / (steps - 1);
      await turnTo((h) => h.base_yaw + angle);
      await sleep(settle);
      const frame: Json = { step: i + 1, angle_deg: Math.round(angle * 100) / 100 };
      if (sweep.capture === true) {
        try {
          const record: CaptureRecord = captureWindow({ target: context.api.captureTarget(), region: sweep.region ? { name: sweep.region } as never : undefined,
            name: `${(sweep.name as string | undefined) ?? "showroom-sweep"}-${String(i + 1).padStart(2, "0")}`, outDir: context.captureRoot, route: "auto" });
          frame.capture = { full: record.full?.path ?? null, view: record.view.path };
          images.push({ path: record.view.path, width: record.view.width, height: record.view.height, mimeType: "image/png", role: "view" });
        } catch (error) {
          if (error instanceof CaptureError) throw planError(`capture_${error.code}`, error.message);
          throw error;
        }
      }
      frames.push(frame);
    }
  } finally {
    if (sweep.return !== false) await call(context, "showroom.turn", { turns: [...startYaws].map(([index, yaw]) => ({ index, yaw: normalise(yaw) })) }).catch(() => undefined);
  }
  return { value: { swept: heads.map((h) => h.index), from_deg: from, to_deg: to, steps, frames, returned: sweep.return !== false,
    undo: { method: "showroom.turn", params: { turns: [...startYaws].map(([index, yaw]) => ({ index, yaw: normalise(yaw) })) } } }, images };
}

/** Wraps a yaw into −180…180. */
export const normalise = (yaw: number) => Math.round(((((yaw + 180) % 360) + 360) % 360 - 180) * 1e4) / 1e4;
export { facingOf, toWorld };

// The showroom's catalogue commands that run in the tools (showroom.spawn, showroom.rotate, showroom.light): each reads the
// showroom build's manifest and the bridge's anchor or state, plans with plan.ts, then sends the bridge's own showroom
// methods (showroom.place, showroom.turn, showroom.lights), which check and spawn. Captures for a turntable sweep are taken
// here, from outside the game, like capture.screenshot.

import { captureWindow, CaptureError, type CaptureRecord } from "../capture/capture.ts";
import type { CommandContext, CommandResult } from "../api/catalogue.ts";
import {
  choosePieces, chooseStagedShowroom, eyesOf, facingOf, PEDESTAL_BELOW_M, planError, planLayout, planOnRay, readShowroom, resolveStaged, showroomBuilds, spill, spacingFor, toWorld, yawFacing,
  type Anchor, type Placement, type RigPlacement, type RigProfile, type Showroom, type StagedArchive, type Vec3,
} from "./plan.ts";
import { modelForRead, modelFromFov, poseOf, project, type Calibration, type CameraModel, type CameraPose } from "../scene/camera.ts";
import { frameOf } from "../scene/report.ts";
import { withOverlayCleared } from "../api/catalogue060.ts";

type Json = Record<string, any>;

async function call(context: CommandContext, method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<Json> {
  const response = await context.api.callBridge(method, params, context.cid, timeoutMs, context.signal);
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

/** 0.8.2 (the review): which archives the game loaded, asked of showroom.anchor 16 at a time (its limit) and combined. */
export async function loadedArchives(context: CommandContext, archives: readonly string[]): Promise<Record<string, boolean>> {
  const loaded: Record<string, boolean> = {};
  for (let i = 0; i < archives.length; i += 16) {
    const raw = await call(context, "showroom.anchor", { archives: archives.slice(i, i + 16) });
    Object.assign(loaded, (raw.archives as Record<string, boolean> | undefined) ?? {});
  }
  return loaded;
}

/**
 * 0.8.3: the staged showroom archives as the game itself sees them (the bridge's showroom.staged: its archive/pc/mod, which is
 * MO2's virtual folder when MO2 launched the game), or null from a bridge that doesn't know the method (before 0.8.3).
 */
export async function stagedArchives(context: CommandContext): Promise<StagedArchive[] | null> {
  const response = await context.api.callBridge("showroom.staged", {}, context.cid, undefined, context.signal);
  if (!response.ok) {
    if (response.error.code === "unknown_method") return null;
    throw Object.assign(new Error(response.error.message), { plain: response.error });
  }
  return ((response.result as Json).archives as StagedArchive[] | undefined) ?? [];
}

/**
 * The showroom builds to use: the manifests given, or the staged builds found by themselves. 0.8.3 (session 10's G1: the
 * staged mods were found by no one, because the tools looked only in their own checkout's dist): the game says which
 * showroom archives it has (showroom.staged), and each is resolved to its manifest, the one a self-describing build ships
 * inside the mod, else this machine's build with the same bytes (plan.ts resolveStaged, which also looks in the primary
 * checkout's dist). Every resolved build is used, so a preset is found in whichever holds it. An older bridge falls back to
 * 0.8.2's route (the newest local build whose archive the game loaded). found says which, for the answer.
 */
async function manifestsOf(input: Json, context: CommandContext): Promise<{ showrooms: Showroom[]; found?: Json }> {
  const paths = [...(input.manifest ? [input.manifest as string] : []), ...((input.manifests as string[] | undefined) ?? [])];
  if (paths.length) return { showrooms: paths.map(readShowroom) };
  const staged = await stagedArchives(context);
  if (staged) {
    if (!staged.length) {
      throw planError(
        "showroom_not_staged",
        "The game has no XF Finish Showroom archive in its archive/pc/mod folder. Stage one (in MO2, enable an XF Finish Showroom mod in this profile) and restart the game, or give manifest.",
      );
    }
    const { resolved, unresolved } = resolveStaged(staged, showroomBuilds());
    if (!resolved.length) {
      throw planError(
        "showroom_manifest_missing",
        `The game has ${staged.map((s) => s.archive).join(", ")} staged, but no manifest for ${staged.length > 1 ? "them" : "it"}: ${unresolved.map((u) => `${u.archive}: ${u.why}`).join("; ")}. Rebuild XF Finish Showroom (projects/xf-studio/authoring/tools/build_showroom_package.ts, which ships its manifest inside the mod since 0.8.3) and restage it, or give manifest.`,
      );
    }
    return {
      showrooms: resolved.map((r) => r.showroom),
      found: {
        how: "the showroom archives the game itself sees in archive/pc/mod (showroom.staged), each with its manifest",
        builds: resolved.map((r) => ({ archive: r.archive, manifest: r.by === "shipped_manifest" ? "shipped in the staged mod" : r.manifest, by: r.by })),
        ...(unresolved.length ? { unresolved } : {}),
      },
    };
  }
  const builds = showroomBuilds();
  const loaded = await loadedArchives(context, [...new Set(builds.map((b) => b.archive))]);
  const chosen = chooseStagedShowroom(builds, loaded);
  return {
    showrooms: [readShowroom(chosen.manifest)],
    found: { manifest: chosen.manifest, archive: chosen.archive, how: "the newest build on this machine whose archive the game loaded", ...(chosen.also_staged.length ? { also_staged: chosen.also_staged } : {}) },
  };
}

/**
 * showroom.spawn: the chosen presets' heads in a row or an arc in front of V or the camera. Distances run from the camera
 * (or V's eyes) to each head's eyes. With the camera as anchor and no height_m (0.6), the middle head's eyes go exactly on
 * the camera's view ray through the window's centre at distance_m, the rest at the same distance and elevation angle
 * (planOnRay), and every head's eyes are projected back into the frame to check it: by the game's own projection
 * (scene.read) where the bridge has it, else by the camera model. height_m (eyes above V's ground) keeps the 0.5.2 layout;
 * with V as anchor the heads stand at their natural height.
 */
export async function runShowroomSpawn(input: Json, context: CommandContext): Promise<CommandResult> {
  const { showrooms, found } = await manifestsOf(input, context);
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
  // 0.7 (session 7: a head spawned half inside a wall and a bench): each head's eyes are probed for free space (level rays
  // CLEARANCE_M long) and a clear sight line from the anchor; a blocked head steps back towards the anchor, then sideways,
  // until a place is clear, and the answer says where it moved and why.
  const space: SpaceReport[] = [];
  const adjusted = input.avoid_walls === false ? [] : await findFreeSpace(context, placements, from === "camera" ? anchor.origin : [anchor.origin[0], anchor.origin[1], anchor.ground + eyes[2]], anchor.forward, space);
  const raise = Math.round((height - eyes[2]) * 1000) / 1000;
  const notes: string[] = [];
  if (raise > PEDESTAL_BELOW_M) notes.push(`The heads stand ${raise} m above their natural height; the pedestals reach only ${PEDESTAL_BELOW_M} m down, so they end in the air.`);
  if (raise < -0.3) notes.push(`The heads stand ${-raise} m below their natural height, so their pedestals and necks may be under the floor.`);
  const items = placements.map((p, i) => ({ index: p.index, template: pieces[i]!.template, appearance: pieces[i]!.appearance, label: pieces[i]!.name,
    x: p.position[0], y: p.position[1], z: p.position[2], yaw: p.yaw }));
  const placed = await call(context, "showroom.place", { items, replace: input.replace !== false }, 30000);
  const projected = pose ? await projectEyes(context, pose, placements.map((p) => p.eyes!)) : null;
  for (const a of adjusted) notes.push(a.note);
  if (projected?.some((p) => !p.in_frame)) notes.push(`Head ${projected.filter((p) => !p.in_frame).map((p) => p.index).join(", ")} is outside the frame (projected eyes); fewer heads, a smaller spacing_m or a larger distance_m brings it in.`);
  return { value: { ...(found ? { showroom_found: found } : {}), anchor: from, layout, spacing_m: spacing, distance_m: distance, lateral_m: lateral, height_m: height,
    height_from: heightFrom, raised_m: raise,
    measured_to: "each head's eyes, from the camera (or V's eyes)",
    pieces: items.map((item, i) => ({ index: item.index, label: item.label, appearance: item.appearance, position: [item.x, item.y, item.z], eyes: placements[i]!.eyes, yaw: item.yaw,
      ...(projected ? { eyes_on_screen: projected[i] } : {}) })),
    ...(projected ? { projection: { by: projected[0]?.by, units: "window heights from the window's centre, x right, y down; in frame while |y| <= 0.5 and |x| <= aspect/2" } } : {}),
    ...(adjusted.length ? { moved_for_space: adjusted.map(({ note: _n, ...rest }) => rest) } : {}),
    // 0.8 (session 8's G6: moved_for_space was absent, read as null, when the head stood clear): whether the free space was
    // checked at all, and for each head its clearance and whether it moved.
    space_check: input.avoid_walls === false
      ? { checked: false, why: "avoid_walls: false" }
      : space.length
        ? { checked: true, radius_m: CLEARANCE_M, heads: space }
        : { checked: false, why: "this bridge has no world.probe (an older build)" },
    ...(notes.length ? { notes } : {}),
    ...placed } };
}

/** How far each head's eyes need to be from static geometry, and the steps a blocked head tries (0.7). */
export const CLEARANCE_M = 0.3;
const STEPS: { back: number; side: number }[] = [
  { back: 0.3, side: 0 }, { back: 0.6, side: 0 }, { back: 0, side: 0.5 }, { back: 0, side: -0.5 }, { back: 0.3, side: 0.5 }, { back: 0.3, side: -0.5 }, { back: 0, side: 1 }, { back: 0, side: -1 },
];

type Adjustment = { index: number; from: Vec3; to: Vec3 | null; why: string; note: string; checked?: false };
/**
 * 0.8: one head's free-space check: clear where it stands, moved (and how far), or not placed clear; clearance_m is the
 * nearest static geometry around its eyes within the check's radius (the radius itself when nothing was hit).
 */
export type SpaceReport = { index: number; checked: boolean; clear: boolean; clearance_m: number | null; sight_blocked: boolean | null; moved_m: number; why?: string };

/**
 * Probes each placement's eyes (world.probe: level rays and a sight line from the anchor) and moves a blocked one to the
 * first clear step, in place (position and eyes together). Without world.probe (an older bridge: `unknown_method`) nothing
 * is checked. Any other failed probe (RB-117: a timeout, a rate limit, the game gate) is reported for that head as not
 * checked, and the other heads are still probed.
 */
export async function findFreeSpace(context: CommandContext, placements: Placement[], anchorEye: Vec3, forward: Vec3, report: SpaceReport[] = []): Promise<Adjustment[]> {
  const out: Adjustment[] = [];
  const probe = async (point: Vec3) => {
    const response = await context.api.callBridge("world.probe", { points: [point], clearance_m: CLEARANCE_M, sight_from: anchorEye }, context.cid, undefined, context.signal);
    if (!response.ok) return { failed: response.error.code, message: response.error.message } as const;
    const r = ((response.result as Json).probes as Json[])[0] ?? {};
    const blockedSides = Number(r.clearance?.blocked ?? 0);
    const sight = r.sight?.blocked === true;
    const nearest = typeof r.clearance?.nearest_m === "number" ? Math.round(r.clearance.nearest_m * 1000) / 1000 : null;
    return { clear: blockedSides === 0 && !sight, nearest, sight, why: sight ? "static geometry between the anchor and the head" : blockedSides ? `static geometry within ${CLEARANCE_M} m of the head's eyes (${blockedSides} of 8 directions)` : "" };
  };
  const h = Math.hypot(forward[0], forward[1]) || 1;
  const f: Vec3 = [forward[0] / h, forward[1] / h, 0];
  const right: Vec3 = [f[1], -f[0], 0];
  for (const p of placements) {
    if (!p.eyes) continue;
    const first = await probe(p.eyes);
    if ("failed" in first) {
      if (first.failed === "unknown_method") {
        report.length = 0;
        return out; // no world.probe: an older bridge
      }
      out.push({ index: p.index, from: [...p.position] as Vec3, to: null, why: `not checked (${first.failed})`, checked: false,
        note: `Head ${p.index}'s free space wasn't checked: the probe failed (${first.failed}: ${first.message}); it stands where it was placed.` });
      report.push({ index: p.index, checked: false, clear: false, clearance_m: null, sight_blocked: null, moved_m: 0, why: `the probe failed (${first.failed})` });
      continue;
    }
    if (first.clear) {
      report.push({ index: p.index, checked: true, clear: true, clearance_m: first.nearest, sight_blocked: false, moved_m: 0 });
      continue;
    }
    const from = [...p.position] as Vec3;
    let moved: Vec3 | null = null;
    let clearance: number | null = null;
    for (const step of STEPS) {
      const d: Vec3 = [-f[0] * step.back + right[0] * step.side, -f[1] * step.back + right[1] * step.side, 0];
      const eyes: Vec3 = [p.eyes[0] + d[0], p.eyes[1] + d[1], p.eyes[2]];
      const check = await probe(eyes);
      if (!("failed" in check) && check.clear) {
        p.position = [p.position[0] + d[0], p.position[1] + d[1], p.position[2]].map((v) => Math.round(v * 1000) / 1000) as Vec3;
        p.eyes = eyes.map((v) => Math.round(v * 1000) / 1000) as Vec3;
        moved = p.position;
        clearance = check.nearest;
        break;
      }
    }
    const movedM = moved ? Math.round(Math.hypot(moved[0] - from[0], moved[1] - from[1]) * 100) / 100 : 0;
    report.push({ index: p.index, checked: true, clear: moved !== null, clearance_m: moved ? clearance : first.nearest, sight_blocked: moved ? false : first.sight, moved_m: movedM, why: first.why });
    out.push({
      index: p.index,
      from,
      to: moved,
      why: first.why,
      note: moved
        ? `Head ${p.index} was moved ${Math.round(Math.hypot(moved[0] - from[0], moved[1] - from[1]) * 100) / 100} m for free space (${first.why}).`
        : `Head ${p.index} has ${first.why} and no clear place was found within 1 m; choose another spot or a smaller distance_m.`,
    });
  }
  return out;
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
    // 0.8 (session 8's G3: (-5.2, -48.5) for a centred head under photo mode's drone camera): in photo mode the model
    // from the photo camera's own pose and field of view (the game's projection follows the gameplay camera there);
    // elsewhere the game's projection when it passes the consistency checks.
    model = modelForRead(camera, read.calibration as Calibration | undefined, read.camera?.mode ?? read.phase);
    const shown = (read.points as { screen: unknown }[] | undefined) ?? [];
    if (shown.length === points.length && read.calibration && model.game_projection === "consistent") {
      const toFrame = frameOf(read.calibration as Calibration, camera.aspect);
      game = shown.map((p) => toFrame(p.screen as never));
    }
  } catch {
    // An older bridge (no scene.read) or a refusal: the model alone.
  }
  return points.map((point, index) => {
    const m = project(model, point);
    let g = game?.[index];
    // 0.8 (session 8's G6 read (-2.5, -77) in normal play): a game projection far from the camera model's isn't trusted.
    if (g && (!Number.isFinite(g.x) || !Number.isFinite(g.y) || Math.hypot(g.x - m.x, g.y - m.y) > 0.25)) g = undefined;
    const at = g ?? { x: m.x, y: m.y };
    return { index, x: Math.round(at.x * 1e4) / 1e4, y: Math.round(at.y * 1e4) / 1e4, in_frame: !m.behind && Math.abs(at.y) <= 0.5 && Math.abs(at.x) <= model.aspect / 2,
      by: g ? "game"
        : model.game_projection === "not_used" ? "model (photo mode's camera: its pose and field of view)"
        : model.by === "game" ? "model (calibrated by the game)"
        : model.game_projection === "inconsistent" ? "model (field of view read as vertical; the game's projection disagreed with its camera)"
        : "model (field of view read as vertical)" };
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
  const { showrooms, found } = await manifestsOf(input, context);
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
  return { value: { ...(found ? { showroom_found: found } : {}), rig: profile, target, lights_per_rig: rig.lights.length, rigs: items.map((i) => ({ for: i.index, position: [i.x, i.y, i.z], yaw: i.yaw })),
    ...(spills.length ? { spill: spills, spill_worst: worst } : {}), ...(advice ? { warning: advice } : {}), ...placed } };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });

/** A sweep stops at its next step once an emergency control (or Ctrl+C) cancels it (RB-121); its return still runs. */
function stopIfCancelled(context: CommandContext) {
  if (context.signal?.aborted) throw planError("interrupted", "The sweep was stopped before its next step.");
}

/** 0.8: the sweep's capture step (a test replaces it to see that the overlay is out of every frame). */
export const SWEEP_CAPTURE = { capture: captureWindow };

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
  const undo = { method: "showroom.turn", params: { turns: [...startYaws].map(([index, yaw]) => ({ index, yaw: normalise(yaw) })) } };
  let failure: unknown = null;
  // 0.8.4 (session 11's G2: photo mode's own menu stayed in every sweep frame): in photo mode the menu and cursor are hidden
  // for the sweep's captures, as photo_hud_hide does, and put back as they were afterwards. Outside photo mode the game
  // refuses (not_in_photo_mode) and there is no menu to hide.
  // The review of 0.8.4: the menu and the cursor are put back independently, each from its own earlier state (the
  // answer's was_hidden and was_cursor_hidden): one photo.hud.hide call moves the menu and, with cursor, the cursor too.
  let hudBefore: { menu: boolean; cursor: boolean } | null = null;
  try {
    if (sweep.capture === true) {
      const hidden = await context.api.callBridge("photo.hud.hide", { hidden: true, cursor: true }, context.cid, undefined, context.signal);
      if (hidden.ok) {
        const result = (hidden.result as Json | null) ?? {};
        hudBefore = { menu: result.was_hidden === true, cursor: result.was_cursor_hidden === true };
        await sleep(500, context.signal);
      } else if (hidden.error.code !== "not_in_photo_mode") {
        throw Object.assign(new Error(hidden.error.message), { plain: hidden.error });
      }
    }
    for (let i = 0; i < steps; i++) {
      stopIfCancelled(context);
      const angle = steps === 1 ? from : from + ((to - from) * i) / (steps - 1);
      await turnTo((h) => h.base_yaw + angle);
      await sleep(settle, context.signal);
      stopIfCancelled(context);
      const frame: Json = { step: i + 1, angle_deg: Math.round(angle * 100) / 100 };
      if (sweep.capture === true) {
        try {
          // 0.8 (session 8's G4: the sweep's frames showed the XF overlay): the same hide as capture_screenshot's.
          const shot = await withOverlayCleared(context, () => (stopIfCancelled(context), SWEEP_CAPTURE.capture({ target: context.api.captureTarget(), region: sweep.region ? { name: sweep.region } as never : undefined,
            name: `${(sweep.name as string | undefined) ?? "showroom-sweep"}-${String(i + 1).padStart(2, "0")}`, outDir: context.captureRoot, route: "auto" })));
          const record: CaptureRecord = shot.value;
          frame.capture = { full: record.full?.path ?? null, view: record.view.path };
          frame.overlay = shot.overlay;
          images.push({ path: record.view.path, width: record.view.width, height: record.view.height, mimeType: "image/png", role: "view" });
        } catch (error) {
          if (error instanceof CaptureError) throw planError(`capture_${error.code}`, error.message);
          throw error;
        }
      }
      frames.push(frame);
    }
  } catch (error) {
    failure = error;
  }
  // The menu and cursor back as they were (cleanup: no signal); a failure here is said, not thrown.
  let hudError: string | null = null;
  if (hudBefore) {
    // First both to the cursor's earlier state, then (when it differed) the menu alone to its own.
    const restore: Record<string, unknown>[] = [{ hidden: hudBefore.cursor, cursor: true }];
    if (hudBefore.menu !== hudBefore.cursor) restore.push({ hidden: hudBefore.menu, cursor: false });
    for (const params of restore) {
      const shown = await context.api.callBridge("photo.hud.hide", params, context.cid).catch((error: unknown) => ({ ok: false as const, error: { code: "failed", message: (error as Error).message } }));
      if (!shown.ok) {
        hudError = `Photo mode's menu or cursor wasn't put back (${shown.error.code}: ${shown.error.message}); photo_hud_hide {hidden: ${hudBefore.menu}} puts the menu back.`;
        break;
      }
    }
  }
  // Turning the heads back is reported, never swallowed (RB-128): a refused return leaves them turned, so the answer (or
  // the sweep's own error) says so and keeps the exact undo.
  let returnError: { code: string; message: string } | null = null;
  if (sweep.return !== false) {
    try {
      // Cleanup: sent even after a cancellation (no signal); a handover or the kill switch then refuses it, and that is said.
      const back = await context.api.callBridge("showroom.turn", undo.params, context.cid);
      if (!back.ok) throw Object.assign(new Error(back.error.message), { plain: back.error });
    } catch (error) {
      const plain = (error as { plain?: { code: string; message: string } }).plain;
      returnError = { code: plain?.code ?? "failed", message: plain?.message ?? (error as Error).message };
    }
  }
  const notReturned = returnError
    ? `The heads weren't turned back (${returnError.code}: ${returnError.message}); they stay at the sweep's last angle until showroom_turn runs the undo: ${JSON.stringify(undo)}.`
    : null;
  if (failure) {
    const plain = (failure as { plain?: { code: string; message: string; detail?: string } }).plain;
    if (notReturned) {
      if (plain) plain.detail = [plain.detail, notReturned].filter(Boolean).join(" ");
      else if (failure instanceof Error) failure.message = `${failure.message} ${notReturned}`;
    }
    throw failure;
  }
  return { value: { swept: heads.map((h) => h.index), from_deg: from, to_deg: to, steps, frames, returned: sweep.return !== false && !returnError,
    photo_menu_hidden_for_sweep: hudBefore !== null, ...(hudError ? { photo_menu_warning: hudError } : {}),
    ...(returnError ? { return_failed: returnError, warning: notReturned } : {}), undo }, images };
}

/** Wraps a yaw into −180…180. */
export const normalise = (yaw: number) => Math.round(((((yaw + 180) % 360) + 360) % 360 - 180) * 1e4) / 1e4;
export { facingOf, toWorld };

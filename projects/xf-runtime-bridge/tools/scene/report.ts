// scene.report (bridge 0.6): the agent's own view of the game, from one scene.read plus, in photo mode, photo.state, and
// optionally a capture for frame statistics. Everything is filterable, machine-readable and computed here from the
// bridge's raw reading, so it is testable offline:
//   the camera (pose, field of view, exposure, mode) and the exact projection built from the game's own calibration points;
//   each subject (V, NPCs, showroom heads): screen bounds, the fraction in frame, margins to each edge, a static-geometry ray
//     to the face, distance, which way it faces (0 = the camera), and expression and pose where known;
//   each light (photo mode's three, XF Finish Showroom's rig lights): on, place, whether it reaches the focus subject's face
//     and an estimated share of the light there;
//   frame statistics of a subject's region from a capture: mean luminance, clipped highlights, crushed shadows;
//   the world and UI state (time, rain, menus, HUD, interaction choices).
// Pre-capture expectations (capture.screenshot's expect) are judged from the same report.

import { screenSpace, type ScreenPoint, type SubjectReading } from "../api/framing.ts";
import type { CommandContext } from "../api/catalogue.ts";
import type { Pixels } from "../capture/win32.ts";
import { lightAt, readShowroom, toLocal, type RigLight, type Showroom } from "../showroom/plan.ts";
import { add, boundsOf, calibrate, framing, poseOf, project, scale, sub, type Bounds, type Calibration, type CameraModel, type Vec3 } from "./camera.ts";

type Json = Record<string, any>;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const DEG = Math.PI / 180;

/** The frame-unit conversion for the game's ProjectPoint answers, from the calibration points. */
export function frameOf(calibration: Calibration, aspect: number): (p: ScreenPoint) => { x: number; y: number } {
  const reading = { camera: { aspect }, screen: { center: calibration.center, target: calibration.center, up: calibration.up, right: calibration.right } } as unknown as SubjectReading;
  return screenSpace(reading).toFrame;
}

export type BoundsKind = "face" | "head" | "body";
/** Box corners around a subject, in the world: its face, its head, or its whole body standing. */
export function subjectBox(position: Vec3, head: Vec3, forward: Vec3, kind: BoundsKind): Vec3[] {
  const fl = Math.hypot(forward[0], forward[1]) || 1;
  const f: Vec3 = [forward[0] / fl, forward[1] / fl, 0], right: Vec3 = [f[1], -f[0], 0], up: Vec3 = [0, 0, 1];
  let centre: Vec3, half: [number, number, number];
  if (kind === "face") {
    centre = add(add(head, scale(f, 0.08)), [0, 0, 0.045]);
    half = [0.085, 0.05, 0.13];
  } else if (kind === "head") {
    centre = add(add(head, scale(f, 0.03)), [0, 0, 0.07]);
    half = [0.11, 0.12, 0.16];
  } else {
    const top = head[2] + 0.2;
    centre = [position[0], position[1], (position[2] + top) / 2];
    half = [0.3, 0.2, (top - position[2]) / 2];
  }
  const out: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push(add(add(add(centre, scale(right, sx * half[0])), scale(f, sy * half[1])), scale(up, sz * half[2])));
  return out;
}

/** 0 when the subject faces the camera, 180 when it turns its back; horizontal only. */
export function facingCamera(position: Vec3, forward: Vec3, camera: Vec3): number {
  const to: Vec3 = [camera[0] - position[0], camera[1] - position[1], 0];
  const a = Math.atan2(forward[1], forward[0]), b = Math.atan2(to[1], to[0]);
  let d = Math.abs(a - b) / DEG;
  if (d > 180) d = 360 - d;
  return Math.round(d * 10) / 10;
}

export type Subject = {
  kind: "v" | "npc" | "piece";
  id: string;
  label?: string;
  distance_m: number | null;
  facing_camera_deg: number;
  bounds: Bounds | null;
  in_frame: number;
  margins: { left: number; right: number; top: number; bottom: number } | null;
  centre: { x: number; y: number } | null;
  size: { width: number; height: number } | null;
  occluded: boolean | null;
  occlusion?: Json;
  face: Vec3;
  expression?: Json;
  pose?: Json;
};

/** A showroom head as a subject: it faces its yaw; its head joint sits 9 cm behind and 5.1 cm below its eyes (plan.ts eyesOf). */
export function pieceSubject(piece: Json): Json {
  const yaw = Number(piece.yaw ?? 0) * DEG;
  const forward: Vec3 = [-Math.sin(yaw), Math.cos(yaw), 0];
  const eyes = (piece.eyes ?? add(piece.position as Vec3, [0, 0, 1.691])) as Vec3;
  const head = sub(sub(eyes, scale(forward, 0.09)), [0, 0, 0.0513]);
  return { ...piece, forward, head, face: eyes };
}

function subjectOf(model: CameraModel, kind: Subject["kind"], id: string, raw: Json, bounds: BoundsKind, label?: string): Subject {
  const position = raw.position as Vec3, head = (raw.head ?? add(raw.position, [0, 0, 1.62])) as Vec3, forward = (raw.forward ?? [0, 1, 0]) as Vec3;
  // A showroom head has no body: "body" bounds measure its head.
  const box = subjectBox(position, head, forward, kind === "piece" && bounds === "body" ? "head" : bounds);
  const b = boundsOf(model, box);
  const f = b ? framing(b, model.aspect) : null;
  const face = (raw.face ?? raw.eyes ?? head) as Vec3;
  const occlusion = raw.occlusion as Json | undefined;
  return {
    kind,
    id,
    ...(label ? { label } : {}),
    distance_m: r4(Math.hypot(face[0] - model.position[0], face[1] - model.position[1], face[2] - model.position[2])),
    facing_camera_deg: facingCamera(position, forward, model.position),
    bounds: b,
    in_frame: f ? f.fraction_in_frame : 0,
    margins: f ? f.margins : null,
    centre: f ? f.centre : null,
    size: f ? f.size : null,
    occluded: occlusion && occlusion.checked ? Boolean(occlusion.blocked) : null,
    ...(occlusion ? { occlusion } : {}),
    face,
  };
}

/** Rig lights of a placed rig, in the world: position and axis. */
function rigLightsInWorld(rig: { position: Vec3; yaw: number }, lights: readonly RigLight[]) {
  const c = Math.cos(rig.yaw * DEG), s = Math.sin(rig.yaw * DEG);
  const turn = (v: Vec3): Vec3 => [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
  return lights.map((l) => ({ light: l, position: add(rig.position, turn(l.position)), axis: turn(l.axis) }));
}

export type LightReport = {
  kind: "photo" | "rig";
  id: string;
  on: boolean | null;
  position: Vec3 | null;
  reaches_face: boolean | "unknown";
  blocked: boolean | null;
  strength: number | null;
  share: number | null;
  note?: string;
};

/**
 * The lights at the focus subject's face. Showroom rig lights use the engine's decoded light forms (lightAt, the manifest's
 * values); photo mode's lights have unknown units, so their strength is a relative inverse-square estimate with a soft cone
 * and they are shared among themselves only (shares within each kind sum to 1).
 */
export function lightsAt(face: Vec3, raw: Json, showroom: Showroom | null, photoMenu: Json | null): LightReport[] {
  const out: LightReport[] = [];
  const photo = (raw.lights?.photo as Json[] | undefined) ?? [];
  const selected = typeof photoMenu?.selected === "number" ? photoMenu.selected : null;
  for (const light of photo) {
    if (!light.found) {
      out.push({ kind: "photo", id: `photo:${light.light}`, on: false, position: null, reaches_face: false, blocked: null, strength: 0, share: null, note: String(light.why ?? "") });
      continue;
    }
    const position = light.position as Vec3, forward = (light.forward ?? [0, 1, 0]) as Vec3;
    const d = sub(face, position), dist = Math.hypot(...d) || 1;
    const cos = (d[0] * forward[0] + d[1] * forward[1] + d[2] * forward[2]) / dist;
    const blocked = light.to_face?.checked ? Boolean(light.to_face.blocked) : null;
    const cone = Math.max(0.1, Math.min(1, (cos + 0.2) / 1.2));
    const strength = blocked ? 0 : cone / (dist * dist);
    const menuOn = selected === light.light && typeof photoMenu?.on === "number" ? photoMenu.on > 0.5 : null;
    out.push({ kind: "photo", id: `photo:${light.light}`, on: menuOn ?? true, position, reaches_face: blocked === true ? false : dist < 12 ? true : "unknown", blocked, strength: r4(strength), share: null,
      note: "photo-mode light: units unknown, strength is relative (1/d² with a soft cone)" });
  }
  const rigs = (raw.showroom?.rigs as Json[] | undefined) ?? [];
  if (showroom) {
    for (const rig of rigs) {
      const profile = Object.values(showroom.rigs).find((p) => p.appearance === rig.appearance) ?? showroom.rigs.creator;
      for (const placed of rigLightsInWorld({ position: rig.position as Vec3, yaw: Number(rig.yaw ?? 0) }, profile.lights)) {
        const local = toLocal(rig.position as Vec3, Number(rig.yaw ?? 0), face);
        const strength = lightAt(placed.light, local);
        out.push({ kind: "rig", id: `rig:${rig.index}:${placed.light.name}`, on: true, position: placed.position.map(r4) as Vec3, reaches_face: strength > 0, blocked: null, strength: r4(strength), share: null });
      }
    }
  } else if (rigs.length) {
    out.push({ kind: "rig", id: "rigs", on: true, position: null, reaches_face: "unknown", blocked: null, strength: null, share: null, note: "give manifest to judge the showroom's rig lights" });
  }
  for (const kind of ["photo", "rig"] as const) {
    const mine = out.filter((l) => l.kind === kind && typeof l.strength === "number");
    const total = mine.reduce((s, l) => s + (l.strength ?? 0), 0);
    for (const l of mine) l.share = total > 0 ? r4((l.strength ?? 0) / total) : 0;
  }
  return out;
}

export type FrameStats = { region_px: { x: number; y: number; width: number; height: number }; pixels: number; mean_luminance: number; clipped_highlights: number; crushed_shadows: number };
/**
 * Statistics of a region of a capture (frame units: window heights from the centre): mean luminance (Rec. 709 weights on
 * the 8-bit values, 0-1), the share of pixels with any channel at 250 or more (clipped highlights) and with luminance at
 * 5/255 or less (crushed shadows).
 */
export function frameStats(pixels: Pixels, bounds: { left: number; right: number; top: number; bottom: number }): FrameStats | null {
  const H = pixels.height, W = pixels.width;
  return statsInRect(pixels, W / 2 + bounds.left * H, W / 2 + bounds.right * H, H / 2 + bounds.top * H, H / 2 + bounds.bottom * H);
}

/**
 * The same statistics inside a saved capture: its picture is the crop of a window of the given size, so the subject's
 * bounds (window heights from the window's centre) are mapped into the crop first.
 */
export function frameStatsInCapture(pixels: Pixels, crop: { x: number; y: number; width: number; height: number }, window: { width: number; height: number },
  bounds: { left: number; right: number; top: number; bottom: number }): FrameStats | null {
  const W = window.width, H = window.height;
  const sx = pixels.width / crop.width, sy = pixels.height / crop.height;
  return statsInRect(pixels, (W / 2 + bounds.left * H - crop.x) * sx, (W / 2 + bounds.right * H - crop.x) * sx, (H / 2 + bounds.top * H - crop.y) * sy, (H / 2 + bounds.bottom * H - crop.y) * sy);
}

function statsInRect(pixels: Pixels, left: number, right: number, top: number, bottom: number): FrameStats | null {
  const W = pixels.width, H = pixels.height;
  const x0 = Math.max(0, Math.floor(left)), x1 = Math.min(W, Math.ceil(right));
  const y0 = Math.max(0, Math.floor(top)), y1 = Math.min(H, Math.ceil(bottom));
  if (x1 <= x0 || y1 <= y0) return null;
  let sum = 0, clipped = 0, crushed = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 3;
      const r = pixels.rgb[i]!, g = pixels.rgb[i + 1]!, b = pixels.rgb[i + 2]!;
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      sum += l;
      if (r >= 250 || g >= 250 || b >= 250) clipped++;
      if (l <= 5 / 255) crushed++;
      n++;
    }
  }
  return { region_px: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, pixels: n, mean_luminance: r4(sum / n), clipped_highlights: r4(clipped / n), crushed_shadows: r4(crushed / n) };
}

export type ReportOptions = {
  include?: string[];
  subjects?: string[];
  bounds?: BoundsKind;
  radius?: number;
  max_npcs?: number;
  manifest?: string;
  focus?: string;
};

async function call(context: CommandContext, method: string, params: Record<string, unknown>): Promise<Json> {
  const response = await context.api.callBridge(method, params, context.cid);
  if (!response.ok) throw Object.assign(new Error(response.error.message), { plain: response.error });
  return response.result as Json;
}

/** Everything the report says, from the raw readings (pure; the tests feed it simulated readings). */
export function buildReport(raw: Json, options: ReportOptions, extra: { showroom?: Showroom | null; photoMenu?: Json | null }) {
  const include = new Set(options.include ?? ["camera", "subjects", "lights", "world", "ui"]);
  const kinds = new Set(options.subjects ?? ["v", "npcs", "showroom"]);
  const pose = poseOf(raw.camera);
  const out: Json = { phase: raw.phase };
  const warnings: string[] = [];
  if (!pose) {
    warnings.push("the game reported no active camera");
    return { ...out, warnings, subjects: [], lights: [] };
  }
  const model = calibrate(pose, raw.calibration as Calibration | undefined);
  if (include.has("camera")) {
    out.camera = {
      position: pose.position.map(r4), forward: pose.forward.map(r4), fov: pose.fov, aspect: r4(pose.aspect), mode: raw.camera?.mode ?? raw.phase,
      yaw_deg: r4(Math.atan2(-pose.forward[0], pose.forward[1]) / DEG), pitch_deg: r4(Math.asin(Math.max(-1, Math.min(1, pose.forward[2]))) / DEG),
      ...(extra.photoMenu && typeof extra.photoMenu.exposure === "number" ? { exposure: extra.photoMenu.exposure } : {}),
      projection: { by: model.by, ...(model.fov_axis ? { fov_axis: model.fov_axis } : {}) },
    };
  }
  const subjects: Subject[] = [];
  const bounds = options.bounds ?? "face";
  if (raw.v && kinds.has("v")) {
    const v = subjectOf(model, "v", "v", raw.v, bounds, raw.v.source);
    if (extra.photoMenu) {
      if (extra.photoMenu.expression) v.expression = extra.photoMenu.expression;
      if (extra.photoMenu.pose) v.pose = extra.photoMenu.pose;
    }
    subjects.push(v);
  }
  if (Array.isArray(raw.npcs) && kinds.has("npcs")) for (const npc of raw.npcs as Json[]) subjects.push(subjectOf(model, "npc", String(npc.id), npc, bounds, String(npc.name ?? "")));
  const pieces = (raw.showroom?.pieces as Json[] | undefined) ?? [];
  if (kinds.has("showroom")) for (const piece of pieces) subjects.push(subjectOf(model, "piece", `piece:${piece.index}`, pieceSubject(piece), bounds, String(piece.label ?? "")));
  if (include.has("subjects")) out.subjects = subjects;
  const focus = options.focus ? subjects.find((s) => s.id === options.focus) : subjects.find((s) => s.kind === "piece") ?? subjects.find((s) => s.kind === "v");
  if (include.has("lights")) {
    out.lights = focus ? { focus: focus.id, at: focus.face.map(r4), each: lightsAt(focus.face, raw, extra.showroom ?? null, extra.photoMenu ?? null) } : { focus: null, each: [] };
    out.lights.world_lights = raw.lights?.world_lights ?? "not read";
  }
  if (include.has("world") && raw.world) out.world = raw.world;
  if (include.has("ui") && raw.ui) out.ui = raw.ui;
  for (const s of subjects) {
    if (s.occluded) warnings.push(`${s.id} is blocked from the camera (static geometry ${s.occlusion?.hit_distance ?? "?"} m away, the face at ${s.occlusion?.target_distance ?? "?"} m)`);
    if (s.in_frame < 1 && s.in_frame > 0) warnings.push(`${s.id} is only ${Math.round(s.in_frame * 100)} % in frame`);
  }
  out.warnings = warnings;
  out.model = model;
  return out;
}

/** Photo mode's menu values the report uses: exposure (10), expression (28), pose (6), and the selected light's (43, 44, 47). */
export function photoMenuOf(state: Json | null): Json | null {
  const menu = (state?.menu as Json[] | undefined) ?? [];
  if (!menu.length) return null;
  const value = (key: number) => menu.find((m) => m.key === key)?.value;
  const option = (key: number) => {
    const item = menu.find((m) => m.key === key);
    const text = item?.options?.find((o: Json) => o.data === item.value)?.text;
    return item ? { value: item.value, ...(text ? { label: text } : {}) } : undefined;
  };
  return {
    exposure: value(10),
    expression: option(28),
    pose: option(6),
    selected: typeof value(43) === "number" ? Math.round(value(43)) + 1 : null,
    on: value(44),
    brightness: value(47),
  };
}

/** scene.report: one scene.read (and photo.state in photo mode), then the report; frame statistics from a fresh grab. */
export async function runSceneReport(input: Json, context: CommandContext) {
  const options = input as ReportOptions & { frame?: { subject?: string; max_width?: number } };
  const raw = await call(context, "scene.read", {
    ...(options.radius !== undefined ? { radius: options.radius } : {}),
    ...(options.max_npcs !== undefined ? { max_npcs: options.max_npcs } : {}),
  });
  let photoMenu: Json | null = null;
  if (raw.phase === "photo_mode") {
    try {
      photoMenu = photoMenuOf(await call(context, "photo.state", { menu: true, options: true }));
    } catch {
      photoMenu = null;
    }
  }
  const showroom = options.manifest ? readShowroom(options.manifest) : null;
  const report = buildReport(raw, options, { showroom, photoMenu });
  const { model, ...value } = report as Json;
  if (options.include?.includes("frame")) {
    const { grabForAnalysis } = await import("../capture/capture.ts");
    const wanted = options.frame?.subject ?? options.focus;
    const subject = ((report.subjects as Subject[] | undefined) ?? []).find((s) => (wanted ? s.id === wanted : true));
    if (!subject?.bounds) {
      value.frame = { error: "no subject with screen bounds to measure (is it in front of the camera?)" };
    } else {
      const pixels = grabForAnalysis(context.api.captureTarget(), options.frame?.max_width ?? 960);
      value.frame = { subject: subject.id, ...frameStats(pixels, subject.bounds) };
    }
  }
  return value;
}

export type Expectation = {
  subject?: string;
  in_frame_margin?: number;
  unoccluded?: boolean;
  lit_by?: "any" | "photo" | "rig";
  luminance?: [number, number];
  max_clipped?: number;
  max_crushed?: number;
};
export type ExpectationResult = { check: string; ok: boolean; detail: string };

/** The subject an expectation names: face / head / body of V, "piece:N", or an NPC id; default V (else the first piece). */
export function pickSubject(subjects: readonly Subject[], wanted?: string): Subject | undefined {
  if (!wanted || wanted === "face" || wanted === "head" || wanted === "body" || wanted === "v") return subjects.find((s) => s.kind === "v") ?? subjects.find((s) => s.kind === "piece");
  return subjects.find((s) => s.id === wanted || s.label === wanted);
}

/** The checks judged before a capture: in frame with a margin, not blocked, lit. */
export function judgeBefore(report: Json, expect: Expectation): ExpectationResult[] {
  const results: ExpectationResult[] = [];
  const subject = pickSubject((report.subjects as Subject[]) ?? [], expect.subject);
  if (!subject) return [{ check: "subject", ok: false, detail: `no subject ${expect.subject ?? "V"} in the scene report` }];
  if (expect.in_frame_margin !== undefined) {
    const m = subject.margins;
    const worst = m ? Math.min(m.left, m.right, m.top, m.bottom) : -1;
    results.push({ check: "in_frame_margin", ok: subject.in_frame >= 0.999 && worst >= expect.in_frame_margin,
      detail: m ? `${subject.id}: ${Math.round(subject.in_frame * 100)} % in frame, smallest margin ${r4(worst)} window heights (wanted ${expect.in_frame_margin})` : `${subject.id} isn't in front of the camera` });
  }
  if (expect.unoccluded) {
    results.push({ check: "unoccluded", ok: subject.occluded !== true, detail: subject.occluded === null ? `${subject.id}: no occlusion check (too close, or not asked)` : subject.occluded ? `${subject.id} is blocked by static geometry` : `${subject.id} is in clear view` });
  }
  if (expect.lit_by) {
    const lights = ((report.lights?.each as LightReport[] | undefined) ?? []).filter((l) => (expect.lit_by === "any" || l.kind === expect.lit_by) && l.reaches_face === true && l.on !== false);
    results.push({ check: "lit_by", ok: lights.length > 0, detail: lights.length ? `${lights.length} ${expect.lit_by === "any" ? "" : expect.lit_by + " "}light(s) reach ${report.lights?.focus}` : `no ${expect.lit_by === "any" ? "" : expect.lit_by + " "}light reaches ${report.lights?.focus ?? subject.id} (the report's lights say which are off or blocked)` });
  }
  return results;
}

/** The checks judged on the capture itself: luminance, clipped highlights, crushed shadows in the subject's region. */
export function judgeAfter(stats: FrameStats | null, expect: Expectation): ExpectationResult[] {
  const results: ExpectationResult[] = [];
  if (!stats) return expect.luminance || expect.max_clipped !== undefined || expect.max_crushed !== undefined ? [{ check: "frame", ok: false, detail: "the subject's region isn't in the capture" }] : [];
  if (expect.luminance) {
    const [lo, hi] = expect.luminance;
    results.push({ check: "luminance", ok: stats.mean_luminance >= lo && stats.mean_luminance <= hi, detail: `mean luminance ${stats.mean_luminance} (wanted ${lo}-${hi})` });
  }
  if (expect.max_clipped !== undefined) results.push({ check: "clipped_highlights", ok: stats.clipped_highlights <= expect.max_clipped, detail: `${r4(stats.clipped_highlights * 100)} % clipped (at most ${expect.max_clipped * 100} %)` });
  if (expect.max_crushed !== undefined) results.push({ check: "crushed_shadows", ok: stats.crushed_shadows <= expect.max_crushed, detail: `${r4(stats.crushed_shadows * 100)} % crushed (at most ${expect.max_crushed * 100} %)` });
  return results;
}

export { project };

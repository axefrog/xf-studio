// XF Finish Showroom on the tools side: reading a showroom build's manifest, choosing its presets, laying the heads out in
// front of V or the camera, placing a light rig per head (or on V) and estimating how much each head's rig spills onto its
// neighbours. Pure arithmetic and file reading; the bridge only spawns what this plans (showroom.place, showroom.lights).
//
// Frames: world X/Y horizontal, Z up (metres). A head's entity faces its local +Y; a yaw θ (degrees, about +Z,
// counter-clockwise seen from above) turns +Y to (−sin θ, cos θ, 0). That sign convention is the game's EulerAngles yaw
// as the teleportation facility and Codeware's spawn orientation take it [hypothesis until the first spawn is seen: the
// test card's first step checks that the heads face the camera].

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const SHOWROOM_SCHEMA = "xfs/showroom-package-1";
export type Vec3 = [number, number, number];

export type RigLight = {
  name: string;
  position: Vec3;
  axis: Vec3;
  lumen: number;
  falloff: "linear" | "inverse-square";
  radius: number;
  outer: number;
  inner: number;
  softness: number;
};
export type RigProfile = "creator" | "creator_face" | "key";
export const RIG_PROFILES: readonly RigProfile[] = ["creator", "creator_face", "key"];

export type ShowroomPiece = { id: string; name: string; appearance: string; route: string; template: string; manifest: string };
export type Showroom = {
  path: string;
  archive: string;
  entity: string;
  rigEntity: string;
  headJoint: Vec3;
  pieces: ShowroomPiece[];
  rigs: Record<RigProfile, { appearance: string; lights: RigLight[] }>;
};

class PlanError extends Error {
  plain: { code: string; message: string };
  constructor(code: string, message: string) {
    super(message);
    this.plain = { code, message };
  }
}
export const planError = (code: string, message: string) => new PlanError(code, message);

const depot = (path: string) => path.replaceAll("/", "\\");
const isVec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));

/** Reads a showroom build's manifest (the file, or the build folder holding it) and checks what the bridge relies on. */
export function readShowroom(path: string): Showroom {
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, "manifest.json") : path;
  if (!existsSync(file)) throw planError("showroom_manifest_missing", `No showroom manifest at ${file}. Build XF Finish Showroom first (tools/build_showroom_package.ts).`);
  let value: any;
  try {
    value = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    throw planError("showroom_manifest_bad", `The showroom manifest at ${file} isn't JSON.`);
  }
  const bad = (what: string) => planError("showroom_manifest_bad", `The showroom manifest at ${file} ${what}; build the showroom again.`);
  if (value?.schema !== SHOWROOM_SCHEMA) throw bad(`is not ${SHOWROOM_SCHEMA}`);
  if (typeof value.archive !== "string" || !/^xfs_showroom_[0-9a-f]{32}$/.test(value.archive)) throw bad("names no showroom archive");
  const key = value.archive.slice("xfs_showroom_".length);
  const entity = depot(String(value.entity ?? "")), rigEntity = depot(String(value.rigEntity ?? ""));
  const root = `axefrog\\appearance_studio\\collections\\${key}\\showroom\\`;
  if (entity !== `${root}xfs_showroom.ent` || rigEntity !== `${root}xfs_showroom_rig.ent`) throw bad("names other entities than its own");
  if (!isVec(value.headJoint)) throw bad("has no head joint");
  if (!Array.isArray(value.pieces) || !value.pieces.length) throw bad("lists no presets");
  const pieces: ShowroomPiece[] = value.pieces.map((p: any) => {
    if (typeof p?.appearance !== "string" || !/^xfs_p[0-9a-f]{32}$/.test(p.appearance) || typeof p.name !== "string") throw bad("has a preset without its appearance");
    return { id: String(p.id), name: p.name, appearance: p.appearance, route: String(p.route ?? ""), template: entity, manifest: file };
  });
  const rigs = {} as Showroom["rigs"];
  for (const profile of RIG_PROFILES) {
    const rig = value.rigs?.[profile];
    if (rig?.appearance !== `xfs_rig_${profile}` || !Array.isArray(rig.lights) || !rig.lights.length) throw bad(`has no ${profile} rig`);
    rigs[profile] = {
      appearance: rig.appearance,
      lights: rig.lights.map((l: any) => {
        if (!isVec(l.position) || !isVec(l.axis) || !(l.lumen >= 0) || !(l.radius > 0)) throw bad(`has a malformed ${profile} light`);
        return { name: String(l.name), position: l.position, axis: l.axis, lumen: l.lumen, falloff: l.falloff === "linear" ? "linear" : "inverse-square",
          radius: l.radius, outer: l.outer, inner: l.inner, softness: l.softness };
      }),
    };
  }
  return { path: file, archive: value.archive, entity, rigEntity, headJoint: value.headJoint, pieces, rigs };
}

/**
 * The presets to show, in order: every preset of every showroom, or the ones named (by name, case-insensitively and ignoring
 * spaces and punctuation, by preset ID or by appearance). At most 24.
 */
export function choosePieces(showrooms: readonly Showroom[], wanted?: readonly string[]): ShowroomPiece[] {
  const all = showrooms.flatMap((s) => s.pieces);
  const loose = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const chosen = !wanted?.length
    ? all
    : wanted.map((name) => {
        const exact = all.filter((p) => p.name === name || p.id === name || p.appearance === name);
        const found = exact.length ? exact : all.filter((p) => loose(p.name) === loose(name));
        if (found.length !== 1)
          throw planError(found.length ? "ambiguous_preset" : "unknown_preset",
            found.length ? `"${name}" matches ${found.length} presets (${found.map((p) => p.name).join(", ")}); name it by its ID.`
              : `No showroom preset is called "${name}". The showroom has: ${all.map((p) => p.name).join(", ")}.`);
        return found[0]!;
      });
  if (chosen.length > 24) throw planError("too_many", `The showroom holds ${chosen.length} presets; choose at most 24 (presets).`);
  if (new Set(chosen.map((p) => p.appearance)).size !== chosen.length) throw planError("bad_input", "A preset is chosen twice.");
  return chosen;
}

export type Anchor = { origin: Vec3; forward: Vec3; ground: number };
export type Placement = { index: number; position: Vec3; yaw: number };

const RAD = Math.PI / 180;
/** The yaw (degrees) that turns a head's +Y toward the horizontal direction d. */
export const yawFacing = (d: Vec3) => Math.atan2(-d[0], d[1]) / RAD;
/** The horizontal direction a yaw faces. */
export const facingOf = (yaw: number): Vec3 => [-Math.sin(yaw * RAD), Math.cos(yaw * RAD), 0];
const horizontal = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1]);
  if (l < 1e-6) throw planError("bad_anchor", "The anchor faces straight up or down; turn the camera toward the horizon.");
  return [v[0] / l, v[1] / l, 0];
};
const round = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Where the heads go. row: a straight line `distance` in front of the anchor across its view, every head facing back
 * along the view, `spacing` apart. arc: on a circle of radius `distance` about the anchor, `spacing` apart along it,
 * every head facing the anchor, so the camera sees each head from the front. Heads stand on V's ground; their order runs
 * left to right as the anchor sees them. `lateral` (metres) shifts the lineup to the anchor's right, or left when negative.
 */
export function planLayout(anchor: Anchor, count: number, layout: "row" | "arc", spacing: number, distance: number, lateral = 0): Placement[] {
  const f = horizontal(anchor.forward), r: Vec3 = [f[1], -f[0], 0];
  const out: Placement[] = [];
  for (let i = 0; i < count; i++) {
    // `lateral` moves the whole lineup to the anchor's right (negative: left) along the row or the arc, so a head can
    // stand beside V instead of in front of her.
    const offset = i - (count - 1) / 2 + lateral / spacing;
    if (layout === "row") {
      const p: Vec3 = [anchor.origin[0] + f[0] * distance + r[0] * offset * spacing, anchor.origin[1] + f[1] * distance + r[1] * offset * spacing, anchor.ground];
      out.push({ index: i, position: p.map(round) as Vec3, yaw: round(yawFacing([-f[0], -f[1], 0])) });
    } else {
      // Counter-clockwise angles turn toward the anchor's left, so the first head gets the largest angle.
      const a = (-offset * spacing) / distance;
      const u: Vec3 = [f[0] * Math.cos(a) - f[1] * Math.sin(a), f[0] * Math.sin(a) + f[1] * Math.cos(a), 0];
      const p: Vec3 = [anchor.origin[0] + u[0] * distance, anchor.origin[1] + u[1] * distance, anchor.ground];
      out.push({ index: i, position: p.map(round) as Vec3, yaw: round(yawFacing([-u[0], -u[1], 0])) });
    }
  }
  return out;
}

/** A point in an entity's frame (at position, turned by yaw) in the world. */
export function toWorld(position: Vec3, yaw: number, local: Vec3): Vec3 {
  const c = Math.cos(yaw * RAD), s = Math.sin(yaw * RAD);
  return [position[0] + c * local[0] - s * local[1], position[1] + s * local[0] + c * local[1], position[2] + local[2]];
}
/** A world point in an entity's frame. */
export function toLocal(position: Vec3, yaw: number, world: Vec3): Vec3 {
  const c = Math.cos(yaw * RAD), s = Math.sin(yaw * RAD), d = [world[0] - position[0], world[1] - position[1], world[2] - position[2]];
  return [c * d[0]! + s * d[1]!, -s * d[0]! + c * d[1]!, d[2]!];
}

/**
 * One rig light's strength at a point in the rig's frame, with the engine's decoded forms (knowledge/creator-lighting.md §2):
 * lumens as Φ/4π, the cone read as full angles and raised to the softness, linear or windowed inverse-square falloff.
 * For comparing rigs only; the absolute scale is unknown.
 */
export function lightAt(l: RigLight, point: Vec3): number {
  const d: Vec3 = [point[0] - l.position[0], point[1] - l.position[1], point[2] - l.position[2]];
  const n = Math.hypot(...d);
  if (n < 1e-6) return 0;
  const cos = (d[0] * l.axis[0] + d[1] * l.axis[1] + d[2] * l.axis[2]) / n;
  const co = Math.cos((l.outer / 2) * RAD), ci = Math.cos((Math.max(l.inner, 0.01) / 2) * RAD);
  const cone = Math.min(1, Math.max(0, (cos - co) / Math.max(ci - co, 1e-4))) ** l.softness;
  const fall = l.falloff === "linear" ? 1 - Math.min(1, n / l.radius) : Math.min(1, Math.max(0, 1 - (n / l.radius) ** 4)) ** 2 / Math.max(n * n, 1e-4);
  return (l.lumen / (4 * Math.PI)) * cone * fall;
}

export type RigPlacement = { index: number; position: Vec3; yaw: number };
/**
 * For each lit head: how much light from the other rigs reaches its head joint, as a share of its own rig's (summed
 * scalar strengths; direction and shadows ignored). Heads are the placements of the rigs themselves.
 */
export function spill(lights: readonly RigLight[], rigs: readonly RigPlacement[], headJoint: Vec3): { index: number; share: number }[] {
  return rigs.map((own) => {
    const head = toWorld(own.position, own.yaw, headJoint);
    const strength = (rig: RigPlacement) => lights.reduce((sum, l) => sum + lightAt(l, toLocal(rig.position, rig.yaw, head)), 0);
    const mine = strength(own);
    const others = rigs.filter((r) => r !== own).reduce((sum, r) => sum + strength(r), 0);
    return { index: own.index, share: mine > 0 ? Math.round((1000 * others) / mine) / 1000 : 0 };
  });
}

/** Spacing at which a row of `count` heads with this rig each spill less than `share` onto their neighbours. */
export function spacingFor(lights: readonly RigLight[], headJoint: Vec3, count: number, share = 0.05): number {
  for (let spacing = 0.3; spacing <= 10; spacing = Math.round((spacing + 0.1) * 10) / 10) {
    const rigs = Array.from({ length: count }, (_, i) => ({ index: i, position: [(i - (count - 1) / 2) * spacing, 0, 0] as Vec3, yaw: 0 }));
    if (Math.max(...spill(lights, rigs, headJoint).map((s) => s.share)) < share) return spacing;
  }
  return 10;
}

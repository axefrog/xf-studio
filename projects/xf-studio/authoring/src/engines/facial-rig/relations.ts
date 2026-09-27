/**
 * What the solver says about pairs of controls (symmetry.ts proposes by name; this decides from solved motion). Pure: the host passes
 * each control's solved world displacement at full weight (per joint, glTF axes) and the rest skeleton.
 *
 * - **Opposing pairs.** Two proposed opposites are one axis when their displacement fields point against each other: cosine over every
 *   joint below `OPPOSED` (on V's rig the confirmed pairs sit between −0.57 and −1.00, the rejected proposals at −0.20 or above). A
 *   control belongs to at most one axis: the most opposed proposal wins.
 * - **Orientation** by the ends' world words where they have them (l/r, up/dn, fwd/back), else from the joint that moves most: the axis runs left/right, down/up or back/forward by the larger component of the
 *   difference between the ends. A lateral axis is in V's own left and right when it is a gaze (a control of the setup's Eyes part)
 *   or its ends are on different sides (jaw, mouth, neck); ends on the same side of the face (a nostril) run inward/outward.
 * - **Gaze counterparts.** For each horizontal gaze control, whether its counterpart (the other eye's opposite direction) moves the
 *   eye the same world way: joints swapped left for right, the unreflected match must beat the reflected one.
 */
import { worldPositions, type RigRest, type Vec3 } from "./pose";
import { counterpartName, isHorizontalGaze, oppositeCandidates, type AxisPair } from "./symmetry";
import { controlSide } from "./vocabulary";

export const OPPOSED = -0.45;
export type RelationsInput = { rest: RigRest; controls: readonly { name: string; track: number }[];
  /** Each control's solved displacement per joint (metres), in `controls` order; undefined for a control that moves nothing. */
  displacement: readonly (readonly Vec3[] | undefined)[];
  /** Tracks of the setup's Eyes part (gaze and pupils). */
  eyeTracks: ReadonlySet<number> };
export type Relations = { axes: AxisPair[]; gazeSameWay: boolean | null };

const dot = (a: readonly Vec3[], b: readonly Vec3[]) => a.reduce((sum, v, i) => sum + v[0] * b[i]![0] + v[1] * b[i]![1] + v[2] * b[i]![2], 0);
const norm = (a: readonly Vec3[]) => Math.sqrt(dot(a, a));

/** The face's frame from the rest skeleton: which sign of glTF x is V's left, and which sign of z is forward. */
function faceFrame(rest: RigRest) {
  // Joint names carry their side (l_…, r_…): V's left is where the left joints sit at rest. V faces −Z in the preview's axes.
  const world = worldPositions(rest);
  const mean = (prefix: string) => { const xs = rest.joints.flatMap((joint, i) => joint.name.startsWith(prefix) ? [world[i]![0]] : []); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; };
  return { left: Math.sign(mean("l_") - mean("r_")) || 1, forward: -1 };
}

/** The axis two names state by their differing word, or null (in/out, or no world word). */
function namedDirection(a: string, b: string): Omit<AxisPair, "frame"> | null {
  const x = a.split("_"), y = b.split("_"), at = x.findIndex((token, i) => token !== y[i]);
  if (at < 0 || x.length !== y.length) return null;
  const words = new Set([x[at], y[at]]);
  const pick = (negative: string, direction: AxisPair["direction"]) => ({ negative: x[at] === negative ? a : b, positive: x[at] === negative ? b : a, direction });
  if (words.has("l") && words.has("r")) return pick("l", "lateral");
  if (words.has("up") && words.has("dn")) return pick("dn", "vertical");
  if (words.has("back") && (words.has("fwd") || words.has("front"))) return pick("back", "depth");
  return null;
}

/**
 * The opposing pairs the names alone settle, for when the solver hasn't confirmed any (it is missing, starting or its probe failed): the
 * same proposals `findRelations` starts from (`oppositeCandidates`), kept only where the names also fix the orientation. Those are
 * gaze (in/out per eye by its known meaning, up/down) and ends named with a world direction (l/r, up/dn, back/fwd). Skin pairs named
 * only in/out are left one-way: on V's rig their words don't say which way they move (a nostril's "breathe in" flares outward) or
 * whether they oppose at all (the brow raises in/out move together), so only the solver can settle them. A control joins at most one
 * pair, the first in the given order. The solver's axes replace these once it runs; a proposal it rejects is simply absent then.
 */
export function proposeAxes(names: readonly string[]): AxisPair[] {
  const present = new Set(names), used = new Set<string>(), axes: AxisPair[] = [];
  for (const a of names) {
    if (used.has(a)) continue;
    for (const b of oppositeCandidates(a)) {
      if (!present.has(b) || used.has(b)) continue;
      let axis: AxisPair | null = null;
      if (isHorizontalGaze(a) && isHorizontalGaze(b)) {
        // V's left is negative: the left eye looks toward V's left when it looks out, the right eye when it looks in.
        const towardLeft = controlSide(a) === "left" ? "out" : "in";
        const [negative, positive] = a.endsWith(`_${towardLeft}`) ? [a, b] : [b, a];
        axis = { negative, positive, direction: "lateral", frame: "world" };
      } else {
        const named = namedDirection(a, b);
        if (named) axis = { ...named, frame: "world" };
      }
      if (!axis) continue;
      used.add(a); used.add(b); axes.push(axis);
      break;
    }
  }
  return axes;
}

export function findRelations(input: RelationsInput): Relations {
  const { controls, displacement } = input;
  const index = new Map(controls.map((control, i) => [control.name, i]));
  const candidates: { a: number; b: number; cos: number }[] = [];
  controls.forEach((control, a) => {
    const da = displacement[a];
    if (!da || !norm(da)) return;
    for (const name of oppositeCandidates(control.name)) {
      const b = index.get(name), db = b === undefined ? undefined : displacement[b];
      if (b === undefined || b < a || !db || !norm(db)) continue;
      const cos = dot(da, db) / (norm(da) * norm(db));
      if (cos < OPPOSED) candidates.push({ a, b, cos });
    }
  });
  candidates.sort((x, y) => x.cos - y.cos);
  const used = new Set<number>(), frame = faceFrame(input.rest), axes: AxisPair[] = [];
  for (const { a, b } of candidates) {
    if (used.has(a) || used.has(b)) continue;
    used.add(a); used.add(b);
    const da = displacement[a]!, db = displacement[b]!;
    let peak = 0, peakAt = 0;
    da.forEach((v, j) => { const size = Math.hypot(...v) + Math.hypot(...db[j]!); if (size > peak) { peak = size; peakAt = j; } });
    const d = [db[peakAt]![0] - da[peakAt]![0], db[peakAt]![1] - da[peakAt]![1], db[peakAt]![2] - da[peakAt]![2]];
    // From end a to end b, in the face's frame: + is V's left, up, forward.
    const lateral = d[0]! * frame.left, up = d[1]!, forward = d[2]! * frame.forward;
    const nameA = controls[a]!.name, nameB = controls[b]!.name;
    const direction = Math.abs(lateral) >= Math.abs(up) && Math.abs(lateral) >= Math.abs(forward) ? "lateral" : Math.abs(up) >= Math.abs(forward) ? "vertical" : "depth";
    const gaze = input.eyeTracks.has(controls[a]!.track) && input.eyeTracks.has(controls[b]!.track);
    const sameSide = !gaze && controlSide(nameA) !== null && controlSide(nameA) === controlSide(nameB);
    // Ends named with a world direction (l/r, up/dn, fwd/back, front/back) keep the rig author's meaning: a neck corrective's biggest skin
    // motion can run against the head motion it is for. Only in/out pairs are oriented by where they move.
    const named = namedDirection(nameA, nameB);
    if (named) { axes.push({ ...named, frame: "world" }); continue; }
    let bIsPositive: boolean;
    if (direction === "vertical") bIsPositive = up > 0;
    else if (direction === "depth") bIsPositive = forward > 0;
    else if (sameSide) bIsPositive = (controlSide(nameA) === "left" ? lateral : -lateral) > 0; // outward is positive
    else bIsPositive = lateral < 0; // V's left is negative
    axes.push({ negative: bIsPositive ? nameA : nameB, positive: bIsPositive ? nameB : nameA, direction, frame: direction === "lateral" && sameSide ? "outward" : "world" });
  }
  // Gaze counterparts move the eye the same world way (joints swapped left for right, compared unreflected and reflected).
  const swap = input.rest.joints.map(joint => {
    const other = joint.name.startsWith("l_") ? `r_${joint.name.slice(2)}` : joint.name.startsWith("r_") ? `l_${joint.name.slice(2)}` : joint.name;
    const at = input.rest.joints.findIndex(item => item.name === other);
    return at < 0 ? input.rest.joints.indexOf(joint) : at;
  });
  let checked = 0, same = 0;
  controls.forEach((control, a) => {
    if (!isHorizontalGaze(control.name)) return;
    const partner = counterpartName(control.name), b = partner ? index.get(partner) : undefined;
    const da = displacement[a], db = b === undefined ? undefined : displacement[b];
    if (!da || !db) return;
    const moved = swap.map(j => da[j]!);
    const straight = dot(moved, db), reflected = dot(moved.map(v => [-v[0], v[1], v[2]] as Vec3), db);
    checked++; if (straight > reflected) same++;
  });
  return { axes, gazeSameWay: checked ? same === checked : null };
}

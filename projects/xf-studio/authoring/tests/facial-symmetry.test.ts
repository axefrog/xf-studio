/**
 * Symmetry and two-way controls of the face (engines/facial-rig/symmetry.ts, relations.ts; research/animation/natural-expressions.md
 * §10): the counterpart and opposite tables, pair detection from solved motion (a synthetic face, no game data), gaze counterparts
 * that look the same way, and the lossless two-way read and write, mixed values included.
 */
import { expect, test } from "bun:test";
import { buildAxes, counterpartName, isGaze, linkedByDefault, linkKey, oppositeCandidates, readAxis, writeAxis } from "../src/engines/facial-rig/symmetry";
import { findRelations, proposeAxes } from "../src/engines/facial-rig/relations";
import { f32 } from "../src/engines/facial-rig/vector";
import type { RigJoint, Vec3 } from "../src/engines/facial-rig/pose";

test("the counterpart table: skin mirrors, horizontal gaze keeps the look direction, vertical gaze copies, centre and lateral controls have none", () => {
  const table = Object.fromEntries(["eye_l_brows_raise_in", "lips_r_corner_up", "eye_l_dir_in", "eye_l_dir_out", "eye_r_dir_in", "eye_l_dir_up", "eye_r_dir_dn",
    "jaw_mid_open", "jaw_mid_shift_l", "lips_mid_shift_r", "neck_l_turn", "head_neck_l_tilt", "face_gravity_l", "nose_l_breathe_in", "tongue_mid_tip_l"]
    .map(name => [name, counterpartName(name)]));
  expect(table).toEqual({
    eye_l_brows_raise_in: "eye_r_brows_raise_in", lips_r_corner_up: "lips_l_corner_up",
    eye_l_dir_in: "eye_r_dir_out", eye_l_dir_out: "eye_r_dir_in", eye_r_dir_in: "eye_l_dir_out",
    eye_l_dir_up: "eye_r_dir_up", eye_r_dir_dn: "eye_l_dir_dn",
    jaw_mid_open: null, jaw_mid_shift_l: null, lips_mid_shift_r: null, neck_l_turn: null, head_neck_l_tilt: null, face_gravity_l: null,
    nose_l_breathe_in: "nose_r_breathe_in", tongue_mid_tip_l: null,
  });
  // A control and its counterpart share one link key; every pair with a counterpart starts linked (gaze too).
  expect([linkKey("eye_l_dir_in"), linkKey("eye_r_dir_out"), linkKey("eye_l_dir_out")]).toEqual(["eye_dir_h", "eye_dir_h", "eye_dir_h"]);
  expect([linkKey("eye_l_brows_lower"), linkKey("jaw_mid_shift_l"), linkKey("jaw_mid_open")]).toEqual(["eye_brows_lower", null, null]);
  expect([linkedByDefault("eye_l_dir_in"), linkedByDefault("eye_l_brows_lower"), linkedByDefault("neck_l_turn")]).toEqual([true, true, false]);
  expect([isGaze("eye_l_dir_up"), isGaze("eye_l_widen")]).toEqual([true, false]);
});

test("opposite proposals: a direction word swapped or the other side of a lateral pair; names only propose", () => {
  expect(oppositeCandidates("eye_l_dir_in")).toEqual(["eye_l_dir_out"]);
  expect(oppositeCandidates("jaw_mid_shift_l")).toEqual(["jaw_mid_shift_r"]);
  expect(oppositeCandidates("neck_up_turn")).toEqual(["neck_dn_turn"]);
  expect(oppositeCandidates("tongue_mid_base_back").sort()).toEqual(["tongue_mid_base_front", "tongue_mid_base_fwd"]);
  // A skin pair proposed by its words (brow raise in/out) is left to the solver, which rejects it on V's rig.
  expect(oppositeCandidates("eye_l_brows_raise_in")).toEqual(["eye_l_brows_raise_out"]);
  expect(oppositeCandidates("eye_l_brows_lower")).toEqual([]);
});

/** A synthetic face: joints root, the two pupils, the jaw and each nostril (l_ at +x, V's left, facing −Z). */
const JOINT = (name: string, parent: number, t: Vec3): RigJoint => ({ name, parent, t, r: [0, 0, 0, 1], s: [1, 1, 1] });
const REST = { joints: [JOINT("root", -1, [0, 0, 0]), JOINT("l_pupil", 0, [0.03, 1.7, -0.08]), JOINT("r_pupil", 0, [-0.03, 1.7, -0.08]),
  JOINT("jaw", 0, [0, 1.6, -0.06]), JOINT("l_nostril", 0, [0.01, 1.65, -0.1]), JOINT("r_nostril", 0, [-0.01, 1.65, -0.1])] };
const move = (joint: number, d: Vec3): Vec3[] => REST.joints.map((_, j) => j === joint ? d : [0, 0, 0]);
const CONTROLS = [
  ["eye_l_dir_in", move(1, [-0.004, 0, 0])], ["eye_l_dir_out", move(1, [0.004, 0, 0])],       // toward the nose is −x for the left eye
  ["eye_r_dir_in", move(2, [0.004, 0, 0])], ["eye_r_dir_out", move(2, [-0.004, 0, 0])],
  ["eye_l_dir_up", move(1, [0, 0.003, 0])], ["eye_l_dir_dn", move(1, [0, -0.005, 0])],
  ["jaw_mid_shift_l", move(3, [0.01, 0, 0])], ["jaw_mid_shift_r", move(3, [-0.01, 0, 0])],
  ["nose_l_breathe_in", move(4, [0.0014, 0, 0])], ["nose_l_breathe_out", move(4, [-0.0014, 0, 0])],
  ["eye_l_brows_raise_in", move(0, [0, 0.005, 0])], ["eye_l_brows_raise_out", move(0, [0.001, 0.005, 0])],
] as const;

test("pair detection from solved motion: opposed pairs become axes, oriented by world words or by where they move; gaze counterparts look the same way", () => {
  const controls = CONTROLS.map(([name], track) => ({ name, track: 100 + track }));
  const relations = findRelations({ rest: REST, controls, displacement: CONTROLS.map(([, d]) => d), eyeTracks: new Set([100, 101, 102, 103, 104, 105]) });
  const axes = Object.fromEntries(relations.axes.map(axis => [`${axis.negative}~${axis.positive}`, `${axis.direction}/${axis.frame}`]));
  expect(axes).toEqual({
    // Gaze in world terms: the negative end looks toward V's left (+x here): out for the left eye, in for the right.
    "eye_l_dir_out~eye_l_dir_in": "lateral/world", "eye_r_dir_in~eye_r_dir_out": "lateral/world",
    "eye_l_dir_dn~eye_l_dir_up": "vertical/world", "jaw_mid_shift_l~jaw_mid_shift_r": "lateral/world",
    // A nostril runs inward to outward.
    "nose_l_breathe_out~nose_l_breathe_in": "lateral/outward",
  });
  // The brow raises move the same way, so their proposal is rejected.
  expect(relations.axes.some(axis => axis.negative.includes("brows"))).toBe(false);
  expect(relations.gazeSameWay).toBe(true);
  // A rig whose counterparts crossed the eyes would be caught.
  const crossed = CONTROLS.map(([name, d]) => name === "eye_r_dir_out" ? move(2, [0.004, 0, 0]) : name === "eye_r_dir_in" ? move(2, [-0.004, 0, 0]) : d);
  expect(findRelations({ rest: REST, controls, displacement: crossed, eyeTracks: new Set([100, 101, 102, 103]) }).gazeSameWay).toBe(false);
  const labels = buildAxes(relations.axes).map(axis => axis.label);
  expect(labels).toContain("Left eye: look left ↔ right");
  expect(labels).toContain("Jaw: left ↔ right");
  expect(labels).toContain("Nostril, left: in ↔ out");
});

test("two-way values write both ends and read back exactly; a mixed pair is shown by its net and kept until it is moved", () => {
  const axis = { negative: "eye_l_dir_out", positive: "eye_l_dir_in" };
  const written = writeAxis({ jaw_mid_open: f32(0.2) }, axis, -0.35);
  expect(written).toEqual({ eye_l_dir_out: f32(0.35), jaw_mid_open: f32(0.2) });
  expect(readAxis(written, axis)).toEqual({ value: f32(0.35) * -1, negative: f32(0.35), positive: 0, mixed: false });
  expect(writeAxis(written, axis, 0)).toEqual({ jaw_mid_open: f32(0.2) });
  // A game expression may set both ends: the net shows, both raw weights are kept (lossless) until the axis is written.
  const mixed = { eye_l_dir_out: f32(0.3), eye_l_dir_in: f32(0.1) };
  expect(readAxis(mixed, axis)).toMatchObject({ value: f32(0.1) - f32(0.3), mixed: true });
  expect(writeAxis(mixed, axis, 0.5)).toEqual({ eye_l_dir_in: f32(0.5) });
  expect(writeAxis({}, axis, 7)).toEqual({ eye_l_dir_in: 1 });
});

test("proposed pairs without the solver: gaze and world-named pairs, oriented as the solver orients them; in/out skin pairs stay one-way", () => {
  const names = CONTROLS.map(([name]) => name);
  const proposed = Object.fromEntries(proposeAxes(names).map(axis => [`${axis.negative}~${axis.positive}`, `${axis.direction}/${axis.frame}`]));
  expect(proposed).toEqual({ "eye_l_dir_out~eye_l_dir_in": "lateral/world", "eye_r_dir_in~eye_r_dir_out": "lateral/world",
    "eye_l_dir_dn~eye_l_dir_up": "vertical/world", "jaw_mid_shift_l~jaw_mid_shift_r": "lateral/world" });
  // Every proposal the names settle agrees with what the solver finds from motion.
  const controls = CONTROLS.map(([name], track) => ({ name, track: 100 + track }));
  const solvedAxes = findRelations({ rest: REST, controls, displacement: CONTROLS.map(([, d]) => d), eyeTracks: new Set([100, 101, 102, 103, 104, 105]) }).axes
    .map(axis => `${axis.negative}~${axis.positive}`);
  for (const key of Object.keys(proposed)) expect(solvedAxes).toContain(key);
  // A control joins one pair; a name without its opposite proposes nothing.
  expect(proposeAxes(["eye_l_dir_up", "neck_up_turn"])).toEqual([]);
});

/**
 * Shared helpers for experiment 026: a running isolated Studio server's face rig and live solver (`--server http://127.0.0.1:<port>`),
 * and forward kinematics of the face skeleton, reported in the face's own frame in millimetres (left = the character's left, up,
 * forward = out of the face). The solver is the pinned, unmodified IO Suite solver the Studio runs as its own program.
 */
import { resolve } from "node:path";
import { posedLocals, type Quat, type RigJoint, type SolvedPose, type Vec3 } from "../../projects/xf-studio/authoring/src/engines/facial-rig/pose";

export const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1]! : fallback; };
export const server = arg("--server", "http://127.0.0.1:4463");
export const out = resolve(import.meta.dir, "generated");

export type Control = { name: string; text: string; group: string };
type State = { rig: { phase: string; joints: RigJoint[]; controls: Control[] } };
export const state = await (await fetch(`${server}/api/facial`)).json() as State;
if (state.rig.phase !== "ready") throw Error(`Face rig not ready: ${state.rig.phase}`);
export const joints = state.rig.joints;

const b64 = (text: string) => { const bytes = Buffer.from(text, "base64"); return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); };
export async function solve(controls: Record<string, number>): Promise<SolvedPose> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const answer = await (await fetch(`${server}/api/facial/solve`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ controls }) })).json() as { ok: boolean; q: string; t: string; code?: string; message?: string };
    if (answer.ok) return { q: b64(answer.q), t: b64(answer.t) };
    if (answer.code !== "superseded") throw Error(answer.message);
  }
  throw Error("solve kept being superseded");
}

const mul = (a: Quat, b: Quat): Quat => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const rot = (q: Quat, v: Vec3): Vec3 => {
  const [x, y, z, w] = q, cx = y * v[2] - z * v[1] + w * v[0], cy = z * v[0] - x * v[2] + w * v[1], cz = x * v[1] - y * v[0] + w * v[2];
  return [v[0] + 2 * (y * cz - z * cy), v[1] + 2 * (z * cx - x * cz), v[2] + 2 * (x * cy - y * cx)];
};
/** World positions (glTF axes, metres) of every joint, at rest or with posed locals. */
export function world(locals?: Map<number, { t: Vec3; r: Quat }>): Vec3[] {
  const p: Vec3[] = [], r: Quat[] = [];
  joints.forEach((joint, i) => {
    const local = locals?.get(i) ?? { t: joint.t, r: joint.r };
    if (joint.parent < 0) { p[i] = local.t; r[i] = local.r; return; }
    const pp = p[joint.parent]!, pr = r[joint.parent]!, s = joints[joint.parent]!.s;
    const d = rot(pr, [local.t[0] * s[0], local.t[1] * s[1], local.t[2] * s[2]]);
    p[i] = [pp[0] + d[0], pp[1] + d[1], pp[2] + d[2]]; r[i] = mul(pr, local.r);
  });
  return p;
}

export const rest = world();
export const index = (name: string) => joints.findIndex(joint => joint.name === name);
const head = rest[index("Head")]!, nose = rest[index("mid_J_mug_nose_tip_rowA_0_JNT")]!, leftEye = rest[index("l_J_eye_JNT")]!;
// Face frame from the rest skeleton: forward = head → nose tip, left = toward the character's left eye.
export const fwdSign = Math.sign(nose[2] - head[2]) || 1, leftSign = Math.sign(leftEye[0] - head[0]) || 1;
export const face = (d: Vec3) => ({ left: d[0] * leftSign * 1000, up: d[1] * 1000, fwd: d[2] * fwdSign * 1000 });
/** Each joint's displacement from rest (metres, glTF axes) under a solved pose. */
export const displacement = (pose: SolvedPose) => { const w = world(posedLocals({ joints }, pose)); return w.map((p, i) => [p[0] - rest[i]![0], p[1] - rest[i]![1], p[2] - rest[i]![2]] as Vec3); };
export const len = (d: Vec3) => Math.hypot(...d) * 1000;
/** Only skinned face joints count (`…_JNT`), not helper groups or the skeleton's roots. */
export const counted = joints.map(joint => /_JNT$/.test(joint.name));

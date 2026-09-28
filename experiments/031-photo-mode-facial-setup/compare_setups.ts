/**
 * Experiment 031: the female head's facial setup against the male player setup that photo mode's face rig names (session 4, R1).
 *
 * Reads everything straight from the installed game's base archives with XF Studio's own readers (native archive reader, resource
 * reader, anim-set reader), compares the two setups table by table and pose by pose, then solves the same control vectors with each
 * setup on the female face skeleton (XF Studio's own solver) and measures the joints. Nothing is written except, with `--json <file>`,
 * the numbers (private: game-derived). Run from projects/xf-studio/authoring:
 *
 *   bun ../../../experiments/031-photo-mode-facial-setup/compare_setups.ts [--game <folder>] [--json <out.json>]
 */
import { createHash } from "node:crypto";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { depotHash } from "../../projects/xf-studio/authoring/src/depot-path";
import { NativeArchive } from "../../projects/xf-studio/authoring/src/native/archive-reader";
import { loadGameOodle } from "../../projects/xf-studio/authoring/src/native/oodle";
import { readResource } from "../../projects/xf-studio/authoring/src/native/resource-document";
import { decodeAnimClip, readAnimSetIndex } from "../../projects/xf-studio/authoring/src/native/anim-set";
import { clipControlVector, clipTracksFromKeys } from "../../projects/xf-studio/authoring/src/engines/facial-rig/anim-tracks";
import { compileFacialRig, createFacialPose, solveFace, type CompiledFacialRig } from "../../projects/xf-studio/authoring/src/engines/facial-rig/solver";
import { posedLocals, rigRestFromRed, worldPositions, type Vec3 } from "../../projects/xf-studio/authoring/src/engines/facial-rig/pose";
import { configuredGameRoot } from "../../projects/xf-studio/authoring/tools/configured-game-root";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); return at < 0 ? null : args[at + 1] ?? null; };
const game = flag("--game") ?? configuredGameRoot();
const oodle = loadGameOodle(game);

const PATHS = {
  skeleton: "base\\characters\\head\\player_base_heads\\player_female_average\\h0_000_pwa_c__basehead\\h0_000_pwa_c__basehead_skeleton.rig",
  female: "base\\characters\\head\\player_base_heads\\player_female_average\\h0_000_pwa_c__basehead\\h0_000_pwa_c__basehead_rigsetup.facialsetup",
  male: "base\\characters\\head\\pma\\h0_001_ma_c__player\\h0_001_ma_c__player_rigsetup.facialsetup",
  photoRig: "base\\characters\\head\\player_base_heads\\appearances\\head\\face_rig\\h0_000__basehead_face_rig_photomode.app",
  photoClips: "base\\animations\\ui\\photomode\\photomode_female_facial.anims",
} as const;

// Base-game archives only (content, then ep1): the files as the game ships them.
const archiveDirs = [join(game, "archive", "pc", "content"), join(game, "archive", "pc", "ep1")];
const archives = archiveDirs.flatMap(dir => { try { return readdirSync(dir).filter(n => n.endsWith(".archive")).map(n => join(dir, n)); } catch { return []; } });
const opened = new Map<string, NativeArchive>();
function raw(path: string): { bytes: Uint8Array; archive: string } {
  const hash = depotHash(path);
  for (const file of archives) {
    let archive = opened.get(file);
    if (!archive) { archive = NativeArchive.open(file, oodle.decompress); opened.set(file, archive); }
    const bytes = archive.read(hash);
    if (bytes) return { bytes, archive: file.slice(game.length + 1) };
  }
  throw Error(`${path} is not in the base archives`);
}
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const doc = (path: string) => { const r = raw(path); return { ...r, sha256: sha(r.bytes), document: readResource(r.bytes, oodle.decompress, { buffers: "trim" }).document as any }; };

const skeleton = doc(PATHS.skeleton), female = doc(PATHS.female), male = doc(PATHS.male), photoRig = doc(PATHS.photoRig);
const out: Record<string, unknown> = { sources: Object.fromEntries(Object.entries({ skeleton, female, male, photoRig }).map(([k, v]) => [k, { archive: v.archive, sha256: v.sha256 }])) };
const log = (...parts: unknown[]) => console.log(...parts);
log("sources", JSON.stringify(out.sources, null, 1));

// 1. Which setup does the photo-mode face rig name? (every entAnimatedComponent named face_rig in every appearance)
const hashOf = (ref: any): string => String(ref?.DepotPath?.$value ?? ref?.DepotPath ?? ref?.$value ?? ref ?? "");
const faceRigRefs = new Set<string>();
(function walk(node: any) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(walk); return; }
  if (node.$type === "entAnimatedComponent" && (node.name?.$value ?? node.name) === "face_rig")
    faceRigRefs.add(`setup=${hashOf(node.facialSetup)} rig=${hashOf(node.rig)} graph=${hashOf(node.graph)}`);
  for (const value of Object.values(node)) walk(value);
})(photoRig.document);
const expected = { male: depotHash(PATHS.male), female: depotHash(PATHS.female), skeleton: depotHash(PATHS.skeleton) };
log("photo-mode face_rig components:", [...faceRigRefs], "expected hashes", expected);
out.photoModeFaceRig = { components: [...faceRigRefs], expected };

// 2. Table-by-table comparison of the two setups.
const root = (d: any) => d.Data?.RootChunk ?? d;
const F = root(female.document), M = root(male.document);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const tableReport: Record<string, unknown> = {};
tableReport.info = { same: same(F.info, M.info), useFemaleAnimSet: [F.useFemaleAnimSet, M.useFemaleAnimSet] };
tableReport.faceCorrectiveNames = { same: same(F.faceCorrectiveNames, M.faceCorrectiveNames), count: [F.faceCorrectiveNames?.length, M.faceCorrectiveNames?.length] };
const fb = F.bakedData.Data, mb = M.bakedData.Data;
for (const key of Object.keys(fb)) {
  if (fb[key] && typeof fb[key] === "object" && !Array.isArray(fb[key])) {
    for (const table of Object.keys(fb[key])) {
      const a = fb[key][table], b = mb[key]?.[table];
      const entry: Record<string, unknown> = { same: same(a, b) };
      if (!entry.same && Array.isArray(a) && Array.isArray(b)) {
        entry.lengths = [a.length, b.length];
        const diffs = a.map((row: unknown, i: number) => same(row, b[i]) ? null : i).filter((i: number | null) => i !== null);
        entry.rowsDiffering = diffs.length;
        entry.examples = diffs.slice(0, 4).map((i: number) => ({ i, female: a[i], male: b[i] }));
      }
      tableReport[`${key}.${table}`] = entry;
    }
  } else tableReport[key] = { same: same(fb[key], mb[key]) };
}
out.tables = tableReport;
log("\n== tables (bakedData.Data) that differ");
for (const [k, v] of Object.entries(tableReport)) if (!(v as any).same) log(k, JSON.stringify(v).slice(0, 600));
log("tables identical:", Object.entries(tableReport).filter(([, v]) => (v as any).same).map(([k]) => k).join(", "));

// 3. Pose data: per part, per pose, same joints? largest rotation (deg) and translation (mm) difference.
const quatAngle = (a: any, b: any) => {
  const d = Math.abs((a.i ?? 0) * (b.i ?? 0) + (a.j ?? 0) * (b.j ?? 0) + (a.k ?? 0) * (b.k ?? 0) + (a.r ?? 1) * (b.r ?? 1));
  return 2 * Math.acos(Math.min(1, d)) * 180 / Math.PI;
};
const poseReport: Record<string, unknown> = {};
for (const [buffer, label] of [["mainPosesData", "main"], ["correctivePosesData", "corrective"]] as const) {
  for (const part of ["Face", "Eyes", "Tongue"]) {
    const a = F[buffer].Data[part], b = M[buffer].Data[part];
    let sameJoints = 0, differentJoints = 0, identical = 0, maxRot = 0, maxT = 0;
    const perPose: { i: number; rot: number; t: number }[] = [];
    const ratios: number[] = [];
    a.Poses.forEach((pa: any, i: number) => {
      const pb = b.Poses[i];
      const ta = a.Transforms.slice(pa.TransformIdx, pa.TransformIdx + pa.NumTransforms), tb = b.Transforms.slice(pb.TransformIdx, pb.TransformIdx + pb.NumTransforms);
      const ja = ta.map((t: any) => t.Bone).join(","), jb = tb.map((t: any) => t.Bone).join(",");
      if (ja !== jb) { differentJoints++; return; }
      sameJoints++;
      let rot = 0, tr = 0, magA = 0, magB = 0;
      ta.forEach((x: any, k: number) => {
        const y = tb[k];
        rot = Math.max(rot, quatAngle(x.Rotation, y.Rotation));
        const dx = (x.Translation.X - y.Translation.X), dy = (x.Translation.Y - y.Translation.Y), dz = (x.Translation.Z - y.Translation.Z);
        tr = Math.max(tr, Math.hypot(dx, dy, dz) * 1000);
        magA += Math.hypot(x.Translation.X, x.Translation.Y, x.Translation.Z); magB += Math.hypot(y.Translation.X, y.Translation.Y, y.Translation.Z);
      });
      if (rot < 1e-4 && tr < 1e-4) identical++;
      if (magA > 1e-4) ratios.push(magB / magA);
      maxRot = Math.max(maxRot, rot); maxT = Math.max(maxT, tr);
      perPose.push({ i, rot, t: tr });
    });
    ratios.sort((x, y) => x - y);
    poseReport[`${label}.${part}`] = { poses: [a.Poses.length, b.Poses.length], transforms: [a.Transforms.length, b.Transforms.length], sameJoints, differentJoints,
      identical, maxRotationDeg: +maxRot.toFixed(3), maxTranslationMm: +maxT.toFixed(3),
      translationMagnitudeRatio_maleOverFemale: ratios.length ? { p10: +ratios[Math.floor(ratios.length * .1)]!.toFixed(3), median: +ratios[Math.floor(ratios.length / 2)]!.toFixed(3),
        p90: +ratios[Math.floor(ratios.length * .9)]!.toFixed(3) } : null };
  }
}
out.poses = poseReport;
log("\n== pose data (male against female)"); for (const [k, v] of Object.entries(poseReport)) log(k, JSON.stringify(v));

// 4. Solves on the female skeleton with either setup.
const rigF = compileFacialRig(skeleton.document, female.document), rigM = compileFacialRig(skeleton.document, male.document);
const rest = rigRestFromRed(root(skeleton.document));
const J = rest.joints.map(j => j.name), idx = (name: string) => { const i = J.indexOf(name); if (i < 0) throw Error(name); return i; };
const skinned = J.map(n => /_JNT$/.test(n));
function solveWorld(rig: CompiledFacialRig, controls: Record<string, number>): Vec3[] {
  const v = rig.referenceTracks();
  for (const [k, x] of Object.entries(controls)) { const t = rig.trackIndex(k); if (t < 0) throw Error(`no control ${k}`); v[t] = (v[t] ?? 0) + x; }
  const pose = solveFace(rig, v, createFacialPose(rig));
  return worldPositions(rest, posedLocals(rest, { q: pose.rotations, t: pose.translations }));
}
const restWorld = worldPositions(rest);
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mm = (d: Vec3) => Math.hypot(...d) * 1000;
// Face frame: forward = head -> nose tip; left = toward the character's left eye (glTF axes: y up).
const head = restWorld[idx("Head")]!, nose = restWorld[idx("mid_J_mug_nose_tip_rowA_0_JNT")]!, leftEye = restWorld[idx("l_J_eye_JNT")]!;
const fwdSign = Math.sign(nose[2] - head[2]) || 1, leftSign = Math.sign(leftEye[0] - head[0]) || 1;
const frame = (d: Vec3) => ({ left: +(d[0] * leftSign * 1000).toFixed(2), up: +(d[1] * 1000).toFixed(2), fwd: +(d[2] * fwdSign * 1000).toFixed(2) });

const WATCH = ["r_J_jaw_nosabial_rowA_1_JNT", "r_J_jaw_nosabial_rowB_1_JNT", "r_J_mug_mouth_rowB_3_JNT", "r_J_eye_check_rowD_0_JNT", "r_J_eye_check_rowE_0_JNT",
  "r_J_mug_lip_corner_JNT", "r_J_eye_lid_up_root_JNT"].map(n => J.includes(n) ? n : J.find(x => x.startsWith(n.replace(/_JNT$/, "")))!).filter(Boolean);
const gap = (w: Vec3[]) => mm(sub(w[idx(WATCH[0]!)]!, w[idx(WATCH[1]!)]!));
const restGap = gap(restWorld);

type Row = { name: string; maxDiffMm: number; meanDiffMm: number; maxMoveF: number; maxMoveM: number; gapClose: [number, number];
  malarUp: [number, number]; malarMove: [number, number]; foldUp: [number, number] };
function compare(name: string, controls: Record<string, number>): Row {
  const wf = solveWorld(rigF, controls), wm = solveWorld(rigM, controls);
  let maxDiff = 0, sum = 0, n = 0, maxF = 0, maxM = 0;
  wf.forEach((p, i) => {
    if (!skinned[i]) return;
    const d = mm(sub(p, wm[i]!)); maxDiff = Math.max(maxDiff, d); sum += d; n++;
    maxF = Math.max(maxF, mm(sub(p, restWorld[i]!))); maxM = Math.max(maxM, mm(sub(wm[i]!, restWorld[i]!)));
  });
  const malar = idx(WATCH[3]!), fold = idx(WATCH[0]!);
  const up = (w: Vec3[], j: number) => (w[j]![1] - restWorld[j]![1]) * 1000;
  return { name, maxDiffMm: +maxDiff.toFixed(2), meanDiffMm: +(sum / n).toFixed(3), maxMoveF: +maxF.toFixed(2), maxMoveM: +maxM.toFixed(2),
    gapClose: [+(1 - gap(wf) / restGap).toFixed(3), +(1 - gap(wm) / restGap).toFixed(3)],
    malarUp: [+up(wf, malar).toFixed(2), +up(wm, malar).toFixed(2)], malarMove: [+mm(sub(wf[malar]!, restWorld[malar]!)).toFixed(2), +mm(sub(wm[malar]!, restWorld[malar]!)).toFixed(2)],
    foldUp: [+up(wf, fold).toFixed(2), +up(wm, fold).toFixed(2)] };
}
const vectors: [string, Record<string, number>][] = [
  ["smile corner_up 0.5", { lips_l_corner_up: .5, lips_r_corner_up: .5 }],
  ["smile corner_up 0.7", { lips_l_corner_up: .7, lips_r_corner_up: .7 }],
  ["smile corner_up 1", { lips_l_corner_up: 1, lips_r_corner_up: 1 }],
  ["smile 0.7 + cheek raise 0.5", { lips_l_corner_up: .7, lips_r_corner_up: .7, eye_l_oculi_squint_outer_lower: .5, eye_r_oculi_squint_outer_lower: .5 }],
  ["cheek raise 1", { eye_l_oculi_squint_outer_lower: 1, eye_r_oculi_squint_outer_lower: 1 }],
  ["blink 1", { eye_l_blink: 1, eye_r_blink: 1 }],
  ["jaw open 0.5", { jaw_mid_open: .5 }],
];
// The vanilla female photo-mode expressions (their static control vectors, the way the Studio's start points read them).
const clipsFile = raw(PATHS.photoClips);
const index = readAnimSetIndex(clipsFile.bytes);
for (const info of index.clips) {
  const clip = decodeAnimClip(clipsFile.bytes, info.name, oodle.decompress);
  if (!clip) continue;
  const tracks = clipTracksFromKeys(clip.duration, clip.trackKeys, clip.constTrackKeys);
  const vector = clipControlVector(tracks, clip.animationType ?? "AdditiveFromRefPose", rigF.trackNames, [...rigF.referenceTracks()], rigF.segments.main);
  const controls = (vector as any).controls ?? vector;
  if (Object.keys(controls).length) vectors.push([`clip ${info.name}`, controls as Record<string, number>]);
}
const rows = vectors.map(([name, controls]) => compare(name, controls));
out.solves = { restFoldGapMm: +restGap.toFixed(2), watched: WATCH, rows };
log(`\n== solves on the female skeleton: female setup vs male setup (skinned _JNT joints). rest fold gap ${restGap.toFixed(2)} mm (${WATCH[0]} to ${WATCH[1]})`);
log("name | max diff mm | mean diff mm | max move F / M mm | fold-gap closure F / M | malar up F / M mm | malar move F / M | fold up F / M");
for (const r of rows) log(`${r.name} | ${r.maxDiffMm} | ${r.meanDiffMm} | ${r.maxMoveF} / ${r.maxMoveM} | ${r.gapClose.join(" / ")} | ${r.malarUp.join(" / ")} | ${r.malarMove.join(" / ")} | ${r.foldUp.join(" / ")}`);
const clipRows = rows.filter(r => r.name.startsWith("clip "));
if (clipRows.length) {
  const sorted = [...clipRows].sort((a, b) => a.maxDiffMm - b.maxDiffMm), ratio = clipRows.map(r => r.maxMoveM / r.maxMoveF).sort((a, b) => a - b);
  const summary = { clips: clipRows.length, maxDiffMedianMm: sorted[Math.floor(sorted.length / 2)]!.maxDiffMm, maxDiffLargest: sorted.at(-1),
    moveRatioMaleOverFemale: { min: +ratio[0]!.toFixed(3), median: +ratio[Math.floor(ratio.length / 2)]!.toFixed(3), max: +ratio.at(-1)!.toFixed(3) } };
  out.clipSummary = summary; log("\nclip summary", JSON.stringify(summary));
}
const json = flag("--json");
if (json) writeFileSync(json, JSON.stringify(out, null, 1));

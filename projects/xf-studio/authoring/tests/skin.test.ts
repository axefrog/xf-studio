import { test, expect } from "bun:test";
import * as THREE from "three";
import { extendSkin, restoreFirstWeights } from "../src/skin";
import { derivedCharacterRecords, derivedCharacterTest, derivedPreviewFile, derivedPreviewTest } from "./private-assets";
test("CPU surface picking retains contributions beyond the first four", () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([1, 2, 3], 3));
  for (let i = 0; i < 3; i++) {
    g.setAttribute(
      i ? `joints_${i}` : "skinIndex",
      new THREE.Uint16BufferAttribute([i, 0, 0, 0], 4),
    );
    g.setAttribute(
      i ? `weights_${i}` : "skinWeight",
      new THREE.Float32BufferAttribute([i ? 0.3 : 0.4, 0, 0, 0], 4),
    );
  }
  const mat = new THREE.MeshStandardMaterial(),
    m = new THREE.SkinnedMesh(g, mat);
  const bones = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone()];
  bones[0].position.x = 1;
  bones[1].position.y = 2;
  bones[2].position.z = 3;
  bones.forEach((b) => b.updateMatrixWorld(true));
  m.skeleton = new THREE.Skeleton(
    bones,
    bones.map(() => new THREE.Matrix4()),
  );
  extendSkin(m, mat);
  const p = m.applyBoneTransform(0, new THREE.Vector3(1, 2, 3));
  expect(p.x).toBeCloseTo(1.4, 6);
  expect(p.y).toBeCloseTo(2.6, 6);
  expect(p.z).toBeCloseTo(3.9, 6);
  const q = m.applyBoneTransform(0, new THREE.Vector4(1, 2, 3, 1));
  expect(q.w).toBeCloseTo(1, 6);
  expect(q.x).toBeCloseTo(p.x, 6);
});
/** Every skinned primitive keeps its full (eight-influence) skin, its facial targets, and normalized totals. */
function checkSkinnedGlb(buffer: ArrayBuffer, morphCounts: readonly number[] | null, skinCount?: number, eightInfluences = true) {
  const view = new DataView(buffer), n = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, n))), start = 28 + n;
  const first = restoreFirstWeights(buffer);
  if (skinCount !== undefined) expect(first.size).toBe(skinCount);
  for (const mesh of json.meshes) {
    const p = mesh.primitives[0];
    if (p.attributes.JOINTS_0 === undefined) continue;
    // Morph components carry the facial targets; plain skinned meshes (hair) carry none.
    if (p.targets && morphCounts) expect(morphCounts).toContain(p.targets.length);
    if (eightInfluences || p.attributes.JOINTS_1 !== undefined) {
      expect(p.attributes.JOINTS_1).toBeDefined();
      expect(p.attributes.WEIGHTS_1).toBeDefined();
    }
    const arrays = [];
    for (let k = 0; p.attributes[`WEIGHTS_${k}`] !== undefined; k++) {
      const a = json.accessors[p.attributes[`WEIGHTS_${k}`]], b = json.bufferViews[a.bufferView];
      arrays.push({ count: a.count, offset: start + (b.byteOffset ?? 0) + (a.byteOffset ?? 0), stride: b.byteStride ?? 16 });
    }
    // One assertion per mesh (the worst vertex), not one per vertex: millions of expect() calls made this scan slow under load.
    let worst = 0, at = -1;
    for (let i = 0; i < arrays[0]!.count; i++) {
      let sum = 0;
      for (const a of arrays) for (let k = 0; k < 4; k++) sum += view.getFloat32(a.offset + i * a.stride + k * 4, true);
      if (Math.abs(sum - 1) > worst) { worst = Math.abs(sum - 1); at = i; }
    }
    // toBeCloseTo(1, 5): within half of 1e-5.
    expect(worst, `${mesh.name} vertex ${at} weights sum to 1 ± ${worst}`).toBeLessThan(5e-6);
    expect(first.get(mesh.name)!.length).toBe(arrays[0]!.count * 4);
  }
}

// The head comes from the preview derived from the local game.
derivedPreviewTest("head GLB retains customization morphs, all skin sets and normalized totals", async () => {
  checkSkinnedGlb(await Bun.file(derivedPreviewFile("head.glb")).arrayBuffer(), [105], 2);
});

/**
 * Distinct GLBs checked per slot and morph kind. The local cache grows with every V and creator choice prepared (56 files, 279 MB on
 * the development machine on 26 September 2026), and reading and scanning all of them under a loaded full suite passed the default
 * 5 s timeout; a fixed sample per kind keeps every slot covered at a bounded cost.
 */
const GLBS_PER_KIND = 4;
/**
 * The sample still reads up to ~30 private GLBs (a hair GLB is tens of MB) from disk, cold in a fresh process, and scans every vertex's
 * weights: well under a second when idle, several under a loaded full suite. 30 s leaves room for that without hiding a hang.
 */
const PRIVATE_GLB_TIMEOUT_MS = 30_000;

// Brows, lashes and hair come from resolved character records (exported from the winning archives).
derivedCharacterTest("resolved brow, lash and hair GLBs retain their facial targets, all skin sets and normalized totals", async () => {
  const records = derivedCharacterRecords();
  const slots = new Set<string>();
  // Many V's share a component's GLB: each distinct file (and morph expectation) is checked once, up to GLBS_PER_KIND of each slot
  // and morph kind, the first by path so a run is repeatable.
  const byKind = new Map<string, Map<string, boolean>>();
  for (const { record, file } of records) for (const component of record.components) {
    slots.add(component.slot);
    const path = file(component.geometry.file), morphs = !!component.geometry.morphTargets;
    const kind = `${component.slot}|${morphs}`;
    if (!byKind.has(kind)) byKind.set(kind, new Map());
    byKind.get(kind)!.set(path, morphs);
  }
  const checks = [...byKind.values()].flatMap(files => [...files].sort(([a], [b]) => a.localeCompare(b)).slice(0, GLBS_PER_KIND));
  for (const [path, morphs] of checks)
    // Head decals and lashes carry the head's 105 face targets or the eye component's 21.
    // Some chunks (the eyeball beside the lashes) have four influences only; the export keeps what the game has.
    // Plain skinned meshes (hair) may carry a garment-support shape, which is not a facial target.
    checkSkinnedGlb(await Bun.file(path).arrayBuffer(), morphs ? [105, 21] : null, undefined, false);
  expect(slots.size).toBeGreaterThan(0);
  expect(checks.length).toBeGreaterThan(0);
}, PRIVATE_GLB_TIMEOUT_MS);

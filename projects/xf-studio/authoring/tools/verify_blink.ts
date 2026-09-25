// Offline acceptance check of the game's blink against local derived assets (not a game-fidelity claim).
// Compares the retired synthetic eyelid study with the solved game blink on the real head, eye, plate, brows and lashes:
// how much eyeball stays visible at full closure, the upper/lower lid-margin gap, whether lashes, brows and the makeup
// plate stay on the skin they sit on, and finite vertices. Run from authoring: `bun tools/verify_blink.ts`.
// Writes the asset-free report evidence/game-blink-offline-check.json.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { readdirSync, existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { GameBlink, parseGameBlink } from "../src/game-blink";
import { extendSkin, restoreFirstWeights } from "../src/skin";

const app = resolve(import.meta.dir, "..");
const cache = resolve(app, "data/preview-cache");
const assets = resolve(app, "public/assets");

/** The newest derived core head in the local preview cache. */
export function findCoreHead(): string | null {
  if (!existsSync(cache)) return null;
  const heads = readdirSync(cache).map(name => resolve(cache, name, "assets/head.glb")).filter(existsSync);
  return heads.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}
/** One geometry file per distinct lash and brow component in the cached character records. */
function detailFiles(slot: "lashes" | "brows"): { component: string; file: string }[] {
  const records = resolve(cache, "characters/records"), files = resolve(cache, "characters/files");
  if (!existsSync(records)) return [];
  const found = new Map<string, string>();
  for (const name of readdirSync(records).sort()) {
    const record = JSON.parse(readFileSync(resolve(records, name), "utf8"));
    for (const component of record.components ?? []) if (component.slot === slot && !found.has(component.component)) {
      const file = resolve(files, component.geometry.file);
      if (existsSync(file)) found.set(component.component, file);
    }
  }
  return [...found].map(([component, file]) => ({ component, file }));
}
export const blinkAssetsPresent = () => !!findCoreHead() && existsSync(resolve(assets, "game-blink.glb"));

const parse = async (file: string) => {
  const bytes = readFileSync(file);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return { gltf: await new GLTFLoader().parseAsync(buffer.slice(0), ""), buffer };
};
/** A detail or head scene with the exported first weight set restored and eight-influence CPU skinning. */
async function skinnedScene(file: string) {
  const { gltf, buffer } = await parse(file);
  const weights = restoreFirstWeights(buffer);
  const meshes: THREE.SkinnedMesh[] = [], bones: THREE.Bone[] = [];
  gltf.scene.traverse(o => {
    if (o instanceof THREE.Bone) bones.push(o);
    if (o instanceof THREE.SkinnedMesh) {
      const name = gltf.parser.json.meshes[gltf.parser.associations.get(o)?.meshes ?? -1]?.name;
      const raw = weights.get(name);
      if (raw) o.geometry.setAttribute("skinWeight", new THREE.BufferAttribute(raw, 4));
      extendSkin(o, o.material as THREE.MeshStandardMaterial); meshes.push(o);
    }
  });
  return { scene: gltf.scene, meshes, bones, all: [] as THREE.Mesh[] };
}

/** The retired synthetic study, verbatim: translations of the core head's lid bones by hand-picked distances. */
function syntheticStudy(root: THREE.Object3D) {
  const bones: { bone: THREE.Bone; base: THREE.Vector3; delta: THREE.Vector3 }[] = [];
  root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!(o instanceof THREE.Bone) || !/eye_lid_(?:lashes_)?(up|dn)_row/.test(o.name)) return;
    const up = o.name.includes("_up_"), row = o.name.match(/row([A-D])/)?.[1] ?? "A";
    const world = o.getWorldPosition(new THREE.Vector3());
    const x = Math.abs(world.x), edge = Math.max(0, 1 - Math.abs((x - 0.032) / 0.023));
    const strength = ({ A: 1, B: 0.75, C: 0.55, D: 0.3 } as Record<string, number>)[row]!;
    const delta = new THREE.Vector3(0, (up ? -0.0095 : 0.003) * edge * strength, -0.001 * edge * strength);
    const inv = o.parent!.matrixWorld.clone().invert();
    delta.add(world).applyMatrix4(inv).sub(world.clone().applyMatrix4(inv));
    bones.push({ bone: o, base: o.position.clone(), delta });
  });
  return (value: number) => { for (const b of bones) b.bone.position.copy(b.base).addScaledVector(b.delta, value); };
}

const dominantBone = (mesh: THREE.SkinnedMesh, i: number) => {
  const index = mesh.geometry.getAttribute("skinIndex"), weight = mesh.geometry.getAttribute("skinWeight");
  let best = 0, bone = -1;
  for (let k = 0; k < 4; k++) if (weight.getComponent(i, k) > best) { best = weight.getComponent(i, k); bone = index.getComponent(i, k); }
  return mesh.skeleton.bones[bone]?.name ?? "";
};
const positions = (mesh: THREE.Mesh) => Array.from({ length: mesh.geometry.getAttribute("position").count }, (_, i) =>
  mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));

export async function measureBlink(shapes = ["neutral", "h011_eyes", "h091_eyes", "h211_eyes"]) {
  const headFile = findCoreHead();
  if (!headFile) throw Error("No derived core head in data/preview-cache");
  const head = await skinnedScene(headFile);
  const headMesh = head.meshes.find(m => m.name === "head")!, plate = head.meshes.find(m => m.name === "makeup_plate")!;
  let eyes!: THREE.Mesh; head.scene.traverse(o => { if (o instanceof THREE.Mesh && o.name === "eyes") eyes = o; });
  const lashes = await Promise.all(detailFiles("lashes").map(async entry => ({ ...entry, ...(await skinnedScene(entry.file)) })));
  const brows = await Promise.all(detailFiles("brows").slice(0, 1).map(async entry => ({ ...entry, ...(await skinnedScene(entry.file)) })));
  const world = new THREE.Group();
  world.add(head.scene, ...lashes.map(l => l.scene), ...brows.map(b => b.scene));
  world.updateMatrixWorld(true);
  const blinkGltf = (await parse(process.env.XFS_BLINK_ASSET ?? resolve(assets, "game-blink.glb"))).gltf;
  const clips = parseGameBlink(blinkGltf.asset?.extras, blinkGltf.animations);
  const blink = new GameBlink(blinkGltf.scene, clips, head.bones);
  blink.attach([...lashes, ...brows].flatMap(d => d.bones));
  const synthetic = syntheticStudy(head.scene);
  const detailMeshes = [...lashes, ...brows].flatMap(d => d.meshes);
  const originals = [...head.bones, ...lashes.flatMap(l => l.bones), ...brows.flatMap(b => b.bones)].map(b => b.matrixWorld.clone());

  // Lid margins: head vertices whose strongest influence is an upper or lower rowA lid bone, per side.
  const margin = (side: "l" | "r", lid: "up" | "dn") => {
    const pattern = new RegExp(`^${side}_J_eye_lid_${lid}_rowA_\\d_JNT$`);
    return Array.from({ length: headMesh.geometry.getAttribute("position").count }, (_, i) => i).filter(i => pattern.test(dominantBone(headMesh, i)));
  };
  const margins = { l: { up: margin("l", "up"), dn: margin("l", "dn") }, r: { up: margin("r", "up"), dn: margin("r", "dn") } };
  // Eye-opening ray grid per side: the box of that side's lid bones, 0.25 mm apart, cast along the face's view (+z).
  const grids = (["l", "r"] as const).map(side => {
    const box = new THREE.Box3();
    for (const b of head.bones) if (b.name.startsWith(`${side}_J_eye_lid_`)) box.expandByPoint(b.getWorldPosition(new THREE.Vector3()));
    return { side, box: box.expandByScalar(0.004) };
  });
  const cell = 0.00025;
  // Upper lash roots: vertices bound to the upper lid that start within 1 mm of the head (the tips rotate away from any anchor).
  const upperLashes = (mesh: THREE.SkinnedMesh) => {
    const headRest = positions(headMesh), rest = positions(mesh);
    return rest.map((_, i) => i).filter(i => /eye_lid_(lashes_)?up_/.test(dominantBone(mesh, i)) &&
      headRest.some(p => p.distanceToSquared(rest[i]!) < 1e-6));
  };

  function exposed() {
    const out: Record<string, number> = {};
    const region = new THREE.Box3().union(grids[0]!.box).union(grids[1]!.box);
    const staticMesh = (mesh: THREE.Mesh) => {
      const index = mesh.geometry.index!, points = positions(mesh), kept: number[] = [];
      for (let t = 0; t < index.count; t += 3) {
        const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
        if ([a, b, c].some(v => region.containsPoint(points[v]!))) kept.push(a, b, c);
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points); geometry.setIndex(kept);
      return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    };
    const skin = staticMesh(headMesh), eye = staticMesh(eyes), makeup = staticMesh(plate);
    const ray = new THREE.Raycaster();
    for (const { side, box } of grids) {
      let hits = 0, plateSeen = 0, plateHidden = 0;
      for (let x = box.min.x; x <= box.max.x; x += cell) for (let y = box.min.y; y <= box.max.y; y += cell) {
        ray.set(new THREE.Vector3(x, y, -1), new THREE.Vector3(0, 0, 1));
        const first = ray.intersectObjects([skin, eye], false)[0];
        if (first?.object === eye) hits++;
        // The makeup plate is the head's own surface: where it lies along a ray it should be the first surface met.
        const onPlate = ray.intersectObject(makeup, false)[0];
        if (onPlate) { plateSeen++; if (first && first.distance < onPlate.distance - 5e-5) plateHidden++; }
      }
      out[side] = hits; out[`${side}PlateHidden`] = plateSeen ? plateHidden / plateSeen : 0;
    }
    return out;
  }
  function gap() {
    const points = positions(headMesh), out: Record<string, { medianMm: number; maxMm: number; crossingMm: number }> = {};
    for (const side of ["l", "r"] as const) {
      const lower = margins[side].dn.map(i => points[i]!);
      const distances = margins[side].up.map(i => {
        let best = Infinity, dy = 0;
        for (const p of lower) { const d = p.distanceTo(points[i]!); if (d < best) { best = d; dy = points[i]!.y - p.y; } }
        return { d: best, dy };
      });
      const sorted = distances.map(d => d.d).sort((a, b) => a - b);
      out[side] = { medianMm: sorted[sorted.length >> 1]! * 1000, maxMm: sorted.at(-1)! * 1000,
        // How far an upper-margin vertex ends up below its nearest lower-margin vertex (0 means none crossed).
        crossingMm: Math.max(0, ...distances.map(d => -d.dy)) * 1000 };
    }
    return out;
  }
  // Attachment: each detail vertex keeps its rest offset to its nearest head vertex; report how far that offset drifts.
  const anchors = (meshes: THREE.Mesh[], only?: (mesh: THREE.SkinnedMesh) => number[]) => {
    const headRest = positions(headMesh);
    return meshes.map(mesh => {
      const rest = positions(mesh), picks = only ? only(mesh as THREE.SkinnedMesh) : rest.map((_, i) => i);
      return { mesh, picks: picks.map(i => {
        let best = 0, distance = Infinity;
        headRest.forEach((p, k) => { const d = p.distanceToSquared(rest[i]!); if (d < distance) { distance = d; best = k; } });
        return { i, anchor: best, offset: rest[i]!.clone().sub(headRest[best]!) };
      }) };
    });
  };
  const drift = (sets: ReturnType<typeof anchors>) => {
    const headPoints = positions(headMesh);
    let max = 0; const all: number[] = [];
    for (const { mesh, picks } of sets) {
      const points = positions(mesh);
      for (const { i, anchor, offset } of picks) {
        const d = points[i]!.clone().sub(headPoints[anchor]!).sub(offset).length();
        max = Math.max(max, d); all.push(d);
      }
    }
    all.sort((a, b) => a - b);
    return { vertices: all.length, medianMm: (all[all.length >> 1] ?? 0) * 1000, maxMm: max * 1000 };
  };
  const finite = () => [headMesh, plate, eyes, ...detailMeshes].every(mesh => positions(mesh).every(p => p.toArray().every(Number.isFinite)));

  const allMeshes = [headMesh, plate, eyes, ...detailMeshes];
  const report: Record<string, unknown> = {};
  let nonFinite = 0;
  for (const shape of shapes) {
    for (const mesh of allMeshes) for (const [name, index] of Object.entries(mesh.morphTargetDictionary ?? {}))
      mesh.morphTargetInfluences![index] = name === shape ? 1 : 0;
    blink.setClosure(0); synthetic(0); world.updateMatrixWorld(true);
    const lashAnchors = lashes.map(l => ({ component: l.component, sets: anchors(l.meshes, upperLashes) }));
    const browAnchors = anchors(brows.flatMap(b => b.meshes));
    const plateAnchors = anchors([plate]);
    const open = exposed();
    const measure = (label: string, seen = exposed()) => ({
      exposedEyeballMm2: Object.fromEntries(["l", "r"].map(side => [side, +(seen[side]! * cell * cell * 1e6).toFixed(3)])),
      exposedFraction: Object.fromEntries(["l", "r"].map(side => [side, +(seen[side]! / open[side]!).toFixed(4)])),
      // Share of the makeup plate's front view covered by other head skin (a fold over the lid).
      plateHiddenFraction: Object.fromEntries(["l", "r"].map(side => [side, +seen[`${side}PlateHidden`]!.toFixed(4)])),
      lidGap: gap(),
      upperLashRootDrift: Object.fromEntries(lashAnchors.map(({ component, sets }) => [component, drift(sets)])),
      browDrift: drift(browAnchors), plateDrift: drift(plateAnchors), label,
    });
    const result: Record<string, unknown> = { openExposedCells: open };
    synthetic(1); world.updateMatrixWorld(true); result.synthetic = measure("retired synthetic study at 100%"); synthetic(0);
    const target = shape === "neutral" ? null : shape.replace(/_eyes$/, "");
    if (target) {
      // The same solved pose turning about the base eye centre (before the eye shape's joint binds were applied).
      blink.setShape(null); blink.setClosure(1); world.updateMatrixWorld(true);
      result.solved100BaseSeat = measure("solved game closure at 100%, rig on the base eye centre");
      blink.setClosure(0);
    }
    blink.setShape(target);
    if (blink.shape !== target) throw Error(`The blink has no binds for ${shape}`);
    for (const value of [0.5, 1]) {
      blink.setClosure(value); world.updateMatrixWorld(true);
      if (!finite()) nonFinite++;
      result[`solved${value * 100}`] = measure(`solved game closure at ${value * 100}%${target ? ", rig on the shape's joint binds" : ""}`);
    }
    blink.setClosure(0);
    report[shape] = result;
  }
  // Play blink: every clip frame finite, and the clip's peak closes like the held pose.
  blink.setPlaying(true);
  for (let t = 0; t <= blink.repeatSeconds + 0.1; t += 1 / 60) { blink.update(1 / 60); world.updateMatrixWorld(true); if (!finite()) nonFinite++; }
  blink.setPlaying(false); blink.setClosure(0); world.updateMatrixWorld(true);
  const all = [...head.bones, ...lashes.flatMap(l => l.bones), ...brows.flatMap(b => b.bones)];
  const restoreError = Math.max(...all.flatMap((b, i) => b.matrixWorld.elements.map((v, j) => Math.abs(v - originals[i]!.elements[j]!))));
  return { headFile: headFile.split(/[\\/]/).slice(-3).join("/"), lashComponents: lashes.map(l => l.component), browComponents: brows.map(b => b.component),
    mappedBones: blink.bindings.length, unmapped: blink.unmapped.length, margins: { l: { up: margins.l.up.length, dn: margins.l.dn.length }, r: { up: margins.r.up.length, dn: margins.r.dn.length } },
    shapes: report, nonFiniteSamples: nonFinite, restoreError, gridCellMm: cell * 1000,
    limitations: ["Offline CPU skinning of local derived assets; the browser's GPU skinning uses the same bones and eight influences.",
      "Neutral and three eye shapes only; exposed eyeball is measured along the front view only.",
      "Detail attachment is measured against the nearest core-head vertex at rest; it is not an intersection proof.",
      "Not in-game evidence: no game graph, timing or rendering parity."] };
}

if (import.meta.main) {
  const result = await measureBlink();
  writeFileSync(process.env.XFS_BLINK_REPORT ?? resolve(app, "evidence/game-blink-offline-check.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
}

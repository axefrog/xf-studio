/**
 * Morph-target textures made ahead in steps and handed to Three (src/platform/scene/morph-textures.ts; profiles phase 4a-vi, experiment 043
 * §13), on a real Three r186 renderer (with the Studio's patch, patches/three@0.186.0.patch) over a recording context: each renderer exposes
 * its own morph textures, the texture made ahead is the one Three would make, byte for byte, its steps stay small, the draw that follows
 * builds nothing, and two renderers drawing one geometry never share an entry.
 */
import { expect, test } from "bun:test";
import * as THREE from "three";
import { recordingRenderer } from "./fixtures/recording-gl";
import { morphGeometry, morphTextures, morphTextureSteps } from "../src/platform/scene/morph-textures";
import { endContextGeneration, beginContextGeneration } from "../src/platform/scene/context-generation";

/** A morph geometry: `vertices` vertices and `targets` targets of position and normal deltas, every value distinct. */
function morphed(vertices: number, targets: number, normals = true) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(vertices * 3).map((_, i) => i * 1e-3), 3));
  const deltas = (seed: number) => new THREE.Float32BufferAttribute(new Float32Array(vertices * 3).map((_, i) => Math.sin(seed * 31 + i)), 3);
  geometry.morphAttributes.position = Array.from({ length: targets }, (_, t) => deltas(t));
  if (normals) geometry.morphAttributes.normal = Array.from({ length: targets }, (_, t) => deltas(t + 1000));
  return geometry;
}
/** A mesh drawing `geometry` in a scene of its own. */
function meshOf(geometry: THREE.BufferGeometry) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.updateMorphTargets();
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return { mesh, scene };
}
/** Draw `geometry` once (Three's morph update runs at the draw). */
function draw(recording: ReturnType<typeof recordingRenderer>, geometry: THREE.BufferGeometry) {
  const { mesh, scene } = meshOf(geometry);
  recording.renderer.render(scene, recording.camera);
  return mesh;
}
/** Run `steps` to the end, with a clock that moves `tick` ms per fill, recording each step's uploads. */
function run(steps: NonNullable<ReturnType<typeof morphTextureSteps>>, recording: ReturnType<typeof recordingRenderer>) {
  const perStep: number[] = [];
  for (let done = false, guard = 0; !done && guard < 10_000; guard++) {
    const before = recording.volumes.length;
    done = steps.step();
    perStep.push(recording.volumes.length - before);
  }
  return perStep;
}

test("each renderer exposes its context's morph textures (the patch); nothing is made ahead for a geometry it holds, and its first texture is made ahead too", () => {
  const recording = recordingRenderer(), renderer = recording.renderer;
  const map = morphTextures(renderer)!;
  expect(map).toBeDefined();
  // Nothing drawn yet: the first morph geometry on a renderer is made ahead like any other (the first load no longer pays Three's build).
  const first = morphed(8, 2), steps = morphTextureSteps(renderer, first)!;
  expect(steps).toBeDefined();
  run(steps, recording);
  expect(map.get(first)).toMatchObject({ count: 2, texture: { isDataArrayTexture: true } });
  // The renderer holds this one now; a mesh without morphs has none to make.
  expect(morphTextureSteps(renderer, first)).toBeUndefined();
  expect(morphGeometry(new THREE.Mesh(new THREE.BoxGeometry()))).toBeUndefined();
  // A lost context ends what is made for it: steps begun before the loss hand nothing over.
  const lost = morphed(8, 2), losing = morphTextureSteps(renderer, lost)!;
  losing.step();
  endContextGeneration(renderer);
  expect(losing.step()).toBe(true);
  expect(map.get(lost)).toBeUndefined();
  beginContextGeneration(renderer);
});

test("made ahead, in small steps, the texture is the one Three makes, byte for byte, and the draw that follows builds nothing", () => {
  const recording = recordingRenderer(), renderer = recording.renderer;
  // Three's own build of one geometry, and ours of its twin.
  const theirs = morphed(300, 12), ours = morphed(300, 12);
  draw(recording, theirs);
  const map = morphTextures(renderer)!, three = map.get(theirs)!;
  let clock = 0;
  // A clock that moves 1 ms per read: a fill step stops once its 3 ms are used. Uploads in chunks of 4 layers. (This context's largest
  // texture is 16 texels wide, so the 600 texels of a layer wrap into rows, as Three wraps them.)
  const layerBytes = three.size.x * three.size.y * 4 * 4;
  const steps = morphTextureSteps(renderer, ours, { now: () => clock++, budget: 3, chunk: layerBytes * 4 })!;
  const before = recording.volumes.length;
  const perStep = run(steps, recording);
  const made = map.get(ours)!;
  expect(made.count).toBe(12);
  expect([made.size.x, made.size.y]).toEqual([three.size.x, three.size.y]);
  expect([made.texture.image.width, made.texture.image.height, made.texture.image.depth]).toEqual([16, 38, 12]);
  expect([three.texture.image.width, three.texture.image.height, three.texture.image.depth]).toEqual([16, 38, 12]);
  expect(made.texture.type).toBe(THREE.FloatType);
  expect(Array.from(made.texture.image.data as Float32Array)).toEqual(Array.from(three.texture.image.data as Float32Array));
  // Storage once, then the layers a few at a time (none twice, none missed), never the whole volume in one call.
  const uploads = recording.volumes.slice(before);
  expect(uploads.filter(item => item.call === "texStorage3D")).toEqual([{ call: "texStorage3D", width: 16, height: 38, layer: 0, depth: 12 }]);
  const layers = uploads.filter(item => item.call === "texSubImage3D");
  expect(layers.every(item => item.depth === 1)).toBe(true);
  expect(layers.map(item => item.layer).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i));
  expect(Math.max(...perStep)).toBeLessThanOrEqual(1 + 4);
  expect(perStep.length).toBeGreaterThan(4);
  // The draw finds it ready: Three keeps our entry, makes no texture and uploads nothing more.
  const after = recording.volumes.length;
  draw(recording, ours);
  expect(map.get(ours)).toBe(made);
  expect(recording.volumes.length).toBe(after);
  // It goes with its geometry, as Three's does.
  let disposed = false;
  made.texture.addEventListener("dispose", () => { disposed = true; });
  ours.dispose();
  expect(disposed).toBe(true);
  expect(map.get(ours)).toBeUndefined();
});

test("a preparation stopped part-way frees its texture; one Three made meanwhile, or a lost context, ends the steps without handing anything over", () => {
  const recording = recordingRenderer(), renderer = recording.renderer;
  const map = morphTextures(renderer)!;
  // Stopped after the first steps.
  const stopped = morphed(50, 6), steps = morphTextureSteps(renderer, stopped, { chunk: 1 })!;
  steps.step(); steps.step(); steps.step();
  let freed = 0;
  // The texture is the steps' own: its disposal is seen through Three's `dispose`.
  const dispose = THREE.Texture.prototype.dispose;
  THREE.Texture.prototype.dispose = function (this: THREE.Texture) { freed++; return dispose.call(this); };
  try { steps.dispose(); } finally { THREE.Texture.prototype.dispose = dispose; }
  expect(freed).toBe(1);
  expect(map.get(stopped)).toBeUndefined();
  // Three drew it meanwhile: its own entry stays.
  const raced = morphed(50, 6), racing = morphTextureSteps(renderer, raced)!;
  racing.step();
  draw(recording, raced);
  const own = map.get(raced);
  expect(racing.step()).toBe(true);
  expect(map.get(raced)).toBe(own);
  // The context lost part-way: nothing handed over.
  const lost = morphed(50, 6), losing = morphTextureSteps(renderer, lost)!;
  losing.step();
  endContextGeneration(renderer);
  expect(losing.step()).toBe(true);
  expect(map.get(lost)).toBeUndefined();
  beginContextGeneration(renderer);
});

test("two renderers drawing one geometry keep their own entries: one drawing it inside the other's draw, and a texture made ahead through one", () => {
  const a = recordingRenderer(), b = recordingRenderer();
  const shared = morphed(40, 3);
  // B draws the geometry inside A's draw of it (re-entrancy, Sol's reproduction): each builds and keeps its own.
  const { mesh, scene } = meshOf(shared);
  const inner = meshOf(shared);
  mesh.onBeforeRender = () => { b.renderer.render(inner.scene, b.camera); };
  a.renderer.render(scene, a.camera);
  const ofA = morphTextures(a.renderer)!, ofB = morphTextures(b.renderer)!;
  expect(ofA).not.toBe(ofB);
  expect(ofA.get(shared)).toBeDefined();
  expect(ofB.get(shared)).toBeDefined();
  expect(ofA.get(shared)!.texture).not.toBe(ofB.get(shared)!.texture);
  // Made ahead through A, with B drawing the geometry between its steps: it goes into A's textures only, and neither draw builds again.
  const twin = morphed(40, 3), steps = morphTextureSteps(a.renderer, twin, { chunk: 1 })!;
  const twinOnB = meshOf(twin);
  steps.step();
  b.renderer.render(twinOnB.scene, b.camera);
  const onB = ofB.get(twin);
  expect(onB).toBeDefined();
  run(steps, a);
  const made = ofA.get(twin)!;
  expect(made).toBeDefined();
  expect(made.texture).not.toBe(onB!.texture);
  expect(ofB.get(twin)).toBe(onB);
  const uploads = a.volumes.length;
  draw(a, twin);
  expect(ofA.get(twin)).toBe(made);
  expect(a.volumes.length).toBe(uploads);
});

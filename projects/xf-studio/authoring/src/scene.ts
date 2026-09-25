import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { extendSkin, restoreFirstWeights, skinSets } from "./skin";
import type { SavedV } from "./save-reader";
import { createMakeupStack } from "./makeup-stack";
import { IdleAnimation } from "./idle-animation";
import type { CameraState } from "./workspace-state";
import { previewClipPlanes } from "./camera-depth";
import { frontCameraDistance, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE, surfaceAnchoredDistance } from "./camera-framing";
import { prepareEyeAppearances } from "./eye-appearance";
import { eyeRoughnessMap } from "./eye-optics";
import type { ProfileEncoding } from "./hair-colour-model";
import { chunkEnabled, parsePiercingManifest, piercingPartColor, savedPiercing, verifyPiercingBytes, type PiercingManifest } from "./piercing-preview";
import { sampleUnderlayAlbedo } from "./brow-material";
import type { AdapterContext } from "./character-material-adapters";
import type { LoadedCharacterComponent, LoadedCharacterDetails } from "./character-detail-loader";
import type { DetailSlot } from "./render-detail";
import { compareHeadSurfaces, type HeadSurface } from "./head-surface";
import type { SkinImage } from "./skin-material";
import { retainedViewportAspect, visibleViewportSize } from "./viewport-attachment";
import { loadCoreDetail, type LoadedCoreDetail } from "./core-detail-loader";
import { HeadLoadError } from "./head-load-error";
import { faceMorphChoiceIndex, faceMorphChoices, faceMorphWeights, followsFaceMorphChoices, type FaceMorphChoice } from "./face-morphs";
import { createViewportBackdrop } from "./viewport-backdrop";
import { attachHeadCameraInput } from "./head-camera-input";
import type { StageTheme } from "./stage-backdrop";

/** A mesh's morph target names in influence order (GLTFLoader keys the dictionary by `extras.targetNames`). */
function morphTargetNames(mesh: THREE.Mesh): string[] {
  const names: string[] = [];
  for (const [name, index] of Object.entries(mesh.morphTargetDictionary ?? {})) names[index] = name;
  return names;
}

/** A buffer attribute's values in vertex order (interleaved attributes included). */
function attributeValues(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): ArrayLike<number> {
  if (!(attribute instanceof THREE.InterleavedBufferAttribute)) return attribute.array;
  const out = new Float32Array(attribute.count * attribute.itemSize);
  for (let i = 0; i < attribute.count; i++) for (let k = 0; k < attribute.itemSize; k++) out[i * attribute.itemSize + k] = attribute.getComponent(i, k);
  return out;
}
/** The drawn surface of a head mesh, for comparing two exports of it (head-surface.ts). */
function headSurface(mesh: THREE.Mesh): HeadSurface {
  const geometry = mesh.geometry, uv = geometry.getAttribute("uv");
  return { positions: attributeValues(geometry.getAttribute("position")), uvs: uv ? attributeValues(uv) : null, index: geometry.index?.array ?? null,
    morphNames: morphTargetNames(mesh), morphPositions: (geometry.morphAttributes.position ?? []).map(attributeValues) };
}

/**
 * Creates the 3D head scene in `host`. A failure at any point after the renderer exists releases
 * what was made so far (WebGL context, canvas, stage and observers), so a retry starts clean; the
 * returned scene's `dispose()` releases the same resources when the head is unloaded (PREV-20).
 */
export async function createScene(
  host: HTMLElement,
  canvases: HTMLCanvasElement[],
  stage: StageTheme = "dark",
) {
  const releases: (() => void)[] = [];
  try { return await assembleScene(host, canvases, stage, releases); }
  catch (error) { releaseAll(releases); throw error; }
}

/** Runs each release once, newest first; teardown is best effort. */
function releaseAll(releases: (() => void)[]) {
  for (const release of releases.splice(0).reverse()) {
    try { release(); } catch { /* Best effort: the rest still run. */ }
  }
}

async function assembleScene(
  host: HTMLElement,
  canvases: HTMLCanvasElement[],
  stage: StageTheme,
  releases: (() => void)[],
) {
  // Opaque canvas: the stage is drawn in the scene (viewport-backdrop.ts), and the drawing buffer
  // has no alpha channel, so fragments that write alpha below one (alpha-to-coverage hair, decals)
  // cannot reveal the page behind the canvas. Three always requests an alpha channel for its own
  // context (its `alpha: false` only clears alpha to one), so the context is created here.
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", {
    alpha: false, antialias: true, depth: true, stencil: false, preserveDrawingBuffer: true,
  });
  if (!context) throw new HeadLoadError("webgl_unavailable", "WebGL 2 is unavailable");
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, preserveDrawingBuffer: true }); }
  catch (error) { throw new HeadLoadError("webgl_unavailable", "WebGL 2 could not start", { cause: error }); }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x14181c, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  host.prepend(renderer.domElement);
  releases.push(() => { renderer.setAnimationLoop(null); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); });
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(30, 1, 0.005, 10);
  const backdrop = createViewportBackdrop(scene, stage);
  releases.push(() => backdrop.dispose());
  const controls = new OrbitControls(camera, renderer.domElement);
  // The binding catalogue, not the controls' default mouse/touch mapping, decides every press.
  const cameraInput = attachHeadCameraInput(renderer.domElement, controls);
  releases.push(() => { cameraInput.dispose(); controls.dispose(); });
  controls.enableDamping = true;
  controls.minDistance = MIN_CAMERA_DISTANCE;
  controls.maxDistance = MAX_CAMERA_DISTANCE;
  // OrbitControls leaves an inline `cursor: auto`; the presentation owns viewport cursors (`[data-cursor]`).
  renderer.domElement.style.cursor = "";
  const idleFrameOffset = new THREE.Vector3();
  let frontPending = false;
  function front() {
    frontPending = !visibleViewportSize(host.clientWidth, host.clientHeight);
    const requested = frontCameraDistance(camera.fov,
      retainedViewportAspect(host.clientWidth, host.clientHeight, camera.aspect));
    const distance = Math.min(MAX_CAMERA_DISTANCE - .005, requested);
    camera.position.set(0, 1.67, -distance);
    controls.target.set(0, 1.67, 0.005);
    camera.position.add(idleFrameOffset);
    controls.target.add(idleFrameOffset);
    controls.update();
    return requested > distance;
  }
  front();
  const pmrem = new THREE.PMREMGenerator(renderer),
    room = new RoomEnvironment(),
    env = pmrem.fromScene(room, 0.04);
  scene.environment = env.texture;
  releases.push(() => env.dispose());
  pmrem.dispose();
  room.dispose();
  const key = new THREE.DirectionalLight(0xfff2e9, 2.5);
  key.position.set(-0.3, 1.9, -0.5);
  key.target.position.set(0, 1.67, 0);
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xc6dafa, 1);
  fill.position.set(0.4, 1.65, -0.2);
  fill.target.position.set(0, 1.67, 0);
  scene.add(fill, fill.target);
  // The core head, plate, eyes and maps load through one typed render record (see core-detail-loader).
  const core: LoadedCoreDetail = await loadCoreDetail(renderer);
  const { gltf, meshes, head, plate } = core;
  let eyes = core.eyes;
  scene.add(gltf.scene);
  const coreDetail = { identity: core.record.identity, origin: core.record.origin, label: core.record.provenance.label };
  const loader = new THREE.TextureLoader();
  const { "head.albedo": albedo, "eyes.albedo": eyeColor, "head.normal": normal, "head.roughness": roughness } = core.textures;
  const skin = new THREE.MeshStandardMaterial({
    map: albedo,
    roughness: 0.85,
    roughnessMap: roughness,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.35, -0.35),
  });
  head.material = skin;
  extendSkin(head, skin);
  // The game's eye UV0 spans several tiles (the texture repeats across the eyeball), so every
  // eye texture repeats. Older prepared eyes were folded into one tile, where this is a no-op.
  const repeatEyeTexture = (t: THREE.Texture) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t; };
  repeatEyeTexture(eyeColor);
  const eyeMat = new THREE.MeshStandardMaterial({
    map: eyeColor,
    roughness: 0.18,
  });
  eyes.material = eyeMat;
  if (eyes instanceof THREE.SkinnedMesh) extendSkin(eyes, eyeMat);
  const eyeAppearances = await prepareEyeAppearances(async (bytes, entry, role) => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
    try {
      const t = await loader.loadAsync(url);
      const dimensions = role === "roughness" ? entry.roughness! : entry;
      if (t.image.width !== dimensions.width || t.image.height !== dimensions.height) {
        t.dispose(); throw Error("Local eye image dimensions do not match its manifest");
      }
      if (role === "roughness") {
        const map = repeatEyeTexture(eyeRoughnessMap(t.image as HTMLImageElement, renderer.capabilities.getMaxAnisotropy()));
        t.dispose();
        return map;
      }
      // Eye UV0 addresses the texture directly (repeating across tiles). Do not crop/translate it.
      repeatEyeTexture(t);
      t.flipY = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      t.name = entry.label;
      return t;
    } finally { URL.revokeObjectURL(url); }
  });
  let selectedEye = eyeAppearances.select();
  let eyeAppearanceStatus = selectedEye.status;
  let eyeOpticsEnabled = false;
  function applyEyeMaterial() {
    eyeMat.map = selectedEye.texture ?? eyeColor;
    eyeMat.roughnessMap = eyeOpticsEnabled ? selectedEye.roughness ?? null : null;
    eyeMat.roughness = eyeMat.roughnessMap ? selectedEye.status.asset!.roughness!.scale : 0.18;
    eyeMat.needsUpdate = true;
    eyeAppearanceStatus = selectedEye.status;
  }
  function setEyeOptics(enabled: boolean) { eyeOpticsEnabled = enabled; applyEyeMaterial(); }
  function eyeAppearance() {
    const map = eyeMat.map, reference = map === eyeColor;
    const image = map?.image as HTMLImageElement | undefined;
    return { ...eyeAppearanceStatus,
      activeTexture: { url: reference ? "/assets/eye-color.png" : eyeAppearanceStatus.asset?.url,
        sha256: reference ? undefined : eyeAppearanceStatus.asset?.sha256,
        width: image?.width, height: image?.height, flipY: map?.flipY, colorSpace: map?.colorSpace },
      material: { transparent: eyeMat.transparent, depthWrite: eyeMat.depthWrite, alphaTest: eyeMat.alphaTest,
        normalMap: !!eyeMat.normalMap, roughnessMap: !!eyeMat.roughnessMap, roughnessScale: eyeMat.roughness },
      optics: { requested: eyeOpticsEnabled, active: !!eyeMat.roughnessMap,
        ...(selectedEye.roughnessError ? { error: selectedEye.roughnessError } : {}),
        reason: !eyeOpticsEnabled ? "off" : eyeMat.roughnessMap ? "source-roughness-r" :
          selectedEye.roughnessError ? "unavailable" : "no-matching-optics" },
    };
  }
  // Profile stops are decoded from sRGB before the shader's overlay (see
  // knowledge/hair-shading.md). One explicit choice for hair and lashes.
  const profileEncoding: ProfileEncoding = "srgb-decoded";
  let browUnderlay: { maxMatchedDistance: number; unmatched: number; source: "resolved-skin" | "core-albedo" } | undefined;
  /** Skin colour under a decal: the resolved skin's toned base colour when it loaded, else the core head's albedo. */
  function browUnderlayAttribute(brow: THREE.Mesh, skinImage?: SkinImage | null): THREE.BufferAttribute {
    let pixels: SkinImage;
    if (skinImage) pixels = skinImage;
    else {
      const image = albedo.image as CanvasImageSource & { width: number; height: number };
      const canvas = document.createElement("canvas");
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw Error("Cannot read the head albedo for the brow decal blend");
      context.drawImage(image, 0, 0);
      pixels = context.getImageData(0, 0, image.width, image.height);
    }
    const world = (mesh: THREE.Mesh) => {
      mesh.updateWorldMatrix(true, false);
      const source = mesh.geometry.getAttribute("position"), out = new Float32Array(source.count * 3), v = new THREE.Vector3();
      for (let i = 0; i < source.count; i++) v.fromBufferAttribute(source, i).applyMatrix4(mesh.matrixWorld).toArray(out, i * 3);
      return out;
    };
    const result = sampleUnderlayAlbedo(world(brow), world(head), head.geometry.getAttribute("uv").array,
      { width: pixels.width, height: pixels.height, data: pixels.data });
    if (result.unmatched) throw Error(`${result.unmatched} decal vertices are not over the head surface`);
    browUnderlay = { maxMatchedDistance: result.maxMatchedDistance, unmatched: result.unmatched, source: skinImage ? "resolved-skin" : "core-albedo" };
    return new THREE.BufferAttribute(result.underlay, 3);
  }
  // Resolved character details (skin, brows, lashes, hair): loaded later from the host's character record
  // (character-detail-loader.ts) and swapped in whole; each V replaces the previous one completely.
  const detailVisible: Record<DetailSlot, boolean> = { skin: true, brows: true, lashes: true, hair: true };
  // Keep context details above the entire editable makeup stack (orders 10–41); skin and hair keep their own order.
  const DETAIL_RENDER_ORDER: Record<DetailSlot, number> = { skin: 0, brows: 100, lashes: 101, hair: 0 };
  let characterDetails: LoadedCharacterDetails | null = null;
  /**
   * How the resolved skin is shown: on the core head when the launch route's head is the same surface (the
   * usual case; the eye plate and idle stay bound to it), or as the resolved head itself when a mod changes
   * its shape (the core head is hidden). Null while the fixed default skin shows.
   */
  let resolvedSkin: { item: LoadedCharacterComponent; mode: "core-head" | "resolved-head"; reason: string } | null = null;
  let normalsEnabled = true;
  const HEAD_SHAPE_LIMIT = "An installed mod changes your V's head shape. The preview shows it, but eye makeup is still placed on the original head shape.";
  const skinLimits = () => resolvedSkin?.mode === "resolved-head" ? [{ slot: "skin" as DetailSlot, message: HEAD_SHAPE_LIMIT }] : [];
  function detailContext(slot: DetailSlot): Omit<AdapterContext, "slot"> {
    return { overMakeup: slot === "lashes", profileEncoding,
      ...(slot === "brows" ? { underlay: (mesh: THREE.Mesh, skinImage?: SkinImage | null) => browUnderlayAttribute(mesh, skinImage) } : {}) };
  }
  let piercingManifest: PiercingManifest | undefined, piercingError = "";
  let prcManifest: PiercingManifest | undefined, prcError = "";
  const piercingMeshes = new Map<string, THREE.SkinnedMesh[]>();
  async function loadPiercingResources(path: string, schema: PiercingManifest["schema"], budget: number) {
    const piercingRoots: THREE.Group[] = [];
    const loadedIds: string[] = [];
    let pendingPiercingRoot: THREE.Group | undefined;
    try {
    const response = await fetch(path, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error("Local piercing assets are unavailable");
    const candidate = parsePiercingManifest(await response.json());
    if (candidate.schema !== schema) throw Error("Unexpected piercing resource schema");
    if (candidate.styles.some(style => piercingManifest?.styles.some(existing => existing.id === style.id)))
      throw Error("Duplicate piercing style across sources");
    let totalBytes = 0, totalVertices = 0, totalBones = 0;
    for (const asset of candidate.assets) {
      if (piercingMeshes.has(asset.id)) throw Error("Duplicate piercing mesh across sources");
      const response = await fetch(asset.url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error(`Local piercing mesh unavailable (${response.status})`);
      const length = Number(response.headers.get("Content-Length"));
      if (Number.isFinite(length) && length > budget - totalBytes)
        throw Error("Piercing meshes exceed their source budget");
      const bytes = new Uint8Array(await response.arrayBuffer());
      totalBytes += bytes.byteLength;
      if (totalBytes > budget) throw Error("Piercing meshes exceed their source budget");
      await verifyPiercingBytes(bytes, asset.sha256);
      const original = restoreFirstWeights(bytes.buffer), loaded = await new GLTFLoader().parseAsync(bytes.buffer, asset.url.slice(0, asset.url.lastIndexOf("/") + 1));
      pendingPiercingRoot = loaded.scene;
      const parts: THREE.SkinnedMesh[] = [];
      loaded.scene.traverse(o => {
        if (o instanceof THREE.Bone) totalBones++;
        if (!(o instanceof THREE.SkinnedMesh)) return;
        const match = /^submesh_(\d+)_LOD_\d+$/.exec(o.name);
        if (!match) throw Error(`Unexpected piercing chunk ${o.name}`);
        const association = loaded.parser.associations.get(o);
        const raw = original.get(loaded.parser.json.meshes[association?.meshes ?? -1]?.name);
        if (!raw) throw Error(`Missing original piercing weights for ${o.name}`);
        o.geometry.setAttribute("skinWeight", new THREE.BufferAttribute(raw, 4));
        const mat = new THREE.MeshStandardMaterial({ color: 0xd6d5d3, metalness: .72, roughness: .3,
          side: THREE.DoubleSide });
        // The source geometry, morphs and chunk masks are exact; .mi/.mlsetup
        // colours, coated/pearl variants and REDengine reflections remain approximate.
        o.material = mat;
        o.userData.piercingChunk = Number(match[1]);
        o.visible = false; o.frustumCulled = false;
        extendSkin(o, mat);
        totalVertices += o.geometry.getAttribute("position").count;
        parts.push(o); meshes.push(o);
      });
      if (!parts.length || totalVertices > 200_000 || totalBones > 300)
        throw Error("Piercing geometry exceeds the preview budget");
      scene.add(loaded.scene);
      piercingRoots.push(loaded.scene);
      pendingPiercingRoot = undefined;
      piercingMeshes.set(asset.id, parts);
      loadedIds.push(asset.id);
    }
    return { manifest: candidate, error: "" };
  } catch (error) {
    for (const root of [...piercingRoots, ...(pendingPiercingRoot ? [pendingPiercingRoot] : [])]) {
      root.removeFromParent();
      root.traverse(o => { if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
        const i = meshes.indexOf(o); if (i >= 0) meshes.splice(i, 1);
      } });
    }
    for (const id of loadedIds) piercingMeshes.delete(id);
    return { manifest: undefined, error: (error as Error).message };
  }
  }
  ({ manifest: piercingManifest, error: piercingError } = await loadPiercingResources(
    "/assets/piercings/manifest.json", "xfs/local-vanilla-piercings-2", 24 * 1024 * 1024));
  ({ manifest: prcManifest, error: prcError } = await loadPiercingResources(
    "/assets/prc/manifest.json", "xfs/local-prc-piercings-1", 4 * 1024 * 1024));
  const makeup = createMakeupStack(plate, renderer.capabilities.getMaxAnisotropy());
  const { plates, materials, updateLayer } = makeup;
  makeup.setCanvases(canvases);
  const bones: {
    bone: THREE.Bone;
    base: THREE.Vector3;
    delta: THREE.Vector3;
  }[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (
      !(o instanceof THREE.Bone) ||
      !/eye_lid_(?:lashes_)?(up|dn)_row/.test(o.name)
    )
      return;
    const up = o.name.includes("_up_"),
      row = o.name.match(/row([A-D])/)?.[1] ?? "A";
    const world = o.getWorldPosition(new THREE.Vector3());
    const x = Math.abs(world.x),
      edge = Math.max(0, 1 - Math.abs((x - 0.032) / 0.023));
    const strength = (
      { A: 1, B: 0.75, C: 0.55, D: 0.3 } as Record<string, number>
    )[row];
    // Explicit exploratory pose. These distances are not extracted game animation.
    const delta = new THREE.Vector3(
      0,
      (up ? -0.0095 : 0.003) * edge * strength,
      -0.001 * edge * strength,
    );
    const inv = o.parent!.matrixWorld.clone().invert();
    delta.add(world).applyMatrix4(inv).sub(world.clone().applyMatrix4(inv));
    bones.push({ bone: o, base: o.position.clone(), delta });
  });
  function blink(value: number) {
    for (const b of bones)
      b.bone.position.copy(b.base).addScaledVector(b.delta, value);
  }
  let idle: IdleAnimation | undefined, idleError = "";
  try {
    const [motion, facial, binding] = await Promise.all([
      new GLTFLoader().loadAsync("/assets/cc-idle-body.glb"),
      new GLTFLoader().loadAsync("/assets/cc-idle-face.glb"),
      fetch("/assets/cc-idle-binding.json").then(r => { if (!r.ok) throw Error("Idle binding data unavailable"); return r.json(); }),
    ]);
    const clip = motion.animations.find(a => a.name === binding.clip);
    if (!clip) throw Error("Expected character-creator close-up clip is missing");
    const faceClip = facial.animations.find(a => a.name === "ui_closeup_shot_face");
    if (!faceClip) throw Error("Solved facial idle clip is missing");
    // The legacy eyeball preview is rigid geometry. Give each disconnected eye
    // one authoritative eye-joint influence so gaze rotates around the game pivot.
    if (!(eyes instanceof THREE.SkinnedMesh)) {
      facial.scene.updateMatrixWorld(true); scene.updateMatrixWorld(true);
      const eyeBones = ["l_J_eye_JNT","r_J_eye_JNT"].map(name => {
        const reference = facial.scene.getObjectByName(name);
        if (!reference) throw Error(`Missing gaze pivot ${name}`);
        const bone = new THREE.Bone(); bone.name=name;
        reference.matrixWorld.decompose(bone.position,bone.quaternion,bone.scale);
        return bone;
      });
      const geometry = eyes.geometry.clone(), positions = geometry.getAttribute("position");
      const indices = new Uint16Array(positions.count*4), weights = new Float32Array(positions.count*4);
      const point = new THREE.Vector3();
      for (let i=0;i<positions.count;i++) {
        point.fromBufferAttribute(positions,i).applyMatrix4(eyes.matrixWorld);
        indices[i*4] = point.distanceToSquared(eyeBones[0]!.position) < point.distanceToSquared(eyeBones[1]!.position) ? 0 : 1;
        weights[i*4] = 1;
      }
      const triangles = geometry.index;
      if (!triangles) throw Error("Expected indexed eyeball geometry");
      for (let i=0;i<triangles.count;i+=3) {
        const sides = [0,1,2].map(j => indices[triangles.getX(i+j)*4]);
        if (sides[0]!==sides[1] || sides[0]!==sides[2]) throw Error("Eye geometry crosses gaze attachment groups");
      }
      geometry.setAttribute("skinIndex",new THREE.Uint16BufferAttribute(indices,4));
      geometry.setAttribute("skinWeight",new THREE.Float32BufferAttribute(weights,4));
      const skinned = new THREE.SkinnedMesh(geometry,eyeMat);
      // Keep the eye component's own facial morph targets (eye shape) on the rigidly attached copy.
      if (eyes.morphTargetDictionary) {
        skinned.morphTargetDictionary = { ...eyes.morphTargetDictionary };
        skinned.morphTargetInfluences = [...(eyes.morphTargetInfluences ?? [])];
      }
      skinned.name="eyes"; skinned.position.copy(eyes.position);skinned.quaternion.copy(eyes.quaternion);skinned.scale.copy(eyes.scale);
      skinned.frustumCulled=false;
      eyes.parent!.add(skinned); scene.add(...eyeBones); scene.updateMatrixWorld(true);
      skinned.bind(new THREE.Skeleton(eyeBones),skinned.matrixWorld);
      meshes[meshes.indexOf(eyes)] = skinned;
      eyes.removeFromParent(); eyes=skinned;
    }
    const targets: THREE.Object3D[] = [];
    scene.traverse(o => { if (o instanceof THREE.Bone) targets.push(o); });
    idle = new IdleAnimation(motion.scene, clip, targets, binding.ancestry, { source: facial.scene, clip: faceClip });
    if (!idle.bindings.length) throw Error("Idle rig has no matching bones");
  } catch (error) {
    idle = undefined; idleError = (error as Error).message;
  }
  function frameIdle() {
    // Stored cameras use neutral space. Always derive the displacement at phase
    // zero so restoring a paused/nonzero phase never adds a different offset.
    camera.position.sub(idleFrameOffset); controls.target.sub(idleFrameOffset);
    idleFrameOffset.set(0, 0, 0);
    if (idle?.enabled) {
      const time = idle.time;
      idle.seek(0);
      const anchor = idle.bindings.find(b => b.bone.name === "Head");
      if (anchor) idleFrameOffset.setFromMatrixPosition(anchor.bone.matrixWorld)
        .sub(new THREE.Vector3().setFromMatrixPosition(anchor.worldBind));
      idle.seek(time);
      camera.position.add(idleFrameOffset); controls.target.add(idleFrameOffset);
    }
    controls.update();
  }
  // Every mesh with facial morph targets follows the character-creator morph choices. The eye
  // component carries its own `eyes` targets (a separate morph resource in the game), paired with
  // the head's by (target, region); see face-morphs.ts.
  const coreDeforming: THREE.Mesh[] = [
    head,
    plate,
    ...(eyes.morphTargetDictionary ? [eyes] : []),
    ...[...piercingMeshes.values()].flat(),
  ];
  // Resolved details join and leave with each character record (a skin drawn on the core head adds no mesh).
  const drawnDetails = () => characterDetails?.components.filter(item => !(resolvedSkin?.mode === "core-head" && resolvedSkin.item === item)) ?? [];
  const deforming = () => [...coreDeforming, ...drawnDetails().flatMap(item => item.meshes)];
  // The head is the authority for which eye shapes exist: its `eyes` targets in resource order.
  const eyeShapeChoices: FaceMorphChoice[] = faceMorphChoices(morphTargetNames(head), "eyes");
  const eyesFollowShape = followsFaceMorphChoices(morphTargetNames(eyes), eyeShapeChoices);
  function applyFaceMorph(choice: FaceMorphChoice) {
    for (const m of deforming()) {
      if (!m.morphTargetInfluences) continue;
      for (const [i, weight] of faceMorphWeights(morphTargetNames(m), choice.region, choice.target)) m.morphTargetInfluences[i] = weight;
    }
  }
  function eyeShape(index: number) {
    const choice = eyeShapeChoices[index];
    if (!choice) throw Error("That eye shape is not in this head.");
    applyFaceMorph(choice);
  }
  function eyeShapeOptions() {
    return { choices: eyeShapeChoices.map(choice => ({ ...choice })), eyesFollow: eyesFollowShape,
      eyeSource: core.record.geometry.morphs?.find(entry => entry.node === core.record.geometry.nodes.eyes)?.depotPath ?? null };
  }
  const piercingStyles = [...(piercingManifest?.styles ?? []), ...(prcManifest?.styles ?? [])];
  let piercingEnabled = true, piercingStyle = "", piercingDefinition = "";
  let currentSave: SavedV | undefined;
  function piercingSelection() {
    if (piercingStyle) {
      const style = piercingStyles.find(s => s.id === piercingStyle);
      const choice = style?.choices.find(c => c.definition === piercingDefinition);
      return style && choice ? { style, choice, fromSave: false } : undefined;
    }
    const saved = piercingManifest && savedPiercing(piercingManifest, currentSave);
    return saved ? { ...saved, fromSave: true } : undefined;
  }
  function refreshPiercings() {
    const selected = piercingEnabled ? piercingSelection() : undefined;
    for (const parts of piercingMeshes.values()) for (const mesh of parts) mesh.visible = false;
    if (!selected) return;
    for (const part of selected.choice.parts) for (const mesh of piercingMeshes.get(part.mesh) ?? []) {
      mesh.visible = chunkEnabled(part.mask, mesh.userData.piercingChunk);
      (mesh.material as THREE.MeshStandardMaterial).color.set(
        piercingPartColor(part, mesh.userData.piercingChunk, selected.choice.previewColor));
    }
  }
  function setPiercings(enabled: boolean) { piercingEnabled = enabled; refreshPiercings(); }
  function setPiercingPreview(style: string, definition: string) {
    if (style && !piercingStyles.some(s => s.id === style && s.choices.some(c => c.definition === definition)))
      throw Error("Unknown local piercing choice");
    piercingStyle = style; piercingDefinition = style ? definition : "";
    refreshPiercings();
  }
  function applySavedV(v: SavedV) {
    if (v.isMale)
      throw Error(
        "This study currently contains a female head. Male head assets are still needed.",
      );
    // The third-person head consumes `TPP`; `character_customization` (the creator puppet) can list fewer
    // morph regions (a new-game save stores only eyes and nose there, all five in TPP) [resource].
    const group =
      v.groups.head.find((g) => g.name === "TPP") ??
      v.groups.head.find((g) => g.name === "character_customization");
    if (!group)
      throw Error("No supported facial morph group found.");
    // A V whose every face region is the base shape stores no morphs; that is the base head.
    const names = group.morphs.map((m) => `${m.target}_${m.region}`);
    for (const mesh of [head, ...plates])
      for (const name of names)
        if (mesh.morphTargetDictionary?.[name] === undefined)
          throw Error(
            `This preview does not contain the saved facial morph ${name}`,
          );
    for (const mesh of deforming()) {
      mesh.morphTargetInfluences?.fill(0);
      for (const name of names) {
        const i = mesh.morphTargetDictionary?.[name];
        if (i !== undefined) mesh.morphTargetInfluences![i] = 1;
      }
    }
    const savedEyes = group.morphs.find(m => m.region === "eyes");
    // No saved `eyes` pair means the base shape (`None`); the save stores only chosen morphs.
    const savedEyeShape = faceMorphChoiceIndex(eyeShapeChoices, savedEyes?.target ?? null);
    selectedEye = eyeAppearances.select(group.appearances);
    // Reset explicitly on every accepted save, including unresolved/missing images.
    applyEyeMaterial();
    currentSave = v;
    refreshPiercings();
    return {
      applied: names,
      appearanceReferences: group.appearances.length,
      eyeAppearance: eyeAppearance(),
      matchedPiercing: !!(piercingManifest && savedPiercing(piercingManifest, v)),
      ...(savedEyeShape === undefined ? {} : { eyeShape: savedEyeShape }),
    };
  }
  function refreshDetailVisibility() {
    for (const item of drawnDetails()) item.root.visible = detailVisible[item.component.slot];
  }
  function setHair(enabled: boolean) { detailVisible.hair = enabled; refreshDetailVisibility(); }
  /**
   * Swap in a character's resolved details, replacing the previous ones completely (null removes them).
   * The new meshes follow the head's current facial shapes and join the idle rig.
   */
  function setCharacterDetails(next: LoadedCharacterDetails | null): { limits: { slot: DetailSlot; message: string }[] } {
    if (characterDetails === next) return { limits: skinLimits() };
    const previous = characterDetails;
    const drawnBefore = drawnDetails();
    characterDetails = null;
    if (previous) {
      idle?.detach(drawnBefore.flatMap(item => item.bones));
      for (const item of previous.components) for (const mesh of item.meshes) {
        const index = meshes.indexOf(mesh); if (index >= 0) meshes.splice(index, 1);
      }
      // Nothing of the previous V's skin may linger: the core head returns to the fixed default skin.
      head.material = skin;
      head.visible = true;
      resolvedSkin = null;
      previous.dispose();
    }
    if (!next) return { limits: [] };
    const skinItem = next.components.find(item => item.component.slot === "skin" && item.skin && item.meshes.length === 1);
    if (skinItem) {
      const resolvedHead = skinItem.meshes[0]!;
      const comparison = compareHeadSurfaces(headSurface(head), headSurface(resolvedHead));
      if (comparison.same) {
        head.material = resolvedHead.material;
        extendSkin(head, head.material as THREE.MeshStandardMaterial);
        resolvedSkin = { item: skinItem, mode: "core-head", reason: comparison.reason };
      } else {
        head.visible = false;
        resolvedSkin = { item: skinItem, mode: "resolved-head", reason: comparison.reason };
      }
      skinItem.skin!.handle.setNormals(normalsEnabled);
    }
    characterDetails = next;
    for (const item of drawnDetails()) {
      for (const mesh of item.meshes) {
        mesh.renderOrder = DETAIL_RENDER_ORDER[item.component.slot];
        extendSkin(mesh, mesh.material as THREE.MeshStandardMaterial);
        // Facial shapes: the same (target, region) names as the head's.
        for (const [key, index] of Object.entries(mesh.morphTargetDictionary ?? {}))
          mesh.morphTargetInfluences![index] = head.morphTargetInfluences?.[head.morphTargetDictionary?.[key] ?? -1] ?? 0;
        meshes.push(mesh);
      }
      scene.add(item.root);
    }
    scene.updateMatrixWorld(true);
    idle?.attach(drawnDetails().flatMap(item => item.bones));
    refreshDetailVisibility();
    return { limits: skinLimits() };
  }
  function characterDetailsEvidence() {
    const loaded = characterDetails;
    return { identity: loaded?.record.identity ?? null, source: loaded?.record.character.source ?? null,
      slots: loaded?.record.slots.map(slot => ({ ...slot })) ?? [], problems: loaded?.problems.map(problem => ({ ...problem })) ?? [],
      notes: [...(loaded?.notes ?? [])], browUnderlay,
      skin: resolvedSkin ? { mode: resolvedSkin.mode, reason: resolvedSkin.reason, parameters: structuredClone(resolvedSkin.item.skin!.handle.parameters),
        material: (resolvedSkin.mode === "core-head" ? head.material as THREE.Material : resolvedSkin.item.meshes[0]!.material as THREE.Material).name,
        textures: Object.fromEntries(Object.entries(resolvedSkin.item.component.materials[0]?.textures ?? {}).map(([name, texture]) =>
          [name, { depotPath: texture.depotPath, archive: texture.sources[0]?.archive ?? null, width: texture.width, height: texture.height, isGamma: texture.isGamma }])),
        geometry: { depotPath: resolvedSkin.item.component.geometry.depotPath, archive: resolvedSkin.item.component.geometry.sources[0]?.archive ?? null } }
        : { mode: "default", material: (head.material as THREE.Material).name || "default" },
      components: loaded?.components.map(item => ({ slot: item.component.slot, option: item.component.option, definition: item.component.definition,
        component: item.component.component, geometry: item.component.geometry.depotPath, visible: item.root.visible,
        chunks: item.meshes.map(mesh => mesh.name), templates: [...new Set(item.component.materials.map(material => material.template))],
        vertices: item.meshes.reduce((n, mesh) => n + mesh.geometry.getAttribute("position").count, 0) })) ?? [] };
  }
  const ray = new THREE.Raycaster(),
    mouse = new THREE.Vector2();
  let fovGestureAnchor: THREE.Vector3 | undefined;
  function pick(e: PointerEvent) {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
    );
    ray.setFromCamera(mouse, camera);
    plate.computeBoundingSphere();
    return ray.intersectObject(plate, false)[0]?.uv;
  }
  let appliedWidth = 0, appliedHeight = 0;
  const resize = () => {
    const size = visibleViewportSize(host.clientWidth, host.clientHeight);
    if (!size) return false;
    if (size.width !== appliedWidth || size.height !== appliedHeight) {
      renderer.setSize(size.width, size.height);
      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();
      appliedWidth = size.width; appliedHeight = size.height;
    }
    if (frontPending) front();
    return true;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  releases.push(() => observer.disconnect());
  resize();
  let animation = false,
    amount = 0;
  const start = performance.now();
  let previous = start;
  let totalFrames=0,zeroIntervals=0,lastFrameAt=start;
  const frameIntervals:number[]=[],renderDurations:number[]=[];
  const record=(items:number[],value:number)=>{items.push(value);if(items.length>180)items.shift();};
  const frameListeners = new Set<() => void>();
  renderer.setAnimationLoop(() => {
    const now = performance.now(), t = (now - start) / 1000, dt = (now - previous) / 1000;
    totalFrames++;lastFrameAt=now;
    if(dt>0 && dt<5)record(frameIntervals,dt*1000);else if(dt===0)zeroIntervals++;
    previous = now;
    if (idle?.enabled) idle.update(dt);
    else blink(animation ? Math.pow(Math.max(0, Math.cos(t * 2.3)), 16) : amount);
    if (controls.enabled) controls.update();
    // At long orbits, move the near plane in front of a conservative head
    // envelope so the thin makeup plate retains depth precision.
    const centre = new THREE.Vector3(0, 1.67, 0).add(idleFrameOffset);
    const clip = previewClipPlanes(controls.getDistance(), camera.position.distanceTo(centre));
    if (clip.near !== camera.near || clip.far !== camera.far) {
      camera.near = clip.near; camera.far = clip.far; camera.updateProjectionMatrix();
    }
    if (frameListeners.size) {
      scene.updateMatrixWorld(true);
      for (const update of frameListeners) update();
    }
    const renderStart=performance.now();
    renderer.render(scene, camera);
    record(renderDurations,performance.now()-renderStart);
  });
  const evidence = {
    /** Which render record supplied the core head (derived from game files, or developer-prepared). */
    coreDetail,
    meshes: meshes.map((m) => ({
      name: m.name,
      vertices: m.geometry.getAttribute("position").count,
      morphs: m.morphTargetInfluences?.length ?? 0,
      skinSets:
        m instanceof THREE.SkinnedMesh ? skinSets(m.geometry).length : 0,
    })),
    blinkBones: bones.length,
    eyeShape: { choices: eyeShapeChoices.length, eyesFollow: eyesFollowShape, eyeMorphTargets: eyes.morphTargetInfluences?.length ?? 0 },
    profileEncoding,
    piercingError,
    prcError,
    piercing: { source: piercingManifest?.source, styles: piercingManifest?.styles.length ?? 0,
      meshes: [...piercingMeshes].map(([id, parts]) => ({ id, chunks: parts.length,
        vertices: parts.reduce((n, m) => n + m.geometry.getAttribute("position").count, 0) })) },
    prc: { source: prcManifest?.source, styles: prcManifest?.styles.length ?? 0 },
    idle: { available: !!idle, error: idleError, clip: idle?.clip.name, duration: idle?.clip.duration,
      mappedBones: idle?.bindings.length ?? 0, unmappedBones: idle?.unmapped ?? [], facialControlsApplied: !!idle?.facial,
      faceDuration: idle?.facial?.clip.duration, faceMappedBones: idle?.bindings.filter(b => b.faceDriver).length ?? 0 },
  };
  return {
    scene,
    camera,
    /** Releases the renderer, its canvas, the stage and observers; the scene is unusable afterwards. */
    dispose: () => { setCharacterDetails(null); releaseAll(releases); },
    onFrame: (callback: () => void) => {
      frameListeners.add(callback);
      return () => frameListeners.delete(callback);
    },
    renderer,
    controls,
    cameraInput,
    head,
    eyes,
    plate,
    plates,
    materials,
    albedo,
    evidence,
    resize,
    front,
    pick,
    updateLayer,
    setLayerCanvases: makeup.setCanvases,
    reconcileLayerCanvases: makeup.reconcileLayerCanvases,
    setLayerCanvas: makeup.setLayerCanvas,
    needsOptics: makeup.needsOptics,
    needsAlbedo: makeup.needsAlbedo,
    makeupDiagnostics: makeup.diagnostics,
    frameTiming:()=>{
      const summarize=(values:number[])=>{const ordered=[...values].sort((a,b)=>a-b);
        return {samples:ordered.length,medianMs:ordered[Math.floor(ordered.length*.5)]??0,
          p95Ms:ordered[Math.floor(ordered.length*.95)]??0};};
      return {interval:summarize(frameIntervals),cpuRender:summarize(renderDurations),
        totalFrames,zeroIntervals,elapsedMs:lastFrameAt-start};
    },
    maxTextureSize: renderer.capabilities.maxTextureSize,
    eyeShape,
    eyeShapeOptions,
    applySavedV,
    eyeAppearance,
    setEyeOptics,
    setHair,
    setCharacterDetails,
    detailContext,
    characterDetailsEvidence,
    piercingManifest,
    prcManifest,
    piercingStyles,
    piercingSelection,
    setPiercings,
    setPiercingPreview,
    idle,
    // Store the orbit in neutral head space; enabling idle adds its framing offset once.
    cameraState: (): CameraState => ({ position: camera.position.clone().sub(idleFrameOffset).toArray(),
      target: controls.target.clone().sub(idleFrameOffset).toArray(), fov: camera.fov }),
    restoreCamera: (state: CameraState) => {
      frontPending = false;
      camera.fov = state.fov;
      camera.position.fromArray(state.position).add(idleFrameOffset);
      controls.target.fromArray(state.target).add(idleFrameOffset);
      camera.updateProjectionMatrix();
      controls.update();
    },
    setFov: (degrees: number) => {
      const next = THREE.MathUtils.clamp(degrees, 10, 90);
      if (next === camera.fov) return;
      // The centre ray selects the currently viewed head, plate or eye plane.
      // When looking at background, preserve the orbit target plane instead.
      if (!fovGestureAnchor) {
        scene.updateMatrixWorld(true);
        ray.setFromCamera(new THREE.Vector2(), camera);
        head.computeBoundingSphere();
        plate.computeBoundingSphere();
        const hit = ray.intersectObjects([head, plate, eyes], false)[0];
        fovGestureAnchor = (hit?.point ?? controls.target).clone();
      }
      const frame = surfaceAnchoredDistance(
        camera.position.toArray(), controls.target.toArray(), fovGestureAnchor.toArray(), camera.fov, next);
      const orbitDirection = camera.position.clone().sub(controls.target).normalize();
      camera.position.copy(controls.target).addScaledVector(orbitDirection, frame.distance);
      camera.fov = next;
      camera.updateProjectionMatrix();
      controls.update();
      return frame.limited;
    },
    endFovGesture: () => { fovGestureAnchor = undefined; },
    setIdle: (enabled: boolean) => {
      if (!idle || idle.enabled === enabled) return;
      animation = false; amount = 0; blink(0);
      idle.setEnabled(enabled);
      frameIdle();
    },
    setIdlePaused: (paused: boolean) => idle?.setPaused(paused),
    setIdleContributions: (body: boolean, face: boolean) => {
      if (!idle || (idle.bodyEnabled === body && idle.faceEnabled === face)) return;
      idle.setContributions({ body, face }); frameIdle();
    },
    setDetail: (name: "brows" | "lashes", v: boolean) => {
      detailVisible[name] = v; refreshDetailVisibility();
    },
    setBlink: (v: number) => {
      amount = v;
      animation = false;
    },
    animateBlink: (v: boolean) => (animation = v),
    setWire: makeup.setWire,
    setNormals: (v: boolean) => {
      normalsEnabled = v;
      skin.normalScale.set(v ? 0.35 : 0, v ? -0.35 : 0);
      resolvedSkin?.item.skin?.handle.setNormals(v);
    },
    setExposure: (v: number) => (renderer.toneMappingExposure = v),
    /** Typed theme input for the stage backdrop; it never changes lighting. */
    setStage: (theme: StageTheme) => backdrop.setTheme(theme),
    setLightAngle: (degrees: number) => {
      const a = (degrees * Math.PI) / 180;
      key.position.set(
        Math.sin(a) * Math.hypot(0.3, 0.5),
        1.9,
        -Math.cos(a) * Math.hypot(0.3, 0.5),
      );
    },
  };
}

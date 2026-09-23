import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { extendSkin, restoreFirstWeights, skinSets } from "./skin";
import type { SavedV } from "./save-reader";
import { createMakeupStack } from "./makeup-stack";
import { IdleAnimation } from "./idle-animation";
import type { CameraState } from "./workspace-state";
import { previewNearPlane } from "./camera-depth";
import { prepareEyeAppearances } from "./eye-appearance";
import { parseHairManifest, selectSavedHair, verifyHairBytes, type HairAsset } from "./hair-preview";
import { attachHairColor, hairGradientTexture } from "./hair-shading";
import { chunkEnabled, parsePiercingManifest, savedPiercing, verifyPiercingBytes, type PiercingManifest } from "./piercing-preview";
import { loadSavedBrowMaterial } from "./brow-material";
import { loadSavedLashColor } from "./lash-profile";

export async function createScene(
  host: HTMLElement,
  canvases: HTMLCanvasElement[],
) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x14181c, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(30, 1, 0.005, 10);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 0.1;
  controls.maxDistance = 1.2;
  const idleFrameOffset = new THREE.Vector3();
  function front() {
    const distance = Math.max(
      0.55,
      0.13 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (host.clientWidth / host.clientHeight)),
    );
    camera.position.set(0, 1.67, -distance);
    controls.target.set(0, 1.67, 0.005);
    camera.position.add(idleFrameOffset);
    controls.target.add(idleFrameOffset);
    controls.update();
  }
  front();
  const pmrem = new THREE.PMREMGenerator(renderer),
    room = new RoomEnvironment(),
    env = pmrem.fromScene(room, 0.04);
  scene.environment = env.texture;
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
  const data = await (await fetch("/assets/head.glb")).arrayBuffer(),
    weights = restoreFirstWeights(data);
  const gltf = await new GLTFLoader().parseAsync(data, "/assets/");
  scene.add(gltf.scene);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push(o);
  });
  const head = meshes.find((m) => m.name === "head") as THREE.SkinnedMesh;
  const plate = meshes.find(
    (m) => m.name === "makeup_plate",
  ) as THREE.SkinnedMesh;
  let eyes = meshes.find((m) => m.name === "eyes") as THREE.Mesh;
  if (!head || !plate || !eyes)
    throw Error("Preview asset is missing required meshes.");
  for (const m of meshes) {
    m.frustumCulled = false;
    if (m instanceof THREE.SkinnedMesh) {
      const association = gltf.parser.associations.get(m);
      const raw = weights.get(
        gltf.parser.json.meshes[association?.meshes ?? -1]?.name,
      );
      if (!raw) throw Error(`Cannot restore full skin weights for ${m.name}`);
      m.geometry.setAttribute("skinWeight", new THREE.BufferAttribute(raw, 4));
    }
  }
  const loader = new THREE.TextureLoader();
  async function texture(name: string, color = false) {
    const t = await loader.loadAsync(`/assets/${name}.png`);
    t.flipY = false;
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }
  const [albedo, eyeColor, normal, roughness] = await Promise.all([
    texture("head-color", true),
    texture("eye-color", true),
    texture("head-normal"),
    texture("head-roughness"),
  ]);
  const skin = new THREE.MeshStandardMaterial({
    map: albedo,
    roughness: 0.85,
    roughnessMap: roughness,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.35, -0.35),
  });
  head.material = skin;
  extendSkin(head, skin);
  const eyeMat = new THREE.MeshStandardMaterial({
    map: eyeColor,
    roughness: 0.18,
  });
  eyes.material = eyeMat;
  if (eyes instanceof THREE.SkinnedMesh) extendSkin(eyes, eyeMat);
  const eyeAppearances = await prepareEyeAppearances(async (bytes, entry) => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
    try {
      const t = await loader.loadAsync(url);
      if (t.image.width !== entry.width || t.image.height !== entry.height) {
        t.dispose(); throw Error("Local eye image dimensions do not match its manifest");
      }
      // Existing eye UV0 is already folded to one tile. Do not crop/translate it again.
      t.flipY = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      t.name = entry.label;
      return t;
    } finally { URL.revokeObjectURL(url); }
  });
  let eyeAppearanceStatus = eyeAppearances.select().status;
  function eyeAppearance() {
    const map = eyeMat.map, reference = map === eyeColor;
    const image = map?.image as HTMLImageElement | undefined;
    return { ...eyeAppearanceStatus,
      activeTexture: { url: reference ? "/assets/eye-color.png" : eyeAppearanceStatus.asset?.url,
        sha256: reference ? undefined : eyeAppearanceStatus.asset?.sha256,
        width: image?.width, height: image?.height, flipY: map?.flipY, colorSpace: map?.colorSpace },
      material: { transparent: eyeMat.transparent, depthWrite: eyeMat.depthWrite, alphaTest: eyeMat.alphaTest,
        normalMap: !!eyeMat.normalMap, roughnessMap: !!eyeMat.roughnessMap },
    };
  }
  const details: Record<
    string,
    {
      root: THREE.Group;
      meshes: THREE.SkinnedMesh[];
      hash: string;
      definition: string;
    }
  > = {};
  const detailErrors: string[] = [];
  let savedBrowMaterial: THREE.MeshStandardMaterial | undefined;
  let savedLashColor: THREE.Color | undefined;
  try {
    savedBrowMaterial = await loadSavedBrowMaterial(loader, renderer.capabilities.getMaxAnisotropy());
  } catch (error) {
    detailErrors.push(`brows: ${(error as Error).message}; using the provisional material`);
  }
  try {
    savedLashColor = await loadSavedLashColor();
  } catch (error) {
    detailErrors.push(`lashes: ${(error as Error).message}; using the provisional colour`);
  }
  for (const [name, color, hash, definition] of [
    ["brows", "#675147", "10685882159528859062", "10_brown_ombre"],
    ["lashes", "#30221b", "6047185506343464350", "05_brown_liquorice"],
  ]) {
    try {
      const buffer = await (await fetch(`/assets/${name}.glb`)).arrayBuffer(),
        original = restoreFirstWeights(buffer);
      const asset = await new GLTFLoader().parseAsync(buffer, "/assets/"),
        alpha = name === "brows" && savedBrowMaterial ? undefined : await texture(`${name}-alpha`);
      const parts: THREE.SkinnedMesh[] = [];
      asset.scene.traverse((o) => {
        if (!(o instanceof THREE.SkinnedMesh)) return;
        const a = asset.parser.associations.get(o),
          raw = original.get(asset.parser.json.meshes[a?.meshes ?? -1]?.name);
        if (!raw) throw Error(`Missing original weights for ${name}`);
        o.geometry.setAttribute(
          "skinWeight",
          new THREE.BufferAttribute(raw, 4),
        );
        o.frustumCulled = false;
        const mat = name === "brows" && savedBrowMaterial ? savedBrowMaterial : new THREE.MeshStandardMaterial({
          color: name === "lashes" && savedLashColor ? savedLashColor : color,
          alphaMap: alpha,
          transparent: true,
          depthWrite: false,
          alphaTest: 0.01,
          roughness: 0.8,
          side: THREE.DoubleSide,
        });
        // Geometry is the local game's/mod's source. Hair/decal shading is provisional.
        o.material = mat;
        // Keep context details above the entire editable makeup stack (orders 10–41).
        o.renderOrder = name === "brows" ? 100 : 101;
        extendSkin(o, mat);
        for (const [key, i] of Object.entries(o.morphTargetDictionary ?? {}))
          o.morphTargetInfluences![i] =
            head.morphTargetInfluences?.[
              head.morphTargetDictionary?.[key] ?? -1
            ] ?? 0;
        o.name = `preview_${name}`;
        parts.push(o);
        meshes.push(o);
      });
      if (!parts.length) throw Error(`No skinned ${name} geometry`);
      scene.add(asset.scene);
      details[name] = { root: asset.scene, meshes: parts, hash, definition };
    } catch (error) {
      detailErrors.push(`${name}: ${(error as Error).message}`);
    }
  }
  const hair: { asset: HairAsset; root: THREE.Group; meshes: THREE.SkinnedMesh[] }[] = [];
  const hairErrors: string[] = [];
  // All loaded rigs enter the idle binding once at scene creation. Keep their
  // aggregate CPU/GPU cost bounded even if a local manifest lists many styles.
  const MAX_HAIR_BYTES = 128 * 1024 * 1024, MAX_HAIR_VERTICES = 750_000, MAX_HAIR_BONES = 800;
  let hairBytes = 0, hairVertices = 0, hairBones = 0;
  try {
    const response = await fetch("/assets/hair/manifest.json", { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error("Local resolved hair assets are unavailable");
    const entries = parseHairManifest(await response.json());
    for (const asset of entries) {
      const root = new THREE.Group(), parts: THREE.SkinnedMesh[] = [];
      let alpha: THREE.Texture | undefined, bytesUsed = 0, verticesUsed = 0, bonesUsed = 0;
      const materialTextures: THREE.Texture[] = [];
      try {
        const bytes = async (url: string, sha256: string) => {
          const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw Error(`Local hair asset unavailable (${response.status})`);
          const length = Number(response.headers.get("Content-Length"));
          if (Number.isFinite(length) && length > MAX_HAIR_BYTES - hairBytes - bytesUsed)
            throw Error("Local hair asset exceeds the aggregate 128 MiB limit");
          const data = new Uint8Array(await response.arrayBuffer());
          if (data.byteLength > MAX_HAIR_BYTES - hairBytes - bytesUsed)
            throw Error("Local hair asset exceeds the aggregate 128 MiB limit");
          await verifyHairBytes(data, sha256);
          bytesUsed += data.byteLength;
          return data;
        };
        const loadMap = async (file: { url: string; sha256: string }, color: boolean) => {
          const data = await bytes(file.url, file.sha256);
          const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: "image/png" }));
          let map: THREE.Texture;
          try { map = await loader.loadAsync(url); } finally { URL.revokeObjectURL(url); }
          map.flipY = false;
          map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
          materialTextures.push(map);
          return map;
        };
        // Three's alphaMap samples green. Source hair_lm60_a has grayscale RGB;
        // its nearly opaque PNG alpha channel is not the card cutout.
        alpha = await loadMap(asset.alpha, false);
        let strand: { id: THREE.Texture; gradient: THREE.Texture; idPalette: THREE.Texture;
          rootPalette: THREE.Texture } | undefined;
        let cap: { mask: THREE.Texture; gradient: THREE.Texture } | undefined;
        if (asset.profile && asset.strandId && asset.strandGradient && asset.capMask && asset.capGradient) {
          const [id, gradient, mask, capGradient] = await Promise.all([
            loadMap(asset.strandId, false), loadMap(asset.strandGradient, false),
            loadMap(asset.capMask, false), loadMap(asset.capGradient, true),
          ]);
          const idPalette = hairGradientTexture(asset.profile.id);
          const rootPalette = hairGradientTexture(asset.profile.rootToTip);
          materialTextures.push(idPalette, rootPalette);
          strand = { id, gradient, idPalette, rootPalette };
          cap = { mask, gradient: capGradient };
        }
        for (let index = 0; index < asset.parts.length; index++) {
          const entry = asset.parts[index]!, buffer = (await bytes(entry.url, entry.sha256)).buffer,
            original = restoreFirstWeights(buffer), loaded = await new GLTFLoader().parseAsync(buffer, "/assets/hair/");
          root.add(loaded.scene);
          loaded.scene.traverse(o => {
            if (o instanceof THREE.Bone) bonesUsed++;
            if (!(o instanceof THREE.SkinnedMesh)) return;
            const association = loaded.parser.associations.get(o),
              raw = original.get(loaded.parser.json.meshes[association?.meshes ?? -1]?.name);
            if (!raw) throw Error(`Missing original hair weights for ${o.name}`);
            o.geometry.setAttribute("skinWeight", new THREE.BufferAttribute(raw, 4));
            o.frustumCulled = false;
            const mat = new THREE.MeshStandardMaterial({
              color: strand ? 0xffffff : 0x342c29,
              roughness: index ? 0.65 : 0.95, side: THREE.DoubleSide,
              ...(index ? { alphaMap: alpha, alphaTest: 0.12, alphaToCoverage: true } :
                cap ? { alphaMap: cap.mask, alphaTest: 0.08 } : {}),
            });
            // Source textures and CCXL profile stops, rendered with approximate Three lighting.
            o.material = mat;
            extendSkin(o, mat);
            if (index && strand) attachHairColor(mat, { kind: "strand", ...strand });
            else if (!index && cap) attachHairColor(mat, { kind: "cap", ...cap });
            o.name = `preview_hair_${index}_${parts.length}`;
            verticesUsed += o.geometry.getAttribute("position").count;
            parts.push(o);
          });
          if (hairVertices + verticesUsed > MAX_HAIR_VERTICES || hairBones + bonesUsed > MAX_HAIR_BONES)
            throw Error("Local hair styles exceed the aggregate geometry/rig limit");
        }
        if (parts.length < 2) throw Error("Saved hair geometry is incomplete");
        root.visible = false;
        scene.add(root);
        hair.push({ asset, root, meshes: parts });
        meshes.push(...parts);
        hairBytes += bytesUsed; hairVertices += verticesUsed; hairBones += bonesUsed;
      } catch (error) {
        root.traverse(o => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            const materials = Array.isArray(o.material) ? o.material : [o.material];
            for (const material of materials) material.dispose();
          }
        });
        for (const texture of materialTextures) texture.dispose();
        hairErrors.push(`${asset.label}: ${(error as Error).message}`);
      }
    }
  } catch (error) { hairErrors.push((error as Error).message); }
  const hairError = hairErrors.join("; ");
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
    "/assets/piercings/manifest.json", "xfs/local-vanilla-piercings-1", 24 * 1024 * 1024));
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
  const deforming = [
    head,
    plate,
    ...Object.values(details).flatMap((d) => d.meshes),
    ...[...piercingMeshes.values()].flat(),
  ];
  function eyeShape(index: number) {
    for (const m of deforming) {
      if (!m.morphTargetDictionary || !m.morphTargetInfluences) continue;
      for (const [name, i] of Object.entries(m.morphTargetDictionary))
        if (name.endsWith("_eyes"))
          m.morphTargetInfluences[i] =
            name === `h${String(index * 10 + 1).padStart(3, "0")}_eyes` ? 1 : 0;
    }
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
      (mesh.material as THREE.MeshStandardMaterial).color.set(selected.choice.swatch);
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
    const group =
      v.groups.head.find((g) => g.name === "character_customization") ??
      v.groups.head.find((g) => g.name === "TPP");
    if (!group?.morphs.length)
      throw Error("No supported facial morph group found.");
    const names = group.morphs.map((m) => `${m.target}_${m.region}`);
    for (const mesh of [head, ...plates])
      for (const name of names)
        if (mesh.morphTargetDictionary?.[name] === undefined)
          throw Error(
            `This preview does not contain the saved facial morph ${name}`,
          );
    for (const mesh of deforming) {
      mesh.morphTargetInfluences!.fill(0);
      for (const name of names) {
        const i = mesh.morphTargetDictionary?.[name];
        if (i !== undefined) mesh.morphTargetInfluences![i] = 1;
      }
    }
    const matchedDetails = Object.entries(details)
      .filter(([, d]) =>
        group.appearances.some(
          (a) => a.resourceHash === d.hash && a.definition === d.definition,
        ),
      )
      .map(([name]) => name);
    const selectedEye = eyeAppearances.select(group.appearances);
    // Reset explicitly on every accepted save, including unresolved/missing images.
    eyeMat.map = selectedEye.texture ?? eyeColor;
    eyeMat.needsUpdate = true;
    eyeAppearanceStatus = selectedEye.status;
    currentSave = v;
    refreshPiercings();
    const selectedHair = selectSavedHair(hair.map(h => h.asset), v);
    for (const h of hair) h.root.visible = h.asset === selectedHair && hairEnabled;
    const matchedHair = !!selectedHair;
    return {
      applied: names,
      appearanceReferences: group.appearances.length,
      matchedDetails,
      eyeAppearance: eyeAppearance(),
      matchedHair,
      matchedPiercing: !!(piercingManifest && savedPiercing(piercingManifest, v)),
    };
  }
  let hairEnabled = true;
  function setHair(enabled: boolean) {
    hairEnabled = enabled;
    const selectedHair = selectSavedHair(hair.map(h => h.asset), currentSave);
    for (const h of hair) h.root.visible = enabled && h.asset === selectedHair;
  }
  const ray = new THREE.Raycaster(),
    mouse = new THREE.Vector2();
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
  const observer = new ResizeObserver(() => {
    const w = host.clientWidth,
      h = host.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  observer.observe(host);
  let animation = false,
    amount = 0;
  const start = performance.now();
  let previous = start;
  const frameListeners = new Set<() => void>();
  renderer.setAnimationLoop(() => {
    const now = performance.now(), t = (now - start) / 1000, dt = (now - previous) / 1000;
    previous = now;
    if (idle?.enabled) idle.update(dt);
    else blink(animation ? Math.pow(Math.max(0, Math.cos(t * 2.3)), 16) : amount);
    if (controls.enabled) controls.update();
    // A 1 mm near plane wastes precision at the 1.2 m orbit limit, making the
    // 0.08 mm plate separation comparable to one depth-buffer step. Keep the
    // close-up limit while using a 5 mm plane at ordinary/far viewing distances.
    const near = previewNearPlane(controls.getDistance());
    if (near !== camera.near) { camera.near = near; camera.updateProjectionMatrix(); }
    if (frameListeners.size) {
      scene.updateMatrixWorld(true);
      for (const update of frameListeners) update();
    }
    renderer.render(scene, camera);
  });
  const evidence = {
    meshes: meshes.map((m) => ({
      name: m.name,
      vertices: m.geometry.getAttribute("position").count,
      morphs: m.morphTargetInfluences?.length ?? 0,
      skinSets:
        m instanceof THREE.SkinnedMesh ? skinSets(m.geometry).length : 0,
    })),
    blinkBones: bones.length,
    detailErrors,
    browMaterial: savedBrowMaterial ? "saved-double-diffuse" : "provisional",
    lashColor: savedLashColor ? "saved-profile-swatch-approximation" : "provisional",
    hairError,
    piercingError,
    prcError,
    piercing: { source: piercingManifest?.source, styles: piercingManifest?.styles.length ?? 0,
      meshes: [...piercingMeshes].map(([id, parts]) => ({ id, chunks: parts.length,
        vertices: parts.reduce((n, m) => n + m.geometry.getAttribute("position").count, 0) })) },
    prc: { source: prcManifest?.source, styles: prcManifest?.styles.length ?? 0 },
    hair: hair.map(h => ({ label: h.asset.label, parts: h.meshes.length,
      vertices: h.meshes.reduce((n, m) => n + m.geometry.getAttribute("position").count, 0) })),
    idle: { available: !!idle, error: idleError, clip: idle?.clip.name, duration: idle?.clip.duration,
      mappedBones: idle?.bindings.length ?? 0, unmappedBones: idle?.unmapped ?? [], facialControlsApplied: !!idle?.facial,
      faceDuration: idle?.facial?.clip.duration, faceMappedBones: idle?.bindings.filter(b => b.faceDriver).length ?? 0 },
  };
  return {
    scene,
    camera,
    onFrame: (callback: () => void) => {
      frameListeners.add(callback);
      return () => frameListeners.delete(callback);
    },
    renderer,
    controls,
    head,
    eyes,
    plate,
    plates,
    materials,
    albedo,
    evidence,
    front,
    pick,
    updateLayer,
    setLayerCanvases: makeup.setCanvases,
    setLayerCanvas: makeup.setLayerCanvas,
    needsOptics: makeup.needsOptics,
    makeupDiagnostics: makeup.diagnostics,
    maxTextureSize: renderer.capabilities.maxTextureSize,
    eyeShape,
    applySavedV,
    eyeAppearance,
    details,
    hair,
    setHair,
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
      camera.fov = state.fov;
      camera.position.fromArray(state.position).add(idleFrameOffset);
      controls.target.fromArray(state.target).add(idleFrameOffset);
      camera.updateProjectionMatrix();
      controls.update();
    },
    setFov: (degrees: number) => {
      camera.fov = THREE.MathUtils.clamp(degrees, 10, 90);
      camera.updateProjectionMatrix();
    },
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
    setDetail: (name: string, v: boolean) => {
      if (details[name]) details[name].root.visible = v;
    },
    setBlink: (v: number) => {
      amount = v;
      animation = false;
    },
    animateBlink: (v: boolean) => (animation = v),
    setWire: makeup.setWire,
    setNormals: (v: boolean) => {
      skin.normalScale.set(v ? 0.35 : 0, v ? -0.35 : 0);
    },
    setExposure: (v: number) => (renderer.toneMappingExposure = v),
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

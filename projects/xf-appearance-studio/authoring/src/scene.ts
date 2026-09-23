import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { extendSkin, restoreFirstWeights, skinSets } from "./skin";
import type { Layer } from "./recipe";
import type { SavedV } from "./save-reader";
import { bakeFlakes, canonicalFinish, defaultFlakes } from "./finish";
import { IdleAnimation } from "./idle-animation";
import type { CameraState } from "./workspace-state";

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
    camera = new THREE.PerspectiveCamera(30, 1, 0.001, 10);
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
  for (const [name, color, hash, definition] of [
    ["brows", "#675147", "10685882159528859062", "10_brown_ombre"],
    ["lashes", "#30221b", "6047185506343464350", "05_brown_liquorice"],
  ]) {
    try {
      const buffer = await (await fetch(`/assets/${name}.glb`)).arrayBuffer(),
        original = restoreFirstWeights(buffer);
      const asset = await new GLTFLoader().parseAsync(buffer, "/assets/"),
        alpha = await texture(`${name}-alpha`);
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
        const mat = new THREE.MeshStandardMaterial({
          color,
          alphaMap: alpha,
          transparent: true,
          depthWrite: false,
          alphaTest: 0.01,
          roughness: 0.8,
          side: THREE.DoubleSide,
        });
        // Geometry is the local game's/mod's source. Hair/decal shading is provisional.
        o.material = mat;
        o.renderOrder = name === "brows" ? 20 : 21;
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
  const plates: THREE.SkinnedMesh[] = [],
    textures: THREE.CanvasTexture[] = [],
    materials: THREE.MeshPhysicalMaterial[] = [];
  for (let i = 0; i < 4; i++) {
    const m = i === 0 ? plate : plate.clone();
    if (i) plate.parent!.add(m);
    m.name = `makeup_layer_${i + 1}`;
    m.skeleton = plate.skeleton;
    m.renderOrder = 10 + i;
    const t = new THREE.CanvasTexture(canvases[i]);
    t.flipY = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const mat = new THREE.MeshPhysicalMaterial({
      map: t,
      transparent: true,
      depthWrite: false,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    m.material = mat;
    extendSkin(m, mat, 0.00008 * (i + 1));
    plates.push(m);
    textures.push(t);
    materials.push(mat);
  }
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
  const flakeMaps = new Map<
    number,
    { key: string; normal: THREE.DataTexture; surface: THREE.DataTexture }
  >();
  function updateLayer(i: number, l: Layer) {
    const m = materials[i];
    m.color.set(l.color);
    const finish = canonicalFinish(l.finish),
      p = l.flakes ?? defaultFlakes();
    const textured = finish === "shimmer" || finish === "glitter";
    const old = flakeMaps.get(i),
      key = JSON.stringify([finish, p]);
    if (old && (!textured || key !== old.key)) {
      old.normal.dispose();
      old.surface.dispose();
      flakeMaps.delete(i);
    }
    if (textured && !flakeMaps.has(i)) {
      const baked = bakeFlakes(1024, finish, p);
      const map = (data: Uint8Array) => {
        const t = new THREE.DataTexture(data, baked.size, baked.size);
        t.flipY = false;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        t.needsUpdate = true;
        return t;
      };
      flakeMaps.set(i, {
        key,
        normal: map(baked.normal),
        surface: map(baked.surface),
      });
    }
    const maps = flakeMaps.get(i);
    const changed = Boolean(m.normalMap) !== Boolean(maps);
    m.normalMap = maps?.normal ?? null;
    m.roughnessMap = m.metalnessMap = maps?.surface ?? null;
    m.roughness = textured
      ? 1
      : finish === "matte"
        ? 0.88
        : finish === "metallic" || finish === "iridescent"
          ? 0.27
          : finish === "glossy" ? 0.16 : 0.38;
    m.metalness = textured ? 1 : finish === "metallic" || finish === "iridescent" ? 0.65 : 0;
    // Optical studies only: these values have no proven REDengine mapping yet.
    // PhysicalMaterial setters recompile when a lobe is enabled/disabled.
    m.clearcoat = finish === "glossy" ? 1 : 0;
    m.clearcoatRoughness = 0.08;
    m.iridescence = finish === "iridescent" ? 1 : 0;
    m.iridescenceIOR = 1.3;
    m.iridescenceThicknessRange = [400, 400];
    if (changed) m.needsUpdate = true;
    plates[i].visible = l.enabled;
    textures[i].needsUpdate = true;
  }
  const deforming = [
    head,
    ...plates,
    ...Object.values(details).flatMap((d) => d.meshes),
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
    return {
      applied: names,
      appearanceReferences: group.appearances.length,
      matchedDetails,
    };
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
    eyeShape,
    applySavedV,
    details,
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
      if (!idle) return;
      animation = false; amount = 0; blink(0);
      camera.position.sub(idleFrameOffset); controls.target.sub(idleFrameOffset);
      idleFrameOffset.set(0,0,0);
      idle.setEnabled(enabled);
      if (enabled) {
        const anchor = idle.bindings.find(b => b.bone.name === "Head");
        if (anchor) idleFrameOffset.setFromMatrixPosition(anchor.bone.matrixWorld).sub(new THREE.Vector3().setFromMatrixPosition(anchor.worldBind));
        camera.position.add(idleFrameOffset); controls.target.add(idleFrameOffset);
      }
      controls.update();
    },
    setDetail: (name: string, v: boolean) => {
      if (details[name]) details[name].root.visible = v;
    },
    setBlink: (v: number) => {
      amount = v;
      animation = false;
    },
    animateBlink: (v: boolean) => (animation = v),
    setWire: (v: boolean) => {
      for (const m of materials) m.wireframe = v;
    },
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

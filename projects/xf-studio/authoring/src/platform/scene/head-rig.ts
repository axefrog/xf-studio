import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { extendSkin } from "../../skin";
import type { SavedV } from "../../saved-v";
import { IdleAnimation } from "../../idle-animation";
import type { PoseClip } from "../../pose-clip";
import { BUILT_IN_CATALOGUE, DEFAULT_IDLE, type IdleCatalogue, type IdleEntry } from "../../idle-catalogue";
import { activeEyeShape, GAME_BLINK_MISSING, IDLE_FACE_MISSING, IDLE_FACE_PREPARING, IDLE_MASCULINE, loadGameBlink, type GameBlink } from "../../game-blink";
import { loadIdleSource, type IdleSource } from "./idle-source";
import { composePreviewMotion } from "../../preview-motion";
import { FaceDriver, type FacePose, type FaceRigJoint } from "./face-driver";
import { createEyeMaterial, eyeParameters, prepareEyeballGeometry } from "../../eye-material";
import type { LoadedCoreDetail } from "../../core-detail-loader";
import type { CoreBody } from "../../render-detail";
import { morphTargetNames } from "../../head-skin-placement";
import { faceMorphChoiceIndex, faceMorphChoices, faceMorphWeights, followsFaceMorphChoices, type FaceMorphChoice } from "../../face-morphs";

/**
 * The head rig (feature-module platform §5, the platform's character context in the scene): the core head the preview derived from
 * the player's game files, its surfaces (the expanded eye plate) and fallback eye, the default skin shown until the V's resolved skin
 * arrives, the facial shapes every deforming mesh follows, and the rig motion (the game idle and the game's blink). It knows no
 * feature: a feature's parts join it through the scene port (`attach`), the V's resolved details through the character renderer.
 */

/** The rig's motion and why a part of it is missing (plain words for the motion panel). */
export type RigMotionAssets = { idle?: IdleAnimation; idleError: string;
  /**
   * Why the idle's face holds still while its body moves (empty when a face clip plays, or when there is no idle at all). While the host
   * is still reading the face it says so, and it changes once the face arrives (`onFaceChange`).
   */
  faceError?: string;
  /** Listen for the idle's face arriving (or turning out to be unreadable) after the idle started; returns the unsubscribe. */
  onFaceChange?(listener: () => void): () => void;
  blink?: GameBlink; blinkError: string;
  /** The game's preview idles prepared on this computer (idle-catalogue.ts); the built-in close-up entry when no catalogue was prepared. */
  idles?: IdleCatalogue;
  /** Load and play one of them (its body clip and baked face) on the idle's rigs; rejects with a plain reason when its files aren't there. */
  selectIdle?(id: string): Promise<void>;
  /**
   * Play a photo-mode pose's body clip on the idle's rigs (pose-clip.ts), keeping the idle's face clip; null plays the chosen idle's own
   * clips again. It changes clips only: turning the rig on is the motion rules' (preview-motion.ts `poseChanged`).
   */
  selectPose?(pose: PoseClip | null): Promise<void> };
/** The core eye as the motion loader may re-rig it (a rigid eye gets a gaze joint per side; the rig keeps the replacement). */
export type CoreEye = { readonly mesh: THREE.Mesh; readonly material: THREE.Material; replace(next: THREE.SkinnedMesh): void };
/**
 * Loads the rig's motion onto the scene's bones for a core head's body. The default reads the game idle from the host and the blink asset;
 * probes inject their own.
 */
export type MotionLoader = (scene: THREE.Scene, eye: CoreEye, body?: CoreBody) => Promise<RigMotionAssets>;

/**
 * The game idle (with the eyeballs given gaze joints when the core eye is rigid) and the game's blink. The idle comes from the host
 * (idle-source.ts): read from the player's game files, its body moves and its face moves as XF Studio's own facial solver solves it on the
 * host; where the face can't be read it holds still (`faceError`, the host's reason). The idle is the feminine V's, so a masculine head
 * holds still (`IDLE_MASCULINE`); the blink checks its own joints against the head (game-blink.ts).
 */
export const loadGameMotion: MotionLoader = async (scene, eye, body = "female") => {
  let idle: IdleAnimation | undefined, idleError = "", faceError = "";
  let source: IdleSource | undefined;
  // The first idle's clips, as loaded with the rig (so returning to it from a pose loads nothing).
  let firstBody: THREE.AnimationClip | undefined;
  // The face, when it arrives after the body (the game's idles: the face skeleton's rest holds the gaze pivots meanwhile).
  let lateFace: Promise<Awaited<ReturnType<IdleSource["face"]>>> | null = null;
  try {
    if (body !== "female") throw Error(IDLE_MASCULINE);
    source = await loadIdleSource();
    const first = source.first;
    // The body never waits for the face (PREV-174): the face joins the playing idle once the host has read it. A developer preparation
    // has no face rest for the gaze pivots, so its face (a local file) loads with the body as before.
    const faceOf = source.face(first).catch(() => null);
    const [clip, facial] = await Promise.all([source.body(first), source.faceRest ? Promise.resolve(null) : faceOf]);
    if (source.faceRest) { lateFace = faceOf; faceError = source.faceReason ?? IDLE_FACE_PREPARING; }
    else if (!facial) faceError = source.faceReason ?? IDLE_FACE_MISSING;
    // The legacy eyeball preview is rigid geometry. Give each disconnected eye
    // one authoritative eye-joint influence so gaze rotates around the game pivot.
    const eyes = eye.mesh;
    const pivots = facial?.scene ?? source.faceRest;
    if (!(eyes instanceof THREE.SkinnedMesh) && pivots) {
      pivots.updateMatrixWorld(true); scene.updateMatrixWorld(true);
      const eyeBones = ["l_J_eye_JNT","r_J_eye_JNT"].map(name => {
        const reference = pivots.getObjectByName(name);
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
      const skinned = new THREE.SkinnedMesh(geometry,eye.material);
      // Keep the eye component's own facial morph targets (eye shape) on the rigidly attached copy.
      if (eyes.morphTargetDictionary) {
        skinned.morphTargetDictionary = { ...eyes.morphTargetDictionary };
        skinned.morphTargetInfluences = [...(eyes.morphTargetInfluences ?? [])];
      }
      skinned.name="eyes"; skinned.position.copy(eyes.position);skinned.quaternion.copy(eyes.quaternion);skinned.scale.copy(eyes.scale);
      skinned.frustumCulled=false;
      eyes.parent!.add(skinned); scene.add(...eyeBones); scene.updateMatrixWorld(true);
      skinned.bind(new THREE.Skeleton(eyeBones),skinned.matrixWorld);
      eye.replace(skinned);
    }
    const targets: THREE.Object3D[] = [];
    scene.traverse(o => { if (o instanceof THREE.Bone) targets.push(o); });
    idle = new IdleAnimation(source.skeleton, clip, targets, source.ancestry, facial ? { source: facial.scene, clip: facial.clip,
      ...(facial.loopFrom !== undefined ? { loopFrom: facial.loopFrom } : {}) } : undefined);
    firstBody = clip;
    if (!idle.bindings.length) throw Error("Idle rig has no matching bones");
  } catch (error) {
    idle = undefined; idleError = (error as Error).message; faceError = ""; lateFace = null;
  }
  // The game's own blink (game-blink.ts), bound by name to every rig bone present now (the eyeball joints above included);
  // each V's details join it with the idle. Without the local asset the blink controls stay off with plain guidance.
  let blink: GameBlink | undefined, blinkError = "";
  try {
    const targets: THREE.Object3D[] = [];
    scene.updateMatrixWorld(true);
    scene.traverse(o => { if (o instanceof THREE.Bone) targets.push(o); });
    blink = await loadGameBlink(targets);
  } catch (error) {
    blink = undefined; blinkError = (error as Error).message || GAME_BLINK_MISSING;
  }
  // The latest catalogue (the eyes section joins it once the faces are known).
  const catalogue = (): IdleCatalogue => source?.catalogue ?? BUILT_IN_CATALOGUE;
  // Another idle: its body clip loaded once, then played on the same rigs (the clips share the rigs' joint names).
  const loaded = new Map<string, Promise<THREE.AnimationClip>>();
  if (firstBody && source) loaded.set(source.first.id, Promise.resolve(firstBody));
  const bodyOf = (entry: IdleEntry) => {
    let pending = loaded.get(entry.id);
    if (!pending) {
      pending = source!.body(entry);
      pending.catch(() => loaded.delete(entry.id));
      loaded.set(entry.id, pending);
    }
    return pending;
  };
  let idleId = source?.first.id ?? DEFAULT_IDLE;
  /** An idle's face: its own, else the close-up's face loop (the default idle's), where one was prepared. */
  const faceFor = async (entry: IdleEntry) => (await source!.face(entry)) ?? (entry.id === source!.first.id ? null : await source!.face(source!.first));
  const selectIdle = async (id: string) => {
    const entry = catalogue().idles.find(item => item.id === id);
    if (!idle || !entry || !source) throw Error("That idle isn't one of the game's idles on this computer.");
    const [bodyClip, face] = await Promise.all([bodyOf(entry), idle.facial ? faceFor(entry) : Promise.resolve(null)]);
    idle.setClips(bodyClip, face?.clip, face?.loopFrom);
    idleId = id;
  };
  const selectPose = async (pose: PoseClip | null) => {
    if (!idle) throw Error("V's motion couldn't be read, so she can't hold a pose.");
    if (pose) idle.setClips(pose.clip, undefined, undefined, { pose: true, moves: pose.moves });
    else if (idle.posing) await selectIdle(idleId);
  };
  const faceListeners = new Set<() => void>();
  const assets: RigMotionAssets = { idle, idleError, faceError, blink, blinkError, get idles() { return catalogue(); }, selectIdle, selectPose,
    onFaceChange(listener) { faceListeners.add(listener); return () => { faceListeners.delete(listener); }; } };
  // The face joins the idle when the host has read it: the chosen idle's (the first unless another was chosen meanwhile).
  if (lateFace && idle && source) {
    const playing = idle, from = source;
    void lateFace.then(async first => {
      const chosen = idleId === from.first.id ? first : await faceFor(catalogue().idles.find(item => item.id === idleId) ?? from.first).catch(() => null);
      if (chosen && !playing.facial) playing.setFace({ source: chosen.scene, clip: chosen.clip, ...(chosen.loopFrom !== undefined ? { loopFrom: chosen.loopFrom } : {}) });
      assets.faceError = playing.facial ? "" : from.faceReason ?? IDLE_FACE_MISSING;
      for (const listener of faceListeners) listener();
    });
  }
  return assets;
};

export type HeadRig = Awaited<ReturnType<typeof createHeadRig>>;

export async function createHeadRig(scene: THREE.Scene, core: LoadedCoreDetail, options: {
  /** Meshes beyond the core head's own that follow the facial shapes: meshes features attached with `morphs`, and the V's drawn details. */
  deforming(): readonly THREE.Mesh[];
  /** Releases for what the rig owns, run with the host's (newest first). */
  releases: (() => void)[];
  loadMotion?: MotionLoader;
}) {
  const { gltf, meshes, head } = core;
  let eyes = core.eyes;
  scene.add(gltf.scene);
  // The record's surfaces beside the head, by node key (CORE-89): today one, the expanded eye plate (`geometry.nodes.plate`), which eye
  // makeup's renderer draws on. The rig deforms and poses them with the head and knows nothing of what a feature draws there. They are
  // anchors, never drawn themselves (PREV-97): hidden, with a double-sided material skinned with all their influences, so a pick on
  // them lands where the drawn surface is; a feature copies them for what it draws.
  const surfaces: ReadonlyMap<string, THREE.SkinnedMesh> = new Map(core.surfaces);
  for (const surface of surfaces.values()) {
    const anchorMaterial = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
    options.releases.push(() => anchorMaterial.dispose());
    surface.visible = false;
    surface.material = anchorMaterial;
    extendSkin(surface, anchorMaterial);
  }
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
  // The core eye is the fallback: the base game's eye texture through the same eyeball material as a resolved eye
  // (eye-material.ts: colour sampled V-flipped, as the game's program does). The shown V's own eyes come with the
  // character record and replace it, a layered eye design included (drawn through the layered adapter).
  // The game's eye UV0 spans several tiles, so every eye texture repeats.
  eyeColor.wrapS = eyeColor.wrapT = THREE.RepeatWrapping;
  eyeColor.needsUpdate = true;
  const coreEye = createEyeMaterial({ albedo: eyeColor }, eyeParameters({ scalars: {} }));
  // Its tangent frame and per-eye vectors (the gaze rig below keeps this geometry).
  prepareEyeballGeometry([eyes.geometry]);
  const eyeMat = coreEye.material;
  options.releases.push(() => { eyeMat.dispose(); for (const texture of coreEye.owned) texture.dispose(); });
  eyes.material = eyeMat;
  if (eyes instanceof THREE.SkinnedMesh) extendSkin(eyes, eyeMat);
  const motion = await (options.loadMotion ?? loadGameMotion)(scene, { get mesh() { return eyes; }, material: eyeMat,
    replace(next) { meshes[meshes.indexOf(eyes)] = next; eyes.removeFromParent(); eyes = next; } }, core.body);
  const { idle, blink } = motion;
  const finalEyes = eyes;
  // The held expression's face driver (face-driver.ts): bound to the head's bones now, at their neutral pose, like the blink; its rig
  // arrives with the host's face data (`face.setRig`).
  const faceTargets: THREE.Object3D[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse(o => { if (o instanceof THREE.Bone) faceTargets.push(o); });
  const face = new FaceDriver(faceTargets, core.body === "male" ? "male" : "female");
  // One owner of the rig's bones at a time: the idle while enabled, else a held expression, else the blink (preview-motion.ts).
  const rigMotion = composePreviewMotion(idle, blink, face);
  /**
   * The idle's head displacement at phase zero, where stored cameras are measured from (neutral space), or zero while the idle is
   * off. Always derived at phase zero so restoring a paused or nonzero phase never adds a different offset. Measured without seeking, so
   * framing never restarts the hair simulation (PREV-133).
   */
  function idleOffset(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    return idle ? idle.offsetAt("Head", 0, out) : out;
  }
  // Every mesh with facial morph targets follows the character-creator morph choices. The eye
  // component carries its own `eyes` targets (a separate morph resource in the game), paired with
  // the head's by (target, region); see face-morphs.ts.
  const coreDeforming: THREE.Mesh[] = [
    head,
    ...surfaces.values(),
    ...(finalEyes.morphTargetDictionary ? [finalEyes] : []),
  ];
  const deforming = () => [...coreDeforming, ...options.deforming()];
  // The head is the authority for which eye shapes exist: its `eyes` targets in resource order.
  const eyeShapeChoices: FaceMorphChoice[] = faceMorphChoices(morphTargetNames(head), "eyes");
  const eyesFollowShape = followsFaceMorphChoices(morphTargetNames(finalEyes), eyeShapeChoices);
  function applyFaceMorph(choice: FaceMorphChoice) {
    for (const m of deforming()) {
      if (!m.morphTargetInfluences) continue;
      for (const [i, weight] of faceMorphWeights(morphTargetNames(m), choice.region, choice.target)) m.morphTargetInfluences[i] = weight;
    }
    // The blink turns the lids about the eye shape's own joint binds (game-blink.ts).
    blink?.setShape(activeEyeShape(head));
  }
  /** The eye shape the preview's own control chose last; it stays on top of the V's facial shape. */
  let shownEyeShape: number | null = null;
  function eyeShape(index: number) {
    const choice = eyeShapeChoices[index];
    if (!choice) throw Error("That eye shape is not in this head.");
    shownEyeShape = index;
    applyFaceMorph(choice);
  }
  /** Set every deforming mesh to exactly the named (target, region) pairs. */
  function setMorphs(names: readonly string[]) {
    for (const mesh of deforming()) {
      mesh.morphTargetInfluences?.fill(0);
      for (const name of names) {
        const i = mesh.morphTargetDictionary?.[name];
        if (i !== undefined) mesh.morphTargetInfluences![i] = 1;
      }
    }
  }
  /**
   * The V's facial shape from the character context (region → target pairs of the third-person group): every morph the head and its
   * plates carry is set to the pairs given (the base shape where none is), then the preview's eye shape is put back on top. Pairs the
   * head doesn't carry are skipped and returned.
   */
  function setFaceMorphs(morphs: readonly { region: string; target: string }[]): string[] {
    const names = morphs.map(m => `${m.target}_${m.region}`);
    const missing = names.filter(name => head.morphTargetDictionary?.[name] === undefined);
    setMorphs(names);
    if (shownEyeShape !== null && eyeShapeChoices[shownEyeShape]) applyFaceMorph(eyeShapeChoices[shownEyeShape]!);
    blink?.setShape(activeEyeShape(head));
    return missing;
  }
  function eyeShapeOptions() {
    return { choices: eyeShapeChoices.map(choice => ({ ...choice })), eyesFollow: eyesFollowShape,
      eyeSource: core.record.geometry.morphs?.find(entry => entry.node === core.record.geometry.nodes.eyes)?.depotPath ?? null };
  }
  function applySavedV(v: SavedV) {
    // The third-person head consumes `TPP`; `character_customization` (the creator puppet) can list fewer
    // morph regions (a new-game save stores only eyes and nose there, all five in TPP) [resource].
    const group =
      v.groups.head.find((g) => g.name === "TPP") ??
      v.groups.head.find((g) => g.name === "character_customization");
    if (!group)
      throw Error("No supported facial morph group found.");
    // A V of the other body is drawn on that body's own core head: the head attachment loads it (browser-head-attachment.ts),
    // so this head applies nothing of it.
    if (v.isMale !== (core.body === "male")) return { applied: [], appearanceReferences: group.appearances.length };
    // A V whose every face region is the base shape stores no morphs; that is the base head.
    const names = group.morphs.map((m) => `${m.target}_${m.region}`);
    // The head and its surfaces must carry every saved target (the surfaces are head cuts with all of the head's targets).
    for (const mesh of [head, ...surfaces.values()])
      for (const name of names)
        if (mesh.morphTargetDictionary?.[name] === undefined)
          throw Error(
            `This preview does not contain the saved facial morph ${name}`,
          );
    setMorphs(names);
    blink?.setShape(activeEyeShape(head));
    const savedEyes = group.morphs.find(m => m.region === "eyes");
    // No saved `eyes` pair means the base shape (`None`); the save stores only chosen morphs.
    const savedEyeShape = faceMorphChoiceIndex(eyeShapeChoices, savedEyes?.target ?? null);
    // The saved eye colour and piercings arrive with the character record (setCharacterDetails), like the skin, brows, lashes and hair.
    return {
      applied: names,
      appearanceReferences: group.appearances.length,
      ...(savedEyeShape === undefined ? {} : { eyeShape: savedEyeShape }),
    };
  }
  return {
    record: core.record, meshes, head, eyes: finalEyes, surfaces, albedo, roughness,
    /** The default skin the core head shows until (and unless) the V's resolved skin is drawn on it. */
    skin, coreEye,
    motion: { ...motion, rig: rigMotion },
    /**
     * The platform's facial pose sink (design §4 `FacialPosePort`): the face skeleton's rest once known, and the held expression's solved
     * pose. Holding or releasing hands the bones over by the motion rules (preview-motion.ts).
     */
    face: {
      setRig: (joints: readonly FaceRigJoint[]) => face.setRig(joints),
      hold(pose: FacePose) { face.hold(pose); rigMotion.faceChanged(); },
      release() { if (!face.holding) return; face.release(); rigMotion.faceChanged(); },
      get ready() { return face.ready; },
      get holding() { return face.holding; },
    },
    eyeShapeChoices, eyesFollowShape, idleOffset,
    eyeShape, setFaceMorphs, eyeShapeOptions, applySavedV,
    /** The default skin's normal map strength follows the viewer's normals toggle. */
    setNormals(enabled: boolean) { skin.normalScale.set(enabled ? 0.35 : 0, enabled ? -0.35 : 0); },
  };
}

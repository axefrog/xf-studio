import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { extendSkin } from "../../skin";
import type { SavedV } from "../../save-reader";
import { IdleAnimation } from "../../idle-animation";
import { activeEyeShape, GAME_BLINK_MISSING, loadGameBlink, type GameBlink } from "../../game-blink";
import { composePreviewMotion } from "../../preview-motion";
import { createEyeMaterial, eyeParameters, prepareEyeballGeometry } from "../../eye-material";
import type { LoadedCoreDetail } from "../../core-detail-loader";
import { morphTargetNames } from "../../head-skin-placement";
import { faceMorphChoiceIndex, faceMorphChoices, faceMorphWeights, followsFaceMorphChoices, type FaceMorphChoice } from "../../face-morphs";

/**
 * The head rig (feature-module platform §5, the platform's character context in the scene): the core head the preview derived from
 * the player's game files, its surfaces (the expanded eye plate) and fallback eye, the default skin shown until the V's resolved skin
 * arrives, the facial shapes every deforming mesh follows, and the rig motion (the game idle and the game's blink). It knows no
 * feature: a feature's parts join it through the scene port (`attach`), the V's resolved details through the character renderer.
 */

/** The rig's motion and why a part of it is missing (plain words for the motion panel). */
export type RigMotionAssets = { idle?: IdleAnimation; idleError: string; blink?: GameBlink; blinkError: string };
/** The core eye as the motion loader may re-rig it (a rigid eye gets a gaze joint per side; the rig keeps the replacement). */
export type CoreEye = { readonly mesh: THREE.Mesh; readonly material: THREE.Material; replace(next: THREE.SkinnedMesh): void };
/** Loads the rig's motion onto the scene's bones. The default reads the game idle and blink assets; probes inject their own. */
export type MotionLoader = (scene: THREE.Scene, eye: CoreEye) => Promise<RigMotionAssets>;

/** The game idle (with the eyeballs given gaze joints when the core eye is rigid) and the game's blink. */
export const loadGameMotion: MotionLoader = async (scene, eye) => {
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
    const eyes = eye.mesh;
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
    idle = new IdleAnimation(motion.scene, clip, targets, binding.ancestry, { source: facial.scene, clip: faceClip });
    if (!idle.bindings.length) throw Error("Idle rig has no matching bones");
  } catch (error) {
    idle = undefined; idleError = (error as Error).message;
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
  return { idle, idleError, blink, blinkError };
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
    replace(next) { meshes[meshes.indexOf(eyes)] = next; eyes.removeFromParent(); eyes = next; } });
  const { idle, blink } = motion;
  const finalEyes = eyes;
  // One owner of the rig's bones at a time: the idle while enabled, otherwise the blink (preview-motion.ts).
  const rigMotion = composePreviewMotion(idle, blink);
  /**
   * The idle's head displacement at phase zero, where stored cameras are measured from (neutral space), or zero while the idle is
   * off. Always derived at phase zero so restoring a paused or nonzero phase never adds a different offset.
   */
  function idleOffset(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    if (!idle?.enabled) return out;
    const time = idle.time;
    idle.seek(0);
    const anchor = idle.bindings.find(b => b.bone.name === "Head");
    if (anchor) out.setFromMatrixPosition(anchor.bone.matrixWorld).sub(new THREE.Vector3().setFromMatrixPosition(anchor.worldBind));
    idle.seek(time);
    return out;
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
    eyeShapeChoices, eyesFollowShape, idleOffset,
    eyeShape, setFaceMorphs, eyeShapeOptions, applySavedV,
    /** The default skin's normal map strength follows the viewer's normals toggle. */
    setNormals(enabled: boolean) { skin.normalScale.set(enabled ? 0.35 : 0, enabled ? -0.35 : 0); },
  };
}

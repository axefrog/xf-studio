import * as THREE from "three";
import { evaluateDeformationRig, type DeformationProgram, type Mat4 } from "./deformation-rig";

/** The game's axes (Z up) from glTF's (Y up): game = GAME_FROM_GLTF · gl · GAME_FROM_GLTF⁻¹ (WolvenKit's export convention). */
const GAME_FROM_GLTF = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
const GLTF_FROM_GAME = GAME_FROM_GLTF.clone().invert();

/** Compose decoded body motion and an offline-solved facial clip in world bind space. */
export class IdleAnimation {
  readonly mixer: THREE.AnimationMixer;
  readonly bindings: {
    bone: THREE.Object3D; driver: THREE.Object3D; inverseDriverBind: THREE.Matrix4;
    worldBind: THREE.Matrix4; position: THREE.Vector3; rotation: THREE.Quaternion; scale: THREE.Vector3;
    faceDriver?: THREE.Object3D; inverseFaceBind?: THREE.Matrix4;
  }[] = [];
  readonly unmapped: string[] = [];
  enabled = false;
  /**
   * Called after anything other than playback changes the pose or the playing state (enable, pause, seek,
   * contributions, bones joining or leaving), so a render-on-demand viewport draws it. `update` never calls it.
   */
  onChange?: () => void;
  private elapsed = 0;
  private playbackPaused = false;
  private bodyContribution = true;
  private faceContribution = true;
  /**
   * The body clip is a photo-mode pose (pose-clip.ts), not one of the game's idles: the face composes over it by the motion rules
   * (preview-motion.ts: the idle's face, or a held expression lent through `setFaceOverride`). `bodyMoves` is false for a held pose.
   */
  private posed = false;
  private bodyMoves = true;
  /** The face deltas to compose instead of the idle's face clip (a held expression over a pose), by bone name; null: the idle's own. */
  private faceOverride: (() => ReadonlyMap<string, THREE.Matrix4> | null) | null = null;
  private readonly delta = new THREE.Matrix4();
  private readonly local = new THREE.Matrix4();
  private readonly faceDelta = new THREE.Matrix4();
  private readonly faceMixer?: THREE.AnimationMixer;
  /** Driver lookups and their bind-pose inverses, kept so bones loaded later bind to the same neutral pose. */
  private readonly drivers = new Map<string, { driver: THREE.Object3D; inverseBind: THREE.Matrix4 }>();
  private readonly faceDrivers = new Map<string, { driver: THREE.Object3D; inverseBind: THREE.Matrix4 }>();
  /**
   * The puppet's deformation rigs (deformation-rig.ts): each rig joint the body clip doesn't key is driven by a virtual driver whose
   * world matrix is the joint's solved delta from its bind pose, so the body's helper joints move as the game's graph moves them.
   */
  private rigs: { program: DeformationProgram; driven: boolean[]; sources: (THREE.Object3D | string | null)[];
    outputs: { joint: number; driver: THREE.Object3D; inverseBind: THREE.Matrix4 }[] }[] = [];
  private readonly rigDrivers = new Set<string>();
  constructor(readonly source: THREE.Object3D, public clip: THREE.AnimationClip,
    targets: THREE.Object3D[], ancestry: Record<string, string | null>,
    readonly facial?: { source: THREE.Object3D; clip: THREE.AnimationClip }) {
    source.updateMatrixWorld(true);
    source.traverse(o => this.drivers.set(o.name, { driver: o, inverseBind: o.matrixWorld.clone().invert() }));
    if (facial) {
      facial.source.updateMatrixWorld(true);
      facial.source.traverse(o => this.faceDrivers.set(o.name, { driver: o, inverseBind: o.matrixWorld.clone().invert() }));
      this.faceMixer = new THREE.AnimationMixer(facial.source);
      this.faceMixer.clipAction(facial.clip).setLoop(THREE.LoopRepeat,Infinity).play();
    }
    this.ancestry = ancestry;
    this.bind(targets);
    this.mixer = new THREE.AnimationMixer(source);
    this.mixer.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play();
  }
  private readonly ancestry: Record<string, string | null>;
  /** The clip rig's bone segments at rest (a joint to each child joint), for placing helper joints the export gives no parent. */
  private segments?: { name: string; from: THREE.Vector3; to: THREE.Vector3 | null }[];
  /**
   * The driven joint whose rest segment lies nearest a point (within 0.25 m), or null. The body's helper, muscle and twist joints
   * (`l_deltoid_…_JNT`, `l_Wrist_0_JNT`) are exported as direct children of the armature with no joint parent, and the game drives them
   * by rig constraints the preview doesn't have; each moves rigidly with the limb segment it sits on (the forearm's twist joints with
   * the forearm) [hypothesis: an approximation of the game's corrective joints].
   */
  private nearestDriver(point: THREE.Vector3): string | null {
    if (!this.segments) {
      const rest = (object: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(this.drivers.get(object.name)!.inverseBind.clone().invert());
      this.segments = [];
      this.source.traverse(object => {
        if (!(object instanceof THREE.Bone) || this.drivers.get(object.name)?.driver !== object) return;
        const children = object.children.filter(child => child instanceof THREE.Bone && this.drivers.get(child.name)?.driver === child);
        const from = rest(object);
        if (!children.length) this.segments!.push({ name: object.name, from, to: null });
        for (const child of children) this.segments!.push({ name: object.name, from, to: rest(child) });
      });
    }
    let best: string | null = null, bestDistance = 0.25;
    const line = new THREE.Line3(), closest = new THREE.Vector3();
    for (const segment of this.segments) {
      const distance = segment.to ? line.set(segment.from, segment.to).closestPointToPoint(point, true, closest).distanceTo(point)
        : segment.from.distanceTo(point);
      if (distance < bestDistance) { bestDistance = distance; best = segment.name; }
    }
    return best;
  }
  private bind(targets: readonly THREE.Object3D[]) {
    for (const bone of targets) {
      let name: string | null = bone.name;
      // A bone neither clip drives follows its nearest driven ancestor: by the binding's ancestry (the head's joints), else by its own
      // skeleton's parents, else (a helper joint the export left without a joint parent) the rig segment it sits on (`nearestDriver`).
      const seen = new Set<string>();
      if (!this.drivers.has(bone.name) && !Object.hasOwn(this.ancestry, bone.name)) {
        let node: THREE.Object3D | null = bone.parent;
        while (node instanceof THREE.Bone && !this.drivers.has(node.name) && !Object.hasOwn(this.ancestry, node.name)) node = node.parent;
        bone.updateWorldMatrix(true, false);
        // Only a joint of a skeleton the clip drives (a sibling joint is driven by name: the body's exports list every joint flat under the
        // armature) takes the nearest segment; a bone kept still on purpose (a rigid part with no bone to follow: character-detail-loader.ts
        // `bindRigid`) stays unbound.
        const drivenSkeleton = !!bone.parent?.children.some(other => other instanceof THREE.Bone && this.drivers.has(other.name));
        name = node instanceof THREE.Bone ? node.name : bone.userData.xfsStill || !(drivenSkeleton || bone.userData.xfsFollow) ? null
          : this.nearestDriver(new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld));
      }
      while (name && !this.drivers.has(name) && !seen.has(name)) {
        seen.add(name); name = this.ancestry[name] ?? null;
      }
      if (!name || !this.drivers.has(name)) { this.unmapped.push(bone.name); continue; }
      const driver = this.drivers.get(name)!, face = this.faceDrivers.get(bone.name);
      this.bindings.push({ bone, driver: driver.driver, inverseDriverBind: driver.inverseBind,
        faceDriver: face?.driver, inverseFaceBind: face?.inverseBind,
        worldBind: bone.matrixWorld.clone(), position: bone.position.clone(), rotation: bone.quaternion.clone(), scale: bone.scale.clone() });
    }
    const depth = (o: THREE.Object3D): number => o.parent ? 1 + depth(o.parent) : 0;
    this.bindings.sort((a,b) => depth(a.bone)-depth(b.bone));
  }
  /**
   * Bind bones loaded after construction (a resolved detail's own rig copy). Their current pose must be the
   * neutral bind pose, which a freshly loaded detail has; the running phase is applied at once.
   */
  attach(targets: readonly THREE.Object3D[]) {
    if (!targets.length) return;
    this.bind(targets);
    if (this.enabled) this.update(0);
    this.onChange?.();
  }
  /** Forget bones that leave the scene (a replaced detail), restoring their neutral pose first. */
  detach(targets: readonly THREE.Object3D[]) {
    if (!targets.length) return;
    const leaving = new Set(targets);
    for (let i = this.bindings.length - 1; i >= 0; i--) {
      const binding = this.bindings[i]!;
      if (!leaving.has(binding.bone)) continue;
      binding.bone.position.copy(binding.position); binding.bone.quaternion.copy(binding.rotation); binding.bone.scale.copy(binding.scale);
      this.bindings.splice(i, 1);
    }
    for (let i = this.unmapped.length - 1; i >= 0; i--) if (targets.some(bone => bone.name === this.unmapped[i])) this.unmapped.splice(i, 1);
    this.onChange?.();
  }
  /**
   * Pose the joints the puppet's deformation rigs solve with those rigs (replacing any earlier ones). Bones bound before move to their
   * rig joint's driver; bones bound later find it by name. Without rigs, helper joints follow their nearest segment (`nearestDriver`).
   */
  setDeformations(programs: readonly DeformationProgram[]) {
    for (const name of this.rigDrivers) this.drivers.delete(name);
    const before = new Set(this.rigDrivers);
    this.rigDrivers.clear();
    this.rigs = programs.map(program => {
      const outputs: { joint: number; driver: THREE.Object3D; inverseBind: THREE.Matrix4 }[] = [];
      // A joint's pose comes from the body clip, else from a rig before this one (one bound to it), else from this rig.
      const sources: (THREE.Object3D | string | null)[] = [], driven: boolean[] = [];
      for (let i = 0; i < program.joints; i++) {
        const name = program.transforms[i]!.name, earlier = this.rigDrivers.has(name), clip = earlier ? undefined : this.drivers.get(name);
        sources.push(earlier ? name : clip?.driver ?? null); driven.push(earlier || !!clip);
        if (earlier || clip) continue;
        const driver = new THREE.Object3D();
        driver.name = name;
        driver.matrixAutoUpdate = driver.matrixWorldAutoUpdate = false;
        this.drivers.set(name, { driver, inverseBind: new THREE.Matrix4() });
        this.rigDrivers.add(name);
        outputs.push({ joint: i, driver, inverseBind: new THREE.Matrix4().fromArray(program.bind[i]!).invert() });
      }
      return { program, driven, sources, outputs };
    });
    // Helper joints already bound follow their rig joint from now on; ones a removed rig drove go back to their nearest segment.
    for (const binding of [...this.bindings]) {
      const name = binding.bone.name;
      if (this.rigDrivers.has(name)) {
        const rig = this.drivers.get(name)!;
        binding.driver = rig.driver; binding.inverseDriverBind = rig.inverseBind;
      } else if (before.has(name)) {
        this.bindings.splice(this.bindings.indexOf(binding), 1);
        binding.bone.position.copy(binding.position); binding.bone.quaternion.copy(binding.rotation); binding.bone.scale.copy(binding.scale);
        binding.bone.updateWorldMatrix(true, false);
        this.bind([binding.bone]);
      }
    }
    this.solveRigs();
    if (this.enabled) this.update(0);
    this.onChange?.();
  }
  /** Joints a deformation rig solves (none without one). */
  get rigJoints(): readonly string[] { return [...this.rigDrivers]; }
  private readonly rigMatrix = new THREE.Matrix4();
  /** Run each rig on the clip's current pose and set its virtual drivers: glTF-space deltas from the bind pose. */
  private solveRigs() {
    const solved = new Map<string, Mat4>();
    for (const rig of this.rigs) {
      const pose: Mat4[] = new Array(rig.program.transforms.length);
      for (let i = 0; i < rig.program.joints; i++) {
        const source = rig.sources[i];
        pose[i] = typeof source === "string" ? solved.get(source)!.slice()
          : source ? this.rigMatrix.copy(GAME_FROM_GLTF).multiply(source.matrixWorld).multiply(GLTF_FROM_GAME).toArray() : [];
      }
      evaluateDeformationRig(rig.program, pose, rig.driven);
      for (const output of rig.outputs) {
        solved.set(rig.program.transforms[output.joint]!.name, pose[output.joint]!);
        output.driver.matrixWorld.fromArray(pose[output.joint]!).multiply(output.inverseBind).premultiply(GLTF_FROM_GAME).multiply(GAME_FROM_GLTF);
      }
    }
  }
  /**
   * Play other clips on the same rigs (another of the game's preview idles): a body clip keyed on the body rig's joint names, and a face
   * clip on the face rig's (absent: the face keeps its clip). The phase carries over, wrapped into the new clips.
   */
  setClips(body: THREE.AnimationClip, face?: THREE.AnimationClip, options: { pose?: boolean; moves?: boolean } = {}) {
    this.posed = !!options.pose; this.bodyMoves = options.moves ?? true;
    this.mixer.stopAllAction();
    this.mixer.uncacheClip(this.clip);
    this.clip = body;
    this.mixer.clipAction(body).setLoop(THREE.LoopRepeat, Infinity).play();
    if (face && this.facial && this.faceMixer) {
      this.faceMixer.stopAllAction();
      this.faceMixer.uncacheClip(this.facial.clip);
      this.facial.clip = face;
      this.faceMixer.clipAction(face).setLoop(THREE.LoopRepeat, Infinity).play();
    }
    if (this.enabled) this.update(0);
    this.onChange?.();
  }
  /** Whether the body clip is a photo-mode pose. */
  get posing() { return this.posed; }
  /**
   * Whether playback changes the pose by itself: an idle always does; a held pose only through the idle's face (on, and not replaced by a
   * lent expression). A render-on-demand viewport draws continuously only while this holds.
   */
  get moving() { return this.bodyMoves || (this.faceContribution && !!this.facial && !this.faceOverride); }
  /** Compose these face deltas instead of the idle's face clip (null: the idle's own again), and recompose at the held phase. */
  setFaceOverride(source: (() => ReadonlyMap<string, THREE.Matrix4> | null) | null) {
    if (source === this.faceOverride) return;
    this.faceOverride = source;
    if (this.enabled) this.update(0);
    this.onChange?.();
  }
  /**
   * The body clip's joints (the rig the clips drive) as a box over `phases` evenly spread phases of the body clip (one for a held pose),
   * in the rig's space; the current phase is restored. For framing the posed body and keeping it inside the clip planes.
   */
  jointBounds(phases = 1): THREE.Box3 {
    const box = new THREE.Box3(), point = new THREE.Vector3(), time = this.elapsed;
    const count = this.bodyMoves ? Math.max(1, phases) : 1;
    for (let i = 0; i < count; i++) {
      this.mixer.setTime(this.clip.duration * i / count);
      this.source.updateMatrixWorld(true);
      this.source.traverse(object => { if (object instanceof THREE.Bone) box.expandByPoint(point.setFromMatrixPosition(object.matrixWorld)); });
    }
    this.mixer.setTime(time % this.clip.duration);
    this.source.updateMatrixWorld(true);
    return box;
  }
  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return;
    this.enabled = enabled; this.elapsed = 0; this.playbackPaused = false;
    if (enabled) this.update(0);
    else this.restore();
    this.onChange?.();
  }
  setPaused(paused: boolean) {
    this.playbackPaused = this.enabled && paused;
    this.onChange?.();
  }
  setContributions({ body, face }: { body?: boolean; face?: boolean }) {
    if (body !== undefined) this.bodyContribution = body;
    if (face !== undefined) this.faceContribution = face;
    // Recompose at the held phase, including when paused, so a muted source
    // cannot leave its previous world-space transform on a target.
    this.update(0);
    this.onChange?.();
  }
  restore() {
    for (const b of this.bindings) {
      b.bone.position.copy(b.position); b.bone.quaternion.copy(b.rotation); b.bone.scale.copy(b.scale);
      b.bone.updateWorldMatrix(false,false);
    }
  }
  seek(seconds: number) {
    this.elapsed = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    this.update(0);
    this.onChange?.();
  }
  update(seconds: number) {
    if (!this.enabled) return;
    if (!this.playbackPaused && Number.isFinite(seconds)) this.elapsed += Math.max(0, Math.min(seconds, .1));
    this.mixer.setTime(this.elapsed % this.clip.duration);
    if (this.facial && this.faceMixer) {
      this.faceMixer.setTime(this.elapsed % this.facial.clip.duration);
      this.facial.source.updateMatrixWorld(true);
    }
    this.source.updateMatrixWorld(true);
    this.solveRigs();
    const lent = this.faceOverride?.() ?? null;
    if (!this.bodyContribution && !this.faceContribution && !lent) {
      this.restore();
      return;
    }
    for (const b of this.bindings) {
      this.delta.identity();
      if (this.bodyContribution) this.delta.multiplyMatrices(b.driver.matrixWorld,b.inverseDriverBind);
      const faceDelta = lent?.get(b.bone.name);
      if (lent) { if (faceDelta) this.delta.multiply(faceDelta); }
      else if (this.faceContribution && b.faceDriver && b.inverseFaceBind) {
        this.faceDelta.multiplyMatrices(b.faceDriver.matrixWorld,b.inverseFaceBind);
        this.delta.multiply(this.faceDelta);
      }
      this.delta.multiply(b.worldBind);
      this.local.copy(b.bone.parent!.matrixWorld).invert().multiply(this.delta);
      this.local.decompose(b.bone.position,b.bone.quaternion,b.bone.scale);
      b.bone.updateWorldMatrix(false,false);
    }
  }
  get time() { return this.elapsed; }
  get paused() { return this.playbackPaused; }
  get bodyEnabled() { return this.bodyContribution; }
  get faceEnabled() { return this.faceContribution; }
}

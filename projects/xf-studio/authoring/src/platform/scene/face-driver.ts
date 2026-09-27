import * as THREE from "three";

/**
 * The face driver (research/animation/expression-editor-design.md §4, §5.1): a solved face pose on the preview's bones. The platform's
 * facial preview solves the held expression with the game's own facial setup (the external solver) and hands this driver each joint's
 * posed local transform in glTF axes; the driver applies it the way the blink and idle apply their baked rigs (game-blink.ts): a rig of
 * the face skeleton's rest pose drives every bone of the same name in world bind space, parent first, so the core head, the eye plate
 * and every detail's own skeleton copy (brows, lashes, eyes) follow.
 *
 * Its neutral pose is captured when bones bind (the head's when the motion loads, a detail's when it joins), before the idle or the
 * blink pose them. The rig's rest arrives later (with the host's face data) and is checked against the head: a skeleton whose joints
 * sit elsewhere is refused with a plain reason. Eye shapes keep the base seat (the idle's reading), unlike the blink [design choice for
 * phase 1; the per-shape seat is a hypothesis the blink session tests].
 *
 * It holds one pose (one frame) or a short clip (the blink over the expression at its own rate, repeating), and knows nothing of what
 * the pose means: which motion owns the bones is `preview-motion.ts`'s decision.
 */
export type FaceRigJoint = { readonly name: string; readonly parent: number; readonly t: readonly number[]; readonly r: readonly number[]; readonly s: readonly number[] };
/** One frame: the moved joints' local transforms (index into the rig), glTF axes. */
export type FaceFrame = ReadonlyMap<number, { readonly t: readonly number[]; readonly r: readonly number[] }>;
/** What the driver holds: a pose, or a clip at `rate` Hz that repeats every `repeat` seconds (its last frame holds between). */
export type FacePose = { readonly frames: readonly FaceFrame[]; readonly rate?: number; readonly repeat?: number };
/** How far (metres) a head bone's bind may sit from its rig joint's rest: 0.1 mm, as the blink allows. */
export const FACE_BIND_TOLERANCE = 1e-4;
export const FACE_OTHER_HEAD = "The face data doesn't match this head's skeleton, so live expressions are off for it.";

type Binding = { bone: THREE.Object3D; worldBind: THREE.Matrix4; position: THREE.Vector3; rotation: THREE.Quaternion; scale: THREE.Vector3;
  driver?: { node: THREE.Object3D; inverseBind: THREE.Matrix4 } };

export class FaceDriver {
  private bindings: Binding[] = [];
  private nodes: THREE.Object3D[] = [];
  private byName = new Map<string, { node: THREE.Object3D; inverseBind: THREE.Matrix4 }>();
  private root: THREE.Object3D | null = null;
  private rest: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }[] = [];
  private pose: FacePose | null = null;
  private elapsed = 0;
  private applied = false;
  private readonly delta = new THREE.Matrix4();
  private readonly local = new THREE.Matrix4();
  /** Called after a change that needs a frame drawn outside playback. */
  onChange?: () => void;

  /** Bind the head's bones now, capturing their neutral pose. */
  constructor(targets: readonly THREE.Object3D[]) { this.bind(targets); }

  /** Whether the rig's rest is known (the face data arrived and fits this head). */
  get ready() { return !!this.root; }
  /** Whether a pose is held (it is applied only while this driver owns the bones). */
  get holding() { return !!this.pose; }
  /** Whether the held pose changes by itself (the blink clip playing inside its frames). */
  get animating() {
    const pose = this.pose;
    return !!pose && pose.frames.length > 1 && !!pose.rate && this.elapsed < (pose.frames.length - 1) / pose.rate;
  }

  /**
   * The face skeleton's rest (glTF axes, rig order). Throws `FACE_OTHER_HEAD` when the head's bones of those names don't sit on it;
   * nothing then changes. Re-applies a held pose.
   */
  setRig(joints: readonly FaceRigJoint[]) {
    const root = new THREE.Group(), nodes: THREE.Object3D[] = [];
    joints.forEach((joint, index) => {
      const node = new THREE.Object3D();
      node.name = joint.name;
      node.position.fromArray(joint.t as number[]); node.quaternion.fromArray(joint.r as number[]).normalize(); node.scale.fromArray(joint.s as number[]);
      (joint.parent >= 0 && joint.parent < index ? nodes[joint.parent]! : root).add(node);
      nodes.push(node);
    });
    root.updateMatrixWorld(true);
    const byName = new Map(nodes.map(node => [node.name, { node, inverseBind: node.matrixWorld.clone().invert() }]));
    const at = new THREE.Vector3(), rest = new THREE.Vector3();
    for (const binding of this.bindings) {
      const driver = byName.get(binding.bone.name);
      if (driver && this.headBones.has(binding.bone) &&
        at.setFromMatrixPosition(binding.worldBind).distanceTo(rest.setFromMatrixPosition(driver.node.matrixWorld)) > FACE_BIND_TOLERANCE) throw Error(FACE_OTHER_HEAD);
    }
    this.root = root; this.nodes = nodes; this.byName = byName;
    this.rest = nodes.map(node => ({ position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() }));
    for (const binding of this.bindings) binding.driver = byName.get(binding.bone.name);
    if (this.applied) this.apply();
  }
  /** The head's own bones (checked against the rig); a detail's bones may bind elsewhere (some hair meshes do), as the blink allows. */
  private readonly headBones = new Set<THREE.Object3D>();

  /** Hold a pose (replacing any held one). Applies it only while `apply` is the owner's choice; returns whether it is new. */
  hold(pose: FacePose) {
    if (!pose.frames.length) throw Error("A face pose needs a frame.");
    this.pose = pose; this.elapsed = 0;
    if (this.applied) this.apply();
    this.onChange?.();
  }
  /** Forget the held pose; the bones are restored when this driver was applying it. */
  release() {
    const was = this.applied;
    this.pose = null; this.elapsed = 0;
    if (was) this.restore();
    this.onChange?.();
  }
  /** Start (true) or stop (false) writing the bones; stopping restores the captured neutral pose. */
  setApplied(applied: boolean) {
    if (applied === this.applied) return;
    this.applied = applied;
    if (applied) this.apply(); else this.restore();
  }
  get isApplied() { return this.applied; }
  /** Advance a held clip. */
  update(seconds: number) {
    const pose = this.pose;
    if (!pose || !this.applied || pose.frames.length < 2 || !pose.rate) return;
    const repeat = Math.max(pose.repeat ?? 0, (pose.frames.length - 1) / pose.rate);
    if (Number.isFinite(seconds)) this.elapsed = (this.elapsed + Math.max(0, Math.min(seconds, .1))) % (repeat || 1);
    this.apply();
    if (!this.animating) this.scheduleWake(repeat - this.elapsed);
  }
  private wake: ReturnType<typeof setTimeout> | null = null;
  private scheduleWake(seconds: number) {
    if (this.wake) return;
    this.wake = setTimeout(() => { this.wake = null; if (this.pose && this.applied) { this.elapsed = 0; this.onChange?.(); } }, Math.max(0, seconds) * 1000);
  }
  /** Bind bones loaded later (a detail's skeleton copy) in their neutral pose; a held, applied pose applies at once. */
  attach(targets: readonly THREE.Object3D[]) {
    if (!targets.length) return;
    this.bind(targets, false);
    if (this.applied) this.apply();
  }
  /** Forget bones that leave the scene, restoring their captured pose first. */
  detach(targets: readonly THREE.Object3D[]) {
    const leaving = new Set(targets);
    for (const binding of this.bindings) if (leaving.has(binding.bone)) this.put(binding);
    this.bindings = this.bindings.filter(binding => !leaving.has(binding.bone));
    for (const bone of targets) this.headBones.delete(bone);
  }
  dispose() { if (this.wake) clearTimeout(this.wake); this.wake = null; this.onChange = undefined; }

  private bind(targets: readonly THREE.Object3D[], head = true) {
    for (const bone of targets) {
      bone.updateWorldMatrix(true, false);
      this.bindings.push({ bone, worldBind: bone.matrixWorld.clone(), position: bone.position.clone(), rotation: bone.quaternion.clone(),
        scale: bone.scale.clone(), driver: this.byName.get(bone.name) });
      if (head) this.headBones.add(bone);
    }
    const depth = (o: THREE.Object3D): number => o.parent ? 1 + depth(o.parent) : 0;
    this.bindings.sort((a, b) => depth(a.bone) - depth(b.bone));
  }
  private put(binding: Binding) {
    binding.bone.position.copy(binding.position); binding.bone.quaternion.copy(binding.rotation); binding.bone.scale.copy(binding.scale);
    binding.bone.updateWorldMatrix(false, false);
  }
  /** Every bound bone back to its captured neutral pose. */
  restore() { for (const binding of this.bindings) if (binding.driver) this.put(binding); }
  private frame(): FaceFrame | undefined {
    const pose = this.pose;
    if (!pose) return undefined;
    if (pose.frames.length < 2 || !pose.rate) return pose.frames[0];
    return pose.frames[Math.min(pose.frames.length - 1, Math.round(this.elapsed * pose.rate))];
  }
  private apply() {
    const frame = this.frame();
    if (!this.root || !frame) { this.restore(); return; }
    this.nodes.forEach((node, index) => {
      const moved = frame.get(index), rest = this.rest[index]!;
      if (moved) { node.position.fromArray(moved.t as number[]); node.quaternion.fromArray(moved.r as number[]).normalize(); }
      else { node.position.copy(rest.position); node.quaternion.copy(rest.quaternion); }
      node.scale.copy(rest.scale);
    });
    this.root.updateMatrixWorld(true);
    for (const binding of this.bindings) {
      const driver = binding.driver;
      if (!driver) continue;
      this.delta.multiplyMatrices(driver.node.matrixWorld, driver.inverseBind).multiply(binding.worldBind);
      const parent = binding.bone.parent;
      if (parent) this.local.copy(parent.matrixWorld).invert().multiply(this.delta); else this.local.copy(this.delta);
      this.local.decompose(binding.bone.position, binding.bone.quaternion, binding.bone.scale);
      binding.bone.updateWorldMatrix(false, false);
    }
  }
}

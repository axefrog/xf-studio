import * as THREE from "three";
import { evaluateDeformationRig, type DeformationProgram, type Mat4 } from "./deformation-rig";
import { DANGLE_FRAME, DangleRig, type DangleInput, type DeltaOf } from "./dangle-motion";

/** The game's axes (Z up) from glTF's (Y up): game = GAME_FROM_GLTF · gl · GAME_FROM_GLTF⁻¹ (WolvenKit's export convention). */
const GAME_FROM_GLTF = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
const GLTF_FROM_GAME = GAME_FROM_GLTF.clone().invert();
/** A V joint at its bind pose; also marks a binding to a dangle driver (never written). */
const IDENTITY = new THREE.Matrix4();
/** The most dangle checkpoints kept for one loop of the idle (each a few kilobytes a simulated part). */
const CHECKPOINTS_PER_LOOP = 32;

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
  /**
   * The drawn parts' dangle components (dangle-motion.ts): their chain joints follow their own rig parents, and with physics on their
   * simulation runs on game frames of the motion clock (`DANGLE_FRAME`); `simTime` is the last frame's motion time.
   */
  private readonly dangles = new DangleRig();
  private physics = false;
  private simTime = 0;
  /** Joint names of the drawn dangle rigs, and whether one of them is a joint only a deformation rig solves (then the rigs run every frame). */
  private dangleNames = new Set<string>();
  private danglesNeedRigs = false;
  private readonly deltaMatrix = new THREE.Matrix4();
  /** A V joint's world delta now (identity while the body's contribution is off). */
  private readonly liveDelta: DeltaOf = name => {
    const found = this.drivers.get(name);
    if (!found) return null;
    return this.bodyContribution ? this.deltaMatrix.multiplyMatrices(found.driver.matrixWorld, found.inverseBind) : IDENTITY;
  };
  /** V at its bind pose (the idle off). */
  private readonly stillDelta: DeltaOf = name => this.drivers.has(name) ? IDENTITY : null;
  constructor(readonly source: THREE.Object3D, public clip: THREE.AnimationClip,
    targets: THREE.Object3D[], ancestry: Record<string, string | null>,
    readonly facial?: { source: THREE.Object3D; clip: THREE.AnimationClip;
      /**
       * A face clip that plays once up to here and loops from here to its end: a creator section's one-shot showcase before the loop
       * (idle-catalogue.ts `face.loopFrom`). Absent: the whole clip loops.
       */
      loopFrom?: number }) {
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
      // A chain joint of a part's dangle component follows that component's rig (P1) or simulation (P3), never the nearest body part
      // (PREV-110). The joints V has (the dangle rig's copies of `Head`, `Neck1`, …) bind to V's by name as before.
      const dangleKey = bone.userData.xfsDangle as string | undefined;
      const chain = dangleKey !== undefined && !this.drivers.has(bone.name) ? this.dangles.driverFor(dangleKey, bone.name) : undefined;
      if (chain) {
        bone.updateWorldMatrix(true, false);
        this.bindings.push({ bone, driver: chain, inverseDriverBind: IDENTITY, worldBind: bone.matrixWorld.clone(), position: bone.position.clone(),
          rotation: bone.quaternion.clone(), scale: bone.scale.clone() });
        continue;
      }
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
    else if (this.physics) this.applyDangleBindings();
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
    this.danglesNeedRigs = [...this.rigDrivers].some(name => this.dangleNames.has(name));
    // The dangles' base joints may follow the rigs: their run from the loop start is another one now.
    this.dropCheckpoints();
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
   * Play other clips on the same rigs (another of the game's preview idles, or a photo-mode pose with `options.pose`): a body clip keyed on
   * the body rig's joint names, and a face clip on the face rig's (absent: the face keeps its clip). The phase carries over, wrapped into
   * the new clips.
   */
  setClips(body: THREE.AnimationClip, face?: THREE.AnimationClip, faceLoopFrom?: number, options: { pose?: boolean; moves?: boolean } = {}) {
    // A photo-mode pose (pose-clip.ts) plays on the same rigs; a held one doesn't move by itself.
    this.posed = !!options.pose; this.bodyMoves = options.moves ?? true;
    this.dropCheckpoints();
    this.mixer.stopAllAction();
    this.mixer.uncacheClip(this.clip);
    this.clip = body;
    this.mixer.clipAction(body).setLoop(THREE.LoopRepeat, Infinity).play();
    if (face && this.facial && this.faceMixer) {
      this.faceMixer.stopAllAction();
      this.faceMixer.uncacheClip(this.facial.clip);
      this.facial.clip = face;
      this.facial.loopFrom = faceLoopFrom;
      this.faceMixer.clipAction(face).setLoop(THREE.LoopRepeat, Infinity).play();
      // A face with a one-shot showcase starts it now, as the creator does on entering its section.
      this.faceStart = faceLoopFrom !== undefined ? this.elapsed : 0;
    }
    if (this.enabled) { this.resetDangles(); this.update(0); }
    this.onChange?.();
  }
  /** Whether the body clip is a photo-mode pose. */
  get posing() { return this.posed; }
  /**
   * Whether playback changes the pose by itself: an idle always does; a held pose through the idle's face (on, and not replaced by a
   * lent expression) or simulated hair, which keeps swinging and settling on it. A render-on-demand viewport draws continuously only
   * while this holds.
   */
  get moving() { return this.bodyMoves || (this.faceContribution && !!this.facial && !this.faceOverride) || this.simulating(); }
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
    this.enabled = enabled; this.elapsed = 0; this.faceStart = 0; this.playbackPaused = false;
    this.dropCheckpoints();
    if (enabled) { this.resetDangles(); this.update(0); }
    else { this.restore(); this.stillDangles(); }
    this.onChange?.();
  }
  setPaused(paused: boolean) {
    // A paused idle freezes the hair where it is (as a paused world is predicted to in game, knowledge/hair-physics.md §5.1), so a paused
    // frame shows the motion at that moment; only V standing still (the idle off) shows the settled drape.
    this.playbackPaused = this.enabled && paused;
    this.onChange?.();
  }
  setContributions({ body, face }: { body?: boolean; face?: boolean }) {
    if (body !== undefined && body !== this.bodyContribution) this.dropCheckpoints();
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
  /**
   * Go to a motion time as if played from motion zero: a face's one-shot showcase counts from zero too (as when the idle is turned on), so
   * the pose at a sought time never depends on when its clips were chosen (PREV-134). Choosing clips during playback still starts the
   * showcase at that moment (`setClips`).
   */
  seek(seconds: number) {
    this.elapsed = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    this.faceStart = 0;
    this.resetDangles();
    this.update(0);
    this.onChange?.();
  }
  update(seconds: number) {
    if (!this.enabled) return;
    if (!this.playbackPaused && Number.isFinite(seconds)) this.elapsed += Math.max(0, Math.min(seconds, .1));
    if (this.simulating()) {
      // Game frames of the motion clock up to now, each on the pose at its own time; the body shows the last frame's pose, so the hair and
      // the body agree and a capture at a motion time doesn't depend on the display's frame rate (hair-physics-plan.md §3.5).
      this.runFrames();
      this.poseAt(this.simTime);
    } else {
      this.poseAt(this.elapsed);
      if (this.dangles.size) this.dangles.rigid(this.liveDelta);
    }
    // A held expression lent over a pose (preview-motion.ts) replaces the idle's face clip.
    const lent = this.faceOverride?.() ?? null;
    if (!this.bodyContribution && !this.faceContribution && !lent) {
      this.restore();
      return;
    }
    for (const b of this.bindings) {
      this.composeWorld(b, lent, this.delta);
      this.local.copy(b.bone.parent!.matrixWorld).invert().multiply(this.delta);
      this.local.decompose(b.bone.position,b.bone.quaternion,b.bone.scale);
      b.bone.updateWorldMatrix(false,false);
    }
  }
  /** A bound bone's world matrix from the drivers' current pose: body delta, then the face's (or a lent expression's), then its bind. */
  private composeWorld(b: IdleAnimation["bindings"][number], lent: ReadonlyMap<string, THREE.Matrix4> | null, into: THREE.Matrix4): THREE.Matrix4 {
    into.identity();
    if (this.bodyContribution) into.multiplyMatrices(b.driver.matrixWorld,b.inverseDriverBind);
    const faceDelta = lent?.get(b.bone.name);
    if (lent) { if (faceDelta) into.multiply(faceDelta); }
    else if (this.faceContribution && b.faceDriver && b.inverseFaceBind) {
      this.faceDelta.multiplyMatrices(b.faceDriver.matrixWorld,b.inverseFaceBind);
      into.multiply(this.faceDelta);
    }
    return into.multiply(b.worldBind);
  }
  /**
   * A bound bone's world displacement from its bind pose at a motion time (zero while the idle is off or nothing binds the bone), measured
   * without moving anything: no bone, clock or simulation changes (PREV-133). Framing the camera used to seek to 0 and back for this,
   * which restarted the hair simulation (a 72 mm tip jump) and re-simulated up to a whole loop.
   */
  offsetAt(name: string, time: number, out = new THREE.Vector3()): THREE.Vector3 {
    out.set(0, 0, 0);
    const b = this.enabled ? this.bindings.find(binding => binding.bone.name === name) : undefined;
    if (!b) return out;
    const lent = this.faceOverride?.() ?? null;
    if (!this.bodyContribution && !this.faceContribution && !lent) return out;
    this.poseAt(time);
    out.setFromMatrixPosition(this.composeWorld(b, lent, this.offsetMatrix)).sub(this.offsetBind.setFromMatrixPosition(b.worldBind));
    // Back to the pose `update` left: the last game frame's with physics on, else the motion clock's.
    this.poseAt(this.simulating() ? this.simTime : this.elapsed);
    return out;
  }
  private readonly offsetMatrix = new THREE.Matrix4();
  private readonly offsetBind = new THREE.Vector3();
  /** The body (and the rig-solved joints, when a dangle's base joints need them) at a motion time. */
  private poseBody(time: number) {
    this.mixer.setTime(time % this.clip.duration);
    this.source.updateMatrixWorld(true);
    if (this.danglesNeedRigs) this.solveRigs();
  }
  /** Everything the idle moves at a motion time: the body, the face and the deformation rigs. */
  private poseAt(time: number) {
    this.mixer.setTime(time % this.clip.duration);
    if (this.facial && this.faceMixer) {
      this.faceMixer.setTime(this.faceTimeAt(time));
      this.facial.source.updateMatrixWorld(true);
    }
    this.source.updateMatrixWorld(true);
    this.solveRigs();
  }
  /** Step the dangles' game frames from `simTime` up to the motion clock. */
  private runFrames() {
    while (this.simTime + DANGLE_FRAME <= this.elapsed + 1e-9) {
      this.simTime += DANGLE_FRAME;
      this.poseBody(this.simTime);
      this.dangles.step(this.liveDelta, DANGLE_FRAME);
      if (this.cleanRun === null || !this.checkpoints) continue;
      this.runFrame++;
      if (this.simTime >= this.cleanRun + this.clip.duration - 1e-9) this.cleanRun = null;
      else if (this.runFrame % this.checkpoints.every === 0 && !this.checkpoints.frames.has(this.runFrame))
        this.checkpoints.frames.set(this.runFrame, { simTime: this.simTime, state: this.dangles.snapshot() });
    }
  }
  private simulating() { return this.physics && this.dangles.simulated; }
  /**
   * Start the dangles again for the current state: with the idle on (playing or paused), settle at the clip's loop start and run the game
   * frames up to the motion clock, so the state at a motion time depends only on that time; with the idle off, settle on V's bind pose
   * (physics on) or leave the bind pose (physics off).
   */
  private resetDangles() {
    if (!this.dangles.size) return;
    if (!this.enabled) { this.stillDangles(); return; }
    if (!this.simulating()) return;
    const duration = this.clip.duration, loopStart = duration > 0 ? this.elapsed - (this.elapsed % duration) : 0;
    // Resume from the latest checkpoint of this loop's run at or before the motion time; else settle at the loop start.
    if (this.checkpoints?.loopStart !== loopStart)
      this.checkpoints = { loopStart, every: Math.max(60, Math.ceil(duration / DANGLE_FRAME / CHECKPOINTS_PER_LOOP)), frames: new Map() };
    let from: { frame: number; simTime: number; state: (Float64Array | null)[] } | null = null;
    for (const [frame, checkpoint] of this.checkpoints.frames)
      if (checkpoint.simTime <= this.elapsed + 1e-9 && (!from || frame > from.frame)) from = { frame, ...checkpoint };
    if (from) {
      this.simTime = from.simTime;
      this.poseBody(this.simTime);
      this.dangles.restore(from.state, this.liveDelta);
      this.runFrame = from.frame;
    } else {
      this.simTime = loopStart;
      this.poseBody(this.simTime);
      this.dangles.settle(this.liveDelta);
      this.runFrame = 0;
      this.checkpoints.frames.set(0, { simTime: this.simTime, state: this.dangles.snapshot() });
    }
    this.cleanRun = loopStart;
    this.runFrames();
  }
  /**
   * Checkpoints of the dangles' run from the current loop's start (PREV-133): the state at a motion time depends only on that time (the
   * run is settled at the loop start, then stepped), so a seek resumes from the latest checkpoint at or before it instead of simulating
   * from the loop start again; posing the body for every frame dominated that cost (56 ms for a 20 s clip, about 1.4 s at the 600 s
   * cap). One every `every` game frames (at most `CHECKPOINTS_PER_LOOP` a loop), recorded while a run from a loop start is uninterrupted
   * (`cleanRun`: seeks, and playback until the loop's end; past the seam playback carries on without a reset, so it no longer matches a
   * seek). Anything that changes the dangles' input drops them.
   */
  private checkpoints: { loopStart: number; every: number; frames: Map<number, { simTime: number; state: (Float64Array | null)[] }> } | null = null;
  private cleanRun: number | null = null;
  private runFrame = 0;
  private dropCheckpoints() { this.checkpoints = null; this.cleanRun = null; }
  /** With the idle off and physics on, the dangles settle on V's bind pose; only their chain joints move. */
  private stillDangles() {
    if (this.enabled || !this.dangles.size) return;
    if (!this.physics) { this.restoreDangleBindings(); return; }
    this.dangles.settle(this.stillDelta);
    this.applyDangleBindings();
  }
  /** Pose only the bones that follow a dangle driver (the idle off: nothing else of V moves). */
  private applyDangleBindings() {
    for (const b of this.bindings) {
      if (b.inverseDriverBind !== IDENTITY) continue;
      this.delta.copy(b.driver.matrixWorld).multiply(b.worldBind);
      this.local.copy(b.bone.parent!.matrixWorld).invert().multiply(this.delta);
      this.local.decompose(b.bone.position, b.bone.quaternion, b.bone.scale);
      b.bone.updateWorldMatrix(false, false);
    }
  }
  private restoreDangleBindings() {
    for (const b of this.bindings) {
      if (b.inverseDriverBind !== IDENTITY) continue;
      b.bone.position.copy(b.position); b.bone.quaternion.copy(b.rotation); b.bone.scale.copy(b.scale);
      b.bone.updateWorldMatrix(false, false);
    }
  }
  /**
   * The drawn parts' dangle components (replacing any earlier ones). Each part's bones are tagged with its key; its chain joints bind to its
   * rig's drivers (bones already bound are bound again). The simulation starts again from the rigid chains.
   */
  setDangles(parts: readonly DangleInput[]) {
    const tagged = new Set<THREE.Object3D>(parts.flatMap(part => part.bones));
    const rebind: THREE.Object3D[] = [];
    for (let i = this.bindings.length - 1; i >= 0; i--) {
      const binding = this.bindings[i]!;
      if (binding.bone.userData.xfsDangle === undefined && !tagged.has(binding.bone)) continue;
      binding.bone.position.copy(binding.position); binding.bone.quaternion.copy(binding.rotation); binding.bone.scale.copy(binding.scale);
      binding.bone.updateWorldMatrix(true, false);
      this.bindings.splice(i, 1);
      rebind.unshift(binding.bone);
    }
    for (const bone of rebind) delete bone.userData.xfsDangle;
    for (const part of parts) for (const bone of part.bones) bone.userData.xfsDangle = part.key;
    this.dangles.set(parts);
    this.dropCheckpoints();
    this.dangleNames = new Set(parts.flatMap(part => part.spec.joints.map(joint => joint.name)));
    this.danglesNeedRigs = [...this.rigDrivers].some(name => this.dangleNames.has(name));
    for (let i = this.unmapped.length - 1; i >= 0; i--) if (rebind.some(bone => bone.name === this.unmapped[i])) this.unmapped.splice(i, 1);
    if (rebind.length) this.bind(rebind);
    if (this.enabled) { this.resetDangles(); this.update(0); } else this.stillDangles();
    this.onChange?.();
  }
  /** Turn the dangles' simulation on or off (off: the chains follow their rig parents rigidly). */
  setPhysics(enabled: boolean) {
    if (enabled === this.physics) return;
    this.physics = enabled;
    this.dropCheckpoints();
    if (this.enabled) { this.resetDangles(); this.update(0); } else this.stillDangles();
    this.onChange?.();
  }
  /** Whether the dangles' simulation is on; how many drawn parts have a dangle component, and whether any has a simulation it runs. */
  get physicsEnabled() { return this.physics; }
  get dangleParts() { return this.dangles.size; }
  get simulatedDangles() { return this.dangles.simulated; }
  /** Plain notes on drawn parts whose dangles hang still. */
  dangleNotes() { return this.dangles.notes(); }
  /** Developer evidence: the dangle state and every chain bone's world position (glTF space, metres). */
  dangleEvidence() {
    const world = new THREE.Vector3();
    return { physics: this.physics, parts: this.dangles.size, simulated: this.dangles.simulated, simTime: this.simTime, notes: this.dangles.notes(),
      bones: this.bindings.filter(b => b.inverseDriverBind === IDENTITY).map(b => ({ part: String(b.bone.userData.xfsDangle), name: b.bone.name,
        at: b.bone.getWorldPosition(world).toArray().map(v => Math.round(v * 1e5) / 1e5) })) };
  }
  /** When the face's clip started (its one-shot plays from here): the phase a face with `loopFrom` was chosen at. */
  private faceStart = 0;
  /** The face clip's time now: the whole clip looping, or its one-shot part once and then its loop part (`loopFrom`). */
  faceTime(): number { return this.faceTimeAt(this.elapsed); }
  /** The face clip's time at a motion time (the dangles' game frames pose the face at their own times). */
  private faceTimeAt(at: number): number {
    const facial = this.facial;
    if (!facial) return 0;
    const duration = facial.clip.duration, from = facial.loopFrom;
    if (from === undefined || !(from > 0 && from < duration)) return at % duration;
    const time = Math.max(0, at - this.faceStart);
    return time < duration ? time : from + (time - from) % (duration - from);
  }
  get time() { return this.elapsed; }
  get paused() { return this.playbackPaused; }
  get bodyEnabled() { return this.bodyContribution; }
  get faceEnabled() { return this.faceContribution; }
}

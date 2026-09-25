import * as THREE from "three";

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
  private readonly delta = new THREE.Matrix4();
  private readonly local = new THREE.Matrix4();
  private readonly faceDelta = new THREE.Matrix4();
  private readonly faceMixer?: THREE.AnimationMixer;
  /** Driver lookups and their bind-pose inverses, kept so bones loaded later bind to the same neutral pose. */
  private readonly drivers = new Map<string, { driver: THREE.Object3D; inverseBind: THREE.Matrix4 }>();
  private readonly faceDrivers = new Map<string, { driver: THREE.Object3D; inverseBind: THREE.Matrix4 }>();
  constructor(readonly source: THREE.Object3D, readonly clip: THREE.AnimationClip,
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
  private bind(targets: readonly THREE.Object3D[]) {
    for (const bone of targets) {
      let name: string | null = bone.name;
      const seen = new Set<string>();
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
    if (!this.bodyContribution && !this.faceContribution) {
      this.restore();
      return;
    }
    for (const b of this.bindings) {
      this.delta.identity();
      if (this.bodyContribution) this.delta.multiplyMatrices(b.driver.matrixWorld,b.inverseDriverBind);
      if (this.faceContribution && b.faceDriver && b.inverseFaceBind) {
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

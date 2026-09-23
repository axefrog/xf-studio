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
  private elapsed = 0;
  private readonly delta = new THREE.Matrix4();
  private readonly local = new THREE.Matrix4();
  private readonly faceDelta = new THREE.Matrix4();
  private readonly faceMixer?: THREE.AnimationMixer;
  constructor(readonly source: THREE.Object3D, readonly clip: THREE.AnimationClip,
    targets: THREE.Object3D[], ancestry: Record<string, string | null>,
    readonly facial?: { source: THREE.Object3D; clip: THREE.AnimationClip }) {
    source.updateMatrixWorld(true);
    const drivers = new Map<string, THREE.Object3D>();
    source.traverse(o => drivers.set(o.name, o));
    const faceDrivers = new Map<string, THREE.Object3D>();
    if (facial) {
      facial.source.updateMatrixWorld(true);
      facial.source.traverse(o => faceDrivers.set(o.name,o));
      this.faceMixer = new THREE.AnimationMixer(facial.source);
      this.faceMixer.clipAction(facial.clip).setLoop(THREE.LoopRepeat,Infinity).play();
    }
    for (const bone of targets) {
      let name: string | null = bone.name;
      const seen = new Set<string>();
      while (name && !drivers.has(name) && !seen.has(name)) {
        seen.add(name); name = ancestry[name] ?? null;
      }
      if (!name || !drivers.has(name)) { this.unmapped.push(bone.name); continue; }
      const driver = drivers.get(name)!;
      const faceDriver = faceDrivers.get(bone.name);
      this.bindings.push({ bone, driver, inverseDriverBind: driver.matrixWorld.clone().invert(),
        faceDriver, inverseFaceBind: faceDriver?.matrixWorld.clone().invert(),
        worldBind: bone.matrixWorld.clone(), position: bone.position.clone(), rotation: bone.quaternion.clone(), scale: bone.scale.clone() });
    }
    const depth = (o: THREE.Object3D): number => o.parent ? 1 + depth(o.parent) : 0;
    this.bindings.sort((a,b) => depth(a.bone)-depth(b.bone));
    this.mixer = new THREE.AnimationMixer(source);
    this.mixer.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play();
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled; this.elapsed = 0;
    if (enabled) this.update(0);
    else this.restore();
  }
  restore() {
    for (const b of this.bindings) {
      b.bone.position.copy(b.position); b.bone.quaternion.copy(b.rotation); b.bone.scale.copy(b.scale);
      b.bone.updateWorldMatrix(false,false);
    }
  }
  update(seconds: number) {
    if (!this.enabled) return;
    this.elapsed += Math.max(0, Math.min(seconds, .1));
    this.mixer.setTime(this.elapsed % this.clip.duration);
    if (this.facial && this.faceMixer) {
      this.faceMixer.setTime(this.elapsed % this.facial.clip.duration);
      this.facial.source.updateMatrixWorld(true);
    }
    this.source.updateMatrixWorld(true);
    for (const b of this.bindings) {
      this.delta.multiplyMatrices(b.driver.matrixWorld,b.inverseDriverBind);
      if (b.faceDriver && b.inverseFaceBind) {
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
}

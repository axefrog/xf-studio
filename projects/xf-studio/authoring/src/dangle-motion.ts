/**
 * The preview's dangle components (hair-physics-plan.md §3.2–§3.5): per drawn part skinned to a dangle component, its rig's chains follow
 * their own rig parents (P1), and with physics on its simulation runs (dangle-solver.ts) on a fixed game-frame clock (P3). Three is used
 * only for the joint matrices; the pose it reads is a generic animated skeleton (a delta per V joint by name), so an idle, a pose or a
 * later animation source drives it alike.
 *
 * Space: the solver runs in the game's model space (Z up). A base joint's input is its V joint's world delta (glTF space) applied to the
 * rig's reference transform: `G·Δ·G⁻¹·ref`, the same delta the part's mesh bones follow. Each chain joint's output is written to a virtual
 * driver as a world delta `G⁻¹·out·ref⁻¹·G`, which the idle's binding applies to the mesh bone's bind pose.
 */
import * as THREE from "three";
import type { DangleSpec } from "./dangle-spec";
import { DangleSolver, POSE_STRIDE, referencePose, rigidChains, settleDangle } from "./dangle-solver";

/**
 * The game frame the preview simulates at: the game's substep count depends on its frame rate (knowledge/hair-physics.md §5.1), so the
 * preview reproduces a nominal 60 fps (two substeps a frame, 1.2 simulated seconds per second of motion) whatever the display's rate
 * (hair-physics-plan.md §3.5). One constant, to be revised by the calibration session.
 */
export const DANGLE_FRAME = 1 / 60;

const GAME_FROM_GLTF = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
const GLTF_FROM_GAME = GAME_FROM_GLTF.clone().invert();

/** A drawn part with a dangle component: its key (the record component's id), spec and mesh bones. */
export type DangleInput = { key: string; spec: DangleSpec; bones: readonly THREE.Object3D[] };
/** A V joint's world delta from its bind pose (glTF space), or null when V has no joint of that name. */
export type DeltaOf = (name: string) => THREE.Matrix4 | null;

type Instance = {
  key: string; spec: DangleSpec; solver: DangleSolver | null;
  /** The input pose (model space, stride 7) and which joints came from V this pass. */
  pose: Float64Array; base: boolean[];
  /** Per joint: its reference as a matrix (game space) and `ref⁻¹·G`. */
  reference: THREE.Matrix4[]; outputBind: THREE.Matrix4[];
  /** Virtual drivers of the joints V doesn't have (the chains), by name. */
  drivers: Map<string, THREE.Object3D>;
};

export class DangleRig {
  private instances = new Map<string, Instance>();
  private readonly m = new THREE.Matrix4();
  private readonly t = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly unit = new THREE.Vector3(1, 1, 1);

  /** Replace the parts (a new V or a changed hairstyle). Every part's simulation starts again from its rigid chains. */
  set(parts: readonly DangleInput[]) {
    this.instances = new Map(parts.map(part => {
      const { spec } = part;
      const reference = spec.reference.map(r => new THREE.Matrix4().compose(new THREE.Vector3(r[0], r[1], r[2]), new THREE.Quaternion(r[3], r[4], r[5], r[6]), this.unit));
      const drivers = new Map<string, THREE.Object3D>();
      for (const joint of spec.joints) {
        const driver = new THREE.Object3D();
        driver.name = joint.name;
        driver.matrixAutoUpdate = driver.matrixWorldAutoUpdate = false;
        drivers.set(joint.name, driver);
      }
      return [part.key, { key: part.key, spec, solver: spec.simulation ? new DangleSolver(spec, { initialSteps: DANGLE_FRAME / spec.simulation.substepTime }) : null,
        pose: referencePose(spec), base: spec.joints.map(() => false), reference, outputBind: reference.map(r => r.clone().invert().multiply(GAME_FROM_GLTF)), drivers }];
    }));
  }
  get size() { return this.instances.size; }
  /** Whether any part has a simulation the solver runs. */
  get simulated() { return [...this.instances.values()].some(instance => instance.solver); }
  /** Plain notes on parts that hang still (their graph isn't one the solver runs). */
  notes(): string[] {
    const notes = [...this.instances.values()].flatMap(instance => instance.spec.notes);
    if ([...this.instances.values()].some(instance => instance.solver?.unstable)) notes.push("A strand's simulation ran out of range and was put back on the head.");
    return [...new Set(notes)];
  }
  /** The virtual driver a part's joint follows (none for a joint the part doesn't have). */
  driverFor(key: string, name: string): THREE.Object3D | undefined { return this.instances.get(key)?.drivers.get(name); }
  /** Whether a part's joint takes its pose from V (a base joint) rather than from the rig. */
  isChainJoint(key: string, name: string, deltaOf: DeltaOf) { return !!this.instances.get(key)?.drivers.has(name) && !deltaOf(name); }

  /** P1: every chain joint follows its rig parent rigidly (the game with `alpha` 0). */
  rigid(deltaOf: DeltaOf) {
    for (const instance of this.instances.values()) { this.inputs(instance, deltaOf); this.outputs(instance, instance.pose); }
  }
  /** One game frame of `dt` seconds for every simulated part (the others rigid). */
  step(deltaOf: DeltaOf, dt: number) {
    for (const instance of this.instances.values()) {
      this.inputs(instance, deltaOf);
      if (!instance.solver) { this.outputs(instance, instance.pose); continue; }
      instance.solver.frame(instance.pose, dt);
      this.outputs(instance, instance.solver.out);
    }
  }
  /** Settle every simulated part on the held pose (the Studio's settle rule, dangle-solver.ts `settleDangle`); the others rigid. */
  settle(deltaOf: DeltaOf): number {
    let substeps = 0;
    for (const instance of this.instances.values()) {
      this.inputs(instance, deltaOf);
      if (!instance.solver) { this.outputs(instance, instance.pose); continue; }
      substeps += settleDangle(instance.solver, instance.pose, DANGLE_FRAME);
      this.outputs(instance, instance.solver.out);
    }
    return substeps;
  }

  /** The input pose: V's joints by name (`G·Δ·G⁻¹·ref`), the rest from their rig parents. */
  private inputs(instance: Instance, deltaOf: DeltaOf) {
    const { spec, pose, base } = instance;
    for (let i = 0; i < spec.joints.length; i++) {
      const delta = deltaOf(spec.joints[i]!.name);
      base[i] = !!delta;
      if (!delta) continue;
      this.m.copy(GAME_FROM_GLTF).multiply(delta).multiply(GLTF_FROM_GAME).multiply(instance.reference[i]!).decompose(this.t, this.q, this.s);
      const o = i * POSE_STRIDE;
      pose[o] = this.t.x; pose[o + 1] = this.t.y; pose[o + 2] = this.t.z;
      pose[o + 3] = this.q.x; pose[o + 4] = this.q.y; pose[o + 5] = this.q.z; pose[o + 6] = this.q.w;
    }
    rigidChains(spec, pose, base);
  }
  /** Each chain joint's driver: its world delta `G⁻¹·out·ref⁻¹·G`. */
  private outputs(instance: Instance, out: Float64Array) {
    const { spec } = instance;
    for (let i = 0; i < spec.joints.length; i++) {
      if (instance.base[i]) continue;
      const o = i * POSE_STRIDE;
      this.t.set(out[o]!, out[o + 1]!, out[o + 2]!); this.q.set(out[o + 3]!, out[o + 4]!, out[o + 5]!, out[o + 6]!);
      const driver = instance.drivers.get(spec.joints[i]!.name)!;
      driver.matrixWorld.compose(this.t, this.q, this.unit).premultiply(GLTF_FROM_GAME).multiply(instance.outputBind[i]!);
    }
  }
}

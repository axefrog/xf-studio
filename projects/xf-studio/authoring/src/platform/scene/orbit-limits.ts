import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { orbitDistanceLimits, SURFACE_CLEARANCE, type DistanceLimits, type Subject } from "../../camera-framing";

/**
 * Orbit controls that bring their distance limits up to date before every update. The wheel's dolly updates inside its own event,
 * and a damped step updates in the frame, so hooking `update` is the one place every zoom meets current limits.
 */
export class SceneOrbitControls extends OrbitControls {
  beforeUpdate: (() => void) | undefined;
  override update(deltaTime?: number | null): boolean {
    this.beforeUpdate?.();
    return super.update(deltaTime);
  }
}

export type OrbitLimitsOptions = {
  camera: THREE.PerspectiveCamera;
  controls: SceneOrbitControls;
  /** What the scene shows now, in world space (the idle's framing offset applied). */
  subjects(): readonly Subject[];
  /** The distances the framing jumps use at this lens and aspect (Front view, and Whole body while the body shows). */
  framing(fov: number, aspect: number): readonly number[];
  /** The head's surfaces the closest orbit keeps clear of (head, plate, eyes), and a sphere that encloses them. */
  surfaces(): readonly THREE.Object3D[];
  surfaceBounds(): Subject;
  /** Bring the scene's world matrices (and the skinned surfaces' bounds) up to date before a surface is measured. */
  updateWorld(): void;
  /** Timers for the measurement made once the camera comes to rest (default: the window's). */
  timers?: { set(callback: () => void, ms: number): unknown; clear(handle: unknown): void };
};

/** How far the target or the orbit direction may move before the head's surface is measured again (metres, radians). */
const REMEASURE = { target: .001, angle: .005 };
/** The head's surface is measured only while the camera is within this multiple of the farthest the surface can lie in front of the target. */
const REACH = 1.5;
/** How long the camera rests before the surface on its new orbit line is measured, so the next zoom needn't (ms). */
const REST_MS = 200;

/**
 * The scene host's orbit limits (camera-framing.ts `orbitDistanceLimits`): recomputed before every controls update from the lens,
 * the viewport's aspect, the target and what the scene shows, so a lens or pane change, a pan or the body turning on or off takes
 * effect at the next zoom.
 *
 * The closest orbit needs the head's surface on the orbit line, which a ray through the skinned head measures (tens of
 * milliseconds). It is measured only while the camera is near enough to the head for it to matter, once per orbit line: when the
 * camera comes to rest on a new line, when a gesture starts (a wheel step, a drag, a touch) on a line not yet measured, and during
 * a gesture that brought the camera into reach. A gesture keeps the surface it measured.
 */
export function createOrbitLimits(options: OrbitLimitsOptions) {
  const { camera, controls } = options;
  const timers = options.timers ?? { set: (callback: () => void, ms: number) => setTimeout(callback, ms), clear: (handle: unknown) => clearTimeout(handle as number) };
  const ray = new THREE.Raycaster();
  const offset = new THREE.Vector3(), direction = new THREE.Vector3(), centre = new THREE.Vector3();
  let measured: { target: THREE.Vector3; direction: THREE.Vector3; depth: number | undefined } | undefined;
  let gesture = false, gestureMeasured = false, rest: unknown;

  /** The current orbit line (false when the camera sits on its target). */
  function orbitLine(): boolean {
    offset.copy(camera.position).sub(controls.target);
    const distance = offset.length();
    if (!(distance > 0)) return false;
    direction.copy(offset).divideScalar(distance);
    return true;
  }
  const fresh = () => !!measured && orbitLine() &&
    measured.target.distanceTo(controls.target) < REMEASURE.target && measured.direction.angleTo(direction) < REMEASURE.angle;
  /** The orbit distance within which the head's surface can limit a zoom. */
  function reach(): number {
    const bounds = options.surfaceBounds();
    centre.set(bounds.centre[0], bounds.centre[1], bounds.centre[2]);
    return REACH * (controls.target.distanceTo(centre) + bounds.radius + SURFACE_CLEARANCE);
  }
  // With a little tolerance: a step stopped at the edge of reach (below) is within it.
  const inReach = () => camera.position.distanceTo(controls.target) <= reach() * (1 + 1e-6);
  /** Measure the head's surface depth in front of the target along the orbit line, unless it's out of reach (or `anywhere`) or already measured. */
  function measure(anywhere = false) {
    if (!anywhere && !inReach()) return;
    if (fresh()) { gestureMeasured = true; return; }
    if (!orbitLine()) return;
    const distance = camera.position.distanceTo(controls.target), surfaces = options.surfaces();
    let depth: number | undefined;
    if (surfaces.length) {
      options.updateWorld();
      // From outside the head toward the target, so the first hit is the outer surface facing the camera.
      const from = Math.max(distance, 1);
      ray.set(controls.target.clone().addScaledVector(direction, from), direction.clone().negate());
      ray.near = 0; ray.far = from;
      const hit = ray.intersectObjects([...surfaces], false)[0];
      depth = hit ? from - hit.distance : undefined;
    }
    measured = { target: controls.target.clone(), direction: direction.clone(), depth };
    gestureMeasured = true;
  }
  /**
   * The surface depth the limits use: the measured one on this orbit line, or during a gesture the one it measured. Out of reach and
   * unmeasured, the closest orbit is the edge of reach, so one large step (a fast pinch) can't cross into the head unmeasured: the
   * next starts within reach and measures.
   */
  function depth(): number | undefined {
    if (measured && (fresh() || (gesture && gestureMeasured))) return measured.depth;
    return inReach() ? undefined : reach() - SURFACE_CLEARANCE;
  }

  function limits(fov = camera.fov): DistanceLimits {
    return orbitDistanceLimits({ fov, aspect: camera.aspect, target: controls.target.toArray(),
      subjects: options.subjects(), framing: options.framing(fov, camera.aspect), surfaceDepth: depth(),
      current: camera.position.distanceTo(controls.target) });
  }
  const apply = () => {
    // A gesture that started out of reach (a long pinch) measures once it comes near.
    if (gesture && !gestureMeasured) measure();
    const next = limits();
    controls.minDistance = next.min; controls.maxDistance = next.max;
  };
  const start = () => { gesture = true; gestureMeasured = false; measure(); apply(); };
  const end = () => { gesture = false; };
  const change = () => {
    if (rest !== undefined) timers.clear(rest);
    rest = timers.set(() => { rest = undefined; if (!gesture) measure(); }, REST_MS);
  };
  controls.addEventListener("start", start);
  controls.addEventListener("end", end);
  controls.addEventListener("change", change);
  controls.beforeUpdate = apply;
  return {
    /**
     * The view's limits now, with the surface measured for the current orbit line. For a lens about to be set (`fov`) the surface is
     * measured from any distance, since a lens change can bring a far camera close in one step.
     */
    limits: (fov?: number) => { measure(fov !== undefined); return limits(fov); },
    dispose: () => {
      if (rest !== undefined) timers.clear(rest);
      controls.removeEventListener("start", start); controls.removeEventListener("end", end); controls.removeEventListener("change", change);
      controls.beforeUpdate = undefined;
    },
  };
}

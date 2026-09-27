/**
 * Whether a camera is still settling after the person let go (damped orbit, pan or zoom), so the on-demand render loop keeps drawing
 * until the motion is too small to see, then stops.
 *
 * Orbit controls report a step (`change`) only when it moves the camera more than their own threshold: 1 mm of position (squared
 * distance 1e-6) or the matching rotation. A damped step shrinks by the damping factor every frame, so near the camera's closest
 * framings the last steps fall under that threshold while a few millimetres of motion remain. Without another request the loop stopped
 * there, and the next unrelated frame (the pointer crossing a panel) played the rest (the camera "stopped early, then continued").
 * The controls still move the camera on every `update()`, whatever they report, so this watches the camera itself: a frame whose
 * camera moved more than `SETTLE_EPSILON` asks for the next one. What is left after a step that small is under a tenth of a pixel at
 * the closest framing.
 *
 * One per camera node of the view graph (research/authoring/view-graph-design.md §3.7): every view that shows the camera keeps drawing
 * while it settles, so a camera two views share keeps both of them drawing. DOM-free and renderer-free.
 */
export type SettlingCamera = {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
};
/** Squared distance (metres²) and the quaternion measure `8(1 - q·q')` below which a frame's camera step counts as settled. */
export const SETTLE_EPSILON = 1e-12;

export type CameraSettle = {
  /** Call after the frame's controls update: whether the camera (or its target) moved more than the epsilon since the last call. */
  step(): boolean;
  /** Whether the last step moved: the view needs another frame. */
  readonly settling: boolean;
  /** Take the camera's pose now as settled (it was placed on purpose: a jump is not a move to settle). */
  reset(): void;
};

export function createCameraSettle(camera: SettlingCamera, target: { x: number; y: number; z: number }, epsilon = SETTLE_EPSILON): CameraSettle {
  // position xyz, quaternion xyzw, target xyz
  const last = new Float64Array(10);
  let settling = false;
  const read = (into: Float64Array) => {
    into[0] = camera.position.x; into[1] = camera.position.y; into[2] = camera.position.z;
    into[3] = camera.quaternion.x; into[4] = camera.quaternion.y; into[5] = camera.quaternion.z; into[6] = camera.quaternion.w;
    into[7] = target.x; into[8] = target.y; into[9] = target.z;
  };
  const now = new Float64Array(10);
  // The pose it was created with counts as settled.
  read(last);
  return {
    step() {
      read(now);
      const position = (now[0]! - last[0]!) ** 2 + (now[1]! - last[1]!) ** 2 + (now[2]! - last[2]!) ** 2;
      const aim = (now[7]! - last[7]!) ** 2 + (now[8]! - last[8]!) ** 2 + (now[9]! - last[9]!) ** 2;
      const dot = now[3]! * last[3]! + now[4]! * last[4]! + now[5]! * last[5]! + now[6]! * last[6]!;
      settling = position > epsilon || aim > epsilon || 8 * (1 - Math.abs(dot)) > epsilon;
      last.set(now);
      return settling;
    },
    get settling() { return settling; },
    reset() { read(last); settling = false; },
  };
}

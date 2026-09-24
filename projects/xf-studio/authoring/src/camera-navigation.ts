import { MAX_CAMERA_DISTANCE, MIN_CAMERA_DISTANCE } from "./camera-framing";
import type { CameraState } from "./workspace-state";

/**
 * Pure orbit-camera navigation (audit A-5) over the persisted camera state, so keyboard,
 * menu and scripted navigation share one rule with the renderer's pointer controls: Y is
 * up, the camera orbits its target, distance stays within the controls' limits and the
 * polar angle never flips over a pole. Nothing here edits a recipe or creates Undo.
 */
export type CameraNavigation =
  | { kind: "orbit"; yaw: number; pitch: number }
  | { kind: "dolly"; factor: number }
  | { kind: "pan"; dx: number; dy: number };

const POLE = 1e-3;
type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const length = (a: V) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => { const n = length(a); return n > 0 ? scale(a, 1 / n) : [0, 0, 0]; };

export function validNavigation(command: CameraNavigation): string | undefined {
  const values = command.kind === "orbit" ? [command.yaw, command.pitch] : command.kind === "dolly" ? [command.factor] : [command.dx, command.dy];
  if (!values.every(Number.isFinite)) return "Camera navigation needs finite values.";
  if (command.kind === "dolly" && command.factor <= 0) return "A dolly factor must be greater than zero.";
}

/** `orbit` turns by radians (positive pitch raises the camera); `dolly` multiplies distance;
 * `pan` moves camera and target by fractions of the visible view height. */
export function navigateCamera(state: CameraState, command: CameraNavigation): CameraState {
  const position = state.position.slice(0, 3) as V, target = state.target.slice(0, 3) as V;
  const offset = sub(position, target), radius = length(offset);
  if (validNavigation(command) || !(radius > 0)) return structuredClone(state);
  if (command.kind === "orbit") {
    const theta = Math.atan2(offset[0], offset[2]) + command.yaw;
    const phi = Math.min(Math.PI - POLE, Math.max(POLE, Math.acos(Math.max(-1, Math.min(1, offset[1] / radius))) - command.pitch));
    const next: V = [radius * Math.sin(phi) * Math.sin(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.cos(theta)];
    return { ...structuredClone(state), position: add(target, next) };
  }
  if (command.kind === "dolly") {
    const distance = Math.min(MAX_CAMERA_DISTANCE, Math.max(MIN_CAMERA_DISTANCE, radius * command.factor));
    return { ...structuredClone(state), position: add(target, scale(offset, distance / radius)) };
  }
  const forward = unit(scale(offset, -1)), right = unit(cross(forward, [0, 1, 0]));
  const up = unit(cross(right, forward)), height = 2 * radius * Math.tan(state.fov * Math.PI / 360);
  const delta = add(scale(right, command.dx * height), scale(up, command.dy * height));
  return { ...structuredClone(state), position: add(position, delta), target: add(target, delta) };
}

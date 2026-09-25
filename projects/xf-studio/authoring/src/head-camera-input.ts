import { MOUSE, TOUCH } from "three";
import { modifierKey, modifiersOf, pointerBinding, pointerInputOf, type HeldModifiers, type ModifierKey,
  type PointerEffect, type PointerInput, type PointerTarget } from "./input-bindings";

/**
 * Head camera input: makes the binding catalogue, not three's OrbitControls, decide what every
 * pointer press does to the head camera (see research/authoring/input-bindings.md).
 *
 * OrbitControls has its own hidden rules: its mouse slots swap rotate and pan while Ctrl, Meta or
 * Shift is held. Left alone, Ctrl- or Shift-right-drag would orbit while the hint strip (generated
 * from the catalogue) says right-drag pans. So on
 * every press, in the capture phase before the controls see it, this adapter resolves the binding
 * for the pressed input, the target under the pointer and the exact modifiers, and sets the one
 * slot the controls will read (`mouseButtons.LEFT/MIDDLE/RIGHT`, `touches.ONE/TWO`, the public,
 * typed configuration) to the value that yields that effect. Anything that is not a camera effect,
 * or is unbound, gets `null`, which the controls treat as no action. Between presses every slot
 * rests at `null`, so no input can ever reach the library's defaults.
 *
 * The wheel is resolved by the surface editor, which consumes every wheel whose binding is not
 * `camera-zoom` before the controls see it; the controls' wheel handling has no modifier rules
 * that change the effect (Ctrl only scales pinch deltas).
 */

/** The effects the orbit controls perform. */
export type CameraEffect = Extract<PointerEffect, `camera-${string}`>;
export const CAMERA_EFFECTS: readonly CameraEffect[] = ["camera-orbit", "camera-pan", "camera-zoom", "camera-zoom-pan"];
export function isCameraEffect(effect: PointerEffect | undefined): effect is CameraEffect {
  return (CAMERA_EFFECTS as readonly string[]).includes(effect ?? "");
}

/** The camera effect the catalogue binds to this input, or undefined when the camera must not move. */
export function headCameraEffect(input: PointerInput, target: PointerTarget, mods: ModifierKey): CameraEffect | undefined {
  const effect = pointerBinding("head", input, target, mods)?.effect;
  return isCameraEffect(effect) ? effect : undefined;
}

/**
 * three 0.186 OrbitControls, `onMouseDown` (examples/jsm/controls/OrbitControls.js lines 1647-1740,
 * the swap in the `MOUSE.ROTATE` and `MOUSE.PAN` cases at lines 1686-1728):
 * a `MOUSE.ROTATE` slot pans and a `MOUSE.PAN` slot rotates while `event.ctrlKey || event.metaKey ||
 * event.shiftKey`; `MOUSE.DOLLY` never swaps; any other value (including `null`) does nothing.
 * Alt does not swap. Touch slots (`onTouchStart`, lines 1798-1880) have no modifier rules.
 * `HeldModifiers.ctrl` already folds Meta in, so the swap condition is Ctrl or Shift.
 * tests/head-camera-input.test.ts pins this rule and drives the real controls, so an upgrade that
 * changes it fails there.
 */
export function orbitSwapsSlots(held: HeldModifiers): boolean {
  return held.ctrl || held.shift;
}

/** The mouse slot value that makes the controls perform `effect` with these modifiers held. */
export function orbitMouseAction(effect: CameraEffect | undefined, held: HeldModifiers): MOUSE | null {
  const swapped = orbitSwapsSlots(held);
  switch (effect) {
    case "camera-orbit": return swapped ? MOUSE.PAN : MOUSE.ROTATE;
    case "camera-pan": return swapped ? MOUSE.ROTATE : MOUSE.PAN;
    case "camera-zoom": return MOUSE.DOLLY;
    default: return null;
  }
}

/** The touch slot value for the first (`drag`) or second (`two-finger-drag`) finger. */
export function orbitTouchAction(input: PointerInput, effect: CameraEffect | undefined): TOUCH | null {
  if (input === "drag") return effect === "camera-orbit" ? TOUCH.ROTATE : effect === "camera-pan" ? TOUCH.PAN : null;
  if (input === "two-finger-drag") return effect === "camera-zoom-pan" ? TOUCH.DOLLY_PAN : null;
  return null;
}

type Slot = { kind: "mouse"; name: "LEFT" | "MIDDLE" | "RIGHT"; value: MOUSE | null } | { kind: "touch"; name: "ONE" | "TWO"; value: TOUCH | null };
export type PressEvent = { button: number; pointerType?: string; isPrimary?: boolean } &
  { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean };

/**
 * The controls slot a press sets, and its value, given the target under the pointer. Undefined
 * for buttons the controls ignore (back/forward).
 */
export function orbitSlotFor(event: PressEvent, target: PointerTarget): Slot | undefined {
  const input = pointerInputOf(event);
  if (!input) return;
  const held = modifiersOf(event), effect = headCameraEffect(input, target, modifierKey(held));
  if (event.pointerType === "touch")
    return { kind: "touch", name: input === "two-finger-drag" ? "TWO" : "ONE", value: orbitTouchAction(input, effect) };
  const name = input === "drag" ? "LEFT" : input === "middle-drag" ? "MIDDLE" : input === "right-drag" ? "RIGHT" : undefined;
  return name && { kind: "mouse", name, value: orbitMouseAction(effect, held) };
}

/** The part of OrbitControls this adapter configures (public, typed properties only). */
export type OrbitSlots = {
  mouseButtons: { LEFT?: MOUSE | null; MIDDLE?: MOUSE | null; RIGHT?: MOUSE | null };
  touches: { ONE?: TOUCH | null; TWO?: TOUCH | null };
};
type InputElement = Pick<EventTarget, "addEventListener"> & { ownerDocument?: Pick<EventTarget, "addEventListener"> | null };
/** What is under a client point; the surface editor supplies it once mounted (until then, `empty`). */
export type TargetResolver = (clientX: number, clientY: number) => PointerTarget;

function rest(controls: OrbitSlots) {
  controls.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: null };
  controls.touches = { ONE: null, TWO: null };
}

/**
 * Attach to the head canvas right after creating its OrbitControls. The pointerdown listener is
 * capture-phase, so it runs before the controls' own listener (and before the surface editor's,
 * which is registered later and consumes presses that edit makeup).
 */
export function attachHeadCameraInput(element: InputElement, controls: OrbitSlots) {
  const listeners = new AbortController(), pressed = new Set<number>();
  let resolveTarget: TargetResolver | undefined;
  rest(controls);
  element.addEventListener("pointerdown", event => {
    const e = event as PointerEvent;
    const slot = orbitSlotFor(e, resolveTarget?.(e.clientX, e.clientY) ?? "empty");
    pressed.add(e.pointerId);
    if (slot?.kind === "mouse") controls.mouseButtons = { ...controls.mouseButtons, [slot.name]: slot.value };
    else if (slot) controls.touches = { ...controls.touches, [slot.name]: slot.value };
  }, { capture: true, signal: listeners.signal });
  // Pointer-up can land outside the canvas; the document sees them all (the canvas listener covers
  // a detached canvas). The controls re-read the first finger's slot when the second lifts, so
  // slots rest only once every press has ended.
  const release = (event: Event) => {
    if (!pressed.delete((event as PointerEvent).pointerId) || pressed.size) return;
    rest(controls);
  };
  for (const target of new Set([element, element.ownerDocument ?? element]))
    for (const type of ["pointerup", "pointercancel"])
      target.addEventListener(type, release, { capture: true, signal: listeners.signal });
  return {
    /** The surface editor's target resolution, or undefined to treat everything as `empty`. */
    setTargetResolver(resolver: TargetResolver | undefined) { resolveTarget = resolver; },
    dispose() { listeners.abort(); pressed.clear(); },
  };
}
export type HeadCameraInput = ReturnType<typeof attachHeadCameraInput>;

import type * as THREE from "three";
import type { GameBlink } from "./game-blink";
import type { IdleAnimation } from "./idle-animation";
import type { FaceDriver } from "./platform/scene/face-driver";
import type { DeformationProgram } from "./deformation-rig";
import type { DangleInput } from "./dangle-motion";

/** The parts of the idle and the blink the scene composes (IdleAnimation and GameBlink; test doubles may stand in). */
export type ComposedIdle = Pick<IdleAnimation, "enabled" | "paused" | "onChange" | "update" | "setEnabled" | "attach" | "detach"> &
  Partial<Pick<IdleAnimation, "setDeformations" | "setDangles" | "posing" | "moving" | "setFaceOverride">>;
export type ComposedBlink = Pick<GameBlink, "animating" | "onChange" | "update" | "reset" | "attach" | "detach" | "dispose"> &
  Partial<Pick<GameBlink, "setMuted">>;
/** The held expression's face driver (platform/scene/face-driver.ts). */
export type ComposedFace = Pick<FaceDriver, "holding" | "animating" | "onChange" | "update" | "setApplied" | "attach" | "detach" | "dispose"> &
  Partial<Pick<FaceDriver, "setLent" | "deltas">>;

/**
 * The game idle, a held expression and the game's blink on one preview rig (platform/scene/head-rig.ts). All write the same bones, so
 * exactly one owns them at a time: the idle while it is enabled (paused included), else a held expression, else the blink. The rules:
 *
 * - The render loop runs only while something moves by itself: a playing idle, a held expression's blink clip inside its frames, or
 *   Play blink inside its clip.
 * - Turning the idle on or off first returns the blink to the editing pose, so the idle starts from (and the blink returns to) the
 *   captured neutral pose. A held expression steps aside while the idle plays (the idle's facial solve is not additive; design §5.3)
 *   and comes back when it stops.
 * - While an expression is held the blink keeps its settings but writes nothing: the expression's solve includes the blink, as the
 *   game adds blink tracks before its facial solve. Releasing the expression gives the bones back to the blink.
 * - A detail's bones join the face and the blink before the idle: they capture their neutral pose, then a running idle poses them.
 * - **A photo-mode pose** is the idle's rig playing a pose clip (`idle.posing`; pose-library-design.md §5.2, decision Q5): poses and
 *   expressions combine. A held expression is lent to the idle (`face.setLent`, `idle.setFaceOverride`), which composes it over the posed
 *   body as it composes its own face clip; without one the pose keeps the idle's face (V blinks and glances while holding it). A held pose
 *   draws continuously only while something on it moves (a moving pose, the idle's face, or the lent expression's blink clip).
 */
export function composePreviewMotion(idle: ComposedIdle | undefined, blink: ComposedBlink | undefined, face?: ComposedFace) {
  const faceOwns = () => !!face?.holding && !idle?.enabled;
  const faceLent = () => !!face?.holding && !!idle?.enabled && !!idle.posing && !!face.setLent && !!idle.setFaceOverride;
  let lentTo: ComposedIdle | null = null;
  /** Give the bones to whoever owns them now. */
  const settle = () => {
    const owns = faceOwns(), lent = faceLent();
    blink?.setMuted?.(owns || lent);
    face?.setApplied(owns);
    face?.setLent?.(lent);
    if (lent && lentTo !== idle) { lentTo = idle!; idle!.setFaceOverride!(() => face!.deltas!()); }
    else if (!lent && lentTo) { lentTo.setFaceOverride?.(null); lentTo = null; }
  };
  return {
    /** Whether the viewport must keep drawing without further requests. */
    animating: () => idle?.enabled ? !idle.paused && ((idle.moving ?? true) || (faceLent() && !!face?.animating))
      : faceOwns() ? !!face?.animating : !!blink?.animating,
    /** One frame of playback. */
    advance(seconds: number) {
      if (idle?.enabled) {
        if (faceLent()) face!.update(seconds);
        // A lent expression's change reaches the bones through the idle's composition, paused or not.
        if (!idle.paused) idle.update(seconds); else if (faceLent()) idle.update(0);
      }
      else if (faceOwns()) face!.update(seconds);
      else blink?.update(seconds);
    },
    /** Turn the idle on or off; false when nothing changed (no idle, or already so). */
    setIdle(enabled: boolean): boolean {
      if (!idle || idle.enabled === enabled) return false;
      // The face and the blink leave the bones at the neutral pose before the idle starts; the face comes back after it stops.
      face?.setApplied(false);
      blink?.reset();
      idle.setEnabled(enabled);
      settle();
      return true;
    },
    /** A held expression began or ended (face-driver.ts `hold`/`release`): hand the bones over. */
    faceChanged() { settle(); },
    /**
     * The idle's rig began or stopped playing a photo-mode pose (head-rig.ts `selectPose`): turn it on for a pose without touching the
     * blink's or the face's neutral handover twice, then hand the face over. Returns whether the idle's enabled state changed.
     */
    poseChanged(): boolean {
      let changed = false;
      if (idle?.posing && !idle.enabled) { face?.setApplied(false); face?.setLent?.(false); blink?.reset(); idle.setEnabled(true); changed = true; }
      settle();
      return changed;
    },
    attach(bones: readonly THREE.Object3D[]) { face?.attach(bones); blink?.attach(bones); idle?.attach(bones); },
    /** The puppet's deformation rigs for the helper joints the details bring (the idle poses them; the blink never moves them). */
    setDeformations(programs: readonly DeformationProgram[]) { idle?.setDeformations?.(programs); },
    /** The drawn parts' dangle components (hair with physics): the idle poses their chains; the blink never moves them. */
    setDangles(parts: readonly DangleInput[]) { idle?.setDangles?.(parts); },
    detach(bones: readonly THREE.Object3D[]) { face?.detach(bones); blink?.detach(bones); idle?.detach(bones); },
    /** Ask for a frame whenever any of them changes the pose outside playback; returns the disconnect. */
    connect(invalidate: () => void) {
      if (idle) idle.onChange = invalidate;
      if (blink) blink.onChange = invalidate;
      if (face) face.onChange = invalidate;
      return () => { if (idle) idle.onChange = undefined; blink?.dispose(); face?.dispose(); };
    },
  };
}

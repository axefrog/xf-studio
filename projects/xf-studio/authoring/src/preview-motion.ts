import type * as THREE from "three";
import type { GameBlink } from "./game-blink";
import type { IdleAnimation } from "./idle-animation";

/** The parts of the idle and the blink the scene composes (IdleAnimation and GameBlink; test doubles may stand in). */
export type ComposedIdle = Pick<IdleAnimation, "enabled" | "paused" | "onChange" | "update" | "setEnabled" | "attach" | "detach">;
export type ComposedBlink = Pick<GameBlink, "animating" | "onChange" | "update" | "reset" | "attach" | "detach" | "dispose">;

/**
 * The game idle and the game's blink on one preview rig (scene.ts). Both write the same bones, so exactly one owns them
 * at a time: the idle while it is enabled (paused included), otherwise the blink. The rules:
 *
 * - The render loop runs only while something moves by itself: a playing idle, or Play blink inside its clip.
 * - Turning the idle on or off first returns the blink to the editing pose, so the idle starts from (and the blink
 *   returns to) the captured neutral pose.
 * - A detail's bones join the blink before the idle: the blink captures their neutral pose, then a running idle poses
 *   them. They leave both.
 */
export function composePreviewMotion(idle: ComposedIdle | undefined, blink: ComposedBlink | undefined) {
  return {
    /** Whether the viewport must keep drawing without further requests. */
    animating: () => idle?.enabled ? !idle.paused : !!blink?.animating,
    /** One frame of playback. */
    advance(seconds: number) {
      if (idle?.enabled) { if (!idle.paused) idle.update(seconds); }
      else blink?.update(seconds);
    },
    /** Turn the idle on or off; false when nothing changed (no idle, or already so). */
    setIdle(enabled: boolean): boolean {
      if (!idle || idle.enabled === enabled) return false;
      blink?.reset();
      idle.setEnabled(enabled);
      return true;
    },
    attach(bones: readonly THREE.Object3D[]) { blink?.attach(bones); idle?.attach(bones); },
    detach(bones: readonly THREE.Object3D[]) { blink?.detach(bones); idle?.detach(bones); },
    /** Ask for a frame whenever either changes the pose outside playback; returns the disconnect. */
    connect(invalidate: () => void) {
      if (idle) idle.onChange = invalidate;
      if (blink) blink.onChange = invalidate;
      return () => { if (idle) idle.onChange = undefined; blink?.dispose(); };
    },
  };
}

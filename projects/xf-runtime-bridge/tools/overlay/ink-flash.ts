// The ink panel's answer feedback flash (bridge 0.8.22), mirrored from redscript/XFRuntimeBridgeInk.reds (XFInkStyle.FlashHold,
// FlashEase, FlashRestOpacity and XFInkPanel.Step) so tools/test can check the timing offline. The Studio's in-game motion rule: the
// old flash alternated the danger and resting colours every 0.15 s for 0.9 s (about 3.3 changes a second, near the
// three-flashes-a-second limit); now one hold in the danger colour for 0.45 s, then an ease back over 0.25 s.
//
// The game's styles can't be blended, so the ease is the resting colour coming back at a rising opacity: 0.3 at the end of the hold,
// 1 at the end of the ease, along an ease-out curve.

export const FLASH_HOLD_S = 0.45;
export const FLASH_EASE_S = 0.25;
export const FLASH_TOTAL_S = FLASH_HOLD_S + FLASH_EASE_S;
export const FLASH_REST_FLOOR = 0.3;

/** The resting colour's opacity `elapsed` seconds into the flash (XFInkStyle.FlashRestOpacity). */
export function restOpacity(elapsed: number): number {
  const t = (elapsed - FLASH_HOLD_S) / FLASH_EASE_S;
  if (t <= 0) return FLASH_REST_FLOOR;
  if (t >= 1) return 1;
  const eased = 1 - (1 - t) * (1 - t);
  return FLASH_REST_FLOOR + (1 - FLASH_REST_FLOOR) * eased;
}

export type FlashFrame = { colour: "danger" | "rest"; opacity: number };

/** What XFInkPanel.Step draws `elapsed` seconds into the flash, or null once it has ended (the chips are back to rest). */
export function flashFrame(elapsed: number): FlashFrame | null {
  if (elapsed >= FLASH_TOTAL_S) return null;
  if (elapsed < FLASH_HOLD_S) return { colour: "danger", opacity: 1 };
  return { colour: "rest", opacity: restOpacity(elapsed) };
}

/** Plays the flash at a frame rate and counts the times the colour changes (the old flash made about 3.3 a second). */
export function simulate(fps: number): { changes: number; seconds: number; changesPerSecond: number; maxOpacityStep: number /* the largest opacity step between two frames of one colour */ } {
  const dt = 1 / fps;
  let changes = 0;
  let previous: FlashFrame["colour"] = "rest"; // before the flash the answers rest
  let lastOpacity = 1;
  let maxOpacityStep = 0;
  let t = dt;
  for (; t < FLASH_TOTAL_S + dt; t += dt) {
    const frame = flashFrame(t) ?? { colour: "rest" as const, opacity: 1 };
    if (frame.colour !== previous) changes++;
    else maxOpacityStep = Math.max(maxOpacityStep, Math.abs(frame.opacity - lastOpacity)); // the ease itself, not the one colour change
    previous = frame.colour;
    lastOpacity = frame.opacity;
  }
  return { changes, seconds: FLASH_TOTAL_S, changesPerSecond: changes / FLASH_TOTAL_S, maxOpacityStep };
}

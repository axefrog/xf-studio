/**
 * The game blink's plain words and Studio timing (game-blink.ts), kept free of Three.js so the motion actions and the
 * presentation's snapshot can use them.
 */

/**
 * Play blink repeats the game's clip every this many seconds. The clip has no repeat of its own; this is the average
 * spacing of the nine blinks in the character-creator close-up idle (onsets from 0.73 s to 20.30 s), a Studio choice
 * grounded in that clip rather than a game timing.
 */
export const BLINK_REPEAT_SECONDS = 2.45;
/**
 * The blink asset was never prepared on this computer (or can't be fetched). Preparing it needs developer tools, so a person is
 * told plainly that it isn't there, with nothing to do (UI-86).
 */
export const GAME_BLINK_MISSING = "The game's blink isn't part of this version of XF Studio yet. The idle blinks on its own.";
/** The asset is there but isn't a readable blink (cut short, overwritten, not a GLB). */
export const GAME_BLINK_DAMAGED = "The prepared blink is damaged; prepare it again.";
/** The asset reads, but none of its joints are in the preview head's skeleton. */
export const GAME_BLINK_NO_JOINTS = "The prepared blink has none of this head's eyelid joints, so it can't move the eyes; prepare it again from this head's game files.";
/** The asset's joints have this head's names but sit elsewhere (another body type's or a modded skeleton). */
export const GAME_BLINK_OTHER_HEAD = "The prepared blink was made for a different head, so its eyelids would turn about the wrong places; prepare it again from this head's game files.";

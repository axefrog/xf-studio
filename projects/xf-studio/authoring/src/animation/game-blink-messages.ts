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
 * The idle prepared today is the feminine V's (her body clip, and her face clip solved for her head); a masculine V has his own clips
 * (`ui_male.anims`, `ui_male_face.anims`), not prepared yet (male V plan phase 2), so his head holds still rather than play hers.
 * Here beside the blink's words so the scene's rig and the motion actions share it.
 */
export const IDLE_MASCULINE = "The character creator's idle for a masculine V isn't part of this version of XF Studio yet, so he holds still. Everything else works.";
/**
 * The idle's face couldn't be read: the body idle and its face are read from the game files and the face solved by XF Studio's own facial
 * solver, but here that didn't work (the host usually gives its own reason instead). The body moves and the face holds still, and the Motion
 * panel says so (DESK-02).
 */
export const IDLE_FACE_MISSING = "V's face holds still during the idle: XF Studio couldn't read it from your game files.";
/** The idle's face is still being read (a progress state; the face moves once it's ready). */
export const IDLE_FACE_PREPARING = "Reading V's face from your game files… It moves once it's ready.";
/**
 * The blink couldn't be read from the game files (the host usually gives its own reason instead): a person is told plainly, with nothing
 * to do (UI-86). It claims nothing about the idle, whose face may hold still too (DESK-04).
 */
export const GAME_BLINK_MISSING = "XF Studio couldn't read the game's blink from your game files.";
/** The blink's data isn't readable (cut short, overwritten, not a blink); a rare failure with nothing for the person to do (UI-86). */
export const GAME_BLINK_DAMAGED = "XF Studio couldn't read the game's blink: its data is damaged.";
/** The blink reads, but none of its joints are in the preview head's skeleton. */
export const GAME_BLINK_NO_JOINTS = "The game's blink has none of this head's eyelid joints, so it can't move V's eyes.";
/** The blink's joints have this head's names but sit elsewhere (another body type's or a modded skeleton). */
export const GAME_BLINK_OTHER_HEAD = "The game's blink was made for a different head, so its eyelids would turn about the wrong places.";

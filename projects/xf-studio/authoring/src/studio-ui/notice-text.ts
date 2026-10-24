/** The workspace notice's messages (style guide t-unprotected, t-recovering) and the library chip's widest words, shared by the Studio and its style guide. */
/**
 * A change's backup on this computer couldn't be written (t-unprotected). Each change is held in memory at once and backed up within
 * about a quarter of a second, before the library has it; without that backup, closing XF Studio before the library has the change
 * would lose it. The sentence says that consequence, never "protected" (which reads as security).
 */
export const UNPROTECTED = "Your latest changes couldn't be backed up on this computer. If XF Studio closes before your library has them, they could be lost.";
export const BACKUP_PENDING = "Your latest changes are still being backed up on this computer. Keep XF Studio open until your library has them, or export this window's copy to keep them.";
export const BACKUP_STORAGE_FULL = "Storage on this computer is full, so your latest changes couldn't be backed up. Free up some space, then try again. Keep XF Studio open until your library has them, or export this window's copy to keep them.";
export const RESTORING = "Restoring changes from your last session…";
export const RESTORING_LONG = "Restoring changes from your last session is taking a while.";
export const RESTORING_UNCONFIRMED = `${RESTORING_LONG} Your library hasn't confirmed them yet.`;
export const MISSING_SAVE = "Some restored changes need a game save that's no longer on this computer. Import it again, or discard them.";

/** The library chip's widest words (c-chips): the header keeps room for the widest, so the chip changing moves nothing (header-fit.ts). */
export const LIBRARY_CHIP_WIDEST: readonly string[] = ["Changed since last version", "Newer version saved", "Loading library…", "No version yet"];

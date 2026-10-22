/** The workspace notice's messages (style guide t-unprotected, t-recovering), shared by the Studio and its style guide. */
/**
 * A change's backup on this computer couldn't be written (t-unprotected). Each change is held in memory at once and backed up within
 * about a quarter of a second, before the library has it; without that backup, closing XF Studio before the library has the change
 * would lose it. The sentence says that consequence, never "protected" (which reads as security).
 */
export const UNPROTECTED = "Your latest changes couldn't be backed up on this computer. If XF Studio closes before your library has them, they could be lost.";
export const RESTORING = "Restoring changes from your last session…";
export const RESTORING_LONG = "Restoring changes from your last session is taking a while.";
export const MISSING_SAVE = "Some restored changes need a game save that's no longer on this computer. Import it again, or discard them.";

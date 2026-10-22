/** The workspace notice's messages (style guide t-unprotected, t-recovering), shared by the Studio and its style guide. */
export const UNPROTECTED = "Your latest changes aren't protected on this computer.";
export const RESTORING = "Restoring changes from your last session…";
export const RESTORING_LONG = "Restoring changes from your last session is taking a while.";
export const MISSING_SAVE = "Some restored changes need a game save that's no longer on this computer. Import it again, or discard them.";
/** Discard those changes' confirmation (t-recovering, c-confirm): what goes, and that it can't be got back. */
export const DISCARD_WAITING_CONFIRM = { title: "Discard those changes",
  message: "Discard the restored changes that need that game save? What they changed goes back to the library's version, and they can't be got back.",
  confirm: "Discard" } as const;

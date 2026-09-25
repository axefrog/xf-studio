/**
 * Plain-language reasons for capabilities a community user cannot have in this
 * alpha, and the wording policy every user-facing capability reason follows.
 * Evidence caveats (provenance, offline verification, runtime proof) belong in
 * docs and manifests, not in reasons shown beside a disabled control.
 */

/**
 * Shown for every head, camera, motion and saved-V action until the 3D preview has been
 * prepared from the player's own game files (the desktop then reports its progress instead).
 */
export const NO_3D_PREVIEW_IN_ALPHA =
  "The 3D head preview appears once XF Studio has prepared it from your Cyberpunk 2077 files. The UV editor, library and Check work fully.";

/** Shown for Build when the host's Build setup is incomplete; the setup view lists what is missing. */
export const BUILD_NEEDS_SETUP =
  "Building mod files needs your Cyberpunk 2077 game folder and WolvenKit, which XF Studio sets up with the 3D preview. Check works without them.";

/** Developer and evidence vocabulary that must not appear in a reason or label a community user sees. */
export const USER_FACING_JARGON =
  /\bprivate\b|local setup|server override|path presence|provenance|offline verified|revision \d+ ·|\bcanary\b|prepared (?:files|assets|set)|five core|plate input|\bhost\b|adapter/i;

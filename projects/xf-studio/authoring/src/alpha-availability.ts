/**
 * Plain-language reasons for capabilities a community user cannot have yet, and the wording policy every user-facing capability reason follows.
 * Evidence caveats (provenance, offline verification, runtime proof) belong in
 * docs and manifests, not in reasons shown beside a disabled control.
 */

/**
 * Shown for every head, camera, motion and saved-V action when no 3D preview files are present.
 * It names the real cause: the head is derived from the user's own game installation, which
 * XF Studio cannot do yet. No dates or promises.
 */
export const NO_3D_PREVIEW_YET =
  "The 3D head preview is built from your own Cyberpunk 2077 installation, and XF Studio can't do that yet. For now, design in the UV map; everything else works.";

/** Shown for Build when the host's Build setup is incomplete; the setup view lists the missing paths. */
export const BUILD_NEEDS_SETUP =
  "Building mod files needs a developer setup for now (game folder, WolvenKit and build tools). Check works without it.";

/** Developer and evidence vocabulary that must not appear in a reason or label a community user sees. */
export const USER_FACING_JARGON =
  /\bprivate\b|local setup|server override|path presence|provenance|offline verified|revision \d+ ·|\bcanary\b|prepared (?:files|assets|set)|five core|plate input|\bhost\b|adapter/i;

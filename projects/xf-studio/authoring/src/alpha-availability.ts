/**
 * Plain-language reasons for capabilities a community user cannot have in this
 * alpha, and the wording policy every user-facing capability reason follows.
 * Evidence caveats (provenance, offline verification, runtime proof) belong in
 * docs and manifests, not in reasons shown beside a disabled control.
 */

/** Shown for every head, camera, motion and saved-V action when no 3D preview files are present. */
export const NO_3D_PREVIEW_IN_ALPHA =
  "The 3D head preview isn't available in this alpha. The UV editor, library and Check work fully.";

/** Shown for Build when the host's Build setup is incomplete; the setup view lists the missing paths. */
export const BUILD_NEEDS_SETUP =
  "Building mod files needs a developer setup in this alpha (game folder, WolvenKit and build tools). Check works without it.";

/** Developer and evidence vocabulary that must not appear in a reason or label a community user sees. */
export const USER_FACING_JARGON =
  /\bprivate\b|local setup|server override|path presence|provenance|offline verified|revision \d+ ·|\bcanary\b|prepared (?:files|assets|set)|five core|plate input|\bhost\b|adapter/i;

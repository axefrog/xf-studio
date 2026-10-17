/** Generic baseline character-material source; the shown V is never changed. */
import { DEFAULT_CHARACTER } from "./character-detail-request";
import { referenceTextures } from "./platform/scene/reference-textures";
import type { SceneHostPort } from "./platform/api/scene";
export const browserReferenceTextures = (verification: boolean): NonNullable<SceneHostPort["referenceTextures"]> => (slot, signal) =>
  referenceTextures(slot, signal, { ...DEFAULT_CHARACTER, body: false }, { endpoint: "/api/reference-character", assets: "/assets/reference-character/",
    headers: verification ? { "X-XFS-Verification": "1" } : {} });

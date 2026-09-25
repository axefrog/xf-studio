import { contentFingerprint, DerivedCache, samePath } from "./derived-cache";
import type { EyePlateRecipe } from "./eye-plate-recipe";

/**
 * Storage adapter for derived eye plates. The cache lives in host-owned private storage
 * (never the repository, the game folder or a mod manager). Each derivation is published
 * atomically into a directory named by recipe revision and cache key.
 */
export const EYE_PLATE_STATUS_SCHEMA = "xfs/eye-plate-status-1" as const;
export type EyePlateStatusState = "ready" | "missing" | "unsupported" | "failed";
export type EyePlateStatus = {
  schema: typeof EYE_PLATE_STATUS_SCHEMA;
  recipeId: string; recipeRevision: number;
  state: EyePlateStatusState; code: string | null; message: string;
  gameRoot: string; contentFingerprint: string; cacheName: string | null; updatedAt: string;
};

export { contentFingerprint, fileSha256 } from "./derived-cache";

export class EyePlateCache extends DerivedCache {
  constructor(root: string) { super(root, "eye plate"); }
  writeStatus(status: Omit<EyePlateStatus, "schema" | "updatedAt">): void {
    this.writeStatusDocument({ schema: EYE_PLATE_STATUS_SCHEMA, ...status, updatedAt: new Date().toISOString() });
  }
  readStatus(): EyePlateStatus | null {
    const status = this.readStatusDocument() as EyePlateStatus | null;
    return status?.schema === EYE_PLATE_STATUS_SCHEMA ? status : null;
  }
}

export type EyePlateReadiness = { issue: { code: string; reason: string } | null; limit: string };
/**
 * Advisory Build readiness from the last recorded derivation. A missing or unsupported head
 * only blocks while the same game folder's content archives are unchanged, so repairing or
 * updating the game (or XF Studio's recipe) lets the next Build try again.
 */
export function eyePlateReadiness(cacheRoot: string | null, gameRoot: string | null, recipe: EyePlateRecipe): EyePlateReadiness {
  const labels = recipe.source.supported.map(item => item.label).join(", ");
  const limit = `The expanded eye plate is built from your installed game on first Build (supports ${labels}) and cached privately.`;
  if (!cacheRoot || !gameRoot) return { issue: null, limit };
  let status: EyePlateStatus | null = null;
  try { status = new EyePlateCache(cacheRoot).readStatus(); } catch { return { issue: null, limit }; }
  if (!status || status.recipeId !== recipe.id || status.recipeRevision !== recipe.revision || !samePath(status.gameRoot, gameRoot) ||
      (status.state !== "missing" && status.state !== "unsupported") ||
      status.contentFingerprint !== contentFingerprint(gameRoot, recipe.source.archiveDirectory))
    return { issue: null, limit };
  return { issue: { code: status.state === "missing" ? "plate_source_missing" : "plate_source_unsupported", reason: status.message }, limit };
}

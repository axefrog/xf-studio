/**
 * The Poses panel's per-user preferences (pose-library-design.md §6, decision Q6): starred favourites and the recent poses, each keyed by
 * the pose's TweakDB record with a label snapshot (so a favourite whose pack is gone still reads as itself), and which groups of the tree
 * are open. Not per look, workspace or recipe: the host keeps one document per user (`xfs/pose-preferences-1`, host/preferences-store.ts),
 * a verification workspace its own copy. Pure: parsing is lenient (a bad entry is dropped, never the document), every list is bounded.
 */
export const POSE_PREFERENCES_SCHEMA = "xfs/pose-preferences-1";
export type PoseRef = { readonly id: string; readonly label: string };
export type PosePreferences = {
  readonly schema: typeof POSE_PREFERENCES_SCHEMA;
  /** Most recently starred first. */
  readonly favourites: readonly PoseRef[];
  /** Most recently applied first, at most `RECENT_LIMIT`. */
  readonly recent: readonly PoseRef[];
  /** The tree's open groups: `FAVOURITES_GROUP`, `RECENT_GROUP` and category record names. */
  readonly open: readonly string[];
};

export const FAVOURITES_GROUP = "xfs:favourites", RECENT_GROUP = "xfs:recent";
export const FAVOURITES_LIMIT = 2000, RECENT_LIMIT = 12, OPEN_LIMIT = 512;
const LABEL_LIMIT = 200;

/** A TweakDB record name as packs write them (the pose endpoint's rule). */
export const isPoseRecord = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512 && /^[A-Za-z0-9_.\-$#:]+$/.test(value);
const isLabel = (value: unknown): value is string => typeof value === "string" && value.length <= LABEL_LIMIT && !/[\u0000-\u001f\u007f]/.test(value);

export function defaultPosePreferences(): PosePreferences {
  return { schema: POSE_PREFERENCES_SCHEMA, favourites: [], recent: [], open: [FAVOURITES_GROUP, RECENT_GROUP] };
}

function refs(value: unknown, limit: number): PoseRef[] {
  if (!Array.isArray(value)) return [];
  const out: PoseRef[] = [], seen = new Set<string>();
  for (const item of value) {
    const entry = item as { id?: unknown; label?: unknown } | null;
    if (!entry || !isPoseRecord(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push({ id: entry.id, label: isLabel(entry.label) ? entry.label : entry.id });
    if (out.length >= limit) break;
  }
  return out;
}

/** Read a stored document; anything unreadable gives the defaults, a bad entry is dropped. */
export function parsePosePreferences(value: unknown): PosePreferences {
  const doc = value as { schema?: unknown; favourites?: unknown; recent?: unknown; open?: unknown } | null;
  if (!doc || typeof doc !== "object" || doc.schema !== POSE_PREFERENCES_SCHEMA) return defaultPosePreferences();
  const open = Array.isArray(doc.open) ? [...new Set(doc.open.filter(isPoseRecord))].slice(0, OPEN_LIMIT) : defaultPosePreferences().open;
  return { schema: POSE_PREFERENCES_SCHEMA, favourites: refs(doc.favourites, FAVOURITES_LIMIT), recent: refs(doc.recent, RECENT_LIMIT), open };
}

const label = (ref: PoseRef): PoseRef => ({ id: ref.id, label: isLabel(ref.label) ? ref.label : ref.id });

/** Star (first in the list) or unstar a pose. */
export function withFavourite(prefs: PosePreferences, ref: PoseRef, on: boolean): PosePreferences {
  const rest = prefs.favourites.filter(item => item.id !== ref.id);
  return { ...prefs, favourites: on ? [label(ref), ...rest].slice(0, FAVOURITES_LIMIT) : rest };
}
/** A pose was applied: it goes first in Recent. */
export function withRecent(prefs: PosePreferences, ref: PoseRef): PosePreferences {
  return { ...prefs, recent: [label(ref), ...prefs.recent.filter(item => item.id !== ref.id)].slice(0, RECENT_LIMIT) };
}
/** Open or close a group of the tree. */
export function withOpen(prefs: PosePreferences, group: string, open: boolean): PosePreferences {
  const rest = prefs.open.filter(item => item !== group);
  return { ...prefs, open: open ? [...rest, group].slice(-OPEN_LIMIT) : rest };
}

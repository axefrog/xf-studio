/**
 * The Poses panel's tree (pose-library-design.md §6, decision Q2): Favourites, Recent, then the catalogue's categories in the game's
 * `poseCategories` order, each pose one row in menu order. Pure: it reads the host's catalogue (pose-catalogue.ts), the per-user
 * preferences and the search, and never decodes a clip.
 *
 * - **Search** matches every word, in any order, against the label, the category, the pack that added it, the record and the clip name,
 *   case- and accent-insensitively. Groups with no match are left out.
 * - **Outfit filter** (decision Q4): the game's rule by default, a pose whose `filterOutForGarmentTags` names a tag of a garment V wears is
 *   hidden, everywhere [hypothesis: hidden rather than disabled, G4]. The tree counts what it hid, for a "Show them" note.
 * - **Not playable**: a pose whose clip isn't installed, or is in a format XF Studio can't read, is listed but greyed with a plain reason;
 *   a favourite or recent pose no longer installed stays in its group, greyed, as "Not installed now".
 */
import type { PoseBadge, PoseItem as PoseEntry, PoseListing as PoseCatalogue } from "./types";
import { FAVOURITES_GROUP, RECENT_GROUP, type PosePreferences, type PoseRef } from "./preferences";

export type PoseRow = {
  readonly id: string;
  readonly label: string;
  /** The category's label (search and Favourites rows show it). */
  readonly category: string;
  /** Who added it: the mod or file that defined the record, or null for the game's own. */
  readonly pack: string | null;
  readonly badges: readonly PoseBadge[];
  readonly favourite: boolean;
  /** Null when it can be applied; otherwise why not, in plain words. */
  readonly unavailable: string | null;
  /** Where the search's words fall in `label` ([start, end) pairs), for highlighting. */
  readonly matches?: readonly (readonly [number, number])[];
};
export type PoseGroup = {
  readonly id: string;
  readonly kind: "favourites" | "recent" | "category";
  readonly label: string;
  /** For a category: the pack that added it (many mod categories have raw labels), null for the game's. */
  readonly pack: string | null;
  readonly rows: readonly PoseRow[];
  /** Where the search's words fall in `label`. */
  readonly matches?: readonly (readonly [number, number])[];
};
export type PoseTree = {
  readonly groups: readonly PoseGroup[];
  /** Poses the outfit filter hid (distinct), and the worn tags that hid them. */
  readonly hiddenByOutfit: number;
  readonly hidingTags: readonly string[];
  /** Rows shown in the categories (a search's matches) and poses listed in all. */
  readonly shown: number;
  readonly total: number;
};
export type PoseTreeOptions = { readonly query: string; readonly wornTags: readonly string[]; readonly showFiltered: boolean };

export const NOT_INSTALLED = "Not installed now: its pack isn't in your game.";
const CLIP_MISSING = "Its animation isn't installed, so V can't hold it.";
const CLIP_UNREADABLE = "Its animation is in a format XF Studio can't play yet.";

/** Lower case without accents, for matching. */
export const foldText = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const searchWords = (query: string) => foldText(query).split(/\s+/).filter(Boolean);

/** Why an entry can't be applied, or null. */
export function entryUnavailable(entry: PoseEntry): string | null {
  if (!entry.clip) return CLIP_MISSING;
  if (!entry.clip.decodable) return CLIP_UNREADABLE;
  return null;
}

/** Where the words fall in a label, when folding kept its length (accents folded, otherwise unchanged); undefined when none do. */
export function labelMatches(label: string, words: readonly string[]): [number, number][] | undefined {
  const folded = foldText(label);
  if (!words.length || folded.length !== label.length) return undefined;
  const ranges = words.flatMap(word => { const at = folded.indexOf(word); return at < 0 ? [] : [[at, at + word.length] as [number, number]]; });
  return ranges.length ? ranges : undefined;
}

export function buildPoseTree(catalogue: PoseCatalogue | null, prefs: PosePreferences, options: PoseTreeOptions): PoseTree {
  const words = searchWords(options.query);
  const worn = new Set(options.wornTags);
  const categories = new Map((catalogue?.categories ?? []).map(category => [category.id, category]));
  const favourites = new Set(prefs.favourites.map(item => item.id));
  const byId = new Map((catalogue?.entries ?? []).map(entry => [entry.id, entry]));
  const hidden = new Set<string>(), hidingTags = new Set<string>();
  const withMatches = (label: string) => { const matches = labelMatches(label, words); return matches ? { matches } : {}; };
  const hides = (entry: PoseEntry) => {
    const tags = entry.hiddenForGarmentTags.filter(tag => worn.has(tag));
    if (!tags.length) return false;
    hidden.add(entry.id); for (const tag of tags) hidingTags.add(tag);
    return !options.showFiltered;
  };
  const rowOf = (entry: PoseEntry): PoseRow => {
    const category = categories.get(entry.category);
    return { id: entry.id, label: entry.label, category: category?.label ?? "", pack: entry.source.declaredBy ?? category?.source.declaredBy ?? null,
      badges: entry.badges, favourite: favourites.has(entry.id), unavailable: entryUnavailable(entry), ...withMatches(entry.label) };
  };
  const matches = (row: PoseRow, clip: string | null) => {
    if (!words.length) return true;
    const haystack = foldText([row.label, row.category, row.pack ?? "", row.id, clip ?? ""].join("\n"));
    return words.every(word => haystack.includes(word));
  };
  const refRows = (refs: readonly PoseRef[]) => refs.flatMap(ref => {
    const entry = byId.get(ref.id);
    if (entry) { if (hides(entry)) return []; const row = rowOf(entry); return matches(row, entry.clip?.name ?? null) ? [row] : []; }
    const row: PoseRow = { id: ref.id, label: ref.label, category: "", pack: null, badges: [], favourite: favourites.has(ref.id),
      unavailable: catalogue ? NOT_INSTALLED : null, ...withMatches(ref.label) };
    return matches(row, null) ? [row] : [];
  });
  const groups: PoseGroup[] = [];
  const favouriteRows = refRows(prefs.favourites);
  if (favouriteRows.length) groups.push({ id: FAVOURITES_GROUP, kind: "favourites", label: "Favourites", pack: null, rows: favouriteRows });
  const recentRows = refRows(prefs.recent);
  if (recentRows.length) groups.push({ id: RECENT_GROUP, kind: "recent", label: "Recent", pack: null, rows: recentRows });
  const perCategory = new Map<string, PoseRow[]>();
  let shown = 0;
  for (const entry of catalogue?.entries ?? []) {
    if (hides(entry)) continue;
    const row = rowOf(entry);
    if (!matches(row, entry.clip?.name ?? null)) continue;
    const list = perCategory.get(entry.category);
    if (list) list.push(row); else perCategory.set(entry.category, [row]);
    shown++;
  }
  for (const category of catalogue?.categories ?? []) {
    const rows = perCategory.get(category.id);
    if (rows?.length) groups.push({ id: category.id, kind: "category", label: category.label, pack: category.source.declaredBy, rows, ...withMatches(category.label) });
  }
  return { groups, hiddenByOutfit: hidden.size, hidingTags: [...hidingTags].sort(), shown, total: catalogue?.entries.length ?? 0 };
}

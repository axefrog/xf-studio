/**
 * The photo-mode pose catalogue: every pose the game's photo mode would list for a body gender, built from game data the way the game
 * builds it (research/animation/pose-library-design.md §4, knowledge/poses.md). Pure domain logic: the host (pose-catalogue-host.ts) reads
 * the files and passes a compiled-TweakDB lookup, the TweakXL overlay, the photo-mode puppet's animation sets with their clip names, and the
 * text table. Nothing here names a mod, a pack or a record beyond the game's own list and field names.
 *
 * - **Lists** [resource]: `photo_mode.character.femalePoses` / `malePoses` (pose record names, menu order) and `poseCategories`, the
 *   compiled values with the TweakXL files' assignments and list operations applied (tweakxl-overlay.ts `list`).
 * - **Records**: a field is the overlay's (the record's own, or a `$base` record the overlay defines), else the compiled flat of the record,
 *   else of the first compiled record up its overlay `$base` chain (TweakXL copies a base's flats into a new record) [source: TweakXL].
 * - **Categories**: a pose belongs to the category record whose name is the pose's `category`, else to the one whose `categoryName` is
 *   [hypothesis: G1]. Vanilla writes the record's own name in both; one pack generator writes `CategoryName`, which TweakXL (case-sensitive
 *   property names) ignores, so those categories inherit vanilla's `categoryName` while their poses still name the category record. A pose in no listed category, a locked pose, a list entry naming no
 *   record and a repeated entry are counted, not listed [hypothesis: the menu shows none of them].
 * - **Clips**: the record's `animationName` among the puppet's sets. When several sets hold the name, the higher `priority` wins, then the
 *   earlier set (the puppet's own sets before ArchiveXL's, in load order) [hypothesis: G3 in the design's in-game checks]. A pose whose clip
 *   no set holds keeps `clip: null` and is counted (in game it leaves V unchanged [hypothesis]).
 * - **Labels**: `displayName` through the game's and mods' texts; a value that is not a text key shows as written (`01`), as the menu does.
 *
 * Listing never decodes a clip: the sets' clip names come from their indexes (anim-set.ts `readAnimSetIndex`), cached by the host.
 */
import { displayLabel, type TextTable } from "./game-text";
import type { TweakValue } from "./tweakdb-flats";
import type { TweakOverlay } from "./tweakxl-overlay";

export const POSE_CATALOGUE_SCHEMA = "xfs/pose-catalogue-1";
export type PoseBodyGender = "female" | "male";

/** The fields a pose record carries (PhotoModePose : PhotoModeItem, REDmod `database\photomode\schema.tweak`). */
export const POSE_FIELDS = ["displayName", "locked", "animationName", "animationTime", "category", "acceptedWeaponConfig", "poseStateConfig", "lookAtPreset",
  "disableLookAtForGarmentTags", "filterOutForGarmentTags", "positionOffset", "rotation", "poseSize", "allowMoveUpDown"] as const;
export const CATEGORY_FIELDS = ["categoryName", "displayName"] as const;
export const POSE_LISTS = { female: "photo_mode.character.femalePoses", male: "photo_mode.character.malePoses", categories: "photo_mode.character.poseCategories" } as const;
/** A record's weapon setting that means "holds nothing" (the schema's default), and the ground state. */
const NO_WEAPON = "POSE_HIDE_WEAPON", GROUND = "POSE_STATE_GROUND";
const VEHICLE_STATES = new Set(["POSE_STATE_CAR", "POSE_STATE_BIKE"]);
/** More frames than a held pose has (vanilla poses have 2 or 3): the clip moves. */
const HELD_FRAMES = 3;

/** One animation set on the photo-mode puppet, in the order the puppet holds them. */
export interface PoseSet {
  /** Depot path (as declared) and hash. */
  readonly path: string;
  readonly hash: string;
  /** The winning archive's file name and who supplied it (a mod manager's mod name, or the game), null when no archive has it. */
  readonly archive: string | null;
  readonly provider: string | null;
  /** `entity`: the puppet's own component; `archivexl`: an `.xl` `animations:` entry (named by its file). */
  readonly from: { readonly kind: "entity"; readonly component: string } | { readonly kind: "archivexl"; readonly declaredBy: string };
  readonly priority: number;
  /** Clip name → frames and length, or null when the set couldn't be read. */
  readonly clips: ReadonlyMap<string, { readonly frames: number; readonly duration: number; readonly decodable: boolean; readonly animatedKeys: number }> | null;
}
export interface PoseClip {
  readonly name: string;
  readonly set: string;
  readonly setHash: string;
  readonly archive: string | null;
  readonly provider: string | null;
  readonly frames: number;
  readonly duration: number;
  /** Other sets that also hold a clip of this name (the choice between them is the hypothesis above). */
  readonly alternatives: number;
  /** Whether XF Studio decodes its buffer (the compressed format). */
  readonly decodable: boolean;
  /** More frames than a held pose and keys that change: the clip plays over time (a multi-frame clip whose every channel is constant holds). */
  readonly animated: boolean;
}
export type PoseBadge = "holds" | "vehicle" | "moves";
export interface PoseEntry {
  /** The TweakDB record name: the stable key (favourites, workspace). */
  readonly id: string;
  readonly label: string;
  readonly category: string;
  /** Position in the gender's list (menu order within a category). */
  readonly order: number;
  readonly clip: PoseClip | null;
  /** `animationTime`, seconds. */
  readonly time: number;
  readonly placement: { readonly offset: readonly [number, number, number]; readonly rotation: readonly [number, number, number] };
  /** `acceptedWeaponConfig` unless it is the no-weapon default: a weapon or prop the Studio doesn't draw. */
  readonly holds: string | null;
  /** `poseStateConfig` (ground, air, car, bike, swimming…). */
  readonly state: string;
  /** `filterOutForGarmentTags`: the game hides the pose while V wears a garment with one of these tags [hypothesis: hidden, not disabled]. */
  readonly hiddenForGarmentTags: readonly string[];
  /** `disableLookAtForGarmentTags`. */
  readonly lookAtOffForGarmentTags: readonly string[];
  readonly lookAt: string | null;
  readonly badges: readonly PoseBadge[];
  /** `game` when no TweakXL file touches the record; else the file that defined it and its provider. */
  readonly source: { readonly kind: "game" | "mod"; readonly declaredBy: string | null; readonly file: string | null };
}
export interface PoseCategory {
  readonly id: string;
  readonly label: string;
  readonly order: number;
  readonly count: number;
  readonly source: { readonly kind: "game" | "mod"; readonly declaredBy: string | null };
}
export interface PoseDiagnostic { readonly code: string; readonly count: number; readonly detail: string; readonly examples: readonly string[] }
export interface PoseCatalogue {
  readonly schema: typeof POSE_CATALOGUE_SCHEMA;
  readonly bodyGender: PoseBodyGender;
  readonly categories: readonly PoseCategory[];
  readonly entries: readonly PoseEntry[];
  readonly diagnostics: readonly PoseDiagnostic[];
  readonly counts: { readonly listed: number; readonly withClip: number; readonly categories: number; readonly sets: number; readonly setsUnread: number };
}

export interface PoseCatalogueInput {
  readonly bodyGender: PoseBodyGender;
  /** Compiled TweakDB flats by full name (`Record.field`); names the blob lacks are absent. One call per batch. */
  readonly flats: (names: readonly string[]) => ReadonlyMap<string, TweakValue>;
  readonly overlay: TweakOverlay | null;
  /** TweakXL file path → its provider (for provenance). */
  readonly providers?: ReadonlyMap<string, string>;
  readonly sets: readonly PoseSet[];
  readonly text: TextTable | null;
}

type Value = { value: unknown; overlay: boolean };
const text = (value: unknown): string | null => typeof value === "string" ? value : typeof value === "number" ? String(value) : null;
const number = (value: unknown, fallback = 0): number => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value.trim().replace(/f$/i, "")) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const bool = (value: unknown): boolean => value === true || value === 1 || (typeof value === "string" && /^(true|1|yes)$/i.test(value.trim()));
/** A CName list without its empty entries (the schema's default `[""]` compiles to `None`; some TweakXL files write `CName("None")`). */
const names = (value: unknown): string[] => Array.isArray(value) ? value.map(text).map(item => item && /^CName\("(.*)"\)$/.exec(item)?.[1] || item)
  .filter((item): item is string => !!item && item !== "None") : [];
/** A Vector3 from the blob (`[x, y, z]`) or a TweakXL value (`{x, y, z}` or `[x, y, z]`). */
function vector(value: unknown): [number, number, number] {
  if (Array.isArray(value)) return [number(value[0]), number(value[1]), number(value[2])];
  if (value && typeof value === "object") { const v = value as Record<string, unknown>; return [number(v.x ?? v.X), number(v.y ?? v.Y), number(v.z ?? v.Z)]; }
  return [0, 0, 0];
}

/** Resolves record fields: the overlay first, then compiled flats (batched per phase). */
class Records {
  private readonly compiled = new Map<string, TweakValue | null>();
  constructor(private readonly input: PoseCatalogueInput) {}
  /** The chain of record names a field may come from: the record, then its overlay `$base` records. */
  chain(record: string): string[] {
    const out = [record];
    for (let at = record, depth = 0; depth < 16; depth++) {
      const base = this.input.overlay?.records.get(at)?.base;
      if (!base || out.includes(base)) break;
      out.push(base); at = base;
    }
    return out;
  }
  /** Fetch the compiled flats of these records' fields, every group in one lookup. */
  prefetch(...groups: readonly (readonly [readonly string[], readonly string[]])[]): void {
    const wanted: string[] = [];
    for (const [records, fields] of groups) for (const record of records) for (const name of this.chain(record)) for (const field of fields) {
      const flat = `${name}.${field}`;
      if (!this.compiled.has(flat)) { wanted.push(flat); this.compiled.set(flat, null); }
    }
    if (!wanted.length) return;
    const found = this.input.flats(wanted);
    for (const [flat, value] of found) this.compiled.set(flat, value);
  }
  field(record: string, field: string): Value | null {
    for (const name of this.chain(record)) {
      const own = this.input.overlay?.records.get(name);
      if (own?.fields.has(field)) return { value: own.fields.get(field), overlay: true };
      const compiled = this.compiled.get(`${name}.${field}`);
      if (compiled) return { value: compiled.value, overlay: false };
    }
    return null;
  }
  /** A list flat: the compiled value with the TweakXL edits applied. */
  list(flat: string): string[] {
    const compiled = this.input.flats([flat]).get(flat);
    const base = compiled && Array.isArray(compiled.value) ? (compiled.value as unknown[]).map(item => String(item)) : null;
    return [...(this.input.overlay ? this.input.overlay.list(flat, base, name => {
      const value = this.input.flats([name]).get(name);
      return value && Array.isArray(value.value) ? (value.value as unknown[]).map(item => String(item)) : null;
    }) ?? [] : base ?? [])];
  }
  exists(record: string): boolean {
    if (this.input.overlay?.records.has(record)) return true;
    return this.chain(record).some(name => POSE_FIELDS.some(field => this.compiled.get(`${name}.${field}`)) || CATEGORY_FIELDS.some(field => this.compiled.get(`${name}.${field}`)));
  }
}

/** The clip a name resolves to among the puppet's sets: higher priority first, then set order [hypothesis]. */
export function findClip(sets: readonly PoseSet[], name: string): PoseClip | null {
  let best: { set: PoseSet; index: number } | null = null, holders = 0;
  sets.forEach((set, index) => {
    if (!set.clips?.has(name)) return;
    holders++;
    if (!best || set.priority > best.set.priority) best = { set, index };
  });
  if (!best) return null;
  const { set } = best as { set: PoseSet };
  const info = set.clips!.get(name)!;
  return { name, set: set.path, setHash: set.hash, archive: set.archive, provider: set.provider, frames: info.frames, duration: info.duration,
    alternatives: holders - 1, decodable: info.decodable, animated: info.frames > HELD_FRAMES && info.animatedKeys > 0 };
}

export function buildPoseCatalogue(input: PoseCatalogueInput): PoseCatalogue {
  const records = new Records(input);
  const diagnostics = new Map<string, { count: number; detail: string; examples: string[] }>();
  const note = (code: string, detail: string, example: string) => {
    const entry = diagnostics.get(code) ?? { count: 0, detail, examples: [] };
    entry.count++;
    if (entry.examples.length < 5) entry.examples.push(example);
    diagnostics.set(code, entry);
  };
  const provenance = (record: string) => {
    const defined = input.overlay?.records.get(record);
    const file = defined?.from[0] ?? null;
    return file ? { kind: "mod" as const, declaredBy: input.providers?.get(file) ?? null, file } : { kind: "game" as const, declaredBy: null, file: null };
  };

  // The lists in one lookup, then every listed record's fields in another (each lookup scans the blob's key tables).
  input.flats([POSE_LISTS.categories, POSE_LISTS[input.bodyGender]]);
  const categoryIds = records.list(POSE_LISTS.categories);
  const poseIds = records.list(POSE_LISTS[input.bodyGender]);
  records.prefetch([categoryIds, CATEGORY_FIELDS], [poseIds, POSE_FIELDS]);

  // Categories, in `poseCategories` order.
  const categories: { id: string; key: string; label: string; order: number; source: PoseCategory["source"] }[] = [];
  /** A pose's `category` → the category: by record name, else by `categoryName` [hypothesis: G1]. */
  const byName = new Map<string, number>();
  for (const id of categoryIds) {
    if (categories.some(category => category.id === id)) { note("category-repeated", "A category is listed more than once; it is shown once.", id); continue; }
    const key = text(records.field(id, "categoryName")?.value) || id;
    const display = text(records.field(id, "displayName")?.value) ?? "";
    const source = provenance(id);
    categories.push({ id, key, label: displayLabel(input.text, display, id.split(".").pop() ?? id, input.bodyGender).text, order: categories.length,
      source: { kind: source.kind, declaredBy: source.declaredBy } });
    byName.set(id, categories.length - 1);
  }
  // `categoryName` answers only a value no record name does: a pack category that inherits vanilla's `categoryName` (a key TweakXL doesn't
  // know, such as `CategoryName`, is ignored) must not capture vanilla's poses.
  for (const [index, category] of categories.entries()) if (!byName.has(category.key)) byName.set(category.key, index);

  // Poses, in the gender's list order.
  const entries: PoseEntry[] = [];
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const id of poseIds) {
    if (seen.has(id)) { note("pose-repeated", "A pose is listed more than once; it is shown once.", id); continue; }
    seen.add(id);
    if (!records.exists(id)) { note("pose-missing", "A pose list entry names a record neither the game nor an installed TweakXL file defines.", id); continue; }
    const field = (name: (typeof POSE_FIELDS)[number]) => records.field(id, name)?.value;
    if (bool(field("locked"))) { note("pose-locked", "A locked pose is not listed.", id); continue; }
    const categoryKey = text(field("category")) ?? "";
    const categoryIndex = byName.get(categoryKey);
    if (categoryIndex === undefined) { note("pose-uncategorised", "A pose names a category the category list doesn't hold, so the menu has nowhere to show it.", `${id} → ${categoryKey || "(none)"}`); continue; }
    const category = categories[categoryIndex]!;
    const animationName = text(field("animationName")) ?? "";
    const clip = animationName ? findClip(input.sets, animationName) : null;
    if (!clip) note("clip-missing", "A pose names an animation none of the photo-mode puppet's installed sets holds.", `${id} → ${animationName || "(none)"}`);
    else {
      if (clip.alternatives) note("clip-ambiguous", "More than one installed set holds a pose's animation; the higher priority, then the earlier set, is used.", `${id} → ${animationName}`);
      if (!clip.decodable) note("clip-not-decodable", "A pose's animation uses a buffer format XF Studio doesn't decode yet.", `${id} → ${animationName}`);
    }
    const weapon = text(field("acceptedWeaponConfig")) || NO_WEAPON, state = text(field("poseStateConfig")) || GROUND;
    const holds = weapon !== NO_WEAPON ? weapon : null;
    const badges: PoseBadge[] = [];
    if (holds) badges.push("holds");
    if (VEHICLE_STATES.has(state)) badges.push("vehicle");
    if (clip?.animated) badges.push("moves");
    const displayName = text(field("displayName")) ?? "";
    entries.push({
      id, label: displayLabel(input.text, displayName, animationName || (id.split(".").pop() ?? id), input.bodyGender).text, category: category.id,
      order: entries.length, clip, time: number(field("animationTime")),
      placement: { offset: vector(field("positionOffset")), rotation: vector(field("rotation")) },
      holds, state, hiddenForGarmentTags: names(field("filterOutForGarmentTags")), lookAtOffForGarmentTags: names(field("disableLookAtForGarmentTags")), lookAt: text(field("lookAtPreset")) || null, badges,
      source: provenance(id),
    });
    counts.set(category.id, (counts.get(category.id) ?? 0) + 1);
  }
  const setsUnread = input.sets.filter(set => set.clips === null && set.archive).length;
  for (const set of input.sets) if (set.clips === null) {
    if (set.archive) note("set-unread", "An animation set on the photo-mode puppet couldn't be read, so its clips are unknown.", set.path);
    else note("set-absent", "The photo-mode puppet names an animation set no installed archive holds.", set.path);
  }
  return {
    schema: POSE_CATALOGUE_SCHEMA, bodyGender: input.bodyGender,
    categories: categories.map(category => ({ id: category.id, label: category.label, order: category.order, count: counts.get(category.id) ?? 0, source: category.source })),
    entries,
    diagnostics: [...diagnostics].map(([code, entry]) => ({ code, count: entry.count, detail: entry.detail, examples: entry.examples })),
    counts: { listed: entries.length, withClip: entries.filter(entry => entry.clip).length, categories: categories.length, sets: input.sets.length, setsUnread },
  };
}

export const POSE_STATE_SCHEMA = "xfs/pose-catalogue-state-1";
export const POSE_SAMPLE_SCHEMA = "xfs/pose-sample-1";

export interface PoseTimings { readonly totalMs: number; readonly openMs: number; readonly tweakDbMs: number; readonly overlayMs: number; readonly puppetMs: number;
  readonly setsMs: number; readonly setsRead: number; readonly setsCached: number; readonly textsMs: number; readonly buildMs: number }
export interface PoseCatalogueLoad {
  readonly catalogue: PoseCatalogue;
  readonly evidence: { readonly tweakDb: string | null; readonly puppet: string | null; readonly language: string; readonly tweakFiles: number; readonly overlayGaps: number;
    readonly timings: PoseTimings };
}
export type PoseCatalogueState =
  | { readonly schema: typeof POSE_STATE_SCHEMA; readonly phase: "needs-setup" | "preparing" | "failed"; readonly message: string }
  | { readonly schema: typeof POSE_STATE_SCHEMA; readonly phase: "ready"; readonly message: string; readonly catalogue: PoseCatalogue; readonly evidence: PoseCatalogueLoad["evidence"] };
export type { PoseMotion, PoseSample } from "./pose-sample";

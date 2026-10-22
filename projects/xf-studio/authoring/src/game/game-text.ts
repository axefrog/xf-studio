/**
 * The game's on-screen texts for one language, as the creator shows them, including the texts mods add through
 * ArchiveXL. Pure: the host extracts the `.json` text resources and passes their entries in load order.
 *
 * Where the texts live [resource]: `base\localization\<language>\onscreens\onscreens.json` in the base game's
 * `lang_<code>_text.archive`, and `ep1\localization\<language>\onscreens\onscreens.json` in Phantom Liberty's (the two
 * share no key). Each is a `JsonResource` whose root `localizationPersistenceOnScreenEntries` lists entries
 * `{primaryKey, secondaryKey, femaleVariant, maleVariant}`. A key written `LocKey#<n>` names a primary key; any other
 * key, such as `UI-CharacterCreation-eyes`, names a secondary key. The creator's option rows pass the resource's
 * `localizedName` straight to the text widget (`characterCreationBodyMorphListItem`), so a value that is not a key (the
 * choice numbers `01`, `02`, …) shows as written [source: the game's scripts].
 *
 * Mod texts [source: ArchiveXL 1.27.3 `Localization/Extension.cpp`]: each `.xl` unit, in load order, merges its files for
 * the player's language (they replace an existing entry with the same key), then its fallback language's files, which
 * only fill in missing keys; an entry with no primary key is keyed by its secondary key. The native lookup itself is
 * unread; resolving secondary keys by exact text matches every vanilla creator key checked.
 *
 * Gender variants [hypothesis]: `maleVariant` when the V has a masculine body and the variant is set, otherwise
 * `femaleVariant`. No creator text has a male variant in 2.31, so the choice is untested.
 */
import { fnv1a64 } from "./depot-path";
import { asArray, cr2wRoot, isObject } from "./red-json";

export interface TextEntry { readonly primaryKey: string; readonly secondaryKey: string; readonly female: string; readonly male: string }
export interface TextSourceInfo { readonly id: string; readonly kind: "game" | "mod"; readonly declaredBy: string | null }

/** Entries of a WolvenKit-serialized onscreens `JsonResource`. Anything else yields none. */
export function readOnscreenEntries(document: unknown): TextEntry[] {
  const { root } = cr2wRoot(document);
  const data = isObject(root.root) && isObject(root.root.Data) ? root.root.Data : root;
  return asArray(data.entries).filter(isObject).map(entry => ({
    primaryKey: String(entry.primaryKey ?? "0"), secondaryKey: typeof entry.secondaryKey === "string" ? entry.secondaryKey : "",
    female: typeof entry.femaleVariant === "string" ? entry.femaleVariant : "", male: typeof entry.maleVariant === "string" ? entry.maleVariant : "" }));
}

export interface ResolvedText { readonly text: string; readonly source: TextSourceInfo }

const encoder = new TextEncoder();
/** FNV-1a 32 of a string's UTF-8 bytes (`Red::FNV1a32`). */
export function fnv1a32(text: string): bigint {
  let hash = 0x811c9dc5;
  for (const byte of encoder.encode(text)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return BigInt(hash);
}

/**
 * The merged text table, keyed as ArchiveXL's `MergeTextResource` keys it (PIPE-47) [source: ArchiveXL
 * `Localization/Extension.cpp` `MergeTextResource`, `MergeTextEntry`]:
 * - every entry is identified by its **primary key** alone; a mod entry with the same primary key replaces the entry that
 *   holds it (its secondary key and variants with it), except from a unit's fallback language, which only adds new keys;
 * - a mod entry **without** a primary key is added twice: under FNV-1a 32 of its secondary key, keeping that key, and under
 *   FNV-1a 64 of it, without one;
 * - comment rows (secondary key starting with `-` or `=`) are skipped.
 *
 * Lookup of a secondary key (`UI-CharacterCreation-eyes`): the entry holding that secondary key, else the entry at FNV-1a 64 of
 * it. When two entries hold the same secondary key under different primary keys, the one merged last answers
 * [hypothesis: the native secondary-key lookup is unread; exact matching answers every vanilla creator key checked].
 */
export class TextTable {
  private readonly byPrimary = new Map<bigint, { entry: TextEntry; source: TextSourceInfo }>();
  private readonly bySecondary = new Map<string, bigint>();
  constructor(readonly language: string) {}

  /** Add entries in load order; `replace` false (a unit's fallback language) only adds keys that are still missing. */
  add(entries: readonly TextEntry[], source: TextSourceInfo, replace = true): this {
    for (const entry of entries) {
      if (source.kind === "mod" && /^[-=]/.test(entry.secondaryKey)) continue;
      let primary: bigint;
      try { primary = BigInt(entry.primaryKey); } catch { continue; }
      if (primary !== 0n) { this.merge(primary, entry, source, replace); continue; }
      if (!entry.secondaryKey) continue;
      this.merge(fnv1a32(entry.secondaryKey), entry, source, replace);
      this.merge(fnv1a64(encoder.encode(entry.secondaryKey)), { ...entry, secondaryKey: "" }, source, replace);
    }
    return this;
  }

  private merge(primary: bigint, entry: TextEntry, source: TextSourceInfo, replace: boolean) {
    const existing = this.byPrimary.get(primary);
    if (existing && !replace) return;
    const held = existing?.entry.secondaryKey;
    if (held && this.bySecondary.get(held) === primary) this.bySecondary.delete(held);
    this.byPrimary.set(primary, { entry, source });
    if (entry.secondaryKey && (replace || !this.bySecondary.has(entry.secondaryKey))) this.bySecondary.set(entry.secondaryKey, primary);
  }

  get size() { return this.byPrimary.size; }

  /** The text a key shows, or null when the table has none. */
  resolve(key: string, bodyGender: "female" | "male" = "female"): ResolvedText | null {
    if (!key) return null;
    const lockey = /^LocKey#(\d{1,20})$/.exec(key);
    let found: { entry: TextEntry; source: TextSourceInfo } | undefined;
    if (lockey) found = this.byPrimary.get(BigInt(lockey[1]!));
    else {
      const held = this.bySecondary.get(key);
      found = (held !== undefined ? this.byPrimary.get(held) : undefined) ?? this.byPrimary.get(fnv1a64(encoder.encode(key)));
    }
    if (!found) return null;
    const text = bodyGender === "male" && found.entry.male ? found.entry.male : found.entry.female;
    return text ? { text, source: found.source } : null;
  }
}

/** One text resource to merge, in load order. */
export interface TextPlanItem {
  readonly path: string;
  readonly kind: "game" | "mod";
  /** False for a unit's fallback-language files, which only add missing keys. */
  readonly replace: boolean;
  readonly declaredBy: string | null;
}
/** An ArchiveXL `localization` unit as the `.xl` reader gives it (archivexl-config.ts). */
export interface TextUnit {
  readonly onscreens: ReadonlyMap<string, readonly string[]>;
  readonly fallback: string | null;
  readonly declaredBy: string;
}

/** The game's own on-screen text resources for a language: base, then Phantom Liberty's when it is installed. */
export const gameTextPaths = (language: string, ep1Installed: boolean): string[] => [`base\\localization\\${language}\\onscreens\\onscreens.json`,
  ...(ep1Installed ? [`ep1\\localization\\${language}\\onscreens\\onscreens.json`] : [])];

/**
 * The text resources the game shows in `language`, in merge order (PIPE-48): the game's own, then each ArchiveXL unit in load order,
 * its files for the language (replacing), then, unless the language is its fallback, its fallback language's files (adding only);
 * a unit without files for the language merges its fallback language's files, adding only [source: ArchiveXL `OnLoadTexts`].
 */
export function textPlan(language: string, ep1Installed: boolean, units: readonly TextUnit[]): TextPlanItem[] {
  const plan: TextPlanItem[] = gameTextPaths(language, ep1Installed).map(path => ({ path, kind: "game", replace: true, declaredBy: null }));
  for (const unit of units) {
    const own = unit.onscreens.get(language);
    const fallback = unit.fallback ? unit.onscreens.get(unit.fallback) ?? [] : [];
    for (const path of own ?? fallback) plan.push({ path, kind: "mod", replace: !!own, declaredBy: unit.declaredBy });
    if (own && unit.fallback !== language) for (const path of fallback) plan.push({ path, kind: "mod", replace: false, declaredBy: unit.declaredBy });
  }
  return plan;
}

/**
 * The game's on-screen language from the parsed `UserSettings.json` (group `/language`, option `OnScreen`), or null when the document
 * doesn't say (PIPE-48).
 */
export function gameLanguageOf(document: unknown): string | null {
  const data = (document as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  const group = data.find(item => isObject(item) && item.group_name === "/language");
  const options = isObject(group) && Array.isArray(group.options) ? group.options : [];
  const found = options.find(option => isObject(option) && option.name === "OnScreen");
  const value = isObject(found) ? found.value : undefined;
  return typeof value === "string" && /^[a-z]{2}-[a-z]{2}$/.test(value) ? value : null;
}

/** Does a value look like a text key (as opposed to a label written out, like `01`)? */
export const isTextKey = (value: string) => /^LocKey#\d+$/.test(value) || /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9_]+){1,}$/.test(value);

/**
 * A readable name from a key or identifier when the texts have none: the last segment of a secondary key, or the
 * identifier itself, with its leading number and separators dropped (`UI-CharacterCreation-05_brown_liquorice` →
 * `Brown liquorice`, `eyes_color` → `Eyes color`). A primary key alone (`LocKey#123`) has no readable form: null.
 */
export function readableName(value: string): string | null {
  if (!value || /^LocKey#/.test(value)) return null;
  const tail = isTextKey(value) ? value.slice(value.lastIndexOf("-") + 1) : value;
  const words = tail.replace(/^[0-9]+_/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\s]+/g, " ").trim().toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : null;
}

export interface DisplayLabel {
  readonly text: string;
  /** The resource's value (a key, or the text written out). */
  readonly key: string;
  /** `game`/`mod`: from that text table; `verbatim`: shown as written, as the creator does; `derived`: made readable from an identifier. */
  readonly source: "game" | "mod" | "verbatim" | "derived";
}

/**
 * The label for a resource value: its text, else the value itself when it is not a key (the creator shows it as
 * written), else a readable form of the key or of `fallback` (an option or definition name).
 */
export function displayLabel(table: TextTable | null, value: string, fallback: string, bodyGender: "female" | "male" = "female"): DisplayLabel {
  const resolved = value ? table?.resolve(value, bodyGender) : null;
  if (resolved) return { text: resolved.text, key: value, source: resolved.source.kind };
  if (value && !isTextKey(value)) return { text: value, key: value, source: "verbatim" };
  return { text: readableName(value) ?? readableName(fallback) ?? fallback, key: value, source: "derived" };
}

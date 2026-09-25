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

export class TextTable {
  private readonly byPrimary = new Map<string, { entry: TextEntry; source: TextSourceInfo }>();
  private readonly bySecondary = new Map<string, { entry: TextEntry; source: TextSourceInfo }>();
  constructor(readonly language: string) {}

  /** Add entries; `replace` false only fills keys that are still missing (ArchiveXL's fallback language). */
  add(entries: readonly TextEntry[], source: TextSourceInfo, replace = true): this {
    for (const entry of entries) {
      // ArchiveXL skips comment rows whose secondary key starts with `-` or `=`.
      if (source.kind === "mod" && /^[-=]/.test(entry.secondaryKey)) continue;
      const value = { entry, source };
      if (entry.primaryKey !== "0" && (replace || !this.byPrimary.has(entry.primaryKey))) this.byPrimary.set(entry.primaryKey, value);
      if (entry.secondaryKey && (replace || !this.bySecondary.has(entry.secondaryKey))) this.bySecondary.set(entry.secondaryKey, value);
    }
    return this;
  }

  get size() { return this.byPrimary.size + this.bySecondary.size; }

  /** The text a key shows, or null when the table has none. */
  resolve(key: string, bodyGender: "female" | "male" = "female"): ResolvedText | null {
    if (!key) return null;
    const lockey = /^LocKey#(\d{1,20})$/.exec(key);
    const found = lockey ? this.byPrimary.get(BigInt(lockey[1]!).toString()) : this.bySecondary.get(key);
    if (!found) return null;
    const text = bodyGender === "male" && found.entry.male ? found.entry.male : found.entry.female;
    return text ? { text, source: found.source } : null;
  }
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

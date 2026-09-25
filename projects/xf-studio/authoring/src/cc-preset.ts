/**
 * The portable character-creator preset, `xfs/cc-preset-1`: the creator choices of one V, so another user can show
 * their makeup on the same face. Pure codec. A CC preset is preview context: it never enters makeup recipes, collections
 * or game packages.
 *
 * Only portable identities are stored (knowledge/cc-file-chain.md §2 "Identity"): the option's part and name, and the
 * choice as the creator merges it — a definition name (with the `.app` hash as a hint), a morph target, or a switcher
 * choice name plus the option names it activates (stable across installations with different mods, where the choice
 * names are renumbered). A choice a mod supplies names that mod, so a user without it gets a plain report. No file
 * path, save path or account name is ever written; values that look like a path are refused.
 *
 * Unknown top-level fields, unknown fields of an entry and entries of an unknown kind are kept and written back
 * unchanged, so a newer Studio's additions survive a round trip through this one.
 */
import type { CcoPart } from "./cco-model";
import type { BodyGender } from "./cc-catalogue";

export const CC_PRESET_SCHEMA = "xfs/cc-preset-1" as const;
export const CC_PRESET_LIMITS = Object.freeze({ bytes: 1024 * 1024, entries: 8192, text: 256, name: 120 });

export type CcPresetValue =
  | { readonly kind: "appearance"; readonly definition: string; readonly app: string | null }
  | { readonly kind: "morph"; readonly morph: string }
  | { readonly kind: "switcher"; readonly choice: string; readonly activates: readonly string[] };
export interface CcPresetEntry {
  readonly part: CcoPart;
  readonly option: string;
  readonly value: CcPresetValue;
  /** The mod that supplies the choice (absent for vanilla). */
  readonly mod: string | null;
  /** Depot hash of the custom creator resource that supplies it (absent for vanilla). */
  readonly resource: string | null;
  /** Fields this version doesn't know, kept for the round trip. */
  readonly extra: Readonly<Record<string, unknown>>;
}
export interface CcPreset {
  readonly schema: typeof CC_PRESET_SCHEMA;
  readonly bodyGender: BodyGender;
  readonly name: string | null;
  readonly values: readonly CcPresetEntry[];
  /** Entries of a kind this version doesn't know, kept verbatim with their position among the values. */
  readonly unknownEntries: readonly { readonly at: number; readonly entry: unknown }[];
  readonly extra: Readonly<Record<string, unknown>>;
}

const PARTS: readonly CcoPart[] = ["head", "body", "arms"];
const ENTRY_KEYS = new Set(["part", "option", "definition", "app", "morph", "choice", "activates", "mod", "resource"]);
const TOP_KEYS = new Set(["schema", "bodyGender", "name", "values"]);

const fail = (message: string): never => { throw Error(`This character preset can't be read: ${message}`); };
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
/** A creator identifier: no control characters, no path separators, bounded. Empty is the `None` choice. */
function ident(value: unknown, what: string, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > CC_PRESET_LIMITS.text || /[\u0000-\u001f\\/]/.test(value) || (!allowEmpty && !value))
    return fail(`${what} is not a valid creator name.`);
  return value;
}
const hash = (value: unknown, what: string): string =>
  typeof value === "string" && /^\d{1,20}$/.test(value) && BigInt(value) <= 18446744073709551615n ? BigInt(value).toString() : fail(`${what} is not a resource hash.`);
function modName(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > CC_PRESET_LIMITS.text || /[\u0000-\u001f\\/]|^[A-Za-z]:/.test(value))
    return fail("a mod name is invalid.");
  return value;
}

function parseEntry(item: unknown): CcPresetEntry | null {
  if (!isRecord(item)) return fail("a value is not an object.");
  const kinds = ["definition", "morph", "choice"].filter(key => key in item);
  // An entry of a kind this version doesn't know is kept verbatim.
  if (kinds.length === 0) return null;
  if (kinds.length > 1) fail("a value names more than one kind of choice.");
  if (!PARTS.includes(item.part as CcoPart)) fail("a value's part is invalid.");
  const option = ident(item.option, "an option");
  let value: CcPresetValue;
  if (kinds[0] === "definition") value = { kind: "appearance", definition: ident(item.definition, "a definition", true),
    app: item.app === undefined ? null : hash(item.app, "an appearance resource") };
  else if (kinds[0] === "morph") value = { kind: "morph", morph: ident(item.morph, "a morph target", true) };
  else {
    if (item.activates !== undefined && (!Array.isArray(item.activates) || item.activates.length > 64)) fail("a switcher value's options are invalid.");
    value = { kind: "switcher", choice: ident(item.choice, "a switcher choice", true),
      activates: ((item.activates as unknown[] | undefined) ?? []).map(name => ident(name, "an activated option")) };
  }
  const extra: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(item)) if (!ENTRY_KEYS.has(key)) extra[key] = structuredClone(field);
  return { part: item.part as CcoPart, option, value, mod: item.mod === undefined ? null : modName(item.mod),
    resource: item.resource === undefined ? null : hash(item.resource, "a creator resource"), extra };
}

/** Parse a decoded preset strictly; throws a plain error naming what is wrong. */
export function parseCcPreset(value: unknown): CcPreset {
  if (!isRecord(value)) return fail("it is not a preset file.");
  if (value.schema !== CC_PRESET_SCHEMA) fail(typeof value.schema === "string" && value.schema.startsWith("xfs/cc-preset-")
    ? "it was made by a newer XF Studio." : "it is not a character preset.");
  if (value.bodyGender !== "female" && value.bodyGender !== "male") fail("its body type is missing.");
  if (value.name !== undefined && (typeof value.name !== "string" || value.name.length > CC_PRESET_LIMITS.name || /[\u0000-\u001f]/.test(value.name)))
    fail("its name is invalid.");
  if (!Array.isArray(value.values) || value.values.length > CC_PRESET_LIMITS.entries) fail("its values are missing or too many.");
  const values: CcPresetEntry[] = [], unknownEntries: { at: number; entry: unknown }[] = [];
  (value.values as unknown[]).forEach((item, at) => {
    const entry = parseEntry(item);
    if (entry) values.push(entry); else unknownEntries.push({ at, entry: structuredClone(item) });
  });
  const seen = new Set<string>();
  for (const entry of values) {
    const key = `${entry.part}/${entry.option}`;
    if (seen.has(key)) fail(`it sets ${entry.option} twice.`);
    seen.add(key);
  }
  const extra: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) if (!TOP_KEYS.has(key)) extra[key] = structuredClone(field);
  return { schema: CC_PRESET_SCHEMA, bodyGender: value.bodyGender as BodyGender, name: typeof value.name === "string" ? value.name : null, values, unknownEntries, extra };
}

/** Parse preset text (a `.json` file); refuses oversized input before decoding it. */
export function readCcPreset(text: string): CcPreset {
  if (text.length > CC_PRESET_LIMITS.bytes) fail("the file is larger than 1 MB.");
  let value: unknown;
  try { value = JSON.parse(text); } catch { return fail("it is not valid JSON."); }
  return parseCcPreset(value);
}

/** The stored form: known fields in a fixed order, then the kept unknown ones. */
export function serializeCcPreset(preset: CcPreset): Record<string, unknown> {
  const entry = (item: CcPresetEntry): Record<string, unknown> => {
    const out: Record<string, unknown> = { part: item.part, option: item.option };
    if (item.value.kind === "appearance") { out.definition = item.value.definition; if (item.value.app) out.app = item.value.app; }
    else if (item.value.kind === "morph") out.morph = item.value.morph;
    else { out.choice = item.value.choice; if (item.value.activates.length) out.activates = [...item.value.activates]; }
    if (item.mod) out.mod = item.mod;
    if (item.resource) out.resource = item.resource;
    return { ...out, ...structuredClone(item.extra) };
  };
  const values: unknown[] = preset.values.map(entry);
  for (const unknown of [...preset.unknownEntries].sort((a, b) => a.at - b.at))
    values.splice(Math.min(unknown.at, values.length), 0, structuredClone(unknown.entry));
  return { schema: preset.schema, bodyGender: preset.bodyGender, ...(preset.name ? { name: preset.name } : {}), values, ...structuredClone(preset.extra) };
}

export const writeCcPreset = (preset: CcPreset): string => `${JSON.stringify(serializeCcPreset(preset), null, 1)}\n`;

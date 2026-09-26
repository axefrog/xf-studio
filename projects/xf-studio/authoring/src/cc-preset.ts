/**
 * The portable character-creator preset, `xfs/cc-preset-1`: the creator choices of one V, so another user can show
 * their makeup on the same face. Pure codec. A CC preset is preview context: it never enters makeup recipes, collections
 * or game packages.
 *
 * Only portable identities are stored (knowledge/cc-file-chain.md §2 "Identity"): the option's part and name, and the
 * choice as the creator merges it — a definition name (with the `.app` hash as a hint), a morph target, or a switcher
 * choice name plus the option names it activates (stable across installations with different mods, where the choice
 * names are renumbered). A choice a mod supplies names that mod, so a user without it gets a plain report. Only the
 * choices a person set are stored: options that follow them (a skin tone's skin types, other hairstyles' colours) are
 * derived again on load (CORE-51). No file path, save path or account name is ever written: the writer (the host) checks
 * the text with the repository's personal-data patterns (private-data.ts; CORE-56).
 *
 * Unknown top-level fields, unknown fields of an entry and entries of an unknown kind are kept and written back
 * unchanged, so a newer Studio's additions survive a round trip through this one. They are copied into prototype-free
 * objects with a bounded depth and size (CORE-54, CORE-55).
 */
import type { CcoPart } from "./cco-model";
import type { BodyGender } from "./cc-catalogue";
import { CREATOR_LIMITS, isCreatorName, isModName, isPresetName } from "./creator-names";

export const CC_PRESET_SCHEMA = "xfs/cc-preset-1" as const;
/**
 * `bytes` counts the file's UTF-8 bytes; names follow the shared creator rule (creator-names.ts, PIPE-79); `depth` and `nodes` bound
 * what unknown fields may hold.
 */
export const CC_PRESET_LIMITS = Object.freeze({ bytes: CREATOR_LIMITS.presetBytes, entries: CREATOR_LIMITS.presetEntries, text: CREATOR_LIMITS.name,
  name: CREATOR_LIMITS.presetName, depth: 16, nodes: 20_000 });

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
  /** Fields this version doesn't know, kept for the round trip (a prototype-free object). */
  readonly extra: Readonly<Record<string, unknown>>;
}
export interface CcPreset {
  readonly schema: typeof CC_PRESET_SCHEMA;
  readonly bodyGender: BodyGender;
  readonly name: string | null;
  readonly values: readonly CcPresetEntry[];
  /**
   * Entries kept verbatim with their position among the values: of a kind this version doesn't know, or (`unusable`) of a known kind
   * whose name is longer than the shared rule allows, so it can't be carried to the host (PIPE-79). Both are written back unchanged.
   */
  readonly unknownEntries: readonly { readonly at: number; readonly entry: unknown; readonly unusable?: true }[];
  readonly extra: Readonly<Record<string, unknown>>;
}

const PARTS: readonly CcoPart[] = ["head", "body", "arms"];
/** A known entry whose name is only too long: kept verbatim and reported, never refused (PIPE-79). */
class TooLong extends Error {}
const ENTRY_KEYS = new Set(["part", "option", "definition", "app", "morph", "choice", "activates", "mod", "resource"]);
const TOP_KEYS = new Set(["schema", "bodyGender", "name", "values"]);

const fail = (message: string): never => { throw Error(`This character preset can't be read: ${message}`); };
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const own = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key);
/**
 * A creator identifier (a CName) by the shared rule (creator-names.ts): no control characters and no backslash (a Windows path
 * separator), bounded. `/` is legal in a CName, so it is kept (CORE-53). Empty is the `None` choice. A name that is only too long
 * makes its entry unusable here rather than the file unreadable.
 */
function ident(value: unknown, what: string, allowEmpty = false): string {
  if (isCreatorName(value, allowEmpty)) return value;
  if (typeof value === "string" && value.length > CREATOR_LIMITS.name && !/[\u0000-\u001f\u007f\\]/.test(value)) throw new TooLong();
  return fail(`${what} is not a valid creator name.`);
}
const hash = (value: unknown, what: string): string =>
  typeof value === "string" && /^\d{1,20}$/.test(value) && BigInt(value) <= 18446744073709551615n ? BigInt(value).toString() : fail(`${what} is not a resource hash.`);
/** A mod's name as a mod manager shows it: never a path. */
function modName(value: unknown): string {
  if (isModName(value)) return value;
  if (typeof value === "string" && value.length > CREATOR_LIMITS.modName && !/[\u0000-\u001f\u007f\\/]|^[A-Za-z]:/.test(value)) throw new TooLong();
  return fail("a mod name is invalid.");
}

/** A copy of an unknown JSON value into prototype-free objects, within the preset's depth and size bounds. */
class Budget { nodes = 0 }
function copyUnknown(value: unknown, budget: Budget, depth = 0): unknown {
  if (++budget.nodes > CC_PRESET_LIMITS.nodes) fail("it holds too much data.");
  if (depth > CC_PRESET_LIMITS.depth) fail("it is nested too deeply.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : fail("it holds an invalid number.");
  if (Array.isArray(value)) return value.map(item => copyUnknown(item, budget, depth + 1));
  if (typeof value === "object") {
    const out = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value)) out[key] = copyUnknown((value as Record<string, unknown>)[key], budget, depth + 1);
    return out;
  }
  return fail("it holds a value JSON can't carry.");
}

/** A known entry, null for an unknown kind, or "unusable" for a known entry whose name is only too long. */
function readEntry(item: unknown, budget: Budget): CcPresetEntry | null | "unusable" {
  try { return parseEntry(item, budget); } catch (error) { if (error instanceof TooLong) return "unusable"; throw error; }
}
function parseEntry(item: unknown, budget: Budget): CcPresetEntry | null {
  if (!isRecord(item)) return fail("a value is not an object.");
  const kinds = ["definition", "morph", "choice"].filter(key => own(item, key));
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
    if (item.activates !== undefined && (!Array.isArray(item.activates) || item.activates.length > CREATOR_LIMITS.activates)) fail("a switcher value's options are invalid.");
    value = { kind: "switcher", choice: ident(item.choice, "a switcher choice", true),
      activates: ((item.activates as unknown[] | undefined) ?? []).map(name => ident(name, "an activated option")) };
  }
  const extra = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(item)) if (!ENTRY_KEYS.has(key)) extra[key] = copyUnknown(item[key], budget, 1);
  return { part: item.part as CcoPart, option, value, mod: item.mod === undefined ? null : modName(item.mod),
    resource: item.resource === undefined ? null : hash(item.resource, "a creator resource"), extra };
}

/** Parse a decoded preset strictly; throws a plain error naming what is wrong. */
export function parseCcPreset(value: unknown): CcPreset {
  if (!isRecord(value)) return fail("it is not a preset file.");
  if (value.schema !== CC_PRESET_SCHEMA) fail(typeof value.schema === "string" && value.schema.startsWith("xfs/cc-preset-")
    ? "it was made by a newer XF Studio." : "it is not a character preset.");
  if (value.bodyGender !== "female" && value.bodyGender !== "male") fail("its body type is missing.");
  if (value.name !== undefined && !isPresetName(value.name)) fail("its name is invalid.");
  if (!Array.isArray(value.values) || value.values.length > CC_PRESET_LIMITS.entries) fail("its values are missing or too many.");
  const budget = new Budget();
  const values: CcPresetEntry[] = [], unknownEntries: { at: number; entry: unknown; unusable?: true }[] = [];
  (value.values as unknown[]).forEach((item, at) => {
    const entry = readEntry(item, budget);
    if (entry && entry !== "unusable") values.push(entry);
    else unknownEntries.push({ at, entry: copyUnknown(item, budget, 1), ...(entry === "unusable" ? { unusable: true as const } : {}) });
  });
  const seen = new Set<string>();
  for (const entry of values) {
    const key = `${entry.part}/${entry.option}`;
    if (seen.has(key)) fail(`it sets ${entry.option} twice.`);
    seen.add(key);
  }
  const extra = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) if (!TOP_KEYS.has(key)) extra[key] = copyUnknown(value[key], budget, 1);
  return { schema: CC_PRESET_SCHEMA, bodyGender: value.bodyGender as BodyGender, name: typeof value.name === "string" ? value.name : null, values, unknownEntries, extra };
}

const encoder = new TextEncoder();
/**
 * Parse a preset file's bytes (or its text) once; refuses more than 1 MB of UTF-8 before decoding it, and a document nested too deeply
 * for the parser with a plain reason (CORE-55).
 */
export function readCcPreset(input: string | Uint8Array): CcPreset {
  const bytes = typeof input === "string" ? encoder.encode(input).byteLength : input.byteLength;
  if (bytes > CC_PRESET_LIMITS.bytes) fail("the file is larger than 1 MB.");
  let value: unknown;
  try { value = JSON.parse(typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input)); }
  catch (error) { return fail(error instanceof RangeError ? "it is nested too deeply." : "it is not valid JSON."); }
  return parseCcPreset(value);
}

/** A preset file's JSON, read once, within the size limit (the preset itself is read by `parseCcPreset`). */
export function readPresetJson(bytes: Uint8Array): unknown {
  if (bytes.byteLength > CC_PRESET_LIMITS.bytes) fail("the file is larger than 1 MB.");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return fail("it is not text."); }
  try { return JSON.parse(text); } catch (error) { return fail(error instanceof RangeError ? "it is nested too deeply." : "it is not valid JSON."); }
}

/** One entry in its stored form. */
export function serializeCcPresetEntry(item: CcPresetEntry): Record<string, unknown> {
  const out: Record<string, unknown> = { part: item.part, option: item.option };
  if (item.value.kind === "appearance") { out.definition = item.value.definition; if (item.value.app) out.app = item.value.app; }
  else if (item.value.kind === "morph") out.morph = item.value.morph;
  else { out.choice = item.value.choice; if (item.value.activates.length) out.activates = [...item.value.activates]; }
  if (item.mod) out.mod = item.mod;
  if (item.resource) out.resource = item.resource;
  return { ...out, ...copyUnknown(item.extra, new Budget(), 1) as Record<string, unknown> };
}

/** Would the reader accept this entry as written (CORE-53)? A writer leaves out what it would refuse, instead of refusing the file. */
export function presetEntryWritable(item: CcPresetEntry): boolean {
  try { const read = readEntry(serializeCcPresetEntry(item), new Budget()); return !!read && read !== "unusable"; } catch { return false; }
}

/** The stored form: known fields in a fixed order, then the kept unknown ones. */
export function serializeCcPreset(preset: CcPreset): Record<string, unknown> {
  const values: unknown[] = preset.values.map(serializeCcPresetEntry);
  for (const unknown of [...preset.unknownEntries].sort((a, b) => a.at - b.at))
    values.splice(Math.min(unknown.at, values.length), 0, copyUnknown(unknown.entry, new Budget(), 1));
  return { schema: preset.schema, bodyGender: preset.bodyGender, ...(preset.name ? { name: preset.name } : {}), values,
    ...copyUnknown(preset.extra, new Budget(), 1) as Record<string, unknown> };
}

export const writeCcPreset = (preset: CcPreset): string => `${JSON.stringify(serializeCcPreset(preset), null, 1)}\n`;

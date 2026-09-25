/**
 * The character the preview's resolved details are prepared for, as the browser hands it to the host:
 * either the creator's default V, or the head descriptors a loaded save stores (option, `.app` hash and
 * definition per consumer group, plus the chosen morphs). Pure and shared by both sides; the host parses
 * every request strictly, so only these small fields ever cross the boundary (never a path or a file).
 *
 * Versions: `xfs/character-request-1` is the V alone; `xfs/character-request-2` may add an `override`, a creator choice the
 * viewer tries in the viewport in place of the V's own on one choice slot (a piercing style and colour). The host resolves the
 * override from the creator resource, so it names an option and a definition only, never a resource. A v1 request still parses.
 */
import type { AppearanceDescriptor, MorphDescriptor } from "./cco-model";
import type { BodyGender, CharacterInput } from "./character-resolver";
import { refFromHash } from "./depot-path";
import { CHOICE_SLOTS, type RenderOverride } from "./render-detail";
import type { SavedV } from "./save-reader";

export const CHARACTER_REQUEST_SCHEMA = "xfs/character-request-2" as const;
const EARLIER_REQUEST_SCHEMAS: readonly string[] = ["xfs/character-request-1"];
export type SavedHeadAppearance = { group: string; option: string; app: string; definition: string };
export type SavedHeadMorph = { group: string; region: string; target: string };
/** A viewer's tried choice on one choice slot (render-detail.ts `CHOICE_SLOTS`). */
export type CharacterOverride = RenderOverride;
export type CharacterRequest =
  | { schema: typeof CHARACTER_REQUEST_SCHEMA; source: "default"; bodyGender: "female"; override?: CharacterOverride }
  | { schema: typeof CHARACTER_REQUEST_SCHEMA; source: "save"; bodyGender: BodyGender;
      appearances: SavedHeadAppearance[]; morphs: SavedHeadMorph[]; override?: CharacterOverride };

export const DEFAULT_CHARACTER: CharacterRequest = Object.freeze({ schema: CHARACTER_REQUEST_SCHEMA, source: "default", bodyGender: "female" });
const MAX_APPEARANCES = 512, MAX_MORPHS = 128;

/** The head descriptors of a decoded save, in stored order (the save repeats a choice per consumer group). */
export function characterRequestFromSave(v: SavedV): CharacterRequest {
  return { schema: CHARACTER_REQUEST_SCHEMA, source: "save", bodyGender: v.isMale ? "male" : "female",
    appearances: v.groups.head.flatMap(group => group.appearances.map(item =>
      ({ group: group.name, option: item.name, app: item.resourceHash, definition: item.definition }))).slice(0, MAX_APPEARANCES),
    morphs: v.groups.head.flatMap(group => group.morphs.map(morph =>
      ({ group: group.name, region: morph.region, target: morph.target }))).slice(0, MAX_MORPHS) };
}

const fail = (message: string): never => { throw Error(`Character request: ${message}`); };
const cname = (value: unknown, what: string) =>
  typeof value === "string" && value.length <= 128 && /^[^\u0000-\u001f\\/<>"]*$/.test(value) ? value : fail(`${what} is invalid.`);
const hash = (value: unknown) => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 18446744073709551615n
  ? value : fail("an appearance resource hash is invalid.");
const exactKeys = (value: object, keys: string[]) => Object.keys(value).sort().join() === [...keys].sort().join();

function parseOverride(value: unknown): CharacterOverride {
  const item = value as Record<string, unknown>;
  if (!item || typeof item !== "object" || Array.isArray(item) || !exactKeys(item, ["slot", "option", "definition"]) ||
      !CHOICE_SLOTS.includes(item.slot as CharacterOverride["slot"])) return fail("the tried choice is invalid.");
  const name = (v: unknown, what: string) => typeof v === "string" && /^[A-Za-z0-9_.@:+ -]{1,96}$/.test(v) ? v : fail(`the tried ${what} is invalid.`);
  return { slot: item.slot as CharacterOverride["slot"], option: name(item.option, "option"), definition: name(item.definition, "definition") };
}

/** Strict parse: anything else than the documented fields is refused. */
export function parseCharacterRequest(value: unknown): CharacterRequest {
  const doc = value as Record<string, unknown>;
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || (doc.schema !== CHARACTER_REQUEST_SCHEMA && !EARLIER_REQUEST_SCHEMAS.includes(String(doc.schema))))
    fail("unsupported request.");
  // Only a v2 request may carry a tried choice.
  const withOverride = doc.schema === CHARACTER_REQUEST_SCHEMA && doc.override !== undefined;
  const override = withOverride ? { override: parseOverride(doc.override) } : {};
  const keys = (base: string[]) => withOverride ? [...base, "override"] : base;
  if (doc.source === "default") {
    if (!exactKeys(doc, keys(["schema", "source", "bodyGender"])) || doc.bodyGender !== "female") fail("the default V is female only.");
    return withOverride ? { ...DEFAULT_CHARACTER, ...override } : DEFAULT_CHARACTER;
  }
  if (doc.source !== "save" || !exactKeys(doc, keys(["schema", "source", "bodyGender", "appearances", "morphs"]))) fail("unknown source.");
  if (doc.bodyGender !== "female" && doc.bodyGender !== "male") fail("body gender is invalid.");
  if (!Array.isArray(doc.appearances) || doc.appearances.length > MAX_APPEARANCES) fail("appearances are invalid.");
  if (!Array.isArray(doc.morphs) || doc.morphs.length > MAX_MORPHS) fail("morphs are invalid.");
  const appearances = (doc.appearances as Record<string, unknown>[]).map(item => {
    if (!item || typeof item !== "object" || !exactKeys(item, ["group", "option", "app", "definition"])) fail("an appearance is invalid.");
    return { group: cname(item.group, "group"), option: cname(item.option, "option"), app: hash(item.app), definition: cname(item.definition, "definition") };
  });
  const morphs = (doc.morphs as Record<string, unknown>[]).map(item => {
    if (!item || typeof item !== "object" || !exactKeys(item, ["group", "region", "target"])) fail("a morph is invalid.");
    return { group: cname(item.group, "group"), region: cname(item.region, "region"), target: cname(item.target, "target") };
  });
  return { schema: CHARACTER_REQUEST_SCHEMA, source: "save", bodyGender: doc.bodyGender as BodyGender, appearances, morphs, ...override };
}

/** The character the preview shows: the loaded save's V, or the creator's default female V without one; with the viewer's tried choice. */
export function characterRequestFor(v: SavedV | undefined, override?: CharacterOverride | null): CharacterRequest {
  const request = v && !v.isMale ? characterRequestFromSave(v) : DEFAULT_CHARACTER;
  return override ? { ...request, override: { ...override } } : request;
}

/** The same V, whatever choice the viewer tries on it (switching a tried choice keeps the V's other details on screen). */
export function sameCharacter(a: CharacterRequest, b: CharacterRequest): boolean {
  const { override: _a, ...left } = a, { override: _b, ...right } = b;
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Resolver input for a saved request (the default V is derived from the effective creator resource instead). */
export function inputFromCharacterRequest(request: Extract<CharacterRequest, { source: "save" }>): CharacterInput {
  const appearances: AppearanceDescriptor[] = request.appearances.map(item =>
    ({ part: "head", group: item.group, option: item.option, app: refFromHash(item.app), definition: item.definition }));
  const morphs: MorphDescriptor[] = request.morphs.map(item => ({ part: "head", group: item.group, region: item.region, target: item.target }));
  return { bodyGender: request.bodyGender, origin: "save", appearances, morphs };
}

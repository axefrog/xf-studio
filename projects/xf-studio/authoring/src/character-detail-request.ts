/**
 * The character the preview's resolved details are prepared for, as the browser hands it to the host:
 * either the creator's default V, or the head descriptors a loaded save stores (option, `.app` hash and
 * definition per consumer group, plus the chosen morphs). Pure and shared by both sides; the host parses
 * every request strictly, so only these small fields ever cross the boundary (never a path or a file).
 */
import type { AppearanceDescriptor, MorphDescriptor } from "./cco-model";
import type { BodyGender, CharacterInput } from "./character-resolver";
import { refFromHash } from "./depot-path";
import type { SavedV } from "./save-reader";

export const CHARACTER_REQUEST_SCHEMA = "xfs/character-request-1" as const;
export type SavedHeadAppearance = { group: string; option: string; app: string; definition: string };
export type SavedHeadMorph = { group: string; region: string; target: string };
export type CharacterRequest =
  | { schema: typeof CHARACTER_REQUEST_SCHEMA; source: "default"; bodyGender: "female" }
  | { schema: typeof CHARACTER_REQUEST_SCHEMA; source: "save"; bodyGender: BodyGender;
      appearances: SavedHeadAppearance[]; morphs: SavedHeadMorph[] };

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

/** Strict parse: anything else than the documented fields is refused. */
export function parseCharacterRequest(value: unknown): CharacterRequest {
  const doc = value as Record<string, unknown>;
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || doc.schema !== CHARACTER_REQUEST_SCHEMA) fail("unsupported request.");
  if (doc.source === "default") {
    if (!exactKeys(doc, ["schema", "source", "bodyGender"]) || doc.bodyGender !== "female") fail("the default V is female only.");
    return DEFAULT_CHARACTER;
  }
  if (doc.source !== "save" || !exactKeys(doc, ["schema", "source", "bodyGender", "appearances", "morphs"])) fail("unknown source.");
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
  return { schema: CHARACTER_REQUEST_SCHEMA, source: "save", bodyGender: doc.bodyGender as BodyGender, appearances, morphs };
}

/** The character the preview shows: the loaded save's V, or the creator's default female V without one. */
export function characterRequestFor(v: SavedV | undefined): CharacterRequest {
  return v && !v.isMale ? characterRequestFromSave(v) : DEFAULT_CHARACTER;
}

/** Resolver input for a saved request (the default V is derived from the effective creator resource instead). */
export function inputFromCharacterRequest(request: Extract<CharacterRequest, { source: "save" }>): CharacterInput {
  const appearances: AppearanceDescriptor[] = request.appearances.map(item =>
    ({ part: "head", group: item.group, option: item.option, app: refFromHash(item.app), definition: item.definition }));
  const morphs: MorphDescriptor[] = request.morphs.map(item => ({ part: "head", group: item.group, region: item.region, target: item.target }));
  return { bodyGender: request.bodyGender, origin: "save", appearances, morphs };
}

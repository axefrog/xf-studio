/**
 * The character the preview's resolved details are prepared for, as the browser hands it to the host: the V it starts from (the
 * creator's default V, or the descriptors a loaded save stores: option, `.app` hash and definition per consumer group, plus the chosen
 * morphs) and the creator choices a person set on top of it (the character context's state, character-context.ts). Pure and shared
 * by both sides; the host parses every request strictly, so only these small fields ever cross the boundary (never a path or a file).
 *
 * Versions: `xfs/character-request-1` is the V alone; `-2` added an `override` naming an option; `-3` named a tried piercing choice as
 * the creator does; `-4` replaces the tried choice with the whole creator state (CORE-58): `choices` a person set, and a save's
 * descriptors of every part (`part` on each, head when absent). The host interprets the choices with the installed creator catalogue
 * (`deriveCharacter`), so a choice never names a resource. A v1–v3 request without an override still parses; a v3 tried choice is a
 * page built apart from this host and is refused, which that page reports as a version skew. `-5` adds `clothing`: the save's clothing
 * areas (item record IDs and hide flags), the areas the viewer's Clothing setting shows, and the creator's hair type (clothing-dressing.ts);
 * a v4 request is a V without clothes. `-6` adds `body: false`, the V with its body turned off (the Body switch): the host prepares the head
 * alone, neither the body nor its clothes (PREV-108); a v5 request draws the body. `-7` adds `nudity: true`, the V as the game draws it with
 * nudity allowed (the viewer's uncensored setting; knowledge/body-rendering.md §3): the host plans the body by the creator's censorship
 * rules with nudity allowed, so neither the censorship underwear nor the censored skin draws; a v6 request is the censored V.
 */
import type { AppearanceDescriptor, CcoPart, MorphDescriptor } from "./cco-model";
import type { BodyGender, CharacterInput } from "./character-resolver";
import { type CharacterChoice, characterChoiceOf, type SavedDescriptors } from "./character-context";
import { CREATOR_LIMITS, isCreatorName } from "./creator-names";
import { refFromHash } from "./depot-path";
import type { SavedV } from "./save-reader";
import { type CharacterClothing, HAIR_TYPES, type HairType } from "./clothing-dressing";
import { CLOTHING_AREAS, isClothingArea } from "./save-loadout";

export const CHARACTER_REQUEST_SCHEMA = "xfs/character-request-7" as const;
const EARLIER_REQUEST_SCHEMAS: readonly string[] = ["xfs/character-request-1", "xfs/character-request-2", "xfs/character-request-3", "xfs/character-request-4",
  "xfs/character-request-5", "xfs/character-request-6"];
/** Earlier versions that carry creator choices and parts (v4–v6). */
const CHOICE_SCHEMAS: readonly string[] = [CHARACTER_REQUEST_SCHEMA, "xfs/character-request-6", "xfs/character-request-5", "xfs/character-request-4"];
/** Earlier versions that carry clothing (v5, v6). */
const CLOTHING_SCHEMAS: readonly string[] = [CHARACTER_REQUEST_SCHEMA, "xfs/character-request-6", "xfs/character-request-5"];
/** Earlier versions that carry the body switch (v6). */
const BODY_SCHEMAS: readonly string[] = [CHARACTER_REQUEST_SCHEMA, "xfs/character-request-6"];

/** A request whose version this host doesn't read (the page and the host were built apart). */
export class CharacterRequestVersionError extends Error {
  constructor(readonly schema: string) { super(`Character request: version ${schema} is not one this host reads.`); }
}
export type SavedAppearance = { part: CcoPart; group: string; option: string; app: string; definition: string };
export type SavedMorph = { part: CcoPart; group: string; region: string; target: string };
/**
 * `body: false`: the V with its body (and so its clothes) turned off; absent, the body is drawn. `nudity: true`: the body as the game draws
 * it with nudity allowed; absent, the game's censored look (never with `body: false`).
 */
export type CharacterRequest =
  | { schema: typeof CHARACTER_REQUEST_SCHEMA; source: "default"; bodyGender: BodyGender; choices?: CharacterChoice[]; clothing?: CharacterClothing; body?: false;
      nudity?: true }
  | { schema: typeof CHARACTER_REQUEST_SCHEMA; source: "save"; bodyGender: BodyGender;
      appearances: SavedAppearance[]; morphs: SavedMorph[]; choices?: CharacterChoice[]; clothing?: CharacterClothing; body?: false; nudity?: true };

export const DEFAULT_CHARACTER: CharacterRequest = Object.freeze({ schema: CHARACTER_REQUEST_SCHEMA, source: "default", bodyGender: "female" });
const MAX_APPEARANCES = CREATOR_LIMITS.appearances, MAX_MORPHS = CREATOR_LIMITS.morphs, MAX_CHOICES = CREATOR_LIMITS.choices;
const PARTS: readonly string[] = ["head", "body", "arms"];

/** The descriptors of a decoded save, in stored order (the save repeats a choice per consumer group); `parts` limits them (default: every part). */
export function characterRequestFromSave(v: SavedV, parts: readonly CcoPart[] = ["head", "body", "arms"]): CharacterRequest {
  return { schema: CHARACTER_REQUEST_SCHEMA, source: "save", bodyGender: v.isMale ? "male" : "female",
    appearances: parts.flatMap(part => (v.groups[part] ?? []).flatMap(group => group.appearances.map(item =>
      ({ part, group: group.name, option: item.name, app: item.resourceHash, definition: item.definition })))).slice(0, MAX_APPEARANCES),
    morphs: parts.flatMap(part => (v.groups[part] ?? []).flatMap(group => group.morphs.map(morph =>
      ({ part, group: group.name, region: morph.region, target: morph.target })))).slice(0, MAX_MORPHS) };
}
/**
 * A request from a context's base (the save's descriptors), choices and clothing. With `body` false the V's body is off: no clothing is
 * carried and the request says so, so the host prepares the head alone. With `nudity` (and the body on), the body is asked for as the game
 * draws it with nudity allowed.
 */
export function characterRequestOf(base: { bodyGender: BodyGender; saved: SavedDescriptors | null }, choices: readonly CharacterChoice[] = [],
  parts: readonly CcoPart[] = ["head", "body", "arms"], clothing: CharacterClothing | null = null, body = true, nudity = false): CharacterRequest {
  const with_ = { ...(choices.length ? { choices: choices.map(choice => ({ ...choice, ...(choice.activates ? { activates: [...choice.activates] } : {}) })) } : {}),
    ...(clothing && body ? { clothing: { hairType: clothing.hairType, worn: clothing.worn.map(entry => ({ ...entry })), shown: [...clothing.shown] } } : {}),
    ...(body ? {} : { body: false as const }), ...(body && nudity ? { nudity: true as const } : {}) };
  if (!base.saved) return { schema: CHARACTER_REQUEST_SCHEMA, source: "default", bodyGender: base.bodyGender, ...with_ };
  return { schema: CHARACTER_REQUEST_SCHEMA, source: "save", bodyGender: base.bodyGender,
    appearances: base.saved.appearances.filter(item => parts.includes(item.part)).map(item => ({ ...item })),
    morphs: base.saved.morphs.filter(item => parts.includes(item.part)).map(item => ({ ...item })), ...with_ };
}

const fail = (message: string): never => { throw Error(`Character request: ${message}`); };
/** A name by the shared creator rule (creator-names.ts; PIPE-79): what a preset or a save accepted, the request carries. */
const cname = (value: unknown, what: string) => isCreatorName(value, true) ? value : fail(`${what} is invalid.`);
const hash = (value: unknown) => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 18446744073709551615n
  ? value : fail("an appearance resource hash is invalid.");
const exactKeys = (value: object, keys: string[], optional: string[] = []) => {
  const present = Object.keys(value);
  return keys.every(key => present.includes(key)) && present.every(key => keys.includes(key) || optional.includes(key));
};
const partOf = (value: unknown) => value === undefined ? "head" : PARTS.includes(value as string) ? value as CcoPart : fail("a part is invalid.");
/** The clothing a request carries: each clothing area at most once, items as decimal record IDs. */
export function clothingOf(value: unknown): CharacterClothing {
  const doc = value as Record<string, unknown>;
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || !exactKeys(doc, ["hairType", "worn", "shown"])) return fail("the clothing is invalid.");
  if (!HAIR_TYPES.includes(doc.hairType as HairType)) fail("the hair type is invalid.");
  if (!Array.isArray(doc.worn) || doc.worn.length > CLOTHING_AREAS.length || !Array.isArray(doc.shown) || doc.shown.length > CLOTHING_AREAS.length)
    fail("the clothing is invalid.");
  const worn = (doc.worn as Record<string, unknown>[]).map(item => {
    if (!item || typeof item !== "object" || !exactKeys(item, ["area", "item", "hidden"]) || !isClothingArea(item.area) || typeof item.hidden !== "boolean")
      return fail("a worn item is invalid.");
    return { area: item.area, item: hash(item.item), hidden: item.hidden };
  });
  const shown = (doc.shown as unknown[]).map(area => isClothingArea(area) ? area : fail("a clothing area is invalid."));
  if (new Set(worn.map(item => item.area)).size !== worn.length || new Set(shown).size !== shown.length) fail("a clothing area is listed twice.");
  return { hairType: doc.hairType as HairType, worn, shown };
}

/** Strict parse: anything else than the documented fields is refused. */
export function parseCharacterRequest(value: unknown): CharacterRequest {
  const doc = value as Record<string, unknown>;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) fail("unsupported request.");
  const current = doc.schema === CHARACTER_REQUEST_SCHEMA;
  if (!current && !EARLIER_REQUEST_SCHEMAS.includes(String(doc.schema))) {
    // A character request of another version is a page built apart from this host; anything else is simply not a request.
    if (typeof doc.schema === "string" && /^xfs\/character-request-[0-9]{1,4}$/.test(doc.schema)) throw new CharacterRequestVersionError(doc.schema);
    fail("unsupported request.");
  }
  // An earlier request carries neither choices nor parts (v4 carries both, and no clothing; v5 no body switch; v6 no nudity: the censored
  // V); a tried choice (v2, v3) is refused.
  const withChoices = CHOICE_SCHEMAS.includes(String(doc.schema)), withClothing = CLOTHING_SCHEMAS.includes(String(doc.schema));
  const withBody = BODY_SCHEMAS.includes(String(doc.schema));
  const optional = current ? ["choices", "clothing", "body", "nudity"] : withBody ? ["choices", "clothing", "body"] : withClothing ? ["choices", "clothing"]
    : withChoices ? ["choices"] : [];
  let choices: { choices?: CharacterChoice[]; clothing?: CharacterClothing; body?: false; nudity?: true } = {};
  if (withBody && doc.body !== undefined) {
    if (doc.body !== false) fail("the body switch is invalid.");
    if (doc.clothing !== undefined) fail("a V without its body wears no clothes.");
    choices.body = false;
  }
  if (current && doc.nudity !== undefined) {
    if (doc.nudity !== true) fail("the nudity setting is invalid.");
    if (doc.body === false) fail("a V without its body shows no nudity.");
    choices.nudity = true;
  }
  if (withClothing && doc.clothing !== undefined) choices.clothing = clothingOf(doc.clothing);
  if (withChoices && doc.choices !== undefined) {
    if (!Array.isArray(doc.choices) || doc.choices.length > MAX_CHOICES) fail("the creator choices are invalid.");
    const list = (doc.choices as unknown[]).map(item => characterChoiceOf(item) ?? fail("a creator choice is invalid."));
    if (list.length) choices = { ...choices, choices: list };
  }
  if (doc.bodyGender !== "female" && doc.bodyGender !== "male") fail("body gender is invalid.");
  if (doc.source === "default") {
    if (!exactKeys(doc, ["schema", "source", "bodyGender"], optional)) fail("unknown fields.");
    // Earlier hosts drew only the female default V; a request for another is current only.
    if (!withChoices && doc.bodyGender !== "female") fail("the default V is female only.");
    return { schema: CHARACTER_REQUEST_SCHEMA, source: "default", bodyGender: doc.bodyGender as BodyGender, ...choices };
  }
  if (doc.source !== "save" || !exactKeys(doc, ["schema", "source", "bodyGender", "appearances", "morphs"], optional)) fail("unknown source.");
  if (!Array.isArray(doc.appearances) || doc.appearances.length > MAX_APPEARANCES) fail("appearances are invalid.");
  if (!Array.isArray(doc.morphs) || doc.morphs.length > MAX_MORPHS) fail("morphs are invalid.");
  const withPart = withChoices ? ["part"] : [];
  const appearances = (doc.appearances as Record<string, unknown>[]).map(item => {
    if (!item || typeof item !== "object" || !exactKeys(item, ["group", "option", "app", "definition"], withPart)) fail("an appearance is invalid.");
    return { part: partOf(item.part), group: cname(item.group, "group"), option: cname(item.option, "option"), app: hash(item.app),
      definition: cname(item.definition, "definition") };
  });
  const morphs = (doc.morphs as Record<string, unknown>[]).map(item => {
    if (!item || typeof item !== "object" || !exactKeys(item, ["group", "region", "target"], withPart)) fail("a morph is invalid.");
    return { part: partOf(item.part), group: cname(item.group, "group"), region: cname(item.region, "region"), target: cname(item.target, "target") };
  });
  return { schema: CHARACTER_REQUEST_SCHEMA, source: "save", bodyGender: doc.bodyGender as BodyGender, appearances, morphs, ...choices };
}

/** The creator's default V, or a loaded save's V (its descriptors of every part), with no choices on top. */
export function characterRequestFor(v: SavedV | undefined): CharacterRequest {
  return v && !v.isMale ? characterRequestFromSave(v) : DEFAULT_CHARACTER;
}

/** The same V, whatever choices, clothing, body switch and nudity setting are set on it (a change of any keeps the V's other details on screen). */
export function sameCharacter(a: CharacterRequest, b: CharacterRequest): boolean {
  const { choices: _a, clothing: _c, body: _e, nudity: _g, ...left } = a, { choices: _b, clothing: _d, body: _f, nudity: _h, ...right } = b;
  return JSON.stringify(left) === JSON.stringify(right);
}

/** The context base a request stands for (the save's descriptors, or none for the default V). */
export function savedOfRequest(request: CharacterRequest): SavedDescriptors | null {
  return request.source === "save" ? { appearances: request.appearances, morphs: request.morphs } : null;
}

/** Resolver input for a saved request, every part (the default V is derived from the effective creator resource instead). */
export function inputFromCharacterRequest(request: Extract<CharacterRequest, { source: "save" }>): CharacterInput {
  const appearances: AppearanceDescriptor[] = request.appearances.map(item =>
    ({ part: item.part, group: item.group, option: item.option, app: refFromHash(item.app), definition: item.definition }));
  const morphs: MorphDescriptor[] = request.morphs.map(item =>
    ({ part: item.part, group: item.group, region: item.region, target: item.target }));
  return { bodyGender: request.bodyGender, origin: "save", appearances, morphs };
}

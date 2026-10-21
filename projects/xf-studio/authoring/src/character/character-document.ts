/**
 * The character subject's documents (profiles design §1.1): one `character` document per V, and the decoded saves they come from as
 * `saved-v` documents whose ID is a hash of their content, so two characters made from one save share one. Plain typed data and its
 * validation; `CharacterService` (character-service.ts) owns both and writes them only through its commands.
 *
 * - **A character** holds its body (one of two, the game's invariant), where it comes from (`source`: the creator's default V, a save
 *   by its decoded copy and, when known, where the save is on disk, or a preset with the entries this installation couldn't use), and
 *   every creator choice set on it, one per option. Clothing and the own-makeup setting are viewing settings kept with it.
 * - **Which look a V shows belongs to the scene**, never to the character.
 * - **Forward reading:** fields this build doesn't know are kept as they are when it writes the document again.
 */
import type { SavedV } from "../saves/save-reader";
import type { BodyGender } from "./cc-catalogue";
import { parseCcPreset, serializeCcPreset } from "./cc-preset";
import { type CharacterChoice, characterChoiceOf } from "./character-context";
import type { StoredCharacter } from "./character-context-actions";
import { type ClothingSetting, clothingSettingOf, DEFAULT_CLOTHING } from "./clothing-dressing";
import { CREATOR_LIMITS, isPresetName } from "./creator-names";
import type { SubjectKindSpec } from "../platform/api/subjects";
import { sha256Hex } from "../platform/core/sha256";

export const CHARACTER_DOCUMENT = "character";
export const SAVED_V_DOCUMENT = "saved-v";
export const CHARACTER_SCHEMA = "xfs/character-1";
export type CharacterId = string;
/** `c-<base36>`. */
export const CHARACTER_ID = /^c-[0-9a-z]{4,32}$/;
/** A decoded save's ID: `sv-` and 32 hex digits of the SHA-256 of its content. */
export const SAVED_V_ID = /^sv-[0-9a-f]{32}$/;
const NAME_LIMIT = 80;

/** A new character ID, never reused. */
export const newCharacterId = (random: () => number = Math.random): CharacterId =>
  `c-${Date.now().toString(36)}${Math.floor(random() * 2 ** 40).toString(36).padStart(8, "0")}`;

/** Where a save is: listed in the game's save folder, or a file the person picked. */
export type SaveReference = { readonly kind: "listed"; readonly folder: string; readonly modified?: number } | { readonly kind: "file"; readonly name: string };
export type CharacterSource =
  | { readonly kind: "default" }
  | { readonly kind: "save"; readonly decoded: string; readonly save?: SaveReference }
  /** `kept`: the preset's entries this installation couldn't use, written back on export (an `xfs/cc-preset-1` value). */
  | { readonly kind: "preset"; readonly name?: string; readonly kept?: Readonly<Record<string, unknown>> };

export type CharacterDocument = {
  readonly schema: typeof CHARACTER_SCHEMA;
  readonly id: CharacterId;
  readonly name?: string;
  readonly body: BodyGender;
  readonly voice?: BodyGender;
  readonly source: CharacterSource;
  readonly choices: readonly CharacterChoice[];
  readonly clothing?: ClothingSetting;
  readonly ownMakeup?: "hidden";
};

const body = (value: unknown): BodyGender | null => value === "female" || value === "male" ? value : null;
const saveReferenceOf = (value: unknown): SaveReference | undefined => {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return undefined;
  if (v.kind === "listed" && typeof v.folder === "string" && v.folder.length <= 260)
    return { kind: "listed", folder: v.folder, ...(Number.isFinite(v.modified) ? { modified: v.modified as number } : {}) };
  if (v.kind === "file" && typeof v.name === "string" && v.name.length <= 260) return { kind: "file", name: v.name };
  return undefined;
};
const sourceOf = (value: unknown): CharacterSource | null => {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return null;
  if (v.kind === "default") return { kind: "default" };
  if (v.kind === "save" && typeof v.decoded === "string" && SAVED_V_ID.test(v.decoded)) {
    const save = saveReferenceOf(v.save);
    return { kind: "save", decoded: v.decoded, ...(save ? { save } : {}) };
  }
  if (v.kind === "preset") {
    let kept: Record<string, unknown> | undefined;
    if (v.kept !== undefined) { try { kept = serializeCcPreset(parseCcPreset(v.kept)); } catch { kept = undefined; } }
    return { kind: "preset", ...(isPresetName(v.name) ? { name: v.name } : {}), ...(kept ? { kept } : {}) };
  }
  return null;
};

/** A stored character, validated (null when it isn't one); unknown fields are kept, choices past the limit are left out. */
export function characterDocumentOf(value: unknown): CharacterDocument | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || Array.isArray(v) || v.schema !== CHARACTER_SCHEMA) return null;
  const id = typeof v.id === "string" && CHARACTER_ID.test(v.id) ? v.id : null, shape = body(v.body), source = sourceOf(v.source);
  if (!id || !shape || !source || !Array.isArray(v.choices)) return null;
  const choices = v.choices.slice(0, CREATOR_LIMITS.choices).flatMap(item => { const choice = characterChoiceOf(item); return choice ? [choice] : []; });
  const clothing = v.clothing === undefined ? undefined : clothingSettingOf(v.clothing);
  const { name: _name, voice: _voice, clothing: _clothing, ownMakeup: _makeup, ...rest } = v;
  return { ...rest, schema: CHARACTER_SCHEMA, id, body: shape, source, choices,
    ...(typeof v.name === "string" && v.name.trim() && v.name.length <= NAME_LIMIT ? { name: v.name } : {}),
    ...(body(v.voice) ? { voice: body(v.voice)! } : {}),
    ...(clothing && clothing !== DEFAULT_CLOTHING ? { clothing } : {}), ...(v.ownMakeup === "hidden" ? { ownMakeup: "hidden" as const } : {}) } as CharacterDocument;
}

/** A plain name for a character (its own, else where it comes from). */
export function characterLabel(value: unknown): string {
  const doc = characterDocumentOf(value);
  if (doc?.name) return doc.name;
  if (!doc) return "A V";
  const shape = doc.body === "male" ? "masculine" : "feminine";
  return doc.source.kind === "save" ? `V from a save (${shape})` : doc.source.kind === "preset" ? doc.source.name ?? `V from a preset (${shape})`
    : `Default ${shape} V`;
}

/**
 * A decoded save's ID: the SHA-256 of its content. Equal saves have equal IDs, so characters made from one save share its document.
 * Synchronous, so the change that needs it is recorded in the same turn (profiles design §2.2).
 */
export function decodedSaveId(save: SavedV): string {
  return `sv-${sha256Hex(JSON.stringify(save)).slice(0, 32)}`;
}

/** The character as its context starts from it (the workspace's form, character-context-actions.ts). */
export function storedOfDocument(doc: CharacterDocument): StoredCharacter {
  const source = doc.source;
  return { origin: source.kind, ...(source.kind === "preset" && source.name ? { name: source.name } : {}),
    // The body is kept for a save too: a save whose decoded copy isn't held shows the default V of the same body.
    bodyGender: doc.body, choices: doc.choices.map(choice => ({ ...choice })),
    ...(source.kind === "preset" && source.kept ? { kept: structuredClone(source.kept) as Record<string, unknown> } : {}),
    ...(doc.clothing ? { clothing: { state: doc.clothing.state, custom: [...doc.clothing.custom] } } : {}),
    ...(doc.ownMakeup ? { ownMakeup: doc.ownMakeup } : {}) };
}

/**
 * The document for a context's state: `form` (what the context holds, `CharacterContextActions.form`), its body, the decoded save's ID
 * when it comes from a save, and the document it replaces (its name, voice, save reference and unknown fields are kept).
 */
export function documentOfForm(id: CharacterId, form: StoredCharacter, bodyGender: BodyGender, decoded: string | null, prior?: CharacterDocument): CharacterDocument {
  const priorSave = prior?.source.kind === "save" && prior.source.decoded === decoded ? prior.source.save : undefined;
  const source: CharacterSource = form.origin === "save" && decoded ? { kind: "save", decoded, ...(priorSave ? { save: priorSave } : {}) }
    : form.origin === "preset" ? { kind: "preset", ...(form.name ? { name: form.name } : {}), ...(form.kept ? { kept: form.kept } : {}) } : { kind: "default" };
  const { clothing: _c, ownMakeup: _m, ...kept } = prior ?? {} as Partial<CharacterDocument>;
  return { ...kept, schema: CHARACTER_SCHEMA, id, body: bodyGender, source, choices: form.choices.map(choice => ({ ...choice })),
    ...(form.clothing ? { clothing: form.clothing } : {}), ...(form.ownMakeup ? { ownMakeup: form.ownMakeup } : {}) };
}

/** The character subject kind (profiles design §1.1), registered by the composition (`compose/subjects.ts`). */
export const CHARACTER_SUBJECT: SubjectKindSpec = Object.freeze({ kind: "character", document: CHARACTER_DOCUMENT, scenes: Object.freeze(["character"]),
  isId: (id: string) => CHARACTER_ID.test(id), label: characterLabel });

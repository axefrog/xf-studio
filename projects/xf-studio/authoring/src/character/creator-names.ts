/**
 * The one name and size rule for creator identities, shared by every step a creator choice crosses (PIPE-79): a preset file
 * (cc-preset.ts), the character context's stored and validated choices (character-context.ts `characterChoiceOf`, `savedDescriptorsOf`),
 * the request to the host (character-detail-request.ts), both host endpoints (cc-catalogue-server.ts, character-detail-server.ts) and
 * the page's option IDs. What one step accepts, every later step accepts, so a name read from a preset never fails the V further on.
 *
 * - **A creator name** (an option, choice, group, region, morph target or activated option; a CName): at most 255 characters, no
 *   control characters and no backslash (a Windows path separator). `/`, quotes and angle brackets are legal in a CName and are kept;
 *   every reader shows them as text. Empty is the `None` choice where a choice is allowed to be empty.
 * - **A mod name** as a mod manager shows it: 1 to 255 characters, never a path (no `/`, `\` or drive letter).
 * - **A preset name**: at most 120 characters, no control characters.
 *
 * Pure and shared by the page and the host.
 */
export const CREATOR_LIMITS = Object.freeze({
  /** Characters in a creator name. */
  name: 255,
  /** Characters in a mod name. */
  modName: 255,
  /** Characters in a preset's own name. */
  presetName: 120,
  /** Options one switcher choice activates. */
  activates: 64,
  /** Creator choices one V carries (a preset may hold more entries; the rest are reported and kept for the round trip). */
  choices: 2048,
  /** A save's descriptors of every part. */
  appearances: 1024,
  morphs: 256,
  /** Entries one preset file may hold, and its UTF-8 size. */
  presetEntries: 8192,
  presetBytes: 1024 * 1024,
  /** UTF-8 bytes of one request body to either host endpoint (a V at every limit above fits). */
  requestBytes: 8 * 1024 * 1024,
});

const NOT_IN_NAME = /[\u0000-\u001f\u007f\\]/;
const NOT_IN_MOD = /[\u0000-\u001f\u007f\\/]|^[A-Za-z]:/;

/** A creator name (a CName); `allowEmpty` for a choice, where empty is `None`. */
export const isCreatorName = (value: unknown, allowEmpty = false): value is string =>
  typeof value === "string" && value.length <= CREATOR_LIMITS.name && (allowEmpty || value.length > 0) && !NOT_IN_NAME.test(value);
/** A mod's name as a mod manager shows it: never a path. */
export const isModName = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= CREATOR_LIMITS.modName && !NOT_IN_MOD.test(value);
/** A preset's own name. */
export const isPresetName = (value: unknown): value is string =>
  typeof value === "string" && value.length <= CREATOR_LIMITS.presetName && !/[\u0000-\u001f\u007f]/.test(value);

export const CREATOR_PARTS = ["head", "body", "arms"] as const;
/** An option ID as the page and the host name it: `<part>/<name>`. */
export function isOptionId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const slash = value.indexOf("/");
  return slash > 0 && (CREATOR_PARTS as readonly string[]).includes(value.slice(0, slash)) && isCreatorName(value.slice(slash + 1));
}

const encoder = new TextEncoder();
/** UTF-8 bytes of a text (what a limit in bytes counts). */
export const utf8Bytes = (text: string) => encoder.encode(text).byteLength;

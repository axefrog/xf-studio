/**
 * Redaction for the diagnostics log and the problem report (docs/diagnostics.md). Three passes, in this order:
 *
 * 1. **Known folders.** The host names the folders it was configured with (the game, MO2, a manual mod folder, the data and tools
 *    folders); each occurrence, in any slash direction, JSON escaping or case, becomes a label such as `<game>`. A folder that
 *    doesn't sit under a user profile can still carry a name (`D:\jdoe\Games`), so it never reaches a report as written.
 * 2. **Save names.** Cyberpunk 2077 save folders (`ManualSave-12`, `AutoSave-3`…) and the folder holding a `sav.dat` become `<save>`.
 * 3. **Personal data.** The repository's shared patterns (`tools/private-data.json`, read by `private-data.ts`): user-profile
 *    folder names become `<user>`, e-mail addresses `<email>`.
 *
 * DOM-free and host-free, so the host and the page apply exactly the same rules.
 */
import { personalDataIn, redactPersonalData } from "../private-data";

export type KnownRoot = { label: string; path: string | null | undefined };

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A folder's pattern in any slash direction, JSON-escaped or not, with or without a trailing slash, in any case. */
function rootPattern(path: string): RegExp | null {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  // Too short to be a meaningful folder (a bare drive or "/"): replacing it would mangle unrelated text.
  if (trimmed.replace(/^[A-Za-z]:/, "").length < 3) return null;
  const segments = trimmed.split(/[\\/]+/).map(escapeRegExp);
  return new RegExp(segments.join("(?:\\\\\\\\|\\\\|/)+"), "gi");
}

/** Every occurrence of a known folder replaced by its label, longest folders first so a nested one keeps its own label. */
export function redactKnownRoots(text: string, roots: readonly KnownRoot[]): string {
  const patterns = roots.flatMap(root => {
    const pattern = root.path ? rootPattern(root.path) : null;
    return pattern ? [{ pattern, label: root.label, length: root.path!.length }] : [];
  }).sort((a, b) => b.length - a.length);
  let out = text;
  for (const { pattern, label } of patterns) out = out.replace(pattern, label);
  return out;
}

const SAVE_NAME = /\b(?:ManualSave|AutoSave|QuickSave|EndGameSave|PointOfNoReturnSave|NewGamePlusSave)(?:-\d+)?\b/g;
const SAVE_FOLDER = /([\\/])[^\\/"'`<>|\r\n]+((?:\\\\|\\|\/)(?:sav\.dat|metadata\.\d+\.json|screenshot\.png)\b)/gi;
export function redactSaveNames(text: string): string {
  return text.replace(SAVE_NAME, "<save>").replace(SAVE_FOLDER, "$1<save>$2");
}

/** All three passes. Idempotent: redacted text passes through unchanged. */
export function redactText(text: string, roots: readonly KnownRoot[] = []): string {
  return redactPersonalData(redactSaveNames(redactKnownRoots(text, roots)));
}

/** A JSON value with every string redacted (keys are the code's own names and stay). */
export function redactValue<T>(value: T, roots: readonly KnownRoot[] = []): T {
  if (typeof value === "string") return redactText(value, roots) as T;
  if (Array.isArray(value)) return value.map(item => redactValue(item, roots)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, roots)])) as T;
  return value;
}

/** What personal data remains in a text by the shared rules (the report builder asserts this is null). */
export const remainingPersonalData = (text: string) => personalDataIn(text);

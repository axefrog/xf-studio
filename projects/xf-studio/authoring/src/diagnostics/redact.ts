/**
 * Redaction for the diagnostics log, the rolling window and the problem report (docs/diagnostics.md). Three passes, in this order:
 *
 * 1. **Known folders and names.** The host names the folders it knows (the person's own profile and OneDrive folders, and the game,
 *    MO2, manual mod, data and tools folders it was configured with); each occurrence, in any slash direction, JSON escaping or
 *    case, becomes a label such as `<game>` or `%USERPROFILE%`. A folder that doesn't sit under a user profile can still carry a
 *    name (`D:\jdoe\Games`), and a profile folder can hold spaces the shared patterns can't see the end of, so neither reaches a
 *    report as written. A known account name (`word`) is replaced wherever it stands as a whole word.
 * 2. **Save names.** Cyberpunk 2077 save folders (`ManualSave-12`, `AutoSave-3`…) and the folder holding a `sav.dat` become `<save>`.
 * 3. **Personal data.** The repository's shared patterns (`tools/private-data.json`, read by `private-data.ts`): user-profile
 *    folder names become `<user>`, e-mail addresses `<email>`.
 *
 * Structured values are redacted string by string (`redactValue`), never as serialised JSON, so a pattern can't break an escape.
 * DOM-free and host-free, so the host and the page apply exactly the same rules.
 */
import { isPlaceholderUser, personalDataIn, redactPersonalData } from "../private-data";

/** A folder (`path`) or an account name (`word`) to replace with `label`. */
export type KnownRoot = { label: string; path?: string | null; word?: string | null };
/** Text in, redacted text out; compiled once for a set of roots. */
export type Redactor = (text: string) => string;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * A folder's pattern in any slash direction, JSON-escaped or not, with or without a trailing slash, in any case. It ends where
 * the folder's name ends, so `D:\Games\Cyberpunk` doesn't eat the start of `D:\Games\Cyberpunk 2077`'s `2077`… only a whole name.
 */
function rootPattern(path: string): RegExp | null {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  // Too short to be a meaningful folder (a bare drive or "/"): replacing it would mangle unrelated text.
  if (trimmed.replace(/^[A-Za-z]:/, "").length < 3) return null;
  const segments = trimmed.split(/[\\/]+/).map(escapeRegExp);
  return new RegExp(segments.join("(?:\\\\\\\\|\\\\|/)+") + "(?![A-Za-z0-9_.-])", "gi");
}
function wordPattern(word: string): RegExp | null {
  const trimmed = word.trim();
  if (trimmed.length < 3 || isPlaceholderUser(trimmed)) return null;
  return new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(trimmed)}(?![A-Za-z0-9_])`, "gi");
}

const SAVE_NAME = /\b(?:ManualSave|AutoSave|QuickSave|EndGameSave|PointOfNoReturnSave|NewGamePlusSave)(?:-\d+)?\b/g;
const SAVE_FOLDER = /([\\/])[^\\/"'`<>|\r\n]+((?:\\\\|\\|\/)(?:sav\.dat|metadata\.\d+\.json|screenshot\.png)\b)/gi;
export function redactSaveNames(text: string): string {
  return text.replace(SAVE_NAME, "<save>").replace(SAVE_FOLDER, "$1<save>$2");
}

/** The first pass's patterns: folders longest first (so a nested one keeps its own label), then names (a name inside a folder goes with the folder). */
function rootPatterns(roots: readonly KnownRoot[]): { pattern: RegExp; label: string }[] {
  return roots.flatMap(root => {
    const pattern = root.path ? rootPattern(root.path) : root.word ? wordPattern(root.word) : null;
    return pattern ? [{ pattern, label: root.label, order: root.path ? 1e6 + root.path.length : root.word!.length }] : [];
  }).sort((a, b) => b.order - a.order);
}
const replaceAll = (text: string, patterns: readonly { pattern: RegExp; label: string }[]) =>
  patterns.reduce((out, { pattern, label }) => out.replace(pattern, () => label), text);

/** One redactor for a set of roots, compiled once: known folders and names, then save names, then the shared patterns. */
export function textRedactor(roots: readonly KnownRoot[] = []): Redactor {
  const patterns = rootPatterns(roots);
  return (text: string) => redactPersonalData(redactSaveNames(replaceAll(text, patterns)));
}

/** Every occurrence of a known folder or name replaced by its label (the first pass alone). */
export function redactKnownRoots(text: string, roots: readonly KnownRoot[]): string {
  return replaceAll(text, rootPatterns(roots));
}

/** All three passes. Idempotent: redacted text passes through unchanged. */
export function redactText(text: string, roots: readonly KnownRoot[] = []): string {
  return textRedactor(roots)(text);
}

/**
 * A JSON value with every string redacted, keys included (a map keyed by path is data, not the code's own names). Never throws:
 * a value that can't be walked (a cycle, a hostile getter) becomes a note.
 */
export function redactValue<T>(value: T, roots: readonly KnownRoot[] | Redactor = []): T {
  const redact = typeof roots === "function" ? roots : textRedactor(roots);
  const seen = new Set<object>();
  const walk = (item: unknown, depth: number): unknown => {
    if (typeof item === "string") return redact(item);
    if (!item || typeof item !== "object") return item;
    if (depth > 64 || seen.has(item)) return "(left out)";
    seen.add(item);
    try {
      if (Array.isArray(item)) return item.map(entry => walk(entry, depth + 1));
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(item)) out[redact(key)] = walk(entry, depth + 1);
      return out;
    } finally { seen.delete(item); }
  };
  try { return walk(value, 0) as T; } catch { return "(left out: couldn't be redacted)" as T; }
}

/** What personal data remains in a text by the shared rules (the report builder asserts this is null). */
export const remainingPersonalData = (text: string) => personalDataIn(text);

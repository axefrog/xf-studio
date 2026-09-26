/**
 * Redaction for the diagnostics log, the rolling window and the problem report (docs/diagnostics.md). Three passes, in this order:
 *
 * 1. **Known folders and names.** The host names the folders it knows (the person's own profile and OneDrive folders, and the game,
 *    MO2, manual mod, data and tools folders it was configured with); each occurrence, in any slash direction, JSON escaping,
 *    percent-encoding (DIAG-20) or case, becomes a label such as `<game>` or `%USERPROFILE%`. A folder that doesn't sit under a user
 *    profile can still carry a name (`D:\jdoe\Games`), and a profile folder can hold spaces the shared patterns can't see the end of,
 *    so neither reaches a report as written. A known account name (`word`) is replaced wherever it stands as a whole word, except in
 *    a structured value's keys that are plain identifiers, which are the code's own names (DIAG-21).
 * 2. **Save names.** Cyberpunk 2077 save folders (`ManualSave-12`, `AutoSave-3`…) and the folder holding a `sav.dat` become `<save>`.
 * 3. **Profile folders, whole.** Any other user-profile folder (`C:\Users\…`, `/mnt/c/Users/…`, `/Users/…`, `/home/…`, in any
 *    escaping or percent-encoding) loses its whole name up to the next separator, quote or line end, however many words it has and
 *    whatever it holds, parentheses included (DIAG-20). Redaction may take a little more than the name; it never leaves part of one.
 *    The shared patterns below are detectors, which must not flag ordinary prose, so they stop sooner.
 * 4. **Personal data.** The repository's shared patterns (`tools/private-data.json`, read by `private-data.ts`): user-profile
 *    folder names become `<user>`, e-mail addresses `<email>`.
 *
 * Structured values are redacted string by string (`redactValue`), never as serialised JSON, so a pattern can't break an escape.
 * DOM-free and host-free, so the host and the page apply exactly the same rules.
 */
import { isPlaceholderUser, personalDataIn, redactPersonalData } from "../private-data";

/** A folder (`path`) or an account name (`word`) to replace with `label`. */
export type KnownRoot = { label: string; path?: string | null; word?: string | null };
/**
 * Text in, redacted text out; compiled once for a set of roots. `forKeys`, when present, is the same without the account-name rule,
 * for a structured value's identifier keys (DIAG-21).
 */
export type Redactor = ((text: string) => string) & { readonly forKeys?: (text: string) => string };

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A path separator as text may carry it: plain, doubled or escaped in JSON or JavaScript, or percent-encoded. */
const SEPARATOR = String.raw`(?:\\u005[Cc]|\\u002[Ff]|\\x5[Cc]|\\x2[Ff]|%5[Cc]|%2[Ff]|\\|/)`;
/** One character of a known folder, also as a URL may carry it (percent-encoded, a space also as `+`) (DIAG-20). */
function charPattern(char: string): string {
  if (char === ":") return String.raw`(?::|%3[Aa]|\\u003[Aa])`;
  const encoded = encodeURIComponent(char);
  const forms = [escapeRegExp(char), ...(encoded !== char ? [escapeRegExp(encoded)] : []), ...(char === " " ? [String.raw`\+`] : [])];
  return forms.length > 1 ? `(?:${forms.join("|")})` : forms[0]!;
}
/**
 * A folder's pattern in any slash direction, JSON-escaped, percent-encoded or not, with or without a trailing slash, in any case. It
 * ends where the folder's name ends, so `D:\Games\Cyberpunk` doesn't eat the start of `D:\Games\Cyberpunk 2077`'s `2077`… only a whole
 * name.
 */
function rootPattern(path: string): RegExp | null {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  // Too short to be a meaningful folder (a bare drive or "/"): replacing it would mangle unrelated text.
  if (trimmed.replace(/^[A-Za-z]:/, "").length < 3) return null;
  const segments = trimmed.split(/[\\/]+/).map(segment => [...segment].map(charPattern).join(""));
  return new RegExp(segments.join(`${SEPARATOR}+`) + "(?![A-Za-z0-9_.-])", "gi");
}

/**
 * A profile folder's name: a placeholder (`<user>`, `%USERNAME%`, kept as it is), or anything up to a separator, a quote, a line end or
 * a character no folder name can hold.
 */
const PROFILE_NAME = String.raw`(<[^<>\s]{1,40}>|%[A-Za-z_]{1,40}%|(?:(?!${SEPARATOR})[^"'` + "`" + String.raw`<>|\r\n\t,;*?:])+)`;
/** The folders that hold user profiles, each followed by a profile's name (DIAG-20). */
const PROFILE_TAILS = [
  new RegExp(String.raw`((?:(?<=%[0-9A-Fa-f]{2})|(?<![A-Za-z0-9_]))[A-Za-z](?::|%3[Aa]|\\u003[Aa])${SEPARATOR}+users${SEPARATOR}+)` + PROFILE_NAME, "gi"),
  new RegExp(String.raw`((?:(?<=%[0-9A-Fa-f]{2})|(?<![A-Za-z0-9._-]))${SEPARATOR}+mnt${SEPARATOR}+[A-Za-z]${SEPARATOR}+users${SEPARATOR}+)` + PROFILE_NAME, "gi"),
  new RegExp(String.raw`((?:(?<=%[0-9A-Fa-f]{2})|(?<![A-Za-z0-9._:-]))(?:\\u002[Ff]|\\x2[Ff]|%2[Ff]|\\?/)+(?:Users|home)(?:\\u002[Ff]|\\x2[Ff]|%2[Ff]|\\?/)+)` + PROFILE_NAME, "g"),
];
/** Every user-profile folder's whole name becomes `<user>`, unless it is a placeholder or a shared profile. */
export function redactProfileFolders(text: string): string {
  return PROFILE_TAILS.reduce((out, pattern) => out.replace(pattern, (whole, lead: string, name: string) => {
    let plain = name;
    try { plain = decodeURIComponent(name.replace(/\+/g, " ")); } catch { /* Not percent-encoded. */ }
    return isPlaceholderUser(plain.trim()) ? whole : `${lead}<user>`;
  }), text);
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

/**
 * One redactor for a set of roots, compiled once: known folders and names, then save names, then whole profile folders, then the
 * shared patterns. Its `forKeys` leaves out the account-name rule.
 */
export function textRedactor(roots: readonly KnownRoot[] = []): Redactor {
  const patterns = rootPatterns(roots), folders = rootPatterns(roots.filter(root => root.path));
  const passes = (text: string, known: typeof patterns) => redactPersonalData(redactProfileFolders(redactSaveNames(replaceAll(text, known))));
  return Object.assign((text: string) => passes(text, patterns), { forKeys: (text: string) => passes(text, folders) });
}

/** Every occurrence of a known folder or name replaced by its label (the first pass alone). */
export function redactKnownRoots(text: string, roots: readonly KnownRoot[]): string {
  return replaceAll(text, rootPatterns(roots));
}

/** All three passes. Idempotent: redacted text passes through unchanged. */
export function redactText(text: string, roots: readonly KnownRoot[] = []): string {
  return textRedactor(roots)(text);
}

/** A key that is one of the code's own names (`game`, `modName`, `mod-files`), not data such as a path or a mod's name. */
const IDENTIFIER = /^[A-Za-z_$][\w$-]*$/;
/**
 * A JSON value with every string redacted, keys included (a map keyed by path is data, not the code's own names). An identifier key
 * isn't matched against the account name (`redact.forKeys`), so an account named like a common word leaves the value's shape alone,
 * and two keys that redact alike are both kept, the later one numbered (DIAG-21). Never throws: a value that can't be walked (a cycle,
 * a hostile getter) becomes a note.
 */
export function redactValue<T>(value: T, roots: readonly KnownRoot[] | Redactor = []): T {
  const redact: Redactor = typeof roots === "function" ? roots : textRedactor(roots);
  const redactKey = (key: string) => IDENTIFIER.test(key) ? (redact.forKeys ?? redact)(key) : redact(key);
  const seen = new Set<object>();
  const walk = (item: unknown, depth: number): unknown => {
    if (typeof item === "string") return redact(item);
    if (!item || typeof item !== "object") return item;
    if (depth > 64 || seen.has(item)) return "(left out)";
    seen.add(item);
    try {
      if (Array.isArray(item)) return item.map(entry => walk(entry, depth + 1));
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(item)) {
        let name = redactKey(key);
        if (Object.hasOwn(out, name)) { let n = 2; while (Object.hasOwn(out, `${name} (${n})`)) n++; name = `${name} (${n})`; }
        // Defined, not assigned: a key `__proto__` stays data.
        Object.defineProperty(out, name, { value: walk(entry, depth + 1), enumerable: true, writable: true, configurable: true });
      }
      return out;
    } finally { seen.delete(item); }
  };
  try { return walk(value, 0) as T; } catch { return "(left out: couldn't be redacted)" as T; }
}

/** What personal data remains in a text by the shared rules (the report builder asserts this is null). */
export const remainingPersonalData = (text: string) => personalDataIn(text);

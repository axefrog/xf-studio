/**
 * Path containment, in one place (PIPE-08): whether a path is a folder or one of its descendants. Every host check that
 * keeps a write, a removal, an extraction or a served file inside its root goes through these. Pure: no Node import
 * and no file-system read of its own, so any module may use it.
 *
 * Lexical checks (`isWithin`, `isBelow`, `overlaps`) compare absolute paths in one normal form: `.` and `..` folded
 * (never above the drive or share), mixed slashes and repeated or trailing separators normalised and, on Windows, case
 * folded, drive letters and UNC shares compared whole, and the `\\?\`, `\\.\` and `\??\` prefixes of a drive or UNC path
 * removed. A path they can't compare safely is never inside anything: a relative path (resolve it first; a Windows
 * `C:x` or `\x` depends on a current folder), a NUL, another device path, or on Windows a segment made only of dots
 * and spaces other than `.` and `..` (Windows trims those into another name).
 *
 * Real checks (`isWithinReal`, `isBelowReal`) also follow links, through the caller's `RealPaths` (the host passes
 * `existsSync` and `realpathSync.native`): the path must be inside the root as written (or inside the root's
 * canonical form, so a Windows 8.3 short root matches its long form) and its canonical path inside the root's
 * canonical path. So a junction inside the root that leads out is refused, and so is an outside path that reaches in
 * through a junction (PIPE-31).
 */

export type PathFlavour = "win32" | "posix";
const HOST: PathFlavour = typeof process !== "undefined" && process.platform === "win32" ? "win32" : "posix";

/** The two file-system reads the real checks need: whether a path exists, and its real path (links followed, 8.3 names expanded). */
export type RealPaths = { readonly exists: (path: string) => boolean; readonly realpath: (path: string) => string };

type Pieces = { readonly root: string; readonly segments: readonly string[]; readonly separator: string };

/**
 * An absolute path as its root (`C:\`, `\\server\share\` or `/`) and its folded segments, in its own case; null when
 * it isn't absolute or can't be compared safely.
 */
function pieces(path: string, flavour: PathFlavour): Pieces | null {
  if (typeof path !== "string" || !path || path.includes("\0")) return null;
  let root: string, rest: string;
  const separator = flavour === "win32" ? "\\" : "/";
  if (flavour === "posix") {
    if (!path.startsWith("/")) return null;
    root = "/"; rest = path;
  } else {
    let text = path.replaceAll("/", "\\");
    const device = /^\\\\[?.]\\|^\\\?\?\\/.exec(text);
    if (device) {
      const after = text.slice(device[0].length);
      if (/^[a-z]:(?:\\|$)/i.test(after)) text = after;
      else if (/^unc\\/i.test(after)) text = `\\\\${after.slice(4)}`;
      else return null;
    }
    const drive = /^([a-z]):(?:\\|$)/i.exec(text);
    const unc = /^\\\\([^\\]+)\\([^\\]+)(?:\\|$)/.exec(text);
    if (drive) { root = `${drive[1]}:\\`; rest = text.slice(2); }
    else if (unc && ![".", "?"].includes(unc[1]) && ![".", ".."].includes(unc[2])) { root = `\\\\${unc[1]}\\${unc[2]}\\`; rest = text.slice(unc[0].length); }
    else return null;
  }
  const segments: string[] = [];
  for (const segment of rest.split(separator)) {
    if (!segment || segment === ".") continue;
    if (segment === "..") { segments.pop(); continue; }
    if (flavour === "win32" && /^[. ]+$/.test(segment)) return null;
    segments.push(segment);
  }
  return { root, segments, separator };
}

const joined = (p: Pieces, count = p.segments.length) => p.root + p.segments.slice(0, count).join(p.separator);

/**
 * The form containment compares a path in: absolute, normalised, lower case on Windows, with a trailing separator only
 * at a drive or share root; null when it can't be compared safely.
 */
export function containmentKey(path: string, flavour: PathFlavour = HOST): string | null {
  const p = pieces(path, flavour);
  return p ? flavour === "win32" ? joined(p).toLowerCase() : joined(p) : null;
}

function relation(child: string, root: string, flavour: PathFlavour): "same" | "below" | "outside" {
  const c = containmentKey(child, flavour), r = containmentKey(root, flavour);
  if (c === null || r === null) return "outside";
  if (c === r) return "same";
  const separator = flavour === "win32" ? "\\" : "/";
  return c.startsWith(r.endsWith(separator) ? r : r + separator) ? "below" : "outside";
}

/** `child` is `root` or below it (lexically). */
export function isWithin(child: string, root: string, flavour: PathFlavour = HOST): boolean {
  return relation(child, root, flavour) !== "outside";
}

/** `child` is strictly below `root` (lexically): never the root itself. */
export function isBelow(child: string, root: string, flavour: PathFlavour = HOST): boolean {
  return relation(child, root, flavour) === "below";
}

/** Either path is the other or below it: the two can't be kept apart. */
export function overlaps(a: string, b: string, flavour: PathFlavour = HOST): boolean {
  return isWithin(a, b, flavour) || isWithin(b, a, flavour);
}

/**
 * An absolute path's canonical form: the nearest existing ancestor's real path (links followed, Windows short names
 * expanded) plus the part not created yet. Throws when the path can't be compared (see `containmentKey`).
 */
export function canonicalPath(path: string, fs: RealPaths): string {
  const p = pieces(path, HOST);
  if (!p) throw Error("That path can't be used.");
  let count = p.segments.length;
  while (count > 0 && !fs.exists(joined(p, count))) count--;
  if (!fs.exists(joined(p, count))) return joined(p);
  const real = fs.realpath(joined(p, count)), rest = p.segments.slice(count);
  if (!rest.length) return real;
  return real.endsWith(p.separator) ? real + rest.join(p.separator) : real + p.separator + rest.join(p.separator);
}

function real(child: string, root: string, fs: RealPaths, strict: boolean): boolean {
  let canonicalRoot: string, canonicalChild: string;
  try { canonicalRoot = canonicalPath(root, fs); canonicalChild = canonicalPath(child, fs); } catch { return false; }
  const lexical = isWithin(child, root) || isWithin(child, canonicalRoot);
  return lexical && (strict ? isBelow(canonicalChild, canonicalRoot) : isWithin(canonicalChild, canonicalRoot));
}

/** `child` is `root` or below it, as written and after following links. */
export function isWithinReal(child: string, root: string, fs: RealPaths): boolean { return real(child, root, fs, false); }

/** `child` is strictly below `root`, as written and after following links. */
export function isBelowReal(child: string, root: string, fs: RealPaths): boolean { return real(child, root, fs, true); }

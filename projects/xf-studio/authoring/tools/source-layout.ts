/**
 * Moves Studio source modules by a JSON map and rewrites every relative import and source path that names them
 * (docs/source-layout-plan.md). Reusable on any branch: it changes only what the map names, and leaves alone every
 * import that already resolves.
 *
 *   bun tools/source-layout.ts                      git mv each mapped file that still exists, then rewrite imports and the
 *                                                   source paths in tracked text
 *   bun tools/source-layout.ts --imports-only [p…]  rewrite only imports that no longer resolve, in the given files or folders
 *                                                   (default: every code file); no moves and no text. A branch with modules of
 *                                                   its own runs this after merging the move.
 *   bun tools/source-layout.ts --check              report what --imports-only would rewrite, and the imports of mapped modules
 *                                                   that resolve nowhere; change nothing
 *
 * Option: `--map <file>` (default docs/source-layout-plan.json; keys and values are relative to projects/xf-studio/authoring).
 * A branch that adds modules extends a copy of the map with their targets and passes it.
 *
 * An import is rewritten only when it does not resolve where it stands (a file this run moved is always read from its old
 * place). It is resolved from where its file was before the move (the map read backwards), and a mapped target becomes its new
 * path, written in the original's style (extension, index folder). Text paths (`src/<old>.ts`, optionally after a path ending
 * in `authoring/`) are rewritten in tracked Markdown, code, Python, CSS and HTML, except inside Markdown's
 * `<!-- historical-paths -->` regions, which name code as it was.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const APP = resolve(import.meta.dir, "..");
const REPO = resolve(APP, "../../..");
const posix = (path: string) => path.split(sep).join("/");
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const args = process.argv.slice(2);
const option = (name: string) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const mapFile = resolve(option("--map") ?? join(REPO, "docs/source-layout-plan.json"));
const importsOnly = args.includes("--imports-only"), checkOnly = args.includes("--check");
const operands = args.filter((arg, at) => !arg.startsWith("--") && args[at - 1] !== "--map");

const raw = JSON.parse(readFileSync(mapFile, "utf8")) as Record<string, string>;
/** Absolute old path → absolute new path, and back. */
const forward = new Map(Object.entries(raw).map(([from, to]) => [resolve(APP, from), resolve(APP, to)]));
const backward = new Map([...forward].map(([from, to]) => [to, from]));
/** The file names the map moves: an unresolved import is reported only when it names one (others are probes and data). */
const MAPPED_NAMES = new Set([...forward.keys()].map(path => path.split(sep).pop()!.replace(/\.\w+$/, "")));

const CODE = /\.(?:ts|tsx|js|mjs)$/;
const SKIP_DIRS = new Set(["node_modules", ".hutch", "build", "dist", "generated", ".git"]);
function codeFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return CODE.test(root) ? [root] : [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? SKIP_DIRS.has(entry.name) ? [] : codeFiles(join(root, entry.name))
    : CODE.test(entry.name) && !entry.name.endsWith(".d.ts") ? [join(root, entry.name)] : []);
}
/** The authoring project's code and the repository's experiment scripts (`bun run check` typechecks both). */
const defaultScope = () => [
  ...["src", "tests", "tools", "desktop", "server.ts", "browser-build.ts"].flatMap(path => codeFiles(join(APP, path))),
  ...readdirSync(join(REPO, "experiments"), { withFileTypes: true }).filter(entry => entry.isDirectory())
    .flatMap(entry => readdirSync(join(REPO, "experiments", entry.name)).filter(name => CODE.test(name))
      .map(name => join(REPO, "experiments", entry.name, name))),
];

const isFile = (path: string) => existsSync(path) && statSync(path).isFile();
/** Before the move: a mapped file at its old path, or any other file that exists and is not a mapped file's new path. */
const existedBefore = (path: string) => forward.has(path) || isFile(path) && !backward.has(path);
/** The file a specifier names from `dir`, given an existence test; undefined when it names none. */
function target(dir: string, specifier: string, exists: (path: string) => boolean): string | undefined {
  const base = resolve(dir, specifier), stem = base.replace(/\.(?:js|mjs)$/, "");
  for (const candidate of [base, `${stem}.ts`, `${stem}.tsx`, join(base, "index.ts")]) if (exists(candidate)) return candidate;
  return undefined;
}
/** A relative specifier from `dir` to `file`, in the original specifier's style (its extension, a folder for an index). */
function specifierFor(dir: string, file: string, original: string): string {
  let path = posix(relative(dir, file));
  const extension = original.match(/\.(?:ts|tsx|js|mjs)$/)?.[0];
  if (!/\.tsx?$/.test(path)) { /* JSON and other data keep their file name */ }
  else if (path.endsWith("/index.ts") && !/(?:^|\/)index(?:\.\w+)?$/.test(original)) path = path.slice(0, -"/index.ts".length);
  else path = path.replace(/\.tsx?$/, extension ?? "");
  return path.startsWith(".") ? path : `./${path}`;
}

/** Quoted or template literals that start like a relative path (`./`, `../`). */
const LITERAL = /(["'`])(\.\.?\/[^"'`$\n]*)\1/g;
/** Whether a literal stands where a module is named: after `from`, `import`, `import(`, `require(` or `new URL(`. */
const inImportPosition = (text: string, literal: string) =>
  new RegExp(String.raw`(?:\bfrom\s*|\bimport\s*\(?\s*|require\s*\(\s*|new\s+URL\s*\(\s*)` + escape(literal)).test(text);

type Result = { changed: number; unresolved: string[] };
/** Rewrites the relative specifiers of the file at `path`; `movedFrom` is its old path when this run moved it. */
function rewriteImports(path: string, movedFrom?: string): Result {
  const text = readFileSync(path, "utf8"), dir = dirname(path);
  const oldDir = dirname(movedFrom ?? backward.get(path) ?? path);
  const unresolved: string[] = [];
  let changed = 0;
  const next = text.replace(LITERAL, (whole, quote: string, specifier: string) => {
    if (!movedFrom && target(dir, specifier, isFile)) return whole;
    const was = target(oldDir, specifier, existedBefore);
    if (!was) {
      if (MAPPED_NAMES.has(specifier.split("/").pop()!.replace(/\.\w+$/, "")) && inImportPosition(text, whole)) unresolved.push(specifier);
      return whole;
    }
    const rewritten = specifierFor(dir, forward.get(was) ?? was, specifier);
    if (rewritten === specifier) return whole;
    changed++;
    return `${quote}${rewritten}${quote}`;
  });
  if (changed && !checkOnly) writeFileSync(path, next);
  return { changed, unresolved };
}

/** `src/<old path>` for every mapped file, after nothing or a path; the caller checks the path ends in the authoring folder. */
const TEXT_PATH = new RegExp(String.raw`(?<![\w.-])((?:[\w.-]+\/)*)src\/(` +
  [...forward.keys()].map(path => posix(relative(join(APP, "src"), path))).sort((a, b) => b.length - a.length).map(escape).join("|") +
  String.raw`)(?![\w.-])`, "g");
/** Rewrites mapped `src/` paths in one tracked text file; Markdown keeps its historical-paths regions. */
function rewriteText(file: string): number {
  const text = readFileSync(file, "utf8");
  if (!text.includes("src/")) return 0;
  const markdown = file.endsWith(".md");
  let historical = false, changed = 0;
  const lines = text.split("\n").map(line => {
    if (markdown) {
      const start = line.includes("<!-- historical-paths -->"), end = line.includes("<!-- /historical-paths -->");
      if (start && end) return line;
      if (start) { historical = true; return line; }
      if (historical) { if (end) historical = false; return line; }
    }
    return line.replace(TEXT_PATH, (whole, prefix: string, rest: string) => {
      const authoring = prefix === "" || prefix.endsWith("authoring/") ||
        /^(?:\.\.\/)+$/.test(prefix) && resolve(dirname(file), prefix) === APP;
      const to = authoring ? forward.get(resolve(APP, "src", rest)) : undefined;
      if (!to) return whole;
      changed++;
      return `${prefix}${posix(relative(APP, to))}`;
    });
  });
  if (changed) writeFileSync(file, lines.join("\n"));
  return changed;
}

function git(...command: string[]) {
  const run = spawnSync("git", command, { cwd: REPO, encoding: "utf8" });
  if (run.status !== 0) throw Error(`git ${command.join(" ")}: ${run.stderr}`);
  return run.stdout;
}

/** New path → old path of each file this run moved. */
const moved = new Map<string, string>();
if (!importsOnly && !checkOnly) {
  for (const [from, to] of forward) {
    if (!isFile(from)) continue;
    if (existsSync(to)) throw Error(`${posix(relative(APP, to))} already exists`);
    mkdirSync(dirname(to), { recursive: true });
    git("mv", posix(relative(REPO, from)), posix(relative(REPO, to)));
    moved.set(to, from);
  }
  console.log(`Moved ${moved.size} files.`);
}

const scope = operands.length ? operands.flatMap(path => codeFiles(resolve(path))) : defaultScope();
let files = 0, specifiers = 0;
const unresolved: string[] = [];
for (const file of scope) {
  const result = rewriteImports(file, moved.get(file));
  if (result.changed) { files++; specifiers += result.changed; }
  for (const specifier of result.unresolved) unresolved.push(`${posix(relative(REPO, file))}: ${specifier}`);
}
console.log(`${checkOnly ? "Would rewrite" : "Rewrote"} ${specifiers} imports in ${files} files.`);

if (!importsOnly && !checkOnly) {
  const tracked = git("ls-files", "-z").split("\0").filter(path => /\.(?:md|ts|tsx|js|mjs|py|css|html)$/.test(path));
  let paths = 0, textFiles = 0;
  for (const path of tracked) {
    const file = join(REPO, path);
    if (!isFile(file)) continue;
    const count = rewriteText(file);
    if (count) { paths += count; textFiles++; }
  }
  console.log(`Rewrote ${paths} source paths in ${textFiles} text files.`);
}
if (unresolved.length) {
  console.log(`Imports of mapped modules that resolve nowhere (${unresolved.length}; probes and fixtures may be intended):\n  ${unresolved.join("\n  ")}`);
  process.exitCode = 1;
}

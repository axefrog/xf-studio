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
 * Options: `--map <file>` (default docs/source-layout-plan.json; keys and values are relative to the authoring folder). A branch
 * that adds modules extends a copy of the map with their targets and passes it. `--root <folder>` names the authoring folder
 * (default: this tool's parent; tests point it at a scratch tree).
 *
 * Imports are found with TypeScript's scanner, so only a real module specifier is ever rewritten: the string after `from`,
 * `import`, `import(`, `require(` or `new URL(` in code, never a path-like string elsewhere, a comment or the text of a template.
 * An import is rewritten only when it does not resolve where it stands (a file this run moved is always read from its old
 * place). It is resolved from where its file was before the move (the map read backwards), and a mapped target becomes its new
 * path, written in the original's style (extension, index folder). Text paths (`src/<old>.ts`, optionally after a path ending
 * in `authoring/`) are rewritten in tracked Markdown, code, Python, CSS and HTML, except inside Markdown's
 * `<!-- historical-paths -->` regions, which name code as it was.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
// TypeScript 7's scanner (an unstable API of the pinned typescript package): the lexer the compiler itself uses.
import { SyntaxKind } from "typescript/unstable/ast";
import { createScanner, tokenIsIdentifierOrKeyword } from "typescript/unstable/ast/scanner";

/** A module specifier in source text: the string literal's span (quotes included) and its value. */
export type SpecifierSpan = { start: number; end: number; value: string };

/** Tokens after which a `/` divides (as do names, keywords used as names included); after anything else it starts a regular expression. */
const VALUE_END = new Set([SyntaxKind.NumericLiteral, SyntaxKind.BigIntLiteral, SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral, SyntaxKind.TemplateTail, SyntaxKind.RegularExpressionLiteral, SyntaxKind.CloseParenToken,
  SyntaxKind.CloseBracketToken, SyntaxKind.CloseBraceToken, SyntaxKind.PlusPlusToken, SyntaxKind.MinusMinusToken, SyntaxKind.ThisKeyword,
  SyntaxKind.SuperKeyword, SyntaxKind.TrueKeyword, SyntaxKind.FalseKeyword, SyntaxKind.NullKeyword]);
/** Keywords after which a `/` starts a regular expression. */
const BEFORE_EXPRESSION = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await",
  "instanceof", "extends"]);
const endsValue = (token: { kind: SyntaxKind; text: string } | undefined) => !!token &&
  (VALUE_END.has(token.kind) || tokenIsIdentifierOrKeyword(token.kind) && !BEFORE_EXPRESSION.has(token.text));

/**
 * Every module specifier in a source, in order: the string after `from` (imports and re-exports), after a bare `import`, and the
 * first argument of `import(…)` (dynamic and inline type imports), `require(…)`, `import.meta.require(…)` and `new URL(…)`. The
 * scanner skips comments and reads strings, templates (with their substitutions) and regular expressions as tokens, so text that
 * only looks like an import is never one.
 */
export function moduleSpecifiers(text: string): SpecifierSpan[] {
  const scanner = createScanner(true, undefined, text);
  const out: SpecifierSpan[] = [];
  /** The last significant tokens, newest last: kind and text. */
  const recent: { kind: SyntaxKind; text: string }[] = [];
  const back = (n: number) => recent[recent.length - n];
  /** The brace depth each open template substitution started at. */
  const templates: number[] = [];
  let depth = 0;
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    if ((kind === SyntaxKind.SlashToken || kind === SyntaxKind.SlashEqualsToken) && !endsValue(back(1)))
      kind = scanner.reScanSlashToken();
    if (kind === SyntaxKind.OpenBraceToken) depth++;
    else if (kind === SyntaxKind.CloseBraceToken) {
      if (templates.length && templates[templates.length - 1] === depth) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === SyntaxKind.TemplateTail) templates.pop();
      } else depth--;
    } else if (kind === SyntaxKind.TemplateHead) templates.push(depth);
    if (kind === SyntaxKind.StringLiteral || kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
      const one = back(1), two = back(2), three = back(3);
      const notMember = (n: number) => back(n)?.kind !== SyntaxKind.DotToken;
      const call = one?.kind === SyntaxKind.OpenParenToken;
      const named = one?.kind === SyntaxKind.FromKeyword ||
        one?.kind === SyntaxKind.ImportKeyword && notMember(2) ||
        call && two?.kind === SyntaxKind.ImportKeyword && notMember(3) ||
        call && two?.text === "require" && tokenIsIdentifierOrKeyword(two.kind) && (notMember(3) || back(4)?.text === "meta") ||
        call && two?.text === "URL" && three?.kind === SyntaxKind.NewKeyword;
      if (named) out.push({ start: scanner.getTokenStart(), end: scanner.getTokenEnd(), value: scanner.getTokenValue() });
    }
    recent.push({ kind, text: scanner.getTokenText() });
    if (recent.length > 4) recent.shift();
  }
  return out;
}

/**
 * The source with each relative module specifier replaced where `rewrite` returns a new one (undefined keeps it). Only specifiers
 * change; the quote style is kept.
 */
export function rewriteSpecifiers(text: string, rewrite: (specifier: string) => string | undefined): { text: string; changed: number } {
  let next = text, changed = 0;
  for (const span of moduleSpecifiers(text).reverse()) {
    if (!/^\.\.?\//.test(span.value)) continue;
    const replacement = rewrite(span.value);
    if (replacement === undefined || replacement === span.value) continue;
    const quote = text[span.start];
    next = `${next.slice(0, span.start)}${quote}${replacement}${quote}${next.slice(span.end)}`;
    changed++;
  }
  return { text: next, changed };
}

const posix = (path: string) => path.split(sep).join("/");
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CODE = /\.(?:ts|tsx|js|mjs)$/;
const SKIP_DIRS = new Set(["node_modules", ".hutch", "build", "dist", "generated", ".git"]);
const isFile = (path: string) => existsSync(path) && statSync(path).isFile();
function codeFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return CODE.test(root) ? [root] : [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? SKIP_DIRS.has(entry.name) ? [] : codeFiles(join(root, entry.name))
    : CODE.test(entry.name) && !entry.name.endsWith(".d.ts") ? [join(root, entry.name)] : []);
}
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
/** A file name as a module names it: a code module without its extension, a data file with it. */
const moduleName = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.(?:ts|tsx|js|mjs)$/, "");

function main(args: readonly string[]) {
  const option = (name: string) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
  const APP = resolve(option("--root") ?? resolve(import.meta.dir, ".."));
  const REPO = resolve(APP, "../../..");
  const mapFile = resolve(option("--map") ?? join(REPO, "docs/source-layout-plan.json"));
  const importsOnly = args.includes("--imports-only"), checkOnly = args.includes("--check");
  const operands = args.filter((arg, at) => !arg.startsWith("--") && args[at - 1] !== "--map" && args[at - 1] !== "--root");

  const raw = JSON.parse(readFileSync(mapFile, "utf8")) as Record<string, string>;
  /** Absolute old path → absolute new path, and back. */
  const forward = new Map(Object.entries(raw).map(([from, to]) => [resolve(APP, from), resolve(APP, to)]));
  const backward = new Map([...forward].map(([from, to]) => [to, from]));
  /** The file names the map moves: an unresolved import is reported only when it names one (others are probes and data). */
  const mappedNames = new Set([...forward.keys()].map(moduleName));
  /** Before the move: a mapped file at its old path, or any other file that exists and is not a mapped file's new path. */
  const existedBefore = (path: string) => forward.has(path) || isFile(path) && !backward.has(path);
  /** The authoring project's code and the repository's experiment scripts (`bun run check` typechecks both). */
  const defaultScope = () => [
    ...["src", "tests", "tools", "desktop", "server.ts", "browser-build.ts"].flatMap(path => codeFiles(join(APP, path))),
    ...(existsSync(join(REPO, "experiments")) ? readdirSync(join(REPO, "experiments"), { withFileTypes: true }) : [])
      .filter(entry => entry.isDirectory()).flatMap(entry => readdirSync(join(REPO, "experiments", entry.name))
        .filter(name => CODE.test(name)).map(name => join(REPO, "experiments", entry.name, name))),
  ];

  /** Rewrites the relative specifiers of the file at `path`; `movedFrom` is its old path when this run moved it. */
  function rewriteImports(path: string, movedFrom?: string) {
    const dir = dirname(path), oldDir = dirname(movedFrom ?? backward.get(path) ?? path);
    const unresolved: string[] = [];
    const result = rewriteSpecifiers(readFileSync(path, "utf8"), specifier => {
      if (!movedFrom && target(dir, specifier, isFile)) return undefined;
      const was = target(oldDir, specifier, existedBefore);
      if (!was) {
        if (mappedNames.has(moduleName(specifier))) unresolved.push(specifier);
        return undefined;
      }
      return specifierFor(dir, forward.get(was) ?? was, specifier);
    });
    if (result.changed && !checkOnly) writeFileSync(path, result.text);
    return { changed: result.changed, unresolved };
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
}

if (import.meta.main) main(process.argv.slice(2));

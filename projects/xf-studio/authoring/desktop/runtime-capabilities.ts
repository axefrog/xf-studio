import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";

// Which of Cottontail's optional standard-library capabilities the desktop host reaches.
//
// Electrobun 2.0.2's Cottontail runtime keeps optional standard-library APIs outside its core and packages only the
// capabilities a build asks for: Hutch scans the tree-shaken main-process bundle for `bun:*`, `node:*` and `Cottontail.*`
// text, and `build.cottontail.capabilities` adds what that scan cannot see. The app runs on a Bun main process today
// (`build.mainProcess: "bun"`, which ships the whole Bun runtime), so the list changes nothing in the build yet. It is kept
// complete so that switching the main process to Cottontail cannot ship a runtime that is missing a module this host
// needs. The scan alone would miss three kinds of use here: the Bun workers and the Build tool are separate bundles loaded
// later; `import.meta.require("bun:ffi")` is not an import statement; and `Bun.YAML` or `Bun.CryptoHasher` are global
// APIs, which the scanner does not treat as markers. `tests/runtime-capabilities.test.ts` keeps the declaration equal to
// what this walk finds.

const desktopRoot = import.meta.dir;
const authoringRoot = resolve(desktopRoot, "..");
const strataRoot = resolve(authoringRoot, "..", "..", "strata");

/** Every program the packaged host runs on its runtime: the main process, its two Bun workers and the Build tool. */
export const HOST_ENTRIES = [
  resolve(desktopRoot, "main.ts"),
  resolve(desktopRoot, "check-worker.ts"),
  resolve(authoringRoot, "src", "native", "native-decode-worker.ts"),
  resolve(authoringRoot, "tools", "build_collection_package.ts"),
] as const;

/** The names Cottontail 0.7.1's own manifest (`bin/cottontail-stdlib/capabilities.json`) defines. */
export const COTTONTAIL_CAPABILITIES = ["archive", "bake", "build", "colors", "compression", "cookies", "csrf", "data", "ffi",
  "filesystem-router", "glob", "hashing", "html-rewriter", "inspector", "jsc-tools", "json5", "markdown", "password", "redis",
  "repl", "s3", "sea", "secrets", "shell", "sql", "sqlite", "terminal", "test", "text", "toml", "uuid", "websocket", "yaml"] as const;
export type CottontailCapability = typeof COTTONTAIL_CAPABILITIES[number];

/** Module specifiers that select a capability (Electrobun's docs name `bun:sqlite`, `node:sqlite` and `node:zlib`). */
const MODULE_CAPABILITIES: Record<string, CottontailCapability> = {
  "bun:sqlite": "sqlite", "node:sqlite": "sqlite", "bun:sql": "sql", "bun:ffi": "ffi", "node:ffi": "ffi",
  "node:zlib": "compression", "zlib": "compression", "bun:jsc": "jsc-tools", "bun:test": "test",
  "node:inspector": "inspector", "node:inspector/promises": "inspector", "node:repl": "repl", "repl": "repl",
};

/** Global APIs that live in a capability module; the bundle scan does not treat these as markers. */
const GLOBAL_CAPABILITIES: ReadonlyArray<[RegExp, CottontailCapability]> = [
  [/\bBun\.YAML\b/, "yaml"], [/\bBun\.TOML\b/, "toml"], [/\bBun\.JSON5\b/, "json5"],
  [/\bBun\.(CryptoHasher|hash)\b/, "hashing"], [/\bBun\.password\b/, "password"], [/\bBun\.Glob\b/, "glob"],
  [/\bBun\.\$/, "shell"], [/\bBun\.(gzipSync|gunzipSync|deflateSync|inflateSync|zstd\w+)\b/, "compression"],
  [/\bBun\.(SQL|sql)\b/, "sql"], [/\bBun\.(s3|S3Client)\b/, "s3"], [/\bBun\.(redis|RedisClient)\b/, "redis"],
  [/\bHTMLRewriter\b/, "html-rewriter"], [/\bBun\.markdown\b/, "markdown"], [/\bBun\.randomUUIDv7\b/, "uuid"],
  [/\bBun\.Terminal\b/, "terminal"], [/\bBun\.secrets\b/, "secrets"], [/\bBun\.Archive\b/, "archive"],
  [/\bBun\.build\b/, "build"], [/\bBun\.color\b/, "colors"], [/\bBun\.(CookieMap|Cookie)\b/, "cookies"], [/\bBun\.CSRF\b/, "csrf"],
];

export type CapabilityUse = { capability: CottontailCapability; marker: string; file: string };

const code = /\.(m?[jt]sx?)$/;
const moduleLiteral = /["']((?:bun|node):[a-z0-9_/]+)["']/g;

function resolveImport(specifier: string, from: string): string | null {
  if (specifier === "strata" || specifier.startsWith("strata/"))
    return resolve(strataRoot, specifier === "strata" ? "index.ts" : `${specifier.slice("strata/".length)}.ts`);
  // The Electrobun SDK comes from the Hutch devkit and uses the runtime through its own imports, which the bundle scan sees.
  if (specifier.startsWith("electrobun")) return null;
  return Bun.resolveSync(specifier, dirname(from));
}

/** Walk the host's module graph from its entries and report every capability it reaches, with where. */
export function hostCapabilityUses(entries: readonly string[] = HOST_ENTRIES): { files: number; uses: CapabilityUse[] } {
  const seen = new Set<string>();
  const uses: CapabilityUse[] = [];
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!code.test(file)) continue;
    const text = readFileSync(file, "utf8");
    const loader = file.endsWith("x") ? "tsx" : /\.m?js$/.test(file) ? "js" : "ts";
    const specifiers = new Set(new Bun.Transpiler({ loader }).scanImports(text).map(item => item.path));
    for (const match of text.matchAll(moduleLiteral)) specifiers.add(match[1]!);
    for (const specifier of specifiers) {
      const capability = MODULE_CAPABILITIES[specifier];
      if (capability) { uses.push({ capability, marker: specifier, file }); continue; }
      if (/^(bun|node):/.test(specifier) || builtinModules.includes(specifier)) continue;
      const target = resolveImport(specifier, file);
      if (target) queue.push(target);
    }
    for (const [pattern, capability] of GLOBAL_CAPABILITIES) {
      const match = text.match(pattern);
      if (match) uses.push({ capability, marker: match[0], file });
    }
  }
  return { files: seen.size, uses };
}

/** The capabilities the host reaches, sorted. */
export function hostCapabilities(entries: readonly string[] = HOST_ENTRIES): CottontailCapability[] {
  return [...new Set(hostCapabilityUses(entries).uses.map(use => use.capability))].sort();
}

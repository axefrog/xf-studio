/**
 * The engine's boundary (design §1.2, boundary rule 1): every import resolves inside this package, no host or DOM
 * global is read (standard ECMAScript only: no clock, randomness, timers, network, storage or console), and the example
 * reaches the engine only through its two entry points. Each rule is shown to fail on an injected violation.
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : name.endsWith(".ts") ? [path] : [];
});
const ENGINE = [join(ROOT, "index.ts"), join(ROOT, "testing.ts"), ...walk(join(ROOT, "src"))];

/** Code with comments and the contents of string and template literals blanked (a template's `${}` kept). */
export function codeOnly(text: string): string {
  let out = "", i = 0;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (c === "/" && n === "/") { const end = text.indexOf("\n", i); i = end < 0 ? text.length : end; continue; }
    if (c === "/" && n === "*") { const end = text.indexOf("*/", i + 2); i = end < 0 ? text.length : end + 2; out += " "; continue; }
    if (c === "\"" || c === "'" || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) { if (text[j] === "\\") j++; else if (c === "`" && text[j] === "$" && text[j + 1] === "{") { let depth = 1; j += 2; const start = j; while (j < text.length && depth) { if (text[j] === "{") depth++; else if (text[j] === "}") depth--; j++; } out += ` ${text.slice(start, j - 1)} `; continue; } j++; }
      out += `${c}${c}`; i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

const IMPORT = /\b(?:import|export)\s[^;]*?\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s+["']([^"']+)["']/g;
const importsOf = (text: string) => [...text.matchAll(IMPORT)].map(match => match[1] ?? match[2] ?? match[3]);

/**
 * Reads of the host: the clock, randomness, timers, frames, network, storage, the console and host objects. The first
 * guard is the typecheck: tsconfig.json compiles the engine with the ES2022 library and no host types, so a host global
 * doesn't exist for it. This scan covers what that library does declare (`Date`, `Math.random`) and names a host would
 * add, and it stays meaningful if the configuration drifts. (Common local names such as `process` are left to the
 * typecheck.)
 */
const HOST_GLOBALS = /\b(?:Date|performance|setTimeout|setInterval|setImmediate|clearTimeout|clearInterval|requestAnimationFrame|queueMicrotask|crypto|fetch|localStorage|sessionStorage|indexedDB|window|document|navigator|globalThis|Bun|Deno|console|structuredClone|XMLHttpRequest|WebSocket|Worker|AbortController|AbortSignal|TextEncoder|TextDecoder|__dirname)\b|\bMath\.random\b/;

function violations(files: Readonly<Record<string, string>>): string[] {
  const out: string[] = [];
  for (const [file, text] of Object.entries(files)) {
    for (const specifier of importsOf(text)) {
      const inside = specifier.startsWith(".") && !relative(ROOT, resolve(dirname(file), specifier)).startsWith("..");
      if (!inside) out.push(`${relative(ROOT, file)} imports ${specifier}`);
    }
    const code = codeOnly(text).split("\n");
    code.forEach((line, index) => {
      const found = line.match(HOST_GLOBALS);
      // A property named like a global (`x.process`, `{ process }`) is not a read of the global.
      if (found && !new RegExp(`[.]\\s*${found[0]}\\b|\\b${found[0]}\\s*:`).test(line)) out.push(`${relative(ROOT, file)}:${index + 1} reads ${found[0]}`);
    });
  }
  return out;
}

const DISK = Object.fromEntries(ENGINE.map(file => [file, readFileSync(file, "utf8")]));

test("the engine imports nothing outside its folder and reads no host global", () => {
  expect(ENGINE.length).toBeGreaterThan(15);
  expect(violations(DISK)).toEqual([]);
});

test("the engine compiles against standard ECMAScript alone (no host or DOM types)", () => {
  const config = JSON.parse(readFileSync(join(ROOT, "tsconfig.json"), "utf8")) as { compilerOptions: { lib: string[]; types: string[] }; include: string[] };
  expect(config.compilerOptions.lib).toEqual(["ES2022"]);
  expect(config.compilerOptions.types).toEqual([]);
  expect(config.include).toEqual(["index.ts", "testing.ts", "src"]);
});

test("the boundary rule fails on injected violations", () => {
  const file = join(ROOT, "src", "graph.ts");
  const probes = [
    `import { x } from "../../xf-studio/authoring/src/x";`, `import { Database } from "bun:sqlite";`, `import * as fs from "node:fs";`,
    `const t = Date.now();`, `const r = Math.random();`, `setTimeout(() => 0, 1);`, `const g = globalThis;`, `console.log(1);`,
    `const c = new AbortController();`, `const id = crypto.randomUUID();`, `void fetch("x");`,
  ];
  for (const probe of probes) expect(violations({ [file]: `${DISK[file]}\n${probe}` }).length, probe).toBeGreaterThan(0);
  // Prose and properties are not reads.
  expect(violations({ [file]: `// Date.now() in a comment\nconst s = "fetch(x)";\nconst o = { process: 1 }; o.process;` })).toEqual([]);
});

test("the example and the tests reach the engine only through strata and strata/testing", () => {
  const outside = [...walk(join(ROOT, "examples")), ...walk(join(ROOT, "tests"))];
  const deep = outside.flatMap(file => importsOf(readFileSync(file, "utf8")).filter(specifier => /(^|\/)src\//.test(specifier) && file.includes("examples"))
    .map(specifier => `${relative(ROOT, file)} imports ${specifier}`));
  expect(deep).toEqual([]);
  for (const file of walk(join(ROOT, "examples"))) for (const specifier of importsOf(readFileSync(file, "utf8")))
    expect(["strata", "strata/testing"], `${relative(ROOT, file)} imports ${specifier}`).toContain(specifier);
});

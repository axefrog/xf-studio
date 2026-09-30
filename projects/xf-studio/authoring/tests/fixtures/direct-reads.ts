/**
 * The direct-read scan behind the ratchet in `graph-direct-reads.test.ts` (profiles and graph design §5.1): which src
 * modules read the wall clock, timers, randomness, the file system, processes and workers, the network (fetched or
 * served), the host environment (its variables, `node:os`), browser storage or the game bridge directly, by kind, and
 * how many times.
 */
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceFiles, sourceText } from "./source-files";
import { codeOnly, withoutComments } from "./code-scan";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

/** A global a page or host reaches through `window.`, `globalThis.` or `self.` as well as by its bare name. */
const GLOBAL = String.raw`(?:(?<![.\w$])|(?<=\b(?:window|globalThis|self)\.))`;

/** Where a module specifier stands (`from "x"`, `import "x"`, `import("x")`, `require("x")`): short names such as "os" or "http" count only there. */
const SPECIFIER = String.raw`(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)`;

/**
 * What counts as a direct read, by kind. `code` patterns match code with comments and literals blanked; `imports`
 * patterns match the text with only comments blanked (a module specifier is a string).
 */
export const DIRECT_READS: Readonly<Record<string, { readonly code?: RegExp; readonly imports?: RegExp }>> = {
  clock: { code: new RegExp(String.raw`\bDate\.now\s*\(|\bnew\s+Date\b(?!\s*\(\s*[^\s)])|\bperformance\.now\s*\(|\bprocess\.hrtime\b|\bBun\.nanoseconds\s*\(`, "g") },
  timers: { code: new RegExp(String.raw`${GLOBAL}(?:setTimeout|setInterval|setImmediate|requestAnimationFrame|requestIdleCallback)\s*\(|\bBun\.sleep(?:Sync)?\s*\(`, "g") },
  random: { code: /\bMath\.random\s*\(|\brandomUUID\s*(?:\?\.\s*)?\(|\bgetRandomValues\s*\(|\brandom(?:Bytes|Int)\s*\(/g },
  network: { code: new RegExp(String.raw`${GLOBAL}fetch\s*\(|\bnew\s+(?:WebSocket|EventSource|XMLHttpRequest)\b|\bBun\.(?:connect|listen|serve)\s*\(`, "g"),
    imports: new RegExp(String.raw`${SPECIFIER}["'](?:node:)?(?:http|https|http2|net|dgram)["']`, "g") },
  storage: { code: /\b(?:localStorage|sessionStorage|indexedDB)\b/g },
  files: { imports: /["'](?:node:)?fs(?:\/promises)?["']|["']bun:sqlite["']/g, code: /\bBun\.(?:file|write)\s*\(/g },
  processes: { imports: new RegExp(String.raw`["'](?:node:)?child_process["']|${SPECIFIER}["'](?:node:)?worker_threads["']`, "g"), code: /\bBun\.spawn(?:Sync)?\s*\(|\bnew\s+(?:Shared)?Worker\s*\(/g },
  environment: { imports: new RegExp(String.raw`${SPECIFIER}["'](?:node:)?os["']`, "g"), code: /\bprocess\.env\b|\bBun\.env\b/g },
  bridge: { code: /\bRuntimeBridgeClient\b/g, imports: /["'][^"']*xf-runtime-bridge[^"']*["']/g },
};

/** Adapter modules: they implement a source, and may read directly. */
export const ADAPTERS: ReadonlySet<string> = new Set(["platform/graph-adapters/host-sources", "platform/graph-adapters/sqlite-store", "platform/graph-adapters/backups",
  "platform/graph-adapters/library-durability"]);

/** The direct reads in a module's text, counted by kind (kinds it doesn't read are absent). */
export function readsIn(text: string): Record<string, number> {
  const imports = withoutComments(text);
  // Code, plus the expressions inside template literals (`codeOnly` blanks those, and a read can hide there).
  const code = `${codeOnly(text)}\n${[...imports.matchAll(/\$\{([^{}`]*)\}/g)].map(match => match[1]).join("\n")}`;
  const out: Record<string, number> = {};
  for (const [kind, patterns] of Object.entries(DIRECT_READS)) {
    const count = (patterns.code ? code.match(patterns.code)?.length ?? 0 : 0) + (patterns.imports ? imports.match(patterns.imports)?.length ?? 0 : 0);
    if (count) out[kind] = count;
  }
  return out;
}

/** The kinds of direct read in a module's text. */
export function kindsIn(text: string): string[] { return Object.keys(readsIn(text)); }

/** Every src module (adapters excepted) with its direct reads, counted by kind. */
export function directReads(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const file of sourceFiles(SRC, /\.ts$/)) {
    if (file.endsWith(".d.ts")) continue;
    const name = relative(SRC, file).replace(/\\/g, "/").replace(/\.ts$/, "");
    if (ADAPTERS.has(name)) continue;
    const reads = readsIn(sourceText(file));
    if (Object.keys(reads).length) out[name] = reads;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a < b ? -1 : 1));
}

if (import.meta.main) {
  for (const [name, reads] of Object.entries(directReads())) console.log(`  "${name}": ${JSON.stringify(reads).replace(/,/g, ", ").replace(/:/g, ": ")},`);
}

/**
 * The direct-read scan behind the ratchet in `graph-direct-reads.test.ts` (profiles and graph design §5.1): which src
 * modules read the wall clock, timers, randomness, the file system, the network, browser storage or the game bridge
 * directly, by kind.
 */
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceFiles, sourceText } from "./source-files";
import { codeOnly } from "./code-scan";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

/** What counts as a direct read, by kind. */
export const DIRECT_READS: Readonly<Record<string, RegExp>> = {
  clock: /\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)|\bperformance\.now\s*\(/,
  timers: /(?<![.\w])(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/,
  random: /\bMath\.random\s*\(|\bcrypto\.randomUUID\s*\(|\bgetRandomValues\s*\(/,
  network: /(?<![.\w])fetch\s*\(/,
  storage: /\b(?:localStorage|sessionStorage)\b/,
  files: /["']node:fs(?:\/promises)?["']/,
  bridge: /\bxf-runtime-bridge\b|\bRuntimeBridgeClient\b/,
};

/** Adapter modules: they implement a source, and may read directly. */
export const ADAPTERS: ReadonlySet<string> = new Set(["platform/graph-adapters/host-sources", "platform/graph-adapters/sqlite-store", "platform/graph-adapters/backups"]);

/** The kinds of direct read in a module's text (`node:fs` is a string, so the text is scanned for it). */
export function kindsIn(text: string): string[] {
  const code = codeOnly(text);
  return Object.entries(DIRECT_READS).filter(([kind, pattern]) => pattern.test(kind === "files" ? text : code)).map(([kind]) => kind);
}

/** Every src module (adapters excepted) with the kinds it reads directly. */
export function directReads(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const file of sourceFiles(SRC, /\.ts$/)) {
    if (file.endsWith(".d.ts")) continue;
    const name = relative(SRC, file).replace(/\\/g, "/").replace(/\.ts$/, "");
    if (ADAPTERS.has(name)) continue;
    const kinds = kindsIn(sourceText(file));
    if (kinds.length) out[name] = kinds;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a < b ? -1 : 1));
}

if (import.meta.main) {
  for (const [name, kinds] of Object.entries(directReads())) console.log(`  "${name}": ${JSON.stringify(kinds)},`);
}

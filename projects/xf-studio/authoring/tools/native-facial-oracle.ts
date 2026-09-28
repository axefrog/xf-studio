/**
 * Oracle for the native facial setup and face rig reading (src/native/facial-setup.ts; knowledge/archive-format.md §13): decodes each given
 * `.facialsetup` and `.rig` with XF Studio's own reader and compares the document leaf for leaf with WolvenKit's JSON of the same file (the
 * local intakes, or the facial host's cache). Read-only.
 *
 *   bun tools/native-facial-oracle.ts --game <game folder> <resource> <wolvenkit json> [<resource> <wolvenkit json> …] [--report <file>]
 *
 * Without --game the Studio's configured game folder is used (for the game's Oodle library). Exit code 1 on any difference.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { compareDocuments, isNameOnly } from "../src/native/document-diff";
import { loadGameOodle } from "../src/native/oodle";
import { readResource } from "../src/native/resource-document";
import { configuredGameRoot } from "./configured-game-root";

export type FacialOracleRow = { resource: string; root: string; ms: number; mismatches: number; nameOnly: number; sample: string[] };

export function compareFacialResource(resource: string, reference: string, decompress: Parameters<typeof readResource>[1]): FacialOracleRow {
  const bytes = new Uint8Array(readFileSync(resource));
  const started = performance.now();
  const native = readResource(bytes, decompress, { buffers: "trim" });
  const ms = performance.now() - started;
  const wolvenkit = JSON.parse(readFileSync(reference, "utf8")) as { Data: { RootChunk: Record<string, unknown> } };
  const root = String(wolvenkit.Data.RootChunk.$type);
  const all = compareDocuments(native.document.Data.RootChunk, wolvenkit.Data.RootChunk, "RootChunk");
  const real = all.filter(m => !isNameOnly(m));
  return { resource, root, ms: Math.round(ms * 10) / 10, mismatches: real.length, nameOnly: all.length - real.length,
    sample: real.slice(0, 12).map(m => `${m.path} (${m.kind}): ${m.mine} vs ${m.reference}`) };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => { const at = args.indexOf(name); if (at < 0) return null; const value = args[at + 1]; args.splice(at, 2); return value ?? null; };
  const game = flag("--game") ?? configuredGameRoot(), report = flag("--report");
  if (!args.length || args.length % 2) { console.error("Give pairs of <resource> <wolvenkit json>."); process.exit(2); }
  const oodle = loadGameOodle(game);
  const rows: FacialOracleRow[] = [];
  for (let i = 0; i < args.length; i += 2) {
    const row = compareFacialResource(args[i]!, args[i + 1]!, oodle.decompress);
    rows.push(row);
    console.log(`${row.root} ${row.resource.split(/[\\/]/).at(-1)}: ${row.mismatches} differences (${row.nameOnly} name-only), decoded in ${row.ms} ms`);
    for (const line of row.sample) console.log(`  ${line}`);
  }
  if (report) writeFileSync(report, JSON.stringify({ tool: "native-facial-oracle", rows }, null, 2) + "\n");
  process.exit(rows.some(row => row.mismatches) ? 1 : 0);
}

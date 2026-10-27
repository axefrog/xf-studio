import { readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { importW1, stableJson } from '../../src/world/import-w1.ts';

/** File ownership lives here; the importer itself is pure. The report is a
 * sibling of the output index unless an explicit report path is supplied. */
export function runImportCli(args: string[]): void {
  const started = performance.now();
  if (args.length !== 3 && !(args.length === 5 && args[3] === '--report'))
    throw Error('Usage: bun tools/world/import-w1.ts <world-pack> <content.json> <out index.json> [--report <report.json>]');
  const read = (path: string) => {
    if (statSync(resolve(path)).size > 32 * 1024 * 1024) throw Error('Input exceeds 32 MiB');
    const bytes = readFileSync(resolve(path));
    if (bytes.length > 32 * 1024 * 1024) throw Error('Input exceeds 32 MiB');
    return JSON.parse(bytes.toString('utf8'));
  };
  const { index, report } = importW1(read(args[0]), read(args[1]));
  const out = resolve(args[2]), reportPath = args[4] ? resolve(args[4]) : join(dirname(out), 'kabuki.import.json');
  const pathKey = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
  if (new Set([out, reportPath, resolve(args[0]), resolve(args[1])].map(pathKey)).size !== 4) throw Error('Inputs, index and report must have distinct paths');
  mkdirSync(dirname(out), { recursive: true }); mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(out, stableJson(index)); writeFileSync(reportPath, stableJson(report));
  console.log(JSON.stringify({ index: index.hash, cells: report.cells.length, ...report.population, ...report.counts, elapsedMs: performance.now() - started }));
}
if (import.meta.main) runImportCli(process.argv.slice(2));

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BOUNDS, validateManifest, validateRecord, type Item } from '../../src/holotable/schema.ts';

/** Independent readable-text audit, including keys and actor/relation captions.
 * Does not reuse the renderer's display-text filter.
 */
export function internalText(value: string): boolean {
  return /se:|\b(?:core|meta|xf)[.:]|\?[a-z]|[{}\[\]]|not recorded|not opened|\bcoarse\b|\bgate[ -]?\d|\b[a-z]\d+-|[a-f\d]{16}|\d{10}|\.\d|\d(?:\.\d*)?e[+-]?\d/i.test(value);
}
export async function checkSpool(directory: string) {
  const consumer = await import(resolve(import.meta.dir, '../../../../xf-holotable/src/layers.ts'));
  const errors: string[] = [];
  let manifests = 0, records = 0, items = 0;
  const files = readdirSync(directory).filter(f => f.endsWith('.jsonl'));
  for (const file of files) {
    const bytes = readFileSync(join(directory, file)), ids = new Set<string>();
    if (bytes.length > BOUNDS.bytes) errors.push(`${file} exceeds 16 MiB`);
    let oversized = false;
    for (let start = 0, line = 1; start < bytes.length; line++) {
      const newline = bytes.indexOf(10, start), end = newline < 0 ? bytes.length : newline + 1;
      if (end - start > BOUNDS.line) { errors.push(`${file}:${line} line exceeds 1 MiB`); oversized = true; }
      start = end;
    }
    if (oversized) continue; // Refuse raw bytes before whitespace removal or JSON parsing.
    const lines = bytes.toString('utf8').trimEnd().split('\n');
    const manifest = JSON.parse(lines[0]!); manifests++;
    try { validateManifest(manifest); } catch (e) { errors.push(`${file}:1 producer: ${e}`); }
    const refusal = consumer.validateManifest(manifest); if (refusal) errors.push(`${file}:1 consumer: ${refusal}`);
    for (let i = 1; i < lines.length; i++) {
      const record = JSON.parse(lines[i]!); records++;
      const location = `${file}:${i + 1}`;
      try { validateRecord(record, manifest); } catch (e) { errors.push(`${location} producer: ${e}`); }
      const refusal = consumer.validateRecord(record, manifest); if (refusal) errors.push(`${location} consumer: ${refusal}`);
      if (record.t < manifest.standalone.from || record.t > manifest.standalone.to || record.until !== undefined && record.until > manifest.standalone.to) errors.push(`${location} outside standalone span`);
      if (!('id' in record)) continue;
      items++;
      ids.add(record.id);
      const item = record as Item;
      const fields = [item.label, item.detail, ...Object.keys(item.facets ?? {}), ...Object.values(item.facets ?? {}), item.value?.name, item.value?.role, item.value?.type,
        ...Object.keys(record.value?.facets ?? {}), ...Object.values(record.value?.facets ?? {})];
      for (const value of fields) if (typeof value === 'string' && internalText(value)) errors.push(`${location} internals: ${value}`);
    }
    if (ids.size > BOUNDS.items) errors.push(`${file} exceeds 5,000 distinct item ids`);
  }
  if (!files.length) errors.push('No spools found');
  return { manifests, records, items, refusals: errors.length, errors };
}
if (import.meta.main) {
  if (!process.argv[2]) throw Error('bun tools/holotable/check-spool.ts <spool-directory>');
  const result = await checkSpool(resolve(process.argv[2])); console.log(JSON.stringify(result, null, 2));
  if (result.refusals) process.exitCode = 1;
}

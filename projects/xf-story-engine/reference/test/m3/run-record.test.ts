import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readRunRecord } from '../../src/m3/run-record.ts';

const runs = new URL('../../../m3/run3/runs/', import.meta.url);
test('all 16 archived run records use deterministic minified gzip and logical JSON paths', () => {
  const files = readdirSync(runs).filter(f => /^(E|A1)-.*\.json\.gz$/.test(f));
  expect(files).toHaveLength(16);
  for (const file of files) {
    const path = new URL(file, runs), bytes = readFileSync(path);
    const record = readRunRecord<Record<string, unknown>>(path);
    expect(readRunRecord<Record<string, unknown>>(new URL(file.slice(0, -3), runs))).toEqual(record);
    expect(readRunRecord<Record<string, unknown>>(fileURLToPath(path))).toEqual(record);
    expect(gunzipSync(bytes).toString()).toBe(JSON.stringify(record));
    expect(gzipSync(JSON.stringify(record))).toEqual(bytes);
    expect(bytes.readUInt32LE(4)).toBe(0);
    expect(bytes[3]! & 8).toBe(0);
  }
});
test('plain run-2 records remain readable', () => {
  const prior = new URL('../../../m3/run2/runs/', import.meta.url);
  const file = readdirSync(prior).find(f => /^(E|A1)-.*\.json$/.test(f))!;
  const path = new URL(file, prior);
  expect(readRunRecord<Record<string, unknown>>(path)).toEqual(JSON.parse(readFileSync(path, 'utf8')));
});

import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RunPublisher, type ItemRevision } from '../../tools/holotable/publish-run.ts';
import { validateRecord, type Item } from '../../src/holotable/schema.ts';

const scratch = resolve(import.meta.dir, '../../../../../.scratch-shadow');
mkdirSync(scratch, { recursive: true });
const folders: string[] = [];
const publisher = () => {
  const dir = mkdtempSync(join(scratch, 'writer-')); folders.push(dir);
  return new RunPublisher(dir, { set: 'retrospective', title: 'Retrospective', from: 100, to: 500 });
};
afterAll(() => { for (const dir of folders) rmSync(dir, { recursive: true, force: true }); });
const item = (id: string, t: number, name = id): Item => ({ schema: 'xfh/item-1', id, t, kind: 'actor', anchor: { at: [1, 2, 3] }, cite: `se:node:${id}`, value: { name } });
const rows = (p: RunPublisher) => readFileSync(join(p.directory, 'people.jsonl'), 'utf8').trim().split('\n').slice(1).map(line => JSON.parse(line));

test('backdated tombstones retain newer values, deduplicate by time, and can follow equal-time republication', () => {
  const p = publisher(), receipts: ItemRevision[] = [], record = (r: ItemRevision) => receipts.push(r);
  const b = item('b', 180);
  p.publish({ t: 180, layers: new Map([['people', [item('a', 180, 'old'), b]]]) }, record);
  p.publish({ t: 250, layers: new Map([['people', [item('a', 250, 'new'), b]]]) }, record);
  expect(receipts.map(r => [r.id, r.t])).toEqual([['a', 180], ['b', 180], ['a', 250]]);
  const retract = (times: number[]) => p.publish({ t: 251, layers: new Map([['people', [b]]]), retractions: new Map([['people', times.map(t => ({ retract: 'a', t }))]]) }, record);
  retract([249.9]);
  expect(p.counts().people.live).toBe(2);
  retract([250]);
  expect(p.counts().people.live).toBe(1);
  expect(p.counts().people.revisions).toBe(3);
  expect(receipts).toHaveLength(3);
  expect(rows(p).filter(r => r.retract)).toEqual([{ retract: 'a', t: 249.9 }, { retract: 'a', t: 250 }]);
  const bytes = p.counts().people.bytes; retract([249.9, 250]);
  expect(p.counts().people.bytes).toBe(bytes);
  p.publish({ t: 251, layers: new Map([['people', [item('a', 250, 'new'), b]]]), retractions: new Map([['people', [{ retract: 'a', t: 250 }]]]) }, record);
  expect(rows(p).slice(-2)).toEqual([item('a', 250, 'new'), { retract: 'a', t: 250 }].map(r => 'id' in r ? { ...r, glyph: 'person' } : r));
  expect(receipts.at(-1)).toEqual({ layer: 'people', id: 'a', t: 250, branch: undefined });
});

test('one publication emits the start and each overwritten revision tombstone without replaying items', () => {
  const p = publisher();
  for (const t of [180, 250, 330]) p.publish({ t, layers: new Map([['people', [item('a', t, String(t))]]]) });
  p.publish({ t: 331, layers: new Map(), retractions: new Map([['people', [179.9, 180, 250, 330, 250].map(t => ({ retract: 'a', t }))]]) });
  expect(rows(p).filter(r => r.retract).map(r => r.t)).toEqual([179.9, 180, 250, 330]);
  expect(rows(p).filter(r => r.id)).toHaveLength(3);
  expect(p.counts().people.live).toBe(0);
  const manifest = JSON.parse(readFileSync(join(p.directory, 'people.jsonl'), 'utf8').split('\n')[0]);
  for (const row of rows(p)) expect(() => validateRecord(row, manifest)).not.toThrow();
});

test('schema and span refusals leave files, timed deduplication and revision receipts unchanged', () => {
  const p = publisher(), receipts: ItemRevision[] = [];
  p.publish({ t: 250, layers: new Map([['people', [item('a', 250)]]]) });
  const before = readFileSync(join(p.directory, 'people.jsonl'));
  for (const t of [99, 252, NaN]) expect(() => p.publish({ t: 251, layers: new Map(), retractions: new Map([['people', [{ retract: 'a', t: 249.9 }, { retract: 'a', t }]]]) }, r => receipts.push(r))).toThrow();
  expect(readFileSync(join(p.directory, 'people.jsonl')).equals(before)).toBe(true);
  expect(receipts).toEqual([]);
  p.publish({ t: 251, layers: new Map(), retractions: new Map([['people', [{ retract: 'a', t: 249.9 }]]]) });
  expect(rows(p).at(-1)).toEqual({ retract: 'a', t: 249.9 });
  expect(p.counts().people.live).toBe(1);
});

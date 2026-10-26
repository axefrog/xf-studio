import { expect, test } from 'bun:test';
import { boundText } from '../../src/holotable/facets.ts';
import { BOUNDS, type Item } from '../../src/holotable/schema.ts';
import { spoolLine, RunPublisher } from '../../tools/holotable/publish-run.ts';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const item = (): Item => ({ schema: 'xfh/item-1', id: 'one', kind: 'point', t: 0, anchor: { region: 'place' }, cite: 'se:event:one' });

test('a long diagnostic list reports omitted entries and preserves its full value', () => {
  const value = item(), rows = Array.from({ length: 100 }, (_, i) => `belief-${i}`);
  value.facets = { thinking: JSON.stringify(rows) };
  expect(boundText(value)).toBe(1);
  expect(value.facets.thinking.length).toBeLessThanOrEqual(500);
  expect(value.facets.thinking).toMatch(/… \(\+\d+ more\)$/);
  const head = JSON.parse(value.facets.thinking.split('…')[0]);
  const omitted = Number(/\+(\d+) more/.exec(value.facets.thinking)![1]);
  expect(head.length + omitted).toBe(rows.length);
  expect(JSON.parse(value.detail!).thinking).toBe(JSON.stringify(rows));
});

test('overflow detail retains the item and names its full-record citation', () => {
  const value = item(); value.facets = { goal: JSON.stringify(Array.from({ length: 200 }, () => 'x'.repeat(40))) };
  expect(boundText(value)).toBe(2);
  expect(value.detail!.length).toBe(4000);
  expect(value.detail!.endsWith('… (truncated; full record at se:event:one)')).toBe(true);
  expect(value.facets.goal).toMatch(/… \(\+\d+ more\)$/);
});

test('a large list keeps a bounded prefix and its exact omitted count', () => {
  const value = item(); value.facets = { thinking: JSON.stringify(Array.from({ length: 20000 }, (_, i) => `claim-${i}`)) };
  expect(boundText(value)).toBe(2);
  const text = value.facets.thinking, head = JSON.parse(text.split('…')[0]);
  expect(head.length + Number(/\+(\d+) more/.exec(text)![1])).toBe(20000);
  expect(text.length).toBeLessThanOrEqual(500);
});

test('labels and scalar captions stay bounded without hiding their truncation', () => {
  const value = item(); value.label = 'a'.repeat(200); value.facets = { state: 'b'.repeat(600) };
  expect(boundText(value)).toBe(2);
  expect(value.label.length).toBeLessThanOrEqual(160);
  expect(value.facets.state.length).toBeLessThanOrEqual(500);
  expect(JSON.parse(value.detail!).label).toBe('a'.repeat(200));
});

test('one JSON line cannot exceed 1 MiB', () => {
  expect(() => spoolLine('x'.repeat(BOUNDS.line))).toThrow('1 MiB');
});

test('run summary counts published truncations once per revision and per layer', () => {
  const dir = resolve(import.meta.dir, `../../../../../.scratch-holo/bounds-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  try {
    const publisher = new RunPublisher(dir, { set: 'bounds', title: 'Bounds', from: 0, to: 10 });
    const value = item(); value.facets = { state: 'x'.repeat(5000) };
    const observation = { t: 0, layers: new Map([['events', [value]]]) };
    publisher.publish(observation); publisher.publish(observation);
    expect(publisher.counts().events.truncations).toBe(2);
    expect(publisher.counts().people.truncations).toBe(0);
    expect(value.facets.state.length).toBe(5000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

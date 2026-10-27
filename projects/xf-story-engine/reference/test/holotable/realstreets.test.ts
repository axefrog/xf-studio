import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pack from '../world/fixtures/world-pack.json';
import content from '../world/fixtures/content.json';
import { importW1 } from '../../src/world/import-w1.ts';
import type { W1Content, W1Pack } from '../../src/world/types.ts';
import { createWeek3, type Week3Config } from '../../src/m3/week3.ts';
import { canonicalRun, publishImportedM3Week } from '../../tools/holotable/publish-m3-week.ts';
import { readRunRecord } from '../../src/m3/run-record.ts';
import { checkSpool } from '../../tools/holotable/check-spool.ts';

test('imported run-3 span has identical observer-on/off records and a readable real-geometry spool', async () => {
  const root = resolve(import.meta.dir, '../../../../../.scratch-realstreets/test-' + randomUUID());
  mkdirSync(root, { recursive: true });
  try {
    const { index } = importW1(pack as W1Pack, content as unknown as W1Content);
    const config: Week3Config = { id: 'E-import-restless-engage', world: 'm3c-w2', arm: 'E', tempo: 'restless', policy: 'engage', windows: 3 };
    const run = createWeek3(config, index);
    expect(run.walkCells).toEqual(Object.values(index.districts).filter(d => d.simulated).flatMap(d => d.cellIds).filter(id => index.cells[id]!.kind === 'grid'));
    expect(run.walkCells.every(id => !!index.cells[id])).toBe(true);
    const { record, summary } = publishImportedM3Week(join(root, 'week'), index, { config });
    expect(canonicalRun(record)).toBe(canonicalRun(readRunRecord(join(root, 'week.bare.run.json.gz'))));
    expect(summary.identity.source).toBe('observer-off');
    expect(summary.identity.archivedDigest).toBe(summary.identity.regeneratedDigest);
    expect(summary.to - summary.from).toBe(1800);
    expect(summary.observations).toBe(4);
    expect((await checkSpool(summary.output)).refusals).toBe(0);
    for (const file of readdirSync(summary.output)) {
      const manifest = JSON.parse(readFileSync(join(summary.output, file), 'utf8').split('\n')[0]!);
      expect(manifest.standalone).toEqual({ set: config.id.toLowerCase(), title: 'Kabuki week (real streets)', from: summary.from, to: summary.to, clock: 'game' });
      expect(manifest.description).toBeUndefined();
    }
    const places = readFileSync(join(summary.output, 'places.jsonl'), 'utf8').trim().split('\n').slice(1).map(line => JSON.parse(line));
    expect(places.some(item => item.anchor?.zone)).toBe(true);
    expect(places.some(item => item.label === "Judy's Apartment")).toBe(true);
    expect(places.some(item => item.facets?.about === 'Blocks are a 200 m grid over the real district; street-level blocks come later.')).toBe(true);
    const liveItems = (layer: string) => {
      const current = new Map<string, any>();
      for (const line of readFileSync(join(summary.output, layer + '.jsonl'), 'utf8').trim().split('\n').slice(1)) {
        const item = JSON.parse(line);
        if (item.retract) current.delete(item.retract); else current.set(item.id, item);
      }
      return [...current.values()];
    };
    expect(summary.storyStats.developed).toBe(liveItems('stories').filter(item => item.kind === 'point').length);
    expect(summary.storyStats.possible).toBe(liveItems('possible-stories').reduce((n, item) => n + Number(item.label.split(' ')[0]), 0));
    expect(Object.values(summary.storyStats.byPattern).reduce((n, row) => n + row.developed + row.possible, 0)).toBe(summary.storyStats.developed + summary.storyStats.possible);
    expect(() => publishImportedM3Week(summary.output, index, { config })).toThrow('fresh');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 20000);


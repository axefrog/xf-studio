import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkSpool } from '../../tools/holotable/check-spool.ts';
import { BOUNDS } from '../../src/holotable/schema.ts';

test('raw line bounds include the manifest, trailing whitespace, multibyte bytes and the LF before parsing', async () => {
  const root = resolve(import.meta.dir, '../../../../../.scratch-realweek/test-' + randomUUID());
  mkdirSync(root, { recursive: true });
  try {
    const header = JSON.stringify({ schema: 'xfh/layer-1', producer: 'story-engine', layer: 'events', title: 'Events', content: 'full', clock: 'game', kinds: ['point'], standalone: { set: 'test', from: 0, to: 10, clock: 'game' } });
    for (const [body, line] of [
      [header + ' '.repeat(BOUNDS.line - Buffer.byteLength(header)) + '\n', 1],
      [header + '\n{}' + ' '.repeat(BOUNDS.line), 2],
      ['é'.repeat(BOUNDS.line / 2) + '\n', 1], // invalid JSON must be refused before parsing
    ] as const) {
      writeFileSync(join(root, 'events.jsonl'), body);
      const audit = await checkSpool(root);
      expect(audit.errors).toContain(`events.jsonl:${line} line exceeds 1 MiB`);
    }
    writeFileSync(join(root, 'events.jsonl'), header + ' '.repeat(BOUNDS.line - Buffer.byteLength(header) - 1) + '\n');
    expect((await checkSpool(root)).refusals).toBe(0); // exactly 1 MiB, including LF
  } finally { rmSync(root, { recursive: true, force: true }); }
});

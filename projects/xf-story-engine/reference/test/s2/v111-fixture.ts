import { expect } from 'bun:test';
import { H, s } from '../../src/id.ts';
import type { Pack } from '../../src/seeding/types.ts';
import { MINI_ID, miniPack } from './mini.ts';
import { makeWorld, setFact, settle, type World } from './world.ts';
import { delivery, playUntil } from './drive.ts';
export function scene(name: string, configure?: (w: World, pack: Pack) => void) {
  const w = makeWorld(name), cause = H(s('v111'));
  const asker = w.k.root('asker', 'fx:character'), recipient = w.k.root('recipient', 'core:person');
  for (const npc of [asker, recipient]) {
    w.k.addEdge({ type: 'core:located-in', from: npc, to: w.city, cause });
    w.k.pin({ node: npc, slot: 'age', value: 35, reason: 'authored', cause });
  }
  w.k.pin({ node: asker, slot: 'where', value: w.city, reason: 'observed', cause });
  setFact(w, 'x', 0, 0); setFact(w, 'flag', 0, 0);
  const pack = miniPack();
  pack.seeds[0].roles.npc.identity = asker;
  pack.seeds[0].roles.recipient = { kind: 'core:person', identity: recipient };
  pack.fragments[0].offer!.asker = 'npc'; pack.fragments[0].offer!.plan = ['recipient'];
  pack.fragments[0].offer!.actions.push({ id: 'refuse', stance: 'refuse', foresight: 'pack:t-skip', writes: [{ fact: 'stage', set: 4 }] });
  configure?.(w, pack);
  expect(w.l2.installPack(pack)).toEqual([]);
  const sow = w.l2.sow(pack.id, MINI_ID); expect(sow.ok, JSON.stringify(sow.findings)).toBe(true);
  const inst = w.l2.instance(sow.instance!)!;
  setFact(w, 'flag', 1, 10); settle(w);
  expect(playUntil(w, () => !!delivery(inst, 'meet'), 200)).toBe(true);
  return { w, inst, d: delivery(inst, 'meet')!, asker, recipient };
}

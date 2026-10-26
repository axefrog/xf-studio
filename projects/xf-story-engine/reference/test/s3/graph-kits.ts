import { expect } from 'bun:test';
import { pack, kit, type World } from './helpers.ts';
import { miniPack } from '../s2/mini.ts';
import { perceive, emit } from './graph-fixture.ts';
export function telling(w: World) {
  const p = pack([kit({ id: 'xf.graph:telling', roles: { evidence: { kind: 'core:event' }, source: { kind: 'core:event' } },
    sowable: { serves: ['rumour', 'recap'], firstClass: 0, tells: 'evidence', explains: 'source' } })]);
  p.id = 'xf.graph'; p.fragments[0].roles = ['evidence', 'source'];
  expect(w.l2.installPack(p)).toEqual([]);
  return p;
}
export function offering(w: World, fn = 'help') {
  const p = miniPack({ id: 'xf.offer' }); const t = p.seeds[0]; t.id = 'xf.offer:kit';
  t.windows = [{ id: 'w', opens: 'yes', onClose: 'withdraw' }];
  t.roles.other = { kind: 'core:person' }; t.roles.cause = { kind: 'core:event', optional: true };
  t.sowable = { serves: ['offer'], firstClass: 2, fills: [{ fn, args: { by: 'npc', to: 'other' }, cause: 'cause' }] };
  p.fragments[0].offer!.asker = 'npc';
  expect(w.l2.installPack(p)).toEqual([]);
  return p;
}
export function live(w: World) {
  perceive(w); const ev = emit(w, 'wrong', 1, { witnesses: [w.v] }); w.l3.refresh();
  expect(w.l3.state.pool[0].graph!.state).toBe('live'); return ev;
}
export function nudging(w: World) {
  const p = pack([kit({ id: 'xf.nudge:kit', nudge: true, end: 'no',
    roles: { npc: { kind: 'core:person', goal: { effects: [{ on: 'other', effect: 'give' }] } }, other: { kind: 'core:person' }, cause: { kind: 'core:event', optional: true } },
    sowable: { serves: ['nudge'], firstClass: 0, fills: [{ fn: 'help', args: { by: 'npc', to: 'other' }, cause: 'cause' }] } })]);
  p.id = 'xf.nudge'; p.fragments[0].roles = ['npc', 'other']; p.fragments[0].channels = [];
  expect(w.l2.installPack(p)).toEqual([]);
  return p;
}


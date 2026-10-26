import { expect, test } from 'bun:test';
import { H, s, mintedId } from '../../src/id.ts';
import { eventFacts } from '../../src/seeding/eval.ts';
import { applyEffects } from '../../src/seeding/effects.ts';
import { MINI_ID, miniPack } from './mini.ts';
import { makeWorld, setFact, settle } from './world.ts';
import { delivery, playUntil } from './drive.ts';
import { scene } from './v111-fixture.ts';

test('SF-73/74/82: cited warnings are observed once; receipts, earliest times and response causes survive reload', () => {
  let warning = '';
  const { w, inst, d } = scene('SF73', (w, pack) => {
    const dim = w.k.schema.dims.get('core:event-kind')!;
    if (dim.value.t === 'enum') dim.value.values.push('warning');
    warning = w.k.events.mintEvent({ creator: H(s('stub-s1')), cause: H(s('warning')), name: 'warning', time: 0, kind: 'warning', place: w.japantown });
    pack.seeds[0].roles.notice = { kind: 'core:event', identity: warning, scope: { nodes: [warning] } };
    pack.fragments[0].roles.push('notice');
  });
  expect(w.k.observedAt(warning, w.k.now)).toBeUndefined();
  w.l2.display({ delivery: d.id, channel: d.provenance.channel, grade: 'presented', atPlay: w.l2.playBase + w.l2.arbiter.play });
  const at = w.k.now, exposure = w.l2.exposure(warning);
  expect(exposure).toEqual({ grade: 'presented', at, play: w.l2.playTotal() });
  expect(w.k.observedAt(warning, at)).toBe(at);
  expect(w.l2.exposedNodeAt(warning)).toBe(at);
  const observed = w.k.store.pinsOn(warning, 'kind').filter((p) => p.reason === 'observed');
  expect(observed).toHaveLength(1); expect(observed[0].cause).toBe(d.id);
  w.k.persistence.save('shown'); w.k.persistence.load('shown', w.gamePort);
  expect(w.l2.exposure(warning)).toEqual(exposure);
  const next = w.l2.instance(inst.id)!.st.deliveries.find((x) => x.id === d.id)!;
  // An unconfirmed offer is queued again on load; release then confirm it.
  playUntil(w, () => next.state === 'released', 200);
  w.l2.display({ delivery: d.id, channel: next.provenance.channel, grade: 'confirmed', atPlay: w.l2.playBase + w.l2.arbiter.play });
  expect(w.k.store.pinsOn(warning, 'kind').filter((p) => p.reason === 'observed')).toHaveLength(1);
  expect(w.l2.respond(d.id, { kind: 'action', id: 'go' })).toBe(true);
  const response = w.l2.instance(inst.id)!.st.record.find((r) => r.kind === 'response')!.data.event as string;
  expect(w.k.events.mintedSpec(response)?.causes).toEqual(expect.arrayContaining([warning, next.offerEvent!]));
});

test('SF-74: observed, acted and never-shown events have distinct exposure', () => {
  const w = makeWorld('SF74-direct'), creator = H(s('exposure'));
  const make = (name: string, extra = {}) => w.k.events.mintEvent({ creator, cause: creator, name, time: 0, kind: 'generic', ...extra });
  const seen = make('seen', { witnesses: [w.v] }), acted = make('acted', { participants: [{ who: w.v, role: 'actor' }] }), unseen = make('unseen');
  for (const event of [seen, acted, unseen]) w.k.events.makeCanon(event, 'committed', creator);
  expect(w.l2.exposure(seen)).toEqual({ grade: 'presented', at: 0 });
  expect(w.l2.exposure(acted)).toEqual({ grade: 'confirmed', at: 0 });
  expect(w.l2.exposure(unseen)).toBeUndefined();
  w.k.persistence.save('exposure'); w.k.persistence.load('exposure', w.gamePort);
  expect(w.l2.exposure(seen)).toEqual({ grade: 'presented', at: 0 });
  expect(w.l2.exposure(acted)).toEqual({ grade: 'confirmed', at: 0 });
  expect(w.l2.exposure(unseen)).toBeUndefined();
});

test('SF-66/67: only help/bargain acceptance leaves a committed promise, preserved by reload', () => {
  for (const answer of [{ kind: 'action', id: 'go' }, { kind: 'decline', id: 'no' }, { kind: 'action', id: 'refuse' }] as const) {
    const { w, inst, d, asker, recipient } = scene(`SF66-${answer.id}`);
    expect(w.l2.respond(d.id, answer)).toBe(true);
    const response = inst.st.record.find((r) => r.kind === 'response')!.data.event as string;
    expect(w.l2.responseOf(response)).toEqual({ seed: inst.id, beat: 'meet', kind: `${answer.kind}:${answer.id}`,
      ...(answer.kind === 'action' ? { stance: answer.id === 'go' ? 'help' : 'refuse' } : {}) });
    const promises = w.k.events.canonEvents().filter((e) => w.k.events.mintedSpec(e)?.kind === 'promise');
    expect(promises).toHaveLength(answer.id === 'go' ? 1 : 0);
    if (promises[0]) {
      const id = mintedId(inst.id, response, 'promise/meet/0');
      expect(promises).toEqual([id]);
      const spec = w.k.events.mintedSpec(id)!;
      expect(spec.causes).toEqual([response]); expect(spec.outcome).toBeUndefined(); expect(spec.effects).toEqual([]);
      expect(spec.participants).toEqual([{ who: w.v, role: 'promiser' }, { who: asker, role: 'promisee' }, { who: recipient, role: 'subject' }]);
      expect(spec.place).toBe(w.city);
      w.k.persistence.save('promise'); w.k.persistence.load('promise', w.gamePort);
      expect(w.k.events.mintedSpec(id)).toEqual(spec);
      expect(w.l2.responseOf(response)?.stance).toBe('help');
    }
  }
});
test('SF-79: declaration paths separate beat and fragment events, preserving outcome and causes', () => {
  const { w, inst, asker } = scene('SF79-paths');
  w.k.eventKinds.register({ name: 'collector-visit', producers: ['s2'], roles: ['collector'] });
  const event = { kind: 'collector-visit', participants: [{ who: 'npc', role: 'collector' }], outcome: 'failed' as const };
  const first = applyEffects(w.l2, inst, [{ event }], { origin: 'beat', tag: 'first', path: 'beat/b/leaves' });
  const second = applyEffects(w.l2, inst, [{ event }], { origin: 'fragment', tag: 'second', path: 'beat/b/fragment' });
  expect(first[0]).not.toBe(second[0]);
  expect(first[0]).toBe(mintedId(inst.id, inst.id, 'event:beat/b/leaves/0'));
  expect(second[0]).toBe(mintedId(inst.id, inst.id, 'event:beat/b/fragment/0'));
  expect(eventFacts(w.l2, first[0])?.participants).toEqual([{ who: asker, role: 'collector' }]);
  expect(w.k.events.mintedSpec(first[0])?.outcome).toBe('failed');
  w.k.persistence.save('paths'); w.k.persistence.load('paths', w.gamePort);
  expect(applyEffects(w.l2, w.l2.instance(inst.id)!, [{ event }], { origin: 'beat', tag: 'first', path: 'beat/b/leaves' })).toEqual(first);
});

test('SF-81: a director-sown seed cannot carry word of V acts, while authored content can', () => {
  const { w, inst } = scene('SF81');
  const dim = w.k.schema.dims.get('core:event-kind')!;
  if (dim.value.t === 'enum') dim.value.values.push('tell');
  const roles = w.k.schema.dims.get('core:participant-role')!;
  if (roles.value.t === 'enum') roles.value.values.push('teller', 'listener', 'told');
  const acted = w.k.events.mintEvent({ creator: H(s('port')), cause: H(s('act')), name: 'act', time: 0, kind: 'generic', participants: [{ who: w.v, role: 'actor' }] });
  inst.st.roles.subject = { ...inst.st.roles.npc, cast: acted };
  const writes = [{ event: { kind: 'tell', participants: [{ who: 'npc', role: 'teller' }, { who: 'recipient', role: 'listener' }, { who: 'subject', role: 'told' }] } }];
  inst.st.source.by = 'director';
  expect(applyEffects(w.l2, inst, writes, { origin: 'beat', tag: 'news', path: 'beat/news/leaves' })).toEqual([]);
  expect(inst.st.record.some((r) => r.kind === 'write-refused' && r.data.rule === 'no-director-word-of-v')).toBe(true);
  inst.st.source.by = 'pack';
  expect(applyEffects(w.l2, inst, writes, { origin: 'beat', tag: 'news', path: 'beat/news/leaves' })).toHaveLength(1);
});

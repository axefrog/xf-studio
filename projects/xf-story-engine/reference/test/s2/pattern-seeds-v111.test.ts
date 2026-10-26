import { expect, test } from 'bun:test';
import { H, s } from '../../src/id.ts';
import { applyEffects } from '../../src/seeding/effects.ts';
import { scene } from './v111-fixture.ts';
import { MINI_ID, miniPack } from './mini.ts';
import { makeWorld, settle } from './world.ts';
import { library, vocabulary } from '../s3/library.ts';
import { implicitPattern } from '../../src/seeding/seed-patterns.ts';
import { resolvePreds } from '../../src/seeding/doc.ts';
import { PackIndex } from '../../src/seeding/packs.ts';
import { lintV111 } from '../../src/seeding/lint-v111.ts';

test('SF-71: exact option lines freeze at release, stay unvoiced where new, and only the chosen line is said', () => {
  const { w, inst, d } = scene('SF71', (w, pack) => {
    const o = pack.fragments[0].offer!;
    o.actions[0].say = { recorded: 'game:line1' };
    o.actions[1].say = { splice: [{ line: 'game:line2', from: 0, to: 1 }, { line: 'game:line3', from: 2, to: 3 }] };
    o.actions[2].say = { text: 'pack:t-new' };
    o.nullPath.label = 'leave';
    pack.texts.push({ id: 't-new', text: 'I am staying here.', speaker: 'v' });
    w.l2.reg.gameLine = (ref, cut) => cut ? `${ref}:${cut.from}-${cut.to}` : 'The recorded transcript.';
  });
  expect(d.options?.find((o) => o.key === 'action:go')?.words).toBe('The recorded transcript.');
  expect(d.options?.find((o) => o.key === 'action:skip')?.words).toBe('game:line2:0-1 game:line3:2-3');
  expect(d.options?.find((o) => o.key === 'action:refuse')).toEqual(expect.objectContaining({ words: 'I am staying here.', voiced: false }));
  expect(d.options?.find((o) => o.key === 'null')).toEqual({ key: 'null', label: 'leave', voiced: false });
  expect(d.chosenLine).toBeUndefined();
  w.l2.display({ delivery: d.id, channel: d.provenance.channel, grade: 'confirmed', atPlay: w.l2.playBase + w.l2.arbiter.play });
  const options = structuredClone(d.options);
  w.k.persistence.save('words'); w.k.persistence.load('words', w.gamePort);
  w.l2.reg.gameLine = () => { throw new Error('a loaded delivery must not resolve its lines again'); };
  const loaded = w.l2.instance(inst.id)!, next = loaded.st.deliveries.find((x) => x.id === d.id)!;
  expect(next.options).toEqual(options);
  expect(w.l2.respond(next.id, { kind: 'action', id: 'refuse' })).toBe(true);
  expect(next.chosenLine).toEqual({ words: 'I am staying here.', voiced: false, line: { text: 'pack:t-new' } });
});
test('SF-71 twins: new-line voice, emotional labels, unprompted V lines and voice marking a stance', () => {
  const w = makeWorld('SF71-lint'), p = miniPack(), o = p.fragments[0].offer!;
  o.actions[0].say = { recorded: 'game:line' }; o.actions[1].say = { text: 'pack:t-new' };
  p.texts.push({ id: 't-new', text: 'No.', speaker: 'v' });
  const check = () => lintV111(resolvePreds(p.seeds[0]), w.l2.lintContext(new PackIndex(p)));
  expect(check().some((f) => f.code === 'L-143' && f.level === 'warning')).toBe(true);
  p.texts.at(-1)!.voice = { asset: 'new-v-voice' };
  expect(check().some((f) => f.code === 'L-115')).toBe(true); delete p.texts.at(-1)!.voice;
  o.actions[1].label = 'angry'; expect(check().some((f) => f.code === 'L-129')).toBe(true);
  delete o.actions[1].label; p.texts[0].speaker = 'v';
  expect(check().some((f) => f.code === 'L-142')).toBe(true);
});
test('SF-75/76: implicit ask and end realisation are deterministic and survive a load', () => {
  const { w, inst, d, asker } = scene('SF76', (w, p) => {
    for (const pattern of library) w.l2.reg.patterns.set(pattern.id, pattern);
    w.l2.reg.vocabulary = vocabulary;
    p.seeds[0].realises = [{ pattern: 'xf.composite:debt', juncture: 'paid', by: 'end', binds: { '?d': 'v', '?c': 'npc' } }];
    p.seeds[0].end = 'seedFact(stage) == 1';
  });
  expect(w.l2.beatFunction(inst.id, 'meet')).toEqual({ fn: 'ask', args: { by: asker, of: w.v } });
  expect(w.l2.respond(d.id, { kind: 'action', id: 'go' })).toBe(true); settle(w);
  expect(inst.st.closed).toBeDefined();
  const outcome = inst.st.closed!.event, expected = [{ fn: 'repay', args: { debtor: w.v, creditor: asker } }];
  expect(w.l2.realisedBy(outcome)).toEqual(expected);
  w.k.persistence.save('end'); w.k.persistence.load('end', w.gamePort);
  expect(w.l2.realisedBy(outcome)).toEqual(expected);
});
test('SF-65: realises requires the right world event, every variable and a non-shape juncture', () => {
  const w = makeWorld('SF65'), p = miniPack(), seed = p.seeds[0];
  for (const pattern of library) w.l2.reg.patterns.set(pattern.id, pattern);
  w.l2.reg.vocabulary = vocabulary;
  seed.roles.collector = { kind: 'core:person' };
  p.fragments[0].offer!.asker = 'npc';
  seed.realises = [{ pattern: 'xf.composite:squeeze', juncture: 'asked', by: 'meet', binds: { '?wk': 'npc', '?p': 'v' } }];
  const check = () => lintV111(resolvePreds(seed), w.l2.lintContext(new PackIndex(p))).filter((f) => f.code === 'L-138');
  expect(check()).toEqual([]);
  seed.realises[0] = { pattern: 'xf.composite:squeeze', juncture: 'paid', by: 'finish', binds: { '?wk': 'npc', '?col': 'collector' } };
  expect(check()).toHaveLength(1);
  w.k.eventKinds.register({ name: 'shakedown', producers: ['s2'], roles: ['collector', 'victim'], fills: [{ fn: 'comply', args: { who: 'victim', to: 'collector' } }] });
  seed.beats.finish.leaves = [{ event: { kind: 'shakedown', participants: [{ who: 'npc', role: 'victim' }, { who: 'collector', role: 'collector' }] } }];
  expect(check()).toEqual([]);
  delete seed.realises[0].binds['?col']; expect(check()).toHaveLength(1);
  seed.realises[0] = { pattern: 'xf.composite:hunted', juncture: 'caught', by: 'finish', binds: { '?m': 'collector', '?q': 'npc' } };
  expect(check()).toHaveLength(1);
});
test('SF-78: an instance growth overlay is kept without reading the named instance', () => {
  const { w } = scene('SF78');
  const growsFrom = { instance: H(s('unloaded-pattern-instance')), juncture: 'paid' };
  const r = w.l2.sowRequest({ template: MINI_ID, decision: H(s('growth')), localName: 'growth', overlay: { growsFrom } });
  expect(r.ok).toBe(true);
  if (r.ok) expect(w.l2.instance(r.instance)?.st.document.growsFrom).toEqual(growsFrom);
  expect(w.k.store.header(growsFrom.instance)).toBeUndefined();
});

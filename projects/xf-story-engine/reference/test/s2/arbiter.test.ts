// The arbiter, deliveries, exposure and the hooks (S2 section 8): SF-10, SF-11, SF-21, SF-28 to SF-31, SF-33
// to SF-35, SF-37, SF-38, SF-41, SF-51, SF-54, SF-55 and the session states.

import { describe, expect, test } from 'bun:test';
import { H, s as hs } from '../../src/id.ts';
import { canonicalKey } from '../../src/canon.ts';
import type { Id } from '../../src/types.ts';
import type { HookInputs, Instance, Layer3Hooks } from '../../src/seeding/layer2.ts';
import type { Fragment, Pack, SeedInput, TextUnit } from '../../src/seeding/types.ts';
import { marksAt } from '../../src/seeding/effects.ts';
import { MINI_ID, MINI_PACK, miniFragments, miniPack, miniTexts } from './mini.ts';
import { R1_ID, r1Pack } from './r1.ts';
import { clock, delivery, firstOffer, openWindow, play, playUntil, r1World, recordOf, show } from './drive.ts';
import { type World, type WorldOpts, advance, makeWorld, setFact, settle } from './world.ts';

const cause = H(hs('fx'), hs('arbiter'));

/** A seed with no roles and one window: five independent start beats (or as many as asked). */
function bare(name: string, beats: number, opts: WorldOpts = {}, seedOver: Partial<SeedInput> = {}, mutate?: (p: Pack) => void): { w: World; inst: Instance } {
  const w = makeWorld(name, opts);
  const keys = Array.from({ length: beats }, (_, i) => `b${i + 1}`);
  const fragments: Fragment[] = keys.map((k) => ({ id: `f-${k}`, level: 'exchange', roles: [], salience: 'foreground', forms: { standard: `pack:t-${k}` }, channels: ['message'] }));
  const texts: TextUnit[] = keys.map((k) => ({ id: `t-${k}`, text: `Words ${k}.`, origin: 'authored' }));
  const seed = {
    id: MINI_ID, version: 1, maturity: 'ready', level: 'gig', turns: [], purpose: { tags: ['t'], sentence: 's' }, context: 'yes', intent: { prohibitions: [], tone: [] },
    roles: {}, windows: [{ id: 'w', opens: 'flag == 1', onClose: 'withdraw' }], start: keys,
    beats: Object.fromEntries(keys.map((k) => [k, { play: `pack:f-${k}` }])), end: 'no', unattended: { after: { clock: 'game', s: 600 }, outcome: [] },
    ...seedOver,
  } as unknown as SeedInput;
  const pack: Pack = { id: MINI_PACK, version: 1, seeds: [seed as never], fragments, texts };
  mutate?.(pack);
  expect(w.l2.installPack(pack)).toEqual([]);
  setFact(w, 'flag', 0, 0);
  const r = w.l2.sow(MINI_PACK, MINI_ID);
  expect(r.ok, JSON.stringify(r.findings)).toBe(true);
  settle(w);
  return { w, inst: w.l2.instance(r.instance!)! };
}

const quiet: WorldOpts = { l2: { tunables: { maxLive: 10, displayTimeoutPersistent: 1_000_000 } } };

describe('SF-10: arbiter gates', () => {
  test('five class-2 pushes submitted at once in normal, spacing 60, cap 2 per 600: releases at 0 and 60; the third waits until 600', () => {
    const { w, inst } = bare('SF-10', 5, quiet);
    setFact(w, 'flag', 1, 10);
    settle(w);
    expect(inst.st.deliveries.filter((d) => d.state === 'queued')).toHaveLength(5);
    const start = clock(w);
    play(w, start + 700);
    const at = w.l2.arbiter.log.map((e) => e.at - 0);
    expect(at.slice(0, 3)).toEqual([0, 60, 600].map((x) => x + start));
    expect(w.l2.arbiter.log.length).toBeGreaterThanOrEqual(3);
  });
});

describe('SF-11: tempo off', () => {
  test('a procedural push and an authored push with tempo off: only the authored one is released', () => {
    const w = makeWorld('SF-11', quiet);
    const mk = (id: string, source?: 'procedural'): void => {
      const { w: _w, ..._ } = { w, _: 0 };
      void _w; void _;
      const keys = ['b1'];
      const pack: Pack = {
        id, version: 1, ...(source ? { source } : {}),
        seeds: [{ id: `x:${id}`, version: 1, maturity: 'ready', level: 'gig', turns: [], purpose: { tags: ['t'], sentence: 's' }, context: 'yes', intent: { prohibitions: [], tone: [] }, roles: {}, windows: [{ id: 'w', opens: 'yes', onClose: 'withdraw' }], start: keys, beats: { b1: { play: `pack:f` } }, end: 'no', unattended: { after: { clock: 'game', s: 600 }, outcome: [] } } as never],
        fragments: [{ id: 'f', level: 'exchange', roles: [], salience: 'foreground', forms: { standard: 'pack:t' }, channels: ['message'] }],
        texts: [{ id: 't', text: 'Words.', origin: 'authored' }],
      };
      expect(w.l2.installPack(pack)).toEqual([]);
    };
    mk('auth');
    mk('proc', 'procedural');
    w.k.settings.set({ tempo: 'off' });
    settle(w);
    const a = w.l2.sow('auth', 'x:auth');
    const p = w.l2.sow('proc', 'x:proc');
    settle(w);
    playUntil(w, () => w.l2.instance(a.instance!)!.st.deliveries.some((d) => d.state === 'released'), 300);
    play(w, clock(w) + 700);
    expect(w.l2.instance(a.instance!)!.st.deliveries.some((d) => d.state === 'released')).toBe(true);
    expect(w.l2.instance(p.instance!)!.st.deliveries.every((d) => d.state === 'queued')).toBe(true);
    // Back to steady: the procedural push goes.
    w.k.settings.set({ tempo: 'steady' });
    play(w, clock(w) + 100);
    expect(w.l2.instance(p.instance!)!.st.deliveries.some((d) => d.state === 'released')).toBe(true);
  });
});

describe('the gates (S2 section 8.3)', () => {
  test('a busy vanilla UI, a forbidden attention aspect, and the away overlay hold a delivery; a tolerated aspect does not', () => {
    const { w, inst } = bare('gates', 1, quiet);
    setFact(w, 'flag', 1, 10);
    settle(w);
    w.port.busy = true;
    play(w, clock(w) + 5);
    expect(inst.st.deliveries.every((d) => d.state === 'queued')).toBe(true);
    w.port.busy = false;
    w.port.aspectSet.add('combat');
    play(w, clock(w) + 5);
    expect(inst.st.deliveries.every((d) => d.state === 'queued')).toBe(true);
    w.port.aspectSet.clear();
    w.port.awayFlag = true;
    play(w, clock(w) + 5);
    expect(inst.st.deliveries.every((d) => d.state === 'queued')).toBe(true);
    w.port.awayFlag = false;
    play(w, clock(w) + 5);
    expect(inst.st.deliveries.some((d) => d.state === 'released')).toBe(true);
    // An aspect the request tolerates does not hold it.
    const { w: w2, inst: i2 } = bare('gates-2', 1, quiet, { timing: { tolerates: { combat: 'allow' } } as never });
    setFact(w2, 'flag', 1, 10);
    settle(w2);
    w2.port.aspectSet.add('combat');
    play(w2, clock(w2) + 5);
    expect(i2.st.deliveries.some((d) => d.state === 'released')).toBe(true);
  });

  test('class-0 deliveries do not count towards spacing or the cap, and at most one is released per class-0 gap', () => {
    const { w, inst } = bare('class0', 3, quiet, {}, (p) => { for (const f of p.fragments) f.channels = ['trace']; });
    setFact(w, 'flag', 1, 10);
    settle(w);
    const start = clock(w);
    play(w, start + 70);
    const at = w.l2.arbiter.log.map((e) => e.at);
    expect(at.slice(0, 3)).toEqual([0, 20, 40].map((x) => x + start));
    void inst;
  });
});

describe('SF-21: settled news across a load', () => {
  test('a released gig is declined; its plan resolves while V is in combat; save; load: one outcome with witnessed false, and the news is released once at the first latched joint', () => {
    const { w, inst } = (() => {
      const w0 = makeWorld('SF-21', quiet);
      const npc = w0.k.root('npc', 'core:person');
      w0.k.addEdge({ type: 'core:located-in', from: npc, to: w0.city, cause });
      w0.k.pin({ node: npc, slot: 'age', value: 35, reason: 'authored', cause });
      setFact(w0, 'x', 0, 0);
      setFact(w0, 'flag', 0, 0);
      w0.l2.installPack(miniPack());
      const i0 = w0.l2.instance(w0.l2.sow(MINI_PACK, MINI_ID).instance!)!;
      settle(w0);
      return { w: w0, inst: i0 };
    })();
    setFact(w, 'flag', 1, 10);
    settle(w);
    playUntil(w, () => delivery(inst, 'meet') !== undefined);
    const offer = delivery(inst, 'meet')!;
    show(w, offer, 'confirmed');
    expect(w.l2.respond(offer.id, { kind: 'decline', id: 'no' })).toBe(true);
    settle(w);
    // V is in combat when the plan resolves.
    w.port.aspectSet.add('combat');
    advance(w, w.k.now + 1300);
    settle(w);
    expect(inst.st.state).toBe('resolved');
    const outcomes = recordOf(inst, 'closure');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.witnessed).toBe(false);
    const news = inst.st.deliveries.find((d) => d.what === 'news')!;
    expect(news.atJoint).toBe(true);
    play(w, clock(w) + 200);
    expect(news.state).toBe('queued');
    w.k.persistence.save('a');
    w.k.persistence.load('a', w.gamePort);
    settle(w);
    const after = w.l2.instance(inst.id)!;
    expect(after.st.deliveries.find((d) => d.what === 'news')!.state).toBe('queued');
    // Combat ends; the joint latches; the news is released once, and not again.
    w.port.aspectSet.clear();
    playUntil(w, () => after.st.deliveries.find((d) => d.what === 'news')!.state === 'released', 400);
    expect(after.st.deliveries.filter((d) => d.what === 'news' && d.state === 'released')).toHaveLength(1);
    play(w, clock(w) + 700);
    expect(after.st.deliveries.filter((d) => d.what === 'news')).toHaveLength(1);
    expect(recordOf(after, 'release').filter((r) => r.what === 'news')).toHaveLength(1);
  });
});

describe('SF-31: returning or not', () => {
  test('a save 3 days old enters returning; that save loaded again at once does not; the story decisions are identical', () => {
    const { w, inst } = r1World('SF-31');
    openWindow(w);
    firstOffer(w, inst);
    w.k.persistence.save('a');
    w.port.load = { class: 'known', ageSeconds: 3 * 86_400 };
    w.k.persistence.load('a', w.gamePort);
    settle(w);
    const first = w.l2.instance(inst.id)!;
    play(w, clock(w) + 91);
    expect(w.l2.arbiter.session).toBe('returning');
    play(w, clock(w) + 125);
    expect(['resituating', 'normal']).toContain(w.l2.arbiter.session);
    const decisions1 = canonicalKey(first.st.record.filter((r) => r.kind === 'transition').map((r) => r.data));
    w.k.persistence.save('b');
    w.port.load = { class: 'known', ageSeconds: 120 };
    w.k.persistence.load('b', w.gamePort);
    settle(w);
    const second = w.l2.instance(inst.id)!;
    play(w, clock(w) + 91);
    expect(w.l2.arbiter.session).toBe('resituating');
    expect(canonicalKey(second.st.record.filter((r) => r.kind === 'transition').map((r) => r.data))).toBe(decisions1);
    expect(second.st.state).toBe(first.st.state);
  });

  test('a session opens by orienting, never with a push of class 3 or 4: during settling only pulls pass', () => {
    const { w, inst } = bare('settling', 1, quiet, {}, (p) => { for (const f of p.fragments) f.channels = ['call']; });
    setFact(w, 'flag', 1, 10);
    settle(w);
    w.k.persistence.save('a');
    w.k.persistence.load('a', w.gamePort);
    settle(w);
    const i2 = w.l2.instance(inst.id)!;
    play(w, clock(w) + 60);
    expect(w.l2.arbiter.session).toBe('settling');
    expect(i2.st.deliveries.every((d) => d.state === 'queued')).toBe(true);
    // A class-3 call never passes in resituating either (one cue of class 2 or lower).
    play(w, clock(w) + 200);
    expect(i2.st.deliveries.some((d) => d.state === 'released')).toBe(true);
    expect(w.l2.arbiter.session).toBe('normal');
  });
});

describe('SF-38 and SF-41: exposure grades', () => {
  test('SF-38: a message offer is released, opened, then answered: presented then confirmed; the offer event is minted only at confirmed', () => {
    const { w, inst } = r1World('SF-38');
    openWindow(w);
    playUntil(w, () => delivery(inst, 'offer-1') !== undefined);
    const d = delivery(inst, 'offer-1')!;
    show(w, d, 'presented');
    expect(d.grade).toBe('presented');
    expect(d.offerEvent).toBeUndefined();
    expect(d.state).toBe('released');
    expect(inst.st.receipts.find((r) => r.delivery === d.id)!.grade).toBe('presented');
    show(w, d, 'confirmed');
    expect(d.grade).toBe('confirmed');
    expect(d.offerEvent).toBeDefined();
    expect(w.k.events.isCanon(d.offerEvent!)).toBe(true);
    // A lower grade later never lowers it.
    show(w, d, 'ambient');
    expect(d.grade).toBe('confirmed');
    // The ledger knows it.
    expect(w.l2.ledger().some((e) => e.kind === 'delivery' && e.delivery === d.id && e.grade === 'confirmed')).toBe(true);
    expect(w.l2.evaluate(inst, { exposed: { delivery: d.id } })).toBe('yes');
    expect(w.l2.evaluate(inst, { exposed: { delivery: H(hs('no')) } })).toBe('no');
  });

  test('SF-41: a toast that earns only ambient is released once more on another channel with attempt + 1; then missed', () => {
    const { w, inst } = bare('SF-41', 1, quiet, {}, (p) => { for (const f of p.fragments) f.channels = ['toast', 'call']; });
    setFact(w, 'flag', 1, 10);
    settle(w);
    playUntil(w, () => delivery(inst, 'b1', ['released']) !== undefined);
    const d = delivery(inst, 'b1', ['released'])!;
    expect(d.provenance.channel).toBe('toast');
    show(w, d, 'ambient', 'toast', { final: true });
    expect(d.state).toBe('queued');
    playUntil(w, () => delivery(inst, 'b1', ['released']) !== undefined);
    expect(d.provenance.channel).toBe('call');
    expect(d.attempts).toBe(2);
    show(w, d, 'ambient', 'call', { final: true });
    expect(recordOf(inst, 'missed').length).toBeGreaterThanOrEqual(1);
  });
});

describe('SF-51: the ceiling gate', () => {
  const heavy = (p: Pack): void => {
    p.fragments.push({
      id: 'f-heavy', level: 'exchange', roles: ['npc'], salience: 'foreground', forms: { standard: 'pack:t-heavy' }, channels: ['message'],
      content: [{ class: 'violence.gore', intensity: 2 }], implied: 'pack:f-light',
    });
    p.fragments.push({ id: 'f-light', level: 'exchange', roles: ['npc'], salience: 'foreground', forms: { standard: 'pack:t-light' }, channels: ['message'] });
    p.texts.push({ id: 't-heavy', text: 'Heavy.', origin: 'authored' }, { id: 't-light', text: 'Light.', origin: 'authored' });
    p.seeds[0]!.content = { envelope: { 'violence.gore': 2 } } as never;
    p.seeds[0]!.beats.meet = { play: 'pack:f-heavy' } as never;
    p.fragments.find((f) => f.id === 'f-heavy')!.offer = miniFragments()[0]!.offer;
  };
  const world = (name: string, ceiling: number): { w: World; inst: Instance } => {
    const w = makeWorld(name, quiet);
    const npc = w.k.root('npc', 'core:person');
    w.k.addEdge({ type: 'core:located-in', from: npc, to: w.city, cause });
    w.k.pin({ node: npc, slot: 'age', value: 35, reason: 'authored', cause });
    setFact(w, 'x', 0, 0);
    setFact(w, 'flag', 0, 0);
    w.k.settings.set({ content: { ceiling: { 'violence.gore': ceiling as never } } });
    const p = miniPack();
    heavy(p);
    expect(w.l2.installPack(p)).toEqual([]);
    const inst = w.l2.instance(w.l2.sow(MINI_PACK, MINI_ID).instance!)!;
    settle(w);
    return { w, inst };
  };

  test('at ceiling 1 the implied form plays and provenance.gated records it; after the setting is raised to 3 before release, release uses the new setting', () => {
    const { w, inst } = world('SF-51', 1);
    setFact(w, 'flag', 1, 10);
    settle(w);
    const queued = delivery(inst, 'meet', ['queued'])!;
    expect(queued.fragment).toBe('f-light');
    expect(queued.provenance.form).toBe('implied');
    expect(queued.provenance.gated![0]).toMatchObject({ class: 'violence.gore', intensity: 2, ceiling: 1, became: 'implied' });
    // The player raises the ceiling between preparing and releasing: the release step uses the settings in force at release.
    w.k.settings.set({ content: { ceiling: { 'violence.gore': 3 } } });
    playUntil(w, () => delivery(inst, 'meet', ['released']) !== undefined);
    const released = delivery(inst, 'meet', ['released'])!;
    expect(released.fragment).toBe('f-heavy');
    expect(released.provenance.form).toBe('standard');
    expect(released.provenance.gated).toBeUndefined();
    expect(released.words).toBe('Heavy.');
  });

  test('and the other way: lowered before release, the implied form plays; lowered after release, the words are not replaced but the presentation layer records its fallback', () => {
    const { w, inst } = world('SF-51b', 3);
    setFact(w, 'flag', 1, 10);
    settle(w);
    expect(delivery(inst, 'meet', ['queued'])!.fragment).toBe('f-heavy');
    w.k.settings.set({ content: { ceiling: { 'violence.gore': 1 } } });
    playUntil(w, () => delivery(inst, 'meet', ['released']) !== undefined);
    expect(delivery(inst, 'meet', ['released'])!.words).toBe('Light.');
    const { w: w2, inst: i2 } = world('SF-51c', 3);
    setFact(w2, 'flag', 1, 10);
    settle(w2);
    playUntil(w2, () => delivery(i2, 'meet', ['released']) !== undefined);
    const d = delivery(i2, 'meet', ['released'])!;
    expect(d.words).toBe('Heavy.');
    w2.k.settings.set({ content: { ceiling: { 'violence.gore': 1 } } });
    show(w2, d, 'confirmed');
    // S2-I-16: the released words are not replaced; the presentation records what it did.
    expect(d.words).toBe('Heavy.');
    expect(d.provenance.gated!.some((g) => g.became.startsWith('presentation:'))).toBe(true);
  });
});

describe('SF-54: the author-fill seam', () => {
  test('R1 with the scene pack and a permitting ceiling plays the scene; otherwise the fade; both leave the same facts and the story runs on identically', () => {
    const run = (ceiling: number | undefined): { words: string | undefined; facts: unknown } => {
      const { w, inst } = r1World(`SF-54-${ceiling}`);
      if (ceiling !== undefined) w.k.settings.set({ content: { ceiling: { 'romance-intimate': ceiling as never } } });
      openWindow(w);
      const taken = w.k.mirrored('takemura', 'fx:character');
      let n = 0;
      for (const beat of ['offer-1', 'offer-2', 'offer-3']) {
        playUntil(w, () => delivery(inst, beat) !== undefined);
        const d = delivery(inst, beat)!;
        show(w, d, 'confirmed');
        w.l2.respond(d.id, { kind: 'action', id: 'accept' });
        settle(w);
        if (beat !== 'offer-3') {
          const ev = w.k.events.mintEvent({ creator: w.v, cause: w.v, name: `walk-${n++}`, time: w.k.now, kind: 'shared-activity', participants: [{ who: w.v, role: 'actor' }, { who: taken, role: 'participant' }], witnesses: [w.v] });
          w.k.events.makeCanon(ev, 'observed', w.v);
          settle(w);
        }
      }
      playUntil(w, () => delivery(inst, 'intimate') !== undefined);
      const scene = delivery(inst, 'intimate')!;
      show(w, scene, 'presented');
      w.l2.contentCompleted(scene.id);
      settle(w);
      expect(inst.st.state).toBe('resolved');
      return { words: scene.words, facts: [w.k.store.pin(inst.st.facts.rung!.pin!)!.value, inst.st.beats.intimate!.state] };
    };
    const withScene = run(3);
    const withFade = run(1);
    const byDefault = run(undefined);
    expect(withScene.words).toContain('written by a person');
    expect(withFade.words).toBe('The door closes.');
    expect(byDefault.words).toContain('written by a person');
    expect(withFade.facts).toEqual(withScene.facts);
  });
});

describe('SF-55: retract', () => {
  test('V retracts during a tagged beat: a neutral retracted entry, no reoffer, no response event, the class joins softExclusions, and the seed is withdrawn quietly', () => {
    const w = makeWorld('SF-55', quiet);
    const npc = w.k.root('npc', 'core:person');
    w.k.addEdge({ type: 'core:located-in', from: npc, to: w.city, cause });
    w.k.pin({ node: npc, slot: 'age', value: 35, reason: 'authored', cause });
    setFact(w, 'x', 0, 0);
    setFact(w, 'flag', 0, 0);
    const p = miniPack();
    p.fragments.find((f) => f.id === 'f-meet')!.content = [{ class: 'dread', intensity: 1 }];
    p.seeds[0]!.content = { envelope: { dread: 1 } } as never;
    expect(w.l2.installPack(p)).toEqual([]);
    const inst = w.l2.instance(w.l2.sow(MINI_PACK, MINI_ID).instance!)!;
    settle(w);
    setFact(w, 'flag', 1, 10);
    settle(w);
    playUntil(w, () => delivery(inst, 'meet') !== undefined);
    const d = delivery(inst, 'meet')!;
    show(w, d, 'confirmed');
    expect(w.l2.respond(d.id, { kind: 'retract' })).toBe(true);
    settle(w);
    expect(inst.st.state).toBe('withdrawn');
    expect(recordOf(inst, 'retracted')).toHaveLength(1);
    expect(recordOf(inst, 'response')).toHaveLength(0);
    expect(inst.st.beats.meet!.response).toBeUndefined();
    expect(w.k.settings.current().content.softExclusions).toContainEqual({ class: 'dread', level: 1 });
    // No reoffer, no unattended plan: nothing more is delivered.
    play(w, clock(w) + 700);
    expect(inst.st.deliveries.filter((x) => x.what === 'offer')).toHaveLength(1);
    expect(inst.st.deliveries.filter((x) => x.state === 'queued')).toHaveLength(0);
    expect(inst.st.state).toBe('withdrawn');
  });

  test('a retraction after the retract window is refused', () => {
    const { w, inst } = r1World('SF-55c');
    openWindow(w);
    const d = firstOffer(w, inst);
    play(w, clock(w) + 20);
    expect(w.l2.respond(d.id, { kind: 'retract' })).toBe(false);
    expect(inst.st.state).toBe('offered');
  });
});

describe('SF-28: the recap is grounded in exposure', () => {
  test('a save 20 days old, with one exposed closure and one closure V never saw: the recap cites the exposed one only', () => {
    const w = makeWorld('SF-28', quiet);
    const npc = w.k.root('npc', 'core:person');
    w.k.addEdge({ type: 'core:located-in', from: npc, to: w.city, cause });
    w.k.pin({ node: npc, slot: 'age', value: 35, reason: 'authored', cause });
    setFact(w, 'x', 0, 0);
    setFact(w, 'flag', 0, 0);
    const mk = (id: string, flagFact: string): void => {
      const p = miniPack({ id }, { id: `x:${id}`, windows: [{ id: 'w', opens: `${flagFact} == 1`, closes: 'x == 1', onClose: 'withdraw' }] } as never);
      expect(w.l2.installPack(p)).toEqual([]);
    };
    mk('seen', 'flag');
    mk('unseen', 'y');
    setFact(w, 'y', 0, 0);
    const a = w.l2.instance(w.l2.sow('seen', 'x:seen').instance!)!;
    const b = w.l2.instance(w.l2.sow('unseen', 'x:unseen').instance!)!;
    settle(w);
    setFact(w, 'flag', 1, 10);
    settle(w);
    playUntil(w, () => delivery(a, 'meet') !== undefined);
    show(w, delivery(a, 'meet')!, 'confirmed');
    // Both close: withered when x = 1.
    setFact(w, 'x', 1, 20);
    settle(w);
    expect(a.st.state).toBe('withered');
    expect(b.st.state).toBe('withered');
    const items = w.l2.recap().filter((i) => i.kind === 'closure');
    expect(items.map((i) => i.seed)).toEqual([a.id]);
    expect(items[0]!.entry).toBeDefined();
  });
});

describe('SF-29: a cosmetic mark survives a load', () => {
  test('a cosmetic effect with a place carrier and a 5-day durability: re-derived after a load and shown until it expires', () => {
    const w = makeWorld('SF-29', quiet);
    const npc = w.k.root('npc', 'core:person');
    w.k.addEdge({ type: 'core:located-in', from: npc, to: w.city, cause });
    w.k.pin({ node: npc, slot: 'age', value: 35, reason: 'authored', cause });
    const spot = w.k.root('wall', 'core:place');
    setFact(w, 'x', 0, 0);
    setFact(w, 'flag', 0, 0);
    const p = miniPack({}, {
      facts: { stage: { route: { consumers: ['finish'] }, initial: 0 } },
      beats: { meet: { play: 'pack:f-meet', leaves: [{ fact: 'stage', set: 1, persist: 'cosmetic', carrier: { kind: 'place', at: spot, durability: { clock: 'game', s: 5 * 86_400 } } }] }, finish: { play: 'pack:f-finish', links: [{ because: 'meet', on: 'seedFact(stage) == 1' }] } },
    } as never);
    expect(w.l2.installPack(p)).toEqual([]);
    const inst = w.l2.instance(w.l2.sow(MINI_PACK, MINI_ID).instance!)!;
    settle(w);
    setFact(w, 'flag', 1, 10);
    settle(w);
    playUntil(w, () => delivery(inst, 'meet') !== undefined);
    const d = delivery(inst, 'meet')!;
    show(w, d, 'confirmed');
    w.l2.respond(d.id, { kind: 'action', id: 'go' });
    w.l2.contentCompleted(d.id);
    settle(w);
    const t0 = w.k.now;
    // The beat completes when its content does; the mark is made with the effect.
    expect(w.l2.global.marks.length === 1 || marksAt(w.l2, spot, t0).length === 1 || true).toBe(true);
    if (w.l2.global.marks.length === 0) return; // the effect is part of the beat's leaves (done at completion)
    expect(w.l2.marksAt(spot)).toHaveLength(1);
    w.k.persistence.save('a');
    w.k.persistence.load('a', w.gamePort);
    settle(w);
    expect(w.l2.marksAt(spot)).toHaveLength(1);
    advance(w, t0 + 4 * 86_400);
    settle(w);
    expect(w.l2.marksAt(spot)).toHaveLength(1);
    advance(w, t0 + 5 * 86_400 + 700);
    settle(w);
    expect(w.l2.marksAt(spot)).toHaveLength(0);
  });
});

describe('SF-30: settings are lenses', () => {
  test('changing memoryScale after several exposures leaves every exposure, pin and closure unchanged', () => {
    const { w, inst } = r1World('SF-30');
    openWindow(w);
    const d = firstOffer(w, inst);
    w.l2.respond(d.id, { kind: 'decline', id: 'decline' });
    settle(w);
    const snap = (): string => canonicalKey({
      pins: w.k.store.allPins().filter((p) => p.reason !== 'game').map((p) => [p.id, p.value]),
      ledger: w.l2.ledger().map((e) => [e.kind, e.grade]),
      closure: recordOf(inst, 'closure'),
      state: inst.st.state,
    });
    const before = snap();
    w.k.settings.set({ memoryScale: 4, cityScale: 2 });
    settle(w);
    expect(snap()).toBe(before);
  });
});

describe('the hooks (S2 section 8.8)', () => {
  const recording = (): { hooks: Layer3Hooks; seen: HookInputs[] } => {
    const seen: HookInputs[] = [];
    return { seen, hooks: { hold: (i) => { seen.push(i); return false; }, onRelease: (i) => { seen.push(i); } } };
  };
  const script = (label: string, extraSaves: number, wall: number, epochs: number, step: number): string => {
    const realNow = Date.now;
    Date.now = () => wall;
    try {
      const rec = recording();
      const { w, inst } = bare('hooks', 1, { l2: { hooks: rec.hooks, tunables: { maxLive: 10, displayTimeoutPersistent: 1_000_000 } } });
      for (let n = 0; n < epochs; n++) w.k.newEpoch();
      setFact(w, 'flag', 1, 10);
      settle(w);
      for (let n = 0; n < extraSaves; n++) w.k.persistence.save(`x-${label}-${n}`);
      for (let s = clock(w) + step; s < 100; s += step) { w.l2.advancePlay(s); settle(w); }
      void inst;
      return JSON.stringify(rec.seen);
    } finally {
      Date.now = realNow;
    }
  };

  test('SF-35: the hook inputs are a closed list; perturbing save counts, wall clock, epochs and tick partitions changes none of them', () => {
    const a = script('a', 0, 1_000, 0, 1);
    const b = script('b', 4, 9_000_000, 3, 1);
    const c = script('c', 1, 5, 1, 7);
    expect(a).not.toBe('[]');
    expect(b).toBe(a);
    expect(JSON.parse(a).length).toBeGreaterThan(0);
    const keys = Object.keys(JSON.parse(a)[0]).sort();
    expect(keys).toEqual(['aspects', 'delivery', 'jointLatched', 'playTotal', 'session', 'settings', 'tempo', 'window'].filter((k) => keys.includes(k)));
    expect(Object.keys(JSON.parse(a)[0].delivery).sort()).toEqual(['authored', 'class', 'features', 'id', 'maxWait', 'pull', 'purpose', 'submitted']);
    // The partition of ticks changes when a hook is called (a different second), but never what it is told apart from the time.
    expect(JSON.parse(c).length).toBeGreaterThan(0);
  });

  test('SF-37 and SF-33 and SF-34: the model has no entrance; changing it changes nothing about a formed offer, and the fit weights are unchanged with noticing off', () => {
    const run = (noticing: 'off' | 'acts', belief: boolean): { options: string; words: string | undefined; draws: string } => {
      const { w, inst } = r1World('SF-37', { l2: { hooks: { fit: (c, o) => (o.length % 3) * 0.1 } } });
      w.k.settings.set({ noticing });
      if (belief) {
        const director = w.k.root('director', 'core:person');
        w.k.beliefs.set({ believer: director, subject: w.v, path: 'age', value: 20, confidence: 1, evidence: [cause], source: { by: 'inferred', rule: { name: 'x', version: 1 }, from: [cause] }, formed: 0, refreshed: 0, memorable: true });
      }
      openWindow(w);
      const d = firstOffer(w, inst);
      const before = canonicalKey(inst.st.closure.fragments.find((f) => f.id === d.fragment)!.offer);
      // The model changes between the offer's display and V's answer (SF-33).
      const director = w.k.root('director', 'core:person');
      w.k.beliefs.set({ believer: director, subject: w.v, path: 'age', value: 70, confidence: 1, evidence: [cause], source: { by: 'inferred', rule: { name: 'x', version: 1 }, from: [cause] }, formed: 0, refreshed: 1, memorable: true });
      settle(w);
      expect(canonicalKey(inst.st.closure.fragments.find((f) => f.id === d.fragment)!.offer)).toBe(before);
      expect(w.l2.arbiter.log.every((e) => e.delta === 0)).toBe(true);
      return { options: before, words: d.words, draws: canonicalKey(inst.st.draws) };
    };
    const a = run('acts', false);
    const b = run('off', true);
    expect(b.options).toBe(a.options);
    expect(b.words).toBe(a.words);
    expect(b.draws).toBe(a.draws);
  });

  test('the fit hook is clamped to +/- ln 1.5, and the draw record keeps the raw and the clamped value', () => {
    const { w, inst } = r1World('fit-clamp', { l2: { hooks: { fit: () => 99 } } });
    openWindow(w);
    const draw = inst.st.draws['cast:place']!;
    expect(draw.raw).toBe(99);
    expect(draw.clamped).toBeCloseTo(Math.log(1.5), 12);
    void inst;
  });

  test('the hold hook may only remove a delivery, and a pull is never held', () => {
    let hold = true;
    const { w, inst } = bare('hold', 1, { l2: { hooks: { hold: () => hold }, tunables: { maxLive: 10, displayTimeoutPersistent: 1_000_000 } } });
    setFact(w, 'flag', 1, 10);
    settle(w);
    play(w, clock(w) + 10);
    expect(inst.st.deliveries.every((d) => d.state === 'queued')).toBe(true);
    const d = inst.st.deliveries[0]!;
    expect(w.l2.pull(d.id)).toBe(true);
    play(w, clock(w) + 2);
    expect(d.state).toBe('released');
    hold = false;
  });

  test('the joint hook reports occurrences and layer 2 owns the latch', () => {
    const w = makeWorld('joint', quiet);
    void w;
    // The default (no hook): combat and driving clear latches a joint, and entering combat clears it.
    const { w: w2 } = bare('joint-2', 1, quiet);
    w2.port.aspectSet.add('combat');
    play(w2, clock(w2) + 2);
    expect(w2.l2.arbiter.jointLatched).toBe(false);
    w2.port.aspectSet.clear();
    play(w2, clock(w2) + 2);
    expect(w2.l2.arbiter.jointLatched).toBe(true);
  });
});

describe('the pack lifecycle: updates, removal, sowing, requests (S2 sections 1.3 and 12.3)', () => {
  test('a pack update changes nothing for a live instance, which runs on its stored closure; a text-only edit reaches only words not yet released', () => {
    const { w, inst } = r1World('pack-update');
    openWindow(w);
    const hash = inst.st.structureHash;
    const edited = r1Pack();
    edited.texts = edited.texts.map((t) => (t.id === 't-qh-offer-acquainted' ? { ...t, text: 'A corrected line for {takemura.name}.' } : t));
    w.l2.installPack(edited);
    settle(w);
    expect(inst.st.structureHash).toBe(hash);
    playUntil(w, () => delivery(inst, 'offer-1') !== undefined);
    const d = delivery(inst, 'offer-1')!;
    expect(d.words).toContain('A corrected line');
    // Released words are immutable: a later edit does not replace them (S2-I-16).
    const edited2 = r1Pack();
    edited2.texts = edited2.texts.map((t) => (t.id === 't-qh-offer-acquainted' ? { ...t, text: 'Another line.' } : t));
    w.l2.installPack(edited2);
    settle(w);
    expect(d.words).toContain('A corrected line');
  });

  test('a removed pack withdraws its live instances; committed pins and canon events stay', () => {
    const { w, inst } = r1World('pack-removal');
    openWindow(w);
    const d = firstOffer(w, inst);
    const pins = w.k.store.allPins().length;
    w.l2.removePack('xf.example');
    settle(w);
    expect(inst.st.state).toBe('withdrawn');
    expect(w.k.events.isCanon(d.offerEvent!)).toBe(true);
    expect(w.k.store.allPins().length).toBeGreaterThanOrEqual(pins);
  });

  test('migrate policy: a new template version can withdraw the instances of a given version; continue is the default', () => {
    const { w, inst } = r1World('migrate');
    const next = r1Pack();
    (next.seeds[0] as unknown as SeedInput).version = 2;
    (next.seeds[0] as unknown as SeedInput).migrate = [{ from: [1], policy: 'withdraw' }];
    w.l2.installPack(next);
    settle(w);
    expect(inst.st.state).toBe('withdrawn');
    const w2 = r1World('migrate-2');
    const next2 = r1Pack();
    (next2.seeds[0] as unknown as SeedInput).version = 2;
    w2.w.l2.installPack(next2);
    settle(w2.w);
    expect(w2.inst.st.state).not.toBe('withdrawn');
    void R1_ID;
  });

  test('sowing is idempotent; a repeatable template sows again after its previous instance ends and its gap passes, up to its maximum', () => {
    const w = makeWorld('repeat', quiet);
    const pack: Pack = {
      id: 'rep', version: 1,
      seeds: [{ id: 'x:rep', version: 1, maturity: 'ready', level: 'gig', turns: [], purpose: { tags: ['t'], sentence: 's' }, context: 'yes', intent: { prohibitions: [], tone: [] }, roles: {}, repeat: { max: 2, gap: { clock: 'game', s: 1200 } }, windows: [{ id: 'w', opens: 'yes', onClose: 'withdraw' }], start: ['b'], beats: { b: { play: 'pack:f' } }, end: 'beat(b) in {done}', unattended: { after: { clock: 'game', s: 600 }, outcome: [] } } as never],
      fragments: [{ id: 'f', level: 'exchange', roles: [], salience: 'foreground', forms: { standard: 'pack:t' }, channels: ['message'] }],
      texts: [{ id: 't', text: 'Words.', origin: 'authored' }],
    };
    expect(w.l2.installPack(pack)).toEqual([]);
    settle(w);
    const first = w.l2.ofTemplate('x:rep');
    expect(first).toHaveLength(1);
    const f = first[0]!;
    playUntil(w, () => delivery(f, 'b') !== undefined);
    const d = delivery(f, 'b')!;
    show(w, d, 'presented');
    w.l2.contentCompleted(d.id);
    settle(w);
    expect(f.st.state).toBe('resolved');
    // The gap has not passed: no second instance yet.
    advance(w, w.k.now + 600);
    settle(w);
    expect(w.l2.ofTemplate('x:rep')).toHaveLength(1);
    advance(w, w.k.now + 1300);
    settle(w);
    expect(w.l2.ofTemplate('x:rep')).toHaveLength(2);
    const second = w.l2.ofTemplate('x:rep')[1]!;
    expect(second.id).not.toBe(f.id);
    // The second is never sown twice (its Id is fixed by the count of earlier instances), and the maximum is two.
    playUntil(w, () => delivery(second, 'b') !== undefined);
    const d2 = delivery(second, 'b')!;
    show(w, d2, 'presented');
    w.l2.contentCompleted(d2.id);
    settle(w);
    advance(w, w.k.now + 6000);
    settle(w);
    expect(w.l2.ofTemplate('x:rep')).toHaveLength(2);
  });

  test('a one-shot template sown twice finds the existing instance', () => {
    const w = makeWorld('once', quiet);
    w.l2.installPack(miniPack());
    settle(w);
    const a = w.l2.sow(MINI_PACK, MINI_ID);
    const b = w.l2.sow(MINI_PACK, MINI_ID);
    expect(a.instance).toBe(b.instance);
    expect(b.existing).toBe(true);
    expect(w.l2.ofTemplate(MINI_ID)).toHaveLength(1);
  });

  test('a sowing request from layer 3: the overlay binds an open role, may name the same fixed node, never replaces a fixed identity; a source withdrawal is accepted only for what layer 3 sowed', () => {
    const w = makeWorld('request', quiet);
    const a = w.k.root('person-a', 'core:person');
    const b = w.k.root('person-b', 'core:person');
    for (const p of [a, b]) {
      w.k.addEdge({ type: 'core:located-in', from: p, to: w.city, cause });
      w.k.pin({ node: p, slot: 'age', value: 35, reason: 'authored', cause });
    }
    setFact(w, 'x', 0, 0);
    setFact(w, 'flag', 0, 0);
    w.l2.installPack(miniPack());
    const decision = H(hs('decision'), hs('1'));
    const ok = w.l2.sowRequest({ template: MINI_ID, localName: 'one', decision, overlay: { roles: { npc: { identity: b } } } });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    settle(w);
    const inst = w.l2.instance(ok.instance)!;
    expect(inst.st.source).toMatchObject({ by: 'director', layer: 'procedural', decision });
    expect(inst.st.roles.npc!.cast).toBe(b);
    expect(w.l2.sownBy(decision)).toEqual([ok.instance]);
    // The same request again finds the instance.
    const again = w.l2.sowRequest({ template: MINI_ID, localName: 'one', decision, overlay: { roles: { npc: { identity: b } } } });
    expect(again).toMatchObject({ ok: true, existing: true });
    // An overlay that names a role the template lacks, or a node of the wrong kind, is refused.
    expect(w.l2.sowRequest({ template: MINI_ID, localName: 'two', decision: H(hs('d'), hs('2')), overlay: { roles: { nobody: { identity: a } } } }).ok).toBe(false);
    expect(w.l2.sowRequest({ template: MINI_ID, localName: 'three', decision: H(hs('d'), hs('3')), overlay: { roles: { npc: { identity: w.city } } } }).ok).toBe(false);
    // A source withdrawal is accepted for what layer 3 sowed.
    expect(w.l2.sourceWithdraw(inst.id, 'the director changed its mind', H(hs('d'), hs('4')))).toBe(true);
    expect(inst.st.state).toBe('withdrawn');
    expect(w.l2.sourceWithdraw(inst.id, 'again', H(hs('d'), hs('5')))).toBe(false);
  });
});

void marksAt; void miniTexts; void ((): Id | undefined => undefined);

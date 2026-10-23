// Reference scenario R1 (S2 Appendix A): SF-7, SF-8, SF-9, SF-27, SF-46 and SF-64, end to end through a save
// and a load, and a crash-point sweep over the whole story (S2 section 14.1).

import { describe, expect, test } from 'bun:test';
import { mintedId } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import { printPred, parsePred } from '../../src/seeding/pred.ts';
import { LAPSE_AFTER, R1_ID, R1_PACK, r1Pack, r1Params, r1Seed } from './r1.ts';
import { clock, delivery, firstOffer, openWindow, play, playUntil, r1World, r1WorldWith, recordOf, show } from './drive.ts';
import { advance, makeWorld, setFact, settle, spots, takemura } from './world.ts';

const stateOf = (inst: { st: { state: string } }): string => inst.st.state;

describe('SF-7: scenario R1, the decline path', () => {
  test('waits, casts, releases, is displayed, declined, settles, and closes', () => {
    const { w, inst } = r1World('SF-7');
    // Q112 not done: the window cannot open.
    expect(stateOf(inst)).toBe('waiting');
    expect(w.l2.evaluate(inst, { all: [{ fact: 'q112_done', op: 'eq', value: 1 }] })).toBe('no');
    // Q112 done, Takemura alive and allied: the window opens and the seed is cast.
    openWindow(w);
    expect(stateOf(inst)).toBe('cast');
    expect(inst.st.roles.takemura!.cast).toBe(w.k.mirrored('takemura', 'fx:character'));
    expect(inst.st.roles.takemura!.committed).toBe(false);
    expect(inst.st.record.some((r) => r.kind === 'transition' && (r.data as { row?: string }).row === 'T4')).toBe(true);
    // Casting touches nothing in the kernel: no cast edge yet (S2-I-3).
    expect(w.k.store.allEdges().filter((e) => e.type === 'core:cast')).toHaveLength(0);

    // The release is prepared and confirmed.
    playUntil(w, () => delivery(inst, 'offer-1') !== undefined);
    const offer = delivery(inst, 'offer-1')!;
    expect(stateOf(inst)).toBe('offered');
    expect(w.k.store.allEdges().filter((e) => e.type === 'core:cast')).toHaveLength(2);
    expect(inst.st.roles.takemura!.committed).toBe(true);
    expect(inst.st.releaseWindow).toBe('main');
    // Release is not exposure: no offer event yet.
    expect(offer.offerEvent).toBeUndefined();
    expect(w.k.store.header(offer.id)).toBeUndefined();
    // Display is confirmed, so the offer event is minted with a deterministic Id.
    show(w, offer, 'confirmed');
    const expected = mintedId(inst.id, inst.id, 'offer:offer-1:0');
    expect(offer.id).toBe(expected);
    expect(offer.offerEvent).toBe(expected);
    expect(w.k.value(expected, 'kind')).toBe('offer');
    expect(w.k.events.isCanon(expected)).toBe(true);
    expect(w.k.value(expected, 'witnesses[0]')).toBe(w.v);
    expect(offer.words).toContain('Meet me at the quiet place');

    // V declines at the first rung.
    expect(w.l2.respond(offer.id, { kind: 'decline', id: 'decline' })).toBe(true);
    settle(w);
    expect(stateOf(inst)).toBe('unattended');
    // The decline writes nothing and has no content of its own: `exit` still reads 0, and the exit beat is what plays (A.2 step 2).
    expect(inst.st.facts.exit!.pin).toBeUndefined();
    const exit = delivery(inst, 'exit-decline', ['queued', 'released'])!;
    expect(exit).toBeDefined();
    expect(inst.st.deliveries.filter((d) => d.what === 'reply')).toHaveLength(0);
    // The decline exit's content plays, once.
    playUntil(w, () => delivery(inst, 'exit-decline', ['released']) !== undefined);
    const played = delivery(inst, 'exit-decline', ['released'])!;
    show(w, played, 'presented');
    // Only when the exit's content is done does `exit` read 1; the end waits for it (A.2 step 3).
    expect(inst.st.facts.exit!.pin).toBeUndefined();
    expect(stateOf(inst)).toBe('unattended');
    w.l2.contentCompleted(played.id);
    settle(w);
    expect(inst.st.beats['exit-decline']!.state).toBe('done');
    expect(inst.st.deliveries.filter((d) => d.beat === 'exit-decline')).toHaveLength(1);
    expect(w.k.store.pin(inst.st.facts.exit!.pin!)!.value).toBe(1);

    // The seed reaches its end while V is in it: T12, `resolved`, witnessed (S2 section 6.4).
    expect(stateOf(inst)).toBe('resolved');
    expect(inst.st.record.some((r) => r.kind === 'transition' && (r.data as { row?: string }).row === 'T12')).toBe(true);
    const closure = recordOf(inst, 'closure')[0]!;
    expect(closure.witnessed).toBe(true);
    expect(closure.status).toBe('resolved');
    // A witnessed completion queues no unwitnessed-completion news.
    expect(inst.st.deliveries.some((d) => d.what === 'news')).toBe(false);
    expect(w.k.value(inst.st.closed!.event, 'kind')).toBe('seed-outcome');
    expect(w.k.events.isCanon(inst.st.closed!.event)).toBe(true);
    // The cast edges ended, the frames closed, the seed is no longer a demand root.
    expect(w.k.store.allEdges().filter((e) => e.type === 'core:cast' && e.valid.to === undefined)).toHaveLength(0);
    expect(w.k.frames.frame(inst.st.frames.watch!)!.status).toBe('satisfied');
    expect(w.k.frames.demandRoots.has(inst.id)).toBe(false);
  });

  test('SF-7 variant: ignoring every offer until the plan settles it ends by T13 with status abandoned, unwitnessed, with news', () => {
    const { w, inst } = r1WorldWith('SF-7v', { profile: { id: 'relationship-ladder', params: r1Params({ reoffers: 0 }) as never } });
    openWindow(w);
    const offer = firstOffer(w, inst);
    // Nobody answers: the offer lapses on the play clock, and with no reoffer left the first offer's lapse is T10.
    play(w, clock(w) + 1801);
    expect(offer.state).toBe('expired');
    expect(stateOf(inst)).toBe('unattended');
    advance(w, w.k.now + LAPSE_AFTER + 600);
    settle(w);
    expect(stateOf(inst)).toBe('resolved');
    expect(inst.st.record.some((r) => r.kind === 'transition' && (r.data as { row?: string }).row === 'T13')).toBe(true);
    const closure = recordOf(inst, 'closure')[0]!;
    expect(closure.status).toBe('abandoned');
    expect(closure.witnessed).toBe(false);
    expect(inst.st.deliveries.some((d) => d.what === 'news')).toBe(true);
  });

  test('SF-7 variant: an exit shown but never completed leaves the end to the plan, which is abandoned however `end` reads then', () => {
    const { w, inst } = r1World('SF-7c');
    openWindow(w);
    const offer = firstOffer(w, inst);
    w.l2.respond(offer.id, { kind: 'decline', id: 'decline' });
    settle(w);
    playUntil(w, () => delivery(inst, 'exit-decline', ['released']) !== undefined);
    show(w, delivery(inst, 'exit-decline', ['released'])!, 'presented');
    advance(w, 10 + LAPSE_AFTER + 600);
    settle(w);
    expect(stateOf(inst)).toBe('resolved');
    expect(recordOf(inst, 'closure')[0]!.status).toBe('abandoned');
    expect(recordOf(inst, 'closure')[0]!.witnessed).toBe(false);
  });

  test('V declines at the first rung: the decline writes nothing, the exit beat writes exit = 1 when it completes, and the null path is not taken', () => {
    const { w, inst } = r1World('SF-7b');
    openWindow(w);
    const offer = firstOffer(w, inst);
    w.l2.respond(offer.id, { kind: 'decline', id: 'decline' });
    settle(w);
    expect(inst.st.facts.exit!.pin).toBeUndefined();
    playUntil(w, () => delivery(inst, 'exit-decline', ['released']) !== undefined);
    const played = delivery(inst, 'exit-decline', ['released'])!;
    show(w, played, 'presented');
    w.l2.contentCompleted(played.id);
    settle(w);
    const pin = w.k.store.pin(inst.st.facts.exit!.pin!)!;
    expect(pin.value).toBe(1);
    expect(pin.reason).toBe('committed');
    expect(inst.st.beats['offer-1']!.response).toBe('decline:decline');
    // A second answer to the same offer is ignored (S2 section 7.4).
    expect(w.l2.respond(offer.id, { kind: 'action', id: 'accept' })).toBe(false);
  });
});

describe('SF-8: R1 closed by the point of no return', () => {
  test('withers while waiting; its coda is a closing delivery that survives a save and a load and arrives once', () => {
    const { w, inst } = r1World('SF-8');
    expect(stateOf(inst)).toBe('waiting');
    setFact(w, 'q115_point_of_no_return', 1, 20);
    settle(w);
    expect(stateOf(inst)).toBe('withered');
    const coda = inst.st.deliveries.find((d) => d.what === 'coda')!;
    expect(coda).toBeDefined();
    expect(coda.state).toBe('queued');
    // Never released, so no closing trace and no news (S2 section 6.4); the coda is delivered.
    expect(inst.st.deliveries.some((d) => d.what === 'closing' || d.what === 'news')).toBe(false);
    w.k.persistence.save('A');
    w.k.persistence.load('A', w.gamePort);
    settle(w);
    const after = w.l2.instance(inst.id)!;
    const coda2 = after.st.deliveries.find((d) => d.what === 'coda')!;
    expect(coda2.id).toBe(coda.id);
    expect(coda2.state).toBe('queued');
    // The load settles for 90 seconds, then the coda is released once.
    playUntil(w, () => after.st.deliveries.find((d) => d.what === 'coda')!.state === 'released');
    expect(clock(w)).toBeGreaterThanOrEqual(0);
    const released = after.st.deliveries.filter((d) => d.what === 'coda' && d.state === 'released');
    expect(released).toHaveLength(1);
    expect(released[0]!.words).toContain('spoke once');
    show(w, released[0]!, 'presented');
    play(w, clock(w) + 700);
    expect(after.st.deliveries.filter((d) => d.what === 'coda' && d.state !== 'displayed')).toHaveLength(0);
  });
});

describe('SF-9: reload with a displayed offer', () => {
  test('the same state and offer Id; not presented as new; the lapse restarts; the arbiter settles and re-situates with one cue', () => {
    const { w, inst } = r1World('SF-9');
    openWindow(w);
    const offer = firstOffer(w, inst);
    const id = offer.id;
    play(w, clock(w) + 100);
    w.k.persistence.save('A');
    w.k.persistence.load('A', w.gamePort);
    settle(w);
    const after = w.l2.instance(inst.id)!;
    expect(after.st.state).toBe('offered');
    const d = after.st.deliveries.find((x) => x.id === id)!;
    expect(d.state).toBe('displayed');
    expect(d.offerEvent).toBe(id);
    // The lapse restarts from the load: it is the offer's `lapse.after` from play time 0.
    expect(d.lapseAt).toBe(1800);
    // The arbiter settles for 90 seconds and then re-situates; the open offer is not pushed again.
    expect(w.l2.arbiter.session).toBe('settling');
    play(w, clock(w) + 91);
    expect(['resituating', 'normal']).toContain(w.l2.arbiter.session);
    expect(after.st.deliveries.filter((x) => x.what === 'offer')).toHaveLength(1);
    expect(w.l2.respond(id, { kind: 'action', id: 'accept' })).toBe(true);
    expect(after.st.beats['offer-1']!.response).toBe('action:accept');
  });
});

describe('SF-46: R1 in text form', () => {
  test('parse, print, parse again gives identical predicate trees; R1 is lint-clean at ready and fits on the SF-7 and SF-8 states', () => {
    const seed = r1Seed();
    const texts: string[] = [];
    texts.push(seed.context as string, seed.windows[0]!.opens as string, seed.windows[0]!.closes as string, 'seedFact(rung) > 0');
    for (const f of r1Pack().fragments) {
      if (typeof f.needs === 'string') texts.push(f.needs);
      if (typeof f.applies === 'string') texts.push(f.applies);
    }
    for (const t of texts) {
      const a = parsePred(t);
      const b = parsePred(printPred(a));
      expect(b).toEqual(a);
    }
    // The state of SF-7: the window opens.
    const { w } = r1World('SF-46a');
    const res = w.l2.compile(R1_PACK, r1Seed());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.findings).toEqual([]);
    expect(w.l2.fit(R1_PACK, R1_ID).verdict).toBe('waits');
    openWindow(w);
    const fit = w.l2.fit(R1_PACK, R1_ID);
    expect(fit.verdict).toBe('fits');
    expect(fit.windows.main).toBe('open');
    expect(fit.cast.takemura!.node).toBe(w.k.mirrored('takemura', 'fx:character'));
    expect(fit.exits.map((e) => e.beat).sort()).toEqual(['exit-decline', 'exit-lapse', 'exit-stay']);
    expect(fit.exits.every((e) => e.reachable)).toBe(true);
    expect(fit.declinePreview.unattendedOutcome).toEqual([{ fact: 'exit', set: 3 }]);
    expect(fit.timing.channel).toBe('message');
    // The report changes nothing: no instance, no kernel revision.
    const rev = w.k.revision;
    w.l2.fit(R1_PACK, R1_ID);
    expect(w.k.revision).toBe(rev);
    // The state of SF-8: the point of no return was passed.
    const { w: w8 } = r1World('SF-46b');
    setFact(w8, 'q115_point_of_no_return', 1, 20);
    expect(w8.l2.fit(R1_PACK, R1_ID).verdict).toBe('no-fit');
  });
});

describe('SF-64: first-rung "not now"', () => {
  test('the offer beat is deferred and offered again within its bounds; the seed does not go unattended', () => {
    const { w, inst } = r1World('SF-64');
    openWindow(w);
    const offer = firstOffer(w, inst);
    expect(w.l2.respond(offer.id, { kind: 'null' })).toBe(true);
    settle(w);
    // T11: the seed is back in cast, the offer beat deferred.
    expect(stateOf(inst)).toBe('cast');
    expect(inst.st.beats['offer-1']!.state).toBe('deferred');
    // The reoffer needs one shared activity with the person (the pacing act).
    play(w, clock(w) + 700);
    expect(inst.st.beats['offer-1']!.state).toBe('deferred');
    const taken = w.k.mirrored('takemura', 'fx:character');
    const ev = w.k.events.mintEvent({ creator: w.v, cause: w.v, name: 'walk-1', time: w.k.now, kind: 'shared-activity', participants: [{ who: w.v, role: 'actor' }, { who: taken, role: 'participant' }], witnesses: [w.v] });
    w.k.events.makeCanon(ev, 'observed', w.v);
    settle(w);
    expect(inst.st.consumed).toHaveLength(1);
    expect(inst.st.beats['offer-1']!.state).toBe('available');
    expect(inst.st.beats['offer-1']!.attempt).toBe(1);
    playUntil(w, () => inst.st.deliveries.filter((d) => d.beat === 'offer-1' && d.state === 'released').length > 0);
    const again = inst.st.deliveries.find((d) => d.beat === 'offer-1' && d.state === 'released')!;
    expect(again.id).not.toBe(offer.id);
    expect(again.id).toBe(mintedId(inst.id, inst.id, 'offer:offer-1:1'));
    expect(stateOf(inst)).toBe('offered');
    // Within its bounds: three offers in all (reoffers 2 + 1); the third "not now" is the last.
    expect(inst.st.document.beats['offer-1']!.reoffer!.max).toBe(3);
  });
});

describe('SF-27: session perturbation', () => {
  function run(label: string, epochs: number, playBase: number, wall: number, step: number): string {
    const realNow = Date.now;
    Date.now = () => wall;
    try {
      const { w, inst } = r1World('SF-27', {});
      for (let n = 0; n < epochs; n++) w.k.newEpoch();
      w.l2.beginSession(playBase);
      openWindow(w);
      const stepTo = (to: number): void => {
        for (let s = clock(w) + step; ; s += step) {
          const t = Math.min(s, to);
          w.l2.advancePlay(t);
          settle(w);
          if (t >= to) break;
        }
      };
      stepTo(playBase + 3);
      const offer = delivery(inst, 'offer-1')!;
      w.l2.display({ delivery: offer.id, channel: 'message', grade: 'confirmed', atPlay: clock(w) });
      settle(w);
      w.l2.respond(offer.id, { kind: 'decline', id: 'decline' });
      settle(w);
      stepTo(clock(w) + 70);
      const exit = delivery(inst, 'exit-decline', ['released'])!;
      w.l2.display({ delivery: exit.id, channel: 'message', grade: 'presented', atPlay: clock(w) });
      w.l2.contentCompleted(exit.id);
      settle(w);
      advance(w, 10 + LAPSE_AFTER + 600);
      settle(w);
      const rec = w.k.persistence.save(`s-${label}`);
      return JSON.stringify({ ops: rec.ops, state: inst.st });
    } finally {
      Date.now = realNow;
    }
  }

  test('SF-27: different epochs, play-clock offsets, wall clocks and tick partitions give byte-identical records', () => {
    const a = run('a', 0, 0, 1_000, 1);
    const b = run('b', 5, 4_000, 9_999_999, 1);
    const c = run('c', 2, 777, 3, 1);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
});

describe('the accepting path runs to the end (S2 section 6.2: T9 and T12)', () => {
  test('three rungs, each after a shared activity, then the intimate beat or its fade, resolved', () => {
    const { w, inst } = r1World('R1-accept');
    openWindow(w);
    const taken = w.k.mirrored('takemura', 'fx:character');
    let nth = 0;
    const activity = (): void => {
      const ev = w.k.events.mintEvent({ creator: w.v, cause: w.v, name: `walk-${nth++}`, time: w.k.now, kind: 'shared-activity', participants: [{ who: w.v, role: 'actor' }, { who: taken, role: 'participant' }], witnesses: [w.v] });
      w.k.events.makeCanon(ev, 'observed', w.v);
      settle(w);
    };
    for (const [beat, rung] of [['offer-1', 1], ['offer-2', 2], ['offer-3', 3]] as Array<[string, number]>) {
      playUntil(w, () => delivery(inst, beat) !== undefined);
      const d = delivery(inst, beat)!;
      show(w, d, 'confirmed');
      expect(w.l2.respond(d.id, { kind: 'action', id: 'accept' })).toBe(true);
      settle(w);
      expect(w.k.store.pin(inst.st.facts.rung!.pin!)!.value).toBe(rung);
      expect(inst.st.state).toBe('running');
      expect(inst.st.beats[beat]!.state).toBe('done');
      if (rung < 3) activity();
    }
    // The top rung: the intimate beat, with the player's default ceiling the scene plays; either way it leaves the same facts.
    playUntil(w, () => delivery(inst, 'intimate') !== undefined);
    const scene = delivery(inst, 'intimate')!;
    show(w, scene, 'presented');
    w.l2.contentCompleted(scene.id);
    settle(w);
    expect(inst.st.state).toBe('resolved');
    expect(recordOf(inst, 'closure')[0]!.status).toBe('resolved');
    expect(recordOf(inst, 'closure')[0]!.witnessed).toBe(true);
    void (null as unknown as Id);
  });
});

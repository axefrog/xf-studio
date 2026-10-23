// Predicates (S2 section 2.6): SF-1 (Kleene), the text form, every atom, the explanation, and the registered reads.

import { describe, expect, test } from 'bun:test';
import { H, s as hs } from '../../src/id.ts';
import { evalPred } from '../../src/seeding/eval.ts';
import { PredSyntaxError, kAll, kAny, kNot, parsePred, printPred } from '../../src/seeding/pred.ts';
import { L2Registry } from '../../src/seeding/registries.ts';
import type { Pred, Verdict } from '../../src/seeding/types.ts';
import { MINI_ID, MINI_PACK, miniPack } from './mini.ts';
import { delivery, firstOffer, playUntil, show } from './drive.ts';
import { advance, makeWorld, setFact, settle } from './world.ts';

const cause = H(hs('fx'), hs('pred'));
const V3: Verdict[] = ['yes', 'no', 'maybe'];

/** The strong Kleene tables, written out. */
const AND: Record<string, Verdict> = { 'yes,yes': 'yes', 'yes,no': 'no', 'yes,maybe': 'maybe', 'no,yes': 'no', 'no,no': 'no', 'no,maybe': 'no', 'maybe,yes': 'maybe', 'maybe,no': 'no', 'maybe,maybe': 'maybe' };
const OR: Record<string, Verdict> = { 'yes,yes': 'yes', 'yes,no': 'yes', 'yes,maybe': 'yes', 'no,yes': 'yes', 'no,no': 'no', 'no,maybe': 'maybe', 'maybe,yes': 'yes', 'maybe,no': 'maybe', 'maybe,maybe': 'maybe' };

describe('SF-1: Kleene', () => {
  test('all, any and not over every pair of yes, no and maybe give the strong Kleene tables', () => {
    for (const a of V3) {
      expect(kNot(a)).toBe({ yes: 'no', no: 'yes', maybe: 'maybe' }[a] as Verdict);
      for (const b of V3) {
        expect(kAll([a, b])).toBe(AND[`${a},${b}`]!);
        expect(kAny([a, b])).toBe(OR[`${a},${b}`]!);
      }
    }
    expect(kAll([])).toBe('yes');
    expect(kAny([])).toBe('no');
  });

  test('through the text form: every pair, a fact with no reading, and a guarded fact', () => {
    const w = makeWorld('SF-1');
    setFact(w, 'q112_done', 0, 0);
    setFact(w, 'q112_takemura_dead', 0, 0);
    advance(w, 5);
    const ev = (text: string): Verdict => evalPred(w.l2, { t: w.k.now }, parsePred(text));
    const atom: Record<Verdict, string> = { yes: 'yes', no: 'no', maybe: 'x == 1' };
    expect(ev('x == 1')).toBe('maybe');
    for (const a of V3) {
      for (const b of V3) {
        expect(ev(`${atom[a]} and ${atom[b]}`)).toBe(AND[`${a},${b}`]!);
        expect(ev(`${atom[a]} or ${atom[b]}`)).toBe(OR[`${a},${b}`]!);
      }
      expect(ev(`not ${atom[a]}`)).toBe(kNot(a));
    }
    // A fact whose guard is false reads maybe, though it has a reading of 0; not(fact = 1) is maybe too.
    expect(ev('q112_takemura_dead == 0')).toBe('maybe');
    expect(ev('not (q112_takemura_dead == 1)')).toBe('maybe');
    expect(ev('decided(q112_takemura_dead)')).toBe('no');
    setFact(w, 'q112_done', 1, 10);
    expect(ev('q112_takemura_dead == 0')).toBe('yes');
    expect(ev('decided(q112_takemura_dead)')).toBe('yes');
    // A fact is read at the time asked about (S0 section 6.3).
    expect(evalPred(w.l2, { t: 5 }, parsePred('q112_done == 0'))).toBe('yes');
    expect(evalPred(w.l2, { t: 11 }, parsePred('q112_done == 1'))).toBe('yes');
  });
});

describe('the text form prints to and parses from the tree one to one', () => {
  const samples: string[] = [
    'yes', 'no', 'a == 1', 'a != 1', 'a < 2 or b >= 3 and c <= 4', '(a == 1 or b == 1) and not c == 2', 'all()', 'any()', 'all(a == 1)', 'any(a == 1)',
    'not not a == 1', 'not (a == 1 and b == 1)', 'decided(q)', 'seedFact(rung) > 0', 'cast(takemura)', 'seed(xf.example:takemura-quiet-hour) in {resolved, withered}',
    'beat(offer-1) in {done, skipped}', 'response(offer-1) is {decline, action:stay}', 'hour in [22, 6)', 'since(beat offer-1) >= 1209600g',
    'since(state running) >= 30p', 'count({kind: shared-activity, participant: takemura}) >= 1', 'count({kind: shared-activity, participant: takemura}, beat offer-1) == 0',
    'clock(c) >= 2', 'exposed({event: {kind: robbery, participant: v}}, confirmed)', 'exposed({fragment: qh-offer-close, since: 3600g})',
    'cap(story.write-vanilla)', 'setting(content.dread) in {0, 1}', 'believes(takemura, v, loyal)', 'believes(takemura, v, age, is: {r: ivl, ivls: [[25, 35]]}, atLeast: 0.5)',
    'takemura.alive == 1', 'takemura.age >= 30', 'takemura.age <= 40', 'takemura.mood in {quiet, busy}', 'takemura.mood not in {busy}', 'takemura.age in range [30, 40]',
    'takemura.position == @place', 'takemura has-edge(core:member-of)', 'takemura.place has-edge(core:located-in, @place)', 'takemura.place lacks-edge(core:kin)',
    'city({band: {cell: x}}) in {hot}', 'social({tied: {a: x, b: y}}) in {friend}', 'rule@1(3, "two words")', 'rule@2(x, params: {n: 3}) reads [{fact: q112_done}]',
  ];
  for (const text of samples) {
    test(`parse, print, parse: ${text}`, () => {
      const a = parsePred(text);
      const printed = printPred(a);
      const b = parsePred(printed);
      expect(b).toEqual(a);
      expect(printPred(b)).toBe(printed);
    });
  }

  test('a != comparison of a role predicate parses as a negated equality', () => {
    expect(parsePred('takemura.age != 3')).toEqual({ not: { role: 'takemura', p: { path: 'age', op: 'eq', arg: 3 } } });
  });

  test('and binds tighter than or, and parentheses nest', () => {
    expect(parsePred('a == 1 or b == 1 and c == 1')).toEqual({ any: [{ fact: 'a', op: 'eq', value: 1 }, { all: [{ fact: 'b', op: 'eq', value: 1 }, { fact: 'c', op: 'eq', value: 1 }] }] });
    expect(parsePred('(a == 1 or b == 1) and c == 1')).toEqual({ all: [{ any: [{ fact: 'a', op: 'eq', value: 1 }, { fact: 'b', op: 'eq', value: 1 }] }, { fact: 'c', op: 'eq', value: 1 }] });
  });

  test('syntax errors are reported with their position, and a document names the predicate that failed', () => {
    for (const bad of ['a ==', 'a == 1 and', '(a == 1', 'seedFact(x)', 'hour in [1, 2', 'count({kind: x) >= 1', '@@', 'a == "unterminated']) {
      expect(() => parsePred(bad), bad).toThrow(PredSyntaxError);
    }
    const w = makeWorld('syntax');
    const pack = miniPack({}, { context: 'flag ==' } as never);
    w.l2.installPack(pack);
    const res = w.l2.compile(MINI_PACK, pack.seeds[0]!);
    expect(res.ok).toBe(false);
    expect(res.findings[0]!.code).toBe('syntax');
    expect(res.findings[0]!.message).toContain('context');
  });
});

describe('the atoms', () => {
  function world(): ReturnType<typeof makeWorld> & { inst: ReturnType<ReturnType<typeof makeWorld>['l2']['ofTemplate']>[number] } {
    const w = makeWorld('atoms');
    const npc = w.k.root('npc', 'core:person');
    w.k.addEdge({ type: 'core:located-in', from: npc, to: w.city, cause });
    w.k.pin({ node: npc, slot: 'age', value: 35, reason: 'authored', cause });
    setFact(w, 'x', 0, 0);
    setFact(w, 'flag', 1, 0);
    w.l2.installPack(miniPack());
    const inst = w.l2.instance(w.l2.sow(MINI_PACK, MINI_ID).instance!)!;
    settle(w);
    return Object.assign(w, { inst });
  }
  const ev = (w: ReturnType<typeof world>, text: string): Verdict => evalPred(w.l2, { inst: w.inst, t: w.k.now }, parsePred(text));

  test('role, cast, seed, beat, hour, since, setting and seedFact', () => {
    const w = world();
    expect(ev(w, 'cast(npc)')).toBe('yes');
    expect(ev(w, 'cast(ghost)')).toBe('no');
    expect(ev(w, 'npc.age >= 30')).toBe('yes');
    expect(ev(w, 'npc.age >= 40')).toBe('no');
    expect(ev(w, 'npc.age in range [30, 40]')).toBe('yes');
    expect(ev(w, 'ghost.age >= 30')).toBe('maybe');
    expect(ev(w, 'seed(xf.fixture:mini) in {cast}')).toBe('yes');
    expect(ev(w, `seed(${w.inst.id}) in {cast, offered}`)).toBe('yes');
    expect(ev(w, 'seed(xf.fixture:mini) in {resolved}')).toBe('no');
    expect(ev(w, 'beat(meet) in {available}')).toBe('yes');
    expect(ev(w, 'beat(finish) in {locked}')).toBe('yes');
    expect(ev(w, 'seedFact(stage) == 0')).toBe('yes');
    expect(ev(w, 'setting(content.dread) in {3}')).toBe('yes');
    expect(ev(w, 'setting(tempo) in {steady}')).toBe('yes');
    expect(ev(w, 'setting(noticing) in {acts}')).toBe('no');
    // hour: half-open, wrapping.
    const at = (t: number): Verdict => evalPred(w.l2, { inst: w.inst, t }, parsePred('hour in [22, 6)'));
    expect(at(23 * 3600)).toBe('yes');
    expect(at(5 * 3600 + 3599)).toBe('yes');
    expect(at(6 * 3600)).toBe('no');
    expect(at(12 * 3600)).toBe('no');
    expect(evalPred(w.l2, { inst: w.inst, t: 9 * 3600 }, parsePred('hour in [9, 10)'))).toBe('yes');
    // since: never entered is no; entered and long enough is yes.
    expect(ev(w, 'since(state running) >= 0g')).toBe('no');
    expect(ev(w, 'since(state sown) >= 0g')).toBe('yes');
    expect(ev(w, 'since(state sown) >= 9999999g')).toBe('no');
    expect(ev(w, 'since(beat meet) >= 0g')).toBe('no');
  });

  test('response, count and exposed, after an offer was displayed and answered', () => {
    const w = world();
    expect(ev(w, 'response(meet) is {action}')).toBe('no');
    playUntil(w, () => delivery(w.inst, 'meet') !== undefined);
    const d = delivery(w.inst, 'meet')!;
    expect(ev(w, 'exposed({delivery: ' + d.id + ', atLeast: presented})')).toBe('no');
    show(w, d, 'confirmed');
    expect(ev(w, 'exposed({delivery: ' + d.id + '})')).toBe('yes');
    expect(ev(w, 'exposed({seed: xf.fixture:mini})')).toBe('yes');
    expect(ev(w, 'exposed({fragment: f-meet})')).toBe('yes');
    expect(ev(w, 'exposed({fragment: f-finish})')).toBe('no');
    // An event V took part in is confirmed; one V only saw is presented.
    const a = w.k.events.mintEvent({ creator: w.v, cause: w.v, name: 'a', time: w.k.now, kind: 'robbery', participants: [{ who: w.v, role: 'victim' }], witnesses: [w.v] });
    const b = w.k.events.mintEvent({ creator: w.v, cause: w.v, name: 'b', time: w.k.now, kind: 'assault', participants: [{ who: w.k.root('someone', 'core:person'), role: 'actor' }], witnesses: [w.v] });
    w.k.events.makeCanon(a, 'observed', w.v);
    w.k.events.makeCanon(b, 'observed', w.v);
    expect(ev(w, 'exposed({event: {kind: robbery}})')).toBe('yes');
    expect(ev(w, 'exposed({event: {kind: assault}})')).toBe('no');
    expect(ev(w, 'exposed({event: {kind: assault}, atLeast: presented})')).toBe('yes');
    expect(ev(w, 'exposed({event: {kind: robbery, participant: v, role: victim}})')).toBe('yes');
    expect(ev(w, 'exposed({event: {kind: sale}})')).toBe('no');
    w.l2.respond(d.id, { kind: 'decline', id: 'no' });
    expect(ev(w, 'response(meet) is {decline}')).toBe('yes');
    expect(ev(w, 'response(meet) is {decline:no}')).toBe('yes');
    expect(ev(w, 'response(meet) is {decline:other}')).toBe('no');
    expect(ev(w, 'response(meet) is {action}')).toBe('no');
    expect(ev(w, 'response(finish) is {action}')).toBe('no');
  });

  test('believes reads the NPC\'s own view through knows, never world truth', () => {
    const w = world();
    const npc = w.inst.st.roles.npc!.cast!;
    expect(ev(w, 'believes(npc, v, age)')).toBe('maybe');
    w.k.beliefs.set({ believer: npc, subject: w.v, path: 'age', value: 30, confidence: 0.6, evidence: [cause], source: { by: 'observed', event: cause }, formed: 0, refreshed: 0, memorable: true });
    expect(ev(w, 'believes(npc, v, age)')).toBe('yes');
    expect(ev(w, 'believes(npc, v, age, is: {r: ivl, ivls: [[25, 35]]})')).toBe('yes');
    expect(ev(w, 'believes(npc, v, age, is: {r: ivl, ivls: [[40, 50]]})')).toBe('no');
    expect(ev(w, 'believes(npc, v, age, atLeast: 0.9)')).toBe('no');
    expect(ev(w, 'believes(npc, v, age, atLeast: 0.5)')).toBe('yes');
    // The world says V is some other age: the atom does not read it.
    w.k.pin({ node: w.v, slot: 'age', value: 70, reason: 'observed', cause });
    expect(ev(w, 'believes(npc, v, age, is: {r: ivl, ivls: [[25, 35]]})')).toBe('yes');
  });

  test('registered reads: a function with declared reads; a missing one is maybe', () => {
    const reg = new L2Registry();
    reg.registerPred({ name: 'quiet-hours', version: 1, eval: (args, ctx) => (ctx.now >= 100 && args[0] === 'night' ? 'yes' : 'no') });
    const w = makeWorld('fn', { l2: { reg } });
    expect(evalPred(w.l2, { t: 200 }, parsePred('quiet-hours@1(night)'))).toBe('yes');
    expect(evalPred(w.l2, { t: 50 }, parsePred('quiet-hours@1(night)'))).toBe('no');
    expect(evalPred(w.l2, { t: 50 }, parsePred('missing@1(night)'))).toBe('maybe');
    w.port.caps.set('story.x', 'yes');
    expect(evalPred(w.l2, { t: 0 }, parsePred('cap(story.x)'))).toBe('yes');
    expect(evalPred(w.l2, { t: 0 }, parsePred('cap(story.y)'))).toBe('maybe');
  });

  test('explanation: the value of every node, and for a maybe the missing reading or the undecided guard; it emits nothing', () => {
    const w = makeWorld('explain');
    setFact(w, 'q112_done', 0, 0);
    setFact(w, 'q112_takemura_dead', 0, 0);
    advance(w, 5);
    const rev = w.k.revision;
    const pending = w.k.pending.length;
    const e = w.l2.explain(undefined, parsePred('q112_takemura_dead == 0 and x == 1 and q115_point_of_no_return == 0'));
    expect(e.v).toBe('maybe');
    expect(e.kids!.map((k) => k.v)).toEqual(['maybe', 'maybe', 'maybe']);
    expect(e.kids![0]!.why).toContain('guard of q112_takemura_dead');
    expect(e.kids![0]!.kids![0]!.pred).toEqual(parsePred('q112_done == 1'));
    expect(e.kids![1]!.why).toContain('no game reading of x');
    expect(w.k.revision).toBe(rev);
    expect(w.k.pending).toHaveLength(pending);
    const no = w.l2.explain(undefined, parsePred('q112_done == 1 and x == 1'));
    expect(no.v).toBe('no');
    void (null as unknown as Pred);
    void firstOffer;
  });
});

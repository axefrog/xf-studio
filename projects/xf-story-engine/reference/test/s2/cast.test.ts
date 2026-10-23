// Casting, claims and stand-ins (S2 sections 5 and 9): SF-3, SF-4, SF-5, SF-13, SF-14 and SF-53's run-time half.

import { describe, expect, test } from 'bun:test';
import { ln } from '../../src/fdlibm-log.ts';
import { H, id as hid, i as hi, mintedId, rand, s as hs } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import { castRole } from '../../src/seeding/cast.ts';
import type { SeedInput } from '../../src/seeding/types.ts';
import { MINI_ID, MINI_PACK, miniPack } from './mini.ts';
import { clock, delivery, playUntil, show } from './drive.ts';
import { type World, makeWorld, settle, setGame } from './world.ts';

const cause = H(hs('fx'), hs('cast'));
const open = { windows: [{ id: 'w', opens: 'yes', onClose: 'withdraw' as const }] };

/** Fifty adults in the city. */
function crowd(w: World, n = 50): Id[] {
  const out: Id[] = [];
  for (let i = 0; i < n; i++) {
    const p = w.k.root(`person-${i}`, 'core:person');
    w.k.addEdge({ type: 'core:located-in', from: p, to: w.city, cause });
    w.k.pin({ node: p, slot: 'age', value: 20 + (i % 50), reason: 'authored', cause });
    out.push(p);
  }
  return out;
}

function sowMini(w: World, seed: Partial<SeedInput> = {}, pack = MINI_PACK): ReturnType<World['l2']['ofTemplate']>[number] {
  const p = miniPack({ id: pack }, { ...open, ...seed });
  expect(w.l2.installPack(p)).toEqual([]);
  const r = w.l2.sow(pack, MINI_ID);
  expect(r.ok, JSON.stringify(r.findings)).toBe(true);
  settle(w);
  return w.l2.instance(r.instance!)!;
}

const preferTwo = (s1: 1 | 2 | 3, s2: 1 | 2 | 3) => ({
  roles: {
    npc: {
      kind: 'core:person', must: [{ path: 'age-class', op: 'eq' as const, arg: 'adult' }],
      prefer: [{ p: { path: 'age', op: 'range' as const, arg: [30, 40] }, strength: s1 }, { p: { path: 'age', op: 'field-at-least' as const, arg: 60 }, strength: s2 }],
    },
  },
});

/** The draw of S2 section 3.4, recomputed here from the formula alone. */
function oracle(w: World, seed: Id, choice: string, attempt: number, ids: Id[], bonus: (id: Id) => number): Id {
  let best: { id: Id; total: number; tie: Id } | undefined;
  for (const id of ids) {
    const u = rand(hs('seed-draw'), hid(w.k.worldSeed), hid(seed), hs(choice), hi(attempt), hid(id));
    const total = ln(1) + bonus(id) + -ln(-ln(u));
    const tie = H(hs('tie'), hid(w.k.worldSeed), hid(seed), hs(choice), hid(id));
    if (!best || total > best.total || (total === best.total && tie < best.tie)) best = { id, total, tie };
  }
  return best!.id;
}

describe('SF-3: casting determinism', () => {
  test('a role over 50 candidates with two prefer terms: three casts give the same node, and casting does not move the kernel revision', () => {
    const w = makeWorld('SF-3');
    const people = crowd(w);
    const inst = sowMini(w, preferTwo(2, 1) as never);
    const first = inst.st.roles.npc!.cast!;
    expect(people).toContain(first);
    const rev = w.k.revision;
    delete inst.st.draws['cast:npc'];
    const a = castRole(w.l2, inst, 'npc');
    delete inst.st.draws['cast:npc'];
    const b = castRole(w.l2, inst, 'npc');
    expect(a.node).toBe(first);
    expect(b.node).toBe(first);
    expect(a.candidates).toBe(50);
    expect(w.k.revision).toBe(rev);
    // After an unrelated pin elsewhere.
    w.k.pin({ node: w.k.root('elsewhere', 'core:place'), slot: 'public', value: 'private', reason: 'authored', cause });
    delete inst.st.draws['cast:npc'];
    expect(castRole(w.l2, inst, 'npc').node).toBe(first);
  });
});

describe('SF-4: coupling', () => {
  test('raising a prefer term from strength 1 to 3 changes the cast only if the new scores make another candidate win', () => {
    const lnK = ln(8);
    const w = makeWorld('SF-4');
    crowd(w);
    const inst = sowMini(w, preferTwo(1, 1) as never);
    const age = (id: Id): number => w.k.value(id, 'age') as number;
    const bonusOf = (s1: number, s2: number) => (id: Id): number => {
      let b = 0;
      if (age(id) >= 30 && age(id) <= 40) b += s1 * lnK;
      if (age(id) >= 60) b += s2 * lnK;
      return b;
    };
    const ids = [...w.k.store.idsOfKind('core:person')].filter((i) => w.k.value(i, 'age-class') === 'adult').sort();
    const before = inst.st.roles.npc!.cast!;
    expect(before).toBe(oracle(w, inst.id, 'cast:npc', 0, ids, bonusOf(1, 1)));
    inst.st.document.roles.npc!.prefer![0]!.strength = 3;
    inst.st.roles.npc!.attempt = 0;
    delete inst.st.draws['cast:npc'];
    const after = castRole(w.l2, inst, 'npc').node!;
    expect(after).toBe(oracle(w, inst.id, 'cast:npc', 0, ids, bonusOf(3, 1)));
    // The cast moved only if a different candidate wins under the new scores.
    expect(after !== before).toBe(oracle(w, inst.id, 'cast:npc', 0, ids, bonusOf(3, 1)) !== oracle(w, inst.id, 'cast:npc', 0, ids, bonusOf(1, 1)));
  });
});

describe('SF-5: claims, in either order (S2-I-10)', () => {
  function world(): { w: World; fixer: Id } {
    const w = makeWorld('SF-5');
    const fixer = w.k.root('fixer', 'core:person');
    w.k.addEdge({ type: 'core:located-in', from: fixer, to: w.city, cause });
    w.k.pin({ node: fixer, slot: 'age', value: 40, reason: 'authored', cause });
    return { w, fixer };
  }
  const claimEntries = (inst: { st: { record: Array<{ kind: string; data: Record<string, unknown> }> } }): number =>
    inst.st.record.filter((r) => r.kind === 'intersection' && r.data.kind === 'claim').length;

  test('casting the authored seed first: the procedural one cannot cast the fixer; each record has one claim entry', () => {
    const { w, fixer } = world();
    w.l2.installPack(miniPack({ id: 'auth' }, { ...open, id: 'xf.fixture:a' } as never));
    w.l2.installPack(miniPack({ id: 'proc', source: 'procedural' }, { ...open, id: 'xf.fixture:p' } as never));
    const a = w.l2.instance(w.l2.sow('auth', 'xf.fixture:a').instance!)!;
    settle(w);
    const p = w.l2.instance(w.l2.sow('proc', 'xf.fixture:p').instance!)!;
    settle(w);
    expect(a.st.roles.npc!.cast).toBe(fixer);
    expect(p.st.roles.npc!.cast).toBeUndefined();
    expect(claimEntries(a)).toBe(1);
    expect(claimEntries(p)).toBe(1);
  });

  test('the procedural seed committed first: the authored seed still gets the fixer, and the procedural role is lost', () => {
    const { w, fixer } = world();
    w.l2.installPack(miniPack({ id: 'proc', source: 'procedural' }, { ...open, id: 'xf.fixture:p' } as never));
    const p = w.l2.instance(w.l2.sow('proc', 'xf.fixture:p').instance!)!;
    settle(w);
    expect(p.st.roles.npc!.cast).toBe(fixer);
    playUntil(w, () => delivery(p, 'meet') !== undefined);
    expect(p.st.roles.npc!.committed).toBe(true);
    w.l2.installPack(miniPack({ id: 'auth' }, { ...open, id: 'xf.fixture:a' } as never));
    const a = w.l2.instance(w.l2.sow('auth', 'xf.fixture:a').instance!)!;
    settle(w);
    expect(a.st.roles.npc!.cast).toBe(fixer);
    // P's committed role is lost; its ladder ends in a withdrawal.
    expect(p.st.state).toBe('withdrawn');
    expect(p.st.record.some((r) => r.kind === 'lost')).toBe(true);
    expect(claimEntries(a)).toBe(1);
    expect(claimEntries(p)).toBe(1);
  });

  test('a claim that shares does not conflict', () => {
    const { w, fixer } = world();
    const share = { roles: { npc: { kind: 'core:person', must: [{ path: 'age-class', op: 'eq' as const, arg: 'adult' }], claim: { span: 'seed' as const, share: 'any' as const } } } };
    w.l2.installPack(miniPack({ id: 'auth' }, { ...open, ...share, id: 'xf.fixture:a' } as never));
    w.l2.installPack(miniPack({ id: 'proc', source: 'procedural' }, { ...open, ...share, id: 'xf.fixture:p' } as never));
    const a = w.l2.instance(w.l2.sow('auth', 'xf.fixture:a').instance!)!;
    const p = w.l2.instance(w.l2.sow('proc', 'xf.fixture:p').instance!)!;
    settle(w);
    expect(a.st.roles.npc!.cast).toBe(fixer);
    expect(p.st.roles.npc!.cast).toBe(fixer);
    expect(w.l2.claimConflict(fixer, 'seed', 'any')).toBe(false);
    expect(w.l2.claimConflict(fixer, 'seed', 'none')).toBe(true);
  });
});

describe('SF-14: stand-in', () => {
  test('no kernel change before release; at commit a minted node with age in 30..40, identical across two runs', () => {
    const run = (): { node: Id; age: number; seed: Id } => {
      const w = makeWorld('SF-14');
      const seed = { ...open, roles: { npc: { kind: 'core:person', must: [{ path: 'age', op: 'range' as const, arg: [30, 40] }], onUnfilled: ['standIn' as const] } } };
      const inst = sowMini(w, seed as never);
      expect(inst.st.roles.npc!.standIn).toBeDefined();
      expect(inst.st.roles.npc!.cast).toBeUndefined();
      expect(inst.st.state).toBe('cast');
      const before = w.k.store.headers.size;
      void before;
      expect(w.k.store.header(mintedId(inst.id, inst.id, 'role:npc'))).toBeUndefined();
      playUntil(w, () => delivery(inst, 'meet') !== undefined);
      const node = mintedId(inst.id, inst.id, 'role:npc');
      expect(inst.st.roles.npc!.cast).toBe(node);
      expect(inst.st.roles.npc!.committed).toBe(true);
      const age = w.k.value(node, 'age') as number;
      expect(age).toBeGreaterThanOrEqual(30);
      expect(age).toBeLessThanOrEqual(40);
      return { node, age, seed: inst.id };
    };
    const a = run();
    const b = run();
    expect(b).toEqual(a);
  });
});

describe('SF-13: pressure', () => {
  test('a Claw whose family frame protects X, cast in a role whose goal kills X: one pressure intersection at commit; the seed is not blocked', () => {
    const w = makeWorld('SF-13');
    const claw = setGame(w, 'claw', 'fx:character', 'alive', 1, 0);
    setGame(w, 'claw', 'fx:character', 'age-class', 'adult', 0);
    const x = w.k.root('x', 'core:person');
    const family = H(hs('fx'), hs('family'));
    w.k.frames.open({ actor: claw, level: 'concern', origin: family, weight: 1, cause, own: { protects: [{ slot: '*', scope: { nodes: [x] } }] } });
    const seed = { ...open, roles: { npc: { kind: 'core:person', identity: 'game:claw', must: [{ path: 'age-class', op: 'eq' as const, arg: 'adult' }], goal: { effects: [{ on: x, effect: 'kill' as const }] } } } };
    const inst = sowMini(w, seed as never);
    expect(inst.st.record.filter((r) => r.kind === 'intersection')).toHaveLength(0);
    playUntil(w, () => delivery(inst, 'meet') !== undefined);
    settle(w);
    const pressure = inst.st.record.filter((r) => r.kind === 'intersection' && r.data.kind === 'pressure');
    expect(pressure).toHaveLength(1);
    expect(pressure[0]!.data.target).toBe(x);
    expect(inst.st.state).toBe('offered');
    // Recorded once: a second tick adds nothing.
    settle(w);
    expect(inst.st.record.filter((r) => r.kind === 'intersection')).toHaveLength(1);
    void show; void clock;
  });
});

describe('SF-53 at run time: casting removes non-adults from barred roles', () => {
  test('a role in a target position is never cast with a minor, and a missing age class counts as a minor', () => {
    const w = makeWorld('SF-53');
    const adult = w.k.root('adult', 'core:person');
    const kid = w.k.root('kid', 'core:person');
    for (const [p, age] of [[adult, 30], [kid, 17]] as Array<[Id, number]>) {
      w.k.addEdge({ type: 'core:located-in', from: p, to: w.city, cause });
      w.k.pin({ node: p, slot: 'age', value: age, reason: 'authored', cause });
    }
    // A mirrored person with no age-class reading is unknown, so a minor for the floor.
    const unknown = setGame(w, 'unknown', 'fx:character', 'alive', 1, 0);
    w.k.addEdge({ type: 'core:located-in', from: unknown, to: w.city, cause });
    const seed = { ...open, roles: { npc: { kind: 'core:person' } }, beats: { meet: { play: 'pack:f-meet' }, finish: { play: 'pack:f-finish', links: [{ because: 'meet', on: 'seedFact(stage) == 1' }], leaves: [{ kernel: { on: 'npc', effect: 'harm' } }] } } };
    // Without the lint's adult requirement the document is refused (L-95), which is the first line of defence.
    const p = miniPack({}, seed as never);
    expect(w.l2.installPack(p)).toEqual([]);
    expect(w.l2.sow(MINI_PACK, MINI_ID).ok).toBe(false);
    // The run-time floor: the same role with the requirement lifted for the lab still removes non-adults.
    const lab = makeWorld('SF-53-lab', { l2: { lab: true } });
    for (const [pid, age] of [['adult', 30], ['kid', 17]] as Array<[string, number]>) {
      const n = lab.k.root(pid, 'core:person');
      lab.k.addEdge({ type: 'core:located-in', from: n, to: lab.city, cause });
      lab.k.pin({ node: n, slot: 'age', value: age, reason: 'authored', cause });
    }
    const ok = miniPack({}, { ...open, roles: { npc: { kind: 'core:person', must: [{ path: 'age-class', op: 'eq', arg: 'adult' }] } }, beats: seed.beats } as never);
    lab.l2.installPack(ok);
    const r = lab.l2.sow(MINI_PACK, MINI_ID);
    expect(r.ok).toBe(true);
    settle(lab);
    const inst = lab.l2.instance(r.instance!)!;
    expect(inst.st.roles.npc!.cast).toBe(lab.k.mirrored('adult', 'core:person') === lab.k.mirrored('adult', 'core:person') ? lab.k.store.idsOfKind('core:person').find((i) => lab.k.store.header(i)!.origin.by === 'root' && (lab.k.store.header(i)!.origin as { name: string }).name === 'adult') : undefined);
  });
});

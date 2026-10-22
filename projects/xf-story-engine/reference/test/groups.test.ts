import { describe, expect, test } from 'bun:test';
import { H, s } from '../src/id.ts';
import type { Kernel } from '../src/kernel.ts';
import type { Id } from '../src/types.ts';
import { coreKernel } from './helpers.ts';

const cause = H(s('test-cause'));
const fid = (name: string): Id => H(s('origin'), s(name));

/** A group G with leader L, a member M, and a victim-to-be X. */
function crew(name: string) {
  const k = coreKernel(name);
  const G = k.root('G', 'core:group');
  const L = k.root('L', 'core:person');
  const M = k.root('M', 'core:person');
  const X = k.root('X', 'core:person');
  k.addEdge({ type: 'core:member-of', from: L, to: G, attrs: { role: 'leader', strength: 1 }, cause });
  k.addEdge({ type: 'core:member-of', from: M, to: G, attrs: { role: 'member', strength: 0.75 }, cause });
  return { k, G, L, M, X };
}

describe('F-8 cross-pressure (spec 10.8)', () => {
  function scenario(name: string, effect: 'kill' | 'rescue') {
    const w = crew(name);
    const { k, G, L, M, X } = w;
    const family = k.frames.open({
      actor: M, level: 'drive', origin: fid('M-family-drive'), payload: { drive: 'family' }, weight: 0.8,
      own: { protects: [{ slot: '*', scope: { nodes: [X] } }] }, cause,
    });
    const groupGoal = k.groups.decide(L, G, {
      op: 'open',
      spec: { level: 'goal', origin: fid('G-goal'), payload: { goal: { effects: [] } }, weight: 1 },
    });
    const order = k.groups.issueOrder({ groupFrame: groupGoal.id, member: M, goal: { effects: [{ on: X, effect }] }, pressure: 0.5, cause: L });
    k.settle();
    return { ...w, family, groupGoal, order, dilemmas: k.frames.drainDilemmas() };
  }

  test('F-8: an order to kill the protected target gives one Dilemma', () => {
    const w = scenario('F-8a', 'kill');
    expect(w.dilemmas).toHaveLength(1);
    const d = w.dilemmas[0]!;
    expect(d).toMatchObject({ actor: w.M, frameA: w.order.id, frameB: w.family.id, target: w.X, effect: 'kill', cause: w.order.id });
    expect(d.severity).toBeCloseTo(w.k.frames.pull(w.order.id) * w.k.frames.pull(w.family.id), 12);
    expect(w.order.origin).toBe(w.groupGoal.id);
    expect(w.order.parents).toEqual([{ frame: w.groupGoal.id, weight: 0.5 }]);
  });

  test('F-8: an order to rescue gives none', () => {
    const w = scenario('F-8b', 'rescue');
    expect(w.dilemmas).toHaveLength(0);
  });

  test('a Dilemma is emitted once per (A, B, target, effect) until either frame changes', () => {
    const w = scenario('F-8c', 'kill');
    expect(w.dilemmas).toHaveLength(1);
    // Re-checking changes nothing.
    w.k.frames.worklist.push({ t: 'dilemma', frame: w.order.id });
    w.k.frames.worklist.push({ t: 'dilemma-actor', actor: w.M });
    w.k.settle();
    expect(w.k.frames.drainDilemmas()).toHaveLength(0);
    // A membership change triggers a check; nothing new.
    const edge = w.k.groups.memberships(w.M)[0]!;
    w.k.updateEdge(edge.id, { data: { obligations: [] } });
    w.k.settle();
    expect(w.k.frames.drainDilemmas()).toHaveLength(0);
    // Either frame changes: the pair is checked again and emitted once more. A change of B's interests
    // rechecks the actor's existing goals, so the unchanged order frame is checked too (SR-10).
    w.k.frames.setInterests(w.family.id, { protects: [{ slot: '*', scope: { nodes: [w.X] } }, { slot: '*', scope: { nodes: [w.L] } }] }, cause);
    w.k.settle();
    expect(w.k.frames.drainDilemmas()).toHaveLength(1);
    w.k.frames.setInterests(w.order.id, {}, cause);
    w.k.settle();
    expect(w.k.frames.drainDilemmas()).toHaveLength(1);
    // And once the pair has been emitted for the frames as they now are, nothing changes it.
    w.k.settle();
    expect(w.k.frames.drainDilemmas()).toHaveLength(0);
  });

  test('frames of the same origin are never in dilemma with each other', () => {
    const { k, M, X } = crew('F-8d');
    const drive = k.frames.open({ actor: M, level: 'drive', origin: fid('o'), weight: 1, own: { protects: [{ slot: '*', scope: { nodes: [X] } }] }, cause });
    k.frames.open({ actor: M, level: 'goal', origin: drive.origin, weight: 1, payload: { goal: { effects: [{ on: X, effect: 'harm' }] } }, cause });
    k.settle();
    expect(k.frames.drainDilemmas()).toHaveLength(0);
  });

  test('a wants interest is violated by take or conceal, and an inherited interest counts', () => {
    const { k, M, X } = crew('F-8e');
    const parent = k.frames.open({ actor: M, level: 'drive', origin: fid('p'), weight: 1, own: { wants: [{ slot: '*', scope: { nodes: [X] } }] }, cause });
    const child = k.frames.open({ actor: M, level: 'step', origin: fid('c'), weight: 1, parents: [{ frame: parent.id, weight: 1 }], cause });
    k.frames.open({ actor: M, level: 'goal', origin: fid('g'), weight: 1, payload: { goal: { effects: [{ on: X, effect: 'take' }, { on: X, effect: 'help' }] } }, cause });
    k.settle();
    const ds = k.frames.drainDilemmas();
    expect(ds.map((d) => [d.frameB, d.effect]).sort()).toEqual([[parent.id, 'take'], [child.id, 'take']].sort());
  });
});

describe('F-11 leadership (spec 10.3, 12)', () => {
  test('F-11: a leader who is also a member causes no frame cycle; the group changes only by decision', () => {
    const { k, G, L, M } = crew('F-11');
    const concern = k.groups.decide(L, G, {
      op: 'open', spec: { level: 'concern', origin: fid('G-honour'), payload: { drive: 'honour' }, weight: 0.9 },
    });
    expect(concern.cause).toBe(L);
    const lFrame = k.frames.open({ actor: L, level: 'drive', origin: fid('L-honour'), payload: { drive: 'honour' }, weight: 0.7, cause });
    const mFrame = k.frames.open({ actor: M, level: 'drive', origin: fid('M-honour'), payload: { drive: 'honour' }, weight: 0.5, cause });
    k.settle();
    // Honour belongs to the justice family: both members' frames inherit the concern, at the edge weight of their strength.
    expect(k.frames.frame(lFrame.id)!.parents).toEqual([{ frame: concern.id, weight: 1, via: 'membership' }]);
    expect(k.frames.frame(mFrame.id)!.parents).toEqual([{ frame: concern.id, weight: 0.75, via: 'membership' }]);
    expect(k.frames.pull(mFrame.id)).toBeCloseTo(0.5 * 0.75 * 0.9, 12);
    // The frame graph is acyclic.
    for (const f of k.frames.all()) {
      for (const p of f.parents) expect(k.frames.isAncestorOrSelf(f.id, p.frame)).toBe(false);
    }
    // Direct changes to the group's concerns and goals are refused.
    expect(() => k.frames.open({ actor: G, level: 'concern', origin: fid('x'), weight: 1, cause })).toThrow();
    expect(() => k.frames.setWeight(concern.id, 0.1, M)).toThrow();
    expect(() => k.frames.setStatus(concern.id, 'abandoned', M)).toThrow();
    expect(() => k.frames.setParents(concern.id, [{ frame: lFrame.id, weight: 1 }], L)).toThrow();
    // A non-leader cannot decide; a leader can, and is the recorded cause.
    expect(() => k.groups.decide(M, G, { op: 'weight', frame: concern.id, weight: 0.1 })).toThrow();
    const changed = k.groups.decide(L, G, { op: 'weight', frame: concern.id, weight: 0.4 });
    expect(changed.weight).toBe(0.4);
    expect(changed.cause).toBe(L);
    expect(k.groups.decisionLog.map((d) => [d.leader, d.group, d.decision.op])).toEqual([[L, G, 'open'], [L, G, 'weight']]);
    k.settle();
    expect(k.frames.pull(lFrame.id)).toBeCloseTo(0.7 * 1 * 0.4, 12);
    // Ending the concern removes the inherited parent links.
    k.groups.decide(L, G, { op: 'status', frame: concern.id, status: 'satisfied' });
    k.settle();
    expect(k.frames.frame(lFrame.id)!.parents).toEqual([]);
  });

  test('a cycle is refused (I-14)', () => {
    const { k, M } = crew('cycle');
    const a = k.frames.open({ actor: M, level: 'concern', origin: fid('a'), weight: 1, cause });
    const b = k.frames.open({ actor: M, level: 'goal', origin: fid('b'), weight: 1, parents: [{ frame: a.id, weight: 1 }], cause });
    expect(() => k.frames.setParents(a.id, [{ frame: b.id, weight: 1 }], cause)).toThrow();
    expect(() => k.frames.setParents(a.id, [{ frame: a.id, weight: 1 }], cause)).toThrow();
    expect(k.frames.frame(a.id)!.parents).toEqual([]);
  });

  test('weak memberships do not inherit; concerns without a family attach to the situation frame', () => {
    const { k, G, L, M } = crew('inherit');
    const weak = k.root('W', 'core:person');
    k.addEdge({ type: 'core:member-of', from: weak, to: G, attrs: { role: 'associate', strength: 0.125 }, cause });
    const famless = k.groups.decide(L, G, { op: 'open', spec: { level: 'concern', origin: fid('G-general'), weight: 0.6 } });
    const wDrive = k.frames.open({ actor: weak, level: 'drive', origin: fid('w'), payload: { drive: 'honour' }, weight: 0.5, cause });
    const mSit = k.frames.open({ actor: M, level: 'situation', origin: fid('m-sit'), weight: 1, cause });
    const mDrive = k.frames.open({ actor: M, level: 'drive', origin: fid('m-d'), payload: { drive: 'honour' }, weight: 1, cause });
    k.settle();
    expect(k.frames.frame(wDrive.id)!.parents).toEqual([]);
    expect(k.frames.frame(mSit.id)!.parents).toEqual([{ frame: famless.id, weight: 0.75, via: 'membership' }]);
    expect(k.frames.frame(mDrive.id)!.parents).toEqual([]);
    // Ending the membership removes the link.
    const edge = k.groups.memberships(M)[0]!;
    k.endEdge(edge.id, 10);
    k.now = 10;
    k.settle();
    expect(k.frames.frame(mSit.id)!.parents).toEqual([]);
  });

  test('orders need membership and an active group goal', () => {
    const { k, G, L, X } = crew('orders');
    const outsider = k.root('O', 'core:person');
    const gg = k.groups.decide(L, G, { op: 'open', spec: { level: 'goal', origin: fid('gg'), weight: 1 } });
    expect(() => k.groups.issueOrder({ groupFrame: gg.id, member: outsider, goal: { effects: [{ on: X, effect: 'help' }] }, pressure: 0.5, cause: L })).toThrow();
    k.groups.decide(L, G, { op: 'status', frame: gg.id, status: 'abandoned' });
    expect(() => k.groups.issueOrder({ groupFrame: gg.id, member: L, goal: { effects: [] }, pressure: 0.5, cause: L })).toThrow();
  });
});

describe('demand tiers and claims (spec 10.6)', () => {
  test('a node\'s demand tier is the highest focus tier of eligible frames on it or its owner chain; claims weigh pull x w_actor', () => {
    const k = coreKernel('demand');
    const v = k.root('v', 'core:person');
    const npc = k.root('npc', 'core:person');
    k.frames.demandRoots.add(v);
    const name = k.address(npc, 'name');
    const f1 = k.frames.open({ actor: v, level: 'situation', origin: fid('1'), weight: 0.5, focus: { nodes: [npc], tier: 3 }, cause });
    k.frames.open({ actor: npc, level: 'situation', origin: fid('2'), weight: 0.5, focus: { nodes: [npc], tier: 4 }, cause });
    k.settle();
    expect(k.frames.demandTier(npc)).toBe(4);
    expect(k.frames.demandTier(name)).toBe(4); // the owner chain
    expect(k.frames.demandTier(v)).toBe(-1);
    expect(k.frames.claim(npc)).toBeCloseTo(0.5 * 4 + 0.5 * 1, 12);
    expect(k.frames.shouldOpen(name, 3)).toBe(true);
    expect(k.frames.shouldOpen(v, 0)).toBe(false);
    k.frames.setStatus(f1.id, 'blocked', cause);
    expect(k.frames.claim(npc)).toBeCloseTo(2.5, 12); // blocked frames still claim
    k.frames.setStatus(f1.id, 'satisfied', cause);
    expect(k.frames.claim(npc)).toBeCloseTo(0.5, 12);
    expect(k.frames.maxDemandTier()).toBe(4);
  });

  test('the frame worklist recomputes pull for a frame and its descendants, parents first', () => {
    const k = coreKernel('worklist');
    const a = k.root('a', 'core:person');
    const top = k.frames.open({ actor: a, level: 'drive', origin: fid('t'), weight: 1, cause });
    const mid = k.frames.open({ actor: a, level: 'goal', origin: fid('m'), weight: 0.5, parents: [{ frame: top.id, weight: 1 }], cause });
    const low = k.frames.open({ actor: a, level: 'step', origin: fid('l'), weight: 0.5, parents: [{ frame: mid.id, weight: 1 }], cause });
    k.settle();
    expect(k.frames.cachedPull.get(low.id)).toBe(0.25);
    k.frames.setWeight(top.id, 0.5, cause);
    expect(k.frames.worklist.snapshot().filter((w) => w.t === 'pull')).toHaveLength(3);
    k.settle();
    expect(k.frames.cachedPull.get(low.id)).toBe(0.125);
    for (const f of k.frames.all()) expect(k.frames.cachedPull.get(f.id)).toBe(k.frames.pull(f.id));
  });
});

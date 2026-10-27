import { expect, test } from 'bun:test';
import * as wording from '../../src/wording/index.ts';
import { HolotableObserver } from '../../src/holotable/observe.ts';
import { quietSim } from '../sim/helpers.ts';
import { ReplayPort } from '../../src/sim/port.ts';
import { ownedId } from '../../src/id.ts';
import type { Belief } from '../../src/beliefs.ts';
import type { EventView, PoolEntry } from '../../src/procedural/types.ts';
import type { Layer3 } from '../../src/procedural/layer3.ts';
import type { Juncture } from '../../src/seeding/pattern-types.ts';
import type { TieKind } from '../../src/sim/ties.ts';
import { EFFECTS } from '../../src/types.ts';

const names = wording.names(new Map([['mara', 'Mara'], ['jun', 'Jun']]), 'v');
const event = (kind = 'theft'): EventView => ({ id: 'incident', kind, time: 60, creator: 'v', cause: 'v', name: 'incident', participants: [{ who: 'v', role: 'actor' }, { who: 'mara', role: 'victim' }], effects: [], witnesses: [], causes: [] });
const belief = (path: string, value?: Belief['value'], region?: Belief['region']): Belief => ({ id: 'claim', believer: 'jun', subject: 'v', path, value, region, evidence: ['incident'], formed: 60, refreshed: 60, memorable: true, confidence: 1, source: { by: 'observed', event: 'incident' } });
const people = (observer: HolotableObserver) => [...observer.sample().layers].filter(([key]) => key === 'people' || key.startsWith('people-')).flatMap(([, items]) => items);

test('replay death participants identify the victim, never the killer; missing victim is neutral', () => {
  const sim = quietSim('review-death', undefined, []), port = new ReplayPort(sim);
  port.submit([{ t: 1, op: 'event', kind: 'game.death', participants: [{ who: 'v', role: 'actor' }, { who: 'mara', role: 'victim' }] }]);
  sim.advance(1);
  const item = new HolotableObserver(sim).sample().layers.get('events')!.find((i) => i.glyph === 'death')!;
  // The mirrored actor has no recorded name, but it is the deceased actor.
  expect(item.label).toBe('Someone nearby died');
  expect(item.label).not.toBe('You died');
  expect(wording.event(event('game.death'), names)).toBe('Mara died');
  expect(wording.event({ ...event('game.death'), participants: [{ who: 'v', role: 'victim' }, { who: 'mara', role: 'actor' }] }, names)).toBe('You died');
  expect(wording.event({ ...event('game.death'), participants: [{ who: 'v', role: 'actor' }] }, names)).toBe('Someone died');
});

test('cold population estimates do not materialise or change on ordinary reads', () => {
  const sim = quietSim('review-cold', undefined, []), observer = new HolotableObserver(sim);
  const expected = sim.people.populationSnapshot(), before = sim.k.store.headers.size;
  const cold = people(observer);
  expect(sim.k.store.headers.size).toBe(before);
  for (const [cell, population] of expected) if (population) expect(cold.find((i) => i.id === `crowd-${cell}`)?.label).toBe(`About ${population} people in the background`);
  const cell = sim.w.districts[0].cellIds[0], person = sim.k.address(sim.k.address(cell, 'households[0]'), 'm0');
  sim.k.value(person, 'age'); // a cache-only detailed read is not a durable opening
  expect(people(observer)).toEqual(cold);
});

test('name headers and frame evidence stay opened across replacement loads; detailed pins alone do not', () => {
  const sim = quietSim('review-replacement', undefined, []), cell = sim.w.districts[0].cellIds[0];
  const hh = sim.k.address(cell, 'households[0]'), a = sim.k.address(hh, 'm0');
  const b = sim.k.address(sim.k.address(cell, 'households[1]'), 'm0');
  const c = sim.k.address(sim.k.address(cell, 'households[2]'), 'm0');
  sim.k.value(sim.k.address(a, 'name'), 'display');
  sim.k.observeAs(sim.w.v, b, 'age', 0);
  const ended = sim.k.frames.open({ actor: c, origin: c, cause: sim.w.v, level: 'goal', status: 'satisfied', weight: 1, retain: true });
  // A retained pin references the ended frame, so it is a persisted record.
  sim.k.pin({ node: b, slot: 'boundary', value: 'keep', reason: 'authored', cause: ended.id });
  sim.k.retention.streamIn([a, b, ownedId(a, 'name')]);
  const expected = sim.people.populationSnapshot().get(cell)!;
  const check = () => {
    const rows = people(new HolotableObserver(sim));
    expect(rows.some((i) => i.id === a && i.kind === 'actor')).toBe(true);
    expect(rows.some((i) => i.id === b && i.kind === 'actor')).toBe(false);
    expect(rows.some((i) => i.id === c && i.kind === 'actor')).toBe(true);
    expect(rows.find((i) => i.id === `crowd-${cell}`)?.label).toBe(`About ${Math.max(0, expected - 2)} people in the background`);
  };
  check(); sim.k.persistence.save('opened'); sim.k.persistence.load('opened'); check();
});

test('withdrawn pins cannot open a retained unnamed resident, including previously saved history', () => {
  for (const savedBeforeWithdrawal of [false, true]) {
    const sim = quietSim(`review-withdrawn-${savedBeforeWithdrawal}`, undefined, []), k = sim.k, cell = sim.w.districts[0].cellIds[0];
    const person = k.address(k.address(cell, 'households[0]'), 'm0');
    k.retention.streamIn([person]);
    const pin = k.pin({ node: person, slot: 'age', value: 30, reason: 'authored', cause: sim.w.v });
    if (savedBeforeWithdrawal) k.persistence.save('before-withdrawal');
    k.withdrawPin(pin.id, sim.w.v);
    const check = () => {
      const rows = people(new HolotableObserver(sim));
      expect(rows.some((i) => i.id === person)).toBe(false);
      const expected = sim.people.populationSnapshot().get(cell)!;
      expect(rows.find((i) => i.id === `crowd-${cell}`)?.label).toBe(`About ${expected} people in the background`);
    };
    check(); k.persistence.save('after-withdrawal'); k.persistence.load('after-withdrawal'); check();
    expect(k.store.pinsOfNode(person).some((p) => p.id === pin.id)).toBe(savedBeforeWithdrawal);
  }
});

test('a detailed game pin kept by an authored dependency changes no people or crowds on save/load', () => {
  const sim = quietSim('review-game-pin-dependency', undefined, []), k = sim.k, cell = sim.w.districts[0].cellIds[0];
  const person = k.address(k.address(cell, 'households[0]'), 'm0');
  k.retention.streamIn([person]);
  const game = k.pin({ node: person, slot: 'age', value: 30, reason: 'game', cause: sim.w.v });
  k.pin({ node: person, slot: 'boundary', value: 'keep', reason: 'authored', cause: sim.w.v, evidence: game.id });
  const snapshot = () => {
    const before = JSON.stringify(k.store.capture(), (_, value) => value instanceof Map ? [...value] : value instanceof Set ? [...value] : value);
    const rows = people(new HolotableObserver(sim));
    expect(JSON.stringify(k.store.capture(), (_, value) => value instanceof Map ? [...value] : value instanceof Set ? [...value] : value)).toBe(before);
    expect(rows.some((i) => i.id === person)).toBe(false);
    expect(rows.find((i) => i.id === `crowd-${cell}`)?.label).toBe(`About ${sim.people.populationSnapshot().get(cell)} people in the background`);
    return rows.map(({ id, kind, label, facets }) => ({ id, kind, label, facets }));
  };
  const before = snapshot();
  k.persistence.save('game-pin-dependency');
  expect(snapshot()).toEqual(before);
  k.persistence.load('game-pin-dependency');
  expect(k.store.pinsOfNode(person).some((p) => p.id === game.id)).toBe(true);
  expect(snapshot()).toEqual(before);
});

test('beliefs cover actual effect, news, cause, reason, grievance and mirrored alive vocabularies', () => {
  const events = new Map([['incident', event()], ['news', { ...event('threat'), id: 'news' }]]);
  const samples: Array<[Belief, string]> = [
    [belief('did.harm', 'mara'), 'You hurt Mara.'],
    [belief('did.kill', 'mara'), 'You killed Mara.'],
    [belief('did.take', 'mara'), 'You took something from Mara.'],
    [belief('did.threat', 'news'), 'You were responsible for a threat.'],
    [belief('cause', 'accident'), 'You were affected by an accident.'],
    [belief('reason', undefined, { r: 'set', values: ['greedy', 'ordered'] }), 'You acted because of greed. Or: You acted because of orders.'],
    [belief('against', 'incident'), 'You acted against us: a theft.'],
    [belief('alive', 'yes'), 'You are alive.'], [belief('alive', 'no'), 'You are dead.'],
  ];
  for (const [claim, expected] of samples) expect(wording.belief(claim, names, events)).toBe(expected);
  for (const effect of EFFECTS) expect(wording.belief(belief(`did.${effect}`, 'mara'), names, events)).toBeTruthy();
  const sim = quietSim('review-belief-vocabulary', undefined, []);
  for (const kind of sim.w.kinds.kinds.values()) {
    if (kind.tags.includes('news')) expect(wording.belief(belief(`did.${kind.name}`, 'news'), names, events)).toBeTruthy();
    if (kind.family === 'city') expect(wording.belief(belief('cause', kind.name), names, events)).toBeTruthy();
  }
  for (const row of Object.values(sim.data.minds.reasons)) for (const reason of [...row.dispositional, ...row.situational]) expect(wording.belief(belief('reason', undefined, { r: 'set', values: [reason] }), names, events)).toBeTruthy();
});

test('a wrong event-kind belief says assault, never the true theft; regions retain every alternative', () => {
  const sim = quietSim('review-wrong', undefined, []), k = sim.k;
  const victim = k.mirrored('mara', 'xf:person');
  const id = k.events.mintEvent({ creator: sim.w.v, cause: sim.w.v, name: 'theft', kind: 'theft', time: 0, participants: [{ who: sim.w.v, role: 'actor' }, { who: victim, role: 'victim' }] });
  k.beliefs.set({ ...belief('kind', 'assault'), id: undefined, believer: victim, subject: id, evidence: [id] });
  const claim = new HolotableObserver(sim).sample().layers.get('beliefs')!.find((i) => i.value?.type === 'is wrong about')!;
  expect(claim.facets!.belief).toBe('It was an assault.');
  const events = new Map([['incident', event()]]);
  expect(wording.belief({ ...belief('kind', undefined, { r: 'set', values: ['assault', 'accident'] }), subject: 'incident' }, names, events)).toBe('It was an assault. Or: It was an accident.');
  expect(wording.belief({ ...belief('unknown', 'assault'), subject: 'incident' }, names, events)).toBeUndefined();
  expect(wording.belief({ ...belief('kind', 'unknown'), subject: 'incident' }, names, events)).toBeUndefined();
  expect(wording.belief({ ...belief('status', 'active'), subject: 'incident' }, names, events)).toBeUndefined();
  expect(wording.belief(belief('status', 'active'), names, events)).toBeUndefined();
  expect(wording.belief({ ...belief('status', 'active'), subject: 'frame' }, names, events, 0, 'mara')).toBe('Mara is pursuing a goal.');
});

test('all TieKind captions and the new-tie default are published', () => {
  const kinds: Record<TieKind, string> = { kin: 'family with', crew: 'in a crew with', colleague: 'works with', neighbour: 'neighbours with', friend: 'friends with', rival: 'rivals' };
  const sim = quietSim('review-ties', undefined, []), k = sim.k, other = k.mirrored('other', 'xf:person');
  for (const [kind, caption] of Object.entries(kinds)) {
    expect(wording.tieType(kind)).toBe(caption);
    k.addEdge({ type: 'xf:tie', from: sim.w.v, to: other, cause: sim.w.v, attrs: { kind }, id: `tie-${kind}` });
  }
  k.addEdge({ type: 'xf:tie', from: sim.w.v, to: other, cause: sim.w.v, id: 'tie-default' });
  const ties = new HolotableObserver(sim).sample().layers.get('ties')!;
  for (const [kind, caption] of Object.entries(kinds)) expect(ties.find((i) => i.id === `tie-${kind}`)?.value?.type).toBe(caption);
  expect(ties.find((i) => i.id === 'tie-default')?.value?.type).toBe('neighbours with');
});

test('unsafe external labels cannot leak through items, names, event prose or facet keys', () => {
  const sim = quietSim('review-text', undefined, []), k = sim.k;
  for (const [n, label] of ['xf.item:quest-key', '{"label":"key"}', 'se:node:hidden', '1234567890abcdef1234567890abcdef', '?th', '0.1234567', 'not recorded', 'a\tkey'].entries()) {
    const item = k.root(`bad-item-${n}`, 'xf:item');
    k.pin({ node: item, slot: 'label', value: label, reason: 'authored', cause: sim.w.v }); k.value(item, 'label');
    k.addEdge({ type: 'xf:held-by', from: item, to: sim.w.v, cause: sim.w.v });
    expect(wording.displayText(label)).toBeUndefined();
    expect(wording.names(new Map([['bad', label]]), 'v')('bad')).toBeUndefined();
  }
  const rows = new HolotableObserver(sim).sample();
  expect(rows.layers.get('items')).toHaveLength(8);
  for (const item of rows.layers.get('items')!) expect(item.label).toBe('An item');
  expect(wording.itemName('xf.item:quest-key', 'key')).toBe('a key');
  expect(wording.displayText('Mara Ilić')).toBe('Mara Ilić');
  expect(wording.displayText('Mara\nIlić')).toBeUndefined();
  expect(wording.itemName('An old brass key')).toBe('An old brass key');
  expect(wording.event({ ...event('fixture.paid'), participants: [{ who: 'bad', role: 'actor' }, { who: 'jun', role: 'target' }] }, wording.names(new Map([['bad', 'xf.item:key'], ['jun', 'Jun']]), 'v'))).toBe('A payment was made');
});

test('edge, frame and belief story fillers traverse their recorded cause events', () => {
  for (const kind of ['edge', 'frame', 'belief'] as const) {
    const sim = quietSim(`review-filler-${kind}`, undefined, []), k = sim.k;
    const cause = k.events.mintEvent({ creator: sim.w.v, cause: sim.w.v, name: 'outage', kind: 'outage', time: 0 });
    const entry = { id: 'story', pattern: 'xf.composite:debt', bindings: { '?d': sim.w.v, '?c': k.mirrored('jun', 'xf:person') }, stages: [], complete: false, graph: { junctures: { owed: { state: 'matched', filler: { ref: { [kind]: 'synthetic' }, id: `${kind}:synthetic`, fn: 'obligate', at: 0, args: {}, causes: [cause] } } }, retired: false } } as unknown as PoolEntry;
    const l3 = { state: { pool: [entry], evidence: [], buffer: [] }, log: [], threadView: [], sifter: { patterns: new Map([['xf.composite:debt', { graph: wording.patternInfo('xf.composite:debt') }]]) } } as unknown as Layer3;
    expect(new HolotableObserver(sim, undefined, l3).sample().layers.get('stories')!.find((i) => i.id === 'story')?.detail).toContain('Day 1, 00:00: The power went out.');
  }
});

test('every title role and all function moods agree with the protagonist and use your possessive', () => {
  const bad = /\byou (?:has|wants|owes|is|keeps|looks|stands|blames|goes|runs|learns|hires|turns|answers|gives|returns|brings)\b|you's/i;
  for (const [pattern, spec] of Object.entries(wording.wording.patterns)) {
    const roles = [...new Set([...`${spec.title} ${spec.fallback}`.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]))];
    for (const role of roles) {
      const bindings = Object.fromEntries(roles.map((r) => [r, r === role ? 'v' : 'mara']));
      const result = wording.title({ pattern, bindings }, names);
      expect(result).toMatch(/you|your/); expect(result).not.toMatch(bad); expect(result).not.toContain('{');
    }
  }
  for (const [fn, spec] of Object.entries(wording.wording.functions)) {
    const slots = [...new Set(Object.values(spec).flatMap((s) => [...s.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])))];
    for (const subject of slots) for (const mood of ['past', 'waiting', 'holds'] as const) {
      const args = Object.fromEntries(slots.map((slot) => [slot, `?${slot}`]));
      const bindings = Object.fromEntries(slots.map((slot) => [`?${slot}`, slot === subject ? 'v' : 'mara']));
      const result = wording.step({ fn, args } as Juncture, mood, { pattern: 'debt', bindings }, undefined, names);
      if (spec[mood] || mood === 'waiting' && spec.holds) { expect(result).toBeTruthy(); expect(result!).not.toMatch(bad); }
    }
  }
  expect(wording.title({ pattern: 'debt', bindings: { '?d': 'v', '?c': 'jun' } }, names)).toBe('Debt: you owe Jun');
  expect(wording.title({ pattern: 'interception', bindings: { '?i': 'mara', '?car': 'v' } }, names)).toBe('Interception: Mara goes after your delivery');
});

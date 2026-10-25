// S1 v0.6 audits (S1 12): the D-30 grounds, coarse-readable inputs, goals acting through production, goal frames left to people.goals (SF1-Q-2 additions), and SF1-A-6.

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lintLayerWrites, lintSources } from '../../src/sim/audit.ts';
import { outcomeOf } from '../../src/sim/outcomes.ts';
import { type ActsState, itemDescriptor } from '../../src/sim/proc-acts.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import { fxData, seedOf } from './helpers.ts';

setDefaultTimeout(120_000);

const read = (dir: string): Array<{ path: string; text: string }> => readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => ({ path: f, text: readFileSync(join(dir, f), 'utf8') }));
const SIM = read(join(import.meta.dir, '../../src/sim'));
const LAYERS = [...read(join(import.meta.dir, '../../src/seeding')), ...read(join(import.meta.dir, '../../src/procedural'))];

describe('SF1-Q-2 (v0.6): the audits catch', () => {
  const only = (found: ReturnType<typeof lintSources>, audit: string) => expect(found.map((f) => f.audit)).toEqual([audit]);

  test('the shipped sources have no finding of the v0.6 audits', () => {
    expect(LAYERS.length).toBeGreaterThan(10);
    expect(lintLayerWrites(LAYERS)).toEqual([]);
    expect(lintSources(SIM).filter((f) => ['goals-through-production', 'coarse-readable', 'goal-frames', 'd30-grounds'].includes(f.audit))).toEqual([]);
  });

  test('a seed write to punish state: a layer above S1 naming the intention, its last window, its grounding pulse or its events', () => {
    expect(lintLayerWrites([{ path: 'commit.ts', text: 'state.groups[g].lastPunish = 3;' }]).map((f) => f.audit)).toEqual(['d30-grounds']);
    expect(lintLayerWrites([{ path: 'commit.ts', text: "const intent = { name: 'punish' };" }]).length).toBe(0);
    expect(lintLayerWrites([{ path: 'commit.ts', text: 'g.intent = { punish: true };' }]).map((f) => f.audit)).toEqual(['d30-grounds']);
    expect(lintLayerWrites([{ path: 'commit.ts', text: "mint({ kind: 'decide.punish' });" }]).map((f) => f.audit)).toEqual(['d30-grounds']);
    expect(lintLayerWrites([{ path: 'commit.ts', text: "g.pulse['retribution-v'] = p;" }]).map((f) => f.audit)).toEqual(['d30-grounds']);
  });

  test('a coarse process reading what scene.acts opened', () => {
    only(lintSources([{ path: 'proc-goals.ts', text: "const d = sim.k.evolution.digestPeek('scene.acts');" }]), 'coarse-readable');
    only(lintSources([{ path: 'proc-groups.ts', text: "import type { ActsState } from './proc-acts.ts';" }]), 'coarse-readable');
    // the fine tier may; a process id in a list is not a read
    expect(lintSources([{ path: 'proc-acts.ts', text: "const d = sim.k.evolution.digestPeek('scene.acts');" }])).toEqual([]);
    expect(lintSources([{ path: 'proc-groups.ts', text: "const own = ['scene.acts', 'people.goals'];" }])).toEqual([]);
  });

  test('a policy minting an event with a served goal frame, and a warning minted outside city.events', () => {
    only(lintSources([{ path: 'tie-policy.ts', text: "k.events.mintEvent({ creator: x, cause: y, name: 'n', time: 1, kind: 'tell', served: frame });" }]), 'goals-through-production');
    only(lintSources([{ path: 'proc-groups.ts', text: "ops.push({ op: 'mint-event', spec: { name: 'w', time: 1, kind: 'warning', participants: [] } });" }]), 'goals-through-production');
    only(lintSources([{ path: 'grievance.ts', text: "mintEvent({ kind: 'confront' });" }]), 'goals-through-production');
    // the admission owner and the scene may
    expect(lintSources([{ path: 'proc-events.ts', text: "const d = { kind: 'warning', served: g.id };" }])).toEqual([]);
    expect(lintSources([{ path: 'proc-acts.ts', text: "const s = { kind: 'confront' };" }])).toEqual([]);
  });

  test('reconcile setting the status of a retained goal frame', () => {
    const real = SIM.find((f) => f.path === 'policies.ts')!;
    expect(lintSources([real]).some((f) => f.audit === 'goal-frames')).toBe(false);
    const bad = real.text.replace("        if (f.retain && f.level === 'goal') continue;\n", '');
    expect(bad).not.toBe(real.text);
    const found = lintSources([{ path: 'policies.ts', text: bad }]);
    expect(found.map((f) => f.audit)).toEqual(['goal-frames']);
  });
});

describe('SF1-A-6: the outcome of an item at opening', () => {
  test('a shakedown item is opened with outcomeOf keyed by its Id, contributed with its other fields; a failed one carries no take; a reload puts the contributions back and publishes nothing again', () => {
    const seen = new Set<string>();
    for (let n = 0; n < 8 && seen.size < 1; n++) {
      const sim = Sim.create({
        worldSeed: seedOf(`SF1-A-6-${n}`), index: fx3Slice(),
        data: fxData((d) => { for (const k of Object.keys(d.shape.rate)) d.shape.rate[k] = d.shape.rate[k]!.map((x) => x * 30) as [number, number, number, number]; }),
        only: ['city.events', 'scene.acts'],
      });
      sim.k.reading(sim.w.vState, 'cell', sim.w.districts[0]!.cellIds[0]!, sim.k.now);
      sim.advance(50);
      const published = sim.stateOf<ActsState>('scene.acts')!.published;
      for (const p of published) {
        const view = sim.policies.viewEvent(p.item);
        if (!view || view.kind !== 'shakedown') continue;
        const entry = sim.ringEntry(p.summary)!;
        const d = itemDescriptor(sim, p.summary, p.index, p.w, p.cell, entry.kind, entry.meta![p.index]!);
        const cast = sim.casting.cast(d);
        expect(cast).not.toBe('no-cast');
        // the outcome is the keyed draw's, from the item's own Id and recorded history as of its time
        expect(view.outcome).toBe(outcomeOf(sim, d, cast as never, sim.outcomeView()).outcome);
        const takes = view.effects.filter((e) => e.effect === 'take');
        if (view.outcome === 'done') expect(takes.length).toBeGreaterThan(0);
        else expect(takes).toHaveLength(0);
        seen.add(view.outcome!);
        // a reload: the contributions are put back identical, and nothing is published again
        sim.k.persistence.save(`A6-${n}`);
        const emitted: string[] = [];
        const emit = sim.k.emit.bind(sim.k);
        sim.k.emit = (ch, t) => { if (ch.c === 'event') emitted.push(ch.event); emit(ch, t); };
        sim.k.persistence.load(`A6-${n}`);
        sim.advance(2);
        expect(emitted.filter((x) => x === p.item)).toHaveLength(0);
        expect(sim.policies.viewEvent(p.item)?.outcome).toBe(view.outcome);
        break;
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(1);
  });
});

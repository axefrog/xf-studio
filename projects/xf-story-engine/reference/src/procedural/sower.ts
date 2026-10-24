import { id, i, s } from '../id.ts';
import { ln } from '../fdlibm-log.ts';
import type { Instance, Layer2, SowRequest } from '../seeding/layer2.ts';
import type { Finding, CompiledSeed } from '../seeding/types.ts';
import { bound } from '../seeding/doc.ts';
import type { Seed } from '../seeding/types.ts';
import type {
  Candidate,
  Counts,
  Feature,
  KernelView,
  Layer2View,
  Layer3Data,
  Layer3State,
  Log,
  PoolEntry,
  SiftPattern,
  Sowable,
} from './types.ts';
import { Keys, cmp } from './keys.ts';
import { compatible, levels, sowableFindings } from './lint.ts';
import type { Sifter } from './sifter.ts';

export const FEATURES: Feature[] = ['F3', 'F5', 'F6', 'F11'];
export interface RankedCandidate extends Candidate {
  bands: Partial<Record<Feature, number>>;
  composite: number;
  score: number;
}
export function rankCandidates(
  candidates: Candidate[],
  recent: Layer3State['recent'],
  data: Layer3Data,
): RankedCandidate[] {
  const out = candidates
    .slice()
    .sort((a, b) => cmp(a.key, b.key))
    .map((c) => ({ ...c, bands: {} as Partial<Record<Feature, number>>, composite: 0.5, score: 0 }));
  const used: Feature[] = [];
  for (const f of FEATURES) {
    if (out.every((c) => c.features[f] === out[0]?.features[f])) continue;
    used.push(f);
    const ranked = out.slice().sort((a, b) => b.features[f] - a.features[f] || cmp(a.key, b.key));
    ranked.forEach((c, r) => {
      c.bands[f] = 2 - Math.floor((3 * r) / out.length);
    });
  }
  for (const c of out) {
    let sum = 0,
      weights = 0;
    for (const f of used) {
      sum += data.sower.featureWeights[f] * c.bands[f]!;
      weights += data.sower.featureWeights[f];
    }
    c.composite = weights === 0 ? 0.5 : sum / (2 * weights);
    let dup = 0;
    for (const r of recent) {
      if (r.pattern === c.pattern) dup++;
      if (c.place !== undefined && r.place === c.place) dup++;
    }
    c.score = data.sower.lambda * c.composite - data.sower.diversity * dup;
  }
  return out;
}
export interface Kit {
  pack: string;
  template: Seed;
  sowable: Sowable;
}
export type TypedExclusion = { kind: 'verb' | 'class' | 'tag' | 'npc'; value: string };
export class Sower {
  readonly rivals: Array<{ k: number; candidates: RankedCandidate[] }> = [];
  constructor(
    readonly l2: Layer2,
    readonly kv: KernelView,
    readonly lv: Layer2View,
    readonly keys: Keys,
    readonly data: Layer3Data,
    readonly state: () => Layer3State,
    readonly sifter: Sifter,
    readonly log: Log,
    readonly atomic: (req: SowRequest, apply: (instance: string) => void, validate?: (inst: Instance) => Finding[]) => ReturnType<Layer2['sowRequest']>,
  ) {}
  private gate(n: number, e: PoolEntry, extra: Record<string, unknown> = {}): void {
    this.log(
      'sow',
      `gate-${n}`,
      { entry: e.id, pattern: e.pattern, ...extra },
      e.stages.map((s) => s.event),
    );
  }
  kits(p: SiftPattern, e: PoolEntry, c: Counts): Kit[] {
    const now = this.lv.playTotal(),
      nodes = Object.values(this.overlay(p, e)).map((r) => r.identity);
    const out: Kit[] = [];
    for (const [pack, index] of [...this.l2.packs.entries()].sort((a, b) => cmp(a[0], b[0])))
      for (const template of index.pack.seeds.slice().sort((a, b) => cmp(a.id, b.id))) {
        if (p.telling.kit && template.id !== p.telling.kit) continue;
        const sowable = template.sowable as Sowable | undefined;
        if (
          !sowable?.serves?.includes(p.telling.form) ||
          !compatible(p, template, this.kv) ||
          sowableFindings(template, this.l2, this.kv, this.data, pack).length
        )
          continue;
        let failed = 0;
        if (
          levels.indexOf(template.level) > levels.indexOf(this.data.sower.maxLevel) ||
          !['person', 'crew', 'block'].includes(template.stakeScale ?? 'block') ||
          (now < this.data.schedule.gentleFirst && sowable.firstClass >= 1) ||
          (now < this.data.schedule.gentleHour && sowable.firstClass > 1)
        )
          failed = 6;
        if (!failed && this.excluded(template, pack, nodes))
          failed = 7;
        if (!failed && sowable.climactic && c.C >= this.data.threads.maxClimactic) failed = 8;
        if (failed) {
          this.gate(failed, e, { kit: template.id });
          continue;
        }
        out.push({ pack, template, sowable });
      }
    return out;
  }
  private excluded(t: Seed | CompiledSeed, pack: string, nodes: string[]): boolean {
    const settings = this.l2.k.settings.current(),
      tags = [...(t.purpose.tags ?? []), ...((t.sowable as Sowable | undefined)?.tags ?? [])],
      envelope = t.content?.envelope ?? {},
      fragments = this.l2.packs.get(pack)?.closure(t as CompiledSeed).fragments ?? [],
      verbs = fragments.flatMap((f) => f.channels.map((ch) => this.l2.reg.skeleton(t, f, ch).verb));
    return Object.keys(envelope).some((cl) => settings.classExclusions.includes(cl)) ||
      settings.content.softExclusions.some((ex) => (envelope[ex.class] ?? 0) >= ex.level) ||
      (settings.storyExclusions ?? []).some((ex) => ex.kind === 'npc' ? nodes.includes(ex.value) :
        ex.kind === 'class' ? ex.value in envelope : ex.kind === 'tag' ? tags.includes(ex.value) : verbs.includes(ex.value));
  }
  overlay(p: SiftPattern, e: PoolEntry): Record<string, { identity: string }> {
    return Object.fromEntries(
      Object.entries(p.telling.binds).map(([r, v]) => [
        r,
        { identity: v === '?story' ? e.story! : v === '?end' ? e.stages[e.stages.length - 1].event : e.bindings[v] },
      ]),
    );
  }
  collect(counts: Counts): Array<{ candidate: Candidate; kits: Kit[] }> {
    const now = this.l2.k.now,
      total = this.lv.playTotal(),
      out: Array<{ candidate: Candidate; kits: Kit[] }> = [];
    for (const e of this.state()
      .pool.slice()
      .sort((a, b) => a.seq - b.seq)) {
      if (!e.complete || e.seed) continue;
      const p = this.sifter.patterns.get(e.pattern);
      if (!p) continue;
      const events = e.stages.map((s) => this.kv.event(s.event));
      if (now > e.lastTime + this.data.sifter.candidateTtl || events.some((ev) => !ev)) {
        this.gate(1, e);
        continue;
      }
      const kits = this.kits(p, e, counts);
      if (!kits.length) {
        this.gate(2, e);
        continue;
      }
      if (
        !events.some((ev) => ev!.effects.length) ||
        (!['rumour', 'sighting'].includes(p.telling.form) && !events[events.length - 1]!.causes.length)
      ) {
        this.gate(3, e);
        continue;
      }
      const bound = Object.keys(e.bindings)
        .sort(cmp)
        .map((v) => e.bindings[v])
        .filter((n) => {
          const kind = this.kv.kind(n);
          return kind && ['core:person', 'core:group', 'core:place'].some((k) => this.kv.isKind(kind, k));
        });
      if (
        !bound.some((n) => {
          const kind = this.kv.kind(n)!;
          return ['core:person', 'core:group'].some((k) => this.kv.isKind(kind, k));
        })
      ) {
        this.gate(4, e);
        continue;
      }
      const player = this.l2.k.expandId('root:v'),
        vParticipant = events.some((ev) => ev!.participants.some((w) => w.who === player)),
        exposed = new Set(bound.filter((n) => this.lv.exposedNode(n, 'presented')));
      if (!vParticipant && !exposed.size && !['rumour', 'recap', 'sighting'].includes(p.telling.form)) {
        this.gate(5, e);
        continue;
      }
      if (Object.values(this.overlay(p, e)).some((r) => this.kv.isSpine(r.identity))) {
        this.gate(9, e);
        continue;
      }
      const key = this.keys.candidate(e.id, e.stages.length - 1),
        decision = this.keys.decision(key);
      if (this.lv.sownBy(decision).length || e.cooldownUntil > total) {
        this.gate(10, e);
        continue;
      }
      const distinct = (effects: string[]) =>
        new Set(
          events.flatMap((ev) =>
            ev!.effects.filter((ef) => effects.includes(ef.effect)).map((ef) => `${ef.on}:${ef.effect}`),
          ),
        ).size;
      const place = Object.keys(e.bindings)
        .sort(cmp)
        .map((v) => e.bindings[v])
        .find((n) => {
          const kind = this.kv.kind(n);
          return kind && this.kv.isKind(kind, 'core:place');
        });
      out.push({
        candidate: {
          key,
          entry: e.id,
          pattern: e.pattern,
          stage: e.stages.length - 1,
          features: {
            F3: distinct(this.data.sower.harmful),
            F5: exposed.size + (vParticipant ? 2 : 0),
            F6: distinct(this.data.sower.irreversible),
            F11: this.data.sower.timelyH / (this.data.sower.timelyH + Math.max(0, now - e.lastTime)),
          },
          ...(place ? { place } : {}),
        },
        kits,
      });
    }
    return out.sort((a, b) => cmp(a.candidate.key, b.candidate.key));
  }
  resolve(counts: Counts): void {
    const st = this.state(),
      now = this.lv.playTotal(),
      gap = this.data.schedule.slotGap,
      tempo = this.l2.k.settings.current().tempo;
    let k = st.slots.open.next;
    while ((k + 1) * gap <= now) {
      this.log('slot', 'slot-lapsed', { k, ...this.keys.slot(k, gap), tempo });
      st.slots.open.next = ++k;
    }
    const slot = this.keys.slot(k, gap);
    if (now < slot.time) return;
    let reason: string | undefined;
    if (slot.u >= this.data.schedule.theta[tempo]) reason = 'slot-passed';
    else if (slot.time < this.data.schedule.gentleFirst) reason = 'slot-gentle';
    else if (now < st.openLockUntil) reason = 'slot-locked';
    else if (
      counts.A >= this.data.threads.maxAttended ||
      counts.L >= this.data.threads.maxLive ||
      counts.S >= this.data.threads.maxSimmering ||
      st.pending.length >= this.data.threads.maxLive
    )
      reason = 'slot-budget';
    if (reason) this.log('slot', reason, { k, ...slot, tempo, counts });
    else this.run(k, counts);
    st.slots.open.next = k + 1;
  }
  private run(k: number, counts: Counts): void {
    const collected = this.collect(counts),
      scores = rankCandidates(
        collected.map((c) => c.candidate),
        this.state().recent,
        this.data,
      );
    if (!scores.length) {
      this.log('slot', 'slot-empty', { k });
      return;
    }
    this.rivals.push({ k, candidates: structuredClone(scores) });
    if (this.rivals.length > 8) this.rivals.shift();
    this.log('slot', 'slot-run', { k });
    const ranked = this.keys.ranked('s3-pick', [s('open'), i(k)], scores);
    for (const candidate of ranked.slice(0, this.data.sower.maxCandidateTries)) {
      const e = this.state().pool.find((e) => e.id === candidate.entry)!;
      const p = this.sifter.patterns.get(e.pattern)!;
      const kits = collected.find((c) => c.candidate.key === candidate.key)!.kits;
      const recent = this.state()
        .recent.slice(-this.data.sower.recentKits)
        .map((r) => r.kit);
      const kitScores = this.keys.ranked(
        's3-kit',
        [id(candidate.key)],
        kits.map((kit) => ({
          key: kit.template.id,
          score: ln(kit.sowable.weight ?? 1) - (recent.includes(kit.template.id) ? this.data.sower.kitDiversity : 0),
          kit,
        })),
      );
      for (const row of kitScores.slice(0, this.data.sower.maxKitTries)) {
        const kit = row.kit,
          req: SowRequest = {
            template: kit.template.id,
            pack: kit.pack,
            overlay: { roles: this.overlay(p, e) },
            localName: candidate.key.slice(0, 16),
            decision: this.keys.decision(candidate.key),
          };
        const result = this.atomic(req, (instance) => {
          const st = this.state();
          e.seed = instance;
          st.pending.push({ instance, sownAt: this.lv.playTotal() });
          st.recent.push({ pattern: p.id, kit: kit.template.id, place: candidate.place, at: this.lv.playTotal() });
          st.recent = st.recent.slice(-this.data.sower.recentSown);
          st.slots.open.next = k + 1;
        }, (inst) => {
          const nodes = Object.values(inst.st.document.roles).flatMap((role) => {
            const identity = bound(role.identity);
            return identity.status === 'fixed' && identity.value ? [this.l2.k.expandId(identity.value)] : [];
          });
          nodes.push(...Object.values(inst.st.roles).flatMap((role) => role.cast ? [role.cast] : []));
          return this.excluded(inst.st.document, kit.pack, nodes)
            ? [{ code: 'S3-gate-7', level: 'error', message: 'The effective variant-expanded kit matches an exclusion.' }]
            : [];
        });
        this.log(
          'sow',
          result.ok ? 'sow' : 'sow-refused',
          {
            k,
            pattern: p.id,
            version: p.version,
            bindings: e.bindings,
            features: candidate.features,
            bands: candidate.bands,
            composite: candidate.composite,
            scores: ranked,
            rivals: scores,
            telling: p.telling,
            kit: kit.template.id,
            kitScores: kitScores.map(({ kit, ...rest }) => rest),
            request: req,
            result,
          },
          e.stages.map((s) => s.event),
          kit.sowable.firstClass === 0 ? 0 : 1,
        );
        if (result.ok) return;
      }
      e.refusals++;
      e.cooldownUntil = this.lv.playTotal() + this.data.sower.cooldown;
      if (e.refusals >= this.data.sower.maxRefusals) this.sifter.drop(e, 'refusals', this.l2.k.now);
    }
  }
}

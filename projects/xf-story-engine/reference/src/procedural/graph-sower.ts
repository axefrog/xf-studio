import { H, id, i, s } from '../id.ts';
import { ln } from '../fdlibm-log.ts';
import { actingArgument } from '../seeding/pattern-lint.ts';
import { playOf } from '../seeding/doc.ts';
import type { SowRequest } from '../seeding/layer2.ts';
import type { Candidate, Counts, PoolEntry, Sowable, Thread } from './types.ts';
import type { Layer3 } from './layer3.ts';
import type { Sower, Kit } from './sower.ts';
import { sowableFindings, levels } from './lint.ts';
import { cmp } from './keys.ts';
import { terminal } from './director.ts';

/** Candidate policy for graph instances. Sower owns the shared frozen draws and atomic door. */
export class GraphSower {
  constructor(readonly owner: Sower, readonly host: Layer3) {}
  private gate(n: number, e: PoolEntry, condition?: string): void { this.host.logGraphGate(n, e.id, condition); }
  private thread(e: PoolEntry): Thread | undefined { return this.host.threadView.find((t) => t.patterns?.includes(e.id)); }
  private ref(c: Candidate): string { return c.kind === 'realise' ? 'realise:' + c.juncture : c.kind === 'surface' ? 'surface:' + c.juncture : c.kind === 'explain' ? `explain:${c.edge}:${this.host.ledger.signs(this.host.state.pool.find((e) => e.id === c.entry)!, c.edge!).length}` : 'told'; }
  private key(e: PoolEntry, kind: NonNullable<Candidate['kind']>, key?: string | number): string {
    const args = kind === 'told' ? [s('match'), id(e.id), i(Object.keys(e.graph!.junctures).length - 1)]
      : kind === 'explain' ? [s('explain'), id(e.id), i(Number(key)), i(this.host.ledger.signs(e, Number(key)).length)]
      : [s(kind === 'realise' ? 'juncture' : kind), id(e.id), s(String(key))];
    return H(s('cand'), id(this.host.k.worldSeed), ...args);
  }
  private legalNudge(e: PoolEntry, key: string): boolean {
    const h = this.host, p = h.sifter.patterns.get(e.pattern)!.graph!, j = p.junctures[key], arg = actingArgument(j, h.l2.reg.vocabulary!), actor = arg ? j.args[arg] : undefined;
    return p.latitude?.nudge !== false && !!actor && actor !== 'v' && e.bindings[actor] !== h.k.vId && p.roles[actor]?.v !== 'may'
      && h.k.now - (e.graph!.junctures[key].readySince ?? h.k.now) >= h.data.sower.nudgeAfter && h.state.nudges.length < h.data.sower.maxNudges;
  }
  private escalation(e: PoolEntry, key: string): string | undefined {
    const h = this.host, p = h.sifter.patterns.get(e.pattern)!.graph!, g = e.graph!, j = p.junctures[key], world = h.sifter.graph.world;
    const previous = (p.escalation ?? []).map((k) => g.junctures[k]).filter((s) => s.filler).sort((a, b) => b.filler!.at - a.filler!.at)[0]
      ?? Object.values(g.junctures).filter((s) => s.perceived).sort((a, b) => a.perceived!.at - b.perceived!.at)[0];
    if ((this.thread(e)?.pullAt ?? -Infinity) <= (previous?.filler?.at ?? Infinity)) return 'pull';
    const source = h.ledger.strongest(p, e, key);
    if (!source || !g.junctures[source].perceived || p.edges.some((edge, i) => edge.to === source && g.junctures[edge.from].filler && g.junctures[edge.to].filler && !h.ledger.shown(e, i))) return 'legibility';
    const actorArg = actingArgument(j, world.vocabulary), actor = actorArg ? e.bindings[j.args[actorArg]] : undefined;
    const targets = Object.entries(j.args).filter(([a]) => a !== actorArg).map(([, v]) => e.bindings[v]).filter(Boolean);
    if (!actor || !targets.some((n) => world.stateHolds('want', { who: actor, what: n }, h.k.now) || world.stateHolds('pursue', { who: actor, target: n }, h.k.now))) return 'want';
    if (targets.some((n) => n === h.k.vId || h.l2.exposedNode(n, 'presented')) && !Object.entries(p.junctures).some(([k, juncture]) => {
      const acting = actingArgument(juncture, world.vocabulary), state = g.junctures[k];
      return ['threaten', 'pursue', 'demand', 'want'].includes(juncture.fn) && acting && state.filler?.args[acting] === actor
        && state.perceived && h.l2.playTotal() - state.perceived.play >= h.data.sower.portentLead;
    })) return 'portent';
    return undefined;
  }
  private kits(e: PoolEntry, c: Candidate, counts: Counts): Kit[] {
    const h = this.host, p = h.sifter.patterns.get(e.pattern)!.graph!, g = e.graph!, j = c.juncture ? p.junctures[c.juncture] : undefined;
    const out: Kit[] = [];
    for (const [pack, index] of [...h.l2.packs].sort(([a], [b]) => cmp(a, b))) for (const template of index.pack.seeds.slice().sort((a, b) => cmp(a.id, b.id))) {
      const sow = template.sowable as Sowable | undefined;
      if (!sow || sowableFindings(template, h.l2, h.kv, h.data, pack).length) continue;
      const roles: Record<string, { identity: string }> = {};
      const bind = (role: string | undefined, node: string | undefined) => { if (role && role !== 'v' && node && node !== h.k.vId) roles[role] = { identity: node }; };
      const end = e.stages.slice().sort((a, b) => b.time - a.time || cmp(a.event, b.event))[0]?.event;
      if (c.kind === 'told') {
        if (!p.tell || !sow.serves.includes(p.tell.form) || (p.tell.kit && p.tell.kit !== template.id)) continue;
        for (const [role, variable] of Object.entries(p.tell.binds)) bind(role, variable === '?story' ? e.story : variable === '?end' ? end : e.bindings[variable]);
        if (Object.keys(p.tell.binds).some((r) => !roles[r] || !template.roles[r])) continue;
      } else if (c.kind === 'surface' || c.kind === 'explain') {
        if (!sow.tells || !['rumour', 'sighting', 'recap'].some((f) => sow.serves.includes(f as never)) || (c.kind === 'explain' && !sow.explains)) continue;
        const later = g.junctures[c.juncture!].filler;
        const source = c.kind === 'explain' ? p.edges[c.edge!].from : h.ledger.strongest(p, e, c.juncture!);
        const eventOf = (f: typeof later) => f && ('event' in f.ref ? f.id : f.causes?.find((n) => !!h.kv.event(n)));
        bind(sow.tells, eventOf(later)); bind(sow.explains, source ? eventOf(g.junctures[source].filler) : undefined);
        if (c.kind === 'explain') {
          const channels = template.start.flatMap((k) => playOf(template.beats[k]).refs).flatMap((r) => index.fragment(r)?.channels ?? []);
          if (h.ledger.signs(e, c.edge!).includes('told:' + h.ledger.modality(channels[0] ?? 'trace'))) continue;
        }
      } else {
        if (!sow.serves.includes(c.realisation!)) continue;
        const realisation = (j!.realise ?? []).find((r) => c.realisation === 'offer' ? 'offer' in r : 'nudge' in r);
        const named = realisation && ('offer' in realisation ? realisation.offer.kit : 'nudge' in realisation ? realisation.nudge.kit : undefined);
        if (named && named !== template.id) continue;
        const fill = sow.fills?.find((f) => f.fn === j!.fn && Object.entries(j!.args).every(([a, v]) => !e.bindings[v]
          || (e.bindings[v] === h.k.vId ? f.args[a] === 'v' : f.args[a] !== 'v' && !!template.roles[f.args[a]])));
        if (!fill) continue;
        const actorArg = actingArgument(j!, h.l2.reg.vocabulary!);
        if (c.realisation === 'offer' && j!.v !== 'offer' && !(j!.fn === 'ask' && p.roles[j!.args.of]?.v === 'may')) {
          const asker = template.start.flatMap((k) => playOf(template.beats[k]).refs).map((r) => index.fragment(r)?.offer?.asker).find(Boolean);
          if (!actorArg || fill.args[actorArg] !== asker) continue;
        }
        for (const [a, role] of Object.entries(fill.args)) bind(role, e.bindings[j!.args[a]]);
        const source = h.ledger.strongest(p, e, c.juncture!);
        bind(fill.cause, source && g.junctures[source].filler && 'event' in g.junctures[source].filler!.ref ? g.junctures[source].filler!.id : undefined);
      }
      const nodes = Object.values(roles).map((r) => r.identity), nudge = c.realisation === 'nudge', now = h.l2.playTotal();
      let gate = 0;
      if (!nudge && (levels.indexOf(template.level) > levels.indexOf(h.data.sower.maxLevel) || !['person', 'crew', 'block'].includes(template.stakeScale ?? 'block')
        || (now < h.data.schedule.gentleFirst && sow.firstClass >= 1) || (now < h.data.schedule.gentleHour && sow.firstClass > 1))) gate = 6;
      if (this.owner.excluded(template, pack, nodes)) gate ||= 7;
      if (!nudge && ((c.opens && (counts.A >= h.data.threads.maxAttended || counts.L >= h.data.threads.maxLive || counts.S >= h.data.threads.maxSimmering))
        || (sow.climactic && counts.C >= h.data.threads.maxClimactic))) gate ||= 8;
      if (nodes.some((n) => h.kv.isSpine(n))) gate ||= 9;
      if (gate) { this.gate(gate, e); continue; }
      out.push({ pack, template, sowable: sow, overlay: { roles, ...(c.kind !== 'told' ? { growsFrom: { instance: e.id, juncture: c.juncture! } } : {}) } });
    }
    return out;
  }
  collect(counts: Counts): Array<{ candidate: Candidate; kits: Kit[] }> {
    const h = this.host, out: Array<{ candidate: Candidate; kits: Kit[] }> = [];
    for (const e of h.state.pool.filter((e) => e.graph && !e.graph.retired).sort((a, b) => a.seq - b.seq)) {
      const p = h.sifter.patterns.get(e.pattern)!.graph!, g = e.graph!, t = this.thread(e);
      const events = Object.values(g.junctures).flatMap((j) => j.filler && 'event' in j.filler.ref ? [h.kv.event(j.filler.id)] : []).filter((e) => !!e);
      if (events.length !== Object.values(g.junctures).filter((j) => j.filler && 'event' in j.filler.ref).length) { this.gate(1, e); continue; }
      const people = Object.values(e.bindings).filter((n) => n !== h.k.vId && ['core:person', 'core:group', 'core:place'].some((k) => h.kv.isKind(h.kv.kind(n) ?? '', k)));
      if (!people.some((n) => ['core:person', 'core:group'].some((k) => h.kv.isKind(h.kv.kind(n) ?? '', k)))) { this.gate(4, e); continue; }
      const vPart = events.some((ev) => ev.participants.some((x) => x.who === h.k.vId)), exposed = people.filter((n) => h.l2.exposedNode(n, 'presented'));
      const place = Object.keys(e.bindings).sort(cmp).map((v) => e.bindings[v]).find((n) => h.kv.isKind(h.kv.kind(n) ?? '', 'core:place'));
      const matched = p.edges.filter((edge) => edge.link !== 'forecloses' && g.junctures[edge.from].filler && g.junctures[edge.to].filler);
      const shown = p.edges.filter((edge, i) => matched.includes(edge) && h.ledger.shown(e, i)).length / (matched.length || 1);
      const share = matched.length ? shown : 1;
      const distinct = (effects: string[]) => new Set(events.flatMap((ev) => ev.effects.filter((x) => effects.includes(x.effect)).map((x) => `${x.on}:${x.effect}`))).size;
      const add = (kind: NonNullable<Candidate['kind']>, key?: string | number, realisation?: 'offer' | 'nudge') => {
        const juncture = kind === 'explain' ? p.edges[Number(key)].to : typeof key === 'string' ? key : undefined;
        const j = juncture ? p.junctures[juncture] : undefined;
        const c: Candidate = { key: this.key(e, kind, key), entry: e.id, pattern: e.pattern, stage: Object.keys(g.junctures).length - 1,
          kind, juncture, edge: kind === 'explain' ? Number(key) : undefined, realisation, form: kind === 'told' ? p.tell!.form : realisation ?? 'rumour',
          thread: t?.id, opens: !t?.aware, place,
          features: { F3: distinct(h.data.sower.harmful), F5: exposed.length + (vPart ? 2 : 0), F6: distinct(h.data.sower.irreversible), F11: h.data.sower.timelyH / (h.data.sower.timelyH + Math.max(0, h.k.now - e.lastTime)),
            F13: g.layers.filter((l) => l.cross && h.threadView.some((t) => t.aware && t.patterns?.includes(l.with))).length,
            F14: exposed.filter((n) => h.kv.isKind(h.kv.kind(n) ?? '', 'core:person') && (events.some((ev) => ev.effects.some((x) => x.on === n && h.data.sower.harmful.includes(x.effect)))
              || (j && Object.entries(j.args).some(([a, v]) => a !== actingArgument(j, h.l2.reg.vocabulary!) && e.bindings[v] === n)))).length,
            F15: kind === 'told' ? 0 : Object.values(p.outcomes).filter((o) => !o.reached.some((k) => g.junctures[k].state === 'foreclosed')).length
              + h.state.pool.filter((shape) => shape.graph?.state === 'live' && !shape.graph.retired && t?.patterns?.includes(shape.id)
                && Object.entries(h.sifter.patterns.get(shape.pattern)!.graph!.junctures).some(([key, j]) => j.fn === 'story' && j.args.pattern === p.id && shape.graph!.junctures[key].state === 'ready')).length,
            F16: ['surface', 'explain'].includes(kind) ? 1 - share : share } };
        const refusal = g.refusals[this.ref(c)];
        if (refusal && (refusal.n >= h.data.sower.maxRefusals || refusal.until > h.l2.playTotal()) || h.lv.sownBy(h.keys.decision(c.key)).length) { this.gate(10, e); return; }
        if (!vPart && !exposed.length && (kind === 'realise' && realisation !== 'nudge' || kind === 'told' && !['rumour', 'recap', 'sighting'].includes(c.form!))) { this.gate(5, e); return; }
        if (kind === 'realise') {
          if (h.ledger.debt(e) > 1) { this.gate(11, e); return; }
          if (p.escalation?.includes(juncture!)) { const condition = this.escalation(e, juncture!); if (condition) { this.gate(12, e, condition); return; } }
          if (realisation === 'nudge' && !this.legalNudge(e, juncture!)) { this.gate(13, e); return; }
        }
        if (kind === 'told' && (!events.some((ev) => ev.effects.length) || !['rumour', 'sighting'].includes(c.form!) && !events.slice().sort((a, b) => b.time - a.time)[0]?.causes.length)) { this.gate(3, e); return; }
        const kits = this.kits(e, c, counts);
        if (!kits.length) { this.gate(2, e); return; }
        const tokens = kind === 'realise' || kind === 'surface' ? h.ledger.prediction(t, e, juncture!) : (t?.tokens?.slice() ?? []);
        if (kind === 'told' && !tokens.at(-1)?.startsWith('end:')) tokens.push(`end:${g.outcome!.kind}/${p.id.split(':').pop()}`);
        const prefix = tokens.map((token) => H(s('tok'), s(token.replace(/\/(help|bargain|oppose|refuse)$/, ''))));
        const predicted = prefix.slice(0, h.data.sower.skeletonTokens);
        c.skeletonMatches = h.state.skeletons.ring.filter((r) => r.thread !== t?.id && predicted.length > 0 && predicted.every((n, i) => r.tokens[i] === n)).length;
        out.push({ candidate: c, kits });
      };
      if (g.outcome && p.tell && !g.seeds.some((s) => s.for === 'told') && h.k.now <= g.outcome.at + h.data.sifter.candidateTtl) add('told');
      if (!['live', 'aftermath'].includes(g.state) || h.k.now > (g.state === 'aftermath' ? g.aftermathUntil! : e.firstTime + h.sifter.within(h.sifter.patterns.get(e.pattern)!))) continue;
      Object.keys(g.junctures).filter((k) => g.junctures[k].filler && 'event' in g.junctures[k].filler!.ref && !g.junctures[k].perceived)
        .sort((a, b) => g.junctures[a].filler!.at - g.junctures[b].filler!.at || cmp(a, b)).slice(0, h.data.sifter.maxSurface).forEach((k) => add('surface', k));
      p.edges.map((edge, i) => ({ edge, i })).filter(({ edge, i }) => edge.link !== 'forecloses' && g.junctures[edge.from].perceived && g.junctures[edge.to].perceived && !h.ledger.shown(e, i))
        .slice(0, h.data.sifter.maxSurface).forEach(({ i }) => add('explain', i));
      if (g.state !== 'live' || p.family === 'shape') continue;
      for (const key of Object.keys(g.junctures).sort(cmp)) if (g.junctures[key].state === 'ready') {
        const realisations = p.junctures[key].realise ?? [{ wait: true }, { offer: {} }, { nudge: {} }];
        for (const r of realisations) {
          if ('offer' in r && (vPart || exposed.length)) { const before = out.length; add('realise', key, 'offer'); if (out.length > before) break; }
          if ('nudge' in r && this.legalNudge(e, key)) { add('realise', key, 'nudge'); break; }
        }
      }
    }
    return out;
  }
  accepted(e: PoolEntry, c: Candidate, seed: string): void {
    const h = this.host, g = e.graph!;
    g.seeds.push({ seed, for: c.kind === 'told' ? 'told' : c.juncture! });
    if (c.kind === 'realise') { const state = g.junctures[c.juncture!]; state.state = 'pending'; state.pending = seed; }
    (c.realisation === 'nudge' ? h.state.nudges : h.state.pending).push({ instance: seed, sownAt: h.l2.playTotal() });
  }
  refused(e: PoolEntry, c: Candidate): void {
    const g = e.graph!, key = this.ref(c), n = (g.refusals[key]?.n ?? 0) + 1;
    g.refusals[key] = { n, until: this.host.l2.playTotal() + this.host.data.sower.cooldown };
  }
  repair(): void {
    const h = this.host;
    for (const e of h.state.pool.filter((e) => e.graph && !e.graph.retired)) {
      const choices: Candidate[] = [];
      const base = { entry: e.id, pattern: e.pattern, stage: 0, features: { F3: 0, F5: 0, F6: 0, F11: 0 } };
      choices.push({ ...base, key: this.key(e, 'told'), kind: 'told' });
      for (const key of Object.keys(e.graph!.junctures)) {
        choices.push({ ...base, key: this.key(e, 'realise', key), kind: 'realise', juncture: key });
        choices.push({ ...base, key: this.key(e, 'surface', key), kind: 'surface', juncture: key });
      }
      const p = h.sifter.patterns.get(e.pattern)!.graph!;
      for (let edge = 0; edge < p.edges.length; edge++) for (let sign = 0; sign < 2; sign++) choices.push({ ...base,
        key: H(s('cand'), id(h.k.worldSeed), s('explain'), id(e.id), i(edge), i(sign)), kind: 'explain', edge, juncture: p.edges[edge].to });
      for (const c of choices) for (const seed of h.lv.sownBy(h.keys.decision(c.key)).sort(cmp)) {
        if (e.graph!.seeds.some((s) => s.seed === seed)) continue;
        c.realisation = h.l2.instance(seed)?.st.document.nudge ? 'nudge' : 'offer';
        this.accepted(e, c, seed); h.logGraphRepair(e.id, seed);
      }
    }
    h.state.pending = h.state.pending.filter((p) => !!h.l2.instance(p.instance));
    h.state.nudges = h.state.nudges.filter((p) => !!h.l2.instance(p.instance));
  }
  refresh(): void {
    const h = this.host;
    h.state.nudges = h.state.nudges.filter((entry) => {
      const seed = h.l2.instance(entry.instance);
      if (!seed || terminal(seed.st.state)) return false;
      if (seed.st.state === 'running' || h.l2.playTotal() - entry.sownAt <= h.data.sower.nudgeLifetime) return true;
      h.l2.sourceWithdraw(seed.id, 'nudge-lapsed', h.keys.withdraw(seed.id)); h.logGraphGate(13, seed.id, 'nudge-lapsed'); return false;
    });
    for (const e of h.state.pool.filter((e) => e.graph && !e.graph.retired && e.graph.closing === 'needed').sort((a, b) => a.seq - b.seq)) {
      if (h.k.now > (e.graph!.outcome?.at ?? e.lastTime) + h.data.sifter.candidateTtl) { e.graph!.closing = 'none'; continue; }
      if (h.k.settings.current().tempo === 'off') continue;
      const c: Candidate = { key: H(s('close3'), id(h.k.worldSeed), id(e.id)), kind: 'told', entry: e.id, pattern: e.pattern, stage: 0, features: { F3: 0, F5: 0, F6: 0, F11: 0 } };
      const choices: Kit[] = [];
      for (const [pack, index] of h.l2.packs) for (const template of index.pack.seeds) {
        const sow = template.sowable as Sowable | undefined, role = Object.keys(template.roles).find((r) => template.roles[r].kind === 'core:event' && template.roles[r].must?.some((p) => p.path === 'kind' && p.op === 'eq' && p.arg === 'meta:story'));
        if (sow?.serves.includes('recap') && sow.firstClass <= 1 && role && !sowableFindings(template, h.l2, h.kv, h.data, pack).length
          && !this.owner.excluded(template, pack, [e.story!]) && !h.kv.isSpine(e.story!)) choices.push({ pack, template, sowable: sow, overlay: { roles: { [role]: { identity: e.story! } } } });
      }
      const decision = c.key;
      const existing = h.lv.sownBy(decision).sort(cmp)[0];
      if (existing) {
        e.graph!.closing = 'sown';
        if (!e.graph!.seeds.some((s) => s.seed === existing)) e.graph!.seeds.push({ seed: existing, for: 'closing' });
        if (!h.state.pending.some((p) => p.instance === existing)) h.state.pending.push({ instance: existing, sownAt: h.l2.playTotal() });
        continue;
      }
      const recent = h.state.recent.slice(-h.data.sower.recentKits).map((r) => r.kit);
      const choice = h.keys.ranked('s3-kit', [id(c.key)], choices.map((kit) => ({ key: kit.template.id,
        score: ln(kit.sowable.weight ?? 1) - (recent.includes(kit.template.id) ? h.data.sower.kitDiversity : 0), kit })))[0]?.kit;
      if (!choice) { e.graph!.closing = 'none'; continue; }
      const req: SowRequest = { pack: choice.pack, template: choice.template.id,
        overlay: { ...choice.overlay, growsFrom: { instance: e.id, juncture: '@closing' } }, localName: c.key.slice(0, 16), decision };
      this.owner.atomic(req, (seed) => { e.graph!.seeds.push({ seed, for: 'closing' }); e.graph!.closing = 'sown'; h.state.pending.push({ instance: seed, sownAt: h.l2.playTotal() }); });
    }
  }
}

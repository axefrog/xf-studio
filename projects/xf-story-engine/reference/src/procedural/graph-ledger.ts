import { H, s } from '../id.ts';
import { GraphHistory } from './graph-history.ts';
import { instanceView } from './views.ts';
import type { Pattern } from '../seeding/pattern-types.ts';
import { realising } from '../seeding/pattern-reads.ts';
import { actingArgument } from '../seeding/pattern-lint.ts';
import { threads, terminal } from './director.ts';
import type { Layer3 } from './layer3.ts';
import type { PoolEntry, Thread, InstanceView, EventView } from './types.ts';
import { cmp } from './keys.ts';

/** Derived signs and thread projections; only perception stamps and ring entries are written. */
export class GraphLedger {
  private logged = new Map<string, string>();
  private historyIndex?: GraphHistory;
  private projectionKey = '';
  private stampKey = '';
  private projection: Thread[] = [];
  private history(): GraphHistory { return this.historyIndex ??= new GraphHistory(this.host); }
  private age(threads: Thread[], now: number): Thread[] {
    return threads.map((t) => ({ ...t, instances: [...t.instances],
      ...(t.patterns ? { patterns: [...t.patterns] } : {}), ...(t.tokens ? { tokens: [...t.tokens] } : {}), status: !t.aware ? 'unseen' : now - t.lastPresented <= this.host.data.threads.attendedWindow ? 'attended'
      : now - t.lastPresented <= this.host.data.threads.simmerWindow ? 'simmering' : 'dormant' }));
  }
  constructor(readonly host: Layer3) {}
  invalidate(): void { this.stampKey = ''; }
  reset(): void { this.logged.clear(); this.projectionKey = ''; this.invalidate(); }
  modality(channel: string): string {
    return this.host.l2.reg.channels.get(channel)?.modality ?? (['bark', 'call', 'approach'].includes(channel) ? 'audio' : 'visual');
  }
  signs(e: PoolEntry, edge: number): string[] {
    const p = this.host.sifter.patterns.get(e.pattern)?.graph, g = e.graph;
    if (!p || !g) return [];
    const link = p.edges[edge], a = g.junctures[link.from], b = g.junctures[link.to];
    if (link.link === 'forecloses' || !a?.perceived || !b?.perceived || !a.filler || !b.filler) return [];
    const signs = new Set<string>();
    const evidence = (f: NonNullable<typeof a.filler>) => 'event' in f.ref ? [f.id] : f.causes ?? [];
    for (const receipt of [...this.host.l2.global.receipts, ...this.host.l2.all().flatMap((i) => i.st.receipts)])
      if (receipt.grade !== 'ambient' && evidence(a.filler).some((id) => receipt.cites.includes(id)) && evidence(b.filler).some((id) => receipt.cites.includes(id))) for (const channel of receipt.channels) signs.add('told:' + this.modality(channel));
    const before = this.host.kv.event(a.filler.id), after = this.host.kv.event(b.filler.id);
    if (before && this.host.sifter.graph.world.acts(before, this.host.k.vId)) signs.add('own');
    if (after?.kind === 'response' && after.causes.includes(a.filler.id)) signs.add('told:response');
    return [...signs].sort(cmp);
  }
  shown(e: PoolEntry, edge: number): boolean {
    const p = this.host.sifter.patterns.get(e.pattern)!.graph!;
    return this.signs(e, edge).length >= (p.edges[edge].shown === 'must' ? 2 : 1);
  }
  debt(e: PoolEntry): number {
    const p = this.host.sifter.patterns.get(e.pattern)!.graph!, g = e.graph!;
    return p.edges.filter((edge, i) => edge.link !== 'forecloses' && g.junctures[edge.from].filler && g.junctures[edge.to].filler
      && g.junctures[edge.from].perceived && !this.shown(e, i)).length;
  }
  aware(e: PoolEntry): boolean {
    const p = this.host.sifter.patterns.get(e.pattern)?.graph, g = e.graph;
    if (!g) {
      // S3 2.2b: show only the final juncture of a completed stage chain.
      const last = e.complete && e.stages.at(-1);
      const exposure = last ? this.host.l2.exposure(last.event) : undefined;
      return !!exposure && exposure.grade !== 'ambient';
    }
    return !!p && !!g && p.show.junctures.every((k) => g.junctures[k]?.perceived)
      && p.edges.filter((_, i) => this.shown(e, i)).length >= p.show.edges;
  }
  refresh(internal = false): Thread[] {
    const h = this.host, pool = h.state.pool.filter((e) => e.graph && !e.graph.retired && e.graph.state !== 'lapsed'), now = h.l2.playTotal();
    const history = this.history(); history.refresh();
    // Terminal history stays in S2's archive, outside the projection. Fingerprint only live or
    // closing consumers, the bounded pool, and edits seen by the incremental evidence index.
    const consumers = h.l2.all().filter((i) => !terminal(i.st.state) || i.st.deliveries.some((d) => ['closing', 'coda'].includes(d.what) && ['queued', 'released'].includes(d.state)));
    const stamp = () => JSON.stringify([h.k.now, h.k.revision, history.version, h.state.skeletons,
      consumers.map((i) => [i.id, i.st]), h.data]);
    const key = () => JSON.stringify([h.k.now, h.state.pool, h.state.skeletons, consumers.map((i) => [i.id, i.st]), history.version,
      [...h.sifter.patterns.values()], h.l2.reg.vocabulary, [...h.l2.reg.channels], h.data]);
    // An overfull ring deliberately replays missing members in projection order, as before.
    const ringComplete = this.projection.every((t) => !t.tokens?.length || h.state.skeletons.ring.some((r) => r.thread === t.id
      && r.tokens.length >= Math.min(t.tokens!.length, h.data.sower.skeletonTokens)));
    if (ringComplete && internal && this.stampKey && this.stampKey === stamp()) return this.age(this.projection, now);
    if (ringComplete && this.projectionKey === key()) { this.stampKey = stamp(); return this.age(this.projection, now); }
    h.invalidatePool();
    const gained = new Set<string>();
    const byStory = new Map<string, PoolEntry[]>();
    for (const e of h.state.pool) if (e.story && (!e.graph || !e.graph.retired && e.graph.state !== 'lapsed')) {
      if (!byStory.has(e.story)) byStory.set(e.story, []);
      byStory.get(e.story)!.push(e);
    }
    // Child stories can become visible during this refresh; bounded fixed point, never recursive reads.
    for (let pass = 0; pass < h.data.sifter.lineageDepth; pass++) for (const e of pool) {
      const p = h.sifter.patterns.get(e.pattern)!.graph!, g = e.graph!;
      for (const [key, j] of Object.entries(g.junctures)) {
        if (!j.filler || j.perceived) continue;
        let exposure = h.l2.exposure(j.filler.id);
        if (j.filler.fn === 'story') {
          const child = byStory.get(j.filler.id)?.[0];
          if (child && this.aware(child)) exposure = { grade: 'presented', at: child.graph
            ? Math.max(...Object.values(child.graph.junctures).flatMap((x) => x.perceived ? [x.perceived.at] : []))
            : h.l2.exposure(child.stages.at(-1)!.event)!.at };
        } else if (!('event' in j.filler.ref)) {
          exposure = (j.filler.causes ?? []).map((n) => h.l2.exposure(n)).filter((x) => x && x.grade !== 'ambient').sort((a, b) => a!.at - b!.at)[0];
        }
        if (exposure && exposure.grade !== 'ambient') { j.perceived = { at: exposure.at, play: now }; gained.add(e.id); }
        const pending = j.pending && h.l2.instance(j.pending);
        if (j.state === 'pending' && (!pending || terminal(pending.st.state))) { j.state = 'ready'; j.pending = undefined; }
        void key;
      }
      if (['forming', 'live'].includes(g.state)) for (const key of Object.keys(p.junctures)) {
        const state = g.junctures[key];
        if (!['open', 'ready', 'pending'].includes(state.state)) continue;
        const seed = realising(h.l2, p.id, key).find((r) => Object.values(p.junctures[key].args)
          .filter((v) => v.startsWith('?') && e.bindings[v]).every((v) => r.binds[v] === e.bindings[v]));
        if (seed) { state.state = 'pending'; state.pending = seed.seed; if (!g.seeds.some((s) => s.seed === seed.seed)) g.seeds.push({ seed: seed.seed, for: key }); }
        else if (state.state === 'pending' && (!state.pending || !h.l2.instance(state.pending) || terminal(h.l2.instance(state.pending)!.st.state))) { state.state = 'ready'; state.pending = undefined; }
      }
    }
    const all = consumers.filter((i) => !i.st.document.nudge).map(instanceView), base = threads(all, now, h.data);
    const closing = new Set(h.state.pool.flatMap((e) => e.graph?.seeds.filter((s) => s.for === 'closing').map((s) => s.seed) ?? []));
    for (const i of all) if (i.growsFrom?.juncture === '@closing') closing.add(i.id);
    const budgetBase = threads(all.filter((i) => !closing.has(i.id)), now, h.data);
    const byId = new Map(all.map((i) => [i.id, i])), baseBySeed = new Map(budgetBase.flatMap((t) => t.instances.map((id) => [id, t] as const)));
    const poolIds = new Set(pool.map((e) => e.id)), grown = new Map<string, string[]>();
    for (const i of all) if (i.growsFrom?.instance) {
      const parent = i.growsFrom.instance;
      if (!grown.has(parent)) grown.set(parent, []);
      grown.get(parent)!.push(i.id);
    }
    const parents = new Map<string, string>();
    const root = (id: string): string => { if (!parents.has(id)) parents.set(id, id); let r = id; while (parents.get(r) !== r) r = parents.get(r)!; return r; };
    const union = (a: string, b: string) => { a = root(a); b = root(b); parents.set(cmp(a, b) < 0 ? b : a, cmp(a, b) < 0 ? a : b); };
    for (const t of base) for (const id of t.instances) union(t.id, id);
    const stageChildren = new Map<string, PoolEntry>();
    for (const e of pool) {
      root(e.id);
      for (const seed of e.graph!.seeds) if (byId.has(seed.seed)) union(e.id, seed.seed);
      for (const id of grown.get(e.id) ?? []) union(e.id, id);
      for (const layer of e.graph!.layers) if (layer.cross && poolIds.has(layer.with)) union(e.id, layer.with);
      for (const j of Object.values(e.graph!.junctures)) if (j.filler)
        for (const child of byStory.get(j.filler.id) ?? []) if (child.id !== e.id) {
          union(e.id, child.id);
          if (!child.graph) {
            stageChildren.set(child.id, child);
            if (child.seed && byId.has(child.seed)) union(child.id, child.seed);
          }
        }
    }
    const groups = new Map<string, { seeds: string[]; members: InstanceView[]; entries: PoolEntry[] }>();
    for (const i of all) { const r = root(i.id); if (!groups.has(r)) groups.set(r, { seeds: [], members: [], entries: [] }); groups.get(r)!.seeds.push(i.id); groups.get(r)!.members.push(i); }
    for (const e of pool) { const r = root(e.id); if (!groups.has(r)) groups.set(r, { seeds: [], members: [], entries: [] }); groups.get(r)!.entries.push(e); }
    for (const key of this.logged.keys()) if (!groups.has(key)) this.logged.delete(key);
    const result: Thread[] = [];
    for (const [id, group] of [...groups].sort(([a], [b]) => cmp(a, b))) {
      const members = group.members, bs = [...new Set(group.seeds.flatMap((id) => baseBySeed.get(id) ?? []))];
      const stamps = group.entries.filter((e) => this.aware(e)).flatMap((e) => Object.values(e.graph!.junctures).flatMap((j) => j.perceived ? [j.perceived.play] : []));
      const lastPresented = Math.max(-Infinity, ...stamps, ...bs.map((t) => t.lastPresented));
      const aware = bs.some((t) => t.aware) || stamps.length > 0;
      const responses = members.flatMap((i) => i.responses).filter((r) => r.kind.startsWith('action:'));
      const nodes = new Set([...group.entries.flatMap((e) => Object.values(e.bindings)), ...members.flatMap((i) => Object.values(i.roles).flatMap((r) => r.cast ?? []))].filter((n) => n !== h.k.vId));
      const pullAt = Math.max(-Infinity, ...responses.map((r) => r.game), ...members.flatMap((i) => {
        const st = h.l2.instance(i.id)!.st;
        return st.deliveries.filter((d) => d.pull).flatMap((d) => st.receipts.filter((r) => r.delivery === d.id && r.grade !== 'ambient').map((r) => r.presentedAt ?? r.at));
      }), ...[...nodes].map((node) => history.actTimes.get(node) ?? -Infinity));
      const t: Thread = { id, instances: group.seeds, patterns: [...group.entries.map((e) => e.id),
        ...[...stageChildren.values()].filter((e) => root(e.id) === id).map((e) => e.id)], aware, lastPresented, pullAt,
        engineSown: members.some((i) => !closing.has(i.id)) && members.filter((i) => !closing.has(i.id)).every((i) => i.source.by === 'director'),
        active: members.some((i) => !terminal(i.state)) || group.entries.some((e) => ['live', 'forming', 'aftermath'].includes(e.graph!.state)),
        live: bs.some((t) => t.live),
        climactic: bs.some((t) => t.climactic), status: !aware ? 'unseen' : now - lastPresented <= h.data.threads.attendedWindow ? 'attended' : now - lastPresented <= h.data.threads.simmerWindow ? 'simmering' : 'dormant' };
      for (const e of group.entries) if (h.sifter.patterns.get(e.pattern)!.graph!.family === 'shape' && e.graph!.state === 'forming'
        && Object.values(e.graph!.junctures).filter((j) => j.perceived).length >= 2 && pullAt > -Infinity
        && pool.filter((x) => h.sifter.patterns.get(x.pattern)!.graph!.family === 'shape' && x.graph!.state === 'live').length < h.data.sifter.maxLiveShapes) e.graph!.state = 'live';
      t.tokens = this.tokenRows(t, history);
      const last = group.entries.filter((e) => e.graph!.outcome).sort((a, b) => b.graph!.outcome!.at - a.graph!.outcome!.at || b.seq - a.seq)[0];
      if (!t.active && last) t.tokens.push(`end:${last.graph!.outcome!.kind}/${last.pattern.split(':').pop()}`);
      const encoded = JSON.stringify(t.tokens);
      if (t.tokens.length && this.logged.get(t.id) !== encoded) { this.logged.set(t.id, encoded); h.writeSkeleton(t); }
      const hashes = t.tokens.map((token) => H(s('tok'), s(token.replace(/\/(help|bargain|oppose|refuse)$/, '')))).slice(0, h.data.sower.skeletonTokens);
      const ring = h.state.skeletons.ring, prior = ring.find((r) => r.thread === id);
      // Token differences may also arise from a newly presented member seed. No removals rewrite history.
      if (hashes.length && (group.entries.some((e) => gained.has(e.id)) || hashes.length > (prior?.tokens.length ?? 0))
        && JSON.stringify(hashes) !== JSON.stringify(prior?.tokens)) {
        h.state.skeletons.ring = ring.filter((r) => r.thread !== id).concat({ thread: id, tokens: hashes, play: now, seq: h.state.skeletons.seq++ })
          .sort((a, b) => a.seq - b.seq).slice(-h.data.sower.skeletonRing);
      }
      result.push(t);
    }
    this.projectionKey = key();
    this.projection = this.age(result, now);
    this.stampKey = stamp();
    return result;
  }
  tokens(t: Thread, predicted?: { id: string; fn: string; args: Record<string, string>; link?: string }): string[] {
    const history = this.history(); history.refresh();
    return this.tokenRows(t, history, predicted);
  }
  private tokenRows(t: Thread, history: GraphHistory, predicted?: { id: string; fn: string; args: Record<string, string>; link?: string }): string[] {
    const h = this.host, rows = new Map<string, { id: string; at: number; play: number; fn: string; args: Record<string, string>; stance?: string }>();
    const canonical = (ev: EventView) => {
      const precedence = h.l2.reg.vocabulary?.tokenPrecedence ?? [];
      return (h.k.eventKinds.eventKind(ev.kind)?.fills ?? []).map((decl) => ({ fn: decl.fn,
        args: Object.fromEntries(Object.entries(decl.args).flatMap(([a, role]) => {
          const n = role === '@self' ? ev.id : role === '@place' ? ev.place : role.split('|').map((r) => ev.participants.find((p) => p.role === r)?.who).find(Boolean);
          return n ? [[a, n]] : [];
        })) })).sort((a, b) => precedence.indexOf(a.fn) - precedence.indexOf(b.fn))[0];
    };
    for (const e of h.state.pool.filter((e) => e.graph && !e.graph.retired && t.patterns?.includes(e.id))) for (const j of Object.values(e.graph!.junctures)) {
      const f = j.filler;
      if (!f || !j.perceived || f.fn === 'story') continue;
      const ev = h.kv.event(f.id), first = ev ? canonical(ev) ?? f : f;
      rows.set(f.id, { id: f.id, at: j.perceived.at, play: j.perceived.play, fn: first.fn, args: first.args });
    }
    for (const seed of t.instances) {
      const i = h.l2.instance(seed); if (!i) continue;
      for (const r of i.st.record.filter((r) => r.kind === 'response' && typeof r.data.event === 'string')) {
        const ev = h.kv.event(String(r.data.event)), first = ev && canonical(ev);
        if (!ev || !first) continue;
        rows.set(ev.id, { id: ev.id, at: ev.time, play: r.playTotal, fn: first.fn, args: first.args,
          stance: String(r.data.kind).startsWith('decline:') ? 'refuse' : typeof r.data.stance === 'string' ? r.data.stance : undefined });
      }
      for (const d of i.st.deliveries) {
        const receipt = i.st.receipts.find((r) => r.delivery === d.id && r.grade !== 'ambient');
        if (!receipt) continue;
        if (d.offerEvent) {
          const ev = h.kv.event(d.offerEvent), f = ev && h.sifter.graph.world.eventFills(ev).find((f) => f.fn === 'ask');
          if (ev && f) rows.set(ev.id, { id: ev.id, at: ev.time, play: receipt.playTotal, fn: f.fn, args: f.args });
          continue;
        }
        if (receipt.cites.some((n) => rows.has(n))) continue;
        const f = d.beat ? h.l2.beatFunction(seed, d.beat) : undefined;
        if (f) rows.set(d.offerEvent ?? d.id, { id: d.offerEvent ?? d.id, at: receipt.presentedAt ?? receipt.at, play: receipt.playTotal, ...f });
      }
    }
    if (predicted && !rows.has(predicted.id)) rows.set(predicted.id, { ...predicted, at: Number.MAX_SAFE_INTEGER, play: Number.MAX_SAFE_INTEGER });
    const ordered = [...rows.values()].sort((a, b) => a.at - b.at || a.play - b.play || cmp(a.id, b.id)), masks = new Map<string, string>(), counts = new Map<string, number>();
    const mask = (n: string): string => {
      if (n === h.k.vId) return 'P'; if (masks.has(n)) return masks.get(n)!;
      const kind = h.kv.kind(n), known = history.knownTimes.get(n);
      const prefix = kind && h.kv.isKind(kind, 'core:person') ? known !== undefined && known < (ordered[0]?.at ?? 0) ? 'K' : 'N'
        : kind && h.kv.isKind(kind, 'core:group') ? 'G' : kind && h.kv.isKind(kind, 'core:place') ? 'L' : 'I';
      const index = (counts.get(prefix) ?? 0) + 1; counts.set(prefix, index); masks.set(n, prefix + index); return prefix + index;
    };
    return ordered.map((r) => {
      const spec = h.l2.reg.vocabulary?.functions[r.fn];
      const args = Object.entries(spec?.args ?? {}).filter(([, kind]) => !['event', 'fact', 'pattern id', 'outcome name'].includes(String(kind))).map(([a]) => r.args[a] ? mask(r.args[a]) : '?');
      const links = ['because', 'but', 'motive', 'reveals', 'enables', 'answers'];
      const incoming = h.state.pool.filter((e) => t.patterns?.includes(e.id)).flatMap((e) => {
        const p = h.sifter.patterns.get(e.pattern)?.graph;
        return p?.edges.filter((edge) => e.graph?.junctures[edge.to].filler?.id === r.id
          && ordered.slice(0, ordered.indexOf(r)).some((v) => v.id === e.graph?.junctures[edge.from].filler?.id)).map((edge) => edge.link) ?? [];
      });
      const link = r.id === predicted?.id ? predicted.link : links.find((l) => incoming.includes(l as never));
      return `${r.fn}(${args.join(',')})${link ? '<' + link : ''}${r.stance ? '/' + r.stance : ''}`;
    });
  }
  prediction(t: Thread | undefined, e: PoolEntry, key: string): string[] {
    const p = this.host.sifter.patterns.get(e.pattern)!.graph!, j = p.junctures[key], source = this.strongest(p, e, key);
    const edge = source ? p.edges.find((x) => x.from === source && x.to === key && e.graph!.junctures[source].perceived) : undefined;
    return this.tokens(t ?? { id: e.id, instances: [], patterns: [], aware: false, lastPresented: 0, engineSown: false, active: true, live: false, climactic: false, status: 'unseen' },
      { id: '@prediction', fn: j.fn, args: Object.fromEntries(Object.entries(j.args).map(([a, v]) => [a, e.bindings[v] ?? ''])), link: edge?.link });
  }
  strongest(p: Pattern, e: PoolEntry, key: string): string | undefined {
    return p.edges.filter((x) => x.to === key && e.graph!.junctures[x.from].filler && x.link !== 'forecloses')
      .sort((a, b) => ['because', 'but', 'motive', 'reveals', 'enables', 'answers'].indexOf(a.link) - ['because', 'but', 'motive', 'reveals', 'enables', 'answers'].indexOf(b.link))[0]?.from;
  }
}

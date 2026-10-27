import { H, s } from '../id.ts';
import { hrec } from '../canon.ts';
import { Sim } from '../sim/sim.ts';
import { makeKabukiSlice } from '../sim/slices.ts';
import { defaultData } from '../sim/data.ts';
import { People } from '../sim/people.ts';
import { ReplayPort, type ReplayLine } from '../sim/port.ts';
import { HolotableObserver } from '../holotable/observe.ts';
import { schematicLayout } from '../holotable/layout.ts';
import { RunPublisher } from '../../tools/holotable/publish-run.ts';
import { ShadowClock } from './clock.ts';
import type { Actor, Batch, FeedSession, HoloReader, WorldPack } from './feed.ts';
import { districtAt } from '../../../../xf-holotable/src/world.ts';
import type { IncidentCoverage, IncidentReport, TimelineEvent } from '../../../../xf-holotable/src/model.ts';

const vec = (x: unknown): x is [number, number, number] => Array.isArray(x) && x.length === 3 && x.every(Number.isFinite);
const ABSENT = ['actors.record', 'actors.affiliation', 'actors.crowd', 'deaths', 'combat events', 'crimes'];
const MAPPED_CHANNELS = new Set(['v', 'actors', 'incidents']);
const RAW_INCIDENT_KINDS = ['game.incident', 'game.witness.report'];

/** Feed adapter only: no bridge, seeding arbiter, staging or delivery port. */
export class ShadowHost {
  readonly sim: Sim;
  readonly port: ReplayPort;
  readonly observer: HolotableObserver;
  readonly publisher: RunPublisher;
  readonly clock: ShadowClock;
  readonly unmapped: Record<string, number> = {};
  readonly session: FeedSession;
  private entities = new Map<string, string>();
  private actorFacts = new Map<string, Actor>();
  private brokenActors = new Set<string>();
  private actorGapUntil = -Infinity;
  private publishedActors = new Set<string>();
  private incidents = new Set<string>();
  private mapped: Record<string, number> = {};
  private incidentReceipts: Array<{ t: number; seq: number; receipt: IncidentReport | IncidentCoverage }> = [];
  private lastSource = -Infinity;
  private lastGame = 0;
  private publishedDerived = true;
  private windows = 0;
  private observations = 0;
  private inputs = 0;
  private durationMs = 0;
  private advanceMs = 0;
  private publishMs = 0;
  private maxWindowMs = 0;
  private pendingReadings: Array<{ node: string; slot: string }> = [];
  private coalesced = new Map<string, Extract<ReplayLine, { op: 'reading' }>>();
  private readonly layout;
  constructor(readonly reader: HoloReader, readonly world: WorldPack, meta: Batch['meta'], out: string, defaultStart = 0, initialGameTime = defaultStart) {
    this.session = { meta: structuredClone(meta), v: [], camera: [], events: [], gaps: [], actors: [] };
    this.clock = new ShadowClock(meta, defaultStart);
    const index = makeKabukiSlice();
    this.layout = schematicLayout(index, world.areas);
    for (const [id, region] of this.layout.districts) {
      const area = world.areas.find(a => a.id === region)!;
      index.districts[id].polygon = area.poly; index.districts[id].zBand = [area.zlo, area.zhi];
    }
    const { hash: _fixtureHash, ...locatedIndex } = index;
    index.hash = H(s('world-index'), hrec(locatedIndex as unknown as Record<string, unknown>));
    const data = defaultData(); data.mirror.raw.push('game.incident', 'game.witness.report');
    this.sim = Sim.create({ worldSeed: H(s('shadow-v0'), s(meta.session), s(String(meta.run))), index, data,
      now: Math.floor(initialGameTime / data.time.W) * data.time.W });
    this.sim.startAt(Math.floor(initialGameTime / data.time.W));
    // S1Data.mirror.raw does not extend the schema or registries. Admit these
    // evidence-only kinds on this host's schema instance, never on engine globals.
    const dim = this.sim.k.schema.dim('core:event-kind');
    if (dim.value.t !== 'enum') throw Error('Expected event-kind enum');
    this.sim.k.schema.dims.set(dim.id, { ...dim, value: { ...dim.value, values: [...dim.value.values, ...RAW_INCIDENT_KINDS] } });
    for (const name of RAW_INCIDENT_KINDS) {
      const def = { ...this.sim.w.kinds.get('game.combat.end')!, name, effects: [], fills: [], producers: ['port'] };
      this.sim.w.kinds.kinds.set(name, def);
      this.sim.k.eventKinds.register({ name, tags: [], producers: ['port'], roles: [], fills: [] });
    }
    this.port = new ReplayPort(this.sim);
    this.observer = new HolotableObserver(this.sim, undefined, undefined, { gameEpochSeconds: 0, layout: this.layout, entities: this.entities });
    this.publisher = new RunPublisher(out, { mode: 'recording', session: meta.session, run: meta.run, from: meta.start, to: Number.MAX_SAFE_INTEGER, schematic: true });
  }
  private count(key: string, n = 1) { if (n) this.unmapped[key] = (this.unmapped[key] ?? 0) + n; }
  key(who: string): string { return `shadow:${this.session.meta.session}:${this.session.meta.run}:${who}`; }
  /** Regions are real polygons; grid XY comes from the writer. Its drawing slab
   * is deliberately not a navigability/elevation test. */
  locate(position: [number, number, number]): { district?: string; cell?: string } {
    const region = districtAt(this.world.areas, position)?.id;
    const district = [...this.layout.districts].find(([, id]) => id === region)?.[0];
    if (!district) return {};
    const ids = [...(this.sim.w.index.districts[district]?.cellIds ?? [])].sort();
    const cell = ids.find(id => { const b = this.layout.cells.get(id)!.box; return position[0] >= b.min[0] && position[0] <= b.max[0] && position[1] >= b.min[1] && position[1] <= b.max[1]; });
    return { district, cell };
  }
  private submit(lines: ReplayLine[]) {
    // The port stamps whole seconds. Keep the latest source reading for each
    // node/slot/second until its window closes, including across live batches.
    for (const line of lines) {
      if (line.op === 'person') {
        for (const [slot, value] of Object.entries(line.slots)) this.submit([{ t: line.t, op: 'reading', node: line.key, slot, value }]);
      } else if (line.op === 'reading') this.coalesced.set(JSON.stringify([line.node, line.slot, line.t]), line);
      else throw Error('Shadow input must be a reading');
    }
  }
  private flushReadings() {
    const lines = [...this.coalesced.values()]; this.coalesced.clear();
    this.inputs += lines.length; this.port.submit(lines);
    for (const line of lines) this.pendingReadings.push({ node: line.node === 'v' ? this.sim.w.vState : this.port.node(line.node), slot: line.slot });
  }
  /** Game readings are historical evidence and cannot be withdrawn. Revoke the
   * current projection instead, using the writer's branch-aware tombstones. */
  private breakActors(ids: Iterable<string>, qpc: number) {
    let published = false;
    for (const id of ids) {
      this.entities.delete(id);
      if (this.brokenActors.has(id)) continue;
      this.brokenActors.add(id);
      published ||= this.publishedActors.has(id);
    }
    if (published) this.publish(qpc, this.publishedDerived, true);
  }
  private incident(event: TimelineEvent, stamp: number) {
    const receipt = event.incident;
    if (!receipt) { this.count('incident payload absent'); return; }
    if (receipt.event !== 'witness.report') {
      this.count(`incident event:${receipt.event}`);
      // Coverage values are gauges/counters from the source, not quantities to
      // sum across heartbeats. Keep each receipt, including zero/false values.
      this.incidentReceipts.push({ t: event.t, seq: event.seq, receipt: structuredClone(receipt) });
      return;
    }
    const position = receipt.place?.position ?? receipt.declared?.at ?? event.at;
    const place = vec(position) ? this.locate(position) : {};
    // Native participant roles are not S1's role vocabulary. Do not guess a
    // conversion or use participant records as actor-track readings.
    this.count('incident participant roles', receipt.participants?.reduce((n, p) => n + p.roles.length, 0) ?? 0);
    const raw = (kind: string) => {
      this.port.submit([{ t: stamp, op: 'event', kind, place: place.cell ?? place.district, participants: [] }]);
      this.inputs++; this.mapped[kind] = (this.mapped[kind] ?? 0) + 1;
    };
    // Observation time follows the same feed clock as readings. Native sim
    // intervals are not QPC, and delayed reports never rewind the host clock.
    if (receipt.incident && !this.incidents.has(receipt.incident)) {
      this.incidents.add(receipt.incident); raw('game.incident');
    } else if (!receipt.incident) this.count('witness report without incident id');
    raw('game.witness.report');
  }
  consume(batch: Batch): void {
    // The process-global population memo can skip materialising slot caches in
    // a later world. Those caches are intentionally visible to the observer.
    // Equal cold policy per run keeps output independent of previous runs in
    // this process, without changing the engine or another host's policy.
    const shared = People.shared;
    People.shared = false;
    try { this.applyBatch(batch); } finally { People.shared = shared; }
  }
  private applyBatch(batch: Batch): void {
    const started = performance.now();
    if (batch.meta.session !== this.session.meta.session || batch.meta.run !== this.session.meta.run || batch.meta.worldGeneration !== this.session.meta.worldGeneration) throw Error('Live identity changed; use a fresh output directory');
    this.session.meta = structuredClone(batch.meta);
    this.count('camera samples', batch.camera.length);
    for (const e of batch.events) if (e.kind !== 'incident') this.count(`timeline event:${e.kind}`);
    this.count('V non-position fields (yaw, speed, health, combat flag, vehicle, busy)', batch.v.length);
    this.session.gaps.push(...batch.gaps);
    const entries = [
      // Revoke actors before any window inside the known missing interval can
      // publish their old readings. The end of a gap is not a reobservation.
      ...batch.gaps.map(g => ({ t: g.from, rank: 0, value: g, type: 'gap' as const })),
      ...batch.v.map(v => ({ t: v.t, rank: 1, value: v, type: 'v' as const })),
      ...batch.actors.map(a => ({ t: a.t, rank: 2, value: a, type: 'actor' as const })),
      ...batch.events.filter(e => e.kind === 'incident').map(e => ({ t: e.t, rank: 3, value: e, type: 'incident' as const })),
    ].sort((a, b) => a.t - b.t || a.rank - b.rank);
    let i = 0;
    while (i < entries.length) {
      const qpc = entries[i].t;
      const group = []; while (i < entries.length && entries[i].t === qpc) group.push(entries[i++]);
      // Live polls can deliver breaks before the affected delta, without V.
      // A gap alone changes neither the V track nor the simulation clock.
      for (const entry of group) {
        if (entry.type === 'gap') {
          this.actorGapUntil = Math.max(this.actorGapUntil, entry.value.to);
          this.breakActors(this.actorFacts.keys(), qpc);
        }
        else if (entry.type === 'actor' && !entry.value.valid) {
          const id = this.port.node(this.key(entry.value.who));
          this.actorFacts.set(id, entry.value); this.breakActors([id], qpc);
          this.count('actor invalid');
        }
      }
      const driving = group.filter(x => x.type === 'v' || x.type === 'incident' || x.type === 'actor' && x.value.valid);
      if (!driving.length) continue;
      if (qpc < this.lastSource) throw Error('Feed time went backwards');
      const v = group.find(x => x.type === 'v');
      const time = this.clock.at(qpc, v?.type === 'v' ? v.value.gameTime : undefined, !v);
      while ((this.sim.windowNow() + 1) * this.sim.data.time.W <= time.game) {
        const windowStart = performance.now();
        this.flushReadings();
        this.sim.advance(1); this.windows++;
        const advanced = performance.now(); this.advanceMs += advanced - windowStart;
        for (const r of this.pendingReadings) this.sim.k.value(r.node, r.slot);
        this.pendingReadings = [];
        this.publish(qpc, time.derived);
        const finished = performance.now(); this.publishMs += finished - advanced;
        this.maxWindowMs = Math.max(this.maxWindowMs, finished - windowStart);
      }
      const stamp = Math.floor(time.game);
      for (const entry of driving) {
        if (entry.type === 'v') {
          // snapshotAt remains the authority for V. Only its current sample is
          // needed; retaining/rebuilding a replay trail here would be quadratic.
          this.session.v = [entry.value];
          const sampled = this.reader.snapshotAt(this.session, qpc, 'full', this.world).v;
          if (!sampled || sampled.stale || !vec(sampled.position)) { this.count('V stale or invalid'); continue; }
          const place = this.locate(sampled.position);
          // A declared invalid id clears old cell/district readings when V leaves
          // the index, instead of silently retaining the last known location.
          const unknown = '0'.repeat(32);
          this.submit([{ t: stamp, op: 'reading', node: 'v', slot: 'position', value: sampled.position },
            { t: stamp, op: 'reading', node: 'v', slot: 'district', value: place.district ?? unknown },
            { t: stamp, op: 'reading', node: 'v', slot: 'cell', value: place.cell ?? unknown }]);
          if (!place.district) this.count('V outside simulation index');
          else if (!place.cell) this.count('V in real district without simulation cells');
        } else if (entry.type === 'actor') {
          const actor = entry.value, key = this.key(actor.who), id = this.port.node(key);
          this.actorFacts.set(id, actor);
          if (actor.entity) this.entities.set(id, actor.entity); else this.entities.delete(id);
          if (vec(actor.position)) {
            // A valid sample at the left endpoint belongs to the old trail;
            // only a reobservation at/after the gap's end restores visibility.
            if (qpc < this.actorGapUntil) this.breakActors([id], qpc);
            else this.brokenActors.delete(id);
            this.submit([{ t: stamp, op: 'person', key, slots: { position: actor.position } }]);
          } else { this.breakActors([id], qpc); this.count('actor position absent'); }
        } else if (entry.type === 'incident') {
          this.incident(entry.value, stamp);
        }
      }
      this.lastSource = qpc; this.lastGame = time.game; this.observations++;
    }
    this.durationMs += performance.now() - started;
  }
  private publish(qpc: number, derived: boolean, peopleOnly = false) {
    if (!peopleOnly) this.publishedDerived = derived;
    const observation = this.observer.sample(), game = observation.t; observation.t = qpc;
    for (const [layer, items] of observation.layers) {
      if (peopleOnly && layer !== 'people' && !layer.startsWith('people-')) { observation.layers.delete(layer); continue; }
      if (layer === 'people' || layer.startsWith('people-')) {
        observation.layers.set(layer, items.filter(item => !this.brokenActors.has(item.id)));
        for (const item of observation.layers.get(layer)!) if (this.actorFacts.has(item.id)) this.publishedActors.add(item.id);
      }
    }
    for (const items of observation.layers.values()) for (const item of items) {
      const interval = item.until === undefined ? undefined : `${item.t} to ${item.until}`;
      item.t = qpc; delete item.until;
      const [caption, ...facets] = Object.entries(item.facets ?? {});
      // Keep the caption first and the clock second, even when the common
      // publisher bounds a verbose diagnostic item's remaining facets.
      const publishedFacets: Record<string, string> = Object.fromEntries([...(caption ? [caption] : []),
        [derived ? 'game time (derived)' : 'game time', String(game)],
        ...(interval ? [['game interval', interval]] : []), ...facets]);
      item.facets = publishedFacets;
      const actor = this.actorFacts.get(item.id);
      if (actor) {
        publishedFacets.handle = actor.who;
        item.value = { name: 'Unidentified person', role: 'not recorded' };
        if (!actor.entity) item.anchor = vec(actor.position) ? { at: actor.position } : { region: 'unplaced' };
      }
      if (item.id === this.sim.w.v) {
        const cached = this.sim.k.store.nodes.get(this.sim.w.vState)?.slots.get('position');
        if (cached?.s === 'resolved' && vec(cached.value)) item.anchor = { at: cached.value };
      }
    }
    for (const records of observation.retractions?.values() ?? []) for (const r of records) r.t = qpc;
    this.publisher.publish(observation);
  }
  summary() {
    return { schema: 'xfse/shadow-summary-1', session: this.session.meta.session, run: this.session.meta.run,
      clock: [...this.clock.rules].sort(), defaultGameStart: this.clock.defaultStart, windows: this.windows, observations: this.observations, inputs: this.inputs,
      pendingInputs: this.sim.k.evolution.queued.length + this.coalesced.size, gameThrough: this.sim.k.now, lastObservedGameTime: this.lastGame,
      counts: this.publisher.counts(), unmapped: Object.fromEntries(Object.entries(this.unmapped).sort()),
      absentFromRecorder: ABSENT,
      unmappedSourceChannels: this.session.meta.channels.filter(c => !MAPPED_CHANNELS.has(c.name)).map(c => c.name).sort(),
      unmappedActorFields: ['yaw', 'command_state', 'prepared'],
      mapped: Object.fromEntries(Object.entries(this.mapped).sort()), incidentReceipts: this.incidentReceipts,
      coverage: { complete: this.session.meta.complete, dropped: this.session.meta.dropped, gaps: this.session.gaps.length, problems: this.session.meta.problems,
        channels: this.session.meta.channels.map(c => ({ ...c, reasons: Object.fromEntries(Object.entries(c.reasons).sort()) })).sort((a, b) => a.name.localeCompare(b.name)) },
      performance: { windows: this.windows, adapterMs: this.durationMs, advanceMs: this.advanceMs, publishMs: this.publishMs, maxWindowMs: this.maxWindowMs } };
  }
}

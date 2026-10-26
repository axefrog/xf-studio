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

const vec = (x: unknown): x is [number, number, number] => Array.isArray(x) && x.length === 3 && x.every(Number.isFinite);
const ABSENT = ['actors.record', 'actors.affiliation', 'actors.crowd', 'deaths', 'combat events', 'crimes'];
const MODELED_CHANNELS = new Set(['v', 'actors', 'camera', 'supervisor', 'contacts', 'subtitles', 'voice']);

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
  private lastSource = -Infinity;
  private lastGame = 0;
  private windows = 0;
  private observations = 0;
  private inputs = 0;
  private durationMs = 0;
  private advanceMs = 0;
  private publishMs = 0;
  private maxWindowMs = 0;
  private pendingReadings: Array<{ node: string; slot: string }> = [];
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
    // Reserved raw evidence kinds, host-only, with no fills/effects. S1's data
    // shape has no custom raw definitions; register through the public registries.
    // They await Holotable's typed-incident contract; no invented incident input.
    for (const name of ['game.incident', 'game.witness.report']) {
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
    this.inputs += lines.length; this.port.submit(lines);
    for (const line of lines) if (line.op === 'reading') this.pendingReadings.push({ node: line.node === 'v' ? this.sim.w.vState : this.port.node(line.node), slot: line.slot });
    else if (line.op === 'person') for (const slot of Object.keys(line.slots)) this.pendingReadings.push({ node: this.port.node(line.key), slot });
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
    for (const e of batch.events) this.count(`timeline event:${e.kind}`);
    this.count('V non-position fields (yaw, speed, health, combat flag, vehicle, busy)', batch.v.length);
    this.session.gaps.push(...batch.gaps);
    const entries = [
      ...batch.v.map(v => ({ t: v.t, rank: 1, value: v, type: 'v' as const })),
      ...batch.actors.map(a => ({ t: a.t, rank: 2, value: a, type: 'actor' as const })),
    ].sort((a, b) => a.t - b.t || a.rank - b.rank);
    let i = 0;
    while (i < entries.length) {
      const qpc = entries[i].t;
      if (qpc < this.lastSource) throw Error('Feed time went backwards');
      const group = []; while (i < entries.length && entries[i].t === qpc) group.push(entries[i++]);
      const v = group.find(x => x.type === 'v');
      const time = this.clock.at(qpc, v?.type === 'v' ? v.value.gameTime : undefined, !v);
      while ((this.sim.windowNow() + 1) * this.sim.data.time.W <= time.game) {
        const windowStart = performance.now();
        this.sim.advance(1); this.windows++;
        const advanced = performance.now(); this.advanceMs += advanced - windowStart;
        for (const r of this.pendingReadings) this.sim.k.value(r.node, r.slot);
        this.pendingReadings = [];
        this.publish(qpc, time.derived);
        const finished = performance.now(); this.publishMs += finished - advanced;
        this.maxWindowMs = Math.max(this.maxWindowMs, finished - windowStart);
      }
      const stamp = Math.floor(time.game);
      for (const entry of group) {
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
        } else {
          const actor = entry.value, key = this.key(actor.who), id = this.port.node(key);
          this.actorFacts.set(id, actor);
          if (actor.entity) this.entities.set(id, actor.entity); else this.entities.delete(id);
          if (vec(actor.position)) this.submit([{ t: stamp, op: 'person', key, slots: { position: actor.position } }]);
          else this.count('actor position absent');
        }
      }
      this.lastSource = qpc; this.lastGame = time.game; this.observations++;
    }
    this.durationMs += performance.now() - started;
  }
  private publish(qpc: number, derived: boolean) {
    const observation = this.observer.sample(), game = observation.t; observation.t = qpc;
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
        const p = this.sim.k.value(this.sim.w.vState, 'position'); if (vec(p)) item.anchor = { at: p };
      }
    }
    for (const records of observation.retractions?.values() ?? []) for (const r of records) r.t = qpc;
    this.publisher.publish(observation);
  }
  summary() {
    return { schema: 'xfse/shadow-summary-1', session: this.session.meta.session, run: this.session.meta.run,
      clock: [...this.clock.rules].sort(), defaultGameStart: this.clock.defaultStart, windows: this.windows, observations: this.observations, inputs: this.inputs,
      pendingInputs: this.sim.k.evolution.queued.length, gameThrough: this.sim.k.now, lastObservedGameTime: this.lastGame,
      counts: this.publisher.counts(), unmapped: Object.fromEntries(Object.entries(this.unmapped).sort()),
      absentFromRecorder: ABSENT, pendingHolotableModel: ['typed incidents', 'per-channel dropped-row counts'],
      pendingSchemaAdmission: ['game.incident', 'game.witness.report'],
      unquantifiedSourceChannels: this.session.meta.channels.filter(c => !MODELED_CHANNELS.has(c)).sort(),
      unquantifiedReaderOmissions: ['actor yaw, command_state and prepared', 'coverage heartbeats and other rows omitted by Holotable'],
      unsupportedDerivations: ['game.incident', 'game.witness.report'],
      coverage: { complete: this.session.meta.complete, dropped: this.session.meta.dropped, gaps: this.session.gaps.length, problems: this.session.meta.problems },
      performance: { windows: this.windows, adapterMs: this.durationMs, advanceMs: this.advanceMs, publishMs: this.publishMs, maxWindowMs: this.maxWindowMs } };
  }
}

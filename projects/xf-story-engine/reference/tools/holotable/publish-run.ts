import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { HolotableObserver, LAYERS, type Observation } from '../../src/holotable/observe.ts';
import { BOUNDS, validateManifest, validateRecord, type Manifest, type RecordLine, type Item } from '../../src/holotable/schema.ts';
import { boundText, compatibilityDetail } from '../../src/holotable/facets.ts';
import { KIND_GLYPHS, unknownGlyphs } from '../../src/holotable/glyphs.ts';
import { facetTitles } from '../../src/holotable/titles.ts';

export type RunOptions = {
  set: string; title: string; from: number; to: number;
  schematic?: boolean;
  mode?: 'standalone';
} | { mode: 'recording'; session: string; run: number; from: number; to: number; schematic?: boolean };
export interface PublishOptions {
  /** Defaults on; false supports older consumers. */
  holotableHooks?: boolean;
}
interface LayerState {
  manifest: Manifest; bytes: number;
  values: Map<string, { signature: string; item: Item }>;
  retracted: Set<string>;
  retractionTimes: Map<string, Set<number>>;
  records: RecordLine[];
  truncations: number;
  unknownGlyphs: number;
}
export interface ItemRevision { layer: string; id: string; t: number; branch?: string }
const history = new Set(['events', 'director']);
const signature = ({ t: _t, ...value }: Item) => JSON.stringify(value);
const key = (id: string, branch?: string) => JSON.stringify([branch ?? null, id]);
export function spoolLine(record: unknown): string {
  const line = JSON.stringify(record) + '\n';
  if (Buffer.byteLength(line) > BOUNDS.line) throw Error('Spool line exceeds 1 MiB');
  return line;
}

/** Offline append-only writer. A whole observation is validated before any of it
 * is appended. Refuses existing spools, never truncates or auto-deploys a run.
 * The CLI/service wall-time batch rate is not a limit on offline file creation.
 */
export class RunPublisher {
  readonly directory: string;
  private layers = new Map<string, LayerState>();
  constructor(directory: string, readonly run: RunOptions, readonly options: PublishOptions = {}) {
    this.directory = resolve(directory);
    if (existsSync(this.directory) && readdirSync(this.directory).some((f) => f.endsWith('.jsonl'))) throw Error('Output directory already contains spools; use a fresh directory');
    const manifests = Object.entries(LAYERS).map(([layer, kinds]) => this.manifest(layer, kinds));
    for (const m of manifests) validateManifest(m);
    mkdirSync(this.directory, { recursive: true });
    for (const m of manifests) this.create(m);
  }
  private manifest(layer: string, kinds: Manifest['kinds']): Manifest {
    const binding = this.run.mode === 'recording' ? { clock: 'recording' as const, session: this.run.session, run: this.run.run }
      : { clock: 'game' as const, standalone: { set: this.run.set, title: this.run.title, from: this.run.from, to: this.run.to, clock: 'game' as const } };
    const { clock, ...identity } = binding;
    return { schema: 'xfh/layer-1', producer: 'story-engine', layer, title: layer.replaceAll('-', ' ') + (layer === 'places' && this.run.schematic ? ' (schematic layout)' : ''),
      ...(this.options.holotableHooks !== false ? { producer_title: 'Story Engine', facet_titles: facetTitles(layer) } : {}),
      ...(this.run.schematic ? { description: 'Districts use real place ids; synthetic cells and their contents use a schematic layout, not measured street geometry.' } : {}), content: 'full', clock, kinds,
      ...identity };
  }
  private create(m: Manifest): LayerState {
    const line = spoolLine(m);
    writeFileSync(join(this.directory, `${m.layer}.jsonl`), line, { flag: 'wx' });
    const state: LayerState = { manifest: m, bytes: Buffer.byteLength(line), values: new Map(), retracted: new Set(), retractionTimes: new Map(), records: [], truncations: 0, unknownGlyphs: 0 };
    this.layers.set(m.layer, state);
    return state;
  }
  publish(observation: Observation, onItem?: (revision: ItemRevision) => void): void {
    if (!Number.isFinite(observation.t) || observation.t < this.run.from || observation.t > this.run.to) throw Error('Observation lies outside standalone span');
    const plans: Array<{ state: LayerState; lines: RecordLine[]; values: LayerState['values']; retracted: Set<string>; retractionTimes: LayerState['retractionTimes']; text: string; fresh: boolean; truncations: number }> = [];
    for (const layer of new Set([...observation.layers.keys(), ...(observation.retractions?.keys() ?? [])])) {
      const incoming = observation.layers.get(layer) ?? [];
      const old = this.layers.get(layer);
      const m = old?.manifest ?? this.manifest(layer, ['actor', 'point']);
      validateManifest(m);
      const state = old ?? { manifest: m, bytes: Buffer.byteLength(spoolLine(m)), values: new Map(), retracted: new Set<string>(), retractionTimes: new Map<string, Set<number>>(), records: [], truncations: 0, unknownGlyphs: 0 };
      const values = new Map(state.values), retracted = new Set(state.retracted), seen = new Set<string>(), lines: RecordLine[] = [];
      const retractionTimes = new Map([...state.retractionTimes].map(([id, times]) => [id, new Set(times)]));
      const noteRetraction = (id: string, t: number) => { const times = retractionTimes.get(id) ?? new Set<number>(); times.add(t); retractionTimes.set(id, times); };
      const explicit = observation.retractions?.get(layer) ?? [];
      const explicitlyRetracted = new Set(explicit.map(r => key(r.retract, r.branch ?? observation.branch)));
      const branchedIds = new Set([...values.values()].filter(({ item }) => item.branch !== undefined).map(({ item }) => item.id));
      for (const id of retracted) { const [branch, item] = JSON.parse(id); if (branch !== null) branchedIds.add(item); }
      let truncations = 0;
      for (const value of incoming) {
        const item = structuredClone(value);
        item.glyph ??= KIND_GLYPHS[item.kind];
        let shortened = boundText(item) + (observation.truncations?.get(layer)?.get(item.id) ?? 0);
        if (this.options.holotableHooks === false && item.detail) {
          item.detail = compatibilityDetail(item.detail);
          shortened += boundText(item); // separators can lengthen a near-limit detail
        }
        item.branch ??= observation.branch;
        validateRecord(item, m);
        const id = key(item.id, item.branch);
        if (seen.has(id)) throw Error(`${layer}: duplicate item ${item.id}`);
        seen.add(id);
        const prior = values.get(id), sig = signature(item);
        // A bounded historical item may arrive with its retraction in the same
        // sample (a delivery held and cleared between boundaries). Keep its
        // recorded interval and deduplicate later copies after it was retracted.
        const ended = item.until !== undefined && item.until <= observation.t;
        const recorded = !prior && ended ? [...state.records].reverse().find((r): r is Item => 'id' in r && key(r.id, r.branch) === id) : undefined;
        const replacesBranches = item.branch === undefined && branchedIds.has(item.id);
        if ((prior?.signature ?? (recorded && signature(recorded))) === sig && !replacesBranches) continue;
        if (prior && !ended) item.t = observation.t;
        if (item.t < this.run.from || item.t > this.run.to || item.until !== undefined && item.until > this.run.to) throw Error(`${layer}: item lies outside standalone span`);
        // A global replacement supersedes every branch's previous value. A
        // later branch revision must not deduplicate against that stale value.
        if (replacesBranches) {
          for (const [other, prior] of values) if (prior.item.id === item.id && prior.item.branch !== undefined) values.delete(other);
          for (const other of retracted) if (JSON.parse(other)[1] === item.id) retracted.delete(other);
          branchedIds.delete(item.id);
        }
        values.set(id, { signature: sig, item }); retracted.delete(id); lines.push(item); truncations += shortened;
        // A new item can win an equal-time tie against an earlier tombstone.
        // The same timed retraction must therefore be admitted again afterwards.
        if (item.branch === undefined) {
          for (const other of retractionTimes.keys()) if (JSON.parse(other)[1] === item.id) retractionTimes.delete(other);
        } else retractionTimes.delete(id);
        if (item.branch !== undefined) branchedIds.add(item.id);
      }
      if (!history.has(layer)) {
        // Unbranched prefix items are inherited by every save branch. Their
        // disappearance needs a scoped tombstone even if that branch has never
        // published its own revision of the item. Keep the prefix for siblings.
        const effective = new Map<string, Item>();
        for (const { item } of values.values()) if (item.branch === undefined && !retracted.has(key(item.id, observation.branch))) effective.set(item.id, item);
        for (const { item } of values.values()) if (item.branch === observation.branch) effective.set(item.id, item);
        for (const item of effective.values()) {
          const id = key(item.id, observation.branch);
          if (seen.has(id) || explicitlyRetracted.has(id)) continue;
          lines.push({ retract: item.id, t: observation.t, ...(observation.branch ? { branch: observation.branch } : {}) });
          noteRetraction(id, observation.t);
          values.delete(id); retracted.add(id);
          if (observation.branch === undefined) for (const [other, prior] of values) if (prior.item.id === item.id) {
            values.delete(other); retracted.add(other);
          }
        }
      }
      for (const value of explicit) {
        const record = { ...value, branch: value.branch ?? observation.branch };
        validateRecord(record, m);
        if (record.t < this.run.from || record.t > observation.t) throw Error(`${layer}: retraction lies outside observed span`);
        const id = key(record.retract, record.branch);
        if (retractionTimes.get(id)?.has(record.t)) continue;
        lines.push(record); noteRetraction(id, record.t);
        // A historical tombstone hides older revisions, not a newer live value.
        const current = values.get(id) ?? (record.branch ? values.get(key(record.retract)) : undefined);
        if (!current || current.item.t <= record.t) retracted.add(id);
        if ((values.get(id)?.item.t ?? Infinity) <= record.t) values.delete(id);
        if (record.branch === undefined) for (const [other, prior] of values) if (prior.item.id === record.retract && prior.item.t <= record.t) {
          values.delete(other); retracted.add(other);
        }
      }
      if (old && lines.length === 0) continue;
      for (const r of lines) validateRecord(r, m);
      const text = lines.map(spoolLine).join('');
      if (state.bytes + Buffer.byteLength(text) > BOUNDS.bytes) throw Error(`${layer}: spool exceeds 16 MB`);
      checkItemBounds([...state.records, ...lines], layer);
      plans.push({ state, lines, values, retracted, retractionTimes, text, fresh: !old, truncations });
    }
    for (const plan of plans) {
      const state = plan.fresh ? this.create(plan.state.manifest) : plan.state;
      if (plan.text) appendFileSync(join(this.directory, `${state.manifest.layer}.jsonl`), plan.text);
      state.bytes += Buffer.byteLength(plan.text); state.values = plan.values; state.retracted = plan.retracted; state.records.push(...plan.lines);
      state.retractionTimes = plan.retractionTimes;
      state.truncations += plan.truncations;
      state.unknownGlyphs += plan.lines.reduce((n, r) => n + ('id' in r ? unknownGlyphs(r) : 0), 0);
    }
    if (onItem) for (const plan of plans) for (const record of plan.lines) if ('id' in record)
      onItem({ layer: plan.state.manifest.layer, id: record.id, t: record.t, branch: record.branch });
  }
  /** Distinct ids ever published, latest live ids, item revisions, and actual bytes. */
  counts(): Record<string, { items: number; live: number; revisions: number; bytes: number; truncations: number; unknownGlyphs: number }> {
    return Object.fromEntries([...this.layers].map(([layer, state]) => [layer, {
      items: new Set(state.records.flatMap((r) => 'id' in r ? [r.id] : [])).size,
      live: state.values.size, revisions: state.records.filter((r) => 'id' in r).length, bytes: state.bytes, truncations: state.truncations, unknownGlyphs: state.unknownGlyphs,
    }]));
  }
}

/** Distinct item ids across the whole layer, including expired/retracted items
 * and all branches. Replacements and retraction records add no ids.
 */
export function checkItemBounds(records: readonly RecordLine[], layer: string): void {
  const ids = new Set<string>();
  for (const record of records) {
    if ('id' in record) ids.add(record.id);
    if (ids.size > BOUNDS.items) throw Error(`${layer}: more than 5,000 distinct item ids`);
  }
}

/** Attach to an existing run: its host calls this after each complete window. */
export function publishBoundary(observer: HolotableObserver, publisher: RunPublisher, timing?: (observerMs: number, writerMs: number) => void): void {
  const start = timing ? performance.now() : 0;
  const observation = observer.sample(), sampled = timing ? performance.now() : 0;
  publisher.publish(observation);
  timing?.(sampled - start, performance.now() - sampled);
}

if (import.meta.main) {
  const { runWeekCli } = await import('./week.ts');
  await runWeekCli(process.argv.slice(2));
}

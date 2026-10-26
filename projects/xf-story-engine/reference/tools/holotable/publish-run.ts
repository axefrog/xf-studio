import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { HolotableObserver, LAYERS, type Observation } from '../../src/holotable/observe.ts';
import { BOUNDS, validateManifest, validateRecord, type Manifest, type RecordLine, type Item } from '../../src/holotable/schema.ts';
import { boundText } from '../../src/holotable/facets.ts';
import { KIND_GLYPHS, unknownGlyphs } from '../../src/holotable/glyphs.ts';

export interface RunOptions {
  set: string; title: string; from: number; to: number;
  schematic?: boolean;
}
interface LayerState {
  manifest: Manifest; bytes: number;
  values: Map<string, { signature: string; item: Item }>;
  retracted: Set<string>;
  records: RecordLine[];
  truncations: number;
  unknownGlyphs: number;
}
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
  constructor(directory: string, readonly run: RunOptions) {
    this.directory = resolve(directory);
    if (existsSync(this.directory) && readdirSync(this.directory).some((f) => f.endsWith('.jsonl'))) throw Error('Output directory already contains spools; use a fresh directory');
    const manifests = Object.entries(LAYERS).map(([layer, kinds]) => this.manifest(layer, kinds));
    for (const m of manifests) validateManifest(m);
    mkdirSync(this.directory, { recursive: true });
    for (const m of manifests) this.create(m);
  }
  private manifest(layer: string, kinds: Manifest['kinds']): Manifest {
    return { schema: 'xfh/layer-1', producer: 'story-engine', layer, title: layer.replaceAll('-', ' ') + (layer === 'places' && this.run.schematic ? ' (schematic layout)' : ''),
      ...(this.run.schematic ? { description: 'Districts use real place ids; synthetic cells and their contents use a schematic layout, not measured street geometry.' } : {}), content: 'full', clock: 'game', kinds,
      standalone: { set: this.run.set, title: this.run.title, from: this.run.from, to: this.run.to, clock: 'game' } };
  }
  private create(m: Manifest): LayerState {
    const line = spoolLine(m);
    writeFileSync(join(this.directory, `${m.layer}.jsonl`), line, { flag: 'wx' });
    const state: LayerState = { manifest: m, bytes: Buffer.byteLength(line), values: new Map(), retracted: new Set(), records: [], truncations: 0, unknownGlyphs: 0 };
    this.layers.set(m.layer, state);
    return state;
  }
  publish(observation: Observation): void {
    if (!Number.isFinite(observation.t) || observation.t < this.run.from || observation.t > this.run.to) throw Error('Observation lies outside standalone span');
    const plans: Array<{ state: LayerState; lines: RecordLine[]; values: LayerState['values']; retracted: Set<string>; text: string; fresh: boolean; truncations: number }> = [];
    for (const layer of new Set([...observation.layers.keys(), ...(observation.retractions?.keys() ?? [])])) {
      const incoming = observation.layers.get(layer) ?? [];
      const old = this.layers.get(layer);
      const m = old?.manifest ?? this.manifest(layer, ['actor']);
      validateManifest(m);
      const state = old ?? { manifest: m, bytes: Buffer.byteLength(spoolLine(m)), values: new Map(), retracted: new Set<string>(), records: [], truncations: 0, unknownGlyphs: 0 };
      const values = new Map(state.values), retracted = new Set(state.retracted), seen = new Set<string>(), lines: RecordLine[] = [];
      const branchedIds = new Set([...values.values()].filter(({ item }) => item.branch !== undefined).map(({ item }) => item.id));
      for (const id of retracted) { const [branch, item] = JSON.parse(id); if (branch !== null) branchedIds.add(item); }
      let truncations = 0;
      for (const value of incoming) {
        const item = structuredClone(value);
        item.glyph ??= KIND_GLYPHS[item.kind];
        const shortened = boundText(item) + (observation.truncations?.get(layer)?.get(item.id) ?? 0);
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
          if (seen.has(id)) continue;
          lines.push({ retract: item.id, t: observation.t, ...(observation.branch ? { branch: observation.branch } : {}) });
          values.delete(id); retracted.add(id);
          if (observation.branch === undefined) for (const [other, prior] of values) if (prior.item.id === item.id) {
            values.delete(other); retracted.add(other);
          }
        }
      }
      for (const value of observation.retractions?.get(layer) ?? []) {
        const record = { ...value, branch: value.branch ?? observation.branch };
        validateRecord(record, m);
        if (record.t < this.run.from || record.t > observation.t) throw Error(`${layer}: retraction lies outside observed span`);
        const id = key(record.retract, record.branch);
        if (retracted.has(id)) continue;
        if ((values.get(id)?.item.t ?? -Infinity) > record.t) throw Error(`${layer}: retraction precedes item`);
        lines.push(record); values.delete(id); retracted.add(id);
        if (record.branch === undefined) for (const [other, prior] of values) if (prior.item.id === record.retract) {
          values.delete(other); retracted.add(other);
        }
      }
      if (old && lines.length === 0) continue;
      for (const r of lines) validateRecord(r, m);
      const text = lines.map(spoolLine).join('');
      if (state.bytes + Buffer.byteLength(text) > BOUNDS.bytes) throw Error(`${layer}: spool exceeds 16 MB`);
      checkItemBounds([...state.records, ...lines], layer);
      plans.push({ state, lines, values, retracted, text, fresh: !old, truncations });
    }
    for (const plan of plans) {
      const state = plan.fresh ? this.create(plan.state.manifest) : plan.state;
      if (plan.text) appendFileSync(join(this.directory, `${state.manifest.layer}.jsonl`), plan.text);
      state.bytes += Buffer.byteLength(plan.text); state.values = plan.values; state.retracted = plan.retracted; state.records.push(...plan.lines);
      state.truncations += plan.truncations;
      state.unknownGlyphs += plan.lines.reduce((n, r) => n + ('id' in r ? unknownGlyphs(r) : 0), 0);
    }
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
export function publishBoundary(observer: HolotableObserver, publisher: RunPublisher): void {
  publisher.publish(observer.sample());
}

if (import.meta.main) {
  const { runWeekCli } = await import('./week.ts');
  await runWeekCli(process.argv.slice(2));
}

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Session, WorldPack } from '../../../../xf-holotable/src/model.ts';

export type { Session, WorldPack };
export type Actor = { t: number; who: string; entity?: string; position?: [number, number, number] };
export type FeedSession = Session & { actors?: Actor[] };
export interface Extra { t: number; seq: number; channel: string; data: Record<string, any>; valid: boolean }
export interface Batch { meta: Session['meta']; v: Session['v']; actors: Actor[]; events: Session['events']; camera: Session['camera']; gaps: Session['gaps']; extras: Extra[] }
export interface HoloReader {
  readRunAsync(dir: string, signal?: AbortSignal): Promise<FeedSession>;
  listRuns(root: string): { session: string; run: number; dir: string }[];
  snapshotAt(s: Session, t: number, level: 'full', world?: WorldPack): { v?: Session['v'][number] & { stale: boolean } };
}
/** External checkout is configuration, never a personal path in source. */
export async function loadReader(checkout: string): Promise<HoloReader> {
  const base = join(checkout, 'projects/xf-holotable/src');
  const [recording, query] = await Promise.all([
    import(pathToFileURL(join(base, 'recording.ts')).href), import(pathToFileURL(join(base, 'query.ts')).href),
  ]);
  return { readRunAsync: recording.readRunAsync, listRuns: recording.listRuns, snapshotAt: query.snapshotAt };
}

/** TEMPORARY: Holotable owns the format. Remove when its model preserves actor
 * record/affiliation, heat and raw event channels. Only dropped fields live here;
 * V/camera/actor position and modeled timeline events always come from its reader.
 */
export function extraFromRow(row: Record<string, any>): Extra {
  if (row.schema !== 'xfb/source-record-1') throw Error('Shadow sidecar expects xfb/source-record-1; update the adapter explicitly');
  const d = row.data ?? {};
  const data = row.channel === 'v' ? { heat: d.heat }
    : row.channel === 'actors' ? { actors: Array.isArray(d.actors) ? d.actors.map((a: any) => ({ who: a.who, record: a.record, affiliation: a.affiliation })) : [] }
    : ['camera', 'supervisor', 'contacts', 'subtitles', 'voice'].includes(row.channel) ? { event: d.event }
    : d;
  return { t: row.source_s, seq: row.seq, channel: row.channel, data, valid: row.valid !== false };
}
export function readExtras(dir: string, meta: Session['meta'], signal?: AbortSignal): Extra[] {
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  if (m.schema !== 'xfb/recording-1') throw Error('Shadow sidecar expects xfb/recording-1; update the adapter explicitly');
  if (m.session !== meta.session || m.run !== meta.run || m.world_generation !== meta.worldGeneration) throw Error('Sidecar recording identity mismatch');
  const out: Extra[] = [];
  let last = 0, bytes = 0;
  for (const { file } of m.chunks ?? []) {
    signal?.throwIfAborted();
    if (!/^chunk-\d+\.jsonl$/.test(file)) throw Error('Unsafe sidecar chunk name');
    const path = join(dir, file);
    // Match the reader's missing-tail/unfinished-row policy, never invent data.
    let size: number; try { size = statSync(path).size; } catch (e: any) { if (e.code === 'ENOENT') break; throw e; }
    bytes += size;
    if (size > 1024 * 1024 || bytes > 64 * 1024 * 1024) throw Error('Sidecar exceeds 1 MiB chunk / 64 MiB run budget');
    const buf = readFileSync(path); let start = 0;
    while (start < buf.length) {
      const end = buf.indexOf(10, start); if (end < 0) break;
      if (end - start > 16384) throw Error('Sidecar row exceeds recorder envelope budget');
      const row = JSON.parse(buf.subarray(start, end).toString('utf8')); start = end + 1;
      if (row.session !== meta.session || row.run !== meta.run || row.world_generation !== meta.worldGeneration || !Number.isSafeInteger(row.seq) || row.seq <= last || !Number.isFinite(row.source_s)) throw Error('Sidecar row identity/sequence mismatch');
      last = row.seq; out.push(extraFromRow(row));
    }
  }
  return out;
}
export async function recordingBatch(reader: HoloReader, dir: string, signal?: AbortSignal): Promise<Batch> {
  const s = await reader.readRunAsync(dir, signal);
  return { ...s, actors: s.actors ?? [], extras: readExtras(dir, s.meta, signal) };
}

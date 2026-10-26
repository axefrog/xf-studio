import type { Session, WorldPack } from '../../../../xf-holotable/src/model.ts';
import { readRunAsync, listRuns } from '../../../../xf-holotable/src/recording.ts';
import { snapshotAt } from '../../../../xf-holotable/src/query.ts';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export type { Session, WorldPack };
export type Actor = NonNullable<Session['actors']>[number];
export type FeedSession = Session;
export interface Batch {
  meta: Session['meta']; v: Session['v']; actors: Actor[];
  events: Session['events']; camera: Session['camera']; gaps: Session['gaps'];
}
export interface HoloReader {
  readRunAsync(dir: string, signal?: AbortSignal): Promise<Session>;
  listRuns(root: string): { session: string; run: number; dir: string }[];
  snapshotAt: typeof snapshotAt;
}
export const defaultReader: HoloReader = { readRunAsync, listRuns, snapshotAt };
/** Optional project checkout override; the default uses repo-relative imports. */
export async function loadReader(project: string): Promise<HoloReader> {
  const [recording, query] = await Promise.all([
    import(pathToFileURL(join(project, 'src/recording.ts')).href),
    import(pathToFileURL(join(project, 'src/query.ts')).href),
  ]);
  return { readRunAsync: recording.readRunAsync, listRuns: recording.listRuns, snapshotAt: query.snapshotAt };
}
export async function recordingBatch(reader: HoloReader, dir: string, signal?: AbortSignal): Promise<Batch> {
  const session = await reader.readRunAsync(dir, signal);
  return { ...session, actors: session.actors ?? [] };
}

// Cursors over the recorder and session log, never another history store.
import { read, type Json, type TestApi } from "./windows.ts";
import { replayRecording, type FileCursor } from "./recording-replay.ts";

export type TimelineCursor = FileCursor & {
  schema: "xfb/timeline-cursor-1"; sid: string; run: number; world: number; record: number; event: number;
  last_v?: Json;
};
export type TimelineOptions = { run?: number; cursor?: TimelineCursor; detail?: boolean; signal?: AbortSignal; digest?: boolean; archive?: boolean };
const seq = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));

export async function catchUp(api: TestApi, options: TimelineOptions): Promise<Json> {
  const saved = options.cursor;
  if (saved && (saved.schema !== "xfb/timeline-cursor-1" || !seq(saved.record) || !seq(saved.event) || !seq(saved.run) || !seq(saved.world))) throw new Error("Invalid timeline cursor");
  const run = saved?.run ?? options.run;
  if (!seq(run) || !run) throw new Error("Supply the recorder run on the first catch-up read");
  const info = await read(api, "bridge.info", {}, options.signal);
  if (saved && saved.sid !== info.sid) throw new Error("Timeline session changed; start a fresh cursor");
  const cursor: TimelineCursor = saved ? { ...saved } : { schema: "xfb/timeline-cursor-1", sid: info.sid, run, world: -1, record: 0, event: 0 };
  const records: Json[] = [], events: Json[] = [], alerts: Json[] = [], gaps: string[] = [];
  let status: Json = {}, head: number | undefined, recordMore = false, eventMore = false;
  let hostBefore = performance.now(), hostAfter = hostBefore;
  for (let pageNumber = 0; pageNumber < 105; pageNumber++) {
    const pageSince = cursor.record;
    hostBefore = performance.now();
    status = await read(api, "test.record.read", { run, since: cursor.record, limit: 5 }, options.signal);
    hostAfter = performance.now();
    if (status.run !== run || status.session !== info.sid || !seq(status.world_generation) ||
        (cursor.world >= 0 && status.world_generation !== cursor.world)) throw new Error("Recorder identity changed; do not join worlds");
    cursor.world = status.world_generation;
    if (!Array.isArray(status.records) || status.records.length > 5 || !seq(status.next) || !seq(status.latest) || !seq(status.lost) || status.next < cursor.record || status.next > status.latest) throw new Error("Invalid recorder page");
    head ??= status.latest;
    if (pageNumber === 0 && status.output && options.archive !== false) {
      const archived = replayRecording(status, cursor.record, head!, cursor);
      records.push(...archived.rows); cursor.record = archived.next;
      if (archived.gap) gaps.push("native_file_history_lost");
      if (archived.budget) { recordMore = true; break; }
      if (cursor.record >= head!) { recordMore = false; break; }
    }
    if (status.lost && cursor.record < pageSince + status.lost) gaps.push("recorder_history_lost");
    let previous = cursor.record;
    for (const row of status.records as Json[]) {
      if (row.seq <= cursor.record) continue; // Already recovered from the native writer.
      if (!seq(row.seq) || row.seq <= previous || row.seq > status.next || row.run !== run || row.session !== info.sid || row.world_generation !== cursor.world || !Number.isFinite(row.source_s)) throw new Error("Invalid recorder row");
      previous = row.seq; records.push(row);
    }
    const unread = status.records.filter((row: Json) => row.seq > cursor.record).length;
    if (status.next > cursor.record && status.next - cursor.record !== unread) gaps.push("recorder_history_lost");
    const advanced = status.next > cursor.record || cursor.record > pageSince;
    cursor.record = Math.max(cursor.record, status.next);
    recordMore = cursor.record < head;
    if (!recordMore || !advanced) break;
  }
  // Source clock calibration brackets the final recorder read.
  const calibration = { source_s: status.source_now_s, host_before_ms: hostBefore, host_after_ms: hostAfter };
  head = undefined;
  for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
    const page = await read(api, "session.events", { since: cursor.event, limit: 500 }, options.signal);
    if (!Array.isArray(page.events) || !seq(page.next) || !seq(page.latest) || !seq(page.dropped) || page.next < cursor.event || page.next > page.latest) throw new Error("Invalid session event page");
    head ??= page.latest;
    let previous = cursor.event;
    for (const row of page.events as Json[]) {
      if (!seq(row.seq) || row.seq <= previous || row.seq > page.next) throw new Error("Invalid session event sequence");
      previous = row.seq; events.push(row);
    }
    if (page.dropped || page.next - cursor.event !== page.events.length) gaps.push("session_history_lost");
    const advanced = page.next > cursor.event;
    cursor.event = page.next; eventMore = cursor.event < head;
    if (!eventMore || !advanced) break;
  }
  const counts: Json = {}, channels: Json = {}, path: number[][] = [];
  let travelled = 0;
  let last = cursor.last_v, healthMin: number | null = null, healthMax: number | null = null;
  const changes: Json = { combat: 0, heat: 0, vehicle: 0, busy: 0 };
  for (const row of records) {
    counts[row.channel] = (counts[row.channel] ?? 0) + 1;
    if (!row.valid) { gaps.push("invalid_source"); continue; }
    const v = row.data;
    if (row.channel !== "v") {
      const list: Json[] = channels[row.channel] ??= [];
      // Heartbeats and repeated UI snapshots are coalesced; distinct callbacks remain counted.
      if (v?.event) list.push({ seq: row.seq, source_s: row.source_s, ...v });
      else channels[`${row.channel}_latest`] = { seq: row.seq, source_s: row.source_s, ...v };
      continue;
    }
    if (!v) continue;
    if (Array.isArray(v.position)) path.push(v.position);
    const health = v.vitals?.health;
    if (Number.isFinite(health)) { healthMin = Math.min(healthMin ?? health, health); healthMax = Math.max(healthMax ?? health, health); }
    if (last) {
      if (Number.isFinite(health) && Number.isFinite(last.vitals?.health) && health < last.vitals.health)
        alerts.push({ kind: "health_drop", seq: row.seq, source_s: row.source_s, from: last.vitals.health, to: health });
      if (Array.isArray(v.position) && Array.isArray(last.position)) travelled += distance(v.position, last.position);
      if (Array.isArray(v.position) && Array.isArray(last.position) && distance(v.position, last.position) > 10)
        alerts.push({ kind: "position_jump", seq: row.seq, source_s: row.source_s, metres: distance(v.position, last.position) });
      for (const key of ["combat", "heat", "vehicle", "busy"]) {
        const before = key === "combat" ? last.vitals?.in_combat : last[key];
        const after = key === "combat" ? v.vitals?.in_combat : v[key];
        // Vehicle position moves every sample; compare identity/mounted state only.
        const canonical = (x: any) => key === "vehicle" ? [x?.mounted, x?.id] : key === "heat" ? (typeof x === "string" ? x : JSON.stringify(x)) : x;
        if (JSON.stringify(canonical(before)) !== JSON.stringify(canonical(after))) {
          changes[key]++;
          if (key === "combat" || key === "heat") alerts.push({ kind: `${key}_changed`, seq: row.seq, source_s: row.source_s, from: before, to: after });
        }
      }
    }
    last = v;
  }
  // Explicit contact receipts only; a velocity change is not proof of a collision.
  for (const event of events) if (["contact", "collision"].includes(event.kind) || ["contact", "collision"].includes(event.data?.what)) alerts.push({ kind: event.data?.what ?? event.kind, event });
  cursor.last_v = last ? { position: last.position, vitals: { health: last.vitals?.health, in_combat: last.vitals?.in_combat },
    heat: typeof last.heat === "string" ? last.heat : JSON.stringify(last.heat),
    vehicle: { mounted: last.vehicle?.mounted, id: last.vehicle?.id }, busy: last.busy } : undefined;
  const compact = (list: Json[]) => options.detail ? list : list.slice(-24);
  const omitted: Json = {};
  for (const key of Object.keys(channels)) if (Array.isArray(channels[key])) { omitted[key] = options.detail ? 0 : Math.max(0, channels[key].length - 24); channels[key] = compact(channels[key]); }
  if (status.dropped || status.invalid || status.missed_deadlines || status.file_error) gaps.push("source_coverage_incomplete");
  return { schema: "xfb/catchup-1", cursor, complete: !gaps.length && !recordMore && !eventMore,
    gaps: [...new Set(gaps)], more: recordMore || eventMore, source: { active: status.active, latest: status.latest, dropped: status.dropped, invalid: status.invalid, missed_deadlines: status.missed_deadlines },
    v: { samples: counts.v ?? 0, path: options.detail ? path : path.length <= 2 ? path : Array.from({ length: Math.min(8, path.length) }, (_, i) => path[Math.round(i * (path.length - 1) / (Math.min(8, path.length) - 1))]),
      distance_m: travelled, path_points: path.length,
      health_min: healthMin, health_max: healthMax, changes, latest: last }, channels, counts,
    events: compact(events), alerts: compact(alerts), omitted: { ...omitted, events: options.detail ? 0 : Math.max(0, events.length - 24), alerts: options.detail ? 0 : Math.max(0, alerts.length - 24) },
    contact_coverage: "Explicit session receipts only; no commissioned physical-contact/collision sensor",
    calibration, ...(options.detail ? { records } : {}),
    ...(options.digest === false ? {} : { now: await read(api, "game.digest", { events: 0, sky: false }, options.signal) }) };
}

// Cursors over the recorder and session log, never another history store.
import { read, type Json, type TestApi } from "./windows.ts";
import { replayRecording, type FileCursor } from "./recording-replay.ts";

/** Source counters at the cursor: the baseline that makes coverage gaps describe the queried interval, not the whole run. */
export type SourceCounters = { dropped: number; invalid: number; missed_deadlines: number; file_error: boolean };
export type TimelineCursor = FileCursor & {
  schema: "xfb/timeline-cursor-1"; sid: string; run: number; world: number; record: number; event: number;
  last_v?: Json;
  contact_observed?: boolean; vehicle_hit_observed?: boolean;
  supervisor_seen?: number[];
  supervisor_retired_through?: number;
  supervisor_reconciliation_lost?: boolean;
  source_counters?: SourceCounters;
  /** The newest recorder V sample seen so far, so a page with no V row can still say how old the last one is. */
  last_v_seq?: number; last_v_source_s?: number;
};
export type TimelineOptions = { run?: number; cursor?: TimelineCursor; detail?: boolean; signal?: AbortSignal; digest?: boolean; archive?: boolean };
const seq = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));

export async function catchUp(api: TestApi, options: TimelineOptions): Promise<Json> {
  const saved = options.cursor;
  if (saved && (saved.schema !== "xfb/timeline-cursor-1" || !seq(saved.record) || !seq(saved.event) || !seq(saved.run) || !seq(saved.world))) throw new Error("Invalid timeline cursor");
  if (saved && ((saved.supervisor_seen !== undefined && (!Array.isArray(saved.supervisor_seen) || saved.supervisor_seen.length > 512 || saved.supervisor_seen.some(v => !seq(v) || !v))) ||
    (saved.supervisor_retired_through !== undefined && !seq(saved.supervisor_retired_through)) ||
    (saved.supervisor_reconciliation_lost !== undefined && typeof saved.supervisor_reconciliation_lost !== "boolean"))) throw new Error("Invalid supervisor reconciliation cursor");
  const sc = saved?.source_counters as Json | undefined;
  if (sc !== undefined && !(sc && typeof sc === "object" && seq(sc.dropped) && seq(sc.invalid) && seq(sc.missed_deadlines) && typeof sc.file_error === "boolean")) throw new Error("Invalid source counter baseline");
  if (saved && ((saved.last_v_seq !== undefined && !seq(saved.last_v_seq)) || (saved.last_v_source_s !== undefined && !Number.isFinite(saved.last_v_source_s)))) throw new Error("Invalid last V marker");
  const run = saved?.run ?? options.run;
  if (!seq(run) || !run) throw new Error("Supply the recorder run on the first catch-up read");
  const info = await read(api, "bridge.info", {}, options.signal);
  if (saved && saved.sid !== info.sid) throw new Error("Timeline session changed; start a fresh cursor");
  const cursor: TimelineCursor = saved ? { ...saved } : { schema: "xfb/timeline-cursor-1", sid: info.sid, run, world: -1, record: 0, event: 0 };
  const records: Json[] = [], events: Json[] = [], alerts: Json[] = [], gaps: string[] = [];
  let status: Json = {}, head: number | undefined, recordMore = false, eventMore = false, eventLatest = 0, newestReadS: number | undefined;
  let hostBefore = performance.now(), hostAfter = hostBefore;
  for (let pageNumber = 0; pageNumber < 105; pageNumber++) {
    const pageSince = cursor.record;
    hostBefore = performance.now();
    status = await read(api, "test.record.read", { run, since: cursor.record, limit: 5 }, options.signal);
    hostAfter = performance.now();
    if (status.run !== run || status.session !== info.sid || !seq(status.world_generation) ||
        (cursor.world >= 0 && status.world_generation !== cursor.world)) throw new Error("Recorder identity changed; do not join worlds");
    cursor.world = status.world_generation;
    // A cursor is the caller's data, so its counter baseline is untrusted. A baseline can only be a past reading: it
    // never exceeds the recorder's totals now, and at the start of the run it is zero. Anything else is refused rather
    // than clamped, because a baseline above the truth would turn real loss into apparent coverage.
    if (pageNumber === 0 && saved?.source_counters) {
      const b = saved.source_counters;
      if (b.dropped > (status.dropped ?? 0) || b.invalid > (status.invalid ?? 0) || b.missed_deadlines > (status.missed_deadlines ?? 0) || (b.file_error && !status.file_error) ||
          (saved.record === 0 && (b.dropped || b.invalid || b.missed_deadlines || b.file_error))) throw new Error("invalid_cursor: the source counter baseline is not a past reading of this recorder run; start a fresh cursor");
    }
    if (!Array.isArray(status.records) || status.records.length > 5 || !seq(status.next) || !seq(status.latest) || !seq(status.lost) || status.next < cursor.record || status.next > status.latest) throw new Error("Invalid recorder page");
    // The head is the latest the recorder has been seen to hold: a live recorder keeps writing while we page, and a cursor
    // that reaches an older head is still behind.
    head = Math.max(head ?? 0, status.latest);
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
    cursor.event = page.next; eventMore = cursor.event < head; eventLatest = page.latest;
    if (!eventMore || !advanced) break;
  }
  const counts: Json = {}, channels: Json = {}, path: number[][] = [], supervision: Json[] = [];
  const supervisorSeen = new Set(saved?.supervisor_seen ?? []);
  let retired = saved?.supervisor_retired_through ?? 0, outOfScope = 0;
  const scoped = (v: Json, sourceTime: unknown) => {
    const time = v?.source_s ?? sourceTime;
    return v?.world_generation === cursor.world && Number.isFinite(time) && Number.isFinite(status.start_s) && time >= status.start_s &&
      (status.active === true || (Number.isFinite(status.end_s) && time <= status.end_s));
  };
  const receiveSupervisor = (v: Json, source: string, sourceTime: unknown) => {
    if (!scoped(v, sourceTime)) {
      outOfScope++;
      if (!seq(v?.world_generation) || !Number.isFinite(v?.source_s ?? sourceTime) || !Number.isFinite(status.start_s)) gaps.push("supervisor_scope_unknown");
      return false;
    }
    if (!seq(v.receipt_seq) || !v.receipt_seq) { gaps.push("supervisor_receipt_identity_missing"); return false; }
    if (v.receipt_seq <= retired || supervisorSeen.has(v.receipt_seq)) return false;
    supervisorSeen.add(v.receipt_seq);
    supervision.push({ source, source_s: sourceTime, ...v }); return true;
  };
  let contactObserved = false, vehicleHitObserved = false;
  let travelled = 0;
  let last = cursor.last_v, healthMin: number | null = null, healthMax: number | null = null;
  const changes: Json = { combat: 0, heat: 0, vehicle: 0, busy: 0 };
  const invalidChannels = new Set<string>();
  // 0.8.18 (Borg 3): counts[channel] is every record read, but the lists show only valid event records (invalid rows are
  // counted, polled snapshots are coalesced into <channel>_latest), so a channel's count and its list disagreed (237 against
  // 22). The detail says where each record went; every record has exactly one disposition:
  // records = invalid + filtered + summarised + coalesced + listed, and the compact list's omitted records are a subset of listed.
  // filtered: a valid record that was dropped on purpose (a supervisor receipt out of this run's scope or already seen);
  // summarised: a V sample, which feeds the path, health and change figures and is never listed.
  const where: Record<string, { records: number; invalid: number; filtered: number; summarised: number; coalesced: number; listed: number }> = {};
  const track = (channel: string) => where[channel] ??= { records: 0, invalid: 0, filtered: 0, summarised: 0, coalesced: 0, listed: 0 };
  let lastVRow: Json | undefined;
  for (const row of records) {
    counts[row.channel] = (counts[row.channel] ?? 0) + 1;
    track(row.channel).records++;
    if (Number.isFinite(row.source_s)) newestReadS = Math.max(newestReadS ?? row.source_s, row.source_s);
    // Invalid samples inside this queried interval (the cursor makes the interval start where the last call ended).
    if (!row.valid) { gaps.push("invalid_source"); invalidChannels.add(row.channel); track(row.channel).invalid++; continue; }
    const v = row.data;
    if (v?.event?.startsWith("supervisor.") && v.event !== "supervisor.coverage" && !receiveSupervisor(v, "recorder", row.source_s)) { track(row.channel).filtered++; continue; }
    if (v?.event === "placement.traffic") alerts.push({ kind: "traffic_risk", seq: row.seq, source_s: row.source_s, ...v });
    if (row.channel === "contacts" && v?.event?.startsWith("contact.") && v.event !== "contact.coverage") {
      contactObserved = true;
      vehicleHitObserved ||= v.vehicle_hit_observed === true;
      alerts.push({ kind: "contact", seq: row.seq, source_s: row.source_s, ...v });
    }
    if (row.channel !== "v") {
      const list: Json[] = channels[row.channel] ??= [];
      // Heartbeats and repeated UI snapshots are coalesced; distinct callbacks remain counted.
      if (v?.event) { list.push({ seq: row.seq, source_s: row.source_s, ...v }); track(row.channel).listed++; }
      else { channels[`${row.channel}_latest`] = { seq: row.seq, source_s: row.source_s, ...v }; track(row.channel).coalesced++; }
      continue;
    }
    if (!v) { track(row.channel).filtered++; continue; }
    track(row.channel).summarised++;
    lastVRow = row;
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
        // A missing baseline (a hand-made or older cursor with no value for this key) is unknown, never a change:
        // only the baseline is established.
        if (key === "vehicle" ? before?.mounted === undefined && before?.id === undefined : before === undefined) continue;
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
  for (const event of events) if (["contact", "collision"].includes(event.kind) || ["contact", "collision"].includes(event.data?.what)) {
    if (scoped(event.data, event.source_s)) { contactObserved = true; alerts.push({ kind: event.data?.what ?? event.kind, event }); }
  }
  for (const event of events) if (event.kind === "traffic_risk") alerts.push({ kind: "traffic_risk", event });
  // Receipts can cross calls in either order. The returned cursor reconciles the feeds,
  // scoped to this run's world and [start,end] source interval (open while active).
  for (const event of events) if (event.kind?.startsWith("supervisor.")) {
    const receipt = { source: "session", ...event.data, event: event.kind };
    receiveSupervisor(receipt, "session", event.source_s);
  }
  const identities = [...supervisorSeen].sort((a, b) => a - b);
  if (identities.length > 512) {
    retired = Math.max(retired, identities[identities.length - 513]!);
    cursor.supervisor_reconciliation_lost = true;
  }
  cursor.supervisor_seen = identities.slice(-512);
  cursor.supervisor_retired_through = retired;
  if (cursor.supervisor_reconciliation_lost) gaps.push("supervisor_reconciliation_history_lost");
  for (const receipt of supervision) if (["supervisor.violation", "supervisor.action", "supervisor.cleared"].includes(receipt.event)) alerts.push({ kind: "supervisor", ...receipt });
  for (const receipt of supervision) if (receipt.event === "supervisor.contact") {
    contactObserved = true; vehicleHitObserved ||= receipt.receipt?.vehicle_hit_observed === true;
    alerts.push({ kind: "contact", source: "supervisor", ...receipt });
  }
  if (supervision.some(v => v.event === "supervisor.gap")) gaps.push("supervisor_history_lost");
  cursor.contact_observed = saved?.contact_observed === true || contactObserved;
  cursor.vehicle_hit_observed = saved?.vehicle_hit_observed === true || vehicleHitObserved;
  const coveredPaths = status.channels?.includes("contacts") ? ["PlayerPuppet.OnCarHitPlayer.entry", "AbstractLandEvents.OnEnter", "WallCollisionHelpers.GetWallCollision"] : [];
  cursor.last_v = last ? { position: last.position, vitals: { health: last.vitals?.health, in_combat: last.vitals?.in_combat },
    heat: typeof last.heat === "string" ? last.heat : JSON.stringify(last.heat),
    vehicle: { mounted: last.vehicle?.mounted, id: last.vehicle?.id }, busy: last.busy } : undefined;
  const compact = (list: Json[]) => options.detail ? list : list.slice(-24);
  const omitted: Json = {};
  for (const key of Object.keys(channels)) if (Array.isArray(channels[key])) { omitted[key] = options.detail ? 0 : Math.max(0, channels[key].length - 24); channels[key] = compact(channels[key]); }
  // Per channel: how the records of counts[channel] divide. listed counts the records of the list before compaction.
  const countDetail: Json = {};
  for (const [channel, w] of Object.entries(where)) countDetail[channel] = { ...w, omitted: omitted[channel] ?? 0, shown: w.listed - (omitted[channel] ?? 0), valid: w.records - w.invalid };
  // Source loss counts are cumulative for the run; the gap is what grew since the cursor's baseline.
  const baseline: SourceCounters = saved?.source_counters ?? { dropped: 0, invalid: 0, missed_deadlines: 0, file_error: false };
  const counters: SourceCounters = { dropped: status.dropped ?? 0, invalid: status.invalid ?? 0, missed_deadlines: status.missed_deadlines ?? 0, file_error: !!status.file_error };
  const coverageDelta = { dropped: Math.max(0, counters.dropped - baseline.dropped), invalid: Math.max(0, counters.invalid - baseline.invalid),
    missed_deadlines: Math.max(0, counters.missed_deadlines - baseline.missed_deadlines), file_error: counters.file_error && !baseline.file_error };
  if (coverageDelta.dropped || coverageDelta.invalid || coverageDelta.missed_deadlines || coverageDelta.file_error) gaps.push("source_coverage_incomplete");
  // Only an established boundary moves the baseline: the cursor has reached the latest the final read showed, so these
  // counters describe exactly the history read. While paging, the unread tail may hold the rest of the loss.
  cursor.source_counters = recordMore ? baseline : counters;
  // Where the reader stands against real time.
  const behind = recordMore || eventMore;
  const secondsBehind = !behind ? 0 : Number.isFinite(status.source_now_s) && newestReadS !== undefined ? Math.max(0, status.source_now_s - newestReadS) : null;
  const backlog = { behind, records_behind: Math.max(0, (status.latest ?? 0) - cursor.record), events_behind: Math.max(0, eventLatest - cursor.event), seconds_behind: secondsBehind };
  const nowDigest = options.digest === false ? undefined : await read(api, "game.digest", { events: 0, sky: false }, options.signal);
  // v.current is the newest V there is; v.latest is the last V of the page just read, which is old while behind.
  // Only the digest proves a sample is current. A recorder sample is always historical, with its own age: the recording
  // may be stopped, or a long way behind.
  if (lastVRow) { cursor.last_v_seq = lastVRow.seq; cursor.last_v_source_s = lastVRow.source_s; }
  const markerSeq = lastVRow?.seq ?? saved?.last_v_seq, markerTime = lastVRow?.source_s ?? saved?.last_v_source_s;
  const recorderV = lastVRow ? lastVRow.data : cursor.last_v;
  const current = nowDigest?.v !== undefined ? { source: "digest", stale: false, sample: nowDigest.v }
    : recorderV ? { source: "recorder", historical: true, stale: true, seq: markerSeq ?? null, source_s: markerTime ?? null,
      age_s: Number.isFinite(status.source_now_s) && Number.isFinite(markerTime) ? Math.max(0, status.source_now_s - markerTime!) : null,
      sample_form: lastVRow ? "recorder_row" : "cursor_baseline", note: "A recorder sample, not proven current: the digest says where V is now.", sample: recorderV } : null;
  const unitsBehind = secondsBehind === null ? "an unknown time" : secondsBehind >= 90 ? `about ${Math.round(secondsBehind / 60)} min` : `about ${Math.round(secondsBehind)} s`;
  const summary = behind
    ? `Behind real time by ${backlog.records_behind} records (${unitsBehind}): this page is old. v.current is the newest V; v.latest, v.path and the counts describe the page only. Call again with the returned cursor to catch up.`
    : "Caught up with the recorder.";
  return { schema: "xfb/catchup-1", cursor, complete: !gaps.length && !recordMore && !eventMore,
    summary, backlog, gaps: [...new Set(gaps)], coverage_delta: coverageDelta, invalid_channels: [...invalidChannels], more: behind,
    source: { active: status.active, latest: status.latest, dropped: status.dropped, invalid: status.invalid, missed_deadlines: status.missed_deadlines, file_error: !!status.file_error },
    v: { current, latest_stale: recordMore, latest_seq: lastVRow?.seq ?? null, latest_source_s: lastVRow?.source_s ?? null,
       samples: counts.v ?? 0, path: options.detail ? path : path.length <= 2 ? path : Array.from({ length: Math.min(8, path.length) }, (_, i) => path[Math.round(i * (path.length - 1) / (Math.min(8, path.length) - 1))]),
      distance_m: travelled, path_points: path.length,
      health_min: healthMin, health_max: healthMax, changes, latest: last }, channels, counts, count_detail: countDetail,
    events: compact(events), alerts: compact(alerts), omitted: { ...omitted, events: options.detail ? 0 : Math.max(0, events.length - 24), alerts: options.detail ? 0 : Math.max(0, alerts.length - 24) },
    supervisor_summary: { message: supervision.length ? "while you were away: supervisor receipts observed" : "while you were away: no supervisor receipts observed",
      scope: { world_generation: cursor.world, start_s: status.start_s, end_s: status.end_s }, excluded_out_of_scope: outOfScope,
      counts: { violations: supervision.filter(v => v.event === "supervisor.violation").length, actions: supervision.filter(v => v.event === "supervisor.action").length,
        refused: supervision.filter(v => v.event === "supervisor.action" && v.response?.ok === false).length, cancellations: supervision.filter(v => v.event === "supervisor.cleared").length },
      receipts: compact(supervision), omitted: options.detail ? 0 : Math.max(0, supervision.length - 24), history_complete: !gaps.length && !recordMore && !eventMore },
    contact_summary: { message: contactObserved ? "contact observed" : `no contact observed (covered paths: ${coveredPaths.join(", ") || "explicit session receipts only"})`,
      observed_since_cursor: contactObserved, observed_in_run: cursor.contact_observed, vehicle_hit_observed_in_run: cursor.vehicle_hit_observed,
      covered_paths: coveredPaths, commissioned: false, continuous: false, no_contact_proof: false,
      vehicle_contact_without_hit: "INCONCLUSIVE", controller_other_identity: "unavailable", history_complete: !gaps.length && !recordMore && !eventMore },
    contact_coverage: "Partial uncommissioned car-hit-entry and landing/wall controller reports when contacts selected; supporting ground included; never full no-contact proof",
    calibration, ...(options.detail ? { records } : {}),
    ...(nowDigest === undefined ? {} : { now: nowDigest }) };
}

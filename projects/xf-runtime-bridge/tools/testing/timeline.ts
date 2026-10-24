// Cursors over the recorder and session log, never another history store.
import { read, type Json, type TestApi } from "./windows.ts";
import { replayRecording, type FileCursor } from "./recording-replay.ts";

export type TimelineCursor = FileCursor & {
  schema: "xfb/timeline-cursor-1"; sid: string; run: number; world: number; record: number; event: number;
  last_v?: Json;
  contact_observed?: boolean; vehicle_hit_observed?: boolean;
  supervisor_seen?: number[];
  supervisor_retired_through?: number;
  supervisor_reconciliation_lost?: boolean;
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
  for (const row of records) {
    counts[row.channel] = (counts[row.channel] ?? 0) + 1;
    if (!row.valid) { gaps.push("invalid_source"); continue; }
    const v = row.data;
    if (v?.event?.startsWith("supervisor.") && v.event !== "supervisor.coverage" && !receiveSupervisor(v, "recorder", row.source_s)) continue;
    if (v?.event === "placement.traffic") alerts.push({ kind: "traffic_risk", seq: row.seq, source_s: row.source_s, ...v });
    if (row.channel === "contacts" && v?.event?.startsWith("contact.") && v.event !== "contact.coverage") {
      contactObserved = true;
      vehicleHitObserved ||= v.vehicle_hit_observed === true;
      alerts.push({ kind: "contact", seq: row.seq, source_s: row.source_s, ...v });
    }
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
  if (status.dropped || status.invalid || status.missed_deadlines || status.file_error) gaps.push("source_coverage_incomplete");
  return { schema: "xfb/catchup-1", cursor, complete: !gaps.length && !recordMore && !eventMore,
    gaps: [...new Set(gaps)], more: recordMore || eventMore, source: { active: status.active, latest: status.latest, dropped: status.dropped, invalid: status.invalid, missed_deadlines: status.missed_deadlines },
    v: { samples: counts.v ?? 0, path: options.detail ? path : path.length <= 2 ? path : Array.from({ length: Math.min(8, path.length) }, (_, i) => path[Math.round(i * (path.length - 1) / (Math.min(8, path.length) - 1))]),
      distance_m: travelled, path_points: path.length,
      health_min: healthMin, health_max: healthMax, changes, latest: last }, channels, counts,
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
    ...(options.digest === false ? {} : { now: await read(api, "game.digest", { events: 0, sky: false }, options.signal) }) };
}

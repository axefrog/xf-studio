// The recorder adapter: reads one finished run of the bridge's source recorder (manifest plus JSONL chunks,
// projects/xf-runtime-bridge/docs/mcp.md "Source recorder") into a Session. It applies the same identity and
// sequence rules as the bridge's own replay (tools/testing/recording-replay.ts) without importing bridge internals.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { CameraSample, Cite, Gap, Session, SessionMeta, TimelineEvent, VSample, Vec3 } from "./model.ts";

type Json = Record<string, any>;

const ROW_CAP = 16384, CHUNK_CAP = 1024 * 1024;
/** A pause between two samples of a 10 Hz channel longer than this is drawn as a gap. */
export const TIME_GAP_S = 0.35;

export interface RunRef { session: string; run: number; dir: string; start: number; end: number; bytes: number; complete: boolean }

/** Lists finished runs under a recordings root (`<root>/<session>/run-<n>/manifest.json`), newest first. */
export function listRuns(root: string): RunRef[] {
  if (!existsSync(root)) return [];
  const out: RunRef[] = [];
  for (const session of readdirSync(root)) {
    const sdir = join(root, session);
    if (!statSync(sdir).isDirectory()) continue;
    for (const name of readdirSync(sdir)) {
      const m = /^run-(\d+)$/.exec(name), dir = join(sdir, name), manifest = join(dir, "manifest.json");
      if (!m || !existsSync(manifest)) continue;
      try {
        const j = JSON.parse(readFileSync(manifest, "utf8")) as Json;
        if (j.session !== session || j.run !== Number(m[1])) continue;
        out.push({ session, run: j.run, dir, start: j.start_s, end: j.end_s, bytes: j.file_bytes ?? 0, complete: j.complete === true });
      } catch { /* an unreadable manifest is not a run */ }
    }
  }
  return out.sort((a, b) => statSync(b.dir).mtimeMs - statSync(a.dir).mtimeMs);
}

/** Reads a run directory into a Session. Throws on identity or sequence violations rather than guessing. */
export function readRun(dir: string, signal?: AbortSignal): Session {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Json;
  if (manifest.schema !== "xfb/recording-1") throw new Error(`Not a recorder manifest: ${manifest.schema}`);
  if (basename(dir) !== `run-${manifest.run}` || basename(join(dir, "..")) !== manifest.session) throw new Error("Recording folder does not match its manifest");
  const meta: SessionMeta = {
    schema: "xfh/session-1", session: manifest.session, run: manifest.run, worldGeneration: manifest.world_generation,
    pluginVersion: manifest.plugin_version ?? "", start: manifest.start_s, end: manifest.end_s, channels: manifest.channels ?? [],
    complete: manifest.complete === true, dropped: manifest.dropped ?? 0, missedDeadlines: manifest.missed_deadlines ?? 0,
    largestGapS: manifest.largest_gap_s ?? 0, coverage: manifest.coverage ?? "", from: manifest.start_s, to: manifest.end_s,
  };
  const session: Session = { meta, v: [], camera: [], events: [], gaps: [] };
  const cite = (seq: number): Cite => `recorder:${meta.session}:${meta.run}:${seq}`;
  const lines = new Map<string, Json>();
  let last = 0;
  const chunks: Json[] = manifest.chunks ?? [];
  for (const { file } of chunks) {
    signal?.throwIfAborted();
    if (!/^chunk-\d+\.jsonl$/.test(file)) throw new Error(`Unexpected chunk name ${file}`);
    const path = join(dir, file);
    if (!existsSync(path)) break; // A crashed run can lack its last chunks: what exists is still evidence.
    const buf = readFileSync(path);
    if (buf.length > CHUNK_CAP) throw new Error(`Chunk over the recorder's cap: ${file}`);
    let offset = 0;
    while (offset < buf.length) {
      const end = buf.indexOf(10, offset);
      if (end < 0) break; // An incomplete writer tail is never parsed.
      if (end - offset > ROW_CAP) throw new Error("Row exceeds the recorder's envelope cap");
      const row = JSON.parse(buf.subarray(offset, end).toString("utf8")) as Json;
      offset = end + 1;
      if (row.session !== meta.session || row.run !== meta.run || row.world_generation !== meta.worldGeneration || !Number.isSafeInteger(row.seq) || !Number.isFinite(row.source_s)) throw new Error(`Row identity mismatch at seq ${row.seq}`);
      if (row.seq <= last) throw new Error(`Sequence went backwards at ${row.seq}`);
      if (last && row.seq !== last + 1) session.gaps.push({ from: row.source_s, to: row.source_s, reason: "sequence", fromSeq: last, toSeq: row.seq });
      last = row.seq;
      if (row.valid === false) continue;
      ingest(row, session, cite, lines);
    }
  }
  timeGaps(session);
  session.events.sort((a, b) => a.t - b.t || a.seq - b.seq);
  if (session.v.length) { meta.from = session.v[0].t; meta.to = session.v[session.v.length - 1].t; }
  return session;
}

function ingest(row: Json, s: Session, cite: (seq: number) => Cite, lines: Map<string, Json>) {
  const d = row.data ?? {}, t = row.source_s as number, seq = row.seq as number;
  switch (row.channel) {
    case "v": {
      if (!Array.isArray(d.position)) return;
      const vel = Array.isArray(d.velocity) ? d.velocity : [0, 0, 0];
      s.v.push({ t, seq, position: d.position as Vec3, yaw: d.yaw ?? 0, speed: Math.hypot(vel[0], vel[1], vel[2]),
        health: d.vitals?.health ?? 0, healthMax: d.vitals?.health_max ?? 0, inCombat: d.vitals?.in_combat === true,
        vehicle: d.vehicle?.mounted === true, busy: d.busy ?? "" } satisfies VSample);
      return;
    }
    case "camera": {
      const c = d.camera; if (!c?.position) return;
      s.camera.push({ t, seq, position: c.position, forward: c.forward, up: c.up, fov: c.fov, aspect: c.aspect } satisfies CameraSample);
      return;
    }
    case "supervisor": {
      const ev = d.event as string; if (!ev || ev.endsWith(".coverage")) return;
      const at = (d.position ?? d.at) as Vec3 | undefined;
      const summary = ev === "supervisor.violation" ? `Supervisor: ${d.violation} broken, ${d.policy}`
        : ev === "supervisor.action" ? `Supervisor: ${d.action} (${d.response?.ok ? "done" : "refused"})`
        : ev === "supervisor.safe_position" ? `Safe point after ${Number(d.quiet_s ?? 0).toFixed(1)} s quiet`
        : ev === "supervisor.cleared" ? `Supervisor cleared: ${d.reason}` : "Supervisor armed";
      push(s, { kind: ev as TimelineEvent["kind"], t, seq, at, summary, level: "structure", cite: cite(seq) });
      return;
    }
    case "contacts": {
      if (d.event === "placement.traffic") push(s, { kind: "placement.traffic", t, seq, at: d.position, summary: `Placement ${d.subject}: traffic risk ${d.traffic_risk}`, level: "structure", cite: cite(seq) });
      else if (d.event && !String(d.event).endsWith(".coverage")) push(s, { kind: "contact", t, seq, at: d.position, summary: `Contact: ${d.event}`, level: "structure", cite: cite(seq) });
      return;
    }
    case "subtitles": {
      // One timeline event per line, at its request; the words are `full` content.
      if (d.event !== "line.requested" || lines.has(d.line_id)) return;
      lines.set(d.line_id, d);
      push(s, { kind: "line", t, seq, summary: `Line spoken (${d.type})`, detail: `${d.speaker_name ?? "Someone"}: ${d.text}`, level: "full", cite: cite(seq) });
      return;
    }
    case "voice": {
      if (d.event === "voice.requested" || d.event === "voice.squad_caller") push(s, { kind: "voice", t, seq, summary: `Voice request: ${d.trigger}`, level: "structure", cite: cite(seq) });
      return;
    }
  }
}

function push(s: Session, e: Omit<TimelineEvent, "id">) { s.events.push({ id: `e${s.events.length + 1}`, ...e }); }

/** Pauses in V's 10 Hz samples become time gaps; sequence gaps keep their place from the surrounding samples. */
function timeGaps(s: Session) {
  for (let i = 1; i < s.v.length; i++) {
    const a = s.v[i - 1], b = s.v[i];
    if (b.t - a.t > TIME_GAP_S) s.gaps.push({ from: a.t, to: b.t, reason: "time", fromSeq: a.seq, toSeq: b.seq });
  }
  for (const g of s.gaps) if (g.reason === "sequence") {
    const before = lastAtOrBefore(s.v, g.from - 1e-9), after = s.v.find(x => x.seq > g.toSeq - 1);
    if (before) g.from = before.t; if (after) g.to = after.t;
  }
  s.gaps.sort((a, b) => a.from - b.from);
}

/** The last sample at or before t (binary search over a time-sorted array). */
export function lastAtOrBefore<T extends { t: number }>(xs: T[], t: number): T | undefined {
  let lo = 0, hi = xs.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (xs[mid].t <= t) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  return best < 0 ? undefined : xs[best];
}

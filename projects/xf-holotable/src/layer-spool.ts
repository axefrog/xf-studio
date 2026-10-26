// One owner of private append-only layer spools. Watch leases bound all polling work.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LAYER_BOUNDS, validateManifest, validateRecord, type LayerData, type LayerManifest, type LayerRecord } from "./layers.ts";
import { setConflict } from "./layer-timelines.ts";

type FileState = { offset: number; tail: Buffer; ino: number; birth: number; data?: LayerData; refused: number; reason: string; dropping: boolean; overBudget: boolean; modified: number; checkpoint: Buffer; publishedRefused: number; publishedReason: string };
export interface PublishResult { accepted: number; refused: number; reasons: string[] }
const identityOK = (id: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && id.split("/").every(s => s.length <= 64);

/** Peak occupancy over all times, including replacements, expiry and retractions. */
export function withinItemBudget(records: readonly LayerRecord[], m: LayerManifest): boolean {
  if (records.length <= LAYER_BOUNDS.items) return true;
  const branches = new Set<string | undefined>([undefined, m.branch, ...records.map(r => r.branch)]);
  return [...branches].every(branch => branchWithinBudget(records.filter(r => { const b = r.branch ?? m.branch; return !b || b === branch; }), m));
}
function branchWithinBudget(records: readonly LayerRecord[], m: LayerManifest): boolean {
  const time = (t: LayerRecord["t"]) => t === undefined ? -Infinity : m.clock === "wall" ? Date.parse(t as string) : t as number;
  const ordered = records.map((r, order) => ({ r, order, t: time(r.t) })).sort((a, b) => a.t - b.t || a.order - b.order);
  const next = new Map<string, number>(), edges: { t: number; delta: number }[] = [];
  for (let i = ordered.length - 1; i >= 0; i--) {
    const { r, t } = ordered[i], id = "retract" in r ? r.retract : r.id, until = next.get(id) ?? Infinity;
    if (!("retract" in r)) { const end = Math.min(until, r.until === undefined ? Infinity : time(r.until)); if (end > t) edges.push({ t, delta: 1 }, { t: end, delta: -1 }); }
    next.set(id, t);
  }
  edges.sort((a, b) => a.t - b.t || a.delta - b.delta);
  let count = 0; for (const e of edges) { count += e.delta; if (count > LAYER_BOUNDS.items) return false; }
  return true;
}

export function createLayerSpool(root: string, options: { now?: () => number; interval?: (fn: () => void) => () => void } = {}) {
  const now = options.now ?? Date.now;
  const files = new Map<string, FileState>(), leases = new Map<string, number>();
  let stop: (() => void) | undefined;
  const refusal = (f: FileState, reason: string) => { f.refused++; f.reason ||= reason; if (f.data) { f.data.refused = f.refused; f.data.reason = f.reason; } };
  function consume(f: FileState, line: string, id: string) {
    if (Buffer.byteLength(line) > 1024 * 1024) { refusal(f, "Item line exceeds 1 MB."); return; }
    let row: unknown;
    try { row = JSON.parse(line); } catch { refusal(f, "Line is not valid JSON."); return; }
    if (!f.data) {
      const reason = validateManifest(row, id);
      if (reason) { refusal(f, reason); return; }
      const conflict = setConflict(row as LayerManifest, [...files.values()].flatMap(f => f.data ? [f.data] : []));
      if (conflict) { refusal(f, conflict); return; }
      f.data = { manifest: row as LayerManifest, records: [], refused: f.refused, reason: f.reason }; return;
    }
    const reason = validateRecord(row, f.data.manifest);
    if (reason) { refusal(f, reason); return; }
    const records = [...f.data.records, row as LayerRecord];
    if (!withinItemBudget(records, f.data.manifest)) { refusal(f, "Layer exceeds 5,000 live items."); return; }
    f.data.records.push(row as LayerRecord);
  }
  const directory = (path: string) => { try { return readdirSync(path, { withFileTypes: true }); } catch { return []; } };
  function scan() {
    const seen = new Set<string>();
    if (existsSync(root)) for (const producer of directory(root)) {
      if (!producer.isDirectory() || producer.isSymbolicLink()) continue;
      for (const file of directory(join(root, producer.name))) {
        if (!file.isFile() || file.isSymbolicLink() || !file.name.endsWith(".jsonl")) continue;
        const id = `${producer.name}/${file.name.slice(0, -6)}`; if (!identityOK(id)) continue;
        seen.add(id);
        const path = join(root, producer.name, file.name);
        let stat; try { stat = statSync(path); } catch { continue; }
        let f = files.get(id);
        let rewritten = false;
        if (f && f.offset > 0 && stat.size >= f.offset && stat.mtimeMs !== f.modified) {
          let fd: number | undefined;
          try {
            fd = openSync(path, "r"); const edge = Buffer.alloc(f.checkpoint.length);
            const read = readSync(fd, edge, 0, edge.length, f.offset - edge.length);
            rewritten = read !== edge.length || !edge.equals(f.checkpoint);
          } catch { continue; } finally { if (fd !== undefined) closeSync(fd); }
        }
        if (!f || rewritten || stat.size < f.offset || stat.ino !== f.ino || stat.birthtimeMs !== f.birth) {
          f = { offset: 0, tail: Buffer.alloc(0), ino: stat.ino, birth: stat.birthtimeMs, refused: 0, reason: "", dropping: false, overBudget: false, modified: stat.mtimeMs, checkpoint: Buffer.alloc(0), publishedRefused: 0, publishedReason: "" }; files.set(id, f);
        }
        if (stat.size > LAYER_BOUNDS.bytes && !f.overBudget) { refusal(f, "Spool exceeds 16 MB; rotate it before publishing more."); f.overBudget = true; }
        const end = Math.min(stat.size, LAYER_BOUNDS.bytes);
        if (end > f.offset) {
          let fd; try { fd = openSync(path, "r"); } catch { continue; }
          try {
            while (f.offset < end) {
              const chunk = Buffer.alloc(Math.min(64 * 1024, end - f.offset)), n = readSync(fd, chunk, 0, chunk.length, f.offset); if (!n) break;
              f.offset += n;
              f.checkpoint = Buffer.concat([f.checkpoint, chunk.subarray(0,n)]).subarray(-64);
              const input = Buffer.concat([f.tail, chunk.subarray(0, n)]); let from = 0, nl: number;
              while ((nl = input.indexOf(10, from)) >= 0) {
                if (!f.dropping) { if (nl - from > 1024 * 1024) refusal(f, "Item line exceeds 1 MB."); else { const line = input.subarray(from, nl).toString("utf8").trim(); if (line) consume(f, line, id); } }
                f.dropping = false; from = nl + 1;
              }
              f.tail = input.subarray(from);
              if (f.tail.length > 1024 * 1024) { if (!f.dropping) refusal(f, "Item line exceeds 1 MB."); f.tail = Buffer.alloc(0); f.dropping = true; }
            }
          } finally { closeSync(fd); }
        }
        f.modified = stat.mtimeMs;
        try { const rejected = JSON.parse(readFileSync(path + ".refused", "utf8")); f.publishedRefused = rejected.count; f.publishedReason = rejected.reason; if (f.data) { f.data.refused = f.refused + rejected.count; f.data.reason = f.reason || rejected.reason; } } catch { /* No publishing refusals. */ }
      }
    }
    for (const id of files.keys()) if (!seen.has(id)) files.delete(id);
  }
  function remember(path: string, reasons: string[]) {
    if (!reasons.length) return;
    let prior = { count: 0, reason: "" }; try { prior = JSON.parse(readFileSync(path + ".refused", "utf8")); } catch {}
    writeFileSync(path + ".refused", JSON.stringify({ count: prior.count + reasons.length, reason: prior.reason || reasons[0] }));
  }
  function publish(id: string, lines: unknown[]): PublishResult {
    if (!identityOK(id)) throw Error("Name the layer as lowercase producer/layer slugs.");
    const path = join(root, id + ".jsonl"), folder = join(root, id.split("/")[0]), lock = path + ".lock";
    mkdirSync(folder, { recursive: true });
    try { mkdirSync(lock); } catch { return { accepted: 0, refused: lines.length, reasons: ["Another batch is publishing this layer; try again."] }; }
    try {
      let recent: number[] = []; try { recent = JSON.parse(readFileSync(path + ".rate", "utf8")); } catch {}
      recent = recent.filter(t => now() - t < 1000 && now() >= t);
      if (recent.length >= 2) { const reasons = lines.map(() => "Layer accepts at most 2 batches a second."); remember(path, reasons); return { accepted: 0, refused: lines.length, reasons }; }
      writeFileSync(path + ".rate", JSON.stringify([...recent, now()]));
      scan();
      const old = files.get(id), data = old?.data;
      let manifest = data?.manifest, records = [...(data?.records ?? [])], bytes = existsSync(path) ? statSync(path).size : 0;
      const accepted: string[] = [], reasons: string[] = [];
      if (old?.tail.length || old?.dropping) { reasons.push(...lines.map(() => "Spool has an unfinished line; finish or rotate it first.")); remember(path, reasons); return { accepted: 0, refused: lines.length, reasons }; }
      for (let row of lines) {
        if (typeof row === "string") { try { row = JSON.parse(row); } catch { reasons.push("Line is not valid JSON."); continue; } }
        const isManifest = !manifest, reason = isManifest ? validateManifest(row, id) : validateRecord(row, manifest!);
        if (reason) { reasons.push(reason); continue; }
        if (isManifest) { const conflict = setConflict(row as LayerManifest, [...files.values()].flatMap(f => f.data ? [f.data] : [])); if (conflict) { reasons.push(conflict); continue; } }
        const text = JSON.stringify(row) + "\n", size = Buffer.byteLength(text);
        if (bytes + size > LAYER_BOUNDS.bytes) { reasons.push("Spool exceeds 16 MB; rotate it before publishing more."); continue; }
        if (isManifest) manifest = row as LayerManifest;
        else if (!withinItemBudget([...records, row as LayerRecord], manifest!)) { reasons.push("Layer exceeds 5,000 live items."); continue; }
        else records.push(row as LayerRecord);
        accepted.push(text); bytes += size;
      }
      if (accepted.length) appendFileSync(path, accepted.join(""));
      else if (!existsSync(path) && reasons.length) writeFileSync(path, "");
      remember(path, reasons); scan(); return { accepted: accepted.length, refused: reasons.length, reasons };
    } finally { rmdirSync(lock); }
  }
  const snapshot = () => [...files.entries()].map(([id, f]): LayerData => f.data ?? { manifest: { schema: "xfh/layer-1", producer: id.split("/")[0], layer: id.split("/")[1], title: id.split("/")[1], content: "structure", clock: "recording", kinds: [] }, records: [], refused: f.refused + f.publishedRefused, reason: f.reason || f.publishedReason });
  const expire = () => { for (const [id, until] of leases) if (now() >= until) leases.delete(id); if (!leases.size) { stop?.(); stop = undefined; } };
  return {
    scan, publish,
    read() { scan(); return snapshot(); },
    watch() { const watch = randomUUID(); leases.set(watch, now() + 15000); scan(); stop ??= (options.interval ?? (fn => { const id = setInterval(fn, 1000); id.unref?.(); return () => clearInterval(id); }))(() => { expire(); if (leases.size) scan(); }); return { watch }; },
    renew(id: string) { expire(); if (!leases.has(id)) throw Object.assign(Error("That layer watch expired. Watch again."), { code: "bad_request" }); leases.set(id, now() + 15000); },
    stop(id: string) { leases.delete(id); expire(); },
    snapshot,
    close() { leases.clear(); stop?.(); stop = undefined; },
  };
}

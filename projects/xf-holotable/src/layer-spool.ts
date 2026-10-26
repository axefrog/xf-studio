// One owner of private append-only layer spools. Watch leases bound all polling work.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID, type Hash } from "node:crypto";
import { LAYER_BOUNDS, type LayerData, type LayerManifest, type LayerRecord } from "./layers.ts";
import { admitId, ITEM_LIMIT_REASON, layerLine } from "./layer-line.ts";
import { setConflict } from "./layer-timelines.ts";
import { acquireSetPublishLock, SetPublishBusy } from "./set-publish-lock.ts";

type FileState = { offset: number; size: number; tail: Buffer; ino: number; birth: number; data?: LayerData; refused: number; reason: string; dropping: boolean; overBudget: boolean; modified: number; hash: Hash; ids: Set<string>; publishedRefused: number; publishedReason: string };
export interface PublishResult { accepted: number; refused: number; reasons: string[] }
const identityOK = (id: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && id.split("/").every(s => s.length <= 64);

export function createLayerSpool(root: string, options: { now?: () => number; interval?: (fn: () => void) => () => void } = {}) {
  const now = options.now ?? Date.now;
  const files = new Map<string, FileState>(), leases = new Map<string, number>();
  let stop: (() => void) | undefined, running: Promise<void> | undefined, closed = false;
  const lifetime = new AbortController();
  let deadline = 0;
  const yieldIfNeeded = async () => { if (performance.now() >= deadline) { await new Promise<void>(resolve => setImmediate(resolve)); deadline = performance.now() + 4; } lifetime.signal.throwIfAborted(); };
  const refusal = (f: FileState, reason: string) => { f.refused++; f.reason ||= reason; if (f.data) { f.data.refused = f.refused; f.data.reason = f.reason; } };
  function consume(f: FileState, line: string, id: string) {
    const parsed = layerLine(line, f.data?.manifest, id);
    if (parsed.reason) { refusal(f, parsed.reason); return; }
    if (parsed.blank) return;
    const row = parsed.row!;
    if (!f.data) {
      const conflict = setConflict(row as LayerManifest, [...files.values()].flatMap(f => f.data ? [f.data] : []));
      if (conflict) { refusal(f, conflict); return; }
      f.data = { manifest: row as LayerManifest, records: [], refused: f.refused, reason: f.reason }; return;
    }
    if (!admitId(row as LayerRecord, f.ids)) { refusal(f, ITEM_LIMIT_REASON); return; }
    f.data.records.push(row as LayerRecord);
  }
  const directory = (path: string) => { try { return readdirSync(path, { withFileTypes: true }); } catch { return []; } };
  async function scanFiles() {
    deadline = performance.now() + 4;
    const seen = new Set<string>();
    if (existsSync(root)) for (const producer of directory(root)) {
      if (!producer.isDirectory() || producer.isSymbolicLink()) continue;
      for (const file of directory(join(root, producer.name))) {
        if (!file.isFile() || file.isSymbolicLink() || !file.name.endsWith(".jsonl")) continue;
        await yieldIfNeeded();
        const id = `${producer.name}/${file.name.slice(0, -6)}`; if (!identityOK(id)) continue;
        seen.add(id);
        const path = join(root, producer.name, file.name);
        let stat; try { stat = statSync(path); } catch { continue; }
        let f = files.get(id);
        let rewritten = false;
        if (f && f.offset > 0 && (stat.size !== f.size || stat.mtimeMs !== f.modified)) {
          let fd: number | undefined;
          try {
            fd = openSync(path, "r"); const hash = createHash("sha256"); let offset = 0;
            while (offset < f.offset) {
              await yieldIfNeeded();
              const chunk = Buffer.alloc(Math.min(64 * 1024, f.offset - offset)), n = readSync(fd, chunk, 0, chunk.length, offset);
              if (!n) break; hash.update(chunk.subarray(0,n)); offset += n;
            }
            rewritten = offset !== f.offset || !hash.digest().equals(f.hash.copy().digest());
          } catch (error) { if (closed) throw error; continue; } finally { if (fd !== undefined) closeSync(fd); }
        }
        if (!f || rewritten || stat.size < f.offset || stat.ino !== f.ino || stat.birthtimeMs !== f.birth) {
          f = { offset: 0, size: 0, tail: Buffer.alloc(0), ino: stat.ino, birth: stat.birthtimeMs, refused: 0, reason: "", dropping: false, overBudget: false, modified: stat.mtimeMs, hash: createHash("sha256"), ids: new Set(), publishedRefused: 0, publishedReason: "" }; files.set(id, f);
        }
        if (stat.size > LAYER_BOUNDS.bytes && !f.overBudget) { refusal(f, "Spool exceeds 16 MB; rotate it before publishing more."); f.overBudget = true; }
        const end = Math.min(stat.size, LAYER_BOUNDS.bytes);
        if (end > f.offset) {
          let fd; try { fd = openSync(path, "r"); } catch { continue; }
          try {
            while (f.offset < end) {
              await yieldIfNeeded();
              const chunk = Buffer.alloc(Math.min(64 * 1024, end - f.offset)), n = readSync(fd, chunk, 0, chunk.length, f.offset); if (!n) break;
              f.offset += n;
              f.hash.update(chunk.subarray(0,n));
              const input = Buffer.concat([f.tail, chunk.subarray(0, n)]); let from = 0, nl: number;
              while ((nl = input.indexOf(10, from)) >= 0) {
                await yieldIfNeeded();
                if (!f.dropping) { if (nl - from > 1024 * 1024) refusal(f, "Item line exceeds 1 MB."); else { const line = input.subarray(from, nl).toString("utf8"); consume(f, line, id); } }
                f.dropping = false; from = nl + 1;
              }
              f.tail = input.subarray(from);
              if (f.tail.length > 1024 * 1024) { if (!f.dropping) refusal(f, "Item line exceeds 1 MB."); f.tail = Buffer.alloc(0); f.dropping = true; }
            }
          } finally { closeSync(fd); }
        }
        f.modified = stat.mtimeMs; f.size = stat.size;
        try { const rejected = JSON.parse(readFileSync(path + ".refused", "utf8")); f.publishedRefused = rejected.count; f.publishedReason = rejected.reason; if (f.data) { f.data.refused = f.refused + rejected.count; f.data.reason = f.reason || rejected.reason; } } catch { /* No publishing refusals. */ }
      }
    }
    for (const id of files.keys()) if (!seen.has(id)) files.delete(id);
  }
  function scan() {
    if (closed) return Promise.resolve();
    return running ??= scanFiles().finally(() => { running = undefined; });
  }
  function remember(path: string, reasons: string[]) {
    if (!reasons.length) return;
    let prior = { count: 0, reason: "" }; try { prior = JSON.parse(readFileSync(path + ".refused", "utf8")); } catch {}
    writeFileSync(path + ".refused", JSON.stringify({ count: prior.count + reasons.length, reason: prior.reason || reasons[0] }));
  }
  async function publish(id: string, lines: unknown[]): Promise<PublishResult> {
    if (!identityOK(id)) throw Error("Name the layer as lowercase producer/layer slugs.");
    const path = join(root, id + ".jsonl"), folder = join(root, id.split("/")[0]), lock = path + ".lock";
    mkdirSync(folder, { recursive: true });
    try { mkdirSync(lock); } catch { return { accepted: 0, refused: lines.length, reasons: ["Another batch is publishing this layer; try again."] }; }
    let releaseSet: (() => void) | undefined;
    try {
      let recent: number[] = []; try { recent = JSON.parse(readFileSync(path + ".rate", "utf8")); } catch {}
      recent = recent.filter(t => now() - t < 1000 && now() >= t);
      if (recent.length >= 2) { const reasons = lines.map(() => "Layer accepts at most 2 batches a second."); remember(path, reasons); return { accepted: 0, refused: lines.length, reasons }; }
      writeFileSync(path + ".rate", JSON.stringify([...recent, now()]));
      await scan();
      const lockSet = async (manifest?: LayerManifest) => {
        if (!manifest?.standalone) return;
        releaseSet = await acquireSetPublishLock(join(folder, `.set-${manifest.standalone.set}.publish.lock`), lifetime.signal);
        // A scan already in flight may predate the previous publisher's append.
        if (running) await running;
        await scan();
      };
      await lockSet(files.get(id)?.data?.manifest);
      const old = files.get(id), data = old?.data;
      let manifest = data?.manifest, ids = new Set(old?.ids), bytes = existsSync(path) ? statSync(path).size : 0;
      const accepted: string[] = [], reasons: string[] = [];
      if (old?.tail.length || old?.dropping) { reasons.push(...lines.map(() => "Spool has an unfinished line; finish or rotate it first.")); remember(path, reasons); return { accepted: 0, refused: lines.length, reasons }; }
      for (let row of lines) {
        await yieldIfNeeded();
        const isManifest = !manifest, parsed = layerLine(row, manifest, id);
        if (parsed.reason) { reasons.push(parsed.reason); continue; }
        if (parsed.blank) continue;
        row = parsed.row!;
        if (isManifest) {
          await lockSet(row as LayerManifest);
          const conflict = setConflict(row as LayerManifest, [...files.values()].flatMap(f => f.data ? [f.data] : []));
          if (conflict) { releaseSet?.(); releaseSet = undefined; reasons.push(conflict); continue; }
        }
        const text = parsed.text! + "\n", size = Buffer.byteLength(text);
        if (bytes + size > LAYER_BOUNDS.bytes) { if (isManifest) { releaseSet?.(); releaseSet = undefined; } reasons.push("Spool exceeds 16 MB; rotate it before publishing more."); continue; }
        if (isManifest) manifest = row as LayerManifest;
        else if (!admitId(row as LayerRecord, ids)) { reasons.push(ITEM_LIMIT_REASON); continue; }
        accepted.push(text); bytes += size;
      }
      if (accepted.length) appendFileSync(path, accepted.join(""));
      else if (!existsSync(path) && reasons.length) writeFileSync(path, "");
      remember(path, reasons); if (running) await running; await scan(); return { accepted: accepted.length, refused: reasons.length, reasons };
    } catch (error) {
      if (!(error instanceof SetPublishBusy)) throw error;
      const reasons = lines.map(() => error.message); remember(path, reasons); return { accepted: 0, refused: lines.length, reasons };
    } finally { try { releaseSet?.(); } finally { rmdirSync(lock); } }
  }
  const snapshot = () => [...files.entries()].map(([id, f]): LayerData => f.data ?? { manifest: { schema: "xfh/layer-1", producer: id.split("/")[0], layer: id.split("/")[1], title: id.split("/")[1], content: "structure", clock: "recording", kinds: [] }, records: [], refused: f.refused + f.publishedRefused, reason: f.reason || f.publishedReason });
  const expire = () => { for (const [id, until] of leases) if (now() >= until) leases.delete(id); if (!leases.size) { stop?.(); stop = undefined; } };
  return {
    scan, publish,
    async read(cancel?: AbortSignal) {
      cancel?.throwIfAborted();
      const work = scan();
      if (!cancel) await work;
      else await new Promise<void>((resolve,reject)=>{
        if (cancel.aborted) { reject(cancel.reason); return; }
        const abort=()=>{reject(cancel.reason);};cancel.addEventListener("abort",abort,{once:true});
        work.then(()=>{cancel.removeEventListener("abort",abort);resolve();},error=>{cancel.removeEventListener("abort",abort);reject(error);});
      });
      return snapshot();
    },
    async watch() { const watch = randomUUID(); leases.set(watch, now() + 15000); await scan(); if (closed || !leases.has(watch)) return { watch }; stop ??= (options.interval ?? (fn => { const id = setInterval(fn, 1000); id.unref?.(); return () => clearInterval(id); }))(() => { expire(); if (leases.size) void scan().catch(() => {}); }); return { watch }; },
    renew(id: string) { expire(); if (!leases.has(id)) throw Object.assign(Error("That layer watch expired. Watch again."), { code: "bad_request" }); leases.set(id, now() + 15000); },
    stop(id: string) { leases.delete(id); expire(); },
    snapshot,
    close() { closed = true; lifetime.abort(); leases.clear(); stop?.(); stop = undefined; },
  };
}

// One owner of reusable sector decode jobs. Requester cancellation never cancels another recording's shared read.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { SECTOR_READER_VERSION } from "../../xf-studio/authoring/src/native/streaming-sector";
import { NATIVE_READER_VERSION } from "../../xf-studio/authoring/src/native/resource-document";
import { NativeBudgetError, NativeMalformedError, NativeUnsupportedError } from "../../xf-studio/authoring/src/native/native-errors";

export interface SourceStamp { path: string; size: number; mtimeMs: number }
import { decodeSector, SECTOR_BYTES_LIMIT, type CachedSector } from "./sector-data.ts";
export { COLLIDER_STRIDE, type CachedSector } from "./sector-data.ts";
export const SECTOR_CACHE_VERSION = 4;
export interface SectorRequest { root: string; source: SourceStamp; resource: string }
export function sectorCacheKey(source: SourceStamp, resource: string, version = SECTOR_CACHE_VERSION): string {
  return createHash("sha256").update(JSON.stringify({ source, resource, version, nativeSector: SECTOR_READER_VERSION, native: NATIVE_READER_VERSION })).digest("hex");
}
type Task = { request: SectorRequest; resolve: (b: Uint8Array) => void; reject: (e: unknown) => void; signal: AbortSignal; abort: () => void; cancelled: boolean };
type Slot = { worker: Worker; task?: Task; closing?: Promise<void>; closed?: () => void };
export class SectorWorkers {
  private slots: Slot[] = [];
  private queue: Task[] = [];
  private idle: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private shutdownJob?: Promise<void>;
  constructor(private readonly concurrency = 2, private readonly mode: "collisions" | "content" = "collisions",
    private readonly makeWorker: () => Worker = () => new Worker(new URL("./sector-worker.ts", import.meta.url).href)) {}
  read = (request: SectorRequest, signal: AbortSignal): Promise<Uint8Array> => new Promise((resolve, reject) => {
    signal.throwIfAborted();
    if (this.stopped) throw Error("Sector workers are shut down.");
    clearTimeout(this.idle);
    const task: Task = { request, resolve, reject, signal, cancelled: false, abort: () => {
      task.cancelled = true; this.queue = this.queue.filter(t => t !== task); reject(signal.reason ?? new DOMException("Cancelled.", "AbortError"));
    } };
    signal.addEventListener("abort", task.abort, { once: true }); this.queue.push(task); this.pump();
  });
  private pump() {
    if (this.stopped) return;
    while (this.queue.length) {
      let slot = this.slots.find(s => !s.task && !s.closing);
      if (!slot) {
        if (this.slots.filter(s => !s.closing).length >= this.concurrency) return;
        slot = { worker: this.makeWorker() }; this.slots.push(slot);
        const mine = slot;
        mine.worker.onmessage = event => {
          if (event.data.closed) { this.slots = this.slots.filter(s => s !== mine); mine.closed?.(); return; }
          const task = mine.task; mine.task = undefined;
          if (task) {
            task.signal.removeEventListener("abort", task.abort);
            if (!task.cancelled) {
              const e = event.data.error, ErrorType = e?.name === "NativeBudgetError" ? NativeBudgetError : e?.name === "NativeMalformedError" ? NativeMalformedError : e?.name === "NativeUnsupportedError" ? NativeUnsupportedError : Error;
              if (e) task.reject(new ErrorType(e.message)); else task.resolve(event.data.data);
            }
          }
          this.pump();
          if (!this.stopped && !this.queue.length && this.slots.every(s => !s.task)) this.idle = setTimeout(() => { void this.closeIdle(); }, 250);
        };
        mine.worker.onerror = event => {
          const task = mine.task; if (task) { task.signal.removeEventListener("abort", task.abort); task.reject(Error(event.message)); }
          mine.worker.terminate(); this.slots = this.slots.filter(s => s !== mine); mine.closed?.(); this.pump();
        };
      }
      const task = this.queue.shift()!; if (task.cancelled) continue;
      slot.task = task; slot.worker.postMessage({ root: task.request.root, archive: task.request.source.path, resource: task.request.resource, mode: this.mode });
    }
  }
  /** Finish the bounded current read before closing, so each worker releases its Oodle load cleanly. */
  async closeIdle() {
    clearTimeout(this.idle);
    const idle = this.slots.filter(s => !s.task && !s.closing);
    await Promise.all(idle.map(s => { s.closing = new Promise<void>(resolve => { s.closed = resolve; }); s.worker.postMessage({ close: true }); return s.closing; }));
  }
  /** Final owner shutdown, not requester cancellation. Queue close behind active reads; terminate stalled slots at the deadline.
   * W0's shared consumers continue to use closeIdle(), which never interrupts an active/shared read. */
  shutdown(deadlineMs = 1000): Promise<void> {
    if (this.shutdownJob) return this.shutdownJob;
    if (!Number.isFinite(deadlineMs) || deadlineMs < 0 || deadlineMs > 60_000) throw Error("Invalid worker shutdown deadline.");
    this.stopped = true; clearTimeout(this.idle);
    const error = new DOMException("Sector worker owner shut down.", "AbortError");
    for (const task of [...this.queue, ...this.slots.flatMap(s => s.task ? [s.task] : [])]) {
      task.signal.removeEventListener("abort", task.abort); task.cancelled = true; task.reject(error);
    }
    this.queue = [];
    const slots = [...this.slots];
    const closing = slots.map(s => {
      if (!s.closing) { s.closing = new Promise<void>(resolve => { s.closed = resolve; }); s.worker.postMessage({ close: true }); }
      return s.closing;
    });
    this.shutdownJob = new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        for (const s of slots) if (this.slots.includes(s)) {
          s.worker.onmessage = null; s.worker.onerror = null; s.worker.terminate();
          s.task = undefined; this.slots = this.slots.filter(slot => slot !== s); s.closed?.();
        }
        resolve();
      }, deadlineMs);
      void Promise.all(closing).then(() => { clearTimeout(timer); resolve(); });
    });
    return this.shutdownJob;
  }
}

export function createSectorCache<T = CachedSector>(dir: string, reader: (r: SectorRequest, s: AbortSignal) => Promise<Uint8Array>, codec?: { version: number; decode: (bytes: Uint8Array) => T }) {
  const decode = codec?.decode ?? (decodeSector as (bytes: Uint8Array) => T);
  const keyOf = (request: SectorRequest) => sectorCacheKey(request.source, request.resource, codec?.version ?? SECTOR_CACHE_VERSION);
  const jobs = new Map<string, { ctl: AbortController; promise: Promise<T>; waiters: number }>(), memory = new Map<string, Uint8Array>(); let held = 0, leases = 0, unavailable = false, db: Database | undefined;
  const name = codec ? `sectors-content-v${codec.version}.sqlite` : "sectors-v4.sqlite", file = join(dir, name);
  const discard = () => { try { db?.close(); } catch { /* A damaged connection must not fail the open. */ } db = undefined; };
  const database = () => {
    if (!db) {
      mkdirSync(dir, { recursive: true }); const opened = new Database(file);
      // Keep the key index separate from large blobs; WITHOUT ROWID made even cache probes read blob pages.
      try { opened.exec("PRAGMA busy_timeout=100; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-32768; PRAGMA mmap_size=536870912; CREATE TABLE IF NOT EXISTS sectors (key TEXT PRIMARY KEY, bytes BLOB NOT NULL, size INTEGER NOT NULL, written INTEGER NOT NULL)"); db = opened; }
      catch (error) { try { opened.close(); } catch { /* Preserve the original error. */ } throw error; }
    }
    return db;
  };
  const busy = (error: unknown) => /SQLITE_(BUSY|LOCKED)|database (?:is|table is|schema is) locked/i.test(String((error as Error)?.message ?? error))
    || /SQLITE_(BUSY|LOCKED)/.test(String((error as { code?: unknown })?.code ?? ""));
  const quarantine = () => {
    discard();
    try {
      if (!existsSync(file)) return false;
      const suffix = `.corrupt-${Date.now()}-${process.pid}-${randomUUID()}`;
      renameSync(file, file + suffix);
      for (const sidecar of ["-wal", "-shm"]) if (existsSync(file + sidecar)) renameSync(file + sidecar, file + suffix + sidecar);
      try { for (const entry of readdirSync(dir)) if (entry.startsWith(`${name}.corrupt-`) && !entry.startsWith(name + suffix)) rmSync(join(dir, entry), { force: true }); }
      catch { /* Old quarantine cleanup cannot block a fresh cache. */ }
      return true;
    } catch { return false; }
  };
  const useDisk = <T>(fallback: T, work: (connection: Database) => T): T => {
    let retries = 0, recovered = false;
    while (!unavailable) {
      try { return work(database()); }
      catch (error) {
        if (busy(error)) {
          if (retries++ < 2) continue;
          unavailable = true; discard(); return fallback;
        }
        if (recovered || !quarantine()) { unavailable = true; return fallback; }
        recovered = true; retries = 0;
      }
    }
    return fallback;
  };
  const close = () => {
    if (leases || jobs.size || !db) return;
    discard();
  };
  const remember = (key: string, bytes: Uint8Array) => {
    const old = memory.get(key); if (old) held -= old.byteLength;
    memory.set(key, bytes); held += bytes.byteLength;
    while (held > 32 * 1024 * 1024 && memory.size > 1) { const first = memory.keys().next().value!; held -= memory.get(first)!.byteLength; memory.delete(first); }
  };
  return {
    begin() { if (!leases && !jobs.size) unavailable = false; leases++; },
    end() { if (!leases) throw Error("Unbalanced sector-cache lease."); leases--; close(); },
    has(request: SectorRequest) {
      const key = keyOf(request); if (memory.has(key)) return true;
      try { return useDisk(false, d => Boolean(d.query("SELECT 1 FROM sectors WHERE key = ? AND length(bytes) <= ?").get(key, SECTOR_BYTES_LIMIT))); } finally { close(); }
    },
    async read(request: SectorRequest, signal: AbortSignal): Promise<T> {
      signal.throwIfAborted(); const key = keyOf(request);
      const ready = memory.get(key); if (ready) return decode(ready);
      try {
        const row = useDisk(null, d => d.query("SELECT bytes FROM sectors WHERE key = ? AND length(bytes) <= ?").get(key, SECTOR_BYTES_LIMIT) as { bytes: Uint8Array } | null);
        if (row) { try { const data = decode(row.bytes); remember(key, row.bytes); return data; } catch { /* Rebuild corrupt cache data. */ } }
      } finally { close(); }
      let job = jobs.get(key);
      if (!job) {
        const ctl = new AbortController();
        const promise = reader(request, ctl.signal).then(bytes => {
          ctl.signal.throwIfAborted(); const result = decode(bytes);
          useDisk(undefined, d => d.transaction(() => d.query("INSERT INTO sectors (key, bytes, size, written) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET bytes=excluded.bytes, size=excluded.size, written=excluded.written").run(key, bytes, bytes.byteLength, Date.now())).immediate());
          remember(key, bytes); return result;
        });
        job = { ctl, promise, waiters: 0 }; jobs.set(key, job); const mine = job;
        void promise.finally(() => { if (jobs.get(key) === mine) jobs.delete(key); close(); }).catch(() => {});
      }
      const mine = job; mine.waiters++;
      return new Promise((resolve, reject) => {
        let done = false;
        const finish = (error?: unknown, data?: T) => {
          if (done) return; done = true; signal.removeEventListener("abort", abort);
          if (--mine.waiters === 0 && signal.aborted && jobs.get(key) === mine) { mine.ctl.abort(); jobs.delete(key); close(); }
          if (error) reject(error); else resolve(data!);
        };
        const abort = () => finish(signal.reason ?? new DOMException("Cancelled.", "AbortError"));
        signal.addEventListener("abort", abort, { once: true }); mine.promise.then(data => finish(undefined, data), finish); if (signal.aborted) abort();
      });
    },
    trim() {
      try { useDisk(undefined, d => {
        const rows = d.query("SELECT key, size FROM sectors ORDER BY written DESC").all() as { key: string; size: number }[];
        let held = 0; for (const row of rows) { held += row.size; if (held > 512 * 1024 * 1024) d.query("DELETE FROM sectors WHERE key = ?").run(row.key); }
      }); } finally { close(); }
    },
  };
}

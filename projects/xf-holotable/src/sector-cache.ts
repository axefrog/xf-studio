// One owner of reusable sector decode jobs. Requester cancellation never cancels another recording's shared read.
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { SECTOR_READER_VERSION } from "../../xf-studio/authoring/src/native/streaming-sector";
import { NATIVE_READER_VERSION } from "../../xf-studio/authoring/src/native/resource-document";
import { NativeBudgetError, NativeMalformedError, NativeUnsupportedError } from "../../xf-studio/authoring/src/native/native-errors";

export interface SourceStamp { path: string; size: number; mtimeMs: number }
import { decodeSector, type CachedSector } from "./sector-data.ts";
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
  constructor(private readonly concurrency = 2) {}
  read = (request: SectorRequest, signal: AbortSignal): Promise<Uint8Array> => new Promise((resolve, reject) => {
    signal.throwIfAborted();
    clearTimeout(this.idle);
    const task: Task = { request, resolve, reject, signal, cancelled: false, abort: () => {
      task.cancelled = true; this.queue = this.queue.filter(t => t !== task); reject(signal.reason ?? new DOMException("Cancelled.", "AbortError"));
    } };
    signal.addEventListener("abort", task.abort, { once: true }); this.queue.push(task); this.pump();
  });
  private pump() {
    while (this.queue.length) {
      let slot = this.slots.find(s => !s.task && !s.closing);
      if (!slot) {
        if (this.slots.filter(s => !s.closing).length >= this.concurrency) return;
        slot = { worker: new Worker(new URL("./sector-worker.ts", import.meta.url).href) }; this.slots.push(slot);
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
          if (!this.queue.length && this.slots.every(s => !s.task)) this.idle = setTimeout(() => { void this.closeIdle(); }, 250);
        };
        mine.worker.onerror = event => {
          const task = mine.task; if (task) { task.signal.removeEventListener("abort", task.abort); task.reject(Error(event.message)); }
          mine.worker.terminate(); this.slots = this.slots.filter(s => s !== mine); mine.closed?.(); this.pump();
        };
      }
      const task = this.queue.shift()!; if (task.cancelled) continue;
      slot.task = task; slot.worker.postMessage({ root: task.request.root, archive: task.request.source.path, resource: task.request.resource });
    }
  }
  /** Finish the bounded current read before closing, so each worker releases its Oodle load cleanly. */
  async closeIdle() {
    clearTimeout(this.idle);
    const idle = this.slots.filter(s => !s.task && !s.closing);
    await Promise.all(idle.map(s => { s.closing = new Promise<void>(resolve => { s.closed = resolve; }); s.worker.postMessage({ close: true }); return s.closing; }));
  }
}

type Job = { ctl: AbortController; promise: Promise<CachedSector>; waiters: number };
export function createSectorCache(dir: string, reader: (r: SectorRequest, s: AbortSignal) => Promise<Uint8Array>) {
  const jobs = new Map<string, Job>(), memory = new Map<string, Uint8Array>(); let held = 0, leases = 0, transaction = false, db: Database | undefined;
  const database = () => {
    if (!db) {
      mkdirSync(dir, { recursive: true }); const opened = new Database(join(dir, "sectors-v4.sqlite"));
      // Keep the key index separate from large blobs; WITHOUT ROWID made even cache probes read blob pages.
      try { opened.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-32768; PRAGMA mmap_size=536870912; CREATE TABLE IF NOT EXISTS sectors (key TEXT PRIMARY KEY, bytes BLOB NOT NULL, size INTEGER NOT NULL, written INTEGER NOT NULL)"); db = opened; }
      catch (error) { opened.close(); throw error; }
    }
    return db;
  };
  const close = () => {
    if (leases || jobs.size || !db) return;
    if (transaction) { db.exec("COMMIT"); transaction = false; }
    db.close(); db = undefined;
  };
  const remember = (key: string, bytes: Uint8Array) => {
    const old = memory.get(key); if (old) held -= old.byteLength;
    memory.set(key, bytes); held += bytes.byteLength;
    while (held > 32 * 1024 * 1024 && memory.size > 1) { const first = memory.keys().next().value!; held -= memory.get(first)!.byteLength; memory.delete(first); }
  };
  return {
    begin(write = true) { const d = database(); if (write && !transaction) { d.exec("BEGIN"); transaction = true; } leases++; },
    end() { if (!leases) throw Error("Unbalanced sector-cache lease."); leases--; close(); },
    has(request: SectorRequest) {
      const key = sectorCacheKey(request.source, request.resource); if (memory.has(key)) return true;
      try { return Boolean(database().query("SELECT 1 FROM sectors WHERE key = ? AND size <= 67108864").get(key)); } finally { close(); }
    },
    async read(request: SectorRequest, signal: AbortSignal): Promise<CachedSector> {
      signal.throwIfAborted(); const key = sectorCacheKey(request.source, request.resource);
      const ready = memory.get(key); if (ready) return decodeSector(ready);
      try {
        const row = database().query("SELECT bytes FROM sectors WHERE key = ? AND size <= 67108864").get(key) as { bytes: Uint8Array } | null;
        if (row) { try { const data = decodeSector(row.bytes); remember(key, row.bytes); return data; } catch { /* Rebuild corrupt cache data. */ } }
      } finally { close(); }
      let job = jobs.get(key);
      if (!job) {
        const ctl = new AbortController();
        const promise = reader(request, ctl.signal).then(bytes => {
          ctl.signal.throwIfAborted(); const result = decodeSector(bytes);
          database().query("INSERT INTO sectors (key, bytes, size, written) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET bytes=excluded.bytes, size=excluded.size, written=excluded.written").run(key, bytes, bytes.byteLength, Date.now());
          remember(key, bytes); return result;
        });
        job = { ctl, promise, waiters: 0 }; jobs.set(key, job); const mine = job;
        void promise.finally(() => { if (jobs.get(key) === mine) jobs.delete(key); close(); }).catch(() => {});
      }
      const mine = job; mine.waiters++;
      return new Promise((resolve, reject) => {
        let done = false;
        const finish = (error?: unknown, data?: CachedSector) => {
          if (done) return; done = true; signal.removeEventListener("abort", abort);
          if (--mine.waiters === 0 && signal.aborted && jobs.get(key) === mine) { mine.ctl.abort(); jobs.delete(key); close(); }
          if (error) reject(error); else resolve(data!);
        };
        const abort = () => finish(signal.reason ?? new DOMException("Cancelled.", "AbortError"));
        signal.addEventListener("abort", abort, { once: true }); mine.promise.then(data => finish(undefined, data), finish); if (signal.aborted) abort();
      });
    },
    trim() {
      const d = database(), rows = d.query("SELECT key, size FROM sectors ORDER BY written DESC").all() as { key: string; size: number }[];
      let held = 0; for (const row of rows) { held += row.size; if (held > 512 * 1024 * 1024) d.query("DELETE FROM sectors WHERE key = ?").run(row.key); }
      close();
    },
  };
}

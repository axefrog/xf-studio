/**
 * The simulated store: a `MemoryStore` behind the scheduler, so every reply is an event the scheduler orders, delays
 * or loses, with refused writes, lost replies (the write landed; the answer didn't) and crash points. A second graph
 * over the same store is another window: a conflicting writer.
 */
import { MemoryStore } from "../store";
import type { AppendRequest, AppendResult, GraphStore } from "../store";
import type { Entry, NodeRef, Snapshot } from "../types";
import type { Scheduler } from "./sim-sources";

export class SimStore implements GraphStore {
  /** Refuse the next N appends (nothing written). */
  failNext = 0;
  /** Lose the reply of the next N appends (written, never answered). */
  loseNext = 0;
  constructor(readonly inner: MemoryStore, private scheduler: Scheduler, private latency = 3) {}

  private reply<T>(label: string, run: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => this.scheduler.schedule(this.latency, "store", label, () => {
      try { resolve(run()); } catch (error) { reject(error); }
    }));
  }
  list() { return this.reply("list", () => this.inner.listNow()); }
  load() { return this.reply("load", () => this.inner.loadNow()); }
  readStream(node: NodeRef, afterSeq = 0) { return this.reply("read", () => this.inner.readStreamNow(node, afterSeq)); }
  append(request: AppendRequest): Promise<AppendResult> {
    return new Promise((resolve, reject) => this.scheduler.schedule(this.latency, "store", `append ${request.commit.slice(0, 8)}`, () => {
      if (this.failNext > 0) { this.failNext--; reject(new Error("The database couldn't be written.")); return; }
      const result = this.inner.appendNow(request);
      if (this.loseNext > 0) { this.loseNext--; return; }
      resolve(result);
    }));
  }
  changesSince(pos: number) { return this.reply("changes", () => this.inner.changesSinceNow(pos)); }
  counter() { return this.inner.counter(); }
  putSnapshot(snapshot: Snapshot) { return this.reply("snapshot", () => this.inner.putSnapshotNow(snapshot)); }
  dropSnapshots(node: NodeRef) { return this.inner.dropSnapshots(node); }
  compact(node: NodeRef, entries: readonly Entry[], at: number) { return this.reply("compact", () => this.inner.compactNow(node, entries, at)); }
  purge(node: NodeRef) { return this.reply("purge", () => this.inner.purgeNow(node)); }
}

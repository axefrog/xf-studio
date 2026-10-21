/**
 * Spike prototype (S1): one window's document owners with the §2.2 outbox, and the acknowledgement and rebasing rules
 * this spike adds (README "Acknowledgement and rebasing rules", A1–A7). Evidence code, not production.
 *
 * - A1 Freeze on send. From its first send an entry's ID, bases and values never change; every resend reuses its ID.
 * - A2 Successors. A single-document edit coalesces into that document's newest entry only while it is unsent (or in
 *   conflict, where it updates "mine"). Behind a frozen entry it opens a successor based `{ after: <frozen ID> }`.
 * - A3 Acknowledgement. The host's answer (fresh, or replayed from the receipt) removes the entry, makes its revisions the
 *   window's baseline and rebases every `{ after }` successor onto them, in one synchronous outbox write.
 * - A4/A5 Replays are idempotent at the host (host.ts): a committed command is acknowledged again, never a conflict.
 * - A6 Stale. The entry becomes a conflict holding the current revisions; single-document successors fold into its "mine";
 *   multi-document successors stay blocked until it is resolved. Nothing retries.
 * - A7 Revision checks skip documents with a frozen entry; above the baseline only.
 */
import { refKey, type Current, type Ref, type TransactRequest, type TransactResult } from "./host";

export type Base = number | { after: string };
export type OutboxWrite = { kind: string; id: string; base: Base; value?: unknown; tombstone?: true };
export type Entry = { id: string; seq: number; command: string; writes: OutboxWrite[]; at: number; frozen?: true;
  state: "queued" | "conflict"; current?: Current };
export type OutboxStorage = { save(entries: readonly Entry[]): void; load(): Entry[] };
export type HostPort = { transact(request: TransactRequest): Promise<TransactResult> };
export type Edit = { kind: string; id: string; value?: unknown; tombstone?: true };
export type WindowEvents = {
  recorded?(entry: Entry, protectedWrite: boolean): void;
  acknowledged?(entry: Entry, revisions: Record<string, number>, replayed?: string): void;
  conflict?(entry: Entry): void;
  sent?(entry: Entry): void;
};

type Held = { revision: number; value: unknown };

export class SpikeWindow {
  readonly held = new Map<string, Held>();
  entries: Entry[] = [];
  /** False after a failed outbox write: the window shows "Your latest changes aren't protected on this computer". */
  protectedWrites = true;
  readonly unprotected = new Set<string>();
  private readonly inFlight = new Set<string>();
  private forget: string[] = [];
  private seq = 0;
  private stopped = false;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly port: HostPort, private readonly storage: OutboxStorage,
    readonly events: WindowEvents = {}, private readonly options: { retryMs?: number; newId?: () => string; now?: () => number } = {}) {}

  private newId() { return (this.options.newId ?? (() => crypto.randomUUID()))(); }
  private now() { return (this.options.now ?? Date.now)(); }

  /** Start: the stored outbox, replayed in order (every entry may have been sent before; IDs are kept, A1). */
  open(baselines: Iterable<[Ref, Held | null]> = []): void {
    for (const [ref, held] of baselines) this.held.set(refKey(ref), held ?? { revision: 0, value: undefined });
    this.entries = this.storage.load();
    this.seq = Math.max(0, ...this.entries.map(entry => entry.seq));
    for (const entry of this.entries) {
      entry.frozen = true; // It may have been sent (A1).
      for (const write of entry.writes) {
        const held = this.held.get(refKey(write)) ?? { revision: typeof write.base === "number" ? write.base : 0, value: undefined };
        this.held.set(refKey(write), { ...held, value: write.value });
      }
    }
    // Conflicts stay conflicts across a restart, and are shown again.
    for (const entry of this.entries) if (entry.state === "conflict") queueMicrotask(() => this.events.conflict?.(entry));
    this.pump();
  }

  value(ref: Ref): unknown { return this.held.get(refKey(ref))?.value; }

  private lastFor(key: string): Entry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i].writes.some(write => refKey(write) === key)) return this.entries[i];
  }

  private baseFor(key: string): Base {
    const last = this.lastFor(key);
    return last ? { after: last.id } : this.held.get(key)?.revision ?? 0;
  }

  /** One committed owner command: synchronous (values, outbox write), then sent in the background. */
  commit(command: string, edits: Edit[]): Entry {
    if (this.stopped) throw Error("This window is read-only.");
    let entry: Entry | undefined;
    if (edits.length === 1) {
      const key = refKey(edits[0]), last = this.lastFor(key);
      if (last && last.writes.length === 1 && (!last.frozen || last.state === "conflict")) {
        last.writes[0].value = edits[0].value; last.writes[0].tombstone = edits[0].tombstone; last.at = this.now();
        if (last.command !== command) last.command = "coalesced";
        entry = last;
      }
    }
    entry ??= this.append(command, edits);
    for (const edit of edits) {
      const key = refKey(edit);
      this.held.set(key, { revision: this.held.get(key)?.revision ?? 0, value: edit.value });
    }
    const ok = this.persist();
    if (!ok) for (const edit of edits) this.unprotected.add(refKey(edit));
    this.events.recorded?.(entry, ok);
    queueMicrotask(() => this.pump());
    return entry;
  }

  private append(command: string, edits: Edit[]): Entry {
    const entry: Entry = { id: this.newId(), seq: ++this.seq, command, at: this.now(), state: "queued",
      writes: edits.map(edit => ({ kind: edit.kind, id: edit.id, base: this.baseFor(refKey(edit)), value: edit.value,
        ...(edit.tombstone ? { tombstone: true as const } : {}) })) };
    this.entries.push(entry);
    return entry;
  }

  /** The synchronous outbox write. A failure never blocks the edit: the window shows the warning and keeps sending. */
  private persist(): boolean {
    try { this.storage.save(this.entries); this.protectedWrites = true; this.unprotected.clear(); return true; }
    catch { this.protectedWrites = false; return false; }
  }

  private pump(): void {
    if (this.stopped) return;
    for (const entry of this.entries) {
      if (entry.state !== "queued" || this.inFlight.has(entry.id)) continue;
      if (entry.writes.some(write => typeof write.base !== "number")) continue;
      void this.send(entry);
    }
  }

  private async send(entry: Entry): Promise<void> {
    entry.frozen = true; // A1: from here its ID, bases and values are fixed.
    this.inFlight.add(entry.id);
    const forget = this.forget; this.forget = [];
    this.events.sent?.(entry);
    let result: TransactResult;
    try {
      result = await this.port.transact({ id: entry.id, command: entry.command, forget,
        writes: entry.writes.map(write => ({ ...write, base: write.base as number })) });
    } catch {
      // Lost: maybe committed, maybe not. Resent with the same ID later (A1); the host's receipt decides (A4).
      this.inFlight.delete(entry.id);
      this.forget.push(...forget);
      this.retry ??= setTimeout(() => { this.retry = null; this.pump(); }, this.options.retryMs ?? 50);
      return;
    }
    this.inFlight.delete(entry.id);
    if (result.ok) this.acknowledge(entry, result.revisions, result.replayed);
    else if (result.reason === "stale") this.toConflict(entry, result.current);
    else this.stopped = true; // fenced: a newer lease holds the workspace.
    this.pump();
  }

  /** A3. */
  private acknowledge(entry: Entry, revisions: Record<string, number>, replayed?: string): void {
    this.entries = this.entries.filter(other => other !== entry);
    for (const write of entry.writes) {
      const key = refKey(write), held = this.held.get(key);
      this.held.set(key, { revision: revisions[key], value: held?.value });
    }
    for (const other of this.entries) for (const write of other.writes)
      if (typeof write.base === "object" && write.base.after === entry.id) write.base = revisions[refKey(write)];
    this.persist();
    this.forget.push(entry.id);
    this.events.acknowledged?.(entry, revisions, replayed);
  }

  /** A6. */
  private toConflict(entry: Entry, current: Current): void {
    entry.state = "conflict"; entry.current = current;
    if (entry.writes.length === 1) {
      const key = refKey(entry.writes[0]);
      for (const other of [...this.entries]) {
        if (other === entry || other.writes.length !== 1 || refKey(other.writes[0]) !== key) continue;
        const base = other.writes[0].base;
        if (typeof base === "object" && base.after === entry.id) {
          entry.writes[0].value = other.writes[0].value; entry.writes[0].tombstone = other.writes[0].tombstone;
          this.entries = this.entries.filter(item => item !== other);
          for (const later of this.entries) for (const write of later.writes)
            if (typeof write.base === "object" && write.base.after === other.id) write.base = { after: entry.id };
        }
      }
    }
    this.persist();
    this.events.conflict?.(entry);
  }

  conflicts(): Entry[] { return this.entries.filter(entry => entry.state === "conflict"); }

  /** Keep mine: an explicit command over the newer revisions, with a fresh ID. */
  keepMine(entry: Entry): void {
    const fresh: Entry = { ...entry, id: this.newId(), state: "queued", current: undefined, frozen: undefined,
      writes: entry.writes.map(write => ({ ...write, base: entry.current?.[refKey(write)]?.revision ?? 0 })) };
    this.replace(entry, fresh);
  }

  /** Use theirs: drop mine; later commands that were based on it go stale in turn (they are never sent over theirs). */
  useTheirs(entry: Entry): void {
    for (const write of entry.writes) {
      const now = entry.current?.[refKey(write)];
      this.held.set(refKey(write), { revision: now?.revision ?? 0, value: now?.value });
    }
    for (const other of this.entries) for (const write of other.writes)
      if (typeof write.base === "object" && write.base.after === entry.id) write.base = entry.writes.find(w => refKey(w) === refKey(write))!.base;
    this.entries = this.entries.filter(other => other !== entry);
    this.persist();
    this.pump();
  }

  /** Keep both (looks): mine goes to a fork document, the original takes theirs; one outbox write, so a kill keeps one or the other. */
  keepBoth(entry: Entry, forkId: (ref: Ref) => string): Entry {
    const fork: Entry = { id: this.newId(), seq: ++this.seq, command: "look.fork", at: this.now(), state: "queued",
      writes: entry.writes.map(write => ({ kind: write.kind, id: forkId(write), base: 0, value: write.value })) };
    for (const write of entry.writes) {
      const now = entry.current?.[refKey(write)];
      this.held.set(refKey(write), { revision: now?.revision ?? 0, value: now?.value });
    }
    for (const write of fork.writes) this.held.set(refKey(write), { revision: 0, value: write.value });
    for (const other of this.entries) for (const write of other.writes)
      if (typeof write.base === "object" && write.base.after === entry.id) write.base = entry.writes.find(w => refKey(w) === refKey(write))!.base;
    this.entries = [...this.entries.filter(other => other !== entry), fork];
    const ok = this.persist();
    this.events.recorded?.(fork, ok);
    queueMicrotask(() => this.pump());
    return fork;
  }

  private replace(old: Entry, fresh: Entry) {
    this.entries = this.entries.map(entry => entry === old ? fresh : entry);
    for (const other of this.entries) for (const write of other.writes)
      if (typeof write.base === "object" && write.base.after === old.id) write.base = { after: fresh.id };
    this.persist();
    this.pump();
  }

  /** A7: a newer stored revision of a clean document is taken; one with entries is left to its commands. */
  refresh(ref: Ref, stored: Held): boolean {
    const key = refKey(ref), held = this.held.get(key);
    if (this.lastFor(key) || (held && stored.revision <= held.revision)) return false;
    this.held.set(key, stored);
    return true;
  }

  /** Resolves when the outbox is empty, or reports what is left once `signal` aborts. */
  async flush(signal?: AbortSignal): Promise<{ pending: number; conflicts: number }> {
    while (this.entries.some(entry => entry.state === "queued") && !signal?.aborted) await new Promise(resolve => setTimeout(resolve, 5));
    return { pending: this.entries.filter(entry => entry.state === "queued").length, conflicts: this.conflicts().length };
  }

  stop(): void { this.stopped = true; if (this.retry) clearTimeout(this.retry); }
}

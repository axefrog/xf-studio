/**
 * The outbox (profiles design §2.2): the one way any document's local state reaches the library. Every owner command is recorded here
 * synchronously, before anything is sent, so every unacknowledged mutation survives a renderer crash; an owner's in-memory view of a
 * document is its acknowledged value with its entries applied on top (`document`). The rules are the ones spike S1 proved (A1–A7,
 * `experiments/038-profiles-spikes/README.md`):
 *
 * - **A1, freeze on send.** From its first send an entry's ID, bases and values never change, and every resend reuses its ID. Entries
 *   read back from storage may have been sent, so they are frozen too.
 * - **A2, successors.** A single-document edit coalesces into its document's newest entry only while that entry is unsent, or in conflict
 *   (where it updates "mine"). Behind a frozen entry it opens one successor based `{ after: <frozen ID> }`; later edits coalesce there.
 *   Multi-document commands never coalesce: they queue behind every earlier entry touching any of their documents.
 * - **A3, acknowledgement.** The answer, fresh or from a receipt, removes the entry, makes its revisions the documents' baselines and
 *   rebases every `{ after }` successor onto them, in one synchronous write of each document's key. Its ID goes into the next command's
 *   `forget`.
 * - **A4, A5** are the host's (`DocumentStore.transact`): receipts, and the equal-value rule.
 * - **A6, stale.** A stale answer makes the entry a conflict holding the documents as they are now, and nothing retries it.
 *   Single-document successors fold into its "mine"; multi-document successors stay blocked. Keep mine, Use theirs and Keep both are
 *   each one outbox write, and stored conflicts are raised again when the outbox opens.
 * - **A7, revision checks** (`check`) skip every document with an entry; a clean document takes a stored revision only above its
 *   baseline, so a receipt replay never shows as an external change.
 *
 * **Storage.** Each document's entries live under its own key (`OutboxStorage`, `xfs.outbox.<workspace>.<kind>/<id>` in the adapters),
 * so a commit rewrites only its own document's entries. A multi-document entry is kept under every document it writes; each key's write
 * is consistent on its own, and `open` repairs a set of keys a crash left part-written (a resolution records what it replaced or
 * dropped, so a kill between two keys' writes never brings back a resolved conflict or loses "mine"). A write that fails never blocks the
 * edit: the edit applies and is still sent, and `status().unprotected` names the documents whose changes aren't protected on this
 * computer until their next successful write.
 */
import type { CurrentDocument, DocumentRef, TransactAnswer, TransactRequest } from "../api/document-commands";
import { documentKey } from "../api/document-commands";

export type OutboxBase = number | { readonly after: string };
export type OutboxWrite = { readonly kind: string; readonly id: string; base: OutboxBase; value: unknown };
export type OutboxEntry = {
  readonly id: string;
  readonly seq: number;
  command: string;
  writes: OutboxWrite[];
  at: number;
  state: "queued" | "conflict";
  /** In conflict: each written document as the library holds it now (theirs). */
  current?: Record<string, CurrentDocument>;
  /** Entries this one replaced when a conflict was resolved (Keep mine, Keep both): a crash between key writes drops them on open. */
  replaces?: string[];
};
/** One document's change in a command: the value it stores next (a `Tombstone` for a delete). */
export type OutboxEdit = { readonly kind: string; readonly id: string; readonly value: unknown };

/** Where the outbox's keys are kept: synchronous; `write` throws when the key couldn't be stored (quota, a failed host-file write). */
export interface OutboxStorage {
  /** Every stored key's text, by document key (`<kind>/<id>`). */
  load(): ReadonlyMap<string, string>;
  /**
   * Stores a document's text. `empty`: it holds no entries any more, so the key may be removed (a store with a second, slower copy keeps
   * the empty text, whose stamp is newer than that copy's, until the copy is removed too).
   */
  write(key: string, text: string, empty: boolean): void;
  /**
   * Where a key is also stored in the background (the desktop host's file): `listener` hears whether each background write of a key
   * landed, so a failed one makes that document unprotected until its next write lands.
   */
  watch?(listener: (key: string, stored: boolean) => void): void;
}
export type OutboxTransport = { transact(request: TransactRequest): Promise<TransactAnswer>;
  revisions(refs: readonly DocumentRef[], signal?: AbortSignal): Promise<Readonly<Record<string, number>>>;
  read(refs: readonly DocumentRef[], signal?: AbortSignal): Promise<Readonly<Record<string, CurrentDocument>>> };

export type OutboxEvent =
  | { readonly kind: "acknowledged"; readonly entry: OutboxEntry; readonly revisions: Readonly<Record<string, number>>; readonly replayed?: "receipt" | "equal" }
  | { readonly kind: "conflict"; readonly entry: OutboxEntry }
  /** A conflict was resolved; `refs` are the documents whose local value changed (Use theirs, Keep both) or will be written (Keep mine). */
  | { readonly kind: "resolved"; readonly entry: OutboxEntry; readonly how: "mine" | "theirs" | "both"; readonly refs: readonly DocumentRef[];
    /** The entry that now carries mine (Keep mine: over theirs; Keep both: the copy). */
    readonly replacement?: OutboxEntry }
  /** A revision check took newer revisions of these clean documents (A7). */
  | { readonly kind: "external"; readonly refs: readonly DocumentRef[] }
  /** Protection, sending or the stopped state changed. */
  | { readonly kind: "status" };

export type OutboxStatus = {
  /** Commands recorded and not yet acknowledged (in conflict excluded). */
  readonly pending: number;
  readonly conflicts: number;
  /** Documents whose latest change isn't protected on this computer (their key's last write failed). */
  readonly unprotected: readonly DocumentRef[];
  /** The last send failed (the host didn't answer); it is sent again shortly. */
  readonly failing: boolean;
  /** Stopped: the page released or lost its workspace, and nothing is written or sent again. */
  readonly stopped: boolean;
};
/** A document as an owner sees it: the baseline revision the library acknowledged, and the value with this page's entries on top. */
export type OutboxDocument = {
  readonly revision: number;
  /** Undefined: the document doesn't exist (here or in the library). */
  readonly value: unknown;
  /** Entries not yet acknowledged touch it (queued or in conflict). */
  readonly pending: boolean;
  /** The conflict touching it, if any. */
  readonly conflict: OutboxEntry | null;
  /**
   * What a command reading this document names as its base: it starts at the library's revision when an owner first holds it, and moves
   * on every change recorded here and every change taken from elsewhere (never on an acknowledgement, which changes nothing here).
   */
  readonly version: number;
};

export type OutboxOptions = {
  readonly newId?: () => string;
  readonly now?: () => number;
  /** How long after a failed send the outbox sends again. */
  readonly retryMs?: number;
  /** Whether this page may record changes now (it holds its workspace); default always. */
  readonly writable?: () => boolean;
  /** Whether this page may still send what it recorded (it holds its workspace, or is draining it as it releases); default `writable`. */
  readonly sendable?: () => boolean;
  readonly schedule?: (ms: number, run: () => void) => { cancel(): void };
  readonly report?: (error: unknown) => void;
};

const SCHEMA = "xfs/outbox-1";
type StoredKey = { schema: typeof SCHEMA; stamp: number; entries: OutboxEntry[]; dropped?: string[] };
type Held = { ref: DocumentRef; revision: number; value: unknown; known: boolean; version: number };

export class DocumentOutbox {
  private readonly held = new Map<string, Held>();
  private entries: OutboxEntry[] = [];
  private readonly inFlight = new Set<string>();
  private readonly unprotectedKeys = new Set<string>();
  private readonly listeners = new Set<(event: OutboxEvent) => void>();
  private waiters: (() => void)[] = [];
  private forget: string[] = [];
  /**
   * Acknowledged entries whose receipts can't be forgotten yet: some of their keys may still hold them in storage (a failed write, or a
   * background copy not yet written), and a receipt is what turns a replay of such a copy into this page's own write, never a conflict.
   */
  private readonly forgetting = new Map<string, Set<string>>();
  private seq = 0;
  private stamp = 0;
  private stopped = false;
  private opened = false;
  private failing = false;
  private failures = 0;
  private retry: { cancel(): void } | null = null;
  private sizes = new Map<string, number>();

  constructor(private readonly transport: OutboxTransport, private readonly storage: OutboxStorage, private readonly options: OutboxOptions = {}) {
    storage.watch?.((key, stored) => {
      if (this.stopped) return;
      if (stored) this.stored(key);
      const changed = stored ? this.unprotectedKeys.delete(key) : !this.unprotectedKeys.has(key) && !!this.unprotectedKeys.add(key);
      if (changed) this.emit({ kind: "status" });
    });
  }

  private newId() { return (this.options.newId ?? (() => `o-${crypto.randomUUID()}`))(); }
  private now() { return (this.options.now ?? Date.now)(); }
  private writable() { return !this.stopped && (this.options.writable?.() ?? true); }
  private sendable() { return !this.stopped && (this.options.sendable ?? this.options.writable)?.() !== false; }

  // -------------------------------------------------------------------------------------------------------------
  // Opening and storage

  /**
   * Reads the stored entries, repairs keys a crash left part-written, raises stored conflicts again and replays every queued entry under
   * its own ID. Call once, when this page holds its workspace.
   */
  open(): void {
    if (this.opened) return;
    this.opened = true;
    const records = new Map<string, StoredKey>();
    for (const [key, text] of this.storage.load()) {
      try {
        const record = JSON.parse(text) as StoredKey;
        if (record?.schema === SCHEMA && Array.isArray(record.entries)) {
          records.set(key, record);
          if (record.entries.length) this.sizes.set(key, key.length + text.length);
        }
      } catch (error) { this.options.report?.(error); }
    }
    this.entries = repair(records);
    this.stamp = Math.max(0, ...[...records.values()].map(record => record.stamp));
    this.seq = Math.max(0, ...this.entries.map(entry => entry.seq));
    for (const entry of this.entries) {
      this.frozenIds.add(entry.id);
      for (const write of entry.writes) this.local(write).value = write.value;
    }
    // Rewrite every key whose stored form the repair changed, and drop keys left empty.
    const keys = new Set([...records.keys(), ...this.entries.flatMap(entry => entry.writes.map(write => documentKey(write)))]);
    for (const key of keys) {
      const stored = records.get(key);
      const now = this.entriesFor(key).map(entry => entry.id);
      if (!stored || stored.dropped?.length || stored.entries.length !== now.length || stored.entries.some((entry, i) => entry.id !== now[i])) this.persistKey(key);
    }
    for (const entry of this.entries) if (entry.state === "conflict") this.emit({ kind: "conflict", entry });
    this.pump();
  }

  /** A change from elsewhere: the version moves past both what it was and the revision taken. */
  private moved(held: Held, revision: number) { held.version = Math.max(held.version + 1, revision); }
  private local(ref: DocumentRef): Held {
    const key = documentKey(ref);
    let held = this.held.get(key);
    if (!held) this.held.set(key, held = { ref: { kind: ref.kind, id: ref.id }, revision: 0, value: undefined, known: false, version: 0 });
    return held;
  }
  private entriesFor(key: string): OutboxEntry[] { return this.entries.filter(entry => entry.writes.some(write => documentKey(write) === key)); }

  /** Writes one document's key (its entries, oldest first); false when it couldn't be stored. */
  private persistKey(key: string, dropped?: readonly string[]): boolean {
    if (this.stopped) return false;
    const entries = this.entriesFor(key), empty = !entries.length && !dropped?.length;
    const record: StoredKey = { schema: SCHEMA, stamp: ++this.stamp, entries, ...(dropped?.length ? { dropped: [...dropped] } : {}) };
    const text = JSON.stringify(record);
    try {
      this.storage.write(key, text, empty);
      if (empty) this.sizes.delete(key); else this.sizes.set(key, key.length + text.length);
      if (!this.storage.watch) this.stored(key);
      if (this.unprotectedKeys.delete(key)) this.emit({ kind: "status" });
      return true;
    } catch (error) {
      this.options.report?.(error);
      if (!this.unprotectedKeys.has(key)) { this.unprotectedKeys.add(key); this.emit({ kind: "status" }); }
      return false;
    }
  }
  /** `key`'s latest text is stored: receipts waiting only for it can be forgotten. */
  private stored(key: string) {
    for (const [id, keys] of this.forgetting) if (keys.delete(key) && !keys.size) { this.forgetting.delete(id); this.forget.push(id); }
  }
  /** Writes `keys` in order: each document's own key, so a commit rewrites only its own documents' entries. */
  private persist(keys: Iterable<string>, dropped?: readonly string[]) { for (const key of new Set(keys)) this.persistKey(key, dropped); }
  /** Retry: writes every unprotected document's key again; true once all are stored. */
  protect(): boolean {
    for (const key of [...this.unprotectedKeys]) this.persistKey(key);
    return this.unprotectedKeys.size === 0;
  }
  /** UTF-16 units the outbox's keys take in storage (counted in the workspace budget). */
  storedSize(): number { let total = 0; for (const size of this.sizes.values()) total += size; return total; }

  // -------------------------------------------------------------------------------------------------------------
  // Reads

  /**
   * An owner's baseline for a document it read from the library (null: it doesn't exist there). A document with entries keeps its local
   * value; a clean one takes a newer revision.
   */
  hold(ref: DocumentRef, stored: CurrentDocument): void {
    const held = this.local(ref), pending = this.entriesFor(documentKey(ref)).length > 0;
    const revision = stored?.revision ?? 0;
    if (!held.known) {
      held.known = true;
      held.revision = Math.max(held.revision, revision);
      held.version = Math.max(held.version, revision);
      if (!pending) held.value = stored?.value;
      return;
    }
    if (!pending && revision > held.revision) { held.revision = revision; held.value = stored?.value; this.moved(held, revision); }
  }
  /** The document as this page sees it (null when it holds nothing of it). */
  document(ref: DocumentRef): OutboxDocument | null {
    const key = documentKey(ref), held = this.held.get(key);
    if (!held) return null;
    const entries = this.entriesFor(key);
    return { revision: held.revision, value: held.value, pending: entries.length > 0, conflict: entries.find(entry => entry.state === "conflict") ?? null,
      version: held.version };
  }
  /** Every conflict, oldest first. */
  conflicts(): readonly OutboxEntry[] { return this.entries.filter(entry => entry.state === "conflict"); }
  /** Every unacknowledged entry (tests and diagnostics). */
  pendingEntries(): readonly OutboxEntry[] { return this.entries; }
  status(): OutboxStatus {
    return { pending: this.entries.filter(entry => entry.state === "queued").length, conflicts: this.conflicts().length,
      unprotected: [...this.unprotectedKeys].map(key => this.held.get(key)?.ref ?? refOfKey(key)), failing: this.failing, stopped: this.stopped };
  }
  subscribe(listener: (event: OutboxEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(event: OutboxEvent) {
    for (const listener of [...this.listeners]) { try { listener(event); } catch (error) { this.options.report?.(error); } }
    this.wake();
  }
  private wake() { for (const resolve of this.waiters.splice(0)) resolve(); }
  private changed() { return new Promise<void>(resolve => { this.waiters.push(resolve); }); }

  // -------------------------------------------------------------------------------------------------------------
  // Commands

  /**
   * One owner command, recorded synchronously and sent in the background: each edit's value becomes the document's local value at once.
   * Throws while this page may not write (it doesn't hold its workspace).
   */
  commit(command: string, edits: readonly OutboxEdit[]): OutboxEntry {
    if (!this.writable() || !this.opened) throw Error("This workspace is open elsewhere, so this change can't be made here.");
    if (!edits.length) throw Error("A command changes at least one document.");
    let entry: OutboxEntry | undefined;
    if (edits.length === 1) {
      const key = documentKey(edits[0]!), last = this.lastFor(key);
      if (last && last.writes.length === 1 && (!this.frozen(last) || last.state === "conflict")) {
        last.writes[0]!.value = edits[0]!.value;
        last.at = this.now();
        if (last.command !== command) last.command = "coalesced";
        entry = last;
      }
    }
    if (!entry) {
      entry = { id: this.newId(), seq: ++this.seq, command, at: this.now(), state: "queued",
        writes: edits.map(edit => ({ kind: edit.kind, id: edit.id, base: this.baseFor(documentKey(edit)), value: edit.value })) };
      this.entries.push(entry);
    }
    for (const edit of edits) { const held = this.local(edit); held.value = edit.value; held.version++; }
    this.persist(edits.map(edit => documentKey(edit)));
    this.emit({ kind: "status" });
    queueMicrotask(() => this.pump());
    return entry;
  }
  /** Sent at least once, or read back from storage (it may have been sent): its ID, bases and values never change again (A1). */
  private readonly frozenIds = new Set<string>();
  private frozen(entry: OutboxEntry) { return this.frozenIds.has(entry.id); }

  private lastFor(key: string): OutboxEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i]!.writes.some(write => documentKey(write) === key)) return this.entries[i];
    return undefined;
  }
  private baseFor(key: string): OutboxBase {
    const last = this.lastFor(key);
    return last ? { after: last.id } : this.held.get(key)?.revision ?? 0;
  }

  private pump(): void {
    if (!this.opened || !this.sendable()) return;
    for (const entry of this.entries) {
      if (entry.state !== "queued" || this.inFlight.has(entry.id)) continue;
      if (entry.writes.some(write => typeof write.base !== "number")) continue;
      void this.send(entry);
    }
  }

  private async send(entry: OutboxEntry): Promise<void> {
    this.frozenIds.add(entry.id); // A1: from here its ID, bases and values are fixed.
    this.inFlight.add(entry.id);
    const forget = this.forget; this.forget = [];
    let answer: TransactAnswer;
    try {
      answer = await this.transport.transact({ id: entry.id, command: entry.command, forget,
        writes: entry.writes.map(write => ({ kind: write.kind, id: write.id, base: write.base as number, value: write.value })) });
    } catch (error) {
      // Lost: maybe committed, maybe not. Sent again with the same ID later (A1); the host's receipt decides (A4).
      this.inFlight.delete(entry.id);
      this.forget.push(...forget);
      this.failures++;
      if (!this.failing) { this.failing = true; this.emit({ kind: "status" }); } else this.wake();
      this.options.report?.(error);
      this.retry ??= (this.options.schedule ?? defaultSchedule)(this.options.retryMs ?? 1000, () => { this.retry = null; this.pump(); });
      return;
    }
    this.inFlight.delete(entry.id);
    const recovered = this.failing;
    if (this.failing) { this.failing = false; this.emit({ kind: "status" }); }
    if (!this.entries.includes(entry)) return;
    if (answer.ok) this.acknowledge(entry, answer.revisions, answer.replayed);
    else if (answer.reason === "stale") this.toConflict(entry, { ...answer.current });
    else { this.forget.push(...forget); this.stop(); }
    // The host answered again after failing (it restarted): check what changed meanwhile.
    if (recovered) void this.check().catch(error => this.options.report?.(error));
    this.pump();
  }

  /** A3. */
  private acknowledge(entry: OutboxEntry, revisions: Readonly<Record<string, number>>, replayed?: "receipt" | "equal"): void {
    this.entries = this.entries.filter(other => other !== entry);
    const keys = entry.writes.map(write => documentKey(write));
    for (const write of entry.writes) {
      const held = this.local(write), revision = revisions[documentKey(write)];
      if (revision !== undefined) { held.revision = revision; held.known = true; }
    }
    for (const other of this.entries) for (const write of other.writes)
      if (typeof write.base === "object" && write.base.after === entry.id) write.base = revisions[documentKey(write)] ?? 0;
    // Its receipt is forgotten once every key it was kept under is stored without it.
    this.forgetting.set(entry.id, new Set(keys));
    this.persist(keys);
    this.emit({ kind: "acknowledged", entry, revisions, ...(replayed ? { replayed } : {}) });
  }

  /** A6. */
  private toConflict(entry: OutboxEntry, current: Record<string, CurrentDocument>): void {
    entry.state = "conflict"; entry.current = current;
    if (entry.writes.length === 1) {
      const key = documentKey(entry.writes[0]!);
      for (const other of [...this.entries]) {
        if (other === entry || other.writes.length !== 1 || documentKey(other.writes[0]!) !== key) continue;
        const base = other.writes[0]!.base;
        if (typeof base === "object" && base.after === entry.id) {
          entry.writes[0]!.value = other.writes[0]!.value;
          this.entries = this.entries.filter(item => item !== other);
          this.repoint(other.id, () => ({ after: entry.id }));
        }
      }
    }
    this.persist(entry.writes.map(write => documentKey(write)));
    this.emit({ kind: "conflict", entry });
  }
  /** Every write based `{ after: from }` takes `to(write)`. */
  private repoint(from: string, to: (write: OutboxWrite) => OutboxBase) {
    for (const other of this.entries) for (const write of other.writes)
      if (typeof write.base === "object" && write.base.after === from) write.base = to(write);
  }
  private conflictEntry(id: string): OutboxEntry {
    const entry = this.entries.find(item => item.id === id && item.state === "conflict");
    if (!entry) throw Error("That conflict was already resolved.");
    if (!this.writable()) throw Error("This workspace is open elsewhere, so this can't be resolved here.");
    return entry;
  }
  private successorKeys(id: string) {
    return this.entries.flatMap(other => other.writes.filter(write => typeof write.base === "object" && write.base.after === id).map(write => documentKey(write)));
  }

  /** Keep mine: an explicit command over the newer revisions, with a fresh ID, in one outbox write. */
  keepMine(conflictId: string): OutboxEntry {
    const old = this.conflictEntry(conflictId);
    const fresh: OutboxEntry = { id: this.newId(), seq: old.seq, command: old.command, at: this.now(), state: "queued", replaces: [old.id],
      writes: old.writes.map(write => ({ kind: write.kind, id: write.id, base: old.current?.[documentKey(write)]?.revision ?? 0, value: write.value })) };
    const keys = [...old.writes.map(write => documentKey(write)), ...this.successorKeys(old.id)];
    this.entries = this.entries.map(entry => entry === old ? fresh : entry);
    this.repoint(old.id, () => ({ after: fresh.id }));
    this.persist(keys);
    this.emit({ kind: "resolved", entry: old, how: "mine", refs: old.writes.map(write => ({ kind: write.kind, id: write.id })), replacement: fresh });
    queueMicrotask(() => this.pump());
    return fresh;
  }
  /** Use theirs: mine is dropped; later commands based on it are rebased onto the stale base, so they go stale in turn (never sent over theirs). */
  useTheirs(conflictId: string): void {
    const old = this.conflictEntry(conflictId);
    this.takeTheirs(old);
    const keys = [...old.writes.map(write => documentKey(write)), ...this.successorKeys(old.id)];
    this.repoint(old.id, write => old.writes.find(item => documentKey(item) === documentKey(write))?.base ?? 0);
    this.entries = this.entries.filter(entry => entry !== old);
    this.persist(keys, [old.id]);
    this.emit({ kind: "resolved", entry: old, how: "theirs", refs: old.writes.map(write => ({ kind: write.kind, id: write.id })) });
    queueMicrotask(() => this.pump());
  }
  /**
   * Keep both: the original documents take theirs, and mine goes to the documents `fork` names (a copy, and any membership it needs),
   * recorded as one command, in one outbox write: a kill keeps one or the other, never neither.
   */
  keepBoth(conflictId: string, fork: (mine: readonly OutboxEdit[]) => readonly OutboxEdit[]): OutboxEntry {
    const old = this.conflictEntry(conflictId);
    const edits = fork(old.writes.map(write => ({ kind: write.kind, id: write.id, value: write.value })));
    if (!edits.length) throw Error("Keep both needs somewhere to keep mine.");
    this.takeTheirs(old);
    this.repoint(old.id, write => old.writes.find(item => documentKey(item) === documentKey(write))?.base ?? 0);
    const successors = this.successorKeys(old.id);
    this.entries = this.entries.filter(entry => entry !== old);
    const copy: OutboxEntry = { id: this.newId(), seq: ++this.seq, command: "conflict.keepBoth", at: this.now(), state: "queued", replaces: [old.id],
      writes: edits.map(edit => ({ kind: edit.kind, id: edit.id, base: this.baseFor(documentKey(edit)), value: edit.value })) };
    this.entries.push(copy);
    for (const edit of edits) { const held = this.local(edit); held.value = edit.value; held.version++; }
    // The copy's keys first: a kill after them leaves the copy stored and the conflict dropped on open (it is replaced).
    this.persist([...edits.map(edit => documentKey(edit)), ...old.writes.map(write => documentKey(write)), ...successors], [old.id]);
    this.emit({ kind: "resolved", entry: old, how: "both",
      refs: [...old.writes, ...edits].map(write => ({ kind: write.kind, id: write.id })), replacement: copy });
    queueMicrotask(() => this.pump());
    return copy;
  }
  private takeTheirs(old: OutboxEntry) {
    for (const write of old.writes) {
      const now = old.current?.[documentKey(write)], held = this.local(write);
      held.revision = now?.revision ?? 0; held.value = now?.value; held.known = true;
      this.moved(held, held.revision);
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Revision checks, settling, stopping

  /**
   * A7: the clean documents this page holds are checked against the library in one read; a newer revision is read and applied, and
   * answered (and announced as `external`). Documents with an entry are left to their commands.
   */
  async check(signal?: AbortSignal): Promise<readonly DocumentRef[]> {
    if (!this.opened || !this.sendable()) return [];
    const clean = [...this.held.values()].filter(held => held.known && !this.entriesFor(documentKey(held.ref)).length);
    if (!clean.length) return [];
    const revisions = await this.transport.revisions(clean.map(held => held.ref), signal);
    const newer = clean.filter(held => (revisions[documentKey(held.ref)] ?? 0) > held.revision);
    if (!newer.length) return [];
    const stored = await this.transport.read(newer.map(held => held.ref), signal);
    const applied: DocumentRef[] = [];
    for (const held of newer) {
      const now = stored[documentKey(held.ref)];
      if (!now || this.entriesFor(documentKey(held.ref)).length || now.revision <= held.revision) continue;
      held.revision = now.revision; held.value = now.value;
      this.moved(held, now.revision);
      applied.push(held.ref);
    }
    if (applied.length) this.emit({ kind: "external", refs: applied });
    return applied;
  }

  /**
   * Resolves true once no queued entry is left (of `refs`, or of any document) and nothing is in flight; false when a send fails while
   * waiting (the entries stay, and are sent again) or the outbox stops. Conflicts don't count: they are stored and shown again.
   */
  async settle(refs?: readonly DocumentRef[]): Promise<boolean> {
    const keys = refs ? new Set(refs.map(documentKey)) : null;
    const touches = (entry: OutboxEntry) => !keys || entry.writes.some(write => keys.has(documentKey(write)));
    const failures = this.failures;
    this.pump();
    for (;;) {
      if (!this.entries.some(entry => touches(entry) && (entry.state === "queued" || this.inFlight.has(entry.id)))) return true;
      if (this.stopped || this.failures !== failures || !this.sendable()) return false;
      await this.changed();
    }
  }
  /** Resolves once the outbox is empty of queued entries, or `signal` aborts; then says what is pending, in conflict or failed (§2.3). */
  async flush(signal?: AbortSignal): Promise<OutboxStatus> {
    const aborted = signal ? new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })) : null;
    this.pump();
    while (!signal?.aborted && !this.stopped && this.entries.some(entry => entry.state === "queued" || this.inFlight.has(entry.id)))
      await Promise.race([this.changed(), ...(aborted ? [aborted] : [])]);
    return this.status();
  }
  /** Stops for good: nothing is written or sent again (the page released or lost its workspace). Stored entries stay for the next holder. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.retry?.cancel(); this.retry = null;
    this.emit({ kind: "status" });
  }
}

const defaultSchedule = (ms: number, run: () => void) => { const timer = setTimeout(run, ms); return { cancel: () => clearTimeout(timer) }; };
const refOfKey = (key: string): DocumentRef => { const at = key.indexOf("/"); return { kind: key.slice(0, at), id: key.slice(at + 1) }; };

/**
 * The entries a set of stored keys holds, oldest first, with what a crash between two keys' writes left half-done put right:
 * an entry kept under several keys counts once (a conflict copy over a queued one); an entry a resolution dropped or replaced is gone;
 * its successors follow the resolution (onto the replacement when it writes their document, else onto the dropped entry's stale base);
 * and a successor of an entry no key holds any more goes stale against the library rather than writing over it.
 */
export function repair(records: ReadonlyMap<string, StoredKey>): OutboxEntry[] {
  const byId = new Map<string, OutboxEntry>(), dropped = new Set<string>();
  for (const record of records.values()) {
    for (const id of record.dropped ?? []) dropped.add(id);
    for (const entry of record.entries) {
      if (!entry || typeof entry.id !== "string" || !Array.isArray(entry.writes)) continue;
      const known = byId.get(entry.id);
      if (!known || (known.state !== "conflict" && entry.state === "conflict")) byId.set(entry.id, structuredClone(entry));
    }
  }
  const replacedBy = new Map<string, OutboxEntry>();
  for (const entry of byId.values()) for (const id of entry.replaces ?? []) replacedBy.set(id, entry);
  const gone = new Map<string, OutboxEntry>();
  for (const [id, entry] of byId) if (dropped.has(id) || replacedBy.has(id)) { gone.set(id, entry); byId.delete(id); }
  const entries = [...byId.values()].sort((a, b) => a.seq - b.seq);
  // Successors of an entry a resolution removed: onto its replacement where that writes the same document, else onto its stale base.
  const resolveBase = (write: OutboxWrite): OutboxBase => {
    for (let depth = 0; depth < 64; depth++) {
      const base = write.base;
      if (typeof base !== "object") return base;
      if (byId.has(base.after)) return base;
      const removed = gone.get(base.after);
      if (!removed) return 0;
      const replacement = replacedBy.get(base.after);
      if (replacement && byId.has(replacement.id) && replacement.writes.some(item => documentKey(item) === documentKey(write))) return { after: replacement.id };
      write = { ...write, base: removed.writes.find(item => documentKey(item) === documentKey(write))?.base ?? 0 };
    }
    return 0;
  };
  for (const entry of entries) for (const write of entry.writes) write.base = resolveBase(write);
  return entries;
}

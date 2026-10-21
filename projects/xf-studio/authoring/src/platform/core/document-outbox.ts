/**
 * The outbox (profiles design §2.2): the one way any document's local state reaches the library. Every owner command is recorded here
 * synchronously, before anything is sent, so every unacknowledged mutation survives a renderer crash. The rules are the ones spike S1
 * proved (A1–A7, `experiments/038-profiles-spikes/README.md`), with three structural rules added in phase 1c:
 *
 * - **Visible state is a pure function.** A document's value as owners see it (`document`) is always its acknowledged baseline (the
 *   library's value as this page last learned it) with its remaining entries applied in order; it is computed, never kept. So no
 *   acknowledgement, conflict, resolution, fold or repair can leave it out of step with the entries.
 * - **Immutable, content-addressed documents** (`put`, the kinds `options.immutable` names: decoded saves, later blobs) are written once,
 *   each by its own create-only command; equal content has an equal ID, so a concurrent import of the same one is acknowledged (the
 *   equal-value rule), never a conflict. A command that references one (`requires`) waits until that document is in the library, and
 *   no conflict resolution ever removes one.
 * - **Waiters move with their values** (`settled`): an edit coalesced into an entry, a successor folded into a conflict and a conflict
 *   Keep mine replaced all carry their callers along, so every caller hears an outcome.
 *
 * And the S1 rules:
 *
 * - **A1, freeze on send.** From its first send an entry's ID, bases and values never change, and every resend reuses its ID. Entries
 *   read back from storage may have been sent, so they are frozen too.
 * - **A2, successors.** A single-document edit coalesces into its document's newest entry only while that entry is unsent, or in conflict
 *   (where it updates "mine"). Behind a frozen entry it opens one successor based `{ after: <frozen ID> }`; later edits coalesce there.
 *   Multi-document commands never coalesce: they queue behind every earlier entry touching any of their documents.
 * - **A3, acknowledgement.** The answer, fresh or from a receipt, removes the entry, makes its revisions and values the documents'
 *   baselines and rebases every `{ after }` successor onto them; every key holding a changed entry is written again. The command's
 *   receipt is forgotten (named in a later command's `forget`) once no stored key holds the entry any more. A replay answered from its
 *   receipt names (`own`) the documents every later revision of which this same workspace wrote (receipts record the workspace and lease
 *   generation): an earlier launch's write a crash left the stored copy older than; they become the baseline its successors build on,
 *   so a crash with host writes pending never brings a conflict against this page's own write. Another workspace's never counts.
 * - **A4, A5** are the host's (`DocumentStore.transact`): receipts, and the equal-value rule.
 * - **A6, stale.** A stale answer makes the entry a conflict holding the documents as they are now, and nothing retries it.
 *   Single-document successors fold into its "mine"; multi-document successors stay blocked. Keep mine, Use theirs and Keep both are
 *   each one outbox write, and stored conflicts are raised again when the outbox opens. Keep both takes theirs before asking its owner
 *   for the copy, so a membership the copy is added to (a profile, a collection) is written over theirs, never over mine's version.
 * - **A7, revision checks** (`check`) skip every document with an entry; a clean document takes a stored revision only above its
 *   baseline, so a receipt replay never shows as an external change.
 *
 * **Storage.** Each document's entries live under its own key (`OutboxStorage`, `xfs.outbox.<workspace>.<kind>/<id>` in the adapters),
 * so a commit rewrites only the keys of the documents it changes. A multi-document entry is kept under every document it writes, and
 * every change of an entry raises its stamp; on open, `repair` takes each entry's newest copy, so a crash between two keys' writes, or any
 * order the keys are read back in, never brings back a stale copy. A write that fails never blocks the edit: the edit applies and is still
 * sent, and `status().unprotected` names the documents whose changes aren't protected on this computer until their next successful write.
 */
import type { CurrentDocument, DocumentRef, TransactAnswer, TransactRequest } from "../api/document-commands";
import { documentKey } from "../api/document-commands";

type TransactAnswerOwn = Extract<TransactAnswer, { ok: true }>["own"];

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
  /**
   * Keep both's copy: it replaces the conflict it resolves but never takes over that conflict's successors, even on a document it also
   * writes (a membership): they go stale over the dropped base, and the copy comes after them.
   */
  fork?: true;
  /** Immutable documents (keys) this command references: it is sent only once each of them is in the library. */
  requires?: string[];
  /** Raised on every change of the entry: the copy with the highest stamp is the current one. */
  stamp?: number;
};
/** One document's change in a command: the value it stores next (a `Tombstone` for a delete). */
export type OutboxEdit = { readonly kind: string; readonly id: string; readonly value: unknown };
/** What became of a recorded change: in the library, dropped (Use theirs, Keep both took another value here), or never sent (stopped). */
export type OutboxOutcome = "acknowledged" | "dropped" | "stopped";

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
   * Where a key is also stored in the background (the desktop host's file): `listener` hears when a key's background write is queued
   * (`pending`: not protected yet), when its latest one landed (`stored`) and when one failed (`failed`, and it is sent again).
   */
  watch?(listener: (key: string, state: "pending" | "stored" | "failed") => void): void;
  /**
   * The slower, durable copy's texts as they were read (the desktop host's), where it differs from what `load` merges: a stale entry it
   * still holds stays marked until that copy's key is written again and the write lands, never judged spent from the merged view.
   */
  durable?(): ReadonlyMap<string, string>;
}
export type OutboxTransport = { transact(request: TransactRequest): Promise<TransactAnswer>;
  revisions(refs: readonly DocumentRef[], signal?: AbortSignal): Promise<Readonly<Record<string, number>>>;
  read(refs: readonly DocumentRef[], signal?: AbortSignal): Promise<Readonly<Record<string, CurrentDocument>>> };

export type OutboxEvent =
  /** A command was recorded (or coalesced into one): these documents' values changed here. */
  | { readonly kind: "recorded"; readonly entry: OutboxEntry; readonly refs: readonly DocumentRef[] }
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
  /** Documents whose latest change isn't protected on this computer yet (their key's write failed, or its background copy hasn't landed). */
  readonly unprotected: readonly DocumentRef[];
  /** Whether to warn: a write failed, or a background copy has been waiting longer than `WARN_AFTER_MS`. */
  readonly unprotectedWarning: boolean;
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
  /** The immutable, content-addressed kinds (written once, by `put`). */
  readonly immutable?: (kind: string) => boolean;
  readonly schedule?: (ms: number, run: () => void) => { cancel(): void };
  readonly report?: (error: unknown) => void;
};

const SCHEMA = "xfs/outbox-1";
/** How long a background copy may wait before the page warns that changes aren't protected (a write that fails warns at once). */
export const WARN_AFTER_MS = 2000;
export type StoredKey = { schema: typeof SCHEMA; stamp: number; entries: OutboxEntry[]; dropped?: string[] };
/** A document's acknowledged baseline: the library's revision and value as this page last learned them. */
type Held = { ref: DocumentRef; revision: number; base: unknown; known: boolean; version: number };
type Waiter = (outcome: OutboxOutcome) => void;

export class DocumentOutbox {
  private readonly held = new Map<string, Held>();
  private entries: OutboxEntry[] = [];
  private readonly inFlight = new Set<string>();
  /** Keys whose latest write isn't stored yet: since when it has waited, and whether a write of it failed. */
  private readonly unprotectedKeys = new Map<string, { since: number; failed: boolean }>();
  /**
   * Entries a resolution or a repair removed, with the keys that may still hold a stale copy of each: every key written carries their
   * IDs as markers until each of those keys is stored without the copy, so a crash at any point (during a recovery too) never brings
   * one back.
   */
  private readonly graves = new Map<string, Set<string>>();
  private readonly listeners = new Set<(event: OutboxEvent) => void>();
  private wakers: (() => void)[] = [];
  /** Callers waiting to hear what became of an entry, by entry ID (they move with its value: `move`). */
  private readonly waits = new Map<string, Waiter[]>();
  private forget: string[] = [];
  /**
   * Acknowledged entries whose receipts can't be forgotten yet: some of their keys may still hold them in storage (a failed write, or a
   * background copy not yet written), and a receipt is what turns a replay of such a copy into this page's own write, never a conflict.
   */
  private readonly forgetting = new Map<string, Set<string>>();
  /** Immutable documents being looked up in the library (a command requires one this page holds no record of). */
  private readonly looking = new Set<string>();
  /** Sent at least once, or read back from storage (it may have been sent): its ID, bases and values never change again (A1). */
  private readonly frozenIds = new Set<string>();
  private seq = 0;
  private stamp = 0;
  private stopped = false;
  private opened = false;
  private failing = false;
  private failures = 0;
  private retry: { cancel(): void } | null = null;
  private sizes = new Map<string, number>();

  constructor(private readonly transport: OutboxTransport, private readonly storage: OutboxStorage, private readonly options: OutboxOptions = {}) {
    storage.watch?.((key, state) => {
      if (this.stopped) return;
      if (state === "stored") { this.stored(key); if (this.unprotectedKeys.delete(key)) this.emit({ kind: "status" }); }
      else this.unprotect(key, state === "failed");
    });
  }

  private newId() { return (this.options.newId ?? (() => `o-${crypto.randomUUID()}`))(); }
  private now() { return (this.options.now ?? Date.now)(); }
  private writable() { return !this.stopped && (this.options.writable?.() ?? true); }
  private sendable() { return !this.stopped && (this.options.sendable ?? this.options.writable)?.() !== false; }
  private immutable(kind: string) { return this.options.immutable?.(kind) ?? false; }

  // -------------------------------------------------------------------------------------------------------------
  // Opening and storage

  /**
   * Reads the stored entries, repairs keys a crash left part-written, raises stored conflicts again and replays every queued entry under
   * its own ID. Call once, when this page holds its workspace.
   */
  open(): void {
    if (this.opened) return;
    this.opened = true;
    const parse = (texts: ReadonlyMap<string, string>, sizes?: Map<string, number>) => {
      const parsed = new Map<string, StoredKey>();
      for (const [key, text] of texts) {
        try {
          const record = JSON.parse(text) as StoredKey;
          if (record?.schema === SCHEMA && Array.isArray(record.entries)) {
            parsed.set(key, record);
            if (record.entries.length && sizes) sizes.set(key, key.length + text.length);
          }
        } catch (error) { this.options.report?.(error); }
      }
      return parsed;
    };
    const records = parse(this.storage.load(), this.sizes), durable = parse(this.storage.durable?.() ?? new Map());
    const repaired = repair(records, [...durable.values()].flatMap(record => record.dropped ?? []));
    this.entries = repaired.entries;
    for (const [id, keys] of repaired.graves) this.graves.set(id, keys);
    // A stale copy the durable copy still holds (hidden from the merged view by a newer one) keeps its marker until that key is written
    // again and the write lands.
    const durableHolders = new Set<string>();
    for (const [key, record] of durable) for (const entry of record.entries)
      if (repaired.markers.has(entry?.id) && !this.entries.some(live => live.id === entry.id)) {
        const holders = this.graves.get(entry.id) ?? new Set<string>();
        holders.add(key); this.graves.set(entry.id, holders); durableHolders.add(key);
      }
    this.stamp = Math.max(0, ...[...records.values()].map(record => record.stamp), ...this.entries.map(entry => entry.stamp ?? 0));
    // An entry the repair changed, or whose copies disagree, is written again everywhere with a newer stamp, so no stale copy outlives it.
    const changed = this.entries.filter(entry => repaired.changed.has(entry.id));
    for (const entry of changed) this.touch(entry);
    this.seq = Math.max(0, ...this.entries.map(entry => entry.seq));
    for (const entry of this.entries) {
      this.frozenIds.add(entry.id);
      for (const write of entry.writes) this.local(write);
    }
    // Rewrite every key whose stored form the repair changed, and drop keys left empty.
    const keys = new Set([...records.keys(), ...this.entries.flatMap(entry => entry.writes.map(write => documentKey(write)))]);
    // Every write carries the pending markers, so any order is safe; once no stale copy is left, keys holding only spent markers are
    // written again without them (a crash between leaves markers with nothing to mark: harmless).
    const rewrite = new Set([...this.keysOf(...changed), ...durableHolders]);
    for (const key of keys) {
      const stored = records.get(key);
      const now = this.entriesFor(key);
      if (rewrite.has(key) || !stored || stored.entries.length !== now.length ||
        stored.entries.some((entry, i) => entry.id !== now[i]!.id || (entry.stamp ?? 0) !== (now[i]!.stamp ?? 0))) this.persistKey(key);
    }
    for (const key of keys) {
      const stored = records.get(key);
      if (stored?.dropped?.some(id => !this.graves.has(id)) && !this.unprotectedKeys.has(key)) this.persistKey(key);
    }
    for (const entry of this.entries) if (entry.state === "conflict") this.emit({ kind: "conflict", entry });
    this.pump();
  }

  /** A change from elsewhere: the version moves past both what it was and the revision taken. */
  private moved(held: Held, revision: number) { held.version = Math.max(held.version + 1, revision); }
  private local(ref: DocumentRef): Held {
    const key = documentKey(ref);
    let held = this.held.get(key);
    if (!held) this.held.set(key, held = { ref: { kind: ref.kind, id: ref.id }, revision: 0, base: undefined, known: false, version: 0 });
    return held;
  }
  private entriesFor(key: string): OutboxEntry[] { return this.entries.filter(entry => entry.writes.some(write => documentKey(write) === key)); }
  /** Every key `entries` are kept under. */
  private keysOf(...entries: readonly OutboxEntry[]): string[] { return entries.flatMap(entry => entry.writes.map(write => documentKey(write))); }
  /** The entry changed: its stamp rises, so its copies written now win over older ones on open. */
  private touch(entry: OutboxEntry) { entry.stamp = ++this.stamp; }

  /** Writes one document's key (its entries, oldest first, and every pending marker); false when it couldn't be stored. */
  private persistKey(key: string): boolean {
    if (this.stopped) return false;
    const dropped = [...this.graves.keys()];
    const entries = this.entriesFor(key), empty = !entries.length && !dropped.length;
    const record: StoredKey = { schema: SCHEMA, stamp: ++this.stamp, entries, ...(dropped.length ? { dropped } : {}) };
    const text = JSON.stringify(record);
    try {
      this.storage.write(key, text, empty);
      if (empty) this.sizes.delete(key); else this.sizes.set(key, key.length + text.length);
      // A store with a background copy says when that lands (`watch`): only then is the key stored and protected.
      if (!this.storage.watch) { this.stored(key); if (this.unprotectedKeys.delete(key)) this.emit({ kind: "status" }); }
      return true;
    } catch (error) {
      this.options.report?.(error);
      this.unprotect(key, true);
      return false;
    }
  }
  /** `key`'s latest text is stored: receipts and markers waiting only for it can go. */
  private stored(key: string) {
    for (const [id, keys] of this.forgetting) if (keys.delete(key) && !keys.size) { this.forgetting.delete(id); this.forget.push(id); }
    for (const [id, keys] of this.graves) if (keys.delete(key) && !keys.size) this.graves.delete(id);
  }
  /** `key` isn't protected (yet): a failure warns at once, a background copy still waiting after `WARN_AFTER_MS` too. */
  private unprotect(key: string, failed: boolean) {
    const known = this.unprotectedKeys.get(key);
    if (known && (known.failed || !failed)) return;
    this.unprotectedKeys.set(key, { since: known?.since ?? this.now(), failed });
    this.emit({ kind: "status" });
    if (!failed) (this.options.schedule ?? defaultSchedule)(WARN_AFTER_MS, () => { if (this.unprotectedKeys.has(key) && !this.stopped) this.emit({ kind: "status" }); });
  }
  /** Removed entries' markers: kept in every key written until every key that held a copy is stored without it. */
  private bury(entry: OutboxEntry) { this.graves.set(entry.id, new Set(this.keysOf(entry))); }
  /** Writes `keys`, each once: each document's own key. */
  private persist(keys: Iterable<string>) { for (const key of new Set(keys)) this.persistKey(key); }
  /**
   * Try again: writes every unprotected document's key again; false when one still couldn't be written. A key with a background copy is
   * protected again once that copy lands (`status` follows).
   */
  protect(): boolean {
    let ok = true;
    for (const key of [...this.unprotectedKeys.keys()]) ok = this.persistKey(key) && ok;
    return ok;
  }
  /** UTF-16 units the outbox's keys take in storage (counted in the workspace budget). */
  storedSize(): number { let total = 0; for (const size of this.sizes.values()) total += size; return total; }

  // -------------------------------------------------------------------------------------------------------------
  // Reads

  /**
   * An owner's baseline for a document it read from the library (null: it doesn't exist there). The first one is taken whatever entries
   * the document has; later, a clean document takes a newer revision.
   */
  hold(ref: DocumentRef, stored: CurrentDocument): void {
    const held = this.local(ref), pending = this.entriesFor(documentKey(ref)).length > 0;
    const revision = stored?.revision ?? 0;
    if (!held.known) {
      held.known = true;
      if (revision >= held.revision) { held.revision = revision; held.base = stored?.value; }
      held.version = Math.max(held.version, revision);
      queueMicrotask(() => this.pump());
      return;
    }
    if (!pending && revision > held.revision) { held.revision = revision; held.base = stored?.value; this.moved(held, revision); }
  }
  /** A document's visible value: its baseline with its remaining entries applied in order (the newest entry writing it wins). */
  private visible(key: string): unknown {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const write = this.entries[i]!.writes.find(item => documentKey(item) === key);
      if (write) return write.value;
    }
    return this.held.get(key)?.base;
  }
  /** The document as this page sees it (null when it holds nothing of it). */
  document(ref: DocumentRef): OutboxDocument | null {
    const key = documentKey(ref), held = this.held.get(key);
    if (!held) return null;
    const entries = this.entriesFor(key);
    return { revision: held.revision, value: this.visible(key), pending: entries.length > 0, conflict: entries.find(entry => entry.state === "conflict") ?? null,
      version: held.version };
  }
  /** Every conflict, oldest first. */
  conflicts(): readonly OutboxEntry[] { return this.entries.filter(entry => entry.state === "conflict"); }
  /** Every unacknowledged entry (tests and diagnostics). */
  pendingEntries(): readonly OutboxEntry[] { return this.entries; }
  status(): OutboxStatus {
    return { pending: this.entries.filter(entry => entry.state === "queued").length, conflicts: this.conflicts().length,
      unprotected: [...this.unprotectedKeys.keys()].map(key => this.held.get(key)?.ref ?? refOfKey(key)),
      unprotectedWarning: [...this.unprotectedKeys.values()].some(item => item.failed || this.now() - item.since >= WARN_AFTER_MS),
      failing: this.failing, stopped: this.stopped };
  }
  subscribe(listener: (event: OutboxEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(event: OutboxEvent) {
    for (const listener of [...this.listeners]) { try { listener(event); } catch (error) { this.options.report?.(error); } }
    this.wake();
  }
  private wake() { for (const resolve of this.wakers.splice(0)) resolve(); }
  private changed() { return new Promise<void>(resolve => { this.wakers.push(resolve); }); }

  /**
   * What becomes of a recorded entry's change: `acknowledged` once the library holds it (or a value that covers it), `dropped` when a
   * resolution took another value here, `stopped` when this page stops before either. A coalesced, folded or replaced entry's callers move
   * to the entry that now carries their value, so every caller hears.
   */
  settled(entryId: string): Promise<OutboxOutcome> {
    if (this.stopped) return Promise.resolve("stopped");
    if (!this.entries.some(entry => entry.id === entryId)) return Promise.resolve("acknowledged");
    return new Promise(resolve => { const list = this.waits.get(entryId) ?? []; list.push(resolve); this.waits.set(entryId, list); });
  }
  private finish(entryId: string, outcome: OutboxOutcome) { const list = this.waits.get(entryId); this.waits.delete(entryId); for (const waiter of list ?? []) waiter(outcome); }
  private move(from: string, to: string) {
    const list = this.waits.get(from);
    if (!list) return;
    this.waits.delete(from);
    this.waits.set(to, [...this.waits.get(to) ?? [], ...list]);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Commands

  /**
   * One owner command, recorded synchronously and sent in the background: each edit's value becomes the document's visible value at once.
   * `requires`: immutable documents the command references; it is sent once each is in the library. Throws while this page may not write
   * (it doesn't hold its workspace).
   */
  commit(command: string, edits: readonly OutboxEdit[], options: { requires?: readonly DocumentRef[] } = {}): OutboxEntry {
    if (!this.writable() || !this.opened) throw Error("This workspace is open elsewhere, so this change can't be made here.");
    if (!edits.length) throw Error("A command changes at least one document.");
    if (edits.some(edit => this.immutable(edit.kind))) throw Error("An immutable document is written by `put`.");
    const requires = [...new Set((options.requires ?? []).map(documentKey))];
    let entry: OutboxEntry | undefined;
    if (edits.length === 1) {
      const key = documentKey(edits[0]!), last = this.lastFor(key);
      if (last && last.writes.length === 1 && (!this.frozen(last) || last.state === "conflict")) {
        last.writes[0]!.value = edits[0]!.value;
        last.at = this.now();
        if (last.command !== command) last.command = "coalesced";
        if (requires.length) last.requires = [...new Set([...last.requires ?? [], ...requires])];
        entry = last;
      }
    }
    if (!entry) {
      entry = { id: this.newId(), seq: ++this.seq, command, at: this.now(), state: "queued",
        writes: edits.map(edit => ({ kind: edit.kind, id: edit.id, base: this.baseFor(documentKey(edit)), value: edit.value })),
        ...(requires.length ? { requires } : {}) };
      this.entries.push(entry);
    }
    this.touch(entry);
    for (const edit of edits) this.local(edit).version++;
    this.persist(edits.map(edit => documentKey(edit)));
    this.emit({ kind: "recorded", entry, refs: edits.map(edit => ({ kind: edit.kind, id: edit.id })) });
    queueMicrotask(() => this.pump());
    return entry;
  }
  /**
   * An immutable, content-addressed document, written once by its own create-only command (null: this page already holds it, or is
   * writing it). Equal content has an equal ID, so another page's write of it is acknowledged, never a conflict.
   */
  put(ref: DocumentRef, value: unknown): OutboxEntry | null {
    if (!this.writable() || !this.opened) throw Error("This workspace is open elsewhere, so this change can't be made here.");
    if (!this.immutable(ref.kind)) throw Error("Only an immutable document is put.");
    const key = documentKey(ref);
    if (this.visible(key) !== undefined || this.entriesFor(key).length) return null;
    const entry: OutboxEntry = { id: this.newId(), seq: ++this.seq, command: "immutable.put", at: this.now(), state: "queued",
      writes: [{ kind: ref.kind, id: ref.id, base: 0, value }] };
    this.entries.push(entry);
    this.touch(entry);
    this.local(ref).version++;
    this.persist([key]);
    this.emit({ kind: "recorded", entry, refs: [ref] });
    queueMicrotask(() => this.pump());
    return entry;
  }
  private frozen(entry: OutboxEntry) { return this.frozenIds.has(entry.id); }

  private lastFor(key: string): OutboxEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i]!.writes.some(write => documentKey(write) === key)) return this.entries[i];
    return undefined;
  }
  private baseFor(key: string): OutboxBase {
    const last = this.lastFor(key);
    return last ? { after: last.id } : this.held.get(key)?.revision ?? 0;
  }

  /** Whether every immutable document `entry` requires is in the library (one this page knows nothing of is looked up). */
  private ready(entry: OutboxEntry): boolean {
    let ready = true;
    for (const key of entry.requires ?? []) {
      if (this.entriesFor(key).length) { ready = false; continue; }
      const held = this.held.get(key);
      if (held?.known && held.revision > 0) continue;
      ready = false;
      if (!this.looking.has(key)) {
        this.looking.add(key);
        const ref = refOfKey(key);
        void this.transport.revisions([ref]).then(revisions => {
          this.looking.delete(key);
          const revision = revisions[key] ?? 0;
          if (revision > 0) { const local = this.local(ref); local.known = true; local.revision = Math.max(local.revision, revision); this.pump(); }
          else this.options.report?.(Error(`A command requires ${key}, which isn't in the library or the outbox.`));
        }, error => { this.looking.delete(key); this.options.report?.(error); this.later(); });
      }
    }
    return ready;
  }

  private pump(): void {
    if (!this.opened || !this.sendable()) return;
    for (const entry of this.entries) {
      if (entry.state !== "queued" || this.inFlight.has(entry.id)) continue;
      if (entry.writes.some(write => typeof write.base !== "number")) continue;
      if (!this.ready(entry)) continue;
      void this.send(entry);
    }
  }
  private later() { this.retry ??= (this.options.schedule ?? defaultSchedule)(this.options.retryMs ?? 1000, () => { this.retry = null; this.pump(); }); }

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
      this.later();
      return;
    }
    this.inFlight.delete(entry.id);
    const recovered = this.failing;
    if (this.failing) { this.failing = false; this.emit({ kind: "status" }); }
    if (!this.entries.includes(entry) || this.stopped) { this.forget.push(...forget); return; }
    if (answer.ok) this.acknowledge(entry, answer.revisions, answer.replayed, undefined, answer.own);
    else if (answer.reason === "stale" && entry.writes.every(write => this.immutable(write.kind))) {
      // An immutable document already there is the same content (its ID is its content): this write is acknowledged as it stands.
      const revisions = Object.fromEntries(entry.writes.map(write => [documentKey(write), answer.current[documentKey(write)]?.revision ?? 0]));
      this.acknowledge(entry, revisions, "equal", answer.current);
    } else if (answer.reason === "stale") this.toConflict(entry, { ...answer.current });
    else { this.forget.push(...forget); this.stop(); }
    // The host answered again after failing (it restarted): check what changed meanwhile.
    if (recovered) void this.check().catch(error => this.options.report?.(error));
    this.pump();
  }

  /**
   * A3. `own`: a receipt replay's documents whose every later revision this workspace wrote too (an earlier launch's commands whose
   * stored copies a crash left older than they were): this page takes them as its baseline and its successors build on them, so its own
   * later write is never a conflict.
   */
  private acknowledge(entry: OutboxEntry, revisions: Readonly<Record<string, number>>, replayed?: "receipt" | "equal",
    current?: Readonly<Record<string, CurrentDocument>>, own?: TransactAnswerOwn): void {
    const at = this.entries.indexOf(entry);
    this.entries = this.entries.filter(other => other !== entry);
    // An earlier entry still held on one of its documents is a stored copy of a command already in the library (a crash left it, and it
    // is being replayed for its receipt): this answer supersedes its write of that document, which must neither show as the value nor
    // be what the next edit follows. An earlier entry left with no write is done.
    const superseded = new Set<OutboxEntry>(), done: OutboxEntry[] = [], taken: DocumentRef[] = [];
    for (const earlier of this.entries.slice(0, Math.max(0, at))) {
      if (earlier.state !== "queued") continue;
      const kept = earlier.writes.filter(write => !entry.writes.some(item => documentKey(item) === documentKey(write)));
      if (kept.length === earlier.writes.length) continue;
      if (kept.length) { earlier.writes = kept; superseded.add(earlier); } else done.push(earlier);
    }
    this.entries = this.entries.filter(other => !done.includes(other));
    for (const other of superseded) this.touch(other);
    for (const write of entry.writes) {
      const key = documentKey(write), held = this.local(write), revision = revisions[key];
      if (revision === undefined) continue;
      held.known = true;
      if (revision >= held.revision) { held.revision = revision; held.base = current?.[key] ? current[key]!.value : write.value; }
      const later = own?.[key];
      if (later && later.revision > held.revision) { held.revision = later.revision; held.base = later.value; this.moved(held, later.revision); taken.push(held.ref); }
    }
    const rebased = new Set<OutboxEntry>();
    for (const other of this.entries) for (const write of other.writes)
      if (typeof write.base === "object" && write.base.after === entry.id) {
        const key = documentKey(write);
        write.base = Math.max(own?.[key]?.revision ?? 0, revisions[key] ?? 0); rebased.add(other);
      }
    for (const other of rebased) this.touch(other);
    // Its receipt is forgotten once every key it was kept under is stored without it.
    const keys = this.keysOf(entry);
    this.forgetting.set(entry.id, new Set(keys));
    for (const other of done) this.bury(other);
    // The superseded copies first: a kill after them leaves the acknowledged entry stored, to be replayed by its receipt, beside the
    // superseded copy as it now is (its newer stamp wins on open); a kill after the acknowledgement's own keys can then never bring back
    // a superseded copy's write as the document's value.
    this.persist([...this.keysOf(...superseded), ...keys, ...this.keysOf(...rebased), ...this.keysOf(...done)]);
    for (const other of done) this.finish(other.id, "acknowledged");
    this.finish(entry.id, "acknowledged");
    this.emit({ kind: "acknowledged", entry, revisions, ...(replayed ? { replayed } : {}) });
    // A later revision of its own this page hadn't read yet is a change to what owners show.
    if (taken.length) this.emit({ kind: "external", refs: taken });
  }

  /** A6. */
  private toConflict(entry: OutboxEntry, current: Record<string, CurrentDocument>): void {
    entry.state = "conflict"; entry.current = current;
    this.touch(entry);
    const changed = new Set<OutboxEntry>([entry]);
    if (entry.writes.length === 1) {
      const key = documentKey(entry.writes[0]!);
      for (const other of [...this.entries]) {
        if (other === entry || other.writes.length !== 1 || documentKey(other.writes[0]!) !== key) continue;
        const base = other.writes[0]!.base;
        if (typeof base === "object" && base.after === entry.id) {
          // Folded into mine: its value, its requirements and its callers move to the conflict.
          entry.writes[0]!.value = other.writes[0]!.value;
          if (other.requires?.length) entry.requires = [...new Set([...entry.requires ?? [], ...other.requires])];
          this.entries = this.entries.filter(item => item !== other);
          this.move(other.id, entry.id);
          for (const later of this.repoint(other.id, () => ({ after: entry.id }))) changed.add(later);
        }
      }
    }
    for (const other of changed) this.touch(other);
    this.persist(this.keysOf(...changed));
    this.emit({ kind: "conflict", entry });
  }
  /** Every write based `{ after: from }` takes `to(write)`; answers the entries changed. */
  private repoint(from: string, to: (write: OutboxWrite) => OutboxBase): OutboxEntry[] {
    const changed: OutboxEntry[] = [];
    for (const other of this.entries) for (const write of other.writes)
      if (typeof write.base === "object" && write.base.after === from) { write.base = to(write); if (!changed.includes(other)) changed.push(other); }
    return changed;
  }
  private conflictEntry(id: string): OutboxEntry {
    const entry = this.entries.find(item => item.id === id && item.state === "conflict");
    if (!entry) throw Error("That conflict was already resolved.");
    if (!this.writable()) throw Error("This workspace is open elsewhere, so this can't be resolved here.");
    return entry;
  }

  /** Keep mine: an explicit command over the newer revisions, with a fresh ID, in one outbox write. */
  keepMine(conflictId: string): OutboxEntry {
    const old = this.conflictEntry(conflictId);
    const fresh: OutboxEntry = { id: this.newId(), seq: old.seq, command: old.command, at: this.now(), state: "queued", replaces: [old.id],
      writes: old.writes.map(write => ({ kind: write.kind, id: write.id, base: old.current?.[documentKey(write)]?.revision ?? 0, value: write.value })),
      ...(old.requires?.length ? { requires: [...old.requires] } : {}) };
    this.touch(fresh);
    this.entries = this.entries.map(entry => entry === old ? fresh : entry);
    this.bury(old);
    const successors = this.repoint(old.id, () => ({ after: fresh.id }));
    for (const other of successors) this.touch(other);
    this.move(old.id, fresh.id);
    this.persist([...this.keysOf(old), ...this.keysOf(...successors)]);
    this.emit({ kind: "resolved", entry: old, how: "mine", refs: old.writes.map(write => ({ kind: write.kind, id: write.id })), replacement: fresh });
    queueMicrotask(() => this.pump());
    return fresh;
  }
  /** Use theirs: mine is dropped; later commands based on it are rebased onto the stale base, so they go stale in turn (never sent over theirs). */
  useTheirs(conflictId: string): void {
    const old = this.conflictEntry(conflictId);
    this.takeTheirs(old);
    const successors = this.repoint(old.id, write => old.writes.find(item => documentKey(item) === documentKey(write))?.base ?? 0);
    for (const other of successors) this.touch(other);
    this.entries = this.entries.filter(entry => entry !== old);
    this.bury(old);
    this.persist([...this.keysOf(old), ...this.keysOf(...successors)]);
    this.finish(old.id, "dropped");
    this.emit({ kind: "resolved", entry: old, how: "theirs", refs: old.writes.map(write => ({ kind: write.kind, id: write.id })) });
    queueMicrotask(() => this.pump());
  }
  /**
   * Keep both: the original documents take theirs, and mine goes to the documents `fork` names (a copy, and any membership it needs),
   * recorded as one command that requires what mine required, in one outbox write: a kill keeps one or the other, never neither.
   */
  keepBoth(conflictId: string, fork: (mine: readonly OutboxEdit[]) => readonly OutboxEdit[]): OutboxEntry {
    const old = this.conflictEntry(conflictId);
    const mine = old.writes.map(write => ({ kind: write.kind, id: write.id, value: write.value }));
    // Theirs first, so `fork` reads every document it also updates (a membership: a profile, a collection) as it is now, theirs with any
    // surviving successors on top, never as mine had it: mine's other changes there are not carried over theirs.
    const before = { entries: this.entries, held: old.writes.map(write => { const held = this.local(write); return [held, { ...held }] as const; }) };
    this.takeTheirs(old);
    this.entries = this.entries.filter(entry => entry !== old);
    let edits: readonly OutboxEdit[];
    try {
      edits = fork(mine);
      if (!edits.length) throw Error("Keep both needs somewhere to keep mine.");
    } catch (error) {
      this.entries = before.entries;
      for (const [held, copy] of before.held) Object.assign(held, copy);
      throw error;
    }
    const successors = this.repoint(old.id, write => old.writes.find(item => documentKey(item) === documentKey(write))?.base ?? 0);
    for (const other of successors) this.touch(other);
    this.bury(old);
    const copy: OutboxEntry = { id: this.newId(), seq: ++this.seq, command: "conflict.keepBoth", at: this.now(), state: "queued", replaces: [old.id], fork: true,
      writes: edits.map(edit => ({ kind: edit.kind, id: edit.id, base: this.baseFor(documentKey(edit)), value: edit.value })),
      ...(old.requires?.length ? { requires: [...old.requires] } : {}) };
    this.touch(copy);
    this.entries.push(copy);
    for (const edit of edits) this.local(edit).version++;
    // The copy's keys first: a kill after them leaves the copy stored and the conflict dropped on open (it is replaced).
    this.persist([...this.keysOf(copy), ...this.keysOf(old), ...this.keysOf(...successors)]);
    this.finish(old.id, "dropped");
    this.emit({ kind: "resolved", entry: old, how: "both", refs: [...old.writes, ...edits].map(write => ({ kind: write.kind, id: write.id })), replacement: copy });
    queueMicrotask(() => this.pump());
    return copy;
  }
  /** The conflict's documents take theirs as their baselines (their visible values follow, with any surviving successors on top). */
  private takeTheirs(old: OutboxEntry) {
    for (const write of old.writes) {
      const now = old.current?.[documentKey(write)], held = this.local(write);
      held.revision = now?.revision ?? 0; held.base = now?.value; held.known = true;
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
      held.revision = now.revision; held.base = now.value;
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
    for (const id of [...this.waits.keys()]) this.finish(id, "stopped");
    this.emit({ kind: "status" });
  }
}

const defaultSchedule = (ms: number, run: () => void) => { const timer = setTimeout(run, ms); return { cancel: () => clearTimeout(timer) }; };
const refOfKey = (key: string): DocumentRef => { const at = key.indexOf("/"); return { kind: key.slice(0, at), id: key.slice(at + 1) }; };

/**
 * The entries a set of stored keys holds, oldest first, with what a crash between two keys' writes left half-done put right:
 * - an entry kept under several keys counts once, as its copy with the highest stamp (a conflict copy over a queued one when stamps tie);
 * - an entry a resolution dropped or replaced is gone, and its successors follow the resolution (onto Keep mine's replacement when it
 *   writes their document, else onto the dropped entry's stale base; Keep both's copy never takes them over, even where it also writes
 *   their document, a membership: it comes after them);
 * - a successor of an entry no key holds any more goes stale against the library rather than writing over it.
 */
export function repair(records: ReadonlyMap<string, StoredKey>, alsoDropped: readonly string[] = []):
  { entries: OutboxEntry[]; changed: Set<string>; graves: Map<string, Set<string>>; markers: Set<string> } {
  const byId = new Map<string, OutboxEntry>(), dropped = new Set<string>(alsoDropped), copies = new Map<string, string[]>(), holders = new Map<string, Set<string>>();
  for (const [key, record] of records) {
    for (const id of record.dropped ?? []) dropped.add(id);
    for (const entry of record.entries) {
      if (!entry || typeof entry.id !== "string" || !Array.isArray(entry.writes)) continue;
      copies.set(entry.id, [...copies.get(entry.id) ?? [], JSON.stringify(entry)]);
      holders.set(entry.id, new Set([...holders.get(entry.id) ?? [], key]));
      const known = byId.get(entry.id), stamp = entry.stamp ?? 0, knownStamp = known?.stamp ?? 0;
      if (!known || stamp > knownStamp || (stamp === knownStamp && known.state !== "conflict" && entry.state === "conflict"))
        byId.set(entry.id, structuredClone(entry));
    }
  }
  const replacedBy = new Map<string, OutboxEntry>();
  for (const entry of byId.values()) for (const id of entry.replaces ?? []) replacedBy.set(id, entry);
  const gone = new Map<string, OutboxEntry>();
  for (const [id, entry] of byId) if (dropped.has(id) || replacedBy.has(id)) { gone.set(id, entry); byId.delete(id); }
  const entries = [...byId.values()].sort((a, b) => a.seq - b.seq || (a.stamp ?? 0) - (b.stamp ?? 0));
  const resolveBase = (write: OutboxWrite): OutboxBase => {
    for (let depth = 0; depth < 64; depth++) {
      const base = write.base;
      if (typeof base !== "object") return base;
      if (byId.has(base.after)) return base;
      const removed = gone.get(base.after);
      if (!removed) return 0;
      const replacement = replacedBy.get(base.after);
      if (replacement && !replacement.fork && byId.has(replacement.id) && replacement.writes.some(item => documentKey(item) === documentKey(write)))
        return { after: replacement.id };
      write = { ...write, base: removed.writes.find(item => documentKey(item) === documentKey(write))?.base ?? 0 };
    }
    return 0;
  };
  const changed = new Set<string>();
  for (const entry of entries) {
    for (const write of entry.writes) { const base = resolveBase(write); if (!same(base, write.base)) changed.add(entry.id); write.base = base; }
    // Copies that disagree (a crash between two keys' writes), or fewer copies than the keys it writes: all are written again.
    const kept = copies.get(entry.id) ?? [];
    if (new Set(kept).size > 1 || kept.length !== new Set(entry.writes.map(documentKey)).size) changed.add(entry.id);
  }
  // Every removed entry still held somewhere stays marked until each key holding it is written again without it.
  const graves = new Map<string, Set<string>>();
  for (const id of gone.keys()) graves.set(id, new Set(holders.get(id)));
  return { entries, changed, graves, markers: new Set([...dropped, ...replacedBy.keys()]) };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

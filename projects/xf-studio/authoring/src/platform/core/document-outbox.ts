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
 *   generation): an earlier launch's write a crash left the stored copy older than. They become the documents' baseline; the replayed
 *   command's successors still go over the revision it produced (their values were made over its value), never over `own`'s.
 * - **Recovery gate.** Entries read back at open are replayed before anything else touches their documents: a new edit of a document
 *   with a recovered entry the library hasn't answered is refused (`OutboxRecoveringError`), so no edit is ever made over a recovered
 *   copy that a crash with host writes pending left older than this workspace's own later write. With the replay answered (and `own`
 *   adopted), edits go over the library's revision, so that crash brings no false conflict either. Any answer that changes what a document
 *   shows (a recovered copy giving way to the library's newer value) is announced as `external`, so every owner holding the document (a
 *   V's context, a look's session, a profile, a collection) replaces what it shows before it takes another edit. A slow or absent answer
 *   is said so (`status().recovering`, `recoveringShown`, `recoveringLong`), and `retry`, and `keepRestored` where that is safe, are the
 *   ways on; no timer ever unlocks a document.
 * - **Attempts have deadlines.** Each send is one attempt with a deadline (`ATTEMPT_MS`); past it, or on Try again (`retry`), the attempt
 *   is abandoned, the command is sent again under its own ID, and the abandoned attempt's late answer is ignored. The recovery gate stays
 *   throughout: abandoning an attempt never unlocks a document. A receipt's answer says what the command committed (`committed`), so a
 *   stored copy older than the command as sent never becomes the baseline.
 * - **Required content is kept with the commands that need it.** An immutable document a stored command requires keeps its content in
 *   its own key's record (`retained`), so the library's cleanup and a restart together can't leave the command waiting for nothing: it
 *   is put again. Where no copy is left anywhere, the commands keep waiting, `status().missing` says so, and importing the same save
 *   again sends them, or `discardWaiting` drops them. A required document this page doesn't hold is read whole from the library, and its
 *   arrival is announced like any change from elsewhere, so whatever shows a document depending on it can show it before another edit.
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
import { COMMAND_LIMITS, documentKey } from "../api/document-commands";

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
  watch?(listener: (key: string, state: "pending" | "stored" | "failed", error?: unknown) => void): void;
  /**
   * The slower, durable copy's texts as they were read (the desktop host's), where it differs from what `load` merges: a stale entry it
   * still holds stays marked until that copy's key is written again and the write lands, never judged spent from the merged view.
   */
  durable?(): ReadonlyMap<string, string>;
}
export type OutboxTransport = {
  /** `signal` ends the attempt (its deadline passed, or Try again): the command is sent again under its ID, and a late answer is ignored. */
  transact(request: TransactRequest, signal?: AbortSignal): Promise<TransactAnswer>;
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
  /** Whether to warn: a change still waiting for the library has a failed write or a backup waiting longer than `WARN_AFTER_MS`. */
  readonly unprotectedWarning: boolean;
  /** Why changes still waiting for the library warrant a warning; null once the library has them or before a brief wait is over. */
  readonly unprotectedReason: "pending" | "failed" | "storage-full" | null;
  /** The last send failed (the host didn't answer); it is sent again shortly. */
  readonly failing: boolean;
  /** Stopped: the page released or lost its workspace, and nothing is written or sent again. */
  readonly stopped: boolean;
  /** Documents with a change from the last session still being restored (no new edit is taken on them until it is: `recovering`). */
  readonly recovering: readonly DocumentRef[];
  /** Restoring has taken longer than `RECOVERY_SHOW_MS`: it is said so (a moment's restore shows nothing). */
  readonly recoveringShown: boolean;
  /** Restoring has taken longer than `RECOVERY_NOTICE_MS`: the person is offered Try again (and, where safe, to keep working). */
  readonly recoveringLong: boolean;
  /**
   * Every document still being restored can safely be edited now (`keepRestored`): the library hadn't taken its restored change, or
   * anything after it, when this page read it, so new edits follow that change and never go over a newer one unseen.
   */
  readonly recoveringSafe: boolean;
  /** Documents whose changes wait for a source (a decoded save) neither the library nor this page holds: import it again, or `discardWaiting`. */
  readonly missing: readonly DocumentRef[];
};
/** How long restoring may take before it is said so, and before the person is offered a way on. */
export const RECOVERY_SHOW_MS = 1000, RECOVERY_NOTICE_MS = 5000;
/** How long one attempt to send a command may take: past it the attempt is abandoned and the command sent again under its own ID. */
export const ATTEMPT_MS = 15_000;
/** Why an attempt was abandoned. */
const EXPIRED = "expired", RETRIED = "retried";
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
  /** How long one attempt to send a command may take before it is given up and sent again (`ATTEMPT_MS`). */
  readonly attemptMs?: number;
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
/**
 * A change refused because the document still has commands recovered from an earlier session that the library hasn't answered yet
 * (§2.2): an edit made over that recovered value could otherwise land over a newer write of this workspace's own. It lasts until the
 * replay is answered, usually milliseconds.
 */
export class OutboxRecoveringError extends Error {
  constructor() { super("This is still being restored from your last session. Try again in a moment."); this.name = "OutboxRecoveringError"; }
}
/** A change that would write more documents than one host transaction takes (`COMMAND_LIMITS.writes`). */
export class OutboxTooLargeError extends Error {
  constructor() { super(`That changes too many things at once (at most ${COMMAND_LIMITS.writes}). Make it in smaller steps.`); this.name = "OutboxTooLargeError"; }
}
/** How long a background copy may wait before the page warns that changes aren't protected (a write that fails warns at once). */
export const WARN_AFTER_MS = 2000;
/**
 * How long an edit recorded with `store: "soon"` waits before its key is stored (a look edited continuously, a drag: one storage write per
 * interval, not per frame). A renderer crash loses at most this much of such edits; nothing else waits.
 */
export const STORE_SOON_MS = 250;
/**
 * One document's stored record. `retained`: an immutable document's content, kept here while any stored command requires it, so a
 * restart can still put it again when the library's cleanup purged it (the page's other copies may be gone by then).
 */
export type StoredKey = { schema: typeof SCHEMA; stamp: number; entries: OutboxEntry[]; dropped?: string[]; retained?: unknown };
/** A document's acknowledged baseline: the library's revision and value as this page last learned them. */
type Held = { ref: DocumentRef; revision: number; base: unknown; known: boolean; version: number };
type Waiter = (outcome: OutboxOutcome) => void;

export class DocumentOutbox {
  private readonly held = new Map<string, Held>();
  private entries: OutboxEntry[] = [];
  private readonly inFlight = new Set<string>();
  /** Each command in flight's current attempt: abandoning it (its deadline, Try again) sends the command again and ignores a late answer. */
  private readonly attempts = new Map<string, AbortController>();
  /** Keys whose latest write isn't stored yet: since when it has waited, and whether a write of it failed. */
  private readonly unprotectedKeys = new Map<string, { since: number; failed: boolean; full: boolean }>();
  /**
   * Entries a resolution or a repair removed, with the keys that may still hold a stale copy of each: every key written carries their
   * IDs as markers until each of those keys is stored without the copy, so a crash at any point (during a recovery too) never brings
   * one back.
   */
  private readonly graves = new Map<string, Set<string>>();
  private readonly listeners = new Set<(event: OutboxEvent) => void>();
  /** Owners' membership refreshes, run at the start of every revision check (`onCheck`). */
  private readonly membership = new Set<(signal?: AbortSignal) => Promise<void>>();
  /**
   * Keys whose latest entries are recorded here but not stored yet (`commit` with `store: "soon"`): stored together within
   * `STORE_SOON_MS`, or at once by `store()`, `settle`, `flush` or any write of the key. Until then they count as unprotected, and their
   * entries aren't sent (an entry is stored before it is sent).
   */
  private readonly deferred = new Set<string>();
  private storeTimer: { cancel(): void } | null = null;
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
  /** Immutable documents being looked up in the library, each lookup with its deadline (abandoned like a send attempt: `retry`). */
  private readonly looking = new Map<string, AbortController>();
  /** Sent at least once, or read back from storage (it may have been sent): its ID, bases and values never change again (A1). */
  private readonly frozenIds = new Set<string>();
  /** Documents the person chose to keep working on before their restored changes were answered (`keepRestored`). */
  private readonly released = new Set<string>();
  private openedAt = 0;
  /** Required immutable documents neither the library nor this page holds (`missingSource`). */
  private readonly missing = new Set<string>();
  /** Entries read back from storage at open: until each is answered, no new edit is admitted on its documents (`recovering`). */
  private readonly recovered = new Set<string>();
  private seq = 0;
  private stamp = 0;
  private stopped = false;
  private opened = false;
  private failing = false;
  private failures = 0;
  private retryTimer: { cancel(): void } | null = null;
  private sizes = new Map<string, number>();
  private readonly life = new AbortController();
  private readonly timers = new Set<{ cancel(): void }>();

  constructor(private readonly transport: OutboxTransport, private readonly storage: OutboxStorage, private readonly options: OutboxOptions = {}) {
    storage.watch?.((key, state, error) => {
      if (this.stopped) return;
      // A key with a newer value waiting to be stored soon stays unprotected: what landed is older than what this page shows.
      if (state === "stored") { this.stored(key); if (!this.deferred.has(key) && this.unprotectedKeys.delete(key)) this.emit({ kind: "status" }); }
      else this.unprotect(key, state === "failed", error);
    });
  }

  private newId() { return (this.options.newId ?? (() => `o-${crypto.randomUUID()}`))(); }
  private now() { return (this.options.now ?? Date.now)(); }
  private writable() { return !this.stopped && (this.options.writable?.() ?? true); }
  private sendable() { return !this.stopped && (this.options.sendable ?? this.options.writable)?.() !== false; }
  private immutable(kind: string) { return this.options.immutable?.(kind) ?? false; }
  private schedule(ms: number, run: () => void) {
    const timer = (this.options.schedule ?? defaultSchedule)(ms, () => { this.timers.delete(owned); if (!this.stopped) run(); });
    const owned = { cancel: () => { timer.cancel(); this.timers.delete(owned); } };
    this.timers.add(owned);
    return owned;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Opening and storage

  /**
   * Reads the stored entries, repairs keys a crash left part-written, raises stored conflicts again and replays every queued entry under
   * its own ID. Call once, when this page holds its workspace.
   */
  open(): void {
    if (this.stopped) throw Error("This workspace was released, so its outbox cannot be opened again.");
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
    // Required content kept with the commands that need it: this page holds it again (looked up in the library before it is trusted).
    for (const [key, record] of records) if (record.retained !== undefined) { const held = this.local(refOfKey(key)); if (held.base === undefined) held.base = record.retained; }
    // An entry the repair changed, or whose copies disagree, is written again everywhere with a newer stamp, so no stale copy outlives it.
    const changed = this.entries.filter(entry => repaired.changed.has(entry.id));
    for (const entry of changed) this.touch(entry);
    this.seq = Math.max(0, ...this.entries.map(entry => entry.seq));
    for (const entry of this.entries) {
      this.frozenIds.add(entry.id);
      this.recovered.add(entry.id);
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
      if (rewrite.has(key) || !stored || stored.entries.length !== now.length || (stored.retained !== undefined) !== (this.retained(key) !== undefined) ||
        stored.entries.some((entry, i) => entry.id !== now[i]!.id || (entry.stamp ?? 0) !== (now[i]!.stamp ?? 0))) this.persistKey(key);
    }
    for (const key of keys) {
      const stored = records.get(key);
      if (stored?.dropped?.some(id => !this.graves.has(id)) && !this.unprotectedKeys.has(key)) this.persistKey(key);
    }
    for (const entry of this.entries) if (entry.state === "conflict") this.emit({ kind: "conflict", entry });
    // Restoring that takes long is said so (and offered a way on) once `RECOVERY_NOTICE_MS` has passed.
    this.openedAt = this.now();
    if (this.writable() && this.recoveringKeys().length) for (const ms of [RECOVERY_SHOW_MS, RECOVERY_NOTICE_MS])
      this.schedule(ms, () => { if (this.recoveringKeys().length) this.emit({ kind: "status" }); });
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
    if (this.deferred.delete(key) && !this.deferred.size) { this.storeTimer?.cancel(); this.storeTimer = null; }
    const dropped = [...this.graves.keys()], retained = this.retained(key);
    const entries = this.entriesFor(key), empty = !entries.length && !dropped.length && retained === undefined;
    const record: StoredKey = { schema: SCHEMA, stamp: ++this.stamp, entries, ...(dropped.length ? { dropped } : {}), ...(retained !== undefined ? { retained } : {}) };
    const text = JSON.stringify(record);
    try {
      this.storage.write(key, text, empty);
      if (empty) this.sizes.delete(key); else this.sizes.set(key, key.length + text.length);
      // A store with a background copy says when that lands (`watch`): only then is the key stored and protected.
      if (!this.storage.watch) { this.stored(key); if (this.unprotectedKeys.delete(key)) this.emit({ kind: "status" }); }
      return true;
    } catch (error) {
      this.options.report?.(error);
      this.unprotect(key, true, error);
      return false;
    }
  }
  /** An immutable document's content while a command this page holds requires it (stored with its key: `StoredKey.retained`). */
  private retained(key: string): unknown {
    if (!this.immutable(refOfKey(key).kind) || !this.entries.some(entry => entry.requires?.includes(key))) return undefined;
    return this.held.get(key)?.base;
  }
  /** The immutable documents `entries` require: their keys are written again when a command requiring them comes or goes. */
  private requiredKeys(...entries: readonly OutboxEntry[]): string[] { return entries.flatMap(entry => entry.requires ?? []); }
  /** `key`'s latest text is stored: receipts and markers waiting only for it can go. */
  private stored(key: string) {
    for (const [id, keys] of this.forgetting) if (keys.delete(key) && !keys.size) { this.forgetting.delete(id); this.forget.push(id); }
    for (const [id, keys] of this.graves) if (keys.delete(key) && !keys.size) this.graves.delete(id);
  }
  /** `key` isn't protected (yet): a failure warns at once, a background copy still waiting after `WARN_AFTER_MS` too. */
  private unprotect(key: string, failed: boolean, error?: unknown) {
    const known = this.unprotectedKeys.get(key);
    const cause = error as { name?: string; code?: string | number } | null;
    const full = cause?.name === "QuotaExceededError" || cause?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      cause?.code === 22 || cause?.code === 1014 || cause?.code === "ENOSPC" || cause?.code === "EDQUOT";
    if (known && (known.failed || !failed) && (!full || known.full)) return;
    this.unprotectedKeys.set(key, { since: known?.since ?? this.now(), failed: failed || !!known?.failed, full: full || !!known?.full });
    this.emit({ kind: "status" });
    if (!failed) this.schedule(WARN_AFTER_MS, () => { if (this.unprotectedKeys.has(key)) this.emit({ kind: "status" }); });
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
    if (this.stopped) return false;
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
    if (this.stopped) return;
    const held = this.local(ref), pending = this.entriesFor(documentKey(ref)).length > 0;
    const revision = stored?.revision ?? 0;
    if (!held.known) {
      held.known = true;
      const before = this.visible(documentKey(ref));
      if (revision >= held.revision) { held.revision = revision; held.base = stored?.value; }
      held.version = Math.max(held.version, revision);
      // An immutable document's content arriving with its first read (a reload that finds a save another V imported) is a dependency
      // arriving: owners of what depends on it hear, as when a lookup or a put brings it.
      if (this.immutable(ref.kind) && before === undefined && this.visible(documentKey(ref)) !== undefined) this.emit({ kind: "external", refs: [held.ref] });
      queueMicrotask(() => this.pump());
      return;
    }
    if (!pending && revision > held.revision) {
      held.revision = revision; held.base = stored?.value; this.moved(held, revision);
      // Every owner holding the document hears of the newer value, not only the one that read it.
      this.emit({ kind: "external", refs: [held.ref] });
    }
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
  /** The documents recorded with `store: "soon"` and not stored yet (tests and diagnostics). */
  storingSoon(): readonly DocumentRef[] { return [...this.deferred].map(key => this.held.get(key)?.ref ?? refOfKey(key)); }
  status(): OutboxStatus {
    const recovering = this.recoveringKeys();
    const waiting = new Set(this.entries.filter(entry => entry.state === "queued" && entry.requires?.some(key => this.missing.has(key))).flatMap(entry => this.keysOf(entry)));
    // Failed cleanup writes still matter to crash repair, so keep their keys. They no longer risk losing work once the library has it.
    const pendingKeys = new Set(this.keysOf(...this.entries));
    const warnings = [...this.unprotectedKeys].filter(([key, item]) => pendingKeys.has(key) && (item.failed || this.now() - item.since >= WARN_AFTER_MS));
    const reason = warnings.some(([, item]) => item.full) ? "storage-full" : warnings.some(([, item]) => item.failed) ? "failed" : warnings.length ? "pending" : null;
    return { pending: this.entries.filter(entry => entry.state === "queued").length, conflicts: this.conflicts().length,
      unprotected: [...this.unprotectedKeys.keys()].map(key => this.held.get(key)?.ref ?? refOfKey(key)),
      unprotectedWarning: reason !== null, unprotectedReason: reason,
      failing: this.failing, stopped: this.stopped,
      recovering: recovering.map(key => this.held.get(key)?.ref ?? refOfKey(key)),
      recoveringShown: recovering.length > 0 && this.now() - this.openedAt >= RECOVERY_SHOW_MS,
      recoveringLong: recovering.length > 0 && this.now() - this.openedAt >= RECOVERY_NOTICE_MS,
      recoveringSafe: recovering.length > 0 && recovering.every(key => this.safeToContinue(key)),
      missing: [...waiting].map(key => this.held.get(key)?.ref ?? refOfKey(key)) };
  }
  subscribe(listener: (event: OutboxEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /**
   * Run `refresh` at the start of every revision check (A7): an owner whose documents another page can create (a default saved there)
   * lists its kind and holds the documents it didn't know, so this page finds them as it finds newer revisions. Returns the removal.
   */
  onCheck(refresh: (signal?: AbortSignal) => Promise<void>): () => void { this.membership.add(refresh); return () => { this.membership.delete(refresh); }; }
  /**
   * Stores every key recorded with `store: "soon"` now (pagehide, closing, Save version, Check, Build, a takeover's drain), and sends what
   * waited for it.
   */
  store(): void {
    if (!this.deferred.size) return;
    this.storeTimer?.cancel(); this.storeTimer = null;
    this.persist([...this.deferred]);
    this.pump();
  }
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
  commit(command: string, edits: readonly OutboxEdit[], options: { requires?: readonly DocumentRef[];
    /**
     * `soon`: the entry is recorded here at once (every value taken from elsewhere meets it, as any pending entry), and its key is stored
     * within `STORE_SOON_MS` with the edits that follow (a continuous edit); default `now`. A single-document edit only.
     */
    store?: "now" | "soon" } = {}): OutboxEntry {
    this.requireWritable();
    if (!edits.length) throw Error("A command changes at least one document.");
    if (edits.length > COMMAND_LIMITS.writes || (options.requires?.length ?? 0) > COMMAND_LIMITS.writes) throw new OutboxTooLargeError();
    if (edits.some(edit => this.recovering(edit))) throw new OutboxRecoveringError();
    if (edits.some(edit => this.immutable(edit.kind))) throw Error("An immutable document is written by `put`.");
    const requires = [...new Set((options.requires ?? []).map(documentKey))];
    let entry: OutboxEntry | undefined;
    if (edits.length === 1) {
      const key = documentKey(edits[0]!), last = this.lastFor(key);
      if (last && last.writes.length === 1 && (!this.frozen(last) || last.state === "conflict")) {
        last.writes[0]!.value = edits[0]!.value;
        last.at = this.now();
        if (last.command !== command) last.command = "coalesced";
        // The new value's references replace the old one's when the owner names them (it does for every value it writes).
        if (options.requires !== undefined) { if (requires.length) last.requires = requires; else delete last.requires; }
        else if (requires.length) last.requires = [...new Set([...last.requires ?? [], ...requires])];
        entry = last;
      }
    }
    if (!entry) {
      entry = { id: this.newId(), seq: this.nextSeq(), command, at: this.now(), state: "queued",
        writes: edits.map(edit => ({ kind: edit.kind, id: edit.id, base: this.baseFor(documentKey(edit)), value: edit.value })),
        ...(requires.length ? { requires } : {}) };
      this.entries.push(entry);
    }
    this.touch(entry);
    for (const edit of edits) this.local(edit).version++;
    if (options.store === "soon" && edits.length === 1 && !requires.length) this.defer(documentKey(edits[0]!));
    else this.persist([...edits.map(edit => documentKey(edit)), ...requires]);
    this.emit({ kind: "recorded", entry, refs: edits.map(edit => ({ kind: edit.kind, id: edit.id })) });
    queueMicrotask(() => this.pump());
    return entry;
  }
  /**
   * An immutable, content-addressed document, written once by its own create-only command (null: this page already holds it, or is
   * writing it). Equal content has an equal ID, so another page's write of it is acknowledged, never a conflict.
   */
  put(ref: DocumentRef, value: unknown): OutboxEntry | null {
    this.requireWritable();
    if (!this.immutable(ref.kind)) throw Error("Only an immutable document is put.");
    const key = documentKey(ref);
    if (this.visible(key) !== undefined || this.entriesFor(key).length) return null;
    const entry: OutboxEntry = { id: this.newId(), seq: this.nextSeq(), command: "immutable.put", at: this.now(), state: "queued",
      writes: [{ kind: ref.kind, id: ref.id, base: 0, value }] };
    this.entries.push(entry);
    this.touch(entry);
    this.local(ref).version++;
    this.missing.delete(key);
    this.persist([key]);
    this.emit({ kind: "recorded", entry, refs: [ref] });
    queueMicrotask(() => this.pump());
    return entry;
  }
  private frozen(entry: OutboxEntry) { return this.frozenIds.has(entry.id); }
  /** `key` is stored soon, with the edits that follow it (`store: "soon"`); meanwhile it is unprotected. */
  private defer(key: string) {
    this.deferred.add(key);
    this.unprotect(key, false);
    this.storeTimer ??= this.schedule(STORE_SOON_MS, () => { this.storeTimer = null; this.store(); });
  }
  /**
   * The next entry's place in order: above every entry this page has seen, and never below the clock, so a launch that recovered fewer
   * entries than an earlier one held (a crash with host writes pending) still orders its new commands after every older one that comes
   * back later.
   */
  private nextSeq(): number { this.seq = Math.max(this.seq + 1, this.now()); return this.seq; }
  /**
   * Whether the document still has a command recovered from an earlier session that the library hasn't answered (a conflict doesn't
   * count: edits fold into its "mine", and Keep mine is explicit). New edits wait for that answer, so they are made over the value the
   * library acknowledged (with any later write of this workspace's own adopted, `own`), never over the recovered copy.
   */
  recovering(ref: DocumentRef): boolean {
    const key = documentKey(ref);
    return !this.released.has(key) && this.entries.some(entry => entry.state === "queued" && this.recovered.has(entry.id) && entry.writes.some(write => documentKey(write) === key));
  }
  private recoveringKeys(): string[] {
    return [...new Set(this.entries.filter(entry => entry.state === "queued" && this.recovered.has(entry.id)).flatMap(entry => this.keysOf(entry)))]
      .filter(key => !this.released.has(key));
  }
  /**
   * Whether new edits may follow a document's restored changes before the library answers them: this page read the document at the
   * revision the first of them is based on, so the library had taken neither it nor anything after it, and a new edit (sent after it,
   * over its revision) can only go stale against another workspace's write, never over a newer one of this workspace's own unseen.
   */
  private safeToContinue(key: string): boolean {
    const held = this.held.get(key), first = this.entries.find(entry => this.recovered.has(entry.id) && entry.writes.some(write => documentKey(write) === key));
    const base = first?.writes.find(write => documentKey(write) === key)?.base;
    return !!held?.known && typeof base === "number" && base === held.revision;
  }
  /**
   * Try again: sends what waits now (restored changes, changes waiting for the library), and looks again for missing sources.
   */
  retry(): void {
    if (this.stopped) return;
    this.retryTimer?.cancel(); this.retryTimer = null;
    // A hung attempt is abandoned and its command sent again (under its own ID: a late answer to the old attempt is ignored).
    for (const attempt of this.attempts.values()) attempt.abort(RETRIED);
    // A hung lookup is abandoned too, and looked up again (its late answer ignored); so is one for a source known to be missing.
    for (const lookup of this.looking.values()) lookup.abort(RETRIED);
    this.looking.clear();
    this.pump();
  }
  /**
   * Keep working on the restored version: documents whose restored changes are safe to edit after (`status().recoveringSafe`) take
   * edits again before the library has answered; answers the documents still waiting. Never unlocks one that isn't safe.
   */
  keepRestored(): readonly DocumentRef[] {
    for (const key of this.recoveringKeys()) if (this.safeToContinue(key)) this.released.add(key);
    this.emit({ kind: "status" });
    return this.status().recovering;
  }
  /**
   * Discards the changes waiting for a missing source (`status().missing`), as Use theirs does: the documents show the library's
   * version, and later changes based on them go stale rather than over it. Answers how many changes were discarded.
   */
  discardWaiting(): number {
    if (!this.writable()) throw Error("This workspace is open elsewhere, so this can't be done here.");
    const dropped = this.entries.filter(entry => entry.state === "queued" && !this.inFlight.has(entry.id) && entry.requires?.some(key => this.missing.has(key)));
    for (const old of dropped) {
      const successors = this.repoint(old.id, write => old.writes.find(item => documentKey(item) === documentKey(write))?.base ?? 0);
      for (const other of successors) this.touch(other);
      this.entries = this.entries.filter(entry => entry !== old);
      this.bury(old);
      this.persist([...this.keysOf(old), ...this.keysOf(...successors), ...this.requiredKeys(old)]);
      this.finish(old.id, "dropped");
      this.emit({ kind: "resolved", entry: old, how: "theirs", refs: old.writes.map(write => ({ kind: write.kind, id: write.id })) });
    }
    if (dropped.length) { this.missing.clear(); this.emit({ kind: "status" }); }
    return dropped.length;
  }

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
        const lookup = new AbortController();
        this.looking.set(key, lookup);
        const ref = refOfKey(key);
        const current = () => !this.stopped && this.looking.get(key) === lookup && !lookup.signal.aborted;
        const deadline = this.schedule(this.options.attemptMs ?? ATTEMPT_MS, () => {
          if (!current()) return;
          lookup.abort(EXPIRED); this.looking.delete(key); this.later();
        });
        // Read whole: an immutable document's content never changes, so whoever needs it here (a V whose save it is) can show it now.
        void this.transport.read([ref], lookup.signal).then(read => {
          deadline.cancel();
          // An abandoned lookup's late answer is ignored: the lookup made since (or the next send's) decides.
          if (!current()) return;
          this.looking.delete(key);
          const found = read[key], revision = found?.revision ?? 0;
          if (revision > 0) {
            const local = this.local(ref), arrived = local.base === undefined && !this.entriesFor(key).length;
            local.known = true; local.revision = Math.max(local.revision, revision);
            if (arrived) { local.base = found!.value; this.moved(local, revision); }
            if (this.missing.delete(key)) this.emit({ kind: "status" });
            // The content arriving here is a change every owner holding something that depends on it must hear (they show it now).
            if (arrived) this.emit({ kind: "external", refs: [local.ref] });
            this.pump();
          }
          else this.restore([key]);
        }, error => { deadline.cancel(); if (!current()) return; this.looking.delete(key); this.options.report?.(error); this.later(); });
      }
    }
    return ready;
  }

  /**
   * Immutable documents a command requires that the library no longer holds (its cleanup purged them after this page learned of them):
   * each is put again from the content this page holds, and the command waits for it. One this page holds no content of can't be: the
   * command waits, and is tried again later.
   */
  private restore(keys: readonly string[]): void {
    for (const key of keys) {
      const held = this.held.get(key);
      if (this.entriesFor(key).length) continue;
      if (!held || held.base === undefined || !this.immutable(held.ref.kind)) {
        if (held) { held.known = false; held.revision = 0; }
        this.missingSource(key);
        continue;
      }
      held.revision = 0; held.known = true;
      const entry: OutboxEntry = { id: this.newId(), seq: this.nextSeq(), command: "immutable.put", at: this.now(), state: "queued",
        writes: [{ kind: held.ref.kind, id: held.ref.id, base: 0, value: held.base }] };
      this.entries.push(entry);
      this.touch(entry);
      this.persist([key]);
      this.emit({ kind: "recorded", entry, refs: [held.ref] });
    }
    this.later();
  }

  /**
   * A required immutable document that neither the library nor this page holds (a missing source): the commands needing it keep
   * waiting, and are looked for again whenever the outbox next sends; `status().missing` names their documents, so the person can import the source again
   * (a put of it sends them) or `discard` them. Nothing waits silently for ever.
   */
  private missingSource(key: string): void {
    // Not polled: it is looked for again whenever the outbox next sends (any change, a put of it, Try again).
    if (!this.missing.has(key)) { this.missing.add(key); this.emit({ kind: "status" }); }
  }

  private pump(): void {
    if (!this.opened || !this.sendable()) return;
    for (const [at, entry] of this.entries.entries()) {
      if (entry.state !== "queued" || this.inFlight.has(entry.id)) continue;
      if (entry.writes.some(write => typeof write.base !== "number")) continue;
      // Stored before sent: an entry whose key waits to be stored waits with it.
      if (this.deferred.size && entry.writes.some(write => this.deferred.has(documentKey(write)))) continue;
      // Commands on a document go one after another: never past an earlier one still waiting on it (after a crash with host writes
      // pending, two recovered commands on a document can both hold numeric bases).
      const keys = new Set(this.keysOf(entry));
      if (this.entries.slice(0, at).some(earlier => earlier.writes.some(write => keys.has(documentKey(write))))) continue;
      if (!this.ready(entry)) continue;
      void this.send(entry);
    }
  }
  private later() { if (!this.stopped) this.retryTimer ??= this.schedule(this.options.retryMs ?? 1000, () => { this.retryTimer = null; this.pump(); }); }

  private async send(entry: OutboxEntry): Promise<void> {
    this.frozenIds.add(entry.id); // A1: from here its ID, bases and values are fixed.
    this.inFlight.add(entry.id);
    const forget = this.forget; this.forget = [];
    // One attempt, with its deadline: abandoned (expired, or Try again), it ends here as a lost answer would, and whatever answer comes
    // later is ignored; the command is sent again under its ID, so the host's receipt decides (A4). The recovery gate stays throughout.
    const attempt = new AbortController();
    this.attempts.set(entry.id, attempt);
    const deadline = this.schedule(this.options.attemptMs ?? ATTEMPT_MS, () => attempt.abort(EXPIRED));
    const abandoned = new Promise<never>((_resolve, reject) => attempt.signal.addEventListener("abort", () => reject(Error("The library took too long to answer.")), { once: true }));
    let answer: TransactAnswer;
    try {
      answer = await Promise.race([this.transport.transact({ id: entry.id, command: entry.command, forget,
        writes: entry.writes.map(write => ({ kind: write.kind, id: write.id, base: write.base as number, value: write.value })),
        ...(entry.requires?.length ? { requires: entry.requires.map(refOfKey) } : {}) }, attempt.signal), abandoned]);
    } catch (error) {
      // Lost: maybe committed, maybe not. Sent again with the same ID later (A1); the host's receipt decides (A4).
      deadline.cancel();
      if (this.attempts.get(entry.id) === attempt) this.attempts.delete(entry.id);
      this.inFlight.delete(entry.id);
      this.forget.push(...forget);
      if (this.stopped) return;
      this.failures++;
      if (!this.failing) { this.failing = true; this.emit({ kind: "status" }); } else this.wake();
      this.options.report?.(error);
      // Try again sends it again at once; otherwise after the retry delay.
      if (attempt.signal.reason === RETRIED) this.pump(); else this.later();
      return;
    }
    deadline.cancel();
    if (this.attempts.get(entry.id) === attempt) this.attempts.delete(entry.id);
    this.inFlight.delete(entry.id);
    if (this.stopped) return;
    const recovered = this.failing;
    if (this.failing) { this.failing = false; this.emit({ kind: "status" }); }
    if (!this.entries.includes(entry) || this.stopped) { this.forget.push(...forget); return; }
    // A receipt's answer carries what the command committed: the baseline is that, never a stored copy's older version of the command.
    if (answer.ok) this.acknowledge(entry, answer.revisions, answer.replayed,
      answer.committed ? Object.fromEntries(Object.entries(answer.committed).map(([key, value]) => [key, { revision: answer.revisions[key] ?? 0, value }])) : undefined, answer.own);
    else if (answer.reason === "stale" && entry.writes.every(write => this.immutable(write.kind))) {
      // An immutable document already there is the same content (its ID is its content): this write is acknowledged as it stands.
      const revisions = Object.fromEntries(entry.writes.map(write => [documentKey(write), answer.current[documentKey(write)]?.revision ?? 0]));
      this.acknowledge(entry, revisions, "equal", answer.current);
    } else if (answer.reason === "stale") this.toConflict(entry, { ...answer.current });
    else if (answer.reason === "missing") { this.forget.push(...forget); this.restore(answer.missing); }
    else { this.forget.push(...forget); this.stop(); }
    // A put that landed (or was already there) is what commands waiting for a missing source wait for.
    if (!this.entries.includes(entry) && entry.writes.every(write => this.immutable(write.kind)))
      for (const write of entry.writes) if (this.missing.delete(documentKey(write))) this.emit({ kind: "status" });
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
    // What each of its documents shows now: an answer that changes it (a recovered copy older than the library's value giving way to
    // that value) is a change owners must hear of, like one from elsewhere.
    const shown = new Map(entry.writes.map(write => [documentKey(write), this.visible(documentKey(write))]));
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
      // Successors go over the revision this command produced, never over `own`'s later ones: their values were made over this
      // command's value, so sending them over a later write would put that older value back without a conflict.
      if (typeof write.base === "object" && write.base.after === entry.id) { write.base = revisions[documentKey(write)] ?? 0; rebased.add(other); }
    for (const other of rebased) this.touch(other);
    // Its receipt is forgotten once every key it was kept under is stored without it.
    const keys = this.keysOf(entry);
    this.forgetting.set(entry.id, new Set(keys));
    for (const other of done) this.bury(other);
    // The superseded copies first: a kill after them leaves the acknowledged entry stored, to be replayed by its receipt, beside the
    // superseded copy as it now is (its newer stamp wins on open); a kill after the acknowledgement's own keys can then never bring back
    // a superseded copy's write as the document's value.
    this.persist([...this.keysOf(...superseded), ...keys, ...this.keysOf(...rebased), ...this.keysOf(...done), ...this.requiredKeys(entry, ...done)]);
    for (const other of done) this.finish(other.id, "acknowledged");
    this.finish(entry.id, "acknowledged");
    this.emit({ kind: "acknowledged", entry, revisions, ...(replayed ? { replayed } : {}) });
    // A later revision of its own this page hadn't read yet, or any value the answer revealed in place of a recovered copy's, is a change
    // to what owners show: they replace what they hold (a V's context, a look's session), as for a change from elsewhere.
    for (const [key, before] of shown) {
      const after = this.visible(key), held = this.held.get(key);
      if (!held || taken.some(ref => documentKey(ref) === key) || before === after || same(before, after)) continue;
      this.moved(held, held.revision);
      taken.push(held.ref);
    }
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

  /**
   * Keep mine: an explicit command over the newer revisions, with a fresh ID, in one outbox write. `amend` lets the owner make mine whole
   * over theirs in the same command (a collection's membership and the state of the looks it lists): it returns the writes, which may
   * change mine's values and add documents (each written over the revision the owner read it at, `base`, else the one this page holds).
   */
  keepMine(conflictId: string, amend?: (mine: readonly OutboxEdit[]) => readonly (OutboxEdit & { readonly base?: number })[]): OutboxEntry {
    const old = this.conflictEntry(conflictId);
    const edits: readonly (OutboxEdit & { readonly base?: number | OutboxBase })[] = amend
      ? amend(old.writes.map(write => ({ kind: write.kind, id: write.id, value: write.value }))) : old.writes.map(write => ({ ...write, base: undefined }));
    if (!edits.length || edits.length > COMMAND_LIMITS.writes) throw new OutboxTooLargeError();
    const theirs = (key: string) => old.writes.some(write => documentKey(write) === key);
    const fresh: OutboxEntry = { id: this.newId(), seq: old.seq, command: old.command, at: this.now(), state: "queued", replaces: [old.id],
      writes: edits.map(write => ({ kind: write.kind, id: write.id, value: write.value,
        // A document the owner added names the revision it read it at (`base`), or this page's.
        base: theirs(documentKey(write)) ? old.current?.[documentKey(write)]?.revision ?? 0 : typeof write.base === "number" ? write.base : this.local(write).revision })),
      ...(old.requires?.length ? { requires: [...old.requires] } : {}) };
    for (const write of fresh.writes) if (!theirs(documentKey(write))) this.local(write).version++;
    this.touch(fresh);
    this.entries = this.entries.map(entry => entry === old ? fresh : entry);
    this.bury(old);
    const successors = this.repoint(old.id, () => ({ after: fresh.id }));
    for (const other of successors) this.touch(other);
    this.move(old.id, fresh.id);
    this.persist([...this.keysOf(fresh), ...this.keysOf(old), ...this.keysOf(...successors)]);
    this.emit({ kind: "resolved", entry: old, how: "mine", refs: [...old.writes, ...fresh.writes.filter(write => !theirs(documentKey(write)))]
      .map(write => ({ kind: write.kind, id: write.id })), replacement: fresh });
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
    this.persist([...this.keysOf(old), ...this.keysOf(...successors), ...this.requiredKeys(old)]);
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
      if (edits.length > COMMAND_LIMITS.writes) throw new OutboxTooLargeError();
    } catch (error) {
      this.entries = before.entries;
      for (const [held, copy] of before.held) Object.assign(held, copy);
      throw error;
    }
    const successors = this.repoint(old.id, write => old.writes.find(item => documentKey(item) === documentKey(write))?.base ?? 0);
    for (const other of successors) this.touch(other);
    this.bury(old);
    const copy: OutboxEntry = { id: this.newId(), seq: this.nextSeq(), command: "conflict.keepBoth", at: this.now(), state: "queued", replaces: [old.id], fork: true,
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
    const lifetime = signal ? AbortSignal.any([signal, this.life.signal]) : this.life.signal;
    // Owners whose documents another page can add to (a default saved there) look for new ones first, and hold what they find.
    await Promise.all([...this.membership].map(refresh => refresh(lifetime).catch(error => { if (!lifetime.aborted) this.options.report?.(error); })));
    if (lifetime.aborted || !this.sendable()) return [];
    const clean = [...this.held.values()].filter(held => held.known && !this.entriesFor(documentKey(held.ref)).length);
    if (!clean.length) return [];
    const revisions = await this.transport.revisions(clean.map(held => held.ref), lifetime);
    if (lifetime.aborted || !this.sendable()) return [];
    const newer = clean.filter(held => (revisions[documentKey(held.ref)] ?? 0) > held.revision);
    if (!newer.length) return [];
    const stored = await this.transport.read(newer.map(held => held.ref), lifetime);
    if (lifetime.aborted || !this.sendable()) return [];
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
   * waiting (the entries stay, and are sent again), the outbox stops or `signal` aborts the wait. Conflicts don't count: they are stored
   * and shown again.
   */
  async settle(refs?: readonly DocumentRef[], signal?: AbortSignal): Promise<boolean> {
    const keys = refs ? new Set(refs.map(documentKey)) : null;
    const touches = (entry: OutboxEntry) => !keys || entry.writes.some(write => keys.has(documentKey(write)));
    const failures = this.failures;
    // `signal` ends only this wait: the entries stay and are still sent.
    const aborted = signal ? new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })) : null;
    this.store();
    this.pump();
    for (;;) {
      if (!this.entries.some(entry => touches(entry) && (entry.state === "queued" || this.inFlight.has(entry.id)))) return true;
      if (signal?.aborted || this.stopped || this.failures !== failures || !this.sendable()) return false;
      await Promise.race([this.changed(), ...(aborted ? [aborted] : [])]);
    }
  }
  /** Resolves once the outbox is empty of queued entries, or `signal` aborts; then says what is pending, in conflict or failed (§2.3). */
  async flush(signal?: AbortSignal): Promise<OutboxStatus> {
    const aborted = signal ? new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })) : null;
    this.store();
    this.pump();
    while (!signal?.aborted && !this.stopped && this.entries.some(entry => entry.state === "queued" || this.inFlight.has(entry.id)))
      await Promise.race([this.changed(), ...(aborted ? [aborted] : [])]);
    return this.status();
  }
  /**
   * Stops for good: what waits to be stored soon is stored first, then nothing is written or sent again (the page released or lost its
   * workspace, or the library said a newer holder superseded it). Stored entries stay for the next holder.
   */
  stop(): boolean {
    if (this.stopped) return true;
    // Persist first, then stop: what waits to be stored soon (`store: "soon"`) is written now, so the next holder recovers it (on every
    // path that stops: a release, a lease lost, a command superseded). Nothing more is sent.
    this.storeTimer?.cancel(); this.storeTimer = null;
    if (this.deferred.size) this.persist([...this.deferred]);
    for (const [key, protection] of [...this.unprotectedKeys]) if (protection.failed) this.persistKey(key);
    // A failed synchronous backup still belongs to this owner. Keep it and the lease available for retry/recovery.
    if ([...this.unprotectedKeys.values()].some(protection => protection.failed)) return false;
    this.stopped = true;
    this.life.abort();
    for (const attempt of this.attempts.values()) attempt.abort();
    for (const lookup of this.looking.values()) lookup.abort();
    this.attempts.clear(); this.looking.clear(); this.inFlight.clear();
    for (const timer of this.timers) timer.cancel();
    this.timers.clear();
    this.retryTimer?.cancel(); this.retryTimer = null;
    for (const id of [...this.waits.keys()]) this.finish(id, "stopped");
    this.emit({ kind: "status" });
    this.listeners.clear(); this.membership.clear();
    return true;
  }
  private requireWritable() {
    if (this.stopped) throw Error("This workspace was released, so this change can't be saved here.");
    if (!this.writable() || !this.opened) throw Error("This workspace is open elsewhere, so this change can't be made here.");
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
 * - a successor of an entry no key holds any more goes stale against the library rather than writing over it (after any earlier entry
 *   on its document, so commands on a document are still sent one after another).
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
  const resolveBase = (write: OutboxWrite, at: number): OutboxBase => {
    // A base that had to be resolved still follows any earlier entry on the same document (one whose successor's copy was lost in
    // between): commands on a document are sent in order, one after another.
    const earlier = (): OutboxBase => {
      for (let i = at - 1; i >= 0; i--) if (entries[i]!.writes.some(item => documentKey(item) === documentKey(write))) return { after: entries[i]!.id };
      return 0;
    };
    for (let depth = 0; depth < 64; depth++) {
      const base = write.base;
      if (typeof base !== "object") return depth ? (typeof earlier() === "object" ? earlier() : base) : base;
      if (byId.has(base.after)) return base;
      const removed = gone.get(base.after);
      if (!removed) return earlier();
      const replacement = replacedBy.get(base.after);
      if (replacement && !replacement.fork && byId.has(replacement.id) && replacement.writes.some(item => documentKey(item) === documentKey(write)))
        return { after: replacement.id };
      write = { ...write, base: removed.writes.find(item => documentKey(item) === documentKey(write))?.base ?? 0 };
    }
    return earlier();
  };
  const changed = new Set<string>();
  for (const [at, entry] of entries.entries()) {
    for (const write of entry.writes) { const base = resolveBase(write, at); if (!same(base, write.base)) changed.add(entry.id); write.base = base; }
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

/**
 * The collection owner (profiles design §1.1, §2.1, §7): every collection and look working copy, and only through commands. Nothing is
 * current here: no collection or look is "the" one, every command names the collection it changes and the revision it read (`base`),
 * and any number of collections and looks are held at once.
 *
 * - **Commands are all or nothing.** `collection.create`, `rename`, `reorder`, `addLook`, `copyLook` (from any collection), `removeLook`,
 *   `restoreLook` and `delete` each write the collection and every look they touch in one owner command: one outbox entry, one host
 *   transaction. A look's own edits (`look.update`, through `LookSessions`) are one-document commands that coalesce.
 * - **Removal and retention (§1.4).** A removed look joins the collection's `removed` list and its working copy becomes `removed`: not
 *   editable, restorable while it is listed. The command that pushes a look out of the list (the 21st removal), or the first command on a
 *   collection after a removal is 30 days old, writes that look's tombstone; `expire` (at load) records that command for collections
 *   nothing else changes (`collection.expire`, dropped by itself if another window changed the collection meanwhile). The host's cleanup purges
 *   tombstones 30 days later.
 * - **One write path: the outbox** (`platform/core/document-outbox.ts`). A collection or look as readers see it is the library's value
 *   with this window's commands on top; `revision` (a command's `base`) moves with every command recorded here and every change taken
 *   from elsewhere.
 * - **Coherent snapshots (§2.1).** `snapshot` and `saveVersion` first flush the collection's entries, then read the collection and its
 *   live looks in one read transaction; Save version writes the released tables from the host's own snapshot in the same transaction.
 * - **Conflicts.** Keep mine; Use theirs, which for a look keeps mine as a fork, as Keep both does ("(this window)", added to the
 *   collection as it is now, theirs). A conflict on a collection document alone is Keep mine or Use theirs.
 *
 * The Studio's collection service (`collection-service.ts`) works on the collection its scene's look belongs to through these commands,
 * and the look editor (`look-editor.ts`) writes the shown look through its session.
 */
import { refusal, type Capability } from "../platform/api/capability";
import type { OwnerTargetStatus } from "../platform/api/target-status";
import { COMMAND_LIMITS, type CurrentDocument, documentKey, type DocumentRef, isTombstone, tombstoneOf } from "../platform/api/document-commands";
import type { DocumentStorePort } from "../platform/api/document-store";
import { type DocumentOutbox, type OutboxEdit, type OutboxEntry, OutboxRecoveringError, OutboxTooLargeError } from "../platform/core/document-outbox";
import { COLLECTION_WORKING, COLLECTION_WORKING_SCHEMA, type CollectionWorking, collectionRef, collectionWorkingOf, LOOK_WORKING, LOOK_WORKING_SCHEMA,
  type LookRef, lookRef, type LookWorking, lookWorkingOf, lookOfDocument, nameOf, pruneRemoved, REMOVED_FOR_MS, type RemovedLook, suffixed } from "./collection-documents";

/** A new look's content. */
export type LookInput = { readonly name: string; readonly parts?: Readonly<Record<string, unknown>>; readonly memory?: unknown; readonly id?: string };
export type CollectionCommand =
  /** `saved`: the named version it is made from (opening a collection saved before it had a working copy). */
  | { kind: "collection.create"; name: string; id?: string; looks?: readonly LookInput[]; packagePlan?: unknown; saved?: { revision: number } }
  | { kind: "collection.rename"; collection: string; base: number; name: string }
  /** The package plan (which features ship in which XF mod); `undefined` is the default plan. */
  | { kind: "collection.plan"; collection: string; base: number; packagePlan: unknown }
  | { kind: "collection.reorder"; collection: string; base: number; looks: readonly string[] }
  | { kind: "collection.addLook"; collection: string; base: number; look?: LookInput; at?: number }
  | { kind: "collection.copyLook"; collection: string; base: number; from: LookRef; name?: string }
  | { kind: "collection.removeLook"; collection: string; base: number; look: string }
  | { kind: "collection.restoreLook"; collection: string; base: number; look: string }
  | { kind: "collection.delete"; collection: string; base: number };
export type CollectionAnswer = { ok: true; collection: string; revision: number; look?: LookRef } | { ok: false; code: Capability["code"]; reason: string };

/** A collection as readers see it: its working copy and the revision a command names as its `base`. */
export type CollectionView = CollectionWorking & { readonly revision: number; readonly pending: boolean; readonly conflict: OutboxEntry | null };
/** A look as readers see it. */
export type LookView = LookWorking & { readonly ref: LookRef; readonly revision: number; readonly pending: boolean; readonly conflict: OutboxEntry | null };
/** A removed look that can still be restored. */
export type RestorableLook = RemovedLook & { readonly name: string };
/** The collection and its live looks as the library holds them, in one read (§2.1). */
export type CollectionSnapshot = { readonly collection: CollectionWorking; readonly looks: readonly LookWorking[]; readonly revisions: Readonly<Record<string, number>> };
/** A named version Save version wrote: its revision in the released tables, and the working copies' revisions it was made from. */
export type SavedVersion = { readonly revision: number; readonly updatedAt: string; readonly documents: Readonly<Record<string, number>> };
/** The host's Save version (`/api/collection-versions`): a named version from its own snapshot of the working copies, in one transaction. */
export type CollectionVersionsPort = { save(collection: string, signal?: AbortSignal): Promise<SavedVersion> };

export type CollectionOwnerDeps = {
  readonly documents: Pick<DocumentStorePort, "list" | "read">;
  readonly outbox: DocumentOutbox;
  readonly versions?: CollectionVersionsPort;
  readonly newId?: () => string;
  readonly now?: () => number;
  readonly report?: (error: unknown) => void;
};

const NOT_FLUSHED = "Your latest changes are still on their way to the library. Try Save version again in a moment.";
const PURGED = "A look your version lists was deleted for good, so your version can't be kept as it is. Choose Use other window's or Keep both.";
const CANCELLED = "Cancelled. Your changes are still being saved.";
export const INCOMPLETE = "This collection lists a look that isn't there any more, so it can't be saved or exported as it is. Open it to see what's missing.";
/** The most looks a collection is made with in one command (each look is a document; one host transaction writes at most 64). */
export const MAX_LOOKS_AT_CREATE = COMMAND_LIMITS.writes - 1;
const IN_CONFLICT = "This collection changed in another window too. Choose which version to keep first.";
const NAME_REASON = "A name is 1 to 120 characters.";
const failed = (capability: Capability): CollectionAnswer => ({ ok: false, code: capability.code, reason: capability.reason ?? "That can't be done." });

export class CollectionOwner {
  private readonly collections = new Set<string>();
  private readonly looks = new Map<string, Set<string>>();
  private readonly listeners = new Set<(refs: readonly DocumentRef[]) => void>();
  /** The expiries this window recorded, with exactly what each wrote. */
  private readonly expiries = new Map<string, string>();

  constructor(private readonly deps: CollectionOwnerDeps) {
    deps.outbox.subscribe(event => {
      if (event.kind === "status") return;
      const refs = (event.kind === "external" || event.kind === "resolved" || event.kind === "recorded" ? event.refs : event.entry.writes)
        .filter(ref => ref.kind === COLLECTION_WORKING || ref.kind === LOOK_WORKING).map(ref => ({ kind: ref.kind, id: ref.id }));
      for (const ref of refs) this.know(ref);
      // A derived expiry that another window's change made stale is simply dropped (the next command, or load, does it again), but only
      // while it still holds exactly what the expiry wrote: an edit of the person's coalesced or folded into it makes it a real conflict.
      const expired = event.kind === "conflict" ? this.expiries.get(event.entry.id) : undefined;
      if (event.kind === "conflict" && expired === JSON.stringify(event.entry.writes.map(write => write.value)))
        queueMicrotask(() => { if (this.deps.outbox.conflicts().includes(event.entry)) try { this.deps.outbox.useTheirs(event.entry.id); } catch (error) { this.deps.report?.(error); } });
      if (event.kind === "acknowledged" || event.kind === "resolved") this.expiries.delete(event.entry.id);
      if (refs.length) this.changed(refs);
      // A collection taken from elsewhere may list looks this window has never read: they are read now.
      if (event.kind === "external" || event.kind === "resolved") void this.readMissing(refs.filter(ref => ref.kind === COLLECTION_WORKING).map(ref => ref.id));
    });
  }
  /** Reads (and holds) the looks `collections` list that this window holds nothing of. */
  private async readMissing(collections: readonly string[]): Promise<void> {
    const missing = collections.flatMap(id => (this.collection(id)?.looks ?? []).map(look => lookRef({ collection: id, look })))
      .filter(ref => !this.deps.outbox.document(ref));
    if (!missing.length) return;
    try {
      const read = await this.deps.documents.read(missing);
      for (const ref of missing) { this.deps.outbox.hold(ref, read[documentKey(ref)] ?? null); this.know(ref); }
      this.changed(missing);
    } catch (error) { this.deps.report?.(error); }
  }
  private know(ref: DocumentRef) {
    if (ref.kind === COLLECTION_WORKING) this.collections.add(ref.id);
    const look = ref.kind === LOOK_WORKING ? lookOfDocument(ref.id) : null;
    if (look) { const set = this.looks.get(look.collection) ?? new Set<string>(); set.add(look.look); this.looks.set(look.collection, set); }
  }
  private now() { return (this.deps.now ?? Date.now)(); }
  private newId() { return (this.deps.newId ?? (() => crypto.randomUUID()))(); }

  /** Read every collection and look working copy from the library, then expire removals older than 30 days nothing else will. */
  async load(signal?: AbortSignal): Promise<void> {
    const [collections, looks] = await Promise.all([this.deps.documents.list(COLLECTION_WORKING, signal), this.deps.documents.list(LOOK_WORKING, signal)]);
    for (const doc of [...collections, ...looks]) {
      const ref = { kind: doc.kind, id: doc.id };
      this.deps.outbox.hold(ref, { revision: doc.revision, value: doc.value });
      this.know(ref);
    }
    this.changed([]);
    this.expire();
  }
  /**
   * Records `collection.expire` for every collection holding a removal older than 30 days (its looks' tombstones with it), so a
   * collection nothing else changes still lets them go. `load` calls it; call it again once the outbox is open (and so writable).
   */
  expire(): void {
    if (this.deps.outbox.status().stopped) return;
    for (const id of this.collections) {
      const collection = this.collection(id);
      if (!collection || collection.conflict || !collection.removed.some(item => this.now() - item.at >= REMOVED_FOR_MS)) continue;
      const edits = this.edits(collection, {}, []);
      let entry: OutboxEntry;
      try { entry = this.record("collection.expire", edits); } catch { return; /* not writable here (yet): the holder expires it */ }
      // Coalesced into an unsent edit of the person's: not an expiry alone any more.
      if (entry.command === "collection.expire") this.expiries.set(entry.id, JSON.stringify(entry.writes.map(write => write.value)));
    }
  }
  /** Hear which collection and look documents changed (here, from elsewhere, or by a resolution). */
  subscribe(listener: (refs: readonly DocumentRef[]) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed(refs: readonly DocumentRef[]) { for (const listener of [...this.listeners]) { try { listener(refs); } catch (error) { this.deps.report?.(error); } } }

  // -------------------------------------------------------------------------------------------------------------
  // Reads

  /** Every live collection, in the order they were made. */
  list(): readonly CollectionView[] {
    return [...this.collections].flatMap(id => { const view = this.collection(id); return view ? [view] : []; }).sort((a, b) => a.createdAt - b.createdAt);
  }
  collection(id: string): CollectionView | null {
    const held = this.deps.outbox.document(collectionRef(id));
    const doc = held ? collectionWorkingOf(held.value) : null;
    return doc ? { ...doc, revision: held!.version, pending: held!.pending, conflict: held!.conflict } : null;
  }
  /** A look as this window holds it (live or removed), or null (none, or its tombstone). */
  look(ref: LookRef): LookView | null {
    const held = this.deps.outbox.document(lookRef(ref));
    const doc = held ? lookWorkingOf(held.value) : null;
    return doc ? { ...doc, ref: { collection: ref.collection, look: ref.look }, revision: held!.version, pending: held!.pending, conflict: held!.conflict } : null;
  }
  /** Owner-reported retention/recovery facts; reading this never selects or creates a look. */
  targetStatus(ref: LookRef): OwnerTargetStatus {
    const address = lookRef(ref), held = this.deps.outbox.document(address), look = this.look(ref), collection = this.collection(ref.collection);
    const common = { owner: address, revision: held?.version ?? 0, pending: held?.pending ?? false,
      conflict: !!held?.conflict || !!collection?.conflict, ...(look ? { label: look.name } : {}) };
    if (this.deps.outbox.recovering(address) || this.deps.outbox.recovering(collectionRef(ref.collection)))
      return { ...common, state: "pending", ...(look ? { content: look.state === "live" ? "present" as const : "removed" as const } : {}), reason: "This look is still being restored from your last session." };
    if (look?.state === "live" && collection?.looks.includes(ref.look)) return { ...common, state: "present" };
    if (look?.state === "removed" && this.restorable(ref.collection).some(item => item.look === ref.look))
      return { ...common, state: "removed", restore: this.capability({ kind: "collection.restoreLook", collection: ref.collection,
        base: collection!.revision, look: ref.look }) };
    return { ...common, state: held?.value === undefined || isTombstone(held.value) || look?.state === "removed" ? "purged" : "unavailable",
      reason: "That look is no longer available to edit or restore." };
  }
  /** A collection's live looks, in order. */
  looksOf(collection: string): readonly LookView[] {
    return (this.collection(collection)?.looks ?? []).flatMap(look => { const view = this.look({ collection, look }); return view?.state === "live" ? [view] : []; });
  }
  /** The looks removed from a collection that can still be restored, newest first. */
  restorable(collection: string): readonly RestorableLook[] {
    const view = this.collection(collection);
    if (!view) return [];
    return pruneRemoved(view.removed, this.now()).kept.flatMap(item => {
      const look = this.look({ collection, look: item.look });
      return look?.state === "removed" ? [{ ...item, name: look.name }] : [];
    }).reverse();
  }
  /** Every conflict on a collection or look document, oldest first. */
  conflicts(): readonly OutboxEntry[] {
    return this.deps.outbox.conflicts().filter(entry => entry.writes.some(write => write.kind === COLLECTION_WORKING || write.kind === LOOK_WORKING));
  }

  // -------------------------------------------------------------------------------------------------------------
  // Commands

  private target(id: string, base: number): CollectionView | Capability {
    const view = this.collection(id);
    if (!view) return refusal("missing_target", "That collection doesn't exist any more.");
    if (view.revision !== base) return refusal("stale", "That collection changed since it was read.");
    return view;
  }
  capability(command: CollectionCommand): Capability {
    if (command.kind === "collection.create") {
      if (!nameOf(command.name)) return refusal("invalid_value", NAME_REASON);
      if (command.id !== undefined && (typeof command.id !== "string" || !command.id || command.id.includes("/") || this.deps.outbox.document(collectionRef(command.id))?.value !== undefined))
        return refusal("invalid_value", "That collection already exists.");
      if ((command.looks ?? []).some(look => !nameOf(look.name))) return refusal("invalid_value", NAME_REASON);
      if ((command.looks ?? []).length > MAX_LOOKS_AT_CREATE)
        return refusal("limit", `A collection is made with up to ${MAX_LOOKS_AT_CREATE} looks at once. Add the rest to it afterwards.`);
      return { available: true };
    }
    const view = this.target(command.collection, command.base);
    if (!("id" in view)) return view;
    if (command.kind === "collection.restoreLook") {
      if (this.deps.outbox.status().stopped) return refusal("unavailable", "This workspace is read-only.");
      if (view.conflict || this.look({ collection: view.id, look: command.look })?.conflict) return refusal("stale", IN_CONFLICT);
      if (this.deps.outbox.recovering(collectionRef(view.id)) || this.deps.outbox.recovering(lookRef({ collection: view.id, look: command.look })))
        return refusal("unavailable", "This look is still being restored from your last session.");
    }
    switch (command.kind) {
      case "collection.rename": return nameOf(command.name) ? { available: true } : refusal("invalid_value", NAME_REASON);
      case "collection.plan": return { available: true };
      case "collection.reorder":
        return command.looks.length === view.looks.length && new Set(command.looks).size === view.looks.length && command.looks.every(id => view.looks.includes(id))
          ? { available: true } : refusal("invalid_value", "That isn't an order of this collection's looks.");
      case "collection.addLook":
        if (command.look && !nameOf(command.look.name)) return refusal("invalid_value", NAME_REASON);
        if (command.look?.id !== undefined && (!command.look.id || command.look.id.includes("/") || this.look({ collection: view.id, look: command.look.id })))
          return refusal("invalid_value", "That look already exists.");
        return { available: true };
      case "collection.copyLook": {
        const from = this.look(command.from);
        if (!from || from.state !== "live") return refusal("missing_target", "That look doesn't exist any more.");
        return command.name === undefined || nameOf(command.name) ? { available: true } : refusal("invalid_value", NAME_REASON);
      }
      case "collection.removeLook":
        return view.looks.includes(command.look) && this.look({ collection: view.id, look: command.look })?.state === "live"
          ? { available: true } : refusal("missing_target", "That look isn't in this collection.");
      case "collection.restoreLook":
        return this.restorable(view.id).some(item => item.look === command.look)
          ? { available: true } : refusal("missing_target", "That look can't be restored any more.");
      case "collection.delete": return { available: true };
    }
  }

  /**
   * The edits a command makes: the collection's next value (with its expired or pushed-out removals dropped, their looks' tombstones
   * written too), then each look it writes.
   */
  private edits(collection: CollectionWorking, change: Partial<CollectionWorking>, looks: readonly LookWorking[]): OutboxEdit[] {
    const now = this.now(), next = { ...stripView(collection), ...change } as CollectionWorking;
    const { kept, dropped } = pruneRemoved(next.removed, now);
    const edits: OutboxEdit[] = [{ ...collectionRef(collection.id), value: { ...next, removed: kept } }, ...looks.map(look => ({ ...lookRef({ collection: look.collection, look: look.id }), value: look }))];
    for (const look of dropped) {
      const held = this.look({ collection: collection.id, look });
      if (held && held.state === "removed" && !looks.some(item => item.id === look)) edits.push({ ...lookRef(held.ref), value: tombstoneOf(stripLook(held), now) });
    }
    return edits;
  }
  private record(command: string, edits: OutboxEdit[], options: { store?: "now" | "soon" } = {}): OutboxEntry {
    const entry = this.deps.outbox.commit(command, edits, options.store ? { store: options.store } : {});
    for (const edit of edits) this.know(edit);
    return entry;
  }
  private newLook(collection: string, input: LookInput): LookWorking {
    return { schema: LOOK_WORKING_SCHEMA, collection, id: input.id ?? this.newId(), name: nameOf(input.name)!, parts: structuredClone(input.parts ?? {}),
      ...(input.memory !== undefined ? { memory: structuredClone(input.memory) } : {}), state: "live" };
  }

  /**
   * Apply one command: recorded in the outbox at once (one entry, one host transaction), checked against the revision it read. `also`:
   * another owner's edits that belong to the same command (a profile listing the collection made), written in the same transaction.
   */
  dispatch(command: CollectionCommand, options: { also?: (collection: string) => readonly OutboxEdit[] } = {}): CollectionAnswer {
    const allowed = this.capability(command);
    if (!allowed.available) return failed(allowed);
    let edits: OutboxEdit[], id: string, look: LookRef | undefined;
    if (command.kind === "collection.create") {
      id = command.id ?? this.newId();
      const looks = (command.looks ?? []).map(input => this.newLook(id, input));
      const doc: CollectionWorking = { schema: COLLECTION_WORKING_SCHEMA, id, name: nameOf(command.name)!, looks: looks.map(item => item.id), removed: [],
        ...(command.packagePlan !== undefined ? { packagePlan: structuredClone(command.packagePlan) } : {}),
        ...(command.saved ? { saved: { revision: command.saved.revision } } : {}), createdAt: this.now() };
      edits = [{ ...collectionRef(id), value: doc }, ...looks.map(item => ({ ...lookRef({ collection: id, look: item.id }), value: item }))];
    } else {
      const view = this.collection(command.collection)!;
      id = view.id;
      switch (command.kind) {
        case "collection.rename": edits = this.edits(view, { name: nameOf(command.name)! }, []); break;
        case "collection.plan": {
          const { packagePlan: _plan, ...rest } = stripView(view);
          edits = this.edits(rest as CollectionWorking, command.packagePlan === undefined ? {} : { packagePlan: structuredClone(command.packagePlan) }, []);
          break;
        }
        case "collection.reorder": edits = this.edits(view, { looks: [...command.looks] }, []); break;
        case "collection.addLook": {
          const made = this.newLook(id, command.look ?? { name: "Look" });
          const at = Math.max(0, Math.min(view.looks.length, command.at ?? view.looks.length));
          edits = this.edits(view, { looks: [...view.looks.slice(0, at), made.id, ...view.looks.slice(at)] }, [made]);
          look = { collection: id, look: made.id };
          break;
        }
        case "collection.copyLook": {
          const from = this.look(command.from)!;
          const made = this.newLook(id, { name: command.name ?? suffixed(from.name, "(copy)"), parts: from.parts, memory: from.memory });
          const at = from.collection === id ? view.looks.indexOf(from.id) + 1 : view.looks.length;
          edits = this.edits(view, { looks: [...view.looks.slice(0, at), made.id, ...view.looks.slice(at)] }, [made]);
          look = { collection: id, look: made.id };
          break;
        }
        case "collection.removeLook": {
          const held = this.look({ collection: id, look: command.look })!;
          edits = this.edits(view, { looks: view.looks.filter(item => item !== command.look),
            removed: [...view.removed, { look: command.look, at: this.now(), index: view.looks.indexOf(command.look) }] },
            [{ ...stripLook(held), state: "removed" }]);
          look = held.ref;
          break;
        }
        case "collection.restoreLook": {
          // Back where it stood when it was removed (at the end when that isn't known).
          const held = this.look({ collection: id, look: command.look })!, index = view.removed.find(item => item.look === command.look)?.index;
          const at = Math.min(index ?? view.looks.length, view.looks.length);
          edits = this.edits(view, { looks: [...view.looks.slice(0, at), command.look, ...view.looks.slice(at)], removed: view.removed.filter(item => item.look !== command.look) },
            [{ ...stripLook(held), state: "live" }]);
          look = held.ref;
          break;
        }
        case "collection.delete":
          edits = [{ ...collectionRef(id), value: tombstoneOf(stripView(view), this.now()) }];
          break;
      }
    }
    if (options.also) edits = [...edits, ...options.also(id)];
    try { this.record(command.kind, edits); }
    catch (error) { return failed(refusal(error instanceof OutboxTooLargeError ? "limit" : error instanceof OutboxRecoveringError ? "not_ready" : "unavailable", (error as Error).message)); }
    return { ok: true, collection: id, revision: this.deps.outbox.document(collectionRef(id))!.version, ...(look ? { look } : {}) };
  }

  /** `look.update`: a look's own change (its parts, memory or name), one document, coalescing with the look's other unsent edits. */
  updateLook(ref: LookRef, change: { readonly name?: string; readonly parts?: Readonly<Record<string, unknown>>; readonly memory?: unknown },
    options: { store?: "now" | "soon" } = {}): { ok: true; entry: OutboxEntry } | { ok: false; code: Capability["code"]; reason: string } {
    const held = this.look(ref);
    if (!held) return { ok: false, code: "missing_target", reason: "That look doesn't exist any more." };
    if (held.state !== "live") return { ok: false, code: "unavailable", reason: "That look was removed. Restore it to edit it." };
    if (change.name !== undefined && !nameOf(change.name)) return { ok: false, code: "invalid_value", reason: NAME_REASON };
    const next: LookWorking = { ...stripLook(held), ...(change.name !== undefined ? { name: nameOf(change.name)! } : {}),
      ...(change.parts !== undefined ? { parts: change.parts } : {}), ...(change.memory !== undefined ? { memory: change.memory } : {}) };
    try { return { ok: true, entry: this.record("look.update", [{ ...lookRef(ref), value: next }], options) }; }
    catch (error) { return { ok: false, code: error instanceof OutboxRecoveringError ? "not_ready" : "unavailable", reason: (error as Error).message }; }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Conflicts

  /**
   * Resolve a conflict on collection or look documents, in one outbox write. `theirs` keeps mine as a fork when mine has a live look
   * (as `both` does); `both` needs one. A fork is added to its collection as the library holds it now: a revision check first takes any
   * newer revision of a collection this window holds no change of (were it older, the fork would only go stale against it).
   */
  async resolve(conflictId: string, keep: "mine" | "theirs" | "both", current?: () => Capability): Promise<Capability> {
    const allowed = current?.(); if (allowed && !allowed.available) return allowed;
    const find = () => this.conflicts().find(entry => entry.id === conflictId);
    const conflict = find();
    if (!conflict) return refusal("invalid_value", "That was already resolved.");
    const forks = conflict.writes.some(write => write.kind === LOOK_WORKING && lookWorkingOf(write.value)?.state === "live");
    const collections = conflict.writes.some(write => write.kind === COLLECTION_WORKING);
    if (keep === "both" && !forks) return refusal("invalid_value", "There's no look of yours to keep beside theirs.");
    // Each resolution that makes membership (forks, or mine's collection over theirs) reads the looks as the library holds them now.
    if ((keep !== "mine" && forks) || (keep === "mine" && collections)) {
      try { await this.deps.outbox.check(); } catch (error) { this.deps.report?.(error); }
      if (!find()) return refusal("invalid_value", "That was already resolved.");
    }
    // Keep mine over a collection reads every look it would list or remove, as the library holds them now (missing ones too).
    let read: Readonly<Record<string, CurrentDocument>> = {};
    if (keep === "mine" && collections) {
      const refs = new Map<string, DocumentRef>();
      for (const write of conflict.writes) {
        if (write.kind !== COLLECTION_WORKING) continue;
        const ids = [collectionWorkingOf(write.value), collectionWorkingOf(conflict.current?.[documentKey(write)]?.value)]
          .flatMap(doc => doc ? [...doc.looks, ...doc.removed.map(item => item.look)] : []);
        for (const look of ids) { const ref = lookRef({ collection: write.id, look }); refs.set(documentKey(ref), ref); }
      }
      try { read = refs.size ? await this.deps.documents.read([...refs.values()]) : {}; }
      catch (error) { return refusal("unavailable", (error as Error).message || "The library can't be read right now. Try again in a moment."); }
      if (!find()) return refusal("invalid_value", "That was already resolved.");
    }
    try {
      const allowed = current?.(); if (allowed && !allowed.available) return allowed;
      if (keep === "mine") this.deps.outbox.keepMine(conflict.id, collections ? mine => this.wholeMine(mine, conflict, read) : undefined);
      else if (!forks) this.deps.outbox.useTheirs(conflict.id);
      else this.deps.outbox.keepBoth(conflict.id, mine => this.forkOf(mine));
    } catch (error) { return refusal("unavailable", (error as Error).message); }
    return { available: true };
  }
  /**
   * Keep mine over a collection, made whole in the same command (finding 2 of the 1c-ii review): every look mine's collection lists is
   * live, and every look its removed list names is removed, writing whichever look states another window changed. A look theirs added
   * that mine neither lists nor removed stays listed; a listed look nothing is left of (purged) leaves the list, as does a removed one.
   */
  private wholeMine(mine: readonly OutboxEdit[], conflict: OutboxEntry, read: Readonly<Record<string, CurrentDocument>>): (OutboxEdit & { base?: number })[] {
    const edits: (OutboxEdit & { base?: number })[] = mine.map(edit => ({ ...edit }));
    const mineOf = (ref: { kind: string; id: string }) => mine.find(edit => documentKey(edit) === documentKey(ref));
    const lookOf = (value: unknown): LookWorking | null => lookWorkingOf(isTombstone(value) ? (value as { value: unknown }).value : value);
    const set = (ref: { kind: string; id: string }, value: unknown, base?: number) => {
      const at = edits.findIndex(edit => documentKey(edit) === documentKey(ref));
      if (at >= 0) edits[at] = { ...edits[at]!, value }; else edits.push({ ...ref, value, ...(base !== undefined ? { base } : {}) });
    };
    for (const edit of mine) {
      const collection = edit.kind === COLLECTION_WORKING ? collectionWorkingOf(edit.value) : null;
      if (!collection) continue;
      const theirs = collectionWorkingOf(conflict.current?.[documentKey(edit)]?.value);
      const looks = [...collection.looks], removed = [...collection.removed];
      for (const id of theirs?.looks ?? []) if (!looks.includes(id) && !removed.some(item => item.look === id)) looks.push(id);
      const keep = (id: string, state: "live" | "removed"): boolean => {
        const ref = lookRef({ collection: collection.id, look: id }), own = mineOf(ref);
        // Mine writes it itself: its value, in the state the list needs.
        if (own) { const look = lookOf(own.value); if (!look) return false; if (look.state !== state || isTombstone(own.value)) set(ref, { ...look, state }); return true; }
        // A look this window is still changing keeps its own entries (it is live here).
        if (this.deps.outbox.document(ref)?.pending) return true;
        // Otherwise as the library holds it now (read just before), whatever this page last saw of it.
        const stored = read[documentKey(ref)];
        if (stored) {
          const look = lookOf(stored.value);
          if (!look) { if (state === "removed") return false; throw Error(PURGED); }
          if (isTombstone(stored.value) || look.state !== state) set(ref, { ...look, state }, stored.revision);
          return true;
        }
        // Gone from the library (purged): the content this page still holds is written back, or a listed look can't be kept.
        const held = lookOf(this.deps.outbox.document(ref)?.value);
        if (!held) { if (state === "removed") return false; throw Error(PURGED); }
        set(ref, { ...held, state }, 0);
        return true;
      };
      set(edit, { ...collection, looks: looks.filter(id => keep(id, "live")), removed: removed.filter(item => keep(item.look, "removed")) });
    }
    return edits;
  }
  /**
   * Keep both: each live look of mine as a new look named "(this window)", added to its collection as the collection is now (theirs,
   * with this window's later changes on top: the outbox has taken theirs before calling this), right after the original.
   */
  private forkOf(mine: readonly OutboxEdit[]): OutboxEdit[] {
    const forks = new Map<string, { original: string; copy: LookWorking }[]>();
    for (const edit of mine) {
      const look = edit.kind === LOOK_WORKING ? lookWorkingOf(edit.value) : null;
      if (!look || look.state !== "live") continue;
      forks.set(look.collection, [...forks.get(look.collection) ?? [], { original: look.id, copy: { ...look, id: this.newId(), name: suffixed(look.name, "(this window)") } }]);
    }
    const edits: OutboxEdit[] = [];
    for (const [collection, copies] of forks) {
      const view = this.collection(collection);
      if (!view) throw Error("That collection was deleted in another window, so there's nowhere to keep your version. Restore the collection first.");
      let order = [...view.looks];
      for (const { original, copy } of copies) {
        const at = order.indexOf(original);
        order = at < 0 ? [...order, copy.id] : [...order.slice(0, at + 1), copy.id, ...order.slice(at + 1)];
      }
      edits.push({ ...collectionRef(collection), value: { ...stripView(view), looks: order } });
      for (const { copy } of copies) edits.push({ ...lookRef({ collection, look: copy.id }), value: copy });
    }
    return edits;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Snapshots and Save version

  /** The collection's documents (the collection and its live looks). */
  private refsOf(collection: string): DocumentRef[] {
    return [collectionRef(collection), ...(this.collection(collection)?.looks ?? []).map(look => lookRef({ collection, look }))];
  }
  /** Flushes the collection's entries: a refusal when they couldn't all reach the library, or one is a conflict. */
  private async flushed(collection: string, signal?: AbortSignal): Promise<Capability> {
    if (!this.collection(collection)) return refusal("missing_target", "That collection doesn't exist any more.");
    const refs = this.refsOf(collection);
    if (refs.some(ref => this.deps.outbox.document(ref)?.conflict)) return refusal("stale", IN_CONFLICT);
    // `signal` ends only the wait: the changes are still sent.
    if (!await this.deps.outbox.settle(refs, signal)) return signal?.aborted ? refusal("not_ready", CANCELLED) : refusal("unavailable", NOT_FLUSHED);
    if (this.refsOf(collection).some(ref => this.deps.outbox.document(ref)?.conflict)) return refusal("stale", IN_CONFLICT);
    return { available: true };
  }
  /**
   * The collection and its live looks as the library holds them, in one read transaction, after this window's changes to them have
   * reached it (export records its revisions). A look order another window changed between the flush and the read is read again.
   */
  async snapshot(collection: string, signal?: AbortSignal): Promise<CollectionSnapshot | Capability> {
    const ready = await this.flushed(collection, signal);
    if (!ready.available) return ready;
    let refs = this.refsOf(collection);
    for (let attempt = 0; attempt < 3; attempt++) {
      const read = await this.deps.documents.read(refs, signal);
      const doc = collectionWorkingOf(read[documentKey(refs[0]!)]?.value);
      if (!doc) return refusal("missing_target", "That collection doesn't exist any more.");
      const wanted = doc.looks.map(look => lookRef({ collection, look }));
      if (wanted.every(ref => documentKey(ref) in read)) {
        const looks = wanted.flatMap(ref => { const look = lookWorkingOf(read[documentKey(ref)]?.value); return look?.state === "live" ? [look] : []; });
        // Never a snapshot with a listed look left out: the collection names a look that isn't there (or isn't live).
        if (looks.length !== wanted.length) return refusal("invalid_value", INCOMPLETE);
        return { collection: doc, looks, revisions: Object.fromEntries([refs[0]!, ...wanted].map(ref => [documentKey(ref), read[documentKey(ref)]?.revision ?? 0])) };
      }
      refs = [refs[0]!, ...wanted];
    }
    return refusal("stale", "This collection keeps changing in another window. Try again in a moment.");
  }
  /**
   * This window's own copy of a collection, as it shows it now: the library's acknowledged values with every change still waiting here on
   * top (the documents' visible values), and nothing read or written. The recovery export (style guide t-read-only-window, t-recovering):
   * it works when the library can't take this window's changes, which is exactly when a snapshot can't be made. `revisions` are the
   * acknowledged revisions the copy builds on.
   */
  windowCopy(collection: string): CollectionSnapshot | Capability {
    const doc = this.collection(collection);
    if (!doc) return refusal("missing_target", "That collection doesn't exist any more.");
    const looks = doc.looks.map(look => this.look({ collection, look }));
    // Never a copy with a listed look left out (as a snapshot): a listed look this window doesn't hold live can't be exported as it shows.
    if (looks.some(look => look?.state !== "live")) return refusal("invalid_value", INCOMPLETE);
    const refs = this.refsOf(collection);
    return { collection: stripView(doc), looks: looks.map(look => stripLook(look!)),
      revisions: Object.fromEntries(refs.map(ref => [documentKey(ref), this.deps.outbox.document(ref)?.version ?? 0])) };
  }
  /**
   * Save version (Ctrl+S): flush, then the host writes a named version older builds read (the released tables) from its own snapshot of
   * the working copies, in one transaction; the collection then records which version it was saved as.
   */
  async saveVersion(collection: string, signal?: AbortSignal): Promise<{ ok: true; version: SavedVersion } | { ok: false; code: Capability["code"]; reason: string }> {
    if (!this.deps.versions) return { ok: false, code: "unavailable", reason: "Saving versions isn't available here." };
    const ready = await this.flushed(collection, signal);
    if (!ready.available) return { ok: false, code: ready.code, reason: ready.reason ?? NOT_FLUSHED };
    let version: SavedVersion;
    try { version = await this.deps.versions.save(collection, signal); }
    catch (error) { return { ok: false, code: "unavailable", reason: (error as Error).message }; }
    const view = this.collection(collection);
    if (view && view.saved?.revision !== version.revision) {
      try { this.record("collection.saved", [{ ...collectionRef(collection), value: { ...stripView(view), saved: { revision: version.revision } } }]); }
      catch (error) { this.deps.report?.(error); }
    }
    return { ok: true, version };
  }
}

/** A view's document fields only. */
function stripView(view: CollectionWorking): CollectionWorking {
  const { revision: _r, pending: _p, conflict: _c, ...doc } = view as CollectionView;
  return doc as CollectionWorking;
}
function stripLook(view: LookWorking): LookWorking {
  const { revision: _r, pending: _p, conflict: _c, ref: _ref, ...doc } = view as LookView;
  return doc as LookWorking;
}

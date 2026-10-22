/**
 * Stored documents as the page holds them (`SavedDocument`), over the outbox (`document-outbox.ts`), the one way any document's local
 * state reaches the library (profiles design §2.2). A document's value is the outbox's view of it: its acknowledged value with this
 * page's entries on top. `save` records the new value in the outbox at once (an edit coalesces with others the rules allow) and
 * resolves once the library holds it, or a newer value of it. A save that goes stale waits while it is a conflict: Keep mine sends it
 * again and it resolves then; Use theirs or Keep both reject it (this document took the other page's value). Every save hears an outcome
 * (`DocumentOutbox.settled`).
 *
 * Use one owner set per page (`documentOwners`): it hands out one holder per document, so an experiment turned off and on again edits the
 * same holder rather than a second copy read back from the store.
 */
import type { SavedDocument, StoredDocument } from "../api/document-store";
import { documentKey, type DocumentRef } from "../api/document-commands";
import type { DocumentOutbox, OutboxEntry } from "./document-outbox";

const CHANGED_ELSEWHERE = "This changed elsewhere too, and the version from elsewhere was kept.";
const NOT_HERE = "This workspace is now open elsewhere, so this change wasn't saved here.";

/** The page's one holder per stored document, over `outbox`. */
export function documentOwners(outbox: DocumentOutbox) {
  type Holder = SavedDocument<unknown> & { readonly ref: DocumentRef; fresh: boolean; initial: unknown };
  const owners = new Map<string, Holder>();
  const make = (ref: DocumentRef, initial: unknown, fresh: boolean): Holder => ({
    ref, kind: ref.kind, id: ref.id, fresh, initial,
    get value() { const doc = outbox.document(ref); return doc && doc.value !== undefined ? doc.value : this.initial; },
    save(value: unknown) {
      let entry: OutboxEntry;
      try { entry = outbox.commit("document.save", [{ ...ref, value }]); }
      catch (error) { return Promise.reject(error); }
      this.fresh = false;
      // The outbox carries this caller with the value (coalesced, folded into a conflict, replaced by Keep mine) until it has an outcome.
      return outbox.settled(entry.id).then(outcome => {
        if (outcome === "dropped") throw new Error(CHANGED_ELSEWHERE);
        if (outcome === "stopped") throw new Error(NOT_HERE);
      });
    },
  });
  return {
    /**
     * The document's holder; `initial` and `stored` make it when the page doesn't hold it yet (a document the library doesn't have starts
     * at `initial`, recorded only when it is first saved or settled). A held document with nothing unsent takes a newer `stored` revision.
     */
    open<T>(kind: string, id: string, initial: T, stored?: StoredDocument<T>): SavedDocument<T> {
      const ref = { kind, id }, key = documentKey(ref);
      outbox.hold(ref, stored ? { revision: stored.revision, value: stored.value } : null);
      let owner = owners.get(key);
      if (!owner) owners.set(key, owner = make(ref, initial, !stored && outbox.document(ref)?.value === undefined));
      return owner as SavedDocument<T>;
    },
    /** True once the library holds every document this page holds (a new one is recorded first); false when that can't be confirmed now. */
    async settle(): Promise<boolean> {
      for (const owner of owners.values()) if (owner.fresh) { owner.save(owner.initial).catch(() => {}); }
      const refs = [...owners.values()].map(owner => owner.ref);
      return await outbox.settle(refs) && refs.every(ref => !outbox.document(ref)?.conflict);
    },
    /** The holders of every document of `kind` the page holds, in the order it first held them. */
    held<T>(kind: string): SavedDocument<T>[] { return [...owners.values()].filter(owner => owner.kind === kind) as SavedDocument<T>[]; },
  };
}

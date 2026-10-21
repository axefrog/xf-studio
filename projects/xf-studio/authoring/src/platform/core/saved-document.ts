import type { DocumentStorePort, SavedDocument, StoredDocument } from "../api/document-store";

/** The saves waiting for one write: the newest value, and everyone whose value that write covers. */
type Batch<T> = { value: T; waiters: { resolve(): void; reject(error: unknown): void }[] };

/**
 * One stored document as this page holds it (`SavedDocument`): its value changes at once (the person's edit shows
 * immediately) and is saved in the background, one write at a time. Saves made while a write is out are coalesced into
 * the next write, which carries the newest value; every save it covers resolves or rejects with that write's outcome.
 * When the document changed elsewhere since this page read it, the newest edit made here wins: the write is retried
 * once over the current revision. `stored` is the document as last read, if it exists; otherwise it starts at
 * `initial`, unsaved.
 *
 * Use one per document for the page's lifetime (`documentOwners`): two holders of the same document would each queue
 * writes over the other's.
 */
export function savedDocument<T>(store: DocumentStorePort, kind: string, id: string, initial: T, stored?: StoredDocument<T>): SavedDocument<T> {
  let current = stored ? stored.value : initial;
  let revision = stored?.revision ?? 0;
  let waiting: Batch<T> | null = null, writing = false;
  const write = async (value: T): Promise<void> => {
    let result = await store.put(kind, id, value, revision);
    if (!result.ok) result = await store.put(kind, id, value, result.current?.revision ?? 0);
    if (!result.ok) throw new Error("The document changed elsewhere while it was being saved.");
    revision = result.document.revision;
  };
  const next = () => {
    if (writing || !waiting) return;
    const batch = waiting;
    waiting = null; writing = true;
    write(batch.value).then(() => { for (const waiter of batch.waiters) waiter.resolve(); },
      error => { for (const waiter of batch.waiters) waiter.reject(error); })
      .finally(() => { writing = false; next(); });
  };
  return {
    kind, id,
    get value() { return current; },
    save(value) {
      current = value;
      const batch = waiting ??= { value, waiters: [] };
      batch.value = value;
      const saved = new Promise<void>((resolve, reject) => { batch.waiters.push({ resolve, reject }); });
      // Writes start on a later turn, so saves made together go in one write.
      queueMicrotask(next);
      return saved;
    },
  };
}

/**
 * The page's one owner per stored document (the one-owner rule): `open` answers the document's holder, making it only
 * the first time, so an experiment turned off and on again edits the same holder, with its unsaved value and its
 * queue, rather than a second copy read back from the store.
 */
export function documentOwners(store: DocumentStorePort) {
  const owners = new Map<string, SavedDocument<unknown>>();
  const key = (kind: string, id: string) => `${kind}\u0000${id}`;
  return {
    /** The document's holder; `initial` and `stored` are used only when the page doesn't hold it yet. */
    open<T>(kind: string, id: string, initial: T, stored?: StoredDocument<T>): SavedDocument<T> {
      let owner = owners.get(key(kind, id));
      if (!owner) owners.set(key(kind, id), owner = savedDocument<unknown>(store, kind, id, initial, stored));
      return owner as SavedDocument<T>;
    },
    /** The holders of every document of `kind` the page holds, in the order it first held them. */
    held<T>(kind: string): SavedDocument<T>[] { return [...owners.values()].filter(owner => owner.kind === kind) as SavedDocument<T>[]; },
  };
}

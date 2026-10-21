import type { DocumentStorePort, SavedDocument, StoredDocument } from "../api/document-store";

/**
 * One stored document as this page holds it (`SavedDocument`): its value changes at once (the person's edit shows
 * immediately) and is saved in the background, one write at a time. Saves made while a write is out are coalesced, so
 * the store receives the newest value next. When the document changed elsewhere since this page read it, the newest
 * edit made here wins: the write is retried once over the current revision. `stored` is the document as last read, if
 * it exists; otherwise it starts at `initial`, unsaved.
 */
export function savedDocument<T>(store: DocumentStorePort, kind: string, id: string, initial: T, stored?: StoredDocument<T>): SavedDocument<T> {
  let current = stored ? stored.value : initial;
  let revision = stored?.revision ?? 0;
  /** The value still to write, if no write has sent it yet. */
  let unsent: { value: T } | null = null;
  let queue: Promise<void> = Promise.resolve();
  const write = async (): Promise<void> => {
    const sending = unsent;
    if (!sending) return;   // a write queued before it already sent the newest value
    unsent = null;
    let result = await store.put(kind, id, sending.value, revision);
    if (!result.ok) result = await store.put(kind, id, sending.value, result.current?.revision ?? 0);
    if (!result.ok) throw new Error("The document changed elsewhere while it was being saved.");
    revision = result.document.revision;
  };
  return {
    kind, id,
    get value() { return current; },
    save(value) {
      current = value;
      unsent = { value };
      const written = queue.then(write);
      queue = written.catch(() => {});
      return written;
    },
  };
}

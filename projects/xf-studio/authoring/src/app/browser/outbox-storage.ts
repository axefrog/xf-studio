/**
 * Where the page keeps its outbox (profiles design §2.2), one key per document: `xfs.outbox.<workspace>.<kind>/<id>`, keyed by the
 * workspace's identity (§2.3) so two workspaces in one browser never share entries.
 *
 * - **Localhost:** `localStorage`, written synchronously. It lives in the browser process, so a renderer crash keeps every write.
 * - **Desktop:** the same synchronous write to the WebView's storage (under this launch's ID: `xfs.outbox.<workspace>~<launch>.`), and the
 *   same key sent in the background to the host, which keeps it beside the workspace file (`desktop/outbox-store.ts`): the WebView's
 *   storage origin changes with the loopback port on every launch, so the host's copy is the one a later launch reads. Each key's host writes go one at a time, newest last, fenced by the workspace
 *   lease; a host write that fails makes that document unprotected until a later one lands. Of the two copies, the newer one is read.
 */
import type { OutboxStorage } from "../../platform/core/document-outbox";

type KeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
export const outboxPrefix = (workspace: string) => `xfs.outbox.${workspace}.`;

/** The browser's storage for one workspace's outbox. */
export function localOutboxStorage(storage: KeyStorage, workspace: string): OutboxStorage {
  const prefix = outboxPrefix(workspace);
  return {
    load() {
      const keys = new Map<string, string>();
      for (let i = 0; i < storage.length; i++) {
        const name = storage.key(i);
        if (!name?.startsWith(prefix)) continue;
        const text = storage.getItem(name);
        if (text !== null) keys.set(name.slice(prefix.length), text);
      }
      return keys;
    },
    write(key, text, empty) {
      if (empty) storage.removeItem(prefix + key);
      else storage.setItem(prefix + key, text);
    },
  };
}

/** A record with no entries and no markers (a record holding only markers isn't empty: they must reach the host). */
const isEmpty = (text: string) => { try { const record = JSON.parse(text) as { entries?: unknown[]; dropped?: unknown[]; retained?: unknown };
  return !record.entries?.length && !record.dropped?.length && record.retained === undefined; } catch { return false; } };
const stampOf = (text: string) => { try { return Number((JSON.parse(text) as { stamp?: unknown }).stamp) || 0; } catch { return -1; } };

/**
 * The desktop page's outbox storage: the WebView's storage plus the host's copy (`host`, read at start), and `post`, which sends one
 * key's text to the host (rejecting when it wasn't stored). `settle` resolves once every key's latest text is stored on the host, sending
 * again any whose last write failed: false when one still can't be (the workspace release and the close flush wait on it).
 */
export function desktopOutboxStorage(local: KeyStorage, workspace: string, launch: string, host: Readonly<Record<string, string>>,
  post: (key: string, text: string | null) => Promise<void>): OutboxStorage & { settle(): Promise<boolean> } {
  // The synchronous copy is this launch's only: a later launch that gets the same port (and so the same storage) never reads it.
  const family = `xfs.outbox.${workspace}~`;
  for (let i = local.length - 1; i >= 0; i--) {
    const name = local.key(i);
    if (name?.startsWith(family) && !name.startsWith(`${family}${launch}.`)) local.removeItem(name);
  }
  const browser = localOutboxStorage(local, `${workspace}~${launch}`);
  const writers = new Map<string, { latest: string | null; pending: boolean; running: Promise<void> | null; failed: boolean }>();
  let listener: ((key: string, state: "pending" | "stored" | "failed", error?: unknown) => void) | null = null;
  const queue = (key: string, sent: string | null) => {
    let writer = writers.get(key);
    if (!writer) writers.set(key, writer = { latest: sent, pending: false, running: null, failed: false });
    writer.latest = sent; writer.pending = true;
    // Queued for the host: not protected until it lands.
    listener?.(key, "pending");
    void send(key);
  };
  const send = (key: string) => {
    const writer = writers.get(key)!;
    if (writer.running) return writer.running;
    writer.running = (async () => {
      while (writer.pending) {
        writer.pending = false;
        const text = writer.latest;
        try {
          await post(key, text); writer.failed = false;
          if (!writer.pending) listener?.(key, "stored");
        } catch (error) { writer.failed = true; listener?.(key, "failed", error); }
      }
      writer.running = null;
    })();
    return writer.running;
  };
  return {
    load() {
      const keys = new Map(browser.load()), newer: string[] = [];
      for (const key of keys.keys()) if (!(key in host) || stampOf(keys.get(key)!) > stampOf(host[key]!)) newer.push(key);
      for (const [key, text] of Object.entries(host)) {
        const mine = keys.get(key);
        if (mine === undefined || stampOf(text) > stampOf(mine)) keys.set(key, text);
      }
      // This launch's copy is newer than the host's (the page reloaded before a host write landed): the host is given it now, and until
      // it lands the key isn't protected and a settle waits for it.
      for (const key of newer) {
        const text = keys.get(key)!, empty = isEmpty(text);
        if (empty && !(key in host)) continue;
        queue(key, empty ? null : text);
      }
      return keys;
    },
    write(key, text, empty) {
      queue(key, empty ? null : text);
      // The synchronous copy: a renderer crash in this launch keeps it. An emptied key keeps its (newer) empty text here, so a host copy
      // whose removal hadn't landed yet is never read back over it.
      try { browser.write(key, text, false); }
      catch (error) {
        // An older copy left here would be read back over the host's newer one at the next load: it goes, and the key is unprotected
        // (as the error says) until its host write lands.
        try { local.removeItem(`${family}${launch}.${key}`); } catch { /* Nothing more can be done here. */ }
        throw error;
      }
    },
    watch(next) { listener = next; },
    durable: () => new Map(Object.entries(host)),
    async settle() {
      for (const [key, writer] of writers) {
        while (writer.running) await writer.running;
        if (writer.failed) { writer.pending = true; await send(key); }
      }
      return [...writers.values()].every(writer => !writer.failed && !writer.pending && !writer.running);
    },
  };
}

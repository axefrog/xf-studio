/**
 * A browser's `localStorage` as the outbox harness's renderer processes see it: synchronous, and kept by something that outlives the
 * renderer (the browser process, or the WebView's). Here it is a file written beside its name and renamed into place on every change, so
 * a renderer killed at any point leaves the last change or the one before, never half of one.
 */
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export type KeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export function fileStorage(path: string, options: { fail?: () => boolean } = {}): KeyStorage & { items: Map<string, string> } {
  const items = new Map<string, string>(existsSync(path) ? Object.entries(JSON.parse(readFileSync(path, "utf8")) as Record<string, string>) : []);
  const save = () => {
    writeFileSync(`${path}.tmp`, JSON.stringify(Object.fromEntries(items)));
    renameSync(`${path}.tmp`, path);
  };
  return {
    items,
    get length() { return items.size; },
    key: index => [...items.keys()][index] ?? null,
    getItem: key => items.get(key) ?? null,
    setItem(key, value) {
      if (options.fail?.()) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      items.set(key, String(value)); save();
    },
    removeItem(key) { if (items.delete(key)) save(); },
  };
}

/**
 * Every outbox write in a storage file (its keys under `localPrefix`: a desktop page reads only its own launch's) and a desktop host's
 * outbox folder, for the presence check.
 */
export function readOutboxes(storagePath: string, localPrefix = "xfs.outbox.", hostFolder?: string): { kind: string; id: string; seqs?: Record<string, number> }[] {
  const writes: { kind: string; id: string; seqs?: Record<string, number> }[] = [];
  const take = (text: string) => {
    try {
      for (const entry of (JSON.parse(text) as { entries?: { writes: { kind: string; id: string; value?: { seqs?: Record<string, number> } }[] }[] }).entries ?? [])
        for (const write of entry.writes) writes.push({ kind: write.kind, id: write.id, seqs: write.value?.seqs });
    } catch { /* Not an outbox record. */ }
  };
  if (existsSync(storagePath)) for (const [key, text] of Object.entries(JSON.parse(readFileSync(storagePath, "utf8")) as Record<string, string>))
    if (key.startsWith(localPrefix)) take(text);
  if (hostFolder && existsSync(hostFolder)) {
    for (const name of readdirSync(hostFolder)) if (name.endsWith(".json")) take(readFileSync(`${hostFolder}/${name}`, "utf8"));
  }
  return writes;
}

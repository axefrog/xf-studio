/**
 * Owner commands over the document store as it is today (`platform/api/document-commands.ts`): phase 1b's path, until the host's
 * `transact`, its receipts and the outbox (phase 1c) take over behind the same port.
 *
 * - **Writes run in order, one document at a time.** This is not yet one transaction: a command refused part-way leaves its earlier
 *   writes in place. Owners therefore order a command's writes so a partial one leaves only what the retention rules allow (§1.4): a
 *   decoded save before the character naming it, a character before the profile listing it, so the worst case is an orphan.
 * - **Receipts for this session.** An answered command ID is answered again from memory and never applied twice; a command still in
 *   flight is joined. `forget` drops earlier receipts. Host receipts that survive a restart come with `transact`.
 * - **Equal-value fallback (A5).** A write whose base no longer matches, but whose target already holds exactly the value written, is
 *   acknowledged at the current revision (a content-addressed decoded save written elsewhere, a lost answer replayed).
 * - **Tombstones** are written as the next revision, `{ tombstone, at, value }`, and read back as `deleted`.
 */
import type { DocumentStorePort } from "../api/document-store";
import { type CommandAnswer, commandKey, type DocumentCommand, type DocumentCommandPort, type HeldDocument, isTombstone } from "../api/document-commands";

export type StoreCommandsOptions = { readonly now?: () => number };

export function storeCommands(store: DocumentStorePort, options: StoreCommandsOptions = {}): DocumentCommandPort {
  const now = options.now ?? Date.now;
  const receipts = new Map<string, CommandAnswer>(), running = new Map<string, Promise<CommandAnswer>>();
  const apply = async (command: DocumentCommand): Promise<CommandAnswer> => {
    const revisions: Record<string, number> = {};
    for (const write of command.writes) {
      const key = commandKey(write.kind, write.id);
      const value = "tombstone" in write ? { tombstone: true, at: now(), value: write.value } : write.value;
      const result = await store.put(write.kind, write.id, value, write.base);
      if (result.ok) { revisions[key] = result.document.revision; continue; }
      if (result.reason === "superseded") return { ok: false, reason: "superseded" };
      const current = result.current;
      // The target already holds exactly this value: acknowledged at its revision (A5). A tombstone's time differs, so it compares its value.
      const same = current && (JSON.stringify(current.value) === JSON.stringify(value) ||
        ("tombstone" in write && isTombstone(current.value) && JSON.stringify(current.value.value) === JSON.stringify(write.value)));
      if (same) { revisions[key] = current.revision; continue; }
      return { ok: false, reason: "stale", current: { ...revisions, [key]: current?.revision ?? 0 } };
    }
    return { ok: true, revisions };
  };
  return {
    commit(command) {
      const known = receipts.get(command.id);
      if (known) return Promise.resolve(known);
      const joined = running.get(command.id);
      if (joined) return joined;
      const answer = apply(command).then(result => {
        if (result.ok) receipts.set(command.id, result);
        for (const id of command.forget ?? []) receipts.delete(id);
        return result;
      }).finally(() => running.delete(command.id));
      running.set(command.id, answer);
      return answer;
    },
    async list<T>(kind: string, signal?: AbortSignal): Promise<readonly HeldDocument<T>[]> {
      return (await store.list(kind, signal)).map(document => isTombstone(document.value)
        ? { id: document.id, revision: document.revision, value: document.value.value as T, deleted: true }
        : { id: document.id, revision: document.revision, value: document.value as T, deleted: false });
    },
  };
}

/** A command ID: unique per command, so a replay is recognised (`<command>:<random>`). */
export const commandId = (command: string, random: () => number = Math.random) =>
  `${command}:${Date.now().toString(36)}-${Math.floor(random() * 2 ** 48).toString(36)}`;

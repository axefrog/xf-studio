/** Spike outbox storages: in memory (tests, with a forced failure) and a synchronously written file (the desktop host file's stand-in). */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Entry, OutboxStorage } from "./window";

export class MemoryOutbox implements OutboxStorage {
  text = "[]";
  fail = false;
  writes = 0;
  save(entries: readonly Entry[]) {
    if (this.fail) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    this.text = JSON.stringify(entries); this.writes++;
  }
  load(): Entry[] { return JSON.parse(this.text) as Entry[]; }
}

/** Written beside its name and renamed into place, so a kill leaves the old or the new outbox, never half of one. */
export class FileOutbox implements OutboxStorage {
  constructor(readonly path: string) {}
  save(entries: readonly Entry[]) {
    writeFileSync(`${this.path}.tmp`, JSON.stringify(entries));
    renameSync(`${this.path}.tmp`, this.path);
  }
  load(): Entry[] {
    try { return JSON.parse(readFileSync(this.path, "utf8")) as Entry[]; } catch { return []; }
  }
}

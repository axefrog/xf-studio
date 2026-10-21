/**
 * Look sessions (profiles design §7, the successor of `collection-workspace.ts`' one live look): one session per `LookRef`, opened on
 * demand by whatever shows or edits the look (a scene, a panel), shared by every opener, and released when the last one lets go. Nothing
 * is "the" look: any number of looks, in any number of collections, are open at once, and each session reads and writes only its own
 * look's working copy, through the collection owner (`look.update`, one document, through the outbox).
 *
 * A session hears its own look only: its edits here, an acknowledgement, a conflict and its resolution, and a change taken from another
 * window (`elsewhere`: "Changed elsewhere; Undo starts here" once the look history moves here). Releasing the last handle waits until
 * the library holds the look's changes; one that can't yet keeps the session until they have (the outbox still holds and resends them).
 */
import type { Capability } from "../platform/api/capability";
import { documentKey } from "../platform/api/document-commands";
import type { DocumentOutbox, OutboxOutcome } from "../platform/core/document-outbox";
import { type LookRef, lookRef } from "./collection-documents";
import type { CollectionOwner, LookView } from "./collection-owner";

export type LookChange = { readonly name?: string; readonly parts?: Readonly<Record<string, unknown>>; readonly memory?: unknown };
export type LookSessionEvent = { readonly kind: "changed" | "elsewhere" | "conflict" | "resolved" };
export type LookUpdate = { ok: true; settled: Promise<OutboxOutcome> } | { ok: false; code: Capability["code"]; reason: string };

/** One opener's handle on a look's session. */
export interface LookSession {
  readonly ref: LookRef;
  /** The look as this window holds it (null: gone). */
  look(): LookView | null;
  /** Records the look's next value at once; `settled` says what became of it (acknowledged, dropped by a resolution, or stopped). */
  /** `store: "soon"`: recorded at once, stored with the look's next changes (a continuous edit), as `DocumentOutbox.commit` says. */
  update(change: LookChange, options?: { store?: "now" | "soon" }): LookUpdate;
  /** Keep mine, Use theirs (mine kept as a fork) or Keep both, when the look is in conflict. */
  resolve(keep: "mine" | "theirs" | "both"): Promise<Capability>;
  subscribe(listener: (event: LookSessionEvent) => void): () => void;
  /** This opener is done: the session closes with its last handle, once the library holds the look's changes (false: not yet). */
  release(): Promise<boolean>;
}

type Session = { ref: LookRef; handles: number; listeners: Set<(event: LookSessionEvent) => void> };

export class LookSessions {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly owner: CollectionOwner, private readonly outbox: DocumentOutbox) {
    outbox.subscribe(event => {
      if (event.kind === "status") return;
      const refs = event.kind === "external" || event.kind === "resolved" || event.kind === "recorded" ? event.refs : event.entry.writes;
      const kind: LookSessionEvent["kind"] = event.kind === "external" ? "elsewhere" : event.kind === "conflict" ? "conflict" : event.kind === "resolved" ? "resolved" : "changed";
      for (const ref of refs) {
        const session = this.sessions.get(documentKey(ref));
        if (!session) continue;
        for (const listener of [...session.listeners]) listener({ kind });
      }
      // A session whose last opener let go before its changes reached the library closes once they have.
      for (const [key, session] of this.sessions)
        if (session.handles === 0 && !outbox.document(lookRef(session.ref))?.pending) this.sessions.delete(key);
    });
  }

  /** The look's session (made now when none is open), and one handle on it. */
  open(ref: LookRef): LookSession {
    const key = documentKey(lookRef(ref));
    let session = this.sessions.get(key);
    if (!session) this.sessions.set(key, session = { ref: { collection: ref.collection, look: ref.look }, handles: 0, listeners: new Set() });
    session.handles++;
    const own = new Set<(event: LookSessionEvent) => void>();
    let released = false;
    const it = session;
    return {
      ref: it.ref,
      look: () => this.owner.look(it.ref),
      update: (change, options) => {
        if (released) return { ok: false, code: "unavailable", reason: "This look was closed here." };
        const made = this.owner.updateLook(it.ref, change, options);
        return made.ok ? { ok: true, settled: this.outbox.settled(made.entry.id) } : made;
      },
      resolve: keep => {
        const conflict = this.owner.look(it.ref)?.conflict;
        return conflict ? this.owner.resolve(conflict.id, keep)
          : Promise.resolve({ available: false, code: "invalid_value", reason: "Nothing about this look changed in another window." });
      },
      subscribe: listener => { own.add(listener); it.listeners.add(listener); return () => { own.delete(listener); it.listeners.delete(listener); }; },
      release: async () => {
        if (released) return true;
        released = true;
        for (const listener of own) it.listeners.delete(listener);
        if (--it.handles > 0) return true;
        const settled = await this.outbox.settle([lookRef(it.ref)]);
        // Opened again meanwhile: the session stays for the new opener.
        if (it.handles === 0 && settled && this.sessions.get(key) === it) this.sessions.delete(key);
        return settled;
      },
    };
  }
  /** The looks with a session (tests and diagnostics): open ones, and closed ones whose changes hadn't reached the library yet. */
  held(): readonly LookRef[] { return [...this.sessions.values()].map(session => session.ref); }
}

/**
 * Starter shapes of a layered-makeup feature (profiles design §6, the second kind of contributed defaults): the feature's contributed
 * starters and the person's own, in one list, and the one owner of the own ones (`shape-starter` documents) and of the choice of which
 * starter new layers and new looks take. It follows `layout-defaults.ts`:
 *
 * - **Contributed starters** come from the feature's region: read-only, frozen, listed first under the feature's label. Nothing here
 *   changes them.
 * - **Own starters** are library documents written only through this owner's commands and the outbox: create (Save shape as starter),
 *   rename, and delete as a tombstone, which restore takes back (the Undo notice's action). Names are 1 to 60 characters and need not
 *   be unique; the list tells same-named starters apart by when each was saved.
 * - **Conflicts keep both at once.** This window's edit becomes a new starter named "(this window)"; the original takes the other
 *   window's version. A local deletion takes the other version alone. One atomic outbox resolution protects the copy across a restart.
 * - **Another window's new starters** are found at every revision check and held beside this window's pending writes.
 * - **The default** is the one starter new layers and new looks start from. It changes only by `setDefault` ("Use for new layers"),
 *   never by use. It is kept in the workspace (`DefaultPort`, the feature's memory); a missing or deleted one falls back to the
 *   feature's own fallback. A deleted own starter that is the default comes back as the default if it is restored.
 * - **Read as this build can.** A stored starter whose shape doesn't read here (a newer build's) is kept and listed as unavailable,
 *   so it can still be renamed or deleted, never applied.
 * - **Forward reading:** unknown fields of a document are kept when it is written again.
 */
import { refusal, type Capability } from "../../platform/api/capability";
import { isTombstone, tombstoneOf, type DocumentRef } from "../../platform/api/document-commands";
import type { DocumentStorePort } from "../../platform/api/document-store";
import { nameIssue } from "../../platform/api/validation-issues";
import type { DocumentOutbox, OutboxEntry } from "../../platform/core/document-outbox";
import { notifyAll } from "../../platform/core/listeners";
import { hostRandom } from "../../platform/core/random";
import type { ContributedStarter, StarterShape } from "../../engines/layered-makeup/starter-shape";

export const STARTER_DOCUMENT = "shape-starter";
export const STARTER_SCHEMA = "xfs/shape-starter-1";
/** An own starter's ID: `s-` and base 36. */
export const OWN_STARTER_ID = /^s-[0-9a-z]{4,40}$/;
export const STARTER_NAME_LIMIT = 60;

/** An own starter as stored (`xfs/shape-starter-1`). `shape` is validated when it is listed, so one from another build still lists. */
export type OwnStarterDocument = { readonly schema: typeof STARTER_SCHEMA; readonly id: string; readonly feature: string; readonly name: string;
  readonly owner: "user"; readonly shape: unknown; readonly createdAt: number; readonly savedAt?: number };
/** A starter as listed: the feature's or the person's. Detached. */
export type StarterView = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly owner: { readonly kind: "feature"; readonly label: string } | { readonly kind: "user"; readonly revision: number; readonly createdAt: number; readonly savedAt: number };
  /** Absent: this build can't read the shape (a newer build's), so it can't be applied. */
  readonly shape?: StarterShape;
  /** Whether new layers and new looks start from it now. */
  readonly isDefault: boolean;
  /** Why it can't be applied here, in plain words. */
  readonly unavailable?: string;
};
export type StarterCommand =
  | { readonly kind: "create"; readonly name: string; readonly shape: StarterShape }
  | { readonly kind: "rename"; readonly id: string; readonly name: string }
  | { readonly kind: "delete"; readonly id: string }
  | { readonly kind: "restore"; readonly id: string };
export type StarterAnswer = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly code: Capability["code"]; readonly reason: string };

const UNREADABLE = "This starter was saved by a newer version of XF Studio, so it can't be used here.";
const CONTRIBUTED = "A feature's starter can't be changed. Save a starter of your own from any layer.";
const ref = (id: string): DocumentRef => ({ kind: STARTER_DOCUMENT, id });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** A stored own starter, validated apart from its shape (null: not one). */
export function ownStarterOf(value: unknown): OwnStarterDocument | null {
  if (!object(value) || value.schema !== STARTER_SCHEMA || typeof value.id !== "string" || !OWN_STARTER_ID.test(value.id) || value.owner !== "user"
    || typeof value.feature !== "string" || typeof value.name !== "string" || !value.name.trim() || !object(value.shape)) return null;
  return { ...value, createdAt: Number.isFinite(value.createdAt) ? value.createdAt : 0 } as unknown as OwnStarterDocument;
}

/** Where the default's ID is kept: the workspace's feature memory. */
export type DefaultPort = { get(): string | undefined; set(id: string | undefined): void };

export type ShapeStartersDeps = {
  readonly documents: Pick<DocumentStorePort, "list">;
  /** Every command goes through the outbox. */
  readonly outbox: DocumentOutbox;
  /** The feature these starters belong to (its feature ID) and the label its starters are listed under. */
  readonly feature: string;
  readonly label: string;
  readonly contributed: readonly ContributedStarter[];
  /** The starter used when the stored default is missing or deleted. Must be one of `contributed`. */
  readonly fallback: string;
  /** Validates a stored or supplied shape for the feature (its region's rules); undefined: it isn't one. */
  readonly read: (shape: unknown) => StarterShape | undefined;
  readonly choice: DefaultPort;
  readonly random?: () => number;
  readonly now?: () => number;
  readonly writable?: () => boolean;
  /** Ordinary information, sent through the application's existing feedback route. */
  readonly note?: (message: string) => void;
  readonly report?: (error: unknown) => void;
};

export class ShapeStarters {
  /** Every own starter this window knows of (deleted ones too: restore names them). */
  private readonly ids = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private views: readonly StarterView[] | null = null;
  private resolving = false;

  constructor(private readonly deps: ShapeStartersDeps) {
    if (!deps.contributed.some(item => item.id === deps.fallback)) throw Error("The fallback starter must be one the feature contributes.");
    deps.outbox.subscribe(event => {
      if (event.kind === "status") return;
      const refs = event.kind === "external" || event.kind === "resolved" || event.kind === "recorded" ? event.refs : event.entry.writes;
      if (!refs.some(item => item.kind === STARTER_DOCUMENT)) return;
      for (const item of refs) if (item.kind === STARTER_DOCUMENT) this.ids.add(item.id);
      if (event.kind === "conflict" || event.kind === "recorded") this.resolveConflicts();
      this.changed();
    });
    deps.outbox.onCheck(signal => this.refresh(signal));
  }

  /** Read every own starter from the library (deleted ones too), and those this window's outbox still holds from its last session. */
  async load(signal?: AbortSignal): Promise<void> {
    for (const entry of this.deps.outbox.pendingEntries()) for (const write of entry.writes) if (write.kind === STARTER_DOCUMENT) this.ids.add(write.id);
    await this.refresh(signal, true);
  }
  private async refresh(signal?: AbortSignal, always = false): Promise<void> {
    let found = false;
    for (const document of await this.deps.documents.list(STARTER_DOCUMENT, signal)) {
      if (this.ids.has(document.id) && !always) continue;
      this.deps.outbox.hold(ref(document.id), { revision: document.revision, value: document.value });
      this.ids.add(document.id);
      found = true;
    }
    if (found || always) this.changed();
    this.resolveConflicts();
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /** Something the list depends on changed (the default is kept elsewhere, so its owner calls this too). */
  changed() { this.views = null; notifyAll(this.listeners); }

  // ----- Reads -----
  /** The feature's starters in menu order, then the person's in the order they were made. Detached. */
  list(): readonly StarterView[] {
    this.views ??= this.build();
    return structuredClone(this.views);
  }
  get(id: string): StarterView | undefined { return this.list().find(item => item.id === id); }
  /** The starter new layers and new looks start from: the chosen one while it exists and can be applied, else the fallback. */
  defaultId(): string {
    const chosen = this.deps.choice.get(), view = chosen === undefined ? undefined : this.build().find(item => item.id === chosen);
    return view?.shape ? view.id : this.deps.fallback;
  }
  /** The shape of starter `id`, or the default's when none is named (undefined: that starter doesn't exist or can't be read here). */
  shapeOf(id?: string): StarterShape | undefined {
    const wanted = id ?? this.defaultId(), view = this.build().find(item => item.id === wanted);
    return view?.shape && structuredClone(view.shape);
  }
  isContributed(id: string): boolean { return this.deps.contributed.some(item => item.id === id); }
  conflicts(): readonly OutboxEntry[] { return this.deps.outbox.conflicts().filter(entry => entry.writes.some(write => write.kind === STARTER_DOCUMENT)); }

  private build(): readonly StarterView[] {
    const chosen = this.deps.choice.get(), own = this.own().map(item => this.ownView(item));
    const all = [...this.deps.contributed.map(item => ({ id: item.id, name: item.name, description: item.description, owner: { kind: "feature" as const, label: this.deps.label },
      shape: item.shape as StarterShape | undefined, unavailable: undefined as string | undefined })), ...own];
    const effective = chosen !== undefined && all.some(item => item.id === chosen && item.shape) ? chosen : this.deps.fallback;
    return Object.freeze(all.map(({ unavailable, shape, ...rest }) => ({ ...rest, isDefault: rest.id === effective, ...(shape ? { shape } : {}), ...(unavailable ? { unavailable } : {}) })));
  }
  private held(id: string): { value: unknown; revision: number } | null {
    const held = this.deps.outbox.document(ref(id));
    return held && held.value !== undefined ? { value: held.value, revision: held.version } : null;
  }
  private own(): { value: OwnStarterDocument; revision: number }[] {
    return [...this.ids].flatMap(id => {
      const held = this.held(id), value = held && !isTombstone(held.value) ? ownStarterOf(held.value) : null;
      return value && value.feature === this.deps.feature ? [{ value, revision: held!.revision }] : [];
    }).sort((a, b) => a.value.createdAt - b.value.createdAt);
  }
  private ownView({ value, revision }: { value: OwnStarterDocument; revision: number }) {
    const shape = this.deps.read(value.shape);
    return { id: value.id, name: value.name.trim(), description: undefined as string | undefined,
      owner: { kind: "user" as const, revision, createdAt: value.createdAt, savedAt: Number.isFinite(value.savedAt) ? value.savedAt! : value.createdAt },
      shape, unavailable: shape ? undefined : UNREADABLE };
  }

  // ----- Conflicts -----
  /** No owning panel exists to ask in. Preserve mine as a copy and take theirs, in the outbox's single crash-safe operation. */
  private resolveConflicts(): void {
    if (this.resolving || this.deps.writable?.() === false || this.deps.outbox.status().stopped) return;
    this.resolving = true;
    const notes: string[] = [];
    try {
      for (const entry of this.conflicts()) {
        if (!this.conflicts().some(item => item.id === entry.id) || entry.writes.length !== 1) continue;
        const write = entry.writes[0]!, deleted = isTombstone(write.value);
        const value = ownStarterOf(isTombstone(write.value) ? write.value.value : write.value);
        if (!value) continue;
        try {
          if (deleted) {
            this.deps.outbox.useTheirs(entry.id);
            notes.push(`“${value.name}” was changed in another window, so it's kept.`);
          } else {
            const suffix = " (this window)", name = `${value.name.slice(0, STARTER_NAME_LIMIT - suffix.length)}${suffix}`;
            this.deps.outbox.keepBoth(entry.id, () => {
              const now = (this.deps.now ?? Date.now)(), id = this.newId(now);
              return [{ ...ref(id), value: { ...value, id, name, createdAt: now, savedAt: now } }];
            });
            notes.push(`“${value.name}” was also changed in another window. Both are kept: yours is “${name}”.`);
          }
        } catch (error) {
          if (this.deps.writable?.() !== false && this.conflicts().some(item => item.id === entry.id)) this.deps.report?.(error);
        }
      }
    } finally { this.resolving = false; }
    if (notes.length) this.deps.note?.(notes.join("\n\n"));
  }

  // ----- Commands -----
  capability(command: StarterCommand): Capability {
    if (command.kind === "create") return this.nameCheck(command.name) ?? (this.deps.read(command.shape) ? { available: true } : refusal("invalid_value", "This shape can't be saved as a starter."));
    if (this.isContributed(command.id)) return refusal("invalid_value", CONTRIBUTED);
    const held = this.held(command.id), value = held && ownStarterOf(isTombstone(held.value) ? held.value.value : held.value);
    if (!held || !value || value.feature !== this.deps.feature) return refusal("missing_target", "That starter doesn't exist any more.");
    const deleted = isTombstone(held.value);
    if (command.kind === "restore") return deleted ? { available: true } : refusal("invalid_value", "That starter isn't deleted.");
    if (deleted) return refusal("missing_target", "That starter was deleted.");
    if (command.kind === "rename") return this.nameCheck(command.name) ?? { available: true };
    return { available: true };
  }
  /** Apply one command: recorded in the outbox at once (one write), so it survives a restart and reaches the library in the background. */
  dispatch(command: StarterCommand): StarterAnswer {
    const allowed = this.capability(command);
    if (!allowed.available) return { ok: false, code: allowed.code, reason: allowed.reason ?? "That can't be done." };
    const now = (this.deps.now ?? Date.now)();
    const id = command.kind === "create" ? this.newId(now) : command.id;
    let value: unknown;
    if (command.kind === "create") value = { schema: STARTER_SCHEMA, id, feature: this.deps.feature, name: command.name.trim(), owner: "user",
      shape: structuredClone(this.deps.read(command.shape)), createdAt: now, savedAt: now };
    else {
      const held = this.held(id)!.value;
      if (command.kind === "restore") value = (held as { value: unknown }).value;
      else if (command.kind === "delete") value = tombstoneOf(held, now);
      else value = { ...(held as object), name: command.name.trim() };
    }
    try { this.deps.outbox.commit(`shape-starter.${command.kind}`, [{ ...ref(id), value }]); }
    catch (error) { return { ok: false, code: "unavailable", reason: (error as Error).message }; }
    this.ids.add(id);
    this.changed();
    return { ok: true, id };
  }
  /** Make `id` the starter new layers and new looks start from. */
  setDefault(id: string): StarterAnswer {
    const allowed = this.defaultCapability(id);
    if (!allowed.available) return { ok: false, code: allowed.code, reason: allowed.reason ?? "That can't be done." };
    this.deps.choice.set(id);
    this.changed();
    return { ok: true, id };
  }
  defaultCapability(id: string): Capability {
    const view = this.build().find(item => item.id === id);
    if (!view) return refusal("missing_target", "That starter doesn't exist any more.");
    return view.shape ? { available: true } : refusal("unavailable", UNREADABLE);
  }
  private nameCheck(name: unknown): Capability | undefined {
    const issue = nameIssue(name, STARTER_NAME_LIMIT);
    return issue ? refusal("invalid_value", issue.message.replace("Enter a name; it cannot be blank.", "Name the starter.")) : undefined;
  }
  private newId(now: number): string {
    const random = this.deps.random ?? hostRandom().next;
    for (let tries = 0; tries < 64; tries++) {
      const id = `s-${now.toString(36)}${Math.floor(random() * 2 ** 40).toString(36).padStart(8, "0")}`;
      if (!this.ids.has(id)) return id;
    }
    throw Error("A new starter's ID couldn't be made: the source of randomness keeps repeating itself.");
  }
}

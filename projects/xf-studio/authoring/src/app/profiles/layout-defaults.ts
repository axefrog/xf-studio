/**
 * Default layouts (profiles design §1.1, §4.2; experiment 044 chunk P2-ii): the modules' contributed defaults and the person's own, in
 * one list, and the one owner of own defaults (`layout-default` documents).
 *
 * - **Contributed defaults** come from the composition (`compose/layout-defaults.ts`): read-only, frozen, listed under their module in
 *   module order (early-access modules' marked so, decision M3). Their IDs are `<module>/<id>`. Nothing here changes them: a later build
 *   changes only new tabs and resets.
 * - **Own defaults** are library documents written only through this owner's commands and the outbox (§2.2): create (Save as default),
 *   update (Update "<name>"), rename, and delete as a tombstone, which restore takes back (the Undo notice's action). Names are 1 to 60
 *   characters and need not be unique (the coordinator's decision): two windows could otherwise both take a name, so one window enforcing
 *   it would only make the two disagree. The list tells same-named defaults apart by when each was saved (`savedAt`).
 * - **Conflicts keep both at once.** This window's edit becomes a new default named "(this window)"; the original takes the other
 *   window's version. A local deletion takes the other version alone. One atomic outbox resolution protects the copy across a restart.
 * - **Another window's new defaults** are found at every revision check (`DocumentOutbox.onCheck`): the kind is listed again and the
 *   documents this window didn't know are held, beside its own pending writes.
 * - **Read as this build can.** An own default whose fragment doesn't read, or needs panel types or view tools this build lacks (a newer
 *   build's), is listed with the reason it can't be used, so it can still be renamed or deleted, never made into a tab.
 * - **Forward reading:** unknown fields of a document are kept when it is written again.
 */
import { refusal, type Capability } from "../../platform/api/capability";
import { isTombstone, tombstoneOf, type DocumentRef } from "../../platform/api/document-commands";
import type { DocumentStorePort } from "../../platform/api/document-store";
import type { LayoutFragment } from "../../platform/api/layout-fragment";
import type { StudioModule } from "../../platform/api/module";
import type { DocumentOutbox, OutboxEntry } from "../../platform/core/document-outbox";
import { notifyAll } from "../../platform/core/listeners";
import { hostRandom } from "../../platform/core/random";
import { buildIssues, fragmentIssues, type FragmentKnowledge } from "./layout-fragment";
import { LAYOUT_DEFAULT_DOCUMENT, LAYOUT_DEFAULT_SCHEMA } from "./profiles-migration-data";
import { nameIssue } from "./profile-sessions";

export { LAYOUT_DEFAULT_DOCUMENT, LAYOUT_DEFAULT_SCHEMA };
/** An own default's ID: `d-` and base 36 (the migration's and this owner's). */
export const OWN_DEFAULT_ID = /^d-[0-9a-z]{4,40}$/;

/** A module's default as the composition lists it. */
export type ContributedLayoutDefault = {
  /** `<module>/<id>`: what a tab made from it names as its origin. */
  readonly id: string;
  readonly module: string;
  /** The module's label (New tab ▸ groups by it). */
  readonly label: string;
  /** The module is early access (not stable): listed with the Early access tag. */
  readonly earlyAccess: boolean;
  readonly name: string;
  readonly description: string;
  readonly fragment: LayoutFragment;
};
/** An own default as stored (`xfs/layout-default-1`). */
export type OwnDefaultDocument = { readonly schema: typeof LAYOUT_DEFAULT_SCHEMA; readonly id: string; readonly name: string; readonly owner: "user";
  readonly fragment: LayoutFragment; readonly createdAt: number;
  /** When the fragment was last saved (create or Update); a document written before it has only `createdAt`. */
  readonly savedAt?: number };
/** A default as listed: a module's or the person's, with the reason it can't be used here, if any. Detached. */
export type LayoutDefaultView = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly owner: { readonly kind: "module"; readonly module: string; readonly label: string; readonly earlyAccess: boolean }
    | { readonly kind: "user"; readonly revision: number; readonly createdAt: number; readonly savedAt: number };
  readonly fragment: LayoutFragment;
  /** Why no tab can be made from it in this build (plain words); absent when one can. */
  readonly unavailable?: string;
};
export type DefaultsCommand =
  | { readonly kind: "create"; readonly name: string; readonly fragment: LayoutFragment }
  | { readonly kind: "update"; readonly id: string; readonly fragment: LayoutFragment }
  | { readonly kind: "rename"; readonly id: string; readonly name: string }
  | { readonly kind: "delete"; readonly id: string }
  | { readonly kind: "restore"; readonly id: string };
export type DefaultsAnswer = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly code: Capability["code"]; readonly reason: string };

const NEWER = "This default was saved by a newer version of XF Studio, so a tab can't be made from it here.";
const UNREADABLE = "This default can't be read, so a tab can't be made from it.";
const CONTRIBUTED = "A feature's default can't be changed. Make a tab from it and save your own.";
const ref = (id: string): DocumentRef => ({ kind: LAYOUT_DEFAULT_DOCUMENT, id });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** A stored own default, validated (null: not one). Its fragment is checked when it is listed, so one from another build is still listed. */
export function ownDefaultOf(value: unknown): OwnDefaultDocument | null {
  if (!object(value) || value.schema !== LAYOUT_DEFAULT_SCHEMA || typeof value.id !== "string" || !OWN_DEFAULT_ID.test(value.id) || value.owner !== "user"
    || typeof value.name !== "string" || !value.name.trim() || !object(value.fragment)) return null;
  return { ...value, createdAt: Number.isFinite(value.createdAt) ? value.createdAt : 0 } as unknown as OwnDefaultDocument;
}

/**
 * The modules' defaults as a live source: the built-in modules' and those of the experiments switched on now, in module order. An
 * experiment switched off withdraws its defaults from the list; a tab made from one is the person's and stays as it is.
 */
export type ContributedDefaultsSource = {
  list(): readonly ContributedLayoutDefault[];
  subscribe(listener: () => void): () => void;
  /** Moves whenever the set of contributions changes: a check made earlier is revalidated at dispatch if it differs. Absent: fixed. */
  generation?(): number;
};

export type LayoutDefaultsDeps = {
  /** The library's documents, read once at `load`. */
  readonly documents: Pick<DocumentStorePort, "list">;
  /** Every command goes through the outbox. */
  readonly outbox: DocumentOutbox;
  /** The modules' defaults, in module order (frozen): fixed, or a live source that changes as experiments switch on and off. */
  readonly contributed?: readonly ContributedLayoutDefault[] | ContributedDefaultsSource;
  /** What this build has: an own default needing more is listed as unavailable. Absent: only the fragment's structure is checked. */
  readonly known?: FragmentKnowledge;
  readonly random?: () => number;
  readonly now?: () => number;
  readonly writable?: () => boolean;
  /** Ordinary information, sent through the application's existing feedback route. */
  readonly note?: (message: string) => void;
  readonly report?: (error: unknown) => void;
};

export class LayoutDefaults {
  /** Every own default this window knows of (deleted ones too: restore names them). */
  private readonly ids = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private views: readonly LayoutDefaultView[] | null = null;
  private readonly source: ContributedDefaultsSource;
  private resolving = false;

  constructor(private readonly deps: LayoutDefaultsDeps) {
    const given = deps.contributed ?? [];
    this.source = Array.isArray(given) ? { list: () => given, subscribe: () => () => {} } : given as ContributedDefaultsSource;
    this.source.subscribe(() => this.changed());
    deps.outbox.subscribe(event => {
      if (event.kind === "status") return;
      const refs = event.kind === "external" || event.kind === "resolved" || event.kind === "recorded" ? event.refs : event.entry.writes;
      if (!refs.some(item => item.kind === LAYOUT_DEFAULT_DOCUMENT)) return;
      for (const item of refs) if (item.kind === LAYOUT_DEFAULT_DOCUMENT) this.ids.add(item.id);
      if (event.kind === "conflict" || event.kind === "recorded") this.resolveConflicts();
      this.changed();
    });
    deps.outbox.onCheck(signal => this.refresh(signal));
  }

  /** Read every own default from the library (deleted ones too), and those this window's outbox still holds from its last session. */
  async load(signal?: AbortSignal): Promise<void> {
    for (const entry of this.deps.outbox.pendingEntries()) for (const write of entry.writes) if (write.kind === LAYOUT_DEFAULT_DOCUMENT) this.ids.add(write.id);
    await this.refresh(signal, true);
  }
  /**
   * List the library's own defaults and hold those this window doesn't know yet (another window saved them since). A document this window
   * knows is left to the outbox: its revision check takes a newer value, and never one under a pending write here.
   */
  private async refresh(signal?: AbortSignal, always = false): Promise<void> {
    let found = false;
    for (const document of await this.deps.documents.list(LAYOUT_DEFAULT_DOCUMENT, signal)) {
      if (this.ids.has(document.id) && !always) continue;
      this.deps.outbox.hold(ref(document.id), { revision: document.revision, value: document.value });
      this.ids.add(document.id);
      found = true;
    }
    if (found || always) this.changed();
    this.resolveConflicts();
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { this.views = null; notifyAll(this.listeners); }

  // ----- Reads -----
  /** Every default: the modules' in module order, then the person's in the order they were made. Detached. The source's snapshot is
   *  current whenever it is read (it rebuilds before it notifies), so the memoised list needs no retry of its own. */
  list(): readonly LayoutDefaultView[] {
    this.views ??= Object.freeze([...this.source.list().map(item => this.contributedView(item)), ...this.own().map(item => this.ownView(item))]);
    return structuredClone(this.views);
  }
  get(id: string): LayoutDefaultView | undefined {
    const contributed = this.source.list().find(item => item.id === id);
    if (contributed) return structuredClone(this.contributedView(contributed));
    const own = this.own().find(item => item.value.id === id);
    return own && structuredClone(this.ownView(own));
  }
  /** Whether `id` names a module's default. */
  isContributed(id: string): boolean { return this.source.list().some(item => item.id === id); }
  /** Own-default conflicts awaiting automatic preservation (only a writable window resolves them). */
  conflicts(): readonly OutboxEntry[] { return this.deps.outbox.conflicts().filter(entry => entry.writes.some(write => write.kind === LAYOUT_DEFAULT_DOCUMENT)); }
  /** No owning panel exists to ask in. Preserve mine as a copy and take theirs, in the outbox's single crash-safe operation. */
  private resolveConflicts(): void {
    if (this.resolving || this.deps.writable?.() === false || this.deps.outbox.status().stopped) return;
    this.resolving = true;
    const notes: string[] = [];
    try {
      for (const entry of this.conflicts()) {
        // A listener may already have resolved it. This owner only makes single-document commands.
        if (!this.conflicts().some(item => item.id === entry.id) || entry.writes.length !== 1) continue;
        const write = entry.writes[0]!, deleted = isTombstone(write.value);
        const value = ownDefaultOf(isTombstone(write.value) ? write.value.value : write.value);
        if (!value) continue;
        try {
          if (deleted) {
            this.deps.outbox.useTheirs(entry.id);
            notes.push(`“${value.name}” was changed in another window, so it's kept.`);
          } else {
            const suffix = " (this window)", name = `${value.name.slice(0, 60 - suffix.length)}${suffix}`;
            this.deps.outbox.keepBoth(entry.id, () => {
              const now = (this.deps.now ?? Date.now)(), id = this.newId(now);
              return [{ ...ref(id), value: { ...value, id, name, createdAt: now, savedAt: now } }];
            });
            notes.push(`“${value.name}” was also changed in another window. Both are kept: yours is “${name}”.`);
          }
        } catch (error) {
          // The outbox also checks the lease at the point of resolution; a lost lease leaves the conflict for its holder.
          if (this.deps.writable?.() !== false && this.conflicts().some(item => item.id === entry.id)) this.deps.report?.(error);
        }
      }
    } finally { this.resolving = false; }
    if (notes.length) this.deps.note?.(notes.join("\n\n"));
  }

  private held(id: string): { value: unknown; revision: number } | null {
    const held = this.deps.outbox.document(ref(id));
    return held && held.value !== undefined ? { value: held.value, revision: held.version } : null;
  }
  private own(): { value: OwnDefaultDocument; revision: number }[] {
    return [...this.ids].flatMap(id => {
      const held = this.held(id), value = held && !isTombstone(held.value) ? ownDefaultOf(held.value) : null;
      return value ? [{ value, revision: held!.revision }] : [];
    }).sort((a, b) => a.value.createdAt - b.value.createdAt);
  }
  private contributedView(item: ContributedLayoutDefault): LayoutDefaultView {
    return { id: item.id, name: item.name, description: item.description, owner: { kind: "module", module: item.module, label: item.label, earlyAccess: item.earlyAccess },
      fragment: item.fragment };
  }
  private ownView({ value, revision }: { value: OwnDefaultDocument; revision: number }): LayoutDefaultView {
    const unavailable = this.unusable(value.fragment);
    return { id: value.id, name: value.name.trim(), owner: { kind: "user", revision, createdAt: value.createdAt,
      savedAt: Number.isFinite(value.savedAt) ? value.savedAt! : value.createdAt }, fragment: value.fragment, ...(unavailable ? { unavailable } : {}) };
  }
  /** Why a fragment can't be made into a tab here (undefined: it can). */
  private unusable(fragment: unknown): string | undefined {
    if (fragmentIssues(fragment).length) return UNREADABLE;
    return this.deps.known && buildIssues(fragment as LayoutFragment, this.deps.known).length ? NEWER : undefined;
  }

  // ----- Commands -----
  capability(command: DefaultsCommand): Capability {
    if (command.kind === "create") return this.nameCheck(command.name) ?? this.fragmentCheck(command.fragment) ?? { available: true };
    if (this.isContributed(command.id)) return refusal("invalid_value", CONTRIBUTED);
    const held = this.held(command.id), value = held && ownDefaultOf(isTombstone(held.value) ? held.value.value : held.value);
    if (!held || !value) return refusal("missing_target", "That default doesn't exist any more.");
    const deleted = isTombstone(held.value);
    if (command.kind === "restore") return deleted ? { available: true } : refusal("invalid_value", "That default isn't deleted.");
    if (deleted) return refusal("missing_target", "That default was deleted.");
    if (command.kind === "rename") return this.nameCheck(command.name) ?? { available: true };
    if (command.kind === "update") return this.fragmentCheck(command.fragment) ?? { available: true };
    return { available: true };
  }
  /** Apply one command: recorded in the outbox at once (one write), so it survives a restart and reaches the library in the background. */
  dispatch(command: DefaultsCommand): DefaultsAnswer {
    const allowed = this.capability(command);
    if (!allowed.available) return { ok: false, code: allowed.code, reason: allowed.reason ?? "That can't be done." };
    const now = (this.deps.now ?? Date.now)();
    const id = command.kind === "create" ? this.newId(now) : command.id;
    let value: unknown;
    if (command.kind === "create") value = { schema: LAYOUT_DEFAULT_SCHEMA, id, name: command.name.trim(), owner: "user", fragment: structuredClone(command.fragment), createdAt: now,
      savedAt: now };
    else {
      const held = this.held(id)!.value;
      if (command.kind === "restore") value = (held as { value: unknown }).value;
      else if (command.kind === "delete") value = tombstoneOf(held, now);
      else if (command.kind === "rename") value = { ...(held as object), name: command.name.trim() };
      else value = { ...(held as object), fragment: structuredClone(command.fragment), savedAt: now };
    }
    try { this.deps.outbox.commit(`layout-default.${command.kind}`, [{ ...ref(id), value }]); }
    catch (error) { return { ok: false, code: "unavailable", reason: (error as Error).message }; }
    this.ids.add(id);
    this.changed();
    return { ok: true, id };
  }
  private nameCheck(name: unknown): Capability | undefined {
    const issue = typeof name === "string" ? nameIssue(name.trim()) : "Name the default.";
    return issue ? refusal("invalid_value", issue.replace("the tab", "the default")) : undefined;
  }
  private fragmentCheck(fragment: unknown): Capability | undefined {
    const unusable = this.unusable(fragment);
    return unusable ? refusal("invalid_value", "This tab can't be saved as a default.") : undefined;
  }
  private newId(now: number): string {
    const random = this.deps.random ?? hostRandom().next;
    for (let tries = 0; tries < 64; tries++) {
      const id = `d-${now.toString(36)}${Math.floor(random() * 2 ** 40).toString(36).padStart(8, "0")}`;
      if (!this.ids.has(id)) return id;
    }
    throw Error("A new default's ID couldn't be made: the source of randomness keeps repeating itself.");
  }
}

/** The modules' defaults as the composition lists them, in module order, deeply frozen (read-only: nothing may change them). */
export function contributedDefaults(modules: readonly Pick<StudioModule, "id" | "label" | "stage" | "defaults">[]): readonly ContributedLayoutDefault[] {
  return deepFreeze(modules.flatMap(module => (module.defaults ?? []).map(item => ({ id: `${module.id}/${item.id}`, module: module.id, label: module.label,
    earlyAccess: module.stage !== "stable", name: item.name, description: item.description, fragment: structuredClone(item.fragment) }))));
}
/**
 * What the modules' defaults get wrong (empty: none), checked at composition like the rest of the registration: IDs unique and well
 * formed, names usable, each fragment reading and naming only panel types, view tools and node states this build has.
 */
export function contributedDefaultIssues(modules: readonly Pick<StudioModule, "id" | "defaults">[], known: FragmentKnowledge): string[] {
  const issues: string[] = [];
  for (const module of modules) {
    const ids = new Set<string>();
    for (const item of module.defaults ?? []) {
      const where = `default ${module.id}/${String(item.id)}`;
      if (typeof item.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(item.id)) issues.push(`${where} has an unusable ID`);
      if (ids.has(item.id)) issues.push(`${where} is contributed twice`);
      ids.add(item.id);
      if (typeof item.name !== "string" || nameIssue(item.name.trim()) || item.name !== item.name.trim()) issues.push(`${where} has an unusable name`);
      if (typeof item.description !== "string" || !item.description.trim()) issues.push(`${where} has no description`);
      const structure = fragmentIssues(item.fragment);
      issues.push(...(structure.length ? structure : buildIssues(item.fragment, known)).map(issue => `${where}: ${issue}`));
    }
  }
  return issues;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); }
  return value;
}

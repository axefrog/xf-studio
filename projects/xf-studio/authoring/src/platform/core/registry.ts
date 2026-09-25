/**
 * The one action registry (feature-module platform §4). Kind sets, descriptors, Undo policy
 * and routing are derived from the registered owners; nothing is hand-kept beside it and no
 * kind falls through to a default owner. DOM-free; imports only the platform API.
 */
import { undoPolicyOf, type ActionDescriptor, type ActionSpec, type UndoPolicy } from "../api/actions";
import type { ActionOwner, AsyncDescriptor, AsyncSystemFamily } from "../api/feature";

/** Any owner the registry takes: synchronous families and features, and asynchronous families. */
export type AnyOwner = ActionOwner | AsyncSystemFamily;
/** The synchronous owners of a registry's owner union. */
export type SyncOwner<O> = Exclude<O, { async: true }>;
/** The asynchronous families of a registry's owner union. */
export type AsyncOwner<O> = Extract<O, { async: true }>;
export type AsyncRoute<O> =
  | { ok: true; owner: O; kind: string; qualified: string; descriptor: AsyncDescriptor }
  | { ok: false; code: "unknown_action"; kind: string };

export type RegistryRoute<O> =
  | { ok: true; owner: O; kind: string; qualified: string; spec: ActionSpec }
  | { ok: false; code: "unknown_action"; kind: string };

/** One registered action with its owner, for catalogues, palettes and golden snapshots. */
export type RegistryEntry = { kind: string; qualified: string; owner: string; ownerKind: ActionOwner["owner"];
  scope: readonly string[]; effect: ActionDescriptor["effect"]; undo: UndoPolicy };

export class Registry<O extends AnyOwner = ActionOwner> {
  private readonly list: readonly O[];
  private readonly byId = new Map<string, O>();
  private readonly byKind = new Map<string, { owner: SyncOwner<O>; spec: ActionSpec }>();
  private readonly byAsyncKind = new Map<string, { owner: AsyncOwner<O>; descriptor: AsyncDescriptor }>();
  private readonly ownedKinds = new Map<string, readonly string[]>();
  private readonly table: Readonly<Record<string, ActionDescriptor>>;

  /**
   * Throws when two owners share an ID or a kind is owned twice (synchronous and asynchronous kinds
   * share one namespace).
   */
  constructor(owners: readonly O[]) {
    this.list = Object.freeze([...owners]);
    const table: Record<string, ActionDescriptor> = {};
    for (const owner of owners) {
      if (this.byId.has(owner.id)) throw Error(`Owner ${owner.id} is registered twice.`);
      this.byId.set(owner.id, owner);
      const kinds = Object.keys(owner.actions);
      for (const kind of kinds) {
        if (!kind || kind.includes("/")) throw Error(`Action kind "${kind}" of ${owner.id} is not a valid kind.`);
        const taken = this.byKind.get(kind)?.owner ?? this.byAsyncKind.get(kind)?.owner;
        if (taken) throw Error(`Action ${kind} is owned by both ${taken.id} and ${owner.id}.`);
        if ("async" in owner && owner.async) {
          const descriptor = (owner.actions as Record<string, { descriptor: AsyncDescriptor }>)[kind].descriptor;
          this.byAsyncKind.set(kind, { owner: owner as AsyncOwner<O>, descriptor });
          continue;
        }
        const spec = (owner.actions as Record<string, ActionSpec>)[kind];
        this.byKind.set(kind, { owner: owner as SyncOwner<O>, spec });
        table[kind] = spec.descriptor;
      }
      this.ownedKinds.set(owner.id, Object.freeze(kinds));
    }
    this.table = Object.freeze(table);
  }
  owners(): readonly O[] { return this.list; }
  owner(id: string): O | undefined { return this.byId.get(id); }
  /** Total over synchronous kinds: every kind resolves to its one owner or to `unknown_action` (async kinds too). */
  route(kind: string): RegistryRoute<SyncOwner<O>> {
    const found = this.byKind.get(kind);
    return found ? { ok: true, owner: found.owner, kind, qualified: `${found.owner.id}/${kind}`, spec: found.spec }
      : { ok: false, code: "unknown_action", kind };
  }
  /** Total over asynchronous kinds (library requests, file workflows): their family or `unknown_action`. */
  routeAsync(kind: string): AsyncRoute<AsyncOwner<O>> {
    const found = this.byAsyncKind.get(kind);
    return found ? { ok: true, owner: found.owner, kind, qualified: `${found.owner.id}/${kind}`, descriptor: found.descriptor }
      : { ok: false, code: "unknown_action", kind };
  }
  /** Every synchronous kind in registration order, or one owner's kinds (for an async family, its requests). */
  kinds(ownerId?: string): readonly string[] {
    return ownerId === undefined ? Object.keys(this.table) : this.ownedKinds.get(ownerId) ?? [];
  }
  /** One async family's descriptors in registration order (shared and frozen: clone before handing out). */
  asyncDescriptors(ownerId: string): Readonly<Record<string, AsyncDescriptor>> {
    return Object.fromEntries((this.ownedKinds.get(ownerId) ?? []).flatMap(kind => {
      const found = this.byAsyncKind.get(kind);
      return found ? [[kind, found.descriptor]] : [];
    }));
  }
  descriptor(kind: string): ActionDescriptor | undefined { return this.byKind.get(kind)?.spec.descriptor; }
  /** The union of every owner's descriptors, in registration order. Shared and frozen at the top level: clone before handing out. */
  descriptors(): Readonly<Record<string, ActionDescriptor>> { return this.table; }
  /** Undo policy of a concrete action (its command or key variant first); `none` for an unknown kind. */
  undoPolicy(action: { kind: string }): UndoPolicy {
    const descriptor = this.descriptor(action.kind);
    return descriptor ? undoPolicyOf(descriptor, action) : "none";
  }
  entries(): RegistryEntry[] {
    return [...this.byKind].map(([kind, { owner, spec }]) => ({ kind, qualified: `${owner.id}/${kind}`, owner: owner.id,
      ownerKind: owner.owner, scope: [...spec.descriptor.scope], effect: spec.descriptor.effect, undo: spec.descriptor.undo }));
  }
}

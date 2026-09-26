/**
 * Owners of actions: platform system families and feature modules (feature-module
 * platform §1, §4). Registration is static and happens at composition time.
 */
import type { ActionDescriptor, ActionTable, FeatureActionTable, PayloadSchema, UndoPolicy } from "./actions";
import type { Capability, ReasonCode } from "./capability";
import type { EditorCodec, MemoryCodec, PartCodec } from "./document";
import type { HistoryLabel } from "./history";
import type { ExportInfo } from "./export";

export type FeatureId = string & { readonly __feature: unique symbol };
export type FamilyId = string & { readonly __family: unique symbol };

const OWNER_ID = /^[a-z][a-zA-Z0-9]*(?:-[a-z0-9]+)*$/;
function ownerId(id: string, what: string) {
  if (!OWNER_ID.test(id)) throw Error(`${what} ID "${id}" must be lower camel or kebab case.`);
}
/** A feature ID keeps its literal type, so composition can key handlers by it exhaustively. */
export function featureId<const T extends string>(id: T): T & FeatureId { ownerId(id, "Feature"); return id as T & FeatureId; }
export function familyId<const T extends string>(id: T): T & FamilyId { ownerId(id, "Family"); return id as T & FamilyId; }

/**
 * A platform-owned family of flat, grandfathered action kinds (collection/preset, history,
 * camera/preview, motion, quality, saved-V). Same table shape as a feature's.
 */
export interface SystemFamily<A extends { kind: string } = { kind: string }, Scope extends string = string,
  Id extends FamilyId = FamilyId> {
  readonly owner: "system";
  readonly id: Id;
  readonly label: string;
  readonly actions: ActionTable<A, Scope>;
  /** Refused with `asset_unavailable` while the 3D scene host cannot load. */
  readonly needsScene?: boolean;
  /** Code for an exception its service throws after the capability gate passed (default `invalid_value`). */
  readonly thrown?: ReasonCode;
}

/**
 * A feature's pointer gestures (feature-module platform §1): one proposed edit applied to the live
 * part in place, which keeps the live objects' identity for pointer performance and stale-pointer
 * checks. It returns what changed, or undefined when the edit is stale or invalid (nothing then
 * changed). The host owns the gesture's Undo transaction and publishes the result.
 */
export interface GestureProvider<P = unknown, G = unknown, R = unknown> {
  apply(part: P, edit: G): R | undefined;
  /** What a gesture's Undo step is called, from the first frame that changed something (the host names it otherwise). */
  label?(edit: G): HistoryLabel;
  /**
   * The gesture proposals a presentation may send inside a gesture session, by kind (catalogued beside
   * the actions; the session and its Undo transaction are the platform's).
   */
  readonly descriptors?: Readonly<Record<string, ActionDescriptor>>;
}

/**
 * A feature module's pure core registration: its part codec, its editor-memory codecs, its
 * action table with pure capability and apply (migration steps 1–2) and its gestures. Targets,
 * context and the character contribution join it in later steps; `exports` names its exporter (step 8)
 * (feature-module platform §8).
 *
 * `E` is the editor state the actions read: the per-look editor memory (`editor`) plus
 * whatever the host adds from the feature-wide memory (`memory`) for that look.
 */
export interface FeatureModule<A extends { kind: string } = { kind: string }, Scope extends string = string,
  Id extends FeatureId = FeatureId, P = unknown, E = unknown, X = unknown, G = unknown, R = unknown> {
  readonly owner: "feature";
  readonly id: Id;
  readonly api: 1;
  readonly label: string;
  readonly stage: "stable" | "preview" | "dev";
  readonly part: PartCodec<P>;
  readonly editor: EditorCodec<unknown, P>;
  readonly memory?: MemoryCodec<unknown>;
  readonly actions: FeatureActionTable<P, E, A, Scope, X>;
  readonly gestures?: GestureProvider<P, G, R>;
  /**
   * The feature's mod exporter, when it has one (feature-module platform §6): the host composition must
   * register an exporter and a verifier with this ID; its brand and selector are the defaults the
   * package plan shows before any Check.
   */
  readonly exports?: ExportInfo;
}

export type ActionOwner<A extends { kind: string } = { kind: string }, Scope extends string = string> =
  SystemFamily<A, Scope, FamilyId> | FeatureModule<A, Scope, FeatureId>;
/** A feature module seen by the platform, whatever its part and editor types. */
export type AnyFeatureModule = Pick<FeatureModule, "id" | "label" | "exports"> & {
  readonly part: PartCodec<unknown>; readonly editor: EditorCodec<unknown, unknown>; readonly memory?: MemoryCodec<unknown> };

/**
 * An asynchronous request's descriptor (a library request, a file workflow): where it applies, what it
 * does, and whether it can be cancelled once started. Families add their own fields (a file workflow's
 * device, for example); `undo` names a recovery path when there is one.
 */
export type AsyncDescriptor<Scope extends string = string> = { readonly scope: readonly Scope[]; readonly effect: string;
  readonly async: true; readonly cancellable: boolean; readonly payload?: PayloadSchema; readonly undo?: UndoPolicy };
/** An async family's table: one descriptor per kind of its request union (compile-time exhaustive). */
export type AsyncActionTable<A extends { kind: string }, D extends AsyncDescriptor = AsyncDescriptor> =
  { readonly [K in A["kind"]]: { readonly descriptor: D } };
/**
 * A platform family of asynchronous requests (feature-module platform §4, CORE-36): the library's
 * requests and the file workflows. They run to completion or failure over a device or the host, report
 * progress through their service, and never record Undo; the registry routes them by owner like every
 * other kind, through `routeAsync`, and keeps them out of the synchronous action table.
 */
export interface AsyncSystemFamily<A extends { kind: string } = { kind: string }, D extends AsyncDescriptor = AsyncDescriptor,
  Id extends FamilyId = FamilyId> {
  readonly owner: "system";
  readonly async: true;
  readonly id: Id;
  readonly label: string;
  readonly actions: AsyncActionTable<A, D>;
  /** Scene gating and thrown-error codes belong to synchronous families; an async family reports its own outcome. */
  readonly needsScene?: undefined;
  readonly thrown?: undefined;
}
/** The live behaviour an application binds to an async family: its capability check and its execution. */
export interface AsyncActionHandler<A extends { kind: string }, R = unknown> {
  capability(action: A): Capability;
  execute(action: A): Promise<R>;
}
/** Build an async family's table from an existing descriptor record (key order is registration order). */
export function asyncActionTable<A extends { kind: string }, D extends AsyncDescriptor>(
  descriptors: { readonly [K in A["kind"]]: D }): AsyncActionTable<A, D> {
  return Object.freeze(Object.fromEntries(Object.entries(descriptors).map(([kind, descriptor]) =>
    [kind, Object.freeze({ descriptor })]))) as unknown as AsyncActionTable<A, D>;
}

/** The live behaviour an application binds to one owner: its capability check and dispatch. */
export interface ActionHandler<A extends { kind: string }> {
  capability(action: A): Capability;
  dispatch(action: A): unknown;
}

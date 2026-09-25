/**
 * Owners of actions: platform system families and feature modules (feature-module
 * platform §1, §4). Registration is static and happens at composition time.
 */
import type { ActionTable, FeatureActionTable } from "./actions";
import type { Capability, ReasonCode } from "./capability";
import type { EditorCodec, MemoryCodec, PartCodec } from "./document";

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
}

/**
 * A feature module's pure core registration: its part codec, its editor-memory codecs, its
 * action table with pure capability and apply (migration steps 1–2) and its gestures. Targets,
 * context, the character contribution and the exporter join it in later steps
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
}

export type ActionOwner<A extends { kind: string } = { kind: string }, Scope extends string = string> =
  SystemFamily<A, Scope, FamilyId> | FeatureModule<A, Scope, FeatureId>;
/** A feature module seen by the platform, whatever its part and editor types. */
export type AnyFeatureModule = Pick<FeatureModule, "id" | "label"> & {
  readonly part: PartCodec<unknown>; readonly editor: EditorCodec<unknown, unknown>; readonly memory?: MemoryCodec<unknown> };

/** The live behaviour an application binds to one owner: its capability check and dispatch. */
export interface ActionHandler<A extends { kind: string }> {
  capability(action: A): Capability;
  dispatch(action: A): unknown;
}

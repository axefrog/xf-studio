/**
 * Owners of actions: platform system families and feature modules (feature-module
 * platform §1, §4). Registration is static and happens at composition time.
 */
import type { ActionTable } from "./actions";
import type { Capability, ReasonCode } from "./capability";

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
 * A feature module's pure core registration. Step 1 of the migration registers its action
 * table; the part and editor codecs, targets, context, gestures, character contribution and
 * exporter join it in later steps (feature-module platform §8).
 */
export interface FeatureModule<A extends { kind: string } = { kind: string }, Scope extends string = string,
  Id extends FeatureId = FeatureId> {
  readonly owner: "feature";
  readonly id: Id;
  readonly api: 1;
  readonly label: string;
  readonly stage: "stable" | "preview" | "dev";
  readonly actions: ActionTable<A, Scope>;
}

export type ActionOwner<A extends { kind: string } = { kind: string }, Scope extends string = string> =
  SystemFamily<A, Scope, FamilyId> | FeatureModule<A, Scope, FeatureId>;

/** The live behaviour an application binds to one owner: its capability check and dispatch. */
export interface ActionHandler<A extends { kind: string }> {
  capability(action: A): Capability;
  dispatch(action: A): unknown;
}

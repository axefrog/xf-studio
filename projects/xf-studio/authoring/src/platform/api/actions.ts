/**
 * Action descriptors and action tables: the shape every system family and feature module
 * registers (feature-module platform §1, §4). Types and small pure helpers only.
 */

/**
 * Undo policy: `part` records one step of the look history for the owning feature's part (feature-module
 * platform §3); `transaction` belongs to a continuous edit (a gesture or a form control) that records one
 * step for the whole run; `recovery` is undone through the collection's recovery queue (removed presets,
 * earlier drafts), not the look history; `none` records nothing.
 */
export type UndoPolicy = "none" | "part" | "transaction" | "recovery";
export type ValueSchema = { type: "string" | "number" | "number|string" | "integer" | "boolean" | "enum" | "object" | "bytes";
  required: boolean; from: "target" | "state" | "input"; min?: number; max?: number;
  minLength?: number; maxLength?: number;
  values?: readonly (string | number)[] };
export type PayloadSchema = Record<string, ValueSchema>;
/** What an action changes: only the selection, authored content, workspace view state, the library or files. */
export type ActionEffect = "selection" | "content" | "workspace" | "library" | "file";
export type ActionDescriptor<Scope extends string = string> = { scope: readonly Scope[]; undo: UndoPolicy;
  payload: PayloadSchema; variants?: Record<string, { payload: PayloadSchema; undo: UndoPolicy }>;
  effect: ActionEffect };

import type { Capability } from "./capability";
import type { FeatureResult, FeatureState } from "./document";
import type { HistoryLabel } from "./history";

/** The unit of a numeric or text input, for control labels, hints and scripts. */
export type LimitUnit = "uv" | "fraction" | "count" | "degrees" | "pixels" | "characters" | "index";
/**
 * Current limits for one input field of an action on a concrete target. `min`/`max`
 * include state-dependent bounds (for example irregular Glitter flake size depends on
 * flake count); `requires` explains a mode the target must be in first. Advisory, like
 * every capability: dispatch and the part's parser remain authoritative.
 */
export type FieldLimit = { min?: number; max?: number; minLength?: number; maxLength?: number;
  unit?: LimitUnit; dependsOn?: string[]; note?: string; requires?: { reason: string } };
/**
 * Units by input field: `field` for the action's own fields; with a command or key variant, `variant.field`
 * for every field the variant uses (its own and the action's).
 */
export type SpecUnits = Readonly<Record<string, LimitUnit>>;
/**
 * What an action replaces beyond the generic consequence rule (derived from its effect and Undo policy),
 * for example a removal that takes content away (feature-module platform §4).
 */
export type ConsequenceOverride = { readonly replaces?: "draft" | "preset" | "layer-content" };

/**
 * One registered action: its descriptor (scope, payload, variants, effect and Undo policy) and the
 * units of its inputs. A feature's actions add their pure capability, apply, history label,
 * state-dependent limits and consequence override (feature-module platform §1, steps 1–5).
 */
// `A` names the action this spec describes; a feature's spec types label, limits and apply with it.
export type ActionSpec<A extends { kind: string } = { kind: string }, Scope extends string = string> = {
  readonly descriptor: ActionDescriptor<Scope>;
  readonly units?: SpecUnits;
};

/**
 * The static limits of an action's inputs (from its descriptor's payload and its spec's units): every
 * numeric, enumerated or text input the person provides, with its range, length and unit.
 */
export function inputLimits(descriptor: ActionDescriptor, units: SpecUnits | undefined, variant?: string): Record<string, FieldLimit> {
  const fields = { ...descriptor.payload, ...(variant ? descriptor.variants?.[variant]?.payload : undefined) };
  const limits: Record<string, FieldLimit> = {};
  for (const [name, schema] of Object.entries(fields)) {
    if (schema.from !== "input" || schema.type === "object" || schema.type === "boolean" || schema.type === "bytes") continue;
    const unit = units?.[[variant, name].filter(Boolean).join(".")];
    limits[name] = { ...(schema.min === undefined ? {} : { min: schema.min }), ...(schema.max === undefined ? {} : { max: schema.max }),
      ...(schema.minLength === undefined ? {} : { minLength: schema.minLength }),
      ...(schema.maxLength === undefined ? {} : { maxLength: schema.maxLength }), ...(unit ? { unit } : {}) };
  }
  return limits;
}
/** Compile-time exhaustive: exactly one spec per kind of the owner's action union. */
export type ActionTable<A extends { kind: string }, Scope extends string = string> =
  { readonly [K in A["kind"]]: ActionSpec<Extract<A, { kind: K }>, Scope> };

/**
 * A feature action: its descriptor plus a pure capability check and a pure apply over the
 * feature's part and editor state (feature-module platform §1). Refusals carry their code.
 */
export type FeatureActionSpec<P, E, A extends { kind: string } = { kind: string }, Scope extends string = string, X = unknown> =
  ActionSpec<A, Scope> & {
    capability(state: FeatureState<P, E>, action: A): Capability;
    /**
     * Throws when the capability refuses; never mutates `state`. Deterministic: the same state and
     * action always give the same result, so an action that creates an item must carry its ID.
     */
    apply(state: FeatureState<P, E>, action: A): FeatureResult<P, E, X>;
    /**
     * The action with the IDs of the items it creates filled in from the host's ID source, for the
     * actions that create any (the host calls it before `apply`; existing IDs are kept).
     */
    assignIds?(action: A, newId: () => string): A;
    /** What the action's Undo step is called in menus and the History panel (the look history's label). */
    label(action: A): HistoryLabel;
    /**
     * The state-dependent limits of the action's inputs on `target`, refining `base` (the static
     * `inputLimits`); absent when the static limits are the whole story.
     */
    limits?(state: FeatureState<P, E>, target: FeatureTarget, variant: string | undefined, base: Record<string, FieldLimit>):
      Record<string, FieldLimit>;
    /** What this action replaces beyond the generic consequence rule; undefined when the rule says it all. */
    consequence?(action: A): ConsequenceOverride | undefined;
  };
/** The target an input limit is asked for (a layer, point, field, preset…), as the presentation names it. */
export type FeatureTarget = { readonly kind: string; readonly id?: string; readonly layerId?: string };
export type FeatureActionTable<P, E, A extends { kind: string }, Scope extends string = string, X = unknown> =
  { readonly [K in A["kind"]]: FeatureActionSpec<P, E, Extract<A, { kind: K }>, Scope, X> };

/**
 * Build an owner's table from an existing descriptor record. `kinds` is a record over the
 * owner's action union, so a missing or foreign kind is a compile error; its key order is
 * the registration order.
 */
export function actionTable<A extends { kind: string }, Scope extends string>(
  descriptors: { readonly [K in A["kind"]]: ActionDescriptor<Scope> },
  kinds: Readonly<Record<A["kind"], true>>,
  /** Each kind's input units (`field` or `variant.field`), where it has any. */
  units: Partial<Record<A["kind"], SpecUnits>> = {}): ActionTable<A, Scope> {
  const table: Record<string, ActionSpec<{ kind: string }, Scope>> = {};
  for (const kind of Object.keys(kinds) as A["kind"][]) {
    const descriptor = descriptors[kind];
    if (!descriptor) throw Error(`Action ${kind} has no descriptor.`);
    const own = units[kind];
    table[kind] = Object.freeze({ descriptor, ...(own ? { units: Object.freeze({ ...own }) } : {}) });
  }
  for (const kind of Object.keys(units)) if (!(kind in table)) throw Error(`Units name ${kind}, which is not an action of this table.`);
  return Object.freeze(table) as ActionTable<A, Scope>;
}

/** The nested command or key variant a concrete action selects, if any. */
export function variantOf(action: { kind: string }): string | undefined {
  const payload = action as unknown as Record<string, unknown>;
  const variant = payload.command && typeof payload.command === "object"
    ? (payload.command as { kind?: unknown }).kind : payload.key;
  return typeof variant === "string" ? variant : undefined;
}

/** Undo policy of a concrete action: its command or key variant's policy first, else the descriptor's. */
export function undoPolicyOf(descriptor: ActionDescriptor, action: { kind: string }): UndoPolicy {
  const variant = variantOf(action);
  return (variant !== undefined ? descriptor.variants?.[variant]?.undo : undefined) ?? descriptor.undo;
}

/**
 * A feature's table: each kind's descriptor plus the module's pure capability and apply,
 * which narrow the action by kind themselves. Same exhaustiveness as `actionTable`.
 */
export function featureActionTable<P, E, A extends { kind: string }, Scope extends string, X>(
  descriptors: { readonly [K in A["kind"]]: ActionDescriptor<Scope> },
  kinds: Readonly<Record<A["kind"], true>>,
  behaviour: { capability(state: FeatureState<P, E>, action: A): Capability;
    apply(state: FeatureState<P, E>, action: A): FeatureResult<P, E, X>;
    assignIds?(action: A, newId: () => string): A;
    label(action: A): HistoryLabel;
    /** Each kind's input units. */
    units?: Partial<Record<A["kind"], SpecUnits>>;
    /** State-dependent limits, by kind: the kinds it names get a spec `limits` (see `FeatureActionSpec.limits`). */
    limits?: Partial<Record<A["kind"], NonNullable<FeatureActionSpec<P, E, A, Scope, X>["limits"]>>>;
    /** Consequence overrides (see `FeatureActionSpec.consequence`). */
    consequence?(action: A): ConsequenceOverride | undefined }): FeatureActionTable<P, E, A, Scope, X> {
  const base = actionTable<A, Scope>(descriptors, kinds, behaviour.units) as Readonly<Record<string, ActionSpec<A, Scope>>>;
  const table: Record<string, FeatureActionSpec<P, E, A, Scope, X>> = {};
  for (const [kind, spec] of Object.entries(base)) {
    const limits = behaviour.limits?.[kind as A["kind"]];
    table[kind] = Object.freeze({ descriptor: spec.descriptor, ...(spec.units ? { units: spec.units } : {}),
      capability: (state: FeatureState<P, E>, action: A) => behaviour.capability(state, action),
      apply: (state: FeatureState<P, E>, action: A) => behaviour.apply(state, action),
      label: (action: A) => behaviour.label(action),
      ...(behaviour.assignIds ? { assignIds: behaviour.assignIds } : {}),
      ...(limits ? { limits } : {}),
      ...(behaviour.consequence ? { consequence: behaviour.consequence } : {}) });
  }
  for (const kind of Object.keys(behaviour.limits ?? {})) if (!(kind in table)) throw Error(`Limits name ${kind}, which is not an action of this table.`);
  return Object.freeze(table) as unknown as FeatureActionTable<P, E, A, Scope, X>;
}

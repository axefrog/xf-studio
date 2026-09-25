/**
 * Action descriptors and action tables: the shape every system family and feature module
 * registers (feature-module platform §1, §4). Types and small pure helpers only.
 */

/** Undo policy. `recipe` is today's per-preset content entry; it becomes the look history's
 * part entry when the look model lands (feature-module platform §3, migration step 4). */
export type UndoPolicy = "none" | "recipe" | "transaction" | "recovery";
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

/**
 * One registered action. Migration step 1 registers the existing descriptor (scope,
 * payload, variants, effect and Undo policy) as-is; history labels, limits/units and
 * consequence overrides join the spec in later steps (feature-module platform §8).
 */
// `A` names the action this spec describes; later steps type label, limits and apply with it.
export type ActionSpec<A extends { kind: string } = { kind: string }, Scope extends string = string> = {
  readonly descriptor: ActionDescriptor<Scope>;
};
/** Compile-time exhaustive: exactly one spec per kind of the owner's action union. */
export type ActionTable<A extends { kind: string }, Scope extends string = string> =
  { readonly [K in A["kind"]]: ActionSpec<Extract<A, { kind: K }>, Scope> };

/**
 * Build an owner's table from an existing descriptor record. `kinds` is a record over the
 * owner's action union, so a missing or foreign kind is a compile error; its key order is
 * the registration order.
 */
export function actionTable<A extends { kind: string }, Scope extends string>(
  descriptors: { readonly [K in A["kind"]]: ActionDescriptor<Scope> },
  kinds: Readonly<Record<A["kind"], true>>): ActionTable<A, Scope> {
  const table: Record<string, ActionSpec<{ kind: string }, Scope>> = {};
  for (const kind of Object.keys(kinds) as A["kind"][]) {
    const descriptor = descriptors[kind];
    if (!descriptor) throw Error(`Action ${kind} has no descriptor.`);
    table[kind] = Object.freeze({ descriptor });
  }
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

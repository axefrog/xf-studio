/**
 * Builders for action descriptors (the platform's `ActionDescriptor` shape): pure, with no state or I/O, so the
 * system families' table (`studio-action-descriptors.ts`) and eye makeup's (`eye-makeup-descriptors.ts`) share them.
 */
import type { ActionDescriptor, PayloadSchema, UndoPolicy, ValueSchema } from "./platform/api";

export const target = (type: ValueSchema["type"]): ValueSchema => ({ type, required: true, from: "target" });
export const input = (type: ValueSchema["type"], min?: number, max?: number): ValueSchema =>
  ({ type, required: true, from: "input", ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) });
export const inputText = (minLength?: number, maxLength?: number): ValueSchema =>
  ({ type: "string", required: true, from: "input", minLength, maxLength });
export const state = (type: ValueSchema["type"]): ValueSchema => ({ type, required: true, from: "state" });
export const enumerated = (values: readonly (string | number)[], from: ValueSchema["from"] = "input"): ValueSchema =>
  ({ type: "enum", required: true, from, values });
/** One descriptor: its scopes, effect, Undo policy, payload and named variants (each with its own Undo policy when it differs). */
export const describe = <Scope extends string>(scope: Scope | readonly Scope[], effect: ActionDescriptor<Scope>["effect"],
  undo: UndoPolicy, payload: PayloadSchema = {}, variants?: Record<string, PayloadSchema>,
  variantUndo?: Record<string, UndoPolicy>): ActionDescriptor<Scope> =>
  ({ scope: typeof scope === "string" ? [scope] : scope, effect, undo, payload,
    ...(variants ? { variants: Object.fromEntries(Object.entries(variants).map(([key, fields]) =>
      [key, { payload: fields, undo: variantUndo?.[key] ?? undo }])) } : {}) });

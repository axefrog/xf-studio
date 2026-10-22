/**
 * Named targets (profiles design §3.6): the fields an action names what it acts on with, the same in every family. An action's descriptor
 * declares which it needs (payload fields with `from: "target"` under these names); the input layer fills them from what it resolved (a
 * panel's binding, the editing context) before it dispatches, and the owner validates what arrives. No application service reads focus.
 *
 * | Field | Names | Families |
 * |---|---|---|
 * | `view` | a view | `camera.*`, `preview.*`, `motion.*`, `view.setTool`, `pose.*` that move the V |
 * | `scene`, `sceneGen` | a scene, and the `gen` it was resolved at | `scene.*`; `sceneGen` also on view actions that edit the scene |
 * | `character` | a V | `character.*` |
 * | `look` | a look (`LookRef`) | every feature's action (eye makeup's `layer.*`, `point.*`, `field.*` …; Expressions') |
 * | `collection` | a collection | `preset.*`, `collection.*`, `package.*` |
 * | `scope` | a history scope | `history.*` |
 * | `tab` | a layout tab | `layout.set` |
 *
 * `saves.*` name their panel `instance` and `profile.*` their `profile` and `base`; their owners take them as they always did.
 */
import { TARGET_FIELDS, type ActionDescriptor, type TargetField } from "../platform/api/actions";
import type { ViewId } from "../platform/api/view-graph";
import type { LookRef } from "../library/collection-documents";

export { TARGET_FIELDS, TARGET_SCHEMA, type TargetField } from "../platform/api/actions";
/** Targets an input layer resolved, by field. */
export type NamedTargets = { readonly view?: ViewId; readonly scene?: string; readonly sceneGen?: number; readonly character?: string;
  readonly look?: LookRef; readonly collection?: string; readonly scope?: string; readonly tab?: string };
/** Why an action that needs a target and names none is refused (`missing_target`): what the person can do. */
export const NO_TARGET: Readonly<Record<TargetField, string>> = Object.freeze({
  view: "Open a 3D view to use this.",
  scene: "Choose a 3D view that shows a V first.",
  sceneGen: "Choose a 3D view that shows a V first.",
  character: "Choose a V first.",
  look: "Choose a look first.",
  collection: "Open a collection first.",
  scope: "Nothing to undo here yet.",
  tab: "Open a layout tab first.",
});

const isTargetField = (name: string): name is TargetField => (TARGET_FIELDS as readonly string[]).includes(name);
/** The named-target fields a descriptor declares, and whether each is required. */
export function targetFields(descriptor: Pick<ActionDescriptor, "payload">): { field: TargetField; required: boolean }[] {
  return Object.entries(descriptor.payload).filter(([name, schema]) => schema.from === "target" && isTargetField(name))
    .map(([name, schema]) => ({ field: name as TargetField, required: schema.required }));
}
/** The first required named target an action leaves out, if any. */
export function missingTarget(descriptor: Pick<ActionDescriptor, "payload">, action: object): TargetField | undefined {
  const named = action as Record<string, unknown>;
  return targetFields(descriptor).find(({ field, required }) => required && (named[field] === undefined || named[field] === null))?.field;
}
/**
 * The action with every named target its descriptor declares and it leaves out filled from `named` (what the input layer resolved). A
 * target the action names already is kept: the input layer never overrides what its caller chose.
 */
export function nameTargets<A extends object>(action: A, descriptor: Pick<ActionDescriptor, "payload"> | undefined, named: NamedTargets): A {
  if (!descriptor) return action;
  const filled: Record<string, unknown> = {};
  for (const { field } of targetFields(descriptor)) {
    if ((action as Record<string, unknown>)[field] !== undefined) continue;
    const value = named[field];
    if (value !== undefined) filled[field] = field === "look" ? { collection: (value as LookRef).collection, look: (value as LookRef).look } : value;
  }
  return Object.keys(filled).length ? { ...action, ...filled } : action;
}
/** An action family's actions with the targets they name added (a union stays a union). */
export type Naming<A, T> = A extends unknown ? A & T : never;
/**
 * An action as a presentation builds it (profiles design §3.6): its named targets may be left for the input layer to fill in, which it
 * does from what the panel, key binding or palette command resolves before anything is dispatched.
 */
export type Unnamed<A> = A extends unknown ? Omit<A, TargetField & keyof A> & Partial<Pick<A, TargetField & keyof A>> : never;

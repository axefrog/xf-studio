import type { EditingDocument } from "./editing-document";
import type { GestureEdit } from "./recipe-actions";
import type { Capability } from "../../platform/api/capability";
import type { Layer, Point, WarpField } from "./recipe";
import { gestureHistoryLabel, type HistoryLabel } from "./history-labels";
const GESTURE_TRANSACTION = { empty: "unchanged", revert: "changed" } as const;
type Transaction = ReturnType<EditingDocument["history"]["begin"]>;

import { MAIN_VIEW, type ViewId } from "../../platform/api/view-graph";

/**
 * The view a gesture comes from (view-graph-design.md §3.8): a 3D view (`main`) or the flat editor's view (`uv`, eye makeup's UV
 * map, a module-registered flat view kind from P6). Callers may pass a bare view ID; the on-head editor's earlier name `surface`
 * means the main 3D view.
 */
export type GestureSource = { readonly view: ViewId };
export type GestureOrigin = GestureSource | ViewId;
export type GestureProposal =
  | { kind: "shape.replace"; next: Layer }
  | { kind: "point.replace"; index: number; next: Partial<Point> }
  | { kind: "field.replace"; fieldId: string; next: Partial<WarpField> }
  | { kind: "path.replacePoints"; points: Point[] };
export type GestureTarget = { kind: "shape" | "path" } | { kind: "point"; index: number } | { kind: "field"; fieldId: string };
/** The flat UV editor's view ID. */
export const FLAT_EDITOR_VIEW: ViewId = "uv";
export function gestureSource(origin: GestureOrigin): GestureSource {
  const view = typeof origin === "string" ? origin : origin.view;
  return { view: view === "surface" ? MAIN_VIEW : view };
}
/** Whether a gesture comes from a 3D view (it needs the 3D preview), rather than the flat editor. */
export const fromView3d = (origin: GestureOrigin) => gestureSource(origin).view !== FLAT_EDITOR_VIEW;
const sameSource = (a: GestureSource | undefined, b: GestureOrigin) => !!a && a.view === gestureSource(b).view;

/**
 * Owns a pointer gesture's Undo transaction through the platform's `HistoryTransaction` (one step,
 * named by the first frame that changed something; Escape restores the start and never creates
 * Redo). This service owns captured target identities; input adapters own coordinates.
 */
export class AuthoringGestures {
  private active?: { source: GestureSource; layer: Layer; scope: string; points: Point[]; fields: Map<string, WarpField>; transaction: Transaction };
  /** `actions.applyGesture` applies one frame through the feature's registered gestures (the eye-makeup port). */
  constructor(private document: EditingDocument, private actions: { applyGesture(edit: GestureEdit): boolean },
    /** The Undo step's name from a frame: the trusted core passes the registered gestures' `label`. */
    private label: (edit: GestureEdit) => HistoryLabel = gestureHistoryLabel, signal?: AbortSignal) {
    signal?.addEventListener("abort", () => { this.active = undefined; }, { once: true });
  }
  begin(origin: GestureOrigin, layer: Layer | undefined) {
    if (!layer || !this.document.recipe.layers.includes(layer)) return false;
    // The look scope's transaction over this document's part: Escape restores the start through the scope, without Redo.
    this.active = { source: gestureSource(origin), layer, scope: this.document.scopeId, points: [...layer.points],
      fields: new Map(layer.fields.map(field => [field.id, field])), transaction: this.document.history.begin([this.document.feature],
      GESTURE_TRANSACTION, { present: () => this.document.recipe.layers.includes(layer) }) };
    return true;
  }
  hasLayer(id: string) { return this.document.recipe.layers.some(layer => layer.id === id); }
  beginLayer(source: GestureOrigin, id: string) { return this.begin(source, this.document.recipe.layers.find(layer => layer.id === id)); }
  capability(source: GestureOrigin, target: GestureTarget): Capability {
    const session = this.active;
    const missing = (reason: string): Capability => ({ available: false, code: "missing_target", reason });
    if (!session || !sameSource(session.source, source)) return { available: false, code: "not_ready", reason: "Begin a gesture on the target layer first." };
    if (this.document.scopeId !== session.scope) return missing("This view now shows another look.");
    if (!this.document.recipe.layers.includes(session.layer)) return missing("That gesture layer was replaced.");
    if (target.kind === "point" && (!session.points[target.index] || session.layer.points[target.index] !== session.points[target.index]))
      return missing("That control point was replaced.");
    if (target.kind === "field" && (!session.fields.has(target.fieldId) || session.layer.fields.find(field => field.id === target.fieldId) !== session.fields.get(target.fieldId)))
      return missing("That warp control was replaced.");
    return { available: true };
  }
  propose(source: GestureOrigin, proposal: GestureProposal) {
    const target: GestureTarget = proposal.kind === "point.replace" ? { kind: "point", index: proposal.index } :
      proposal.kind === "field.replace" ? { kind: "field", fieldId: proposal.fieldId } :
      proposal.kind === "path.replacePoints" ? { kind: "path" } : { kind: "shape" };
    if (!this.capability(source, target).available) return false;
    const session = this.active!, base = { layerId: session.layer.id, expectedLayer: session.layer };
    const action: GestureEdit = proposal.kind === "point.replace" ? { ...base, ...proposal, expectedPoint: session.points[proposal.index] } :
      proposal.kind === "field.replace" ? { ...base, ...proposal, expectedField: session.fields.get(proposal.fieldId)! } : { ...base, ...proposal };
    return this.apply(source, action);
  }
  apply(source: GestureOrigin, action: GestureEdit) {
    const active = this.active;
    if (!active || !sameSource(active.source, source) || active.layer !== action.expectedLayer ||
      !this.document.recipe.layers.includes(active.layer)) return false;
    const changed = this.actions.applyGesture(action);
    active.transaction.applied(changed, () => this.label(action));
    return changed;
  }
  commit(source: GestureOrigin) {
    const active = this.active;
    if (active && sameSource(active.source, source)) {
      this.active = undefined;
      active.transaction.commit();
    }
  }
  cancel(source: GestureOrigin) {
    const active = this.active;
    if (!active || !sameSource(active.source, source)) return;
    this.active = undefined;
    active.transaction.cancel();
  }
  snapshot() { return this.active ? { source: this.active.source.view, layerId: this.active.layer.id,
    changed: this.active.transaction.changed } : undefined; }
}

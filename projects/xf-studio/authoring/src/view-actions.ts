/**
 * The views family (view-graph-design.md §3.4, §3.6, §3.9): commands on the view graph itself rather than on one device. DOM-free.
 *
 * - `view.setTool` turns a view tool on or off in that view's tools node (Surface controls, Plate wireframe). Tools are
 *   affordances: they record no View and lighting step. A hidden module's tools stay dispatchable (module visibility is
 *   presentation state the application never reads, design §4.2); they simply are not derived into any view, and the presentation
 *   withdraws them (`withdraw`), so no device acts on them while they aren't offered (UI-102).
 * - `view.undo` and `view.redo` step the View and lighting history, separate from look history.
 * - `view.endEdit` ends a continuous edit: the next light or display change starts a new step even with the same key (a slider was
 *   released, CORE-95). Controls send it when a drag or a keyboard burst ends.
 *
 * Adding, closing, linking and unlinking views are P4; the graph service already supports them.
 */
import { refusal, deriveViewSummaries, deriveViewTools, SET_VIEW_TOOL, type Capability, type ModuleRegistration, type SceneKind, type ViewId,
  type ViewGraphData, type ViewToolFilter } from "./platform/api";
import type { ViewGraph } from "./platform/core/view-graph";
import { PLATFORM_VIEW_TOOLS } from "./platform/core/view-tools";
import { createStudioViewGraph } from "./preview-view-graph";
import type { PreviewState } from "./workspace-state";

export type ViewAction =
  | { kind: "view.setTool"; view?: ViewId; tool: string; enabled: boolean }
  | { kind: "view.undo" }
  | { kind: "view.redo" }
  | { kind: "view.endEdit" };

/** A composition with no modules (fixtures): only the platform's tools, and no module lists any. */
export const NO_MODULES: ModuleRegistration = Object.freeze({ modules: [], tools: [], summaries: [], scenes: ["character"] });

/**
 * The view graph over a workspace's preview (and its stored views) and the views family over it, with the platform's tools beside
 * the composition's modules. The trusted core builds one per session; fixtures build their own.
 */
export function createViewServices(preview: PreviewState, stored?: ViewGraphData, modules: ModuleRegistration = NO_MODULES) {
  const views = createStudioViewGraph(preview, stored);
  const viewActions = new ViewActions(views, { ...modules, tools: [...PLATFORM_VIEW_TOOLS, ...modules.tools.filter(tool => tool.module !== "platform")] });
  return { views, viewActions };
}

export class ViewActions {
  constructor(private readonly graph: ViewGraph, readonly registration: ModuleRegistration = NO_MODULES) {}
  subscribe(listener: () => void) { return this.graph.subscribe(() => listener()); }
  /** The graph's views, which slots each shares, the focus and the View and lighting history. Detached. */
  snapshot() {
    return { ...this.graph.snapshot(), history: this.graph.history() };
  }
  /** The scene kind a view shows (its own, else the focused view's). */
  sceneKind(view?: ViewId): SceneKind | undefined {
    const snapshot = this.graph.snapshot(), id = view ?? snapshot.focused;
    return snapshot.views.find(item => item.id === id)?.sceneKind;
  }
  /** The tools a view shows for the given module visibility and research preference (design §3.9), in order. */
  tools(view: ViewId | undefined, filter: ViewToolFilter) {
    const kind = this.sceneKind(view);
    return kind ? deriveViewTools(this.registration, kind, filter) : [];
  }
  summaries(view: ViewId | undefined, filter: Pick<ViewToolFilter, "modules">) {
    const kind = this.sceneKind(view);
    return kind ? deriveViewSummaries(this.registration, kind, filter) : [];
  }
  /** Whether a view's tool is on (its tools node). */
  toolOn(view: ViewId, tool: string) { return this.graph.state<{ on: Record<string, boolean> }>(view, "tools").on[tool] === true; }
  /**
   * The tools the presentation no longer offers (UI-102): those of hidden modules, and research tools while research tools are off.
   * Each view keeps its choice and no device acts on them until they are offered again. The presentation passes tool IDs, never its
   * module visibility (design §6.3 rule 6).
   */
  withdraw(tools: readonly string[]) { this.graph.withdrawTools(tools.filter(id => this.registration.tools.some(tool => tool.id === id))); }
  capability(action: ViewAction): Capability {
    if (action.kind === "view.undo") return this.graph.history().depth ? { available: true } : refusal("invalid_value", "There is no view or lighting change to undo.");
    if (action.kind === "view.redo") return this.graph.history().redoDepth ? { available: true } : refusal("invalid_value", "There is no undone view or lighting change to redo.");
    if (action.kind === "view.endEdit") return { available: true };
    if (action.view !== undefined && !this.graph.has(action.view)) return refusal("missing_target", "That view no longer exists.");
    const tool = this.registration.tools.find(item => item.id === action.tool);
    if (!tool || tool.dispatches !== SET_VIEW_TOOL) return refusal("invalid_value", "That view tool does not exist.");
    const kind = this.sceneKind(action.view);
    if (!kind || !tool.scenes.includes(kind)) return refusal("incompatible_mode", `${tool.label} doesn't apply to this view.`);
    if (typeof action.enabled !== "boolean") return refusal("invalid_value", "Choose on or off.");
    return { available: true };
  }
  dispatch(action: ViewAction): undefined {
    const allowed = this.capability(action);
    if (!allowed.available) throw Error(allowed.reason);
    if (action.kind === "view.undo") this.graph.undo();
    else if (action.kind === "view.redo") this.graph.redo();
    else if (action.kind === "view.endEdit") this.graph.seal();
    else {
      const view = this.graph.target(action.view);
      const on = this.graph.state<{ on: Record<string, boolean> }>(view, "tools").on;
      this.graph.edit(view, "tools", { state: { on: { ...on, [action.tool]: action.enabled } } });
    }
    return undefined;
  }
}

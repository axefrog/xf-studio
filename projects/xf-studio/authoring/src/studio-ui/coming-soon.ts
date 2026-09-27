/**
 * Coming soon (research/authoring/ui-copy-and-layout-review.md §6): a decided feature that isn't built yet shows where it will live as a
 * visible, disabled control whose reason is "Coming soon: <what it will let you do>". Only features with an agreed design are listed,
 * each with the design it follows. Planned *modules* are listed in the module registry instead (`PLANNED_MODULES`, compose/modules.ts).
 *
 * Each entry names the key of the live feature that replaces it: a module ID (`module:`), an action kind (`action:`), a view tool ID
 * (`tool:`) or an exporter's feature (`exporter:`). The presentation hides an entry whose feature it can see is live (`comingSoon`),
 * and tests/coming-soon.test.ts fails while an entry and its live feature both exist, so the feature that lands deletes its entry here
 * in the same change. If a feature lands under another name, change its key or delete the entry.
 */
export type ComingSoonKey = `module:${string}` | `action:${string}` | `tool:${string}` | `exporter:${string}`;
export type ComingSoonEntry = {
  /** The control's label where it has one. */
  readonly label: string;
  /** The unavailable reason, always "Coming soon: …". */
  readonly reason: string;
  readonly key: ComingSoonKey;
  /** The design it follows (a repository path and section). */
  readonly design: string;
};

export const COMING_SOON = {
  viewsNew: { label: "New view", reason: "Coming soon: open another 3D view of your V.",
    key: "action:view.create", design: "research/authoring/view-graph-design.md (P4)" },
  viewsDuplicate: { label: "Duplicate view (shared camera)", reason: "Coming soon: a second view of this scene that moves with this view's camera.",
    key: "action:view.duplicate", design: "research/authoring/view-graph-design.md (P4)" },
  expressionHandles: { label: "Face handles", reason: "Coming soon: drag handles on the face to shape the expression.",
    key: "tool:expressions.handles", design: "research/animation/expression-editor-design.md (phase 2)" },
  expressionSculpt: { label: "Sculpt", reason: "Coming soon: push and pull the face directly, and the controls follow.",
    key: "tool:expressions.sculpt", design: "research/animation/expression-editor-design.md (sculpt mode, Option 3)" },
  expressionExport: { label: "Export to game", reason: "Coming soon: build this expression into your mod for photo mode.",
    key: "exporter:expressions", design: "research/animation/expression-editor-design.md (phase 3)" },
  savesEdit: { label: "Edit values", reason: "Coming soon: change values in your save.",
    key: "action:saves.setValue", design: "research/save/save-editor-design.md §7.2" },
} as const satisfies Record<string, ComingSoonEntry>;
export type ComingSoonId = keyof typeof COMING_SOON;

/** What the presentation can see of the live Studio: registered action kinds, module IDs and view tool IDs. */
export type LiveFeatures = { actions(): readonly string[]; modules(): readonly string[]; tools(): readonly string[] };

/** Whether a key's feature is live, as far as `live` can see (an exporter is known only to the composition; tests check those). */
export function isLive(key: ComingSoonKey, live: LiveFeatures): boolean {
  const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (kind === "action") return live.actions().includes(id);
  if (kind === "module") return live.modules().includes(id);
  if (kind === "tool") return live.tools().includes(id);
  return false;
}
/** The placeholder to show, or nothing once its feature is live. */
export function comingSoon(id: ComingSoonId, live: LiveFeatures): ComingSoonEntry | undefined {
  const entry: ComingSoonEntry = COMING_SOON[id];
  return isLive(entry.key, live) ? undefined : entry;
}
/** The live features a runtime's port shows. */
export function liveFeatures(port: { authoring: { registry(): readonly { id: string }[] };
  views: { modules(): readonly { id: string }[]; tools(view: undefined, filter: { modules: readonly string[]; research: boolean }): readonly { id: string }[] } }): LiveFeatures {
  const modules = () => port.views.modules().map(module => module.id);
  return { actions: () => port.authoring.registry().map(entry => entry.id), modules,
    tools: () => port.views.tools(undefined, { modules: modules(), research: true }).map(tool => tool.id) };
}

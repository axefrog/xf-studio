import { keyBinding, shortcutLabel } from "../../input-bindings";
import { button, emptyState, note } from "../controls";
import { h, setAttr, setText } from "../dom";
import { historyCommandTitle, historyRows, historySummary, HISTORY_TRIMMED_NOTE, jumpable, jumpAnnouncement, type HistoryRow } from "../history-model";
import { icon } from "../icons";
import { PANEL_META } from "../panel-meta";
import type { Frame, StudioRuntime } from "../runtime";
import type { PanelController } from "./collection";

type RowView = { element: HTMLLIElement; main: HTMLButtonElement; label: HTMLElement; time: HTMLElement; state: HTMLElement };

/**
 * The current preset's recent changes, oldest first. Clicking a step dispatches one
 * `history.jumpTo`; the application performs the Undo or Redo steps and refuses while an
 * adjustment is open. Undone steps stay listed (dimmed) until a new change discards them.
 */
export function historyPanel(rt: StudioRuntime): PanelController {
  const port = rt.port, keys = { undo: shortcutLabel("shell.undo"), redo: shortcutLabel("shell.redo") };
  const summary = h("span", { class: "count" });
  const undo = button({ label: "Undo", icon: "undo", small: true, variant: "quiet", onClick: () => { rt.dispatch({ kind: "recipe.undo" }); } });
  const redo = button({ label: "Redo", icon: "redo", small: true, variant: "quiet", onClick: () => { rt.dispatch({ kind: "recipe.redo" }); } });
  const trimmed = h("p", { class: "note info history-trimmed" }, icon("info"),
    h("span", { text: `${HISTORY_TRIMMED_NOTE}. Only the latest changes are kept for each preset.` }));
  const list = h("ol", { class: "history-list", "aria-label": "Changes to this preset, oldest first" });
  const empty = emptyState("No changes yet", "Your edits to this preset appear here, oldest first. Click any step to go back to it.");
  const noPreset = emptyState("No preset selected", "History belongs to a preset. Select or add a preset to see its changes.");
  const help = note(`Click a step to go back to it. Steps after it stay listed, dimmed, until you make a new change, so you can go forward again. ${keys.undo} and ${keys.redo} move one step at a time.`);
  const element = h("div", { class: "panel-content history-panel" },
    h("div", { class: "list-head" }, h("span", { class: "eyebrow" }, summary), h("div", { class: "row gap-xs" }, undo, redo)),
    noPreset, empty, trimmed, list, help);
  rt.anchors.register("history.list", list);

  const views = new Map<string, RowView>();
  let rows: HistoryRow[] = [], key = "", blocked: string | undefined, lastCurrent = "";
  const focusRow = (id: string) => views.get(id)?.main.focus();
  const jump = (id: string) => {
    const row = rows.find(item => item.id === id);
    if (!row || !jumpable(row)) return;
    if (rt.dispatch({ kind: "history.jumpTo", entryId: id })) {
      rt.feedback.announce(jumpAnnouncement(row));
      requestAnimationFrame(() => focusRow(id));
    }
  };
  const keydown = (event: KeyboardEvent, id: string) => {
    if (keyBinding("rows", event)?.id !== "rows.focus") return;
    event.preventDefault();
    const index = rows.findIndex(row => row.id === id);
    const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 :
      Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)));
    focusRow(rows[next].id);
  };
  const create = (id: string): RowView => {
    const label = h("span", { class: "history-label" }), time = h("span", { class: "history-time" });
    const state = h("span", { class: "history-state" });
    const main = h("button", { class: "history-step", type: "button" }, h("span", { class: "history-marker", "aria-hidden": "true" }), label, state, time);
    main.addEventListener("click", () => jump(id));
    main.addEventListener("keydown", event => keydown(event, id));
    return { element: h("li", { class: "history-row" }, main), main, label, time, state };
  };

  return {
    spec: { id: "history", ...PANEL_META["history"], element },
    update(frame: Frame) {
      const timeline = frame.history, draft = frame.library.draft;
      const hasPreset = !draft || !!draft.selected;
      const undoCap = port.authoring.capability({ kind: "recipe.undo" }), redoCap = port.authoring.capability({ kind: "recipe.redo" });
      const labels = port.authoring.history();
      undo.disabled = !undoCap.available; undo.title = historyCommandTitle("undo", undoCap, labels.undo?.label, keys.undo);
      redo.disabled = !redoCap.available; redo.title = historyCommandTitle("redo", redoCap, labels.redo?.label, keys.redo);
      setText(summary, hasPreset ? historySummary(timeline) : "No preset");
      // One capability stands for every row: jumps are refused for the same reason (busy, no preset).
      rows = hasPreset ? historyRows(timeline) : [];
      const probe = rows.find(jumpable);
      const capability = probe ? port.authoring.capability({ kind: "history.jumpTo", entryId: probe.id }) : { available: true };
      blocked = capability.available || capability.code === "missing_target" ? undefined : capability.reason;
      noPreset.hidden = hasPreset;
      empty.hidden = !hasPreset || timeline.steps.length > 0;
      trimmed.hidden = !hasPreset || !timeline.trimmed;
      list.hidden = !hasPreset || timeline.steps.length === 0;
      const nextKey = JSON.stringify([rows, blocked]);
      if (nextKey === key) return;
      key = nextKey;
      const ids = new Set(rows.map(row => row.id));
      for (const [id, view] of views) if (!ids.has(id)) { view.element.remove(); views.delete(id); }
      const focused = document.activeElement;
      const current = rows.find(row => row.kind === "current");
      rows.forEach((row, index) => {
        let view = views.get(row.id);
        if (!view) { view = create(row.id); views.set(row.id, view); }
        if (list.children[index] !== view.element) list.insertBefore(view.element, list.children[index] ?? null);
        view.element.dataset.kind = row.kind;
        setText(view.label, row.label);
        setText(view.time, row.time ?? "");
        setText(view.state, row.kind === "current" ? "Current" : "");
        setAttr(view.main, "aria-current", row.kind === "current" ? "step" : undefined);
        setAttr(view.main, "aria-label", row.description);
        setAttr(view.main, "aria-disabled", blocked && row.kind !== "current" ? "true" : undefined);
        view.main.title = row.kind === "current" ? "The look as it is now" : blocked ? blocked :
          row.kind === "undone" ? `Redo up to “${row.label}”` : row.kind === "start" ? "Go back to before the first listed step" : `Go back to just after “${row.label}”`;
        view.main.tabIndex = row.kind === "current" ? 0 : -1;
      });
      // Keep keyboard focus in the list when the focused row was removed, and keep the current step in view.
      if (focused instanceof HTMLElement && !focused.isConnected && current) focusRow(current.id);
      if (current && current.id !== lastCurrent) {
        lastCurrent = current.id;
        requestAnimationFrame(() => views.get(current.id)?.element.scrollIntoView({ block: "nearest" }));
      }
    },
  };
}

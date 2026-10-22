import { keyBinding, shortcutLabel } from "../../app/input-bindings";
import { button, emptyState } from "../controls";
import { h, setAttr, setText, setUnavailable } from "../dom";
import { helpTip } from "../help-tip";
import { historyCommandTitle, historyHeading, historyRows, HISTORY_TRIMMED_NOTE, jumpable, jumpAnnouncement, type HistoryRow } from "../history-model";
import { icon } from "../icons";
import { PANEL_META } from "../panel-meta";
import type { Frame, StudioRuntime } from "../runtime";
import type { PanelController } from "./collection";

type RowView = { element: HTMLLIElement; main: HTMLButtonElement; label: HTMLElement; time: HTMLElement; state: HTMLElement };

/**
 * The editing context's recent changes (what was last edited: a preset or a V), oldest first, under a summary that names it
 * ("Smoky · 1 step"; the name truncates first, the whole line its tooltip). Clicking a step dispatches one
 * `history.jumpTo`; the application performs the Undo or Redo steps and refuses while an
 * adjustment is open. Undone steps stay listed (dimmed) until a new change discards them.
 */
export function historyPanel(rt: StudioRuntime): PanelController {
  const port = rt.port, keys = { undo: shortcutLabel("shell.undo"), redo: shortcutLabel("shell.redo") };
  // Whose history this is, then how many steps (H6): the name truncates first, and the whole line is the summary's tooltip.
  const summaryName = h("span", { class: "history-context-name" }), summaryCount = h("span", { class: "count" });
  const summary = h("span", { class: "eyebrow history-context" }, summaryName, summaryCount);
  const undo = button({ label: "Undo", icon: "undo", small: true, variant: "quiet", onClick: () => { rt.dispatch({ kind: "history.undo" }); } });
  const redo = button({ label: "Redo", icon: "redo", small: true, variant: "quiet", onClick: () => { rt.dispatch({ kind: "history.redo" }); } });
  const trimmed = h("p", { class: "note info history-trimmed" }, icon("info"),
    h("span", { text: `${HISTORY_TRIMMED_NOTE}: only the latest are kept.` }));
  const list = h("ol", { class: "history-list", "aria-label": "Changes, oldest first" });
  // The heading already says "No changes yet" or "Nothing edited", so the empty states say what comes next instead of repeating it.
  const empty = emptyState("Your edits appear here", "Oldest first. Click any step to go back to it.");
  const noPreset = emptyState("Select a preset or change your V", "History follows what you last edited, a preset or a V, and lists its changes here.");
  // How the list works, in a help tip beside its heading (help-tip.ts).
  const help = helpTip("history", `Click a step to go back to it. Steps after it stay listed, dimmed, until you make a new change, so you can go forward again. ${keys.undo} and ${keys.redo} move one step at a time.`);
  const element = h("div", { class: "panel-content history-panel" },
    h("div", { class: "list-head" }, h("span", { class: "control-line history-head" }, summary, help), h("div", { class: "row gap-xs" }, undo, redo)),
    noPreset, empty, trimmed, list);
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
      // The editing context the panel shows (profiles design §3.7), by name.
      const context = timeline.documentLabel ?? port.focus.editing()?.name;
      const hasPreset = !!context || !draft || !!draft.selected;
      setAttr(list, "aria-label", context ? `Changes to ${context}, oldest first` : "Changes, oldest first");
      const undoCap = port.authoring.capability({ kind: "history.undo" }), redoCap = port.authoring.capability({ kind: "history.redo" });
      const labels = port.authoring.history();
      // The main-action pattern (UI-84), as the header's Undo and Redo: unavailable, each stays focusable and says why.
      setUnavailable(undo, !undoCap.available, undoCap.reason); undo.title = historyCommandTitle("undo", undoCap, labels.undo?.label, keys.undo, context);
      setUnavailable(redo, !redoCap.available, redoCap.reason); redo.title = historyCommandTitle("redo", redoCap, labels.redo?.label, keys.redo, context);
      const heading = hasPreset ? historyHeading(context, timeline) : { name: "", count: "Nothing edited", text: "Nothing edited" };
      setText(summaryName, heading.name); summaryName.hidden = !heading.name;
      setText(summaryCount, heading.name ? ` · ${heading.count}` : heading.count);
      summary.title = heading.text;
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
        // Its reason shows in the page's reason tip on focus, hover or a press (UI-84), not only as a tooltip.
        setAttr(view.main, "data-reason", blocked && row.kind !== "current" ? blocked : undefined);
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

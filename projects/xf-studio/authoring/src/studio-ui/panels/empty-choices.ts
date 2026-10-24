import { EmptyChoices, EmptyTargetPointer } from "../components";
import { h } from "../dom";
import type { StudioRuntime } from "../runtime";
import type { PanelController } from "./collection";

/** A shell-owned binding empty state. Features keep their own controllers and receive no new application access. */
export function panelEmptyChoices(rt: StudioRuntime, panel: string, layout: "panel" | "viewport" = "panel") {
  const component = new EmptyChoices(layout), pointer = new EmptyTargetPointer(owner => rt.dock.reveal(owner));
  const element = h("div", { class: "panel-empty-target", hidden: true }, component.element, pointer.element);
  return { element, dispose: () => component.dispose(), update() {
    const state = rt.port.emptyChoices?.snapshot(panel);
    const owner = state?.owner && panel !== state.owner.panel ? state.owner : null;
    element.hidden = !state; pointer.update(owner);
    component.update(state && !owner ? { ...state, choices: state.choices.map(choice => ({ ...choice, choose: () => {
      const pending = rt.port.emptyChoices!.execute(choice.action);
      // Document and session owners publish their optimistic values before the library acknowledges them.
      rt.changed();
      void pending.then(result => {
        rt.report("empty.choose", result); rt.changed();
      });
    } })) } : null);
    return !!state;
  } };
}

/** Compose a missing-target chooser; management panels keep their recovery controls beside it. */
export function withEmptyChoices(rt: StudioRuntime, panel: PanelController): PanelController {
  const empty = panelEmptyChoices(rt, panel.spec.id), content = panel.spec.element, hidden = new Map<HTMLElement, HTMLElement["hidden"]>();
  content.append(empty.element);
  return { ...panel, dispose() { empty.dispose(); panel.dispose?.(); }, update(frame) {
    const missing = empty.update();
    if (!missing || panel.emptyChoices === "alongside") {
      for (const [child, wasHidden] of hidden) child.hidden = wasHidden;
      hidden.clear(); panel.update(frame);
    }
    // A feature may replace its whole content while painting. Keep U6 attached without adding a layout wrapper.
    if (empty.element.parentElement !== content) content.append(empty.element);
    if (missing && panel.emptyChoices !== "alongside") for (const child of [...content.children] as HTMLElement[]) if (child !== empty.element) {
      if (!hidden.has(child)) hidden.set(child, child.hidden);
      child.hidden = true;
    }
  } };
}

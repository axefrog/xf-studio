import { EmptyChoices, EmptyTargetPointer } from "../components";
import { h } from "../dom";
import type { StudioRuntime } from "../runtime";
import type { PanelController } from "./collection";

/** A shell-owned binding empty state. Features keep their own controllers and receive no new application access. */
export function panelEmptyChoices(rt: StudioRuntime, panel: string, layout: "panel" | "viewport" = "panel") {
  let ownerAction: import("../../app/profiles/empty-choices").EmptyChoiceRequest | undefined;
  const component = new EmptyChoices(layout), pointer = new EmptyTargetPointer(owner => {
    if (ownerAction) {
      void rt.port.emptyChoices!.execute(ownerAction).then(result => {
        rt.report("empty.choose", result); rt.changed();
        if (result.ok) {
          const exact = rt.port.emptyChoices?.snapshot(panel)?.owner?.panel;
          if (exact) rt.dock.reveal(exact, false);
        }
      });
      return;
    }
    rt.dock.reveal(owner, false);
    document.querySelector(`[id="empty-choices-${owner}"]`)?.querySelector(".empty-actions")?.querySelector<HTMLButtonElement>("button")?.focus();
  });
  component.element.setAttribute("id", `empty-choices-${panel}`);
  const element = h("div", { class: "panel-empty-target", hidden: true }, component.element, pointer.element);
  return { element, dispose: () => component.dispose(), update() {
    const state = rt.port.emptyChoices?.snapshot(panel);
    const declaredOwner = state?.owner;
    const owner = declaredOwner && panel !== declaredOwner.panel ? declaredOwner : null;
    ownerAction = owner?.action;
    // U5 replaces this existing composition with approved recovery states. No new control or styling is introduced here.
    element.hidden = !state; pointer.update(owner ? { ...owner, panel: owner.panel ?? panel } : null);
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
  const empty = panelEmptyChoices(rt, rt.instance?.id ?? panel.spec.id), content = panel.spec.element, hidden = new Map<HTMLElement, HTMLElement["hidden"]>();
  const attach = () => panel.emptyChoices === "first" ? content.insertBefore(empty.element, content.children[0] ?? null) : content.append(empty.element);
  attach();
  return { ...panel, dispose() { empty.dispose(); panel.dispose(); }, update(frame) {
    const missing = empty.update();
    if (!missing || panel.emptyChoices) {
      for (const [child, wasHidden] of hidden) child.hidden = wasHidden;
      hidden.clear(); panel.update(frame);
    }
    // A feature may replace its whole content while painting. Keep U6 attached without adding a layout wrapper.
    if (empty.element.parentElement !== content || (panel.emptyChoices === "first" && content.children[0] !== empty.element)) attach();
    if (missing && !panel.emptyChoices) for (const child of [...content.children] as HTMLElement[]) if (child !== empty.element) {
      if (!hidden.has(child)) hidden.set(child, child.hidden);
      child.hidden = true;
    }
  } };
}

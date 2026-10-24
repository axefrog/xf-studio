import { h, setUnavailable } from "../dom";

/** A menu's primary row and separate trailing action (lib-menu-secondary). No nested interactive targets. */
export function menuSecondaryRow(main: HTMLElement, secondary: { label: string; name: string; capability?: { available: boolean; reason?: string };
  run(): void }): { element: HTMLElement; action: HTMLElement } {
  const action = h("div", { class: "menu-item menu-secondary danger", role: "menuitem", tabindex: "-1", "aria-label": secondary.name },
    h("span", { class: "menu-label", text: secondary.label }));
  setUnavailable(action, secondary.capability?.available === false, secondary.capability?.reason);
  const activate = () => { if (secondary.capability?.available !== false) secondary.run(); };
  action.addEventListener("click", activate);
  action.addEventListener("pointerenter", () => action.focus());
  action.addEventListener("keydown", event => {
    if (["Enter", " ", "Delete"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); activate(); }
  });
  return { element: h("div", { class: "menu-secondary-row", role: "presentation" }, main, action), action };
}

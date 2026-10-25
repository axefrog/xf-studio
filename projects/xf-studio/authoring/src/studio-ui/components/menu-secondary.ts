import { h, setUnavailable } from "../dom";
import { icon, type IconName } from "../icons";

/** A menu's primary row and separate trailing action (lib-menu-secondary). No nested interactive targets. */
export function menuSecondaryRow(main: HTMLElement, secondary: { icon: IconName; name: string; capability?: { available: boolean; reason?: string };
  /** "danger" (default): the icon turns the danger colour on hover or focus (Delete). "neutral": it turns the accent colour (Use for new layers). */
  tone?: "danger" | "neutral"; run(): void }): { element: HTMLElement; action: HTMLElement } {
  const action = h("div", { class: `menu-item menu-secondary${secondary.tone === "neutral" ? " neutral" : ""}`, role: "menuitem", tabindex: "-1", "aria-label": secondary.name, "data-title": secondary.name },
    h("span", { class: "menu-icon", "aria-hidden": "true" }, icon(secondary.icon)));
  setUnavailable(action, secondary.capability?.available === false, secondary.capability?.reason);
  const activate = () => { if (secondary.capability?.available !== false) secondary.run(); };
  action.addEventListener("click", activate);
  action.addEventListener("pointerenter", () => action.focus());
  action.addEventListener("keydown", event => {
    if (["Enter", " ", "Delete"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); activate(); }
  });
  return { element: h("div", { class: "menu-secondary-row", role: "presentation" }, main, action), action };
}

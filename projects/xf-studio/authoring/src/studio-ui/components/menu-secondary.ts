import { h, setUnavailable } from "../dom";
import { icon, type IconName } from "../icons";

/**
 * One trailing action of a menu row. `tone`: "danger" (default): the icon turns the danger colour on hover or focus (Delete). "neutral": it
 * turns the signal colour on hover or focus (Use for new layers). "accent": it is the signal colour at rest (the one a list has chosen:
 * the default starter's filled star). `pressed` marks a state the action shows rather than offers.
 */
export type MenuSecondary = { icon: IconName; name: string; capability?: { available: boolean; reason?: string };
  tone?: "danger" | "neutral" | "accent"; run(): void };

/**
 * A menu's primary row and its separate trailing actions (lib-menu-secondary): one, or several side by side (a starter's star and bin).
 * No nested interactive targets: each action is a sibling menu item. `actions` are in the order shown.
 */
export function menuSecondaryRow(main: HTMLElement, secondary: MenuSecondary | readonly MenuSecondary[]): { element: HTMLElement; action: HTMLElement; actions: HTMLElement[] } {
  const all = Array.isArray(secondary) ? secondary as readonly MenuSecondary[] : [secondary as MenuSecondary];
  const actions = all.map(item => {
    const action = h("div", { class: `menu-item menu-secondary${item.tone === "neutral" ? " neutral" : item.tone === "accent" ? " accent" : ""}`, role: "menuitem", tabindex: "-1",
      "aria-label": item.name, "data-title": item.name }, h("span", { class: "menu-icon", "aria-hidden": "true" }, icon(item.icon)));
    setUnavailable(action, item.capability?.available === false, item.capability?.reason);
    const activate = () => { if (item.capability?.available !== false) item.run(); };
    action.addEventListener("click", activate);
    action.addEventListener("pointerenter", () => action.focus());
    action.addEventListener("keydown", event => {
      if (["Enter", " ", "Delete"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); activate(); }
    });
    return action;
  });
  return { element: h("div", { class: "menu-secondary-row", role: "presentation" }, main, ...actions), action: actions[0]!, actions };
}

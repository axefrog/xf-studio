import { button } from "../controls";
import { h, setText } from "../dom";
import { icon, iconMarkup } from "../icons";

/** A view pane at rest (c-setup, U7): its title, V and look, and one action to draw it here. */
export type NotDrawnStateData = { readonly title: string; readonly shows: string };
const SHOW_HERE = "Show here";
export const notDrawnStateName = (title: string) => `${title}, not shown. Press Enter to show it here.`;
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Static rendering of this component for the self-contained style guide, owned with its live rendering and interaction. */
export function notDrawnStateMarkup({ title, shows }: NotDrawnStateData): string {
  return `<div class="viewport-state" data-tone="idle"><span class="viewport-state-icon">${iconMarkup("head")}</span><div class="viewport-idle-text"><p class="viewport-idle-title" title="${esc(title)}">${esc(title)}</p><p class="viewport-idle-shows" title="${esc(shows)}">${esc(shows)}</p></div><button type="button" class="btn small" data-read-safe><span>${SHOW_HERE}</span></button></div>`;
}

/** Show here, a press in the resting state, or Enter/Space on the pane calls `show`. The shell reports focus separately. */
export function notDrawnState(pane: HTMLElement, show: () => void) {
  const title = h("p", { class: "viewport-idle-title" }), shows = h("p", { class: "viewport-idle-shows" });
  let active = false;
  const here = button({ label: SHOW_HERE, small: true, onClick: () => { if (active) show(); } });
  here.setAttribute("data-read-safe", "");
  const element = h("div", { class: "viewport-state", "data-tone": "idle", hidden: true },
    h("span", { class: "viewport-state-icon" }, icon("head")), h("div", { class: "viewport-idle-text" }, title, shows), here);
  const press = (event: MouseEvent) => { if (active && !here.contains(event.target as Node)) show(); };
  const key = (event: KeyboardEvent) => {
    if (!active || event.target !== pane || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault(); show();
  };
  element.addEventListener("click", press);
  pane.addEventListener("keydown", key);
  return { element, button: here,
    update(state: { shown: false } | ({ shown: true } & NotDrawnStateData)): string | undefined {
      active = state.shown; element.hidden = !state.shown;
      if (!state.shown) return undefined;
      setText(title, state.title); title.title = state.title;
      setText(shows, state.shows); shows.title = state.shows;
      return notDrawnStateName(state.title);
    },
    dispose() { active = false; element.removeEventListener("click", press); pane.removeEventListener("keydown", key); },
  };
}

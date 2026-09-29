import { h } from "../dom";
import { icon } from "../icons";

/**
 * Mod line (style guide "Mod line"): one XF mod a panel builds, as a line of the Mod package's list: the package mark, the mod's name,
 * what it holds ("· Eye makeup", "· Expressions") and its action: the options button (···), or, while its menu would hold only
 * Rename… (a default name, one feature, one mod), a Rename button that opens the rename popover directly (UI-143). Used by the
 * eye-makeup Mod package panel and the Expression sets panel.
 *
 * In a narrow panel the line wraps before the "·", never after it: what the mod holds and its options button stay together, right
 * after the words, so the kind is never left alone on a line and the button never drifts to the far edge (UI-140). A long name wraps
 * between words; the package mark stays on the first line.
 */
export type ModLineOptions = {
  /** The mod's name as it appears in the mod manager. */
  name: string;
  /** What it holds, in words ("Eye makeup", "Eye makeup, Expressions"). */
  kind: string;
  /** Its action: the options button (a small ghost icon Button with a menu), or a small ghost Rename icon Button while that menu would hold only Rename…. */
  action?: HTMLElement;
};

export function modLine(options: ModLineOptions): HTMLLIElement {
  return h("li", { class: "mod-line" }, icon("package"),
    h("span", { class: "mod-line-text" }, h("strong", { class: "mod-line-name", text: options.name }), " ",
      h("span", { class: "mod-line-end" }, h("span", { class: "mod-line-kind muted", text: `· ${options.kind}` }), options.action ?? null)));
}

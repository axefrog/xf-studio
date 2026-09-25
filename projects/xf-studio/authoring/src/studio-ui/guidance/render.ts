import { h } from "../dom";
import { parseHelp, type Inline } from "./content";

/** DOM for markdown-lite help text. Text only: nothing in the data becomes markup. */
function inline(item: Inline): Node {
  if (item.kind === "strong") return h("strong", { text: item.text });
  if (item.kind === "key") return h("kbd", { text: item.label });
  return document.createTextNode(item.text);
}
export function renderHelp(body: string): HTMLElement[] {
  return parseHelp(body).map(block => block.kind === "p" ? h("p", {}, block.inlines.map(inline))
    : h("ul", {}, block.items.map(item => h("li", {}, item.map(inline)))));
}
/** The same structure as static markup, for the self-contained style guide. */
export function helpMarkup(body: string): string {
  const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const one = (item: Inline) => item.kind === "strong" ? `<strong>${esc(item.text)}</strong>` : item.kind === "key" ? `<kbd>${esc(item.label)}</kbd>` : esc(item.text);
  return parseHelp(body).map(block => block.kind === "p" ? `<p>${block.inlines.map(one).join("")}</p>`
    : `<ul>${block.items.map(item => `<li>${item.map(one).join("")}</li>`).join("")}</ul>`).join("");
}

import { clamp, h, setAttr } from "./dom";
import { icon } from "./icons";

/**
 * Help tips (style guide "Help tips"): what a heading, row or control *is*, as opposed to what the person can do there, lives in a
 * rich tooltip on a small help icon beside it, not in an inline note. Inline text is kept for things the person can act on (a status
 * with Try again, a choice to make, why something failed).
 *
 * - **A real button.** The icon is a small button in the tab order, named "About <what>"; its text is the button's accessible
 *   description, so a screen reader reads it on focus without opening anything.
 * - **One tip for the page** (`installHelpTips`), like the reason tip: it shows while the pointer rests on the icon or while it has
 *   keyboard focus, and a click or tap pins it open (Escape, a second click or leaving closes it). It floats above everything, so it
 *   never moves the layout, and it never takes focus.
 * - **Rich, but plain.** An optional bold title and one or more short paragraphs; no links or controls inside (a tip can't be reached).
 */
export type HelpText = string | readonly string[];
const SELECTOR = "button.help-tip[data-help]";
const joined = (text: HelpText) => typeof text === "string" ? text : text.join("\n");

/** A help icon for `what` ("About <what>"), with its tip text; `title` heads the tip when given. */
export function helpTip(what: string, text: HelpText = "", title?: string): HTMLButtonElement {
  const button = h("button", { class: "help-tip", type: "button", "aria-label": `About ${what}` }, icon("help"));
  setHelp(button, text, title);
  return button;
}
/** Change a help icon's text (the tip follows at once if it is showing); an empty text hides the icon but keeps its place. */
export function setHelp(button: HTMLElement, text: HelpText, title?: string) {
  const value = joined(text);
  if (button.dataset.help === value && (button.dataset.helpTitle ?? "") === (title ?? "")) return;
  button.dataset.help = value;
  if (title) button.dataset.helpTitle = title; else delete button.dataset.helpTitle;
  setAttr(button, "aria-description", [title, ...value.split("\n")].filter(Boolean).join(". ").replace(/\.\./g, ".") || undefined);
  button.classList.toggle("empty", !value);
  button.tabIndex = value ? 0 : -1;
  live?.(button);
}

let installed: Document | undefined;
/** The page's tip, told when a help text changes (it follows at once if it shows that icon). */
let live: ((button: HTMLElement) => void) | undefined;
export function installHelpTips(doc: Document = document) {
  if (installed === doc) return;
  installed = doc;
  const tip = h("div", { class: "help-bubble", role: "tooltip", hidden: true });
  doc.body.append(tip);
  let shownFor: HTMLElement | undefined, pinned = false;
  const target = (event: Event) => (event.target instanceof Element ? event.target.closest<HTMLElement>(SELECTOR) : null) ?? undefined;
  const hide = () => { shownFor = undefined; pinned = false; tip.hidden = true; };
  const show = (control: HTMLElement) => {
    const text = control.dataset.help ?? "";
    if (!text) { hide(); return; }
    shownFor = control;
    const title = control.dataset.helpTitle;
    tip.replaceChildren(...(title ? [h("strong", { class: "help-bubble-title", text: title })] : []), ...text.split("\n").map(line => h("p", { text: line })));
    const host = control.closest("dialog") ?? doc.body;
    if (tip.parentElement !== host) host.append(tip);
    // Measured at the window's left edge, where it has its whole width: measured where it last showed (near the right edge), it would
    // come out narrower than it is and then run past the window (UI-152).
    tip.style.left = "0px"; tip.style.top = "0px";
    tip.hidden = false;
    const box = control.getBoundingClientRect(), own = tip.getBoundingClientRect(), margin = 6;
    const below = box.bottom + margin + own.height <= innerHeight - margin;
    tip.style.left = `${clamp(box.left + box.width / 2 - own.width / 2, margin, Math.max(margin, innerWidth - own.width - margin))}px`;
    tip.style.top = `${below ? box.bottom + margin : Math.max(margin, box.top - own.height - margin)}px`;
  };
  doc.addEventListener("click", event => {
    const control = target(event);
    if (control) {
      // A click never reaches a row or heading the icon sits in.
      event.preventDefault(); event.stopPropagation();
      if (pinned && shownFor === control) hide(); else { show(control); pinned = true; }
    } else if (pinned) hide();
  }, true);
  doc.addEventListener("focusin", event => { const control = target(event); if (control) show(control); else if (shownFor && !pinned) hide(); });
  doc.addEventListener("focusout", event => { if (event.target === shownFor && !pinned) hide(); });
  doc.addEventListener("pointerover", event => { const control = target(event); if (control && control !== shownFor) { pinned = false; show(control); } });
  doc.addEventListener("pointerout", event => {
    if (!shownFor || pinned || !(event.target instanceof Node) || !shownFor.contains(event.target)) return;
    if (event.relatedTarget instanceof Node && shownFor.contains(event.relatedTarget)) return;
    if (doc.activeElement !== shownFor) hide();
  });
  doc.addEventListener("keydown", event => { if (event.key === "Escape" && shownFor) { event.stopPropagation(); hide(); } }, true);
  doc.addEventListener("scroll", () => { if (shownFor) hide(); }, true);
  live = button => { if (button === shownFor) show(button); };
}

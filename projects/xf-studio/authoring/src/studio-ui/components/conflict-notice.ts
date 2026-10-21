import { applyCapability, button } from "../controls";
import { h, setText } from "../dom";
import type { Capability } from "../menu";

/**
 * Conflict notice (style guide t-conflict, Component library "Conflict notice"): a document this window changed was changed in another
 * window too. First in the owning section, in the warning tone: the lead-in "Changed in another window.", the owner's sentence (what it
 * is, what differs, the question), and the three ways out as small buttons in the order mine, theirs, both. Keep both shows only where
 * a copy can be made. Each button's tooltip says what it keeps; an unavailable one says why (the owner's capability).
 */
export type ConflictKeep = "mine" | "theirs" | "both";
export type ConflictNoticeState = { readonly message: string; readonly keepBoth: boolean };
export type ConflictNoticeOptions = {
  onResolve(keep: ConflictKeep): void;
  /** Whether each way out is available now (default: always). */
  capability?(keep: ConflictKeep): Capability;
};

const TITLES: Record<ConflictKeep, string> = {
  mine: "Save this window's version over the other window's",
  theirs: "Show the other window's version here; this window's changes go",
  both: "Keep this window's version as a copy, and show the other window's here",
};
const LABELS: Record<ConflictKeep, string> = { mine: "Keep mine", theirs: "Use theirs", both: "Keep both" };

export class ConflictNotice {
  readonly element: HTMLElement;
  private readonly text = h("span", {});
  private readonly buttons: Record<ConflictKeep, HTMLButtonElement>;

  constructor(private readonly options: ConflictNoticeOptions) {
    const make = (keep: ConflictKeep) => button({ label: LABELS[keep], small: true, title: TITLES[keep], onClick: () => options.onResolve(keep) });
    this.buttons = { mine: make("mine"), theirs: make("theirs"), both: make("both") };
    this.element = h("div", { class: "state-line warning doc-conflict", role: "group", "aria-label": "Changed in another window", "aria-live": "polite", hidden: true },
      h("p", { class: "doc-conflict-text" }, h("strong", {}, "Changed in another window."), " ", this.text),
      h("div", { class: "row wrap gap-s" }, this.buttons.mine, this.buttons.theirs, this.buttons.both));
  }

  /** The conflict to show (null: none waits, and the notice takes no room). */
  update(state: ConflictNoticeState | null): void {
    this.element.hidden = !state;
    setText(this.text, state?.message ?? "");
    this.buttons.both.hidden = !state?.keepBoth;
    if (!state || !this.options.capability) return;
    for (const keep of ["mine", "theirs", "both"] as const) applyCapability(this.buttons[keep], this.options.capability(keep));
  }
}

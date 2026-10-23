import { applyCapability, button } from "../controls";
import { h, setText } from "../dom";
import { openConfirmPopover, type Capability } from "../menu";

/**
 * Conflict notice (style guide t-conflict, Component library "Conflict notice"): a document this window changed was changed in another
 * window too. First in the owning section, in the warning tone: the lead-in "Changed in another window.", the owner's sentence (what it
 * is, what differs, the question), and the three ways out as small buttons in the order mine, other window's, both. Keep both shows only where
 * a copy can be made. Each button's tooltip says what it keeps; an unavailable one says why (the owner's capability).
 *
 * Keep mine and Use other window's each throw one version away for good, so each asks first, in place (the confirm popover, c-confirm): it
 * names the document and what goes, with focus on Cancel. Keep both loses nothing and acts at once.
 */
export type ConflictKeep = "mine" | "theirs" | "both";
export type ConflictNoticeState = {
  readonly message: string; readonly keepBoth: boolean;
  /** The document as the confirmations name it: "the preset “Smoky”", "the collection “Night market set”", "this V". */
  readonly subject: string;
};
export type ConflictNoticeOptions = {
  onResolve(keep: ConflictKeep): void;
  /** Whether each way out is available now (default: always). */
  capability?(keep: ConflictKeep): Capability;
};

/** Each way out's tooltip: what it keeps (shared with the style guide's specimens). */
export const CONFLICT_TITLES: Record<ConflictKeep, string> = {
  mine: "Save this window's version over the other window's (asks first: the other window's changes are discarded)",
  theirs: "Show the other window's version here (asks first: this window's changes are discarded)",
  both: "Keep this window's version as a copy, and show the other window's here",
};
/** "Use other window's", never "Use theirs": the other version is another window's, not another person's. */
const LABELS: Record<ConflictKeep, string> = { mine: "Keep mine", theirs: "Use other window's", both: "Keep both" };

/** What each confirmation asks, naming the document and what goes (t-conflict). */
export function conflictConfirmation(keep: "mine" | "theirs", subject: string): { title: string; message: string; confirm: string } {
  return keep === "mine"
    ? { title: "Keep this window's version", message: `Keep this window's version of ${subject}? The other window's changes to it are discarded.`, confirm: LABELS.mine }
    : { title: "Use the other window's version", message: `Use the other window's version of ${subject}? Your changes to it here are discarded.`, confirm: LABELS.theirs };
}

export class ConflictNotice {
  readonly element: HTMLElement;
  private readonly text = h("span", {});
  private readonly buttons: Record<ConflictKeep, HTMLButtonElement>;
  private state: ConflictNoticeState | null = null;

  constructor(private readonly options: ConflictNoticeOptions) {
    const make = (keep: ConflictKeep) => button({ label: LABELS[keep], small: true, title: CONFLICT_TITLES[keep], onClick: () => this.choose(keep) });
    this.buttons = { mine: make("mine"), theirs: make("theirs"), both: make("both") };
    this.element = h("div", { class: "state-line warning doc-conflict", role: "group", "aria-label": "Changed in another window", "aria-live": "polite", hidden: true },
      h("p", { class: "doc-conflict-text" }, h("strong", {}, "Changed in another window."), " ", this.text),
      h("div", { class: "row wrap gap-s" }, this.buttons.mine, this.buttons.theirs, this.buttons.both));
  }

  /** The conflict to show (null: none waits, and the notice takes no room). */
  update(state: ConflictNoticeState | null): void {
    this.state = state;
    this.element.hidden = !state;
    setText(this.text, state?.message ?? "");
    this.buttons.both.hidden = !state?.keepBoth;
    if (!state || !this.options.capability) return;
    for (const keep of ["mine", "theirs", "both"] as const) applyCapability(this.buttons[keep], this.options.capability(keep));
  }

  private choose(keep: ConflictKeep) {
    const asked = this.state;
    if (!asked) return;
    if (keep === "both") { this.options.onResolve(keep); return; }
    // The answer goes to the conflict shown when it was asked: one resolved meanwhile (elsewhere, or by another choice) isn't answered.
    const same = (state: ConflictNoticeState | null) => !!state && state.subject === asked.subject && state.message === asked.message;
    openConfirmPopover(this.buttons[keep], { ...conflictConfirmation(keep, asked.subject), danger: true,
      onConfirm: () => { if (same(this.state)) this.options.onResolve(keep); } });
  }
}

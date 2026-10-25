import { applyCapability, badge, button, setButtonLabel } from "../controls";
import { h, setAttr, setText, uid } from "../dom";
import { expander, expanderLabel, isExpanded, setExpanded } from "../expander";
import { helpTip, type HelpText } from "../help-tip";
import { icon } from "../icons";
import type { Capability } from "../menu";
import { viewState } from "../view-state";
import { linkButton } from "./link-button";

/**
 * Framework status (style guide "Framework status"): which framework versions the game will load, one row each, with a status and,
 * where one needs attention, its one next step. Settings › Game's "Mod frameworks" group is its first user.
 *
 * - **Heading:** the group's name with its help tip, and **Check again** at the far end (a small quiet Button that reads "Checking…"
 *   and waits while a check runs).
 * - **The line:** one plain sentence says where things stand (`state.line`): everything up to date, how many frameworks need attention,
 *   that a check is running, or why nothing could be checked. A warning mark, a check mark or nothing goes with it; the words carry the
 *   meaning, never the mark alone.
 * - **Rows, all shown:** a row is the framework's name, its status badge, and a meta line of facts (the version the game will load, and
 *   where it comes from). A framework that needs attention also shows the sentence that says what to do and its official release pages
 *   as link buttons; the component only reports a press (`onOpenLink`), it opens nothing and changes nothing. Notes (a hidden second
 *   copy, a mod list that disagrees with the file) sit under the row in muted text.
 * - **Folding:** while everything needed is fine (`state.foldable`) the rows fold under the line, which becomes the disclosure
 *   button ("All frameworks up to date"). The choice is remembered under `key` (view-state.ts). While anything needs attention the rows
 *   are always shown and the line is plain text.
 * - **Checking:** the previous rows stay (nothing jumps) and only the line and the button change; the first check shows just the line.
 *
 * `update(state, capabilities)` repaints in place: rows are rebuilt only when they changed, so focus on a link or the fold stays.
 */
export type FrameworkStatusLink = { readonly id: string; readonly label: string; readonly name: string };
export type FrameworkStatusRow = {
  readonly id: string;
  readonly name: string;
  /** The status, as a short fixed word or phrase on a badge. */
  readonly badge: { readonly text: string; readonly tone: "success" | "warning" | "neutral" };
  readonly status: string;
  /** The meta line's facts, in order ("1.27.5", "from the game folder"). */
  readonly facts: readonly string[];
  /** What to do, for a framework that needs attention. */
  readonly message: string | null;
  readonly notes: readonly string[];
  readonly links: readonly FrameworkStatusLink[];
};
export type FrameworkStatusState = {
  readonly line: string;
  readonly tone: "ready" | "attention" | "checking" | "info";
  readonly rows: readonly FrameworkStatusRow[];
  /** Everything needed is fine: the rows fold under the line. */
  readonly foldable: boolean;
  readonly checking: boolean;
};
export type FrameworkStatusOptions = {
  /** The group's name ("Mod frameworks"). */
  label: string;
  help: HelpText;
  /** The view key the fold is remembered under (`settings.frameworks`). */
  key: string;
  onCheckAgain(): void;
  /** A release page's link button was pressed (its `id`). */
  onOpenLink(id: string): void;
};

export class FrameworkStatus {
  readonly element: HTMLElement;
  readonly checkAgain: HTMLButtonElement;
  private readonly mark = h("span", { class: "framework-mark", "aria-hidden": "true" });
  private readonly text = h("span", { class: "framework-line-text" });
  private readonly fold: HTMLButtonElement;
  private readonly foldLabel = expanderLabel("");
  private readonly plain = h("p", { class: "framework-line-plain" }, this.mark, this.text);
  private readonly list: HTMLUListElement;
  private rowsKey = "";
  private rowCount = 0;
  private links: HTMLElement[] = [];
  private linkCapability: Capability = { available: true };
  private foldable = false;

  constructor(private readonly options: FrameworkStatusOptions) {
    const listId = uid("frameworks");
    this.checkAgain = button({ label: "Check again", icon: "refresh", small: true, variant: "quiet",
      title: "Read the framework versions again (changes nothing)", onClick: () => options.onCheckAgain() });
    this.fold = expander("row", { expanded: viewState().expanded(options.key) ?? false, controls: listId }, this.foldLabel);
    this.fold.addEventListener("click", () => {
      const open = !isExpanded(this.fold);
      setExpanded(this.fold, open);
      viewState().setExpanded([options.key], open);
      this.paintList();
    });
    this.list = h("ul", { class: "framework-list", id: listId, "aria-label": options.label });
    this.element = h("div", { class: "framework-status", "data-tone": "info", hidden: true },
      h("div", { class: "framework-head" }, h("h4", { class: "framework-title" }, h("span", { text: options.label }), helpTip(options.label, options.help)), this.checkAgain),
      h("div", { class: "framework-line", "aria-live": "polite" }, this.fold, this.plain), this.list);
  }

  /** Whether the rows are shown now: always, except while folded under an "all up to date" line. */
  get open() { return !this.foldable || isExpanded(this.fold); }

  update(state: FrameworkStatusState | null, capabilities: { checkAgain?: Capability; open?: Capability } = {}) {
    this.element.hidden = !state;
    // Even while it isn't shown, its button follows the port's answer (a window that may not read keeps it unavailable).
    setButtonLabel(this.checkAgain, state?.checking ? "Checking…" : "Check again");
    applyCapability(this.checkAgain, state?.checking ? { available: false, reason: "XF Studio is checking your frameworks now." }
      : capabilities.checkAgain ?? { available: true });
    if (!state) return;
    setAttr(this.element, "data-tone", state.tone);
    this.foldable = state.foldable && state.rows.length > 0;
    this.fold.hidden = !this.foldable; this.plain.hidden = this.foldable;
    setText(this.foldLabel, state.line); setText(this.text, state.line);
    const mark = state.tone === "attention" ? icon("warning") : state.tone === "ready" ? icon("check") : null;
    this.mark.replaceChildren(...(mark ? [mark] : []));
    this.mark.hidden = !mark;
    const key = JSON.stringify(state.rows);
    if (key !== this.rowsKey) { this.rowsKey = key; this.paintRows(state.rows); }
    this.linkCapability = capabilities.open ?? { available: true };
    for (const link of this.links) applyCapability(link, this.linkCapability);
    this.paintList();
  }

  private paintList() { this.list.hidden = !this.open || !this.rowCount; }

  private paintRows(rows: readonly FrameworkStatusRow[]) {
    this.links = [];
    this.rowCount = rows.length;
    this.list.replaceChildren(...rows.map(row => {
      const meta = row.facts.flatMap((fact, index) => [index ? h("span", { class: "record-sep", "aria-hidden": "true", text: " · " }) : null,
        h("span", { class: "record-fact", text: fact })]).filter((node): node is HTMLSpanElement => !!node);
      const links = row.links.map(link => {
        const control = linkButton({ label: link.label, onClick: () => this.options.onOpenLink(link.id) });
        setAttr(control, "aria-label", link.name);
        this.links.push(control);
        return control;
      });
      return h("li", { class: "framework-row", "data-status": row.status, "data-framework": row.id },
        h("div", { class: "framework-name-line" }, h("strong", { class: "framework-name", text: row.name }), badge(row.badge.text, row.badge.tone)),
        h("p", { class: "record-meta framework-meta" }, ...meta),
        row.message ? h("p", { class: "framework-message", text: row.message }) : null,
        links.length ? h("div", { class: "framework-links" }, ...links) : null,
        ...row.notes.map(text => h("p", { class: "note framework-note", text })));
    }));
  }
}

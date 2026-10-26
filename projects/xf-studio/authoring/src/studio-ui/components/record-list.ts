import { h } from "../dom";
import { badge } from "../controls";

/**
 * Record list (style guide "Record list"): things saved on this computer, one row each: the Library's saved collections and its recent
 * drafts (UI-162). A row is its name, one meta line of facts, and an end column holding its state badge ("Open now") and its one action.
 *
 * - **The name has the whole line:** it ends with an ellipsis (its full text as the row's tooltip); nothing sits beside it (C-30). It
 *   keeps a minimum width: the end column wraps under it, right-aligned, before squeezing it further.
 * - **The end column** is vertically centred and right-aligned, lined up with the other rows' buttons. A row with nothing to do (the
 *   collection open now) shows its state badge there instead of an unavailable button; a row with both puts the badge immediately
 *   before the action.
 * - **The meta line wraps only between facts:** each fact ("1 preset", "version 3", a date) keeps its words together, so a narrow
 *   panel breaks the line at a "·", never inside a date.
 * - **One action**, in the end column; the owner builds it (a Button) so its capability and reason are its own. A row with nothing to
 *   do has none, rather than an unavailable button.
 * - **An optional thumbnail** sits before the name, vertically centred: a small drawing that tells rows apart at a glance (a Shape thumbnail).
 *   Its size is the owner's; the row keeps its height and the name keeps its line. It is decorative: the name is the row's name.
 * - The current row (the one open now) has the signal background.
 *
 * `update(records)` rebuilds the rows; the owner keys it on what it shows, so an unchanged list is left alone (focus stays).
 */
export type RecordRow = {
  id: string; name: string;
  /** The meta line's facts, in order ("2 presets", "version 3", "29 Sep 2026, 6:02 pm"). */
  meta: readonly string[];
  /** A state from the fixed vocabulary, in the row's end column, before the action if there is one ("Open now"). */
  badge?: { text: string; tone: "neutral" | "accent" | "info" | "success" | "warning" | "error" };
  /** The row open now: the signal background. */
  current?: boolean;
  /** A small decorative drawing before the name (a Shape thumbnail); none for rows that have no shape. */
  thumbnail?: Element;
  /** The row's one action (a small Button); none where there is nothing to do with the row (the one open now). */
  action?: HTMLElement;
};
export type RecordListOptions = { label: string; className?: string };

export class RecordList {
  readonly element: HTMLUListElement;
  constructor(options: RecordListOptions) {
    this.element = h("ul", { class: `record-list${options.className ? ` ${options.className}` : ""}`, "aria-label": options.label });
  }
  update(records: readonly RecordRow[]) {
    this.element.replaceChildren(...records.map(record => {
      const meta = record.meta.flatMap((fact, index) => [index ? h("span", { class: "record-sep", "aria-hidden": "true", text: " · " }) : null,
        h("span", { class: "record-fact", text: fact })]).filter((node): node is HTMLSpanElement => !!node);
      return h("li", { class: `record-row${record.current ? " current" : ""}`, "data-view-key": `record:${record.id}` },
        record.thumbnail ? h("span", { class: "record-thumb", "aria-hidden": "true" }, record.thumbnail) : null,
        h("div", { class: "record-main" },
          h("strong", { class: "record-name", title: record.name, text: record.name }),
          meta.length ? h("p", { class: "record-meta" }, ...meta) : null),
        record.badge || record.action ? h("div", { class: "record-end" }, record.badge ? badge(record.badge.text, record.badge.tone) : null, record.action ?? null) : null);
    }));
  }
}

/** A saved time as the record lists show it: the date and the minute (seconds only when requested to distinguish same-minute own defaults) ("29 Sep 2026, 6:02 pm" in the person's locale). */
export const recordTime = (time: number | string | Date, seconds = false) =>
  new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: seconds ? "medium" : "short" });

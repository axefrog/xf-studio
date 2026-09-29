import { h } from "../dom";
import { badge } from "../controls";

/**
 * Record list (style guide "Record list"): things saved on this computer, one row each: the Library's saved collections and its recent
 * drafts (UI-162). A row is its name, one meta line of facts, a state badge where one applies ("This draft"), and one action.
 *
 * - **The name keeps its line:** it ends with an ellipsis (its full text as the row's tooltip) and the badge stays beside it, never
 *   pushed under it or cut off (C-30).
 * - **The meta line wraps only between facts:** each fact ("1 preset", "version 3", a date) keeps its words together, so a narrow
 *   panel breaks the line at a "·", never inside a date.
 * - **One action**, at the row's end, vertically centred; the owner builds it (a Button) so its capability and reason are its own.
 * - The current row (the one open now) has the signal background.
 *
 * `update(records)` rebuilds the rows; the owner keys it on what it shows, so an unchanged list is left alone (focus stays).
 */
export type RecordRow = {
  id: string; name: string;
  /** The meta line's facts, in order ("2 presets", "version 3", "29 Sep 2026, 6:02 pm"). */
  meta: readonly string[];
  /** A state from the fixed vocabulary, beside the name ("This draft"). */
  badge?: { text: string; tone: "neutral" | "accent" | "info" | "success" | "warning" | "error" };
  /** The row open now: the signal background. */
  current?: boolean;
  /** The row's one action (a small Button). */
  action: HTMLElement;
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
        h("div", { class: "record-main" },
          h("div", { class: "record-name-line" }, h("strong", { class: "record-name", title: record.name, text: record.name }),
            record.badge ? badge(record.badge.text, record.badge.tone) : null),
          meta.length ? h("p", { class: "record-meta" }, ...meta) : null),
        record.action);
    }));
  }
}

/** A saved time as the record lists show it: the date and the minute, never the seconds ("29 Sep 2026, 6:02 pm" in the person's locale). */
export const recordTime = (time: number | string | Date) =>
  new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

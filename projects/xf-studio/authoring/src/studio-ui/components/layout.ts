import { h, setText } from "../dom";
import { button } from "../controls";
import { helpTip, type HelpText } from "../help-tip";

/**
 * Layout primitives (style guide "Layout primitives"): the spacing between distinct pieces of content is defined here once, from the
 * spacing tokens, so every panel gets the same rhythm and none sits its sections against each other.
 *
 * - **Stack**: children in a column with one of three gaps: `tight` (--sp-3, parts of one thing), `normal` (--sp-4, the rows of a
 *   section) or `loose` (--sp-6, sections of a panel; `.panel-content` uses it).
 * - **Block section**: a titled block of a pane (a node, an object): its heading row (title and actions), then its content, each
 *   separated by the normal gap. Panel-level sections with the uppercase eyebrow title stay `section()` (controls.ts).
 * - **Page header**: a view's header inside a panel: an optional back action on its own row, the title with its actions, and a meta
 *   line; each row has its own space, and the header keeps a loose gap from whatever follows.
 * - **Property list**: key/value rows in two aligned columns that wrap long values.
 * - **Code block**: preformatted text (bytes in hexadecimal, a path, a log) in the monospace token. It scrolls in both directions
 *   rather than wrapping or clipping, and is focusable so the keyboard can scroll it.
 */
type Child = Node | null | undefined | false;
export type Gap = "tight" | "normal" | "loose";
const kids = (children: readonly Child[]) => children.filter((child): child is Node => !!child);

/** Children in a column, `gap` apart (a class hook in `className`). */
export function stack(options: { gap?: Gap; className?: string; label?: string } = {}, ...children: Child[]): HTMLElement {
  return h("div", { class: `stack gap-${options.gap ?? "normal"}${options.className ? ` ${options.className}` : ""}`,
    role: options.label ? "group" : undefined, "aria-label": options.label }, ...kids(children));
}

/** A titled block of a pane: its heading (h4 by default) with optional actions and help, then its content. */
export function blockSection(options: { title: string; level?: 3 | 4 | 5; actions?: Child[]; help?: HelpText; className?: string; titleClass?: string; label?: string },
  ...children: Child[]): HTMLElement {
  const tag = (`h${options.level ?? 4}`) as "h3" | "h4" | "h5";
  const title = h(tag, { class: `block-title${options.titleClass ? ` ${options.titleClass}` : ""}`, text: options.title });
  const actions = kids(options.actions ?? []);
  const head = h("div", { class: "block-head" }, title, options.help !== undefined ? helpTip(options.title, options.help) : null,
    actions.length ? h("div", { class: "block-actions" }, ...actions) : null);
  return h("section", { class: `block-section${options.className ? ` ${options.className}` : ""}`, "aria-label": options.label ?? options.title }, head, ...kids(children));
}

/** A view's header inside a panel: back action, title and actions, and a meta line. Update its texts in place. */
export class PageHeader {
  readonly element: HTMLElement;
  readonly title: HTMLElement;
  readonly meta: HTMLElement;
  readonly back?: HTMLButtonElement;
  constructor(options: { title?: string; meta?: string; level?: 2 | 3 | 4; back?: { label: string; onClick(): void }; actions?: Child[]; className?: string; titleClass?: string }) {
    const tag = (`h${options.level ?? 3}`) as "h2" | "h3" | "h4";
    this.title = h(tag, { class: `page-header-title${options.titleClass ? ` ${options.titleClass}` : ""}`, text: options.title ?? "" });
    this.meta = h("p", { class: "page-header-meta" });
    this.back = options.back ? button({ label: options.back.label, icon: "chevronLeft", small: true, variant: "quiet", onClick: options.back.onClick }) : undefined;
    const actions = kids(options.actions ?? []);
    this.element = h("header", { class: `page-header${options.className ? ` ${options.className}` : ""}` },
      this.back ? h("div", { class: "page-header-back" }, this.back) : null,
      h("div", { class: "page-header-main" }, this.title, actions.length ? h("div", { class: "page-header-actions" }, ...actions) : null),
      this.meta);
    this.setMeta(options.meta ?? "");
  }
  setTitle(text: string) { setText(this.title, text); }
  /** An empty meta line takes no space. */
  setMeta(text: string) { setText(this.meta, text); this.meta.hidden = !text; }
}

/** Key/value rows. A value may be a node (a link, a badge); `mono` sets values in the monospace token. */
export type Property = { term: string; value: string | Node; mono?: boolean };
export function propertyList(rows: readonly (Property | [string, string])[], options: { label?: string; className?: string } = {}): HTMLElement {
  return h("dl", { class: `property-list${options.className ? ` ${options.className}` : ""}`, "aria-label": options.label },
    rows.flatMap(row => {
      const { term, value, mono } = Array.isArray(row) ? { term: row[0], value: row[1], mono: false } : row;
      return [h("dt", { text: term }), h("dd", { class: mono ? "mono" : undefined }, value)];
    }));
}

/** Preformatted text that scrolls instead of wrapping or clipping; focusable (a scroll region) and named by `label`. */
export function codeBlock(text: string, options: { label: string; className?: string }): HTMLElement {
  return h("pre", { class: `code-block${options.className ? ` ${options.className}` : ""}`, tabindex: 0, role: "region", "aria-label": options.label }, text);
}

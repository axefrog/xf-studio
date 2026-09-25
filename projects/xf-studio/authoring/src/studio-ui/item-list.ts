import { chordsLabel, keyBinding, keyBindingById } from "../input-bindings";
import { h, setAttr, setText } from "./dom";
import { icon } from "./icons";

/**
 * Ordered, selectable rows with keyboard and pointer reordering and inline
 * rename. It emits intents; the owner dispatches application actions.
 */
export type ListItem = { id: string; name: string; meta?: string };
export type ListRow = { element: HTMLElement; trailing: HTMLElement; lead: HTMLElement; main: HTMLButtonElement; label: HTMLElement; meta: HTMLElement };
export type ItemListOptions<T extends ListItem> = {
  label: string;
  noun: string;
  onSelect(id: string): void;
  /** Move to a visual index (0 = first row shown). */
  onMove(id: string, index: number): void;
  onRename(id: string, name: string): void;
  onDelete?(id: string): void;
  onDuplicate?(id: string): void;
  onMenu(id: string, anchor: Element | { x: number; y: number }, invoker: Element): void;
  decorate?(item: T, row: ListRow, selected: boolean): void;
  maxLength: number;
};

export class ItemList<T extends ListItem> {
  readonly element: HTMLElement;
  private rows = new Map<string, ListRow>();
  private order: string[] = [];
  private selected?: string;
  private editing?: string;
  private disabled = false;
  constructor(private options: ItemListOptions<T>) {
    this.element = h("ol", { class: "item-list", "aria-label": options.label });
  }
  focusRow(id: string) { this.rows.get(id)?.main.focus(); }
  update(items: readonly T[], selected: string | undefined, disabled = false) {
    this.selected = selected; this.disabled = disabled;
    const ids = items.map(item => item.id);
    for (const [id, row] of this.rows) if (!ids.includes(id)) { row.element.remove(); this.rows.delete(id); }
    const focused = document.activeElement;
    items.forEach((item, index) => {
      let row = this.rows.get(item.id);
      if (!row) { row = this.createRow(item.id); this.rows.set(item.id, row); }
      if (this.element.children[index] !== row.element) this.element.insertBefore(row.element, this.element.children[index] ?? null);
      const isSelected = item.id === selected;
      setAttr(row.element, "aria-current", isSelected ? "true" : undefined);
      row.element.classList.toggle("selected", isSelected);
      if (this.editing !== item.id) setText(row.label, item.name);
      setText(row.meta, item.meta ?? "");
      row.main.setAttribute("aria-label", `${item.name}${item.meta ? `, ${item.meta}` : ""}${isSelected ? ", selected" : ""}`);
      row.main.tabIndex = isSelected || (!selected && index === 0) ? 0 : -1;
      row.main.disabled = disabled;
      this.options.decorate?.(item, row, isSelected);
    });
    this.order = ids;
    if (focused instanceof HTMLElement && !focused.isConnected) this.rows.get(selected ?? "")?.main.focus();
  }
  private createRow(id: string): ListRow {
    const label = h("span", { class: "item-name" }), meta = h("span", { class: "item-meta" });
    const main = h("button", { class: "item-main", type: "button" }, label, meta);
    const grip = h("span", { class: "item-grip", "aria-hidden": "true", title: `Drag to reorder · ${chordsLabel(keyBindingById("rows.reorder"))} with the keyboard` }, icon("grip"));
    const lead = h("span", { class: "item-lead" });
    const trailing = h("span", { class: "item-trailing" });
    const element = h("li", { class: "item-row", "data-id": id }, grip, lead, main, trailing);
    main.addEventListener("click", () => { if (!this.disabled) this.options.onSelect(id); });
    main.addEventListener("dblclick", () => this.rename(id));
    main.addEventListener("keydown", event => this.key(event, id));
    element.addEventListener("contextmenu", event => {
      if ((event.target as HTMLElement).closest("input")) return;
      event.preventDefault(); this.options.onMenu(id, { x: event.clientX, y: event.clientY }, main);
    });
    grip.addEventListener("pointerdown", event => this.drag(event, id));
    return { element, trailing, lead, main, label, meta };
  }
  private key(event: KeyboardEvent, id: string) {
    const index = this.order.indexOf(id), command = keyBinding("rows", event)?.id;
    if (command === "rows.reorder") {
      event.preventDefault();
      const to = index + (event.key === "ArrowUp" ? -1 : 1);
      if (to >= 0 && to < this.order.length) { this.options.onMove(id, to); requestAnimationFrame(() => this.focusRow(id)); }
    } else if (command === "rows.focus") {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? this.order.length - 1 :
        Math.max(0, Math.min(this.order.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)));
      this.rows.get(this.order[next])?.main.focus();
    } else if (command === "rows.rename") { event.preventDefault(); this.rename(id); }
    else if (command === "rows.remove" && this.options.onDelete) { event.preventDefault(); this.options.onDelete(id); }
    else if (command === "rows.duplicate" && this.options.onDuplicate) {
      event.preventDefault(); this.options.onDuplicate(id);
    } else if (command === "rows.menu") {
      event.preventDefault(); const row = this.rows.get(id)!; this.options.onMenu(id, row.main, row.main);
    }
  }
  /** Inline rename; Enter or blur commits, Escape restores. */
  rename(id: string) {
    const row = this.rows.get(id);
    if (!row || this.disabled || this.editing) return;
    this.editing = id;
    const original = row.label.textContent ?? "";
    const input = h("input", { class: "field item-rename", type: "text", value: original, maxlength: String(this.options.maxLength),
      "aria-label": `Rename ${this.options.noun} ${original}` });
    row.main.hidden = true;
    row.main.after(input);
    input.focus(); input.select();
    let done = false;
    const finish = (commit: boolean, refocus = true) => {
      if (done) return; done = true;
      this.editing = undefined;
      input.remove(); row.main.hidden = false;
      const value = input.value.trim();
      if (commit && value && value !== original) this.options.onRename(id, value);
      if (refocus) row.main.focus();
    };
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); finish(true); }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
    });
    // Clicking elsewhere commits without pulling focus back from where the user went.
    input.addEventListener("blur", () => finish(true, false));
  }
  private drag(event: PointerEvent, id: string) {
    if (event.button !== 0 || this.disabled) return;
    event.preventDefault();
    const row = this.rows.get(id)!, grip = event.currentTarget as HTMLElement;
    grip.setPointerCapture(event.pointerId);
    const marker = h("li", { class: "item-drop", "aria-hidden": "true" });
    row.element.classList.add("dragging");
    let index = this.order.indexOf(id);
    const from = index;
    const move = (e: PointerEvent) => {
      const rows = this.order.map(key => this.rows.get(key)!.element);
      index = rows.findIndex(element => { const r = element.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      if (index < 0) index = rows.length;
      this.element.insertBefore(marker, rows[index] ?? null);
    };
    const up = (e: PointerEvent) => {
      cleanup();
      const target = index > from ? index - 1 : index;
      if (e.type === "pointerup" && target !== from) this.options.onMove(id, target);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); index = from; cleanup(); } };
    const cleanup = () => {
      marker.remove(); row.element.classList.remove("dragging");
      grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up); window.removeEventListener("keydown", key, true);
    };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key, true);
  }
}

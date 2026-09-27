import { h, setAttr } from "../dom";
import { icon } from "../icons";
import { ItemList, type ListRow } from "../item-list";

/**
 * Light list (style guide "Light list", feature-specific: lighting setups): a lighting setup's lights as an ordered list, one compact row
 * each, in the Ordered list's pattern (item-list.ts), so rows reorder by drag or keyboard, rename in place and open their menu the same
 * way as layers do.
 *
 * - **A row** leads with the light's colour chip (the layer swatch) and a glyph for its kind (a sun for a directional light, the lighting
 *   mark for a spot), then its name and one muted line of what matters at a glance ("Spot · 40 · shadows").
 * - **Selecting** a row picks the light the editor below shows; the owner keeps the selection (`update(items, selected)`).
 * - **Access:** the list and its keyboard are the Ordered list's; each row is named "<name>, <kind> light, <meta>", so the chip and
 *   glyph never carry meaning alone.
 */
export type LightListItem = { id: string; name: string; meta?: string; colour: string; kind: "directional" | "spot" };
export type LightListOptions = {
  label: string;
  onSelect(id: string): void;
  onMove(id: string, index: number): void;
  onRename(id: string, name: string): void;
  onDelete?(id: string): void;
  onDuplicate?(id: string): void;
  onMenu(id: string, anchor: Element | { x: number; y: number }, invoker: Element): void;
  maxLength: number;
};

export class LightList {
  readonly element: HTMLElement;
  private readonly list: ItemList<LightListItem>;
  private readonly marks = new WeakMap<ListRow, { chip: HTMLElement; glyph: HTMLElement; kind: string }>();
  constructor(options: LightListOptions) {
    this.list = new ItemList<LightListItem>({ ...options, noun: "light", decorate: (item, row) => this.decorate(item, row) });
    this.element = this.list.element;
    this.element.classList.add("light-list");
  }
  focusRow(id: string) { this.list.focusRow(id); }
  /** Start renaming a light in place (the menu's Rename). */
  rename(id: string) { this.list.rename(id); }
  update(items: readonly LightListItem[], selected: string | undefined, disabled = false) { this.list.update(items, selected, disabled); }
  private decorate(item: LightListItem, row: ListRow) {
    let mark = this.marks.get(row);
    if (!mark) {
      const chip = h("span", { class: "swatch light-chip", "aria-hidden": "true" }), glyph = h("span", { class: "light-kind", "aria-hidden": "true" });
      row.lead.replaceChildren(chip, glyph);
      mark = { chip, glyph, kind: "" };
      this.marks.set(row, mark);
    }
    mark.chip.style.setProperty("--swatch", item.colour);
    if (mark.kind !== item.kind) {
      mark.kind = item.kind;
      mark.glyph.replaceChildren(icon(item.kind === "spot" ? "lighting" : "sun"));
      mark.glyph.setAttribute("title", item.kind === "spot" ? "Spot light" : "Directional light");
    }
    const selected = row.element.classList.contains("selected");
    setAttr(row.main, "aria-label", `${item.name}, ${item.kind} light${item.meta ? `, ${item.meta}` : ""}${selected ? ", selected" : ""}`);
  }
}

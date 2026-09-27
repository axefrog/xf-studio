/**
 * Listbox keys every choice list shares (style guide "Choice list" and "Choice layouts"), beside the arrows, Home and End each list
 * handles itself: **type-ahead** by label and **PageUp/PageDown** by a screenful. Both move focus only; Enter, Space or a click chooses.
 *
 * - **Type-ahead.** A printable key moves focus to the next choice whose label starts with what was typed in the last `pause` ms; the
 *   same letter again cycles through the choices starting with it. A space counts only while a word is being typed (else it chooses, as
 *   the listbox pattern says). Case and accents are ignored.
 * - **Page.** As many choices as fill the list's scrolling view: its visible rows times the columns of a grid.
 */
export class TypeAhead {
  private typed = "";
  private at = -Infinity;
  constructor(private readonly now: () => number = () => Date.now(), private readonly pause = 700) {}
  /** Whether this key is type-ahead. */
  accepts(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey || [...event.key].length !== 1) return false;
    return event.key !== " " || (this.typed !== "" && this.now() - this.at < this.pause);
  }
  /** Take a typed key: the index of the label to focus (searching on from `current`), or -1 when none matches. */
  find(key: string, labels: readonly string[], current: number): number {
    const time = this.now();
    this.typed = time - this.at < this.pause ? this.typed + key : key;
    this.at = time;
    const text = fold(this.typed), cycle = [...text].every(letter => letter === text[0]);
    const wanted = cycle ? text[0]! : text;
    // One letter (or one repeated) looks from the next choice on; a longer word may stay on the current one while it still matches.
    const start = cycle ? current + 1 : Math.max(0, current);
    for (let step = 0; step < labels.length; step++) {
      const index = (((start + step) % labels.length) + labels.length) % labels.length;
      if (fold(labels[index]!).startsWith(wanted)) return index;
    }
    return -1;
  }
}
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();

/** How many choices PageUp or PageDown moves from `item`: the rows that fit in its scrolling view (at least one), times `columns`. */
export function pageStep(item: HTMLElement, columns = 1, gap = 4): number {
  const height = item.offsetHeight || 0;
  let view = typeof innerHeight === "number" ? innerHeight : 0;
  for (let node = item.parentElement; node && typeof getComputedStyle === "function"; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) { view = Math.min(view || Infinity, node.clientHeight); break; }
  }
  const rows = height > 0 && view > 0 ? Math.max(1, Math.floor(view / (height + gap)) - 1) : 10;
  return rows * Math.max(1, columns);
}

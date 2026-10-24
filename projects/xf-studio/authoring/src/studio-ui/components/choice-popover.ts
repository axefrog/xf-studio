import { h, setText } from "../dom";
import { button } from "../controls";
import { closeMenus, place, type Capability, type MenuAnchor } from "../menu";
import { ChoiceList, type ChoiceOption } from "./choice-list";
import { SearchField } from "./search-field";

export type ChoicePopoverField = { key: string; label: string; name: string; options: readonly ChoiceOption<string>[]; value: string; search?: boolean };
export type ChoicePopoverState = { fields: readonly ChoicePopoverField[]; note?: string; capability?: Capability };
/** U4: choices supplied as snapshots by the owner; this component owns only field focus and search. */
export function openChoicePopover(anchor: MenuAnchor, options: { title: string; apply: string; invoker?: HTMLElement;
  snapshot(): ChoicePopoverState; select(key: string, value: string): void; commit(): void; onClose?(): void }) {
  closeMenus(false);
  const invoker = options.invoker ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const fields = h("div", { class: "choice-popover-fields" });
  const note = h("p", { class: "popover-note", role: "status" });
  let closed = false;
  const apply = button({ label: options.apply, variant: "primary", onClick: () => commit() });
  const form = h("form", { class: "popover choice-popover", role: "dialog", "aria-label": options.title },
    h("div", { class: "popover-title", text: options.title }), fields, note,
    h("div", { class: "popover-actions" }, button({ label: "Cancel", onClick: () => close(true) }), apply));
  const controls = new Map<string, { host: HTMLElement; list: ChoiceList<string>; text: HTMLElement; search: SearchField; query: string }>();
  function refresh() {
    if (closed) return;
    const state = options.snapshot(), live = new Set(state.fields.map(field => field.key));
    for (const [key, control] of controls) if (!live.has(key)) { control.host.remove(); controls.delete(key); }
    for (const field of state.fields) {
      let control = controls.get(field.key);
      if (!control) {
        const list = new ChoiceList({ label: field.label, layout: "rows", radio: true,
          onSelect: value => { options.select(field.key, value); refresh(); } });
        list.list.setAttribute("aria-label", field.name); list.list.removeAttribute("aria-labelledby");
        const text = h("p", { class: "popover-choice-text" });
        const search = new SearchField({ label: `Search ${field.label.toLowerCase()}`, placeholder: "Search looks…", onFilter: value => { controls.get(field.key)!.query = value; refresh(); } });
        const host = h("div", { class: "choice-popover-field", "data-slot": field.key }, search.element, list.element, text);
        control = { host, list, text, search, query: "" }; controls.set(field.key, control);
      }
      if (control.host.parentElement !== fields) fields.append(control.host);
      const single = field.options.length === 1;
      control.list.element.hidden = single; control.text.hidden = !single; control.search.element.hidden = !field.search || single;
      setText(control.text, `${field.label} ${field.options[0]?.label ?? "Leave empty"}`);
      const query = control.query.trim().toLowerCase();
      control.list.setOptions(field.options.filter(option => !query || `${option.label} ${option.group ?? ""}`.toLowerCase().includes(query)));
      control.list.update(field.value);
    }
    apply.disabled = state.capability?.available === false;
    setText(note, state.capability?.available === false ? state.capability.reason ?? "That can't be done yet." : state.note ?? "");
    place(form, anchor);
  }
  function commit() { if (options.snapshot().capability?.available === false) { refresh(); return; } close(true); options.commit(); }
  function close(restore: boolean) {
    if (closed) return;
    closed = true; document.removeEventListener("pointerdown", outside, true); form.remove(); options.onClose?.();
    if (restore && invoker?.isConnected) invoker.focus();
  }
  const outside = (event: PointerEvent) => { if (!event.composedPath().includes(form)) close(false); };
  form.addEventListener("submit", event => { event.preventDefault(); commit(); });
  form.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === "Enter" && (event.target === form || event.target instanceof HTMLInputElement)) {
      event.preventDefault(); event.stopPropagation(); commit();
    }
  });
  document.body.append(form); refresh();
  // A hidden search input cannot take focus in a browser. Start on the first visible field, so Escape reaches the form too.
  const first = [...controls.values()].find(control => !control.list.element.hidden);
  (first ? !first.search.element.hidden ? first.search.input : first.list.element.querySelector<HTMLElement>("[tabindex='0']") : apply)?.focus();
  setTimeout(() => { if (!closed) document.addEventListener("pointerdown", outside, true); });
  return { refresh, close };
}

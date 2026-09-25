import { clamp, h, uid } from "./dom";
import { icon, type IconName } from "./icons";

/**
 * Accessible menu and popover primitives. Items carry their own capability, so a
 * disabled entry is still focusable and states *why* it is unavailable. Menus
 * never decide availability: callers pass the application's capability result.
 */
export type Capability = { available: boolean; reason?: string };
export type MenuItem =
  | { kind: "action"; label: string; icon?: IconName; shortcut?: string; hint?: string;
      capability?: Capability; checked?: boolean; danger?: boolean; run(): void }
  | { kind: "submenu"; label: string; icon?: IconName; hint?: string; capability?: Capability; items: () => MenuItem[] }
  | { kind: "separator" }
  | { kind: "heading"; label: string; detail?: string };
export type MenuAnchor = { x: number; y: number } | Element;

/**
 * A menu section: an optional short label (only where it aids scanning) over its entries.
 * Context menus are actionable, not informational: see `menuFromSections`.
 */
export type MenuSection = { label?: string; detail?: string; items: MenuItem[] };
const actionable = (item: MenuItem) => item.kind === "action" || item.kind === "submenu";
/** Flatten sections, dropping any without an action or submenu (disabled entries still count: they state why). */
export function menuFromSections(sections: readonly MenuSection[]): MenuItem[] {
  const items: MenuItem[] = [];
  for (const section of sections) {
    if (!section.items.some(actionable)) continue;
    if (items.length) items.push({ kind: "separator" });
    if (section.label) items.push({ kind: "heading", label: section.label, detail: section.detail });
    items.push(...section.items);
  }
  return items;
}
/** Split a flat menu into sections: a heading starts one, a separator ends one. */
export function menuSections(items: readonly MenuItem[]): { label?: string; items: MenuItem[] }[] {
  const sections: { label?: string; items: MenuItem[] }[] = [];
  let current: { label?: string; items: MenuItem[] } | undefined;
  for (const item of items) {
    if (item.kind === "separator") { current = undefined; continue; }
    if (item.kind === "heading") { current = { label: item.label, items: [] }; sections.push(current); continue; }
    if (!current) { current = { items: [] }; sections.push(current); }
    current.items.push(item);
  }
  return sections;
}

type OpenMenu = { element: HTMLElement; parent?: OpenMenu; child?: OpenMenu; invoker?: Element | null; close(restore: boolean): void };
let root: OpenMenu | undefined;
let layer: HTMLElement | undefined;
function menuLayer() {
  if (!layer) { layer = h("div", { class: "menu-layer" }); document.body.append(layer); }
  return layer;
}
function place(element: HTMLElement, anchor: MenuAnchor, submenu = false) {
  const margin = 6, { innerWidth: vw, innerHeight: vh } = window;
  element.style.left = "0px"; element.style.top = "0px";
  const rect = element.getBoundingClientRect();
  let x: number, y: number;
  if (anchor instanceof Element) {
    const a = anchor.getBoundingClientRect();
    if (submenu) { x = a.right - 2; y = a.top - 5; if (x + rect.width > vw - margin) x = a.left - rect.width + 2; }
    else { x = a.left; y = a.bottom + 4; if (y + rect.height > vh - margin) y = a.top - rect.height - 4; }
  } else { x = anchor.x; y = anchor.y; if (x + rect.width > vw - margin) x = anchor.x - rect.width; if (y + rect.height > vh - margin) y = anchor.y - rect.height; }
  element.style.left = `${clamp(x, margin, Math.max(margin, vw - rect.width - margin))}px`;
  element.style.top = `${clamp(y, margin, Math.max(margin, vh - rect.height - margin))}px`;
}

export function closeMenus(restoreFocus = true) { root?.close(restoreFocus); }
// One listener for the page: leaving the window closes any open menu.
if (typeof window !== "undefined") window.addEventListener("blur", () => closeMenus(false));
export function menuOpen() { return !!root; }

export function openMenu(items: MenuItem[], anchor: MenuAnchor, options: { label: string; invoker?: Element | null; onClose?(): void } = { label: "Menu" }) {
  closeMenus(false);
  const invoker = options.invoker ?? (document.activeElement instanceof Element ? document.activeElement : null);
  root = build(items, anchor, options.label, undefined, invoker, options.onClose);
  const outside = (event: PointerEvent) => {
    if (!root) return;
    const path = event.composedPath();
    let open: OpenMenu | undefined = root;
    while (open) { if (path.includes(open.element)) return; open = open.child; }
    closeMenus(false);
  };
  document.addEventListener("pointerdown", outside, { capture: true });
  const detach = () => document.removeEventListener("pointerdown", outside, { capture: true });
  const previous = root.close;
  root.close = restore => { detach(); previous(restore); };
  return root;
}

function build(items: MenuItem[], anchor: MenuAnchor, label: string, parent: OpenMenu | undefined,
  invoker: Element | null, onClose?: () => void): OpenMenu {
  const element = h("div", { class: "menu", role: "menu", "aria-label": label, tabindex: "-1" });
  const entries: HTMLElement[] = [];
  const self: OpenMenu = { element, parent, invoker, close(restore) {
    self.child?.close(false);
    element.remove();
    if (parent) { parent.child = undefined; if (restore) (invoker as HTMLElement | null)?.focus?.(); }
    else { root = undefined; onClose?.(); if (restore && invoker instanceof HTMLElement && invoker.isConnected) invoker.focus(); }
  } };
  for (const item of items) {
    if (item.kind === "separator") { element.append(h("div", { class: "menu-sep", role: "separator" })); continue; }
    if (item.kind === "heading") {
      element.append(h("div", { class: "menu-heading", role: "presentation" }, h("span", { text: item.label }),
        item.detail ? h("small", { text: item.detail }) : null)); continue;
    }
    const available = item.capability?.available ?? true;
    const reason = !available ? item.capability?.reason ?? "Unavailable." : undefined;
    const descId = uid("menu-desc");
    const entry = h("div", { class: `menu-item${item.kind === "action" && item.danger ? " danger" : ""}`,
      role: item.kind === "action" && item.checked !== undefined ? "menuitemcheckbox" : "menuitem",
      tabindex: "-1", "aria-disabled": available ? undefined : "true",
      "aria-checked": item.kind === "action" && item.checked !== undefined ? String(item.checked) : undefined,
      "aria-haspopup": item.kind === "submenu" ? "menu" : undefined,
      "aria-describedby": reason || item.hint ? descId : undefined },
      h("span", { class: "menu-icon" }, item.kind === "action" && item.checked ? icon("check") : item.icon ? icon(item.icon) : null),
      h("span", { class: "menu-text" }, h("span", { class: "menu-label", text: item.label }),
        reason || item.hint ? h("small", { id: descId, class: reason ? "menu-reason" : "menu-hint", text: reason ?? item.hint })
          : null),
      item.kind === "action" && item.shortcut ? h("kbd", { text: item.shortcut }) : null,
      item.kind === "submenu" ? h("span", { class: "menu-sub" }, icon("chevronRight")) : null);
    const activate = () => {
      if (!available) return;
      if (item.kind === "submenu") { openChild(entry, item); return; }
      closeMenus(true);
      item.run();
    };
    entry.addEventListener("click", activate);
    entry.addEventListener("pointerenter", () => {
      entry.focus();
      if (item.kind === "submenu" && available) openChild(entry, item);
      else self.child?.close(false);
    });
    entry.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); }
      if (event.key === "ArrowRight" && item.kind === "submenu") { event.preventDefault(); if (available) openChild(entry, item, true); }
    });
    entries.push(entry);
    element.append(entry);
  }
  function openChild(entry: HTMLElement, item: Extract<MenuItem, { kind: "submenu" }>, focusFirst = false) {
    if (self.child?.invoker === entry) { if (focusFirst) focusEntry(self.child, 0); return; }
    self.child?.close(false);
    self.child = build(item.items(), entry, item.label, self, entry);
    if (focusFirst) focusEntry(self.child, 0);
  }
  element.addEventListener("keydown", event => {
    const index = entries.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      entries[(index + step + entries.length) % entries.length]?.focus();
    } else if (event.key === "Home") { event.preventDefault(); entries[0]?.focus(); }
    else if (event.key === "End") { event.preventDefault(); entries.at(-1)?.focus(); }
    else if (event.key === "Escape" || (event.key === "ArrowLeft" && parent)) {
      event.preventDefault(); event.stopPropagation(); self.close(true);
    } else if (event.key === "Tab") { event.preventDefault(); closeMenus(true); }
    else if (event.key.length === 1 && /\S/.test(event.key)) {
      const start = index + 1, key = event.key.toLowerCase();
      const match = [...entries.slice(start), ...entries.slice(0, start)].find(entry =>
        entry.querySelector(".menu-label")?.textContent?.toLowerCase().startsWith(key));
      match?.focus();
    }
    event.stopPropagation();
  });
  if (!entries.length) element.append(h("div", { class: "menu-empty", text: "No commands apply here." }));
  menuLayer().append(element);
  place(element, anchor, !!parent);
  if (!parent) requestAnimationFrame(() => focusEntry(self, 0));
  return self;
}
function focusEntry(menu: OpenMenu, index: number) {
  const entries = [...menu.element.querySelectorAll<HTMLElement>(".menu-item")];
  (entries[index] ?? menu.element).focus();
}

/** A small anchored editor for commands that need one value before dispatch. */
export type ValueField =
  | { kind: "range"; label: string; value: number; min: number; max: number; step: number; format(value: number): string }
  | { kind: "text"; label: string; value: string; maxLength: number }
  | { kind: "integer"; label: string; value: number; min: number; max: number };
export function openValuePopover(field: ValueField, anchor: MenuAnchor, options: {
  title: string; apply: string; validate?(value: string | number): Capability; commit(value: string | number): void;
}) {
  closeMenus(false);
  const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const inputId = uid("value");
  const input = field.kind === "text"
    ? h("input", { id: inputId, type: "text", value: field.value, maxlength: String(field.maxLength), class: "field" })
    : field.kind === "integer"
      ? h("input", { id: inputId, type: "number", value: String(field.value), min: String(field.min), max: String(field.max), step: "1", class: "field" })
      : h("input", { id: inputId, type: "range", value: String(field.value), min: String(field.min), max: String(field.max), step: String(field.step), class: "slider" });
  const readout = field.kind === "range" ? h("output", { for: inputId, class: "readout", text: field.format(field.value) }) : null;
  const note = h("p", { class: "popover-note", role: "status" });
  const applyButton = h("button", { class: "btn primary", type: "submit", text: options.apply });
  const form = h("form", { class: "popover", role: "dialog", "aria-label": options.title },
    h("div", { class: "popover-title", text: options.title }),
    h("label", { class: "popover-field", for: inputId }, h("span", { text: field.label }), readout),
    input, note,
    h("div", { class: "popover-actions" }, h("button", { class: "btn", type: "button", text: "Cancel", onclick: () => close(true) }), applyButton));
  const read = () => field.kind === "text" ? input.value : Number(input.value);
  const check = () => {
    const result = options.validate?.(read()) ?? { available: true };
    applyButton.disabled = !result.available;
    note.textContent = result.available ? "" : result.reason ?? "This value is not accepted.";
    if (readout && field.kind === "range") readout.textContent = field.format(Number(input.value));
    return result.available;
  };
  input.addEventListener("input", check);
  form.addEventListener("submit", event => { event.preventDefault(); if (!check()) return; close(false); options.commit(read()); });
  form.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); } });
  const outside = (event: PointerEvent) => { if (!event.composedPath().includes(form)) close(false); };
  function close(restore: boolean) {
    document.removeEventListener("pointerdown", outside, { capture: true });
    form.remove();
    if (restore && invoker?.isConnected) invoker.focus();
  }
  menuLayer().append(form);
  place(form, anchor);
  check();
  requestAnimationFrame(() => { input.focus(); if (input instanceof HTMLInputElement && field.kind === "text") input.select(); });
  setTimeout(() => document.addEventListener("pointerdown", outside, { capture: true }));
  return { close };
}

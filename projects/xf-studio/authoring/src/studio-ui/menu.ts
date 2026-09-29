import { Toggle } from "./controls";
import { clamp, h, uid } from "./dom";
import { icon, type IconName } from "./icons";
import { stageTag, type Stage } from "./components/stage-tag";

/**
 * Accessible menu and popover primitives. Items carry their own capability, so a
 * disabled entry is still focusable and states *why* it is unavailable. Menus
 * never decide availability: callers pass the application's capability result.
 */
export type Capability = { available: boolean; reason?: string };
export type MenuItem =
  | { kind: "action"; label: string; icon?: IconName; shortcut?: string; hint?: string;
      capability?: Capability; checked?: boolean; danger?: boolean; run(): void;
      /** A small neutral tag after the label ("Soon" on a planned entry, research tools only). */
      tag?: string;
      /** The release stage of what the entry shows or turns on: an Early access stage tag after the label (components/stage-tag.ts). */
      stage?: Stage;
      /**
       * What the entry is (a panel's description): its tooltip and accessible description, never a visible line, so a long menu of
       * like entries stays one row each (G2: what a thing is goes in a tip; C-32). A visible `hint` or reason still shows as usual.
       */
      tip?: string }
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

/** Whether a menu of these items offers anything to act on (an action or a submenu, available or with its reason). */
export const hasCommands = (items: readonly MenuItem[]) => items.some(item => item.kind === "action" || item.kind === "submenu");
/**
 * A menu button's availability from the menu it opens (UI-139): available while the menu holds something to act on, otherwise
 * unavailable with `reason`, so a "…" never opens nothing. Apply it with `applyCapability` whenever what the menu would hold changes.
 */
export const menuCapability = (items: readonly MenuItem[], reason: string): Capability =>
  hasCommands(items) ? { available: true } : { available: false, reason };
/**
 * Open a menu. A menu with nothing to act on (only headings, separators, or nothing) never opens, and nothing is closed: menus are
 * actionable, never informational, so the owner disables its trigger with the reason instead (`hasCommands` asks first). Returns the
 * open menu, or undefined when it didn't open.
 */
export function openMenu(items: MenuItem[], anchor: MenuAnchor, options: { label: string; invoker?: Element | null; onClose?(): void } = { label: "Menu" }) {
  if (!hasCommands(items)) return undefined;
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
    const tip = item.kind === "action" ? item.tip : undefined;
    const entry = h("div", { class: `menu-item${item.kind === "action" && item.danger ? " danger" : ""}`,
      role: item.kind === "action" && item.checked !== undefined ? "menuitemcheckbox" : "menuitem",
      tabindex: "-1", "aria-disabled": available ? undefined : "true",
      "aria-checked": item.kind === "action" && item.checked !== undefined ? String(item.checked) : undefined,
      "aria-haspopup": item.kind === "submenu" ? "menu" : undefined,
      "aria-describedby": reason || item.hint || tip ? descId : undefined, title: tip },
      h("span", { class: "menu-icon" }, item.kind === "action" && item.checked ? icon("check") : item.icon ? icon(item.icon) : null),
      h("span", { class: "menu-text" }, h("span", { class: "menu-label" }, item.label, item.kind === "action" && item.tag ? h("span", { class: "menu-tag", text: item.tag }) : null,
        item.kind === "action" ? stageTag(item.stage, "menu-tag") : null),
        reason || item.hint ? h("small", { id: descId, class: reason ? "menu-reason" : "menu-hint", text: reason ?? item.hint })
          : tip ? h("small", { id: descId, class: "sr-only", text: tip }) : null),
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
    // A submenu with nothing to act on stays closed, as a menu does.
    const items = item.items();
    if (!hasCommands(items)) return;
    self.child = build(items, entry, item.label, self, entry);
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
/** An option under the value (a switch), set to its default: the value alone is enough, the option only overrides. */
export type ValueOption = { label: string; checked: boolean; help?: string };
/**
 * `options`: switches under the field (e.g. Save layout's "Remember shown modules"), each with a sensible default; `commit` gets their
 * states in order.
 */
export function openValuePopover(field: ValueField, anchor: MenuAnchor, options: {
  title: string; apply: string; validate?(value: string | number): Capability; commit(value: string | number, options: boolean[]): void;
  options?: readonly ValueOption[];
  /** What the value is used for, muted on the note line while the value is accepted; a refusal takes its place (UI-143). */
  hint?: string;
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
  const switches = (options.options ?? []).map(option => { const toggle = new Toggle({ label: option.label, help: option.help, onChange: () => {} });
    toggle.update(option.checked); return toggle; });
  const applyButton = h("button", { class: "btn primary", type: "submit", text: options.apply });
  const form = h("form", { class: "popover", role: "dialog", "aria-label": options.title },
    h("div", { class: "popover-title", text: options.title }),
    h("label", { class: "popover-field", for: inputId }, h("span", { text: field.label }), readout),
    input, note, ...switches.map(toggle => toggle.element),
    h("div", { class: "popover-actions" }, h("button", { class: "btn", type: "button", text: "Cancel", onclick: () => close(true) }), applyButton));
  const read = () => field.kind === "text" ? input.value : Number(input.value);
  const check = () => {
    const result = options.validate?.(read()) ?? { available: true };
    applyButton.disabled = !result.available;
    note.textContent = result.available ? options.hint ?? "" : result.reason ?? "This value is not accepted.";
    note.classList.toggle("hint", result.available);
    if (readout && field.kind === "range") readout.textContent = field.format(Number(input.value));
    return result.available;
  };
  input.addEventListener("input", check);
  form.addEventListener("submit", event => { event.preventDefault(); if (!check()) return; close(false); options.commit(read(), switches.map(toggle => toggle.input.checked)); });
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

/**
 * Confirm popover (style guide "Menu, value and confirm popovers"): one question anchored to what it acts on, for an action that can't
 * be undone (removing a saved preset from the library). Title, one plain sentence of what happens, Cancel and the action's own verb
 * (danger styled when `danger`). Focus starts on Cancel, so a stray Enter never destroys anything; Escape, Cancel or a click outside
 * closes it and returns focus to the invoker; the action closes it and then runs.
 */
export function openConfirmPopover(anchor: MenuAnchor, options: { title: string; message: string; confirm: string; danger?: boolean; onConfirm(): void }) {
  closeMenus(false);
  const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const messageId = uid("confirm");
  const cancel = h("button", { class: "btn", type: "button", text: "Cancel" });
  const confirm = h("button", { class: `btn${options.danger ? " danger" : " primary"}`, type: "submit", text: options.confirm });
  const form = h("form", { class: "popover confirm-popover", role: "alertdialog", "aria-label": options.title, "aria-describedby": messageId },
    h("div", { class: "popover-title", text: options.title }), h("p", { class: "popover-message", id: messageId, text: options.message }),
    h("div", { class: "popover-actions" }, cancel, confirm));
  cancel.addEventListener("click", () => close(true));
  form.addEventListener("submit", event => { event.preventDefault(); close(true); options.onConfirm(); });
  form.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); } });
  const outside = (event: PointerEvent) => { if (!event.composedPath().includes(form)) close(false); };
  function close(restore: boolean) {
    document.removeEventListener("pointerdown", outside, { capture: true });
    form.remove();
    if (restore && invoker?.isConnected) invoker.focus();
  }
  menuLayer().append(form);
  place(form, anchor);
  requestAnimationFrame(() => cancel.focus());
  setTimeout(() => document.addEventListener("pointerdown", outside, { capture: true }));
  return { close };
}

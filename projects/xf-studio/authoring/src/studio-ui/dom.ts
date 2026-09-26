/** Small DOM toolkit for the Studio presentation. No state, no Studio types. */
type Attrs = Record<string, string | number | boolean | undefined | null | ((event: never) => void)> & {
  class?: string; text?: string; html?: never;
};
type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") element.className = String(value);
    else if (key === "text") element.textContent = String(value);
    else if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2), value as EventListener);
    else if (value === true) element.setAttribute(key, "");
    else element.setAttribute(key, String(value));
  }
  append(element, children);
  return element;
}
export function append(parent: Node, children: (Child | Child[])[]) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)));
  }
}
/** Text updates that never rebuild a node while a user may be reading it with assistive tech. */
export function setText(element: Element, text: string) { if (element.textContent !== text) element.textContent = text; }
export function setAttr(element: Element, name: string, value: string | boolean | undefined) {
  if (value === undefined || value === false) { if (element.hasAttribute(name)) element.removeAttribute(name); }
  else { const text = value === true ? "" : value; if (element.getAttribute(name) !== text) element.setAttribute(name, text); }
}
/** Keep an input's value unless the user is currently editing it. */
export function setValue(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  if (document.activeElement === input && input instanceof HTMLInputElement && input.type !== "range" && input.type !== "checkbox") return;
  if (input.value !== value) input.value = value;
}
export function setDisabled(control: HTMLButtonElement | HTMLInputElement | HTMLSelectElement, disabled: boolean, reason?: string) {
  if (control.disabled !== disabled) control.disabled = disabled;
  const title = disabled ? reason ?? "" : control.dataset.title ?? "";
  if (control.title !== title) control.title = title;
}
/**
 * The menu pattern for a main action (UI-84): an unavailable button stays focusable and reachable by keyboard, touch and
 * screen readers, carries `aria-disabled` and states why (`aria-description`, and a visible tip on focus, hover or tap:
 * reason-tip.ts). A click on it runs nothing. Native `disabled` is kept for form fields only.
 */
export function setUnavailable(control: HTMLElement, unavailable: boolean, reason?: string) {
  if ((control as HTMLButtonElement).disabled) (control as HTMLButtonElement).disabled = false;
  const why = unavailable ? reason || "Not available right now." : undefined;
  setAttr(control, "aria-disabled", unavailable ? "true" : undefined);
  setAttr(control, "data-reason", why);
  setAttr(control, "aria-description", why);
  const title = why ?? control.dataset.title ?? "";
  if (control.title !== title) control.title = title;
}
/** Whether a control is unavailable (native `disabled`, or the main-action pattern's `aria-disabled`). */
export const isUnavailable = (control: Element) => (control as HTMLButtonElement).disabled === true || control.getAttribute("aria-disabled") === "true";
let idCounter = 0;
export const uid = (prefix = "xfs") => `${prefix}-${++idCounter}`;
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const pct = (value: number) => `${Math.round(value * 100)}%`;
export const isTextInput = (target: EventTarget | null) => target instanceof HTMLElement &&
  (target.isContentEditable || target.matches("input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=color]), textarea, select"));
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

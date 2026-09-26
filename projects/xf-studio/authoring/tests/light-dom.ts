// A light DOM for presentation tests: just enough of Node, Element, events, focus and simple selectors for the Studio's `h()` toolkit
// and its panels to run under Bun without a browser. Install it with `installLightDom()` before importing presentation modules that touch
// `document` at call time; uninstall it afterwards. It is a test harness, not a browser: layout sizes are zero.

type Listener = (event: LightEvent) => void;
export type LightEvent = { type: string; key?: string; target?: LightElement; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean;
  defaultPrevented?: boolean; preventDefault(): void };

export class LightNode {
  parentNode: LightElement | null = null;
  readonly childNodes: LightNode[] = [];
  protected text = "";
  get textContent(): string { return this.childNodes.length ? this.childNodes.map(child => child.textContent).join("") : this.text; }
  set textContent(value: string) { for (const child of this.childNodes.splice(0)) child.parentNode = null; this.text = String(value); }
  get isConnected(): boolean { let node: LightNode | null = this; while (node?.parentNode) node = node.parentNode; return node === lightDocument.body; }
  remove() { this.parentNode?.removeChild(this); }
}
export class LightText extends LightNode {
  constructor(text: string) { super(); this.text = text; }
}

const kebab = (key: string) => key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
export class LightElement extends LightNode {
  readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Set<Listener>>();
  readonly style = { values: new Map<string, string>(), setProperty(name: string, value: string) { this.values.set(name, value); } };
  readonly dataset: Record<string, string | undefined>;
  value = "";
  checked = false;
  clientWidth = 0;
  offsetWidth = 0;
  constructor(readonly tagName: string) {
    super();
    const self = this;
    this.dataset = new Proxy({}, {
      get: (_target, key) => self.getAttribute(`data-${kebab(String(key))}`) ?? undefined,
      set: (_target, key, value) => { self.setAttribute(`data-${kebab(String(key))}`, String(value)); return true; },
    });
  }
  get children(): LightElement[] { return this.childNodes.filter((node): node is LightElement => node instanceof LightElement); }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  get id() { return this.getAttribute("id") ?? ""; }
  set id(value: string) { this.setAttribute("id", value); }
  get className() { return this.getAttribute("class") ?? ""; }
  set className(value: string) { this.setAttribute("class", value); }
  get title() { return this.getAttribute("title") ?? ""; }
  set title(value: string) { this.setAttribute("title", value); }
  get type() { return this.getAttribute("type") ?? ""; }
  get hidden() { return this.hasAttribute("hidden"); }
  set hidden(value: boolean) { if (value) this.setAttribute("hidden", ""); else this.removeAttribute("hidden"); }
  get disabled() { return this.hasAttribute("disabled"); }
  set disabled(value: boolean) { if (value) this.setAttribute("disabled", ""); else this.removeAttribute("disabled"); }
  get tabIndex() { return Number(this.getAttribute("tabindex") ?? -1); }
  set tabIndex(value: number) { this.setAttribute("tabindex", String(value)); }
  readonly classList = {
    list: () => this.className.split(/\s+/).filter(Boolean),
    contains: (name: string) => this.classList.list().includes(name),
    add: (...names: string[]) => { this.className = [...new Set([...this.classList.list(), ...names])].join(" "); },
    remove: (...names: string[]) => { this.className = this.classList.list().filter(name => !names.includes(name)).join(" "); },
    toggle: (name: string, force?: boolean) => { const on = force ?? !this.classList.contains(name); if (on) this.classList.add(name); else this.classList.remove(name); return on; },
  };
  appendChild<T extends LightNode>(child: T): T { child.parentNode?.removeChild(child); child.parentNode = this; this.childNodes.push(child); this.text = ""; return child; }
  append(...children: (LightNode | string)[]) { for (const child of children) this.appendChild(typeof child === "string" ? new LightText(child) : child); }
  insertBefore<T extends LightNode>(child: T, before: LightNode | null): T {
    if (!before) return this.appendChild(child);
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
    return child;
  }
  removeChild(child: LightNode) { const at = this.childNodes.indexOf(child); if (at >= 0) this.childNodes.splice(at, 1); child.parentNode = null; return child; }
  replaceChildren(...children: (LightNode | string)[]) { for (const child of this.childNodes.splice(0)) child.parentNode = null; this.append(...children); }
  contains(node: LightNode | null): boolean { for (let at = node; at; at = at.parentNode) if (at === this) return true; return false; }
  addEventListener(type: string, listener: Listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(listener); }
  removeEventListener(type: string, listener: Listener) { this.listeners.get(type)?.delete(listener); }
  /** Dispatch with bubbling to the ancestors. */
  dispatchEvent(event: LightEvent) {
    event.target ??= this;
    for (let at: LightElement | null = this; at; at = at.parentNode) for (const listener of at.listeners.get(event.type) ?? []) listener(event);
    return !event.defaultPrevented;
  }
  click() { if (!this.disabled) this.dispatchEvent(lightEvent("click")); }
  focus() { lightDocument.activeElement = this; this.dispatchEvent(lightEvent("focus")); }
  /** Every descendant, depth first. */
  descendants(): LightElement[] { return this.children.flatMap(child => [child, ...child.descendants()]); }
  querySelectorAll(selector: string): LightElement[] { return this.descendants().filter(element => matches(element, selector)); }
  querySelector(selector: string): LightElement | null { return this.querySelectorAll(selector)[0] ?? null; }
}
export class LightInput extends LightElement {}

/** Simple selectors only: a tag, `.class`, `[attr]` or `[attr="value"]`, combined without spaces. */
function matches(element: LightElement, selector: string): boolean {
  const parts = selector.match(/^[a-z0-9]+|\.[\w-]+|\[[^\]]+\]/gi) ?? [];
  return parts.every(part => {
    if (part.startsWith(".")) return element.classList.contains(part.slice(1));
    if (part.startsWith("[")) {
      const [name, value] = part.slice(1, -1).split("=");
      return value === undefined ? element.hasAttribute(name!) : element.getAttribute(name!) === value.replace(/^"|"$/g, "");
    }
    return element.tagName === part.toLowerCase();
  });
}

export const lightEvent = (type: string, extra: Partial<LightEvent> = {}): LightEvent => ({ type, ...extra,
  preventDefault() { this.defaultPrevented = true; } });

export const lightDocument = {
  body: new LightElement("body"),
  activeElement: null as LightElement | null,
  createElement: (tag: string) => tag === "input" ? new LightInput(tag) : new LightElement(tag),
  createElementNS: (_ns: string, tag: string) => new LightElement(tag),
  createTextNode: (text: string) => new LightText(text),
};

const saved: Record<string, unknown> = {};
const GLOBALS = { document: lightDocument, HTMLElement: LightElement, HTMLInputElement: LightInput, HTMLButtonElement: LightElement, Node: LightNode } as const;
export function installLightDom() {
  lightDocument.body = new LightElement("body");
  lightDocument.activeElement = null;
  for (const [key, value] of Object.entries(GLOBALS)) { saved[key] = (globalThis as Record<string, unknown>)[key]; (globalThis as Record<string, unknown>)[key] = value; }
}
export function uninstallLightDom() {
  for (const key of Object.keys(GLOBALS)) { if (saved[key] === undefined) delete (globalThis as Record<string, unknown>)[key]; else (globalThis as Record<string, unknown>)[key] = saved[key]; }
}

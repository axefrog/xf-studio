import { h, setAttr, setDisabled, setText, setValue, uid } from "./dom";
import { icon, type IconName } from "./icons";

/**
 * Form controls for the Studio presentation. Continuous controls speak a
 * begin/edit/commit/cancel transaction so the application can group a drag into
 * one Undo step and Escape can restore its starting value.
 */
export type Transaction<T> = { begin?(): void; edit(value: T): void; commit?(): void; cancel?(): void };
const editKeys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

export class Slider {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly output: HTMLOutputElement;
  private readonly note: HTMLElement;
  private active = false;
  constructor(private options: { label: string; min: number; max: number; step: number; format(value: number): string;
    transaction: Transaction<number>; help?: string; id?: string }) {
    const id = options.id ?? uid("slider");
    this.input = h("input", { id, class: "slider", type: "range", min: String(options.min), max: String(options.max), step: String(options.step) });
    this.output = h("output", { class: "readout", for: id });
    this.note = h("small", { class: "control-note" });
    this.element = h("div", { class: "control" },
      h("label", { class: "control-label", for: id }, h("span", { text: options.label }), this.output),
      this.input, options.help ? h("small", { class: "control-help", text: options.help }) : null, this.note);
    const begin = () => { if (!this.active && !this.input.disabled) { this.active = true; options.transaction.begin?.(); } };
    const commit = () => { if (this.active) { this.active = false; options.transaction.commit?.(); } };
    this.input.addEventListener("pointerdown", begin);
    this.input.addEventListener("keydown", event => {
      if (editKeys.has(event.key)) begin();
      else if (event.key === "Escape" && this.active) {
        event.preventDefault(); event.stopPropagation(); this.active = false; options.transaction.cancel?.();
      }
    });
    this.input.addEventListener("input", () => {
      begin();
      const value = Number(this.input.value);
      this.fill();
      this.output.textContent = options.format(value);
      options.transaction.edit(value);
    });
    this.input.addEventListener("change", commit);
    this.input.addEventListener("blur", commit);
    this.input.addEventListener("pointercancel", commit);
  }
  private fill() {
    const min = Number(this.input.min), max = Number(this.input.max), value = Number(this.input.value);
    this.input.style.setProperty("--fill", `${max > min ? (value - min) / (max - min) * 100 : 0}%`);
  }
  update(value: number | undefined, state: { disabled?: boolean; reason?: string; min?: number; max?: number; note?: string } = {}) {
    if (state.min !== undefined) setAttr(this.input, "min", String(state.min));
    if (state.max !== undefined) setAttr(this.input, "max", String(state.max));
    if (!this.active && value !== undefined) setValue(this.input, String(value));
    this.fill();
    setText(this.output, value === undefined ? "—" : this.options.format(this.active ? Number(this.input.value) : value));
    setDisabled(this.input, !!state.disabled, state.reason);
    setText(this.note, state.disabled && state.reason ? state.reason : state.note ?? "");
    this.note.hidden = !this.note.textContent;
  }
}

export class Toggle {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly note: HTMLElement;
  constructor(options: { label: string; help?: string; onChange(checked: boolean): void; id?: string }) {
    const id = options.id ?? uid("toggle");
    this.input = h("input", { id, type: "checkbox", role: "switch", class: "switch" });
    this.note = h("small", { class: "control-note" });
    this.element = h("div", { class: "control toggle-row" },
      h("label", { class: "toggle", for: id }, this.input, h("span", { class: "switch-track", "aria-hidden": "true" }),
        h("span", { class: "toggle-label", text: options.label })),
      options.help ? h("small", { class: "control-help", text: options.help }) : null, this.note);
    this.input.addEventListener("change", () => options.onChange(this.input.checked));
  }
  update(checked: boolean, state: { disabled?: boolean; reason?: string; note?: string } = {}) {
    if (this.input.checked !== checked) this.input.checked = checked;
    setDisabled(this.input, !!state.disabled, state.reason);
    setText(this.note, state.disabled && state.reason ? state.reason : state.note ?? "");
    this.note.hidden = !this.note.textContent;
  }
}

export type SegmentOption<T extends string | number> = { value: T; label: string; icon?: IconName; title?: string };
export class Segmented<T extends string | number> {
  readonly element: HTMLElement;
  private readonly buttons: { value: T; button: HTMLButtonElement }[];
  constructor(options: { label: string; options: SegmentOption<T>[]; onSelect(value: T): void; compact?: boolean; showLabel?: boolean }) {
    const labelId = uid("seg");
    this.buttons = options.options.map(option => ({ value: option.value, button: h("button", { class: "segment", type: "button",
      "aria-pressed": "false", title: option.title, "data-title": option.title,
      onclick: () => options.onSelect(option.value) }, option.icon ? icon(option.icon) : null, h("span", { text: option.label })) }));
    this.element = h("div", { class: `control${options.compact ? " compact" : ""}` },
      options.showLabel === false ? null : h("span", { class: "control-label", id: labelId }, h("span", { text: options.label })),
      h("div", { class: "segmented", role: "group", "aria-label": options.showLabel === false ? options.label : undefined,
        "aria-labelledby": options.showLabel === false ? undefined : labelId }, this.buttons.map(item => item.button)));
  }
  update(selected: T | undefined, capability: (value: T) => { available: boolean; reason?: string } = () => ({ available: true })) {
    for (const { value, button } of this.buttons) {
      setAttr(button, "aria-pressed", String(value === selected));
      const allowed = capability(value);
      setDisabled(button, !allowed.available && value !== selected, allowed.reason);
    }
  }
}

export class ColorField {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly hex: HTMLInputElement;
  private active = false;
  constructor(options: { label: string; transaction: Transaction<string>; id?: string }) {
    const id = options.id ?? uid("color");
    this.input = h("input", { id, type: "color", class: "swatch-input", "aria-label": options.label });
    this.hex = h("input", { type: "text", class: "field mono hex", maxlength: "7", spellcheck: "false", "aria-label": `${options.label} hex value` });
    this.element = h("div", { class: "control" }, h("span", { class: "control-label" }, h("span", { text: options.label })),
      h("div", { class: "color-field" }, h("span", { class: "swatch-frame" }, this.input), this.hex));
    const begin = () => { if (!this.active) { this.active = true; options.transaction.begin?.(); } };
    const commit = () => { if (this.active) { this.active = false; options.transaction.commit?.(); } };
    this.input.addEventListener("pointerdown", begin);
    this.input.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") begin(); });
    this.input.addEventListener("input", () => { begin(); this.hex.value = this.input.value; options.transaction.edit(this.input.value); });
    this.input.addEventListener("change", commit);
    this.input.addEventListener("blur", commit);
    const applyHex = () => {
      const value = this.hex.value.trim().toLowerCase();
      const normal = /^#?[0-9a-f]{6}$/.test(value) ? (value.startsWith("#") ? value : `#${value}`) : undefined;
      if (!normal) { this.hex.value = this.input.value; this.hex.setAttribute("aria-invalid", "true"); return; }
      this.hex.removeAttribute("aria-invalid");
      if (normal === this.input.value) return;
      options.transaction.begin?.(); options.transaction.edit(normal); options.transaction.commit?.();
    };
    this.hex.addEventListener("change", applyHex);
    this.hex.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); applyHex(); } });
  }
  update(value: string | undefined, disabled = false, reason?: string) {
    if (!this.active && value) { setValue(this.input, value); setValue(this.hex, value); }
    setDisabled(this.input, disabled, reason); setDisabled(this.hex, disabled, reason);
  }
}

export class SelectField<T extends string> {
  readonly element: HTMLElement;
  readonly select: HTMLSelectElement;
  private signature = "";
  constructor(private options: { label: string; onChange(value: T): void; id?: string; help?: string }) {
    const id = options.id ?? uid("select");
    this.select = h("select", { id, class: "field" });
    this.element = h("div", { class: "control" }, h("label", { class: "control-label", for: id }, h("span", { text: options.label })),
      h("div", { class: "select-wrap" }, this.select, icon("chevronDown")),
      options.help ? h("small", { class: "control-help", text: options.help }) : null);
    this.select.addEventListener("change", () => options.onChange(this.select.value as T));
  }
  update(choices: { value: T; label: string; disabled?: boolean }[], value: T | undefined, disabled = false, reason?: string) {
    const signature = JSON.stringify(choices);
    if (signature !== this.signature) {
      this.signature = signature;
      this.select.replaceChildren(...choices.map(choice => h("option", { value: choice.value, text: choice.label, disabled: choice.disabled })));
    }
    if (value !== undefined) setValue(this.select, value);
    setDisabled(this.select, disabled, reason);
  }
}

export function button(options: { label: string; icon?: IconName; variant?: "primary" | "quiet" | "danger" | "ghost";
  onClick(event: MouseEvent): void; title?: string; iconOnly?: boolean; small?: boolean }) {
  const element = h("button", { class: `btn${options.variant ? ` ${options.variant}` : ""}${options.iconOnly ? " icon-only" : ""}${options.small ? " small" : ""}`,
    type: "button", title: options.title ?? (options.iconOnly ? options.label : undefined), "data-title": options.title ?? (options.iconOnly ? options.label : ""),
    "aria-label": options.iconOnly ? options.label : undefined, onclick: options.onClick },
    options.icon ? icon(options.icon) : null, options.iconOnly ? null : h("span", { text: options.label }));
  return element;
}
/** Enable a button from a capability, keeping the reason discoverable as a tooltip and description. */
export function applyCapability(control: HTMLButtonElement, capability: { available: boolean; reason?: string }) {
  setDisabled(control, !capability.available, capability.reason);
}

export function section(title: string, ...children: (Node | null | undefined | false)[]) {
  return h("section", { class: "section" }, h("h3", { class: "section-title", text: title }), ...children);
}
export function note(text = "", tone: "muted" | "warning" | "info" = "muted") {
  return h("p", { class: `note ${tone}`, text });
}
export function badge(text: string, tone: "neutral" | "accent" | "info" | "success" | "warning" | "error" = "neutral") {
  return h("span", { class: `badge ${tone}`, text });
}
export function emptyState(title: string, body: string, ...actions: HTMLElement[]) {
  return h("div", { class: "empty" }, h("p", { class: "empty-title", text: title }), h("p", { class: "empty-body", text: body }),
    actions.length ? h("div", { class: "empty-actions" }, actions) : null);
}

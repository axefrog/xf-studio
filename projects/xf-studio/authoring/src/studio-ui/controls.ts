import { h, isUnavailable, setAttr, setDisabled, setText, setUnavailable, setValue, uid } from "./dom";
import { helpTip, setHelp, type HelpText } from "./help-tip";
import { icon, type IconName } from "./icons";

/**
 * Form controls for the Studio presentation. Continuous controls speak a
 * begin/edit/commit/cancel transaction so the application can group a drag into
 * one Undo step and Escape can restore its starting value.
 *
 * A control's `help` is what it is or does: it shows as a help tip beside the control's label (help-tip.ts), never as an inline line;
 * inline lines are for what the person can act on (a control's note: a limit, why it is unavailable).
 */
export type Transaction<T> = { begin?(): void; edit(value: T): void; commit?(): void; cancel?(): void };

/**
 * A control's note line never moves the layout (UI-90). A control that has a note (given at construction with `reserveNote`, or
 * shown once) keeps its line from then on: an empty note keeps its height, and a disabled reason takes the note's place. A control
 * without one says why it is disabled in its tooltip and accessible description only; its panel says it once where that matters.
 */
export class NoteLine {
  readonly element = h("small", { class: "control-note" });
  private reserved: boolean;
  constructor(reserve = false) { this.reserved = reserve; this.element.hidden = !reserve; }
  update(control: HTMLElement, disabled: boolean, reason: string | undefined, note: string | undefined) {
    if (note) this.reserved = true;
    const why = disabled && reason ? reason : undefined;
    const text = why && this.reserved ? why : note ?? "";
    setText(this.element, text);
    this.element.hidden = !this.reserved;
    this.element.classList.toggle("empty", !text);
    this.element.classList.toggle("info", !(why && this.reserved));
    setAttr(control, "aria-description", why);
  }
}
const editKeys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

/**
 * A range input's edit transaction, shared by Slider and SliderWithValue. A transaction begins lazily on the first value change, so a
 * click that changes nothing never leaves one open. Pointer drags commit after release; browsers fire `change` for every arrow key,
 * so a keyboard burst stays one transaction until a short pause or blur. After Escape the input ignores further input until the
 * pointer is released or focus leaves. `onValue` hears every edited value (to repaint a readout); `active()` says whether a
 * transaction is open (an update never overwrites a value being dragged).
 */
export function bindRangeTransaction(input: HTMLInputElement, transaction: Transaction<number>, onValue: (value: number) => void): { active(): boolean } {
  let active = false, pointer = false, mode: "pointer" | "keyboard" | undefined, cancelled = false, idle: ReturnType<typeof setTimeout> | undefined;
  const commit = () => {
    clearTimeout(idle);
    if (active) { active = false; mode = undefined; transaction.commit?.(); }
  };
  const armIdle = () => { clearTimeout(idle); idle = setTimeout(commit, 700); };
  input.addEventListener("pointerdown", () => { pointer = true; cancelled = false; });
  const release = () => { pointer = false; cancelled = false; if (mode === "pointer") setTimeout(commit); };
  input.addEventListener("pointerup", release);
  input.addEventListener("pointercancel", release);
  input.addEventListener("keydown", event => {
    if (editKeys.has(event.key)) { cancelled = false; if (mode === "keyboard") armIdle(); }
    else if (event.key === "Escape" && active) {
      event.preventDefault(); event.stopPropagation();
      clearTimeout(idle); active = false; mode = undefined; cancelled = true;
      transaction.cancel?.();
    }
  });
  input.addEventListener("input", () => {
    if (cancelled || input.disabled) return;
    if (!active) { active = true; mode = pointer ? "pointer" : "keyboard"; transaction.begin?.(); }
    if (mode === "keyboard") armIdle();
    const value = Number(input.value);
    onValue(value);
    transaction.edit(value);
  });
  input.addEventListener("change", () => { if (mode === "pointer") commit(); });
  input.addEventListener("blur", () => { cancelled = false; pointer = false; commit(); });
  return { active: () => active };
}
/** A range input's fill (the track left of the thumb). */
export function fillRange(input: HTMLInputElement) {
  const min = Number(input.min), max = Number(input.max), value = Number(input.value);
  input.style.setProperty("--fill", `${max > min ? (value - min) / (max - min) * 100 : 0}%`);
}

export class Slider {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly output: HTMLOutputElement;
  private readonly note: NoteLine;
  private readonly edit: { active(): boolean };
  constructor(private options: { label: string; min: number; max: number; step: number; format(value: number): string;
    transaction: Transaction<number>; help?: string; id?: string;
    /** Keep a note line from the start: its note comes and goes (a limit that applies only sometimes). */
    reserveNote?: boolean }) {
    const id = options.id ?? uid("slider");
    this.input = h("input", { id, class: "slider", type: "range", min: String(options.min), max: String(options.max), step: String(options.step) });
    this.output = h("output", { class: "readout", for: id });
    this.note = new NoteLine(options.reserveNote);
    this.element = h("div", { class: "control" },
      h("label", { class: "control-label", for: id }, h("span", { class: "control-label-text" }, h("span", { text: options.label }),
        options.help ? helpTip(options.label, options.help) : null), this.output),
      this.input, this.note.element);
    this.edit = bindRangeTransaction(this.input, options.transaction, value => { fillRange(this.input); this.output.textContent = options.format(value); });
  }
  update(value: number | undefined, state: { disabled?: boolean; reason?: string; min?: number; max?: number; note?: string } = {}) {
    if (state.min !== undefined) setAttr(this.input, "min", String(state.min));
    if (state.max !== undefined) setAttr(this.input, "max", String(state.max));
    const active = this.edit.active();
    if (!active && value !== undefined) setValue(this.input, String(value));
    fillRange(this.input);
    setText(this.output, value === undefined ? "—" : this.options.format(active ? Number(this.input.value) : value));
    setDisabled(this.input, !!state.disabled, state.reason);
    this.note.update(this.input, !!state.disabled, state.reason, state.note);
  }
}

export class Toggle {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly note: NoteLine;
  /** The help tip beside the label, when the toggle was given `help`. */
  private readonly tip: HTMLButtonElement | null;
  constructor(private readonly options: { label: string; help?: HelpText; onChange(checked: boolean): void; id?: string; reserveNote?: boolean }) {
    const id = options.id ?? uid("toggle");
    this.input = h("input", { id, type: "checkbox", role: "switch", class: "switch" });
    this.note = new NoteLine(options.reserveNote);
    this.tip = options.help !== undefined ? helpTip(options.label, options.help) : null;
    // The tip sits outside the label, so pressing it never flips the switch.
    this.element = h("div", { class: "control toggle-row" },
      h("div", { class: "control-line" }, h("label", { class: "toggle", for: id }, this.input, h("span", { class: "switch-track", "aria-hidden": "true" }),
        h("span", { class: "toggle-label", text: options.label })), this.tip), this.note.element);
    this.input.addEventListener("change", () => options.onChange(this.input.checked));
  }
  update(checked: boolean, state: { disabled?: boolean; reason?: string; note?: string } = {}) {
    if (this.input.checked !== checked) this.input.checked = checked;
    setDisabled(this.input, !!state.disabled, state.reason);
    this.note.update(this.input, !!state.disabled, state.reason, state.note);
  }
  /** Change the help tip's text (a toggle made with `help` only). */
  setHelp(text: HelpText) { if (this.tip) setHelp(this.tip, text); }
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
    // Begins on the first picked colour, so opening and dismissing the picker leaves no open transaction.
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
  constructor(private options: { label: string; onChange(value: T): void; id?: string; help?: HelpText }) {
    const id = options.id ?? uid("select");
    this.select = h("select", { id, class: "field" });
    // The help tip sits beside the label, outside it (a label's click would move focus to the select).
    this.element = h("div", { class: "control" }, h("div", { class: "control-line" }, h("label", { class: "control-label", for: id }, h("span", { text: options.label })),
      options.help !== undefined ? helpTip(options.label, options.help) : null),
      h("div", { class: "select-wrap" }, this.select, icon("chevronDown")));
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
  onClick(event: MouseEvent): void; title?: string; iconOnly?: boolean; small?: boolean;
  /** Opens a menu (`aria-haspopup="menu"`). */
  menu?: boolean; className?: string }) {
  const element = h("button", { class: `btn${options.variant ? ` ${options.variant}` : ""}${options.iconOnly ? " icon-only" : ""}${options.small ? " small" : ""}${options.className ? ` ${options.className}` : ""}`,
    "aria-haspopup": options.menu ? "menu" : undefined,
    type: "button", title: options.title ?? (options.iconOnly ? options.label : undefined), "data-title": options.title ?? (options.iconOnly ? options.label : ""),
    "aria-label": options.iconOnly ? options.label : undefined,
    // An unavailable action runs nothing (the page's reason tip answers the click instead; reason-tip.ts).
    onclick: (event: MouseEvent) => { if (!isUnavailable(element)) options.onClick(event); } },
    options.icon ? icon(options.icon) : null, options.iconOnly ? null : h("span", { text: options.label }));
  return element;
}
/**
 * A main action's availability from a capability (UI-84): unavailable, it stays focusable with `aria-disabled` and its
 * reason as its description and a visible tip (the menu pattern; dom.ts `setUnavailable`, reason-tip.ts).
 */
export function applyCapability(control: HTMLElement, capability: { available: boolean; reason?: string }) {
  setUnavailable(control, !capability.available, capability.reason);
}

/** A panel section; `{ title, help }` puts what the section is in a help tip beside its title (help-tip.ts) rather than a note. */
export function section(heading: string | { title: string; help: HelpText }, ...children: (Node | null | undefined | false)[]) {
  const title = typeof heading === "string" ? heading : heading.title;
  const head = h("h3", { class: "section-title" }, h("span", { text: title }));
  return h("section", { class: "section" }, typeof heading === "string" ? head : h("div", { class: "section-head" }, head, helpTip(title, heading.help)), ...children);
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
/**
 * An empty state whose texts change in place (a list that empties or fills as the person works): `role="status"`, so the change is
 * announced, and one element for its whole life.
 */
export class EmptyState {
  readonly element: HTMLElement;
  private readonly title = h("p", { class: "empty-title" });
  private readonly body = h("p", { class: "empty-body" });
  constructor(options: { title?: string; body?: string; actions?: HTMLElement[]; className?: string } = {}) {
    const actions = options.actions ?? [];
    this.element = h("div", { class: `empty${options.className ? ` ${options.className}` : ""}`, role: "status" }, this.title, this.body,
      actions.length ? h("div", { class: "empty-actions" }, actions) : null);
    this.update(options.title ?? "", options.body ?? "");
  }
  update(title: string, body: string) { setText(this.title, title); this.title.hidden = !title; setText(this.body, body); }
}

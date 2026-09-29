import { h, isUnavailable, setAttr, setDisabled, setText, setUnavailable, setValue, uid } from "./dom";
import { helpTip, setHelp, type HelpText } from "./help-tip";
import { icon, type IconName } from "./icons";
import { stageTag, type Stage } from "./components/stage-tag";

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
  /** `quiet`: a reason that is a wait or information, not a problem, keeps the muted note tone instead of the warning tone. */
  constructor(reserve = false, private readonly quiet = false) { this.reserved = reserve; this.element.hidden = !reserve; }
  /** `onLine: false`: the reason is the control's description and tooltip only (a panel that says it once elsewhere); the line stays empty. */
  update(control: HTMLElement, disabled: boolean, reason: string | undefined, note: string | undefined, onLine = true) {
    if (note) this.reserved = true;
    const why = disabled && reason ? reason : undefined;
    const text = why && this.reserved && onLine ? why : note ?? "";
    setText(this.element, text);
    this.element.hidden = !this.reserved;
    this.element.classList.toggle("empty", !text);
    this.element.classList.toggle("info", this.quiet || !(why && this.reserved && onLine));
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
    reserveNote?: boolean;
    /** Its unavailable reason is a wait or information (muted), not a problem (warning). */
    quietReason?: boolean }) {
    const id = options.id ?? uid("slider");
    this.input = h("input", { id, class: "slider", type: "range", min: String(options.min), max: String(options.max), step: String(options.step) });
    this.output = h("output", { class: "readout", for: id });
    this.note = new NoteLine(options.reserveNote, options.quietReason);
    this.labelText = h("span", { text: options.label });
    this.tip = options.help ? helpTip(options.label, options.help) : null;
    this.element = h("div", { class: "control" },
      h("label", { class: "control-label", for: id }, h("span", { class: "control-label-text" }, this.labelText, this.tip), this.output),
      this.input, this.note.element);
    this.edit = bindRangeTransaction(this.input, options.transaction, value => { fillRange(this.input); this.output.textContent = options.format(value); });
  }
  private readonly labelText: HTMLSpanElement;
  private readonly tip: HTMLButtonElement | null;
  /**
   * A new name for the same value (UI-157): one slider whose meaning follows a mode ("Sparkle density" for Shimmer, "Flake density" for
   * Glitter; "Edge softness" or "Selected point softness") says it in its label and help tip. Owners never rewrite a label through the DOM.
   */
  relabel(label: string, accessibleLabel?: string) {
    const name = accessibleLabel ?? label;
    setText(this.labelText, label);
    setAttr(this.input, "aria-label", accessibleLabel);
    if (this.tip) setAttr(this.tip, "aria-label", `About ${name}`);
  }
  update(value: number | undefined, state: { disabled?: boolean; reason?: string; min?: number; max?: number; note?: string; reasonOnLine?: boolean } = {}) {
    if (state.min !== undefined) setAttr(this.input, "min", String(state.min));
    if (state.max !== undefined) setAttr(this.input, "max", String(state.max));
    const active = this.edit.active();
    if (!active && value !== undefined) setValue(this.input, String(value));
    // An unknown value shows no thumb and no fill (its readout says "—"), never a position that reads as a value.
    this.input.classList.toggle("unknown", value === undefined && !active);
    fillRange(this.input);
    setText(this.output, value === undefined ? "—" : this.options.format(active ? Number(this.input.value) : value));
    setDisabled(this.input, !!state.disabled, state.reason);
    this.element.classList.toggle("disabled", !!state.disabled);
    this.note.update(this.input, !!state.disabled, state.reason, state.note, state.reasonOnLine ?? true);
  }
}

export class Toggle {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly note: NoteLine;
  /** The help tip beside the label, when the toggle was given `help`. */
  private readonly tip: HTMLButtonElement | null;
  private readonly labelText: HTMLSpanElement;
  constructor(private readonly options: { label: string; help?: HelpText; onChange(checked: boolean): void; id?: string; reserveNote?: boolean;
    /** Its unavailable reason is a wait or information (muted), not a problem (warning). */
    quietReason?: boolean;
    /** The label while mixed ("Symmetric · some regions"), so the state is said in words as well as by the mark. */
    mixedLabel?: string;
    /** The release stage of what it turns on: an early-access setting carries an Early access stage tag after its label, part of its name. */
    stage?: Stage }) {
    const id = options.id ?? uid("toggle");
    this.input = h("input", { id, type: "checkbox", role: "switch", class: "switch" });
    this.note = new NoteLine(options.reserveNote, options.quietReason);
    this.tip = options.help !== undefined ? helpTip(options.label, options.help) : null;
    this.labelText = h("span", { class: "toggle-label", text: options.label });
    // The tip sits outside the label, so pressing it never flips the switch.
    this.element = h("div", { class: "control toggle-row" },
      h("div", { class: "control-line" }, h("label", { class: "toggle", for: id }, this.input, h("span", { class: "switch-track", "aria-hidden": "true" }),
        this.labelText, stageTag(options.stage, "toggle-stage")), this.tip), this.note.element);
    this.input.addEventListener("change", () => options.onChange(this.input.checked));
  }
  /**
   * `mixed`: a switch over several things of which some are on (Symmetric while some face regions are mirrored). The track shows a
   * dash instead of a thumb (never a half-slid thumb, which reads as stuck), the label says so (`mixedLabel`), and it reads "mixed";
   * ARIA's switch has no mixed value, so while mixed it is announced as a checkbox. A press turns it fully on.
   */
  update(checked: boolean, state: { disabled?: boolean; reason?: string; note?: string; reasonOnLine?: boolean; mixed?: boolean } = {}) {
    const mixed = !!state.mixed;
    if (this.input.indeterminate !== mixed) this.input.indeterminate = mixed;
    setAttr(this.input, "role", mixed ? "checkbox" : "switch");
    setAttr(this.input, "aria-checked", mixed ? "mixed" : undefined);
    const on = mixed ? false : checked;
    if (this.input.checked !== on) this.input.checked = on;
    setText(this.labelText, mixed && this.options.mixedLabel ? this.options.mixedLabel : this.options.label);
    setDisabled(this.input, !!state.disabled, state.reason);
    this.note.update(this.input, !!state.disabled, state.reason, state.note, state.reasonOnLine ?? true);
  }
  /** Change the help tip's text (a toggle made with `help` only). */
  setHelp(text: HelpText) { if (this.tip) setHelp(this.tip, text); }
}

export type SegmentOption<T extends string | number> = { value: T; label: string; icon?: IconName; title?: string };
/**
 * Mutually exclusive choices shown together (style guide `c-segmented`). The strip hugs its choices: it never stretches to the panel's
 * width and never wraps. The choices may change after construction (`setOptions`: a data-driven list such as the game's idles prepared
 * on this computer): the buttons are rebuilt only when the list differs, and focus stays on the same choice. It is for two to four short
 * options in one row; more, or long labels, use the ChoiceList (components/choice-list.ts). `update` can disable the whole group with one
 * reason, which shows in the note line (kept at its height when `reserveNote` is set); its label and readout read muted while it is
 * disabled.
 *
 * - `iconOnly`: each segment shows only its icon, its label being its accessible name and, unless its `title` says more, its tooltip;
 *   for up to eight choices whose icons say what they are (the easing curves). Name the chosen one with `readout`.
 * - `readout`: the chosen choice's name at the right of the label line, where a slider shows its value; `readoutGutter` keeps a slider
 *   reset's column empty after it, so the name lines up with the values of sliders with a reset above or below (Duration over Curve).
 * - `frameless`: no sunken frame (the strip sits on another control's label line, as Adjust all › Intensity's curves do); the chosen
 *   segment keeps the same raised look and signal underline.
 * - **Keys:** one Tab stop (the chosen choice, else the first available); Left and Right move between the choices (wrapping), Home and End
 *   to the first and last; Enter or Space chooses. Arrows move focus without choosing, since a choice may be an edit with its own Undo step.
 */
export class Segmented<T extends string | number> {
  readonly element: HTMLElement;
  private buttons: { value: T; button: HTMLButtonElement }[] = [];
  private readonly group: HTMLElement;
  private readonly note: NoteLine;
  private readonly readout: HTMLElement | null;
  /** The help tip beside the label, when the group was given `help` (what the choice is; its state stays in the note). */
  private readonly tip: HTMLButtonElement | null;
  private signature = "";
  private selected: T | undefined;
  constructor(private readonly options: { label: string; options: SegmentOption<T>[]; onSelect(value: T): void; compact?: boolean; showLabel?: boolean;
    reserveNote?: boolean; help?: HelpText; iconOnly?: boolean; frameless?: boolean; readout?(value: T): string; readoutGutter?: boolean;
    /** The unavailable reason is information (a dependency on a switch above), not a problem: the note line keeps the muted tone (UI-145). */
    quietReason?: boolean }) {
    const labelId = uid("seg");
    this.group = h("div", { class: `segmented${options.iconOnly ? " icon-only" : ""}${options.frameless ? " frameless" : ""}`, role: "group",
      "aria-label": options.showLabel === false ? options.label : undefined, "aria-labelledby": options.showLabel === false ? undefined : labelId });
    this.note = new NoteLine(options.reserveNote, options.quietReason);
    this.tip = options.help !== undefined && options.showLabel !== false ? helpTip(options.label, options.help) : null;
    this.readout = options.readout && options.showLabel !== false ? h("span", { class: "readout segmented-readout", "aria-hidden": "true" }) : null;
    const text = h("span", { text: options.label });
    const label = options.showLabel === false ? null
      : this.readout ? h("div", { class: "slider-value-line" }, h("span", { class: "control-label-text", id: labelId }, text), this.tip, h("span", { class: "grow" }), this.readout,
        options.readoutGutter ? h("span", { class: "readout-gutter", "aria-hidden": "true" }) : null)
      : this.tip ? h("div", { class: "control-line" }, h("span", { class: "control-label", id: labelId }, text), this.tip)
      : h("span", { class: "control-label", id: labelId }, text);
    this.element = h("div", { class: `control segmented-control${options.compact ? " compact" : ""}` }, label, this.group, this.note.element);
    this.group.addEventListener("keydown", event => this.key(event));
    this.setOptions(options.options);
  }
  /** Change the help tip's text (a group made with `help` only). */
  setHelp(text: HelpText) { if (this.tip) setHelp(this.tip, text); }
  /** Replace the choices (a no-op when they are the same); focus stays on the same choice when it is still offered. */
  setOptions(options: readonly SegmentOption<T>[]) {
    const signature = JSON.stringify(options.map(option => [option.value, option.label, option.icon ?? "", option.title ?? ""]));
    if (signature === this.signature) return;
    this.signature = signature;
    const focused = this.buttons.find(item => item.button === document.activeElement)?.value;
    const iconOnly = !!this.options.iconOnly;
    this.buttons = options.map(option => {
      const title = option.title ?? (iconOnly ? option.label : undefined);
      return { value: option.value, button: h("button", { class: "segment", type: "button", "aria-pressed": "false", title, "data-title": title,
        "aria-label": iconOnly ? option.label : undefined, onclick: () => this.options.onSelect(option.value) },
        option.icon ? icon(option.icon) : null, iconOnly && option.icon ? null : h("span", { text: option.label })) };
    });
    this.group.replaceChildren(...this.buttons.map(item => item.button));
    this.rove();
    if (focused !== undefined) this.buttons.find(item => item.value === focused)?.button.focus();
  }
  /**
   * The selected choice, each choice's capability, and optionally the whole group's state: `disabled` with its `reason` (in the note
   * line), or a `note` under the choices (shown in the same line, so the layout never shifts between them when `reserveNote` is set).
   */
  update(selected: T | undefined, capability: (value: T) => { available: boolean; reason?: string } = () => ({ available: true }),
    state: { disabled?: boolean; reason?: string; note?: string } = {}) {
    this.selected = selected;
    for (const { value, button } of this.buttons) {
      setAttr(button, "aria-pressed", String(value === selected));
      const allowed = state.disabled ? { available: false, reason: state.reason } : capability(value);
      setDisabled(button, !allowed.available && (state.disabled || value !== selected), allowed.reason);
    }
    this.element.classList.toggle("disabled", !!state.disabled);
    if (this.readout) setText(this.readout, selected === undefined ? "" : this.options.readout!(selected));
    this.note.update(this.group, !!state.disabled, state.reason, state.note);
    this.rove();
  }
  /** The one Tab stop: the chosen choice when it can take focus, else the first that can. */
  private rove() {
    const open = this.buttons.filter(item => !item.button.disabled);
    const stop = open.find(item => item.value === this.selected) ?? open[0];
    for (const item of this.buttons) item.button.tabIndex = item === stop ? 0 : -1;
  }
  private key(event: KeyboardEvent) {
    const open = this.buttons.filter(item => !item.button.disabled).map(item => item.button);
    const at = open.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const next = event.key === "ArrowRight" ? (at + 1) % open.length : event.key === "ArrowLeft" ? (at - 1 + open.length) % open.length
      : event.key === "Home" ? 0 : event.key === "End" ? open.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    for (const button of open) button.tabIndex = button === open[next] ? 0 : -1;
    open[next]!.focus();
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
  // Its title is its view key, so a remembered scroll position can come back to it (scroll-anchor.ts).
  return h("section", { class: "section", "data-view-key": `section:${title}` }, typeof heading === "string" ? head : h("div", { class: "section-head" }, head, helpTip(title, heading.help)), ...children);
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

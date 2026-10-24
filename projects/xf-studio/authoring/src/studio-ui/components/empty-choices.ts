import { h, setAttr, setText } from "../dom";
import { applyCapability, button, setButtonLabel } from "../controls";
import { closeMenus, place, type Capability } from "../menu";
import { SearchField } from "./search-field";
import { icon } from "../icons";

export type EmptyChoice = { readonly id: string; readonly label: string; readonly name: string;
  readonly capability?: Capability; choose(): void };
export type EmptyChoicesState = { readonly title: string; readonly body: string; readonly choices: readonly EmptyChoice[];
  readonly capability?: Capability };

/** U6: target choices, with stable buttons while painting and a captured searchable list. */
export class EmptyChoices {
  readonly element = h("div", { class: "empty empty-choices", hidden: true });
  private readonly title = h("p", { class: "empty-title" });
  private readonly body = h("p", { class: "empty-body" });
  private readonly reason = h("p", { class: "empty-body", role: "status", hidden: true });
  private readonly actions = h("div", { class: "empty-actions" });
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private state: EmptyChoicesState | null = null;
  private closePicker?: () => void;
  private readonly more = button({ label: "Choose…", onClick: () => this.openPicker() });
  constructor(layout: "panel" | "viewport" = "panel") {
    if (layout === "viewport") {
      this.element.className = "viewport-state empty-choices"; this.element.dataset.tone = "neutral";
      this.element.append(h("span", { class: "viewport-state-icon" }, icon("head")));
    }
    this.element.append(this.title, this.body, this.reason, this.actions);
  }
  update(state: EmptyChoicesState | null) {
    this.state = state; this.element.hidden = !state;
    if (!state) return;
    setText(this.title, state.title); setText(this.body, state.body);
    const reason = state.capability?.available === false ? state.capability.reason ?? "These choices are unavailable here." : "";
    setText(this.reason, reason); this.reason.hidden = !reason;
    const visible = state.choices.slice(0, 6), wanted = visible.map(choice => {
      let control = this.buttons.get(choice.id);
      if (!control) {
        control = button({ label: choice.label, onClick: () => {
          const current = this.state?.choices.find(item => item.id === choice.id);
          if (this.state?.capability?.available !== false && current?.capability?.available !== false) current?.choose();
        } });
        this.buttons.set(choice.id, control);
      }
      setButtonLabel(control, choice.label); setAttr(control, "aria-label", choice.name);
      applyCapability(control, state.capability?.available === false ? state.capability : choice.capability ?? { available: true });
      return control;
    });
    setAttr(this.more, "aria-label", `Choose… ${state.title}`);
    applyCapability(this.more, state.capability ?? { available: true });
    if (state.choices.length > 6) wanted.push(this.more);
    if (wanted.length !== this.actions.children.length || wanted.some((item, at) => item !== this.actions.children[at])) this.actions.replaceChildren(...wanted);
    for (const id of this.buttons.keys()) if (!visible.some(choice => choice.id === id)) this.buttons.delete(id);
  }
  private openPicker() {
    const state = this.state;
    if (!state || state.capability?.available === false) return;
    this.closePicker?.(); closeMenus(false);
    const list = h("div", { class: "empty-choices-list" });
    const search = new SearchField({ label: `Search choices: ${state.title}`, placeholder: "Search choices…", debounce: 0,
      onFilter: () => refresh(), onArrowDown: () => list.querySelector<HTMLButtonElement>("button")?.focus() });
    const picker = h("div", { class: "popover empty-choice-picker", role: "dialog", "aria-label": state.title },
      h("div", { class: "popover-title", text: state.title }), search.element, list);
    let closed = false;
    const close = (restore: boolean) => {
      if (closed) return;
      closed = true; document.removeEventListener("pointerdown", outside, true); picker.remove();
      this.closePicker = undefined;
      if (restore && this.more.isConnected) this.more.focus();
    };
    const outside = (event: PointerEvent) => { if (!event.composedPath().includes(picker)) close(false); };
    function refresh() {
      const query = search.value.toLocaleLowerCase();
      const choices = state!.choices.filter(choice => `${choice.label} ${choice.name}`.toLocaleLowerCase().includes(query));
      list.replaceChildren(...choices.map(choice => {
        const control = button({ label: choice.label, onClick: () => { if (choice.capability?.available !== false) { close(true); choice.choose(); } } });
        setAttr(control, "aria-label", choice.name); applyCapability(control, choice.capability ?? { available: true }); return control;
      }));
      if (!choices.length) list.append(search.noMatches("choices"));
    }
    picker.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); } });
    document.body.append(picker); refresh(); place(picker, this.more); search.focus();
    this.closePicker = () => close(false);
    setTimeout(() => { if (!closed) document.addEventListener("pointerdown", outside, true); });
  }
  dispose() { this.closePicker?.(); }
}

/** U6: other panels sharing a missing target point to its owner instead of repeating its chooser. */
export class EmptyTargetPointer {
  readonly element = h("p", { class: "empty-target-pointer muted small", hidden: true });
  private readonly message = h("span");
  private readonly owner = h("button", { type: "button", class: "link-button", "data-read-safe": "" });
  constructor(reveal: (panel: string) => void) {
    this.element.append(this.message, this.owner, ".");
    this.owner.addEventListener("click", () => { if (this.target) reveal(this.target.panel); });
  }
  private target: { readonly panel: string; readonly label: string; readonly prompt: string } | null = null;
  update(target: typeof this.target) {
    this.target = target; this.element.hidden = !target;
    if (!target) return;
    setText(this.message, `${target.prompt} `); setText(this.owner, target.label);
    setAttr(this.owner, "aria-label", `Open ${target.label}`);
  }
}

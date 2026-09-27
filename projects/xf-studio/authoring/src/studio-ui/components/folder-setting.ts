import { h, setAttr, setText, uid } from "../dom";
import { applyCapability, button } from "../controls";
import { helpTip, type HelpText } from "../help-tip";
import type { Capability } from "../menu";

/**
 * Folder setting (style guide "Folder setting"): one folder the app needs (the game, a Mod Organizer 2 instance, the saves folder),
 * with what it uses now and the one or two ways to change it.
 *
 * - **What it uses:** a line under the label, "Using: <folder>" once one is chosen, else "Detected: <folder>" when the app found one
 *   (and uses it), else "Not chosen yet". The owner passes display paths (placeholder-style, e.g. `%USERPROFILE%\Saved Games\…`); the
 *   component shows what it is given and never logs a path.
 * - **Choose another folder…** opens the host's native folder picker where there is one (`canPick`, behind its capability); otherwise
 *   it opens a text box in place, with inline guidance, committed on Enter or Save and cancelled with Escape.
 * - **Use the detected folder** returns to what the app found, shown only when a detected folder differs from the chosen one.
 * - **Several found folders** (`found`, e.g. the game installed through Steam and GOG): each is shown as a choice, all at once (show the
 *   options, don't hide them), with where it was found in plain words ("Steam, Mod Organizer 2"); the one in use is pressed, and pressing
 *   another saves it (`onSelect`). A chosen folder that isn't among them is listed first. "Choose another folder…" stays below them.
 *   Defaults first: the owner saves the first found folder while none is chosen, so nothing needs a click; the component only shows.
 * - **Refusals** (a folder that isn't the game, a picker that failed) appear on the note line under the field, never as a toast. The
 *   line is reserved while the text box is open, so a refusal of what was typed never moves anything; otherwise it takes no room (the
 *   settings keep their normal rhythm) and appears only in answer to the person's own action. A cancelled picker says nothing.
 */
export type FolderOutcome = { ok: true } | { ok: false; message: string; cancelled?: boolean };
/** A folder the app found, with where it found it in plain words ("Steam", "GOG, Mod Organizer 2"). */
export type FolderChoice = { path: string; source?: string };
export type FolderSettingOptions = {
  label: string; help?: HelpText;
  /** The text box's placeholder: an example in the person's terms. */
  placeholder?: string;
  /** Guidance under the text box while it is open (what folder to give). */
  guidance?: string;
  /** Save a typed folder (the owner validates it; a refusal's message shows inline). */
  onChoose(path: string): Promise<FolderOutcome>;
  /** Open the host's native folder picker. */
  onPick?(): Promise<FolderOutcome>;
  /** Go back to the detected folder. */
  onUseDetected?(): Promise<FolderOutcome>;
  /** Use one of the found folders (`found`). */
  onSelect?(path: string): Promise<FolderOutcome>;
  /** An optional folder: stop using the chosen one (shown while one is chosen, as "Don't use a folder"). */
  onClear?(): Promise<FolderOutcome>;
};
export type FolderSettingState = {
  /** The chosen folder as a display path, or null when none is chosen. */
  chosen: string | null;
  /** The folder the app found, as a display path. */
  detected?: string | null;
  /** The folders the app found, shown as choices (with `onSelect`). */
  found?: readonly FolderChoice[];
  /** Whether this host has a native folder picker, and its capability. */
  canPick?: boolean; pickCapability?: Capability;
  disabled?: boolean; reason?: string;
};

export class FolderSetting {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly using = h("p", { class: "folder-using" });
  private readonly note = h("small", { class: "control-note folder-note empty" });
  private readonly typed: HTMLElement;
  private readonly choose: HTMLButtonElement;
  private readonly useDetected: HTMLButtonElement;
  private readonly clear: HTMLButtonElement;
  private readonly save: HTMLButtonElement;
  private readonly choices: HTMLElement;
  private choiceButtons: { path: string; button: HTMLButtonElement }[] = [];
  private choiceKey = "";
  private state: FolderSettingState = { chosen: null };
  private busy = false;
  constructor(private readonly options: FolderSettingOptions) {
    const id = uid("folder");
    this.input = h("input", { id, class: "field", type: "text", spellcheck: "false", autocomplete: "off", placeholder: options.placeholder,
      "aria-label": `${options.label}: type the folder`, "aria-describedby": `${id}-note` });
    this.note.id = `${id}-note`;
    this.save = button({ label: "Save", small: true, onClick: () => void this.commit() });
    const cancel = button({ label: "Cancel", small: true, variant: "quiet", onClick: () => this.closeTyped() });
    this.typed = h("div", { class: "folder-typed", hidden: true },
      h("div", { class: "row gap-s" }, this.input, this.save, cancel), options.guidance ? h("p", { class: "note", text: options.guidance }) : null);
    this.choose = button({ label: "Choose another folder…", icon: "folder", small: true, onClick: () => void this.chooseAnother() });
    this.useDetected = button({ label: "Use the detected folder", icon: "reset", small: true, variant: "quiet", onClick: () => void this.run(options.onUseDetected) });
    this.clear = button({ label: "Don't use a folder", icon: "close", small: true, variant: "quiet", onClick: () => void this.run(options.onClear) });
    this.choices = h("div", { class: "folder-choices", role: "group", "aria-label": options.label, hidden: true });
    this.element = h("div", { class: "control folder-setting" },
      h("div", { class: "control-line" }, h("span", { class: "control-label", text: options.label }), options.help !== undefined ? helpTip(options.label, options.help) : null),
      this.using, this.choices, h("div", { class: "row wrap gap-s folder-actions" }, this.choose, this.useDetected, this.clear), this.typed, this.note);
    this.input.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); void this.commit(); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.closeTyped(); }
    });
  }
  private refuse(message: string) { setText(this.note, message); this.note.classList.toggle("empty", !message); this.placeNote(); }
  /** The note line: reserved while the text box is open, else shown only while it says something. */
  private placeNote() { this.note.hidden = this.typed.hidden && !this.note.textContent; }
  private async run(action?: () => Promise<FolderOutcome>) {
    if (!action || this.busy) return false;
    this.busy = true; this.refuse(""); this.paint();
    try {
      const outcome = await action();
      if (!outcome.ok && !outcome.cancelled) this.refuse(outcome.message);
      return outcome.ok;
    } finally { this.busy = false; this.paint(); }
  }
  private async chooseAnother() {
    if (this.state.canPick && this.options.onPick) { await this.run(this.options.onPick); return; }
    this.typed.hidden = false;
    this.placeNote();
    this.input.value = "";
    this.input.focus();
  }
  private async commit() {
    const path = this.input.value.trim();
    if (!path) { this.refuse("Type the folder first, or choose Cancel."); return; }
    if (await this.run(() => this.options.onChoose(path))) this.closeTyped();
  }
  private closeTyped() { this.typed.hidden = true; this.refuse(""); if (this.element.contains(document.activeElement)) this.choose.focus(); }
  update(state: FolderSettingState) { this.state = state; this.paint(); }
  /** The found folders (and a chosen one that isn't among them, first) as one choice each. */
  private listed(): FolderChoice[] {
    const { chosen, found = [] } = this.state;
    if (!found.length || !this.options.onSelect) return [];
    return [...(chosen && !found.some(choice => sameFolder(choice.path, chosen)) ? [{ path: chosen }] : []), ...found];
  }
  private paint() {
    const { chosen, detected, disabled, reason } = this.state;
    const listed = this.listed();
    const key = JSON.stringify(listed);
    if (key !== this.choiceKey) {
      this.choiceKey = key;
      this.choiceButtons = listed.map(choice => {
        const control = h("button", { class: "folder-choice", type: "button", "aria-pressed": "false" },
          h("span", { class: "folder-choice-path", text: choice.path }), choice.source ? h("span", { class: "folder-choice-source", text: choice.source }) : null);
        // The one in use does nothing; an unavailable one answers with its reason tip (reason-tip.ts).
        control.addEventListener("click", () => {
          if (control.getAttribute("aria-disabled") !== "true" && control.getAttribute("aria-pressed") !== "true") void this.run(() => this.options.onSelect!(choice.path));
        });
        return { path: choice.path, button: control };
      });
      this.choices.replaceChildren(...this.choiceButtons.map(item => item.button));
    }
    this.choices.hidden = !listed.length;
    for (const item of this.choiceButtons) setAttr(item.button, "aria-pressed", String(sameFolder(item.path, chosen)));
    // With the choices shown, the pressed one says what is in use; the line speaks only when nothing is chosen yet.
    setText(this.using, listed.length ? (chosen ? "" : "Not chosen yet") : chosen ? `Using: ${chosen}` : detected ? `Detected: ${detected}` : "Not chosen yet");
    this.using.hidden = !this.using.textContent;
    this.using.classList.toggle("muted", !chosen && !detected);
    const blocked = disabled ? { available: false, reason: reason ?? "Not available right now." } : this.busy ? { available: false, reason: "Saving…" } : undefined;
    applyCapability(this.choose, blocked ?? (this.state.canPick && this.state.pickCapability ? this.state.pickCapability : { available: true }));
    this.useDetected.hidden = !(detected && chosen && detected !== chosen && this.options.onUseDetected);
    applyCapability(this.useDetected, blocked ?? { available: true });
    this.clear.hidden = !(chosen && this.options.onClear);
    applyCapability(this.clear, blocked ?? { available: true });
    applyCapability(this.save, blocked ?? { available: true });
    for (const item of this.choiceButtons) applyCapability(item.button, blocked ?? { available: true });
    this.input.disabled = !!disabled;
    this.placeNote();
  }
}
/** The same folder, whatever the case or a trailing slash. */
const sameFolder = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b &&
  a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();

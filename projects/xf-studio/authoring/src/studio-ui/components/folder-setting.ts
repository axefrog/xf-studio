import { h, setText, uid } from "../dom";
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
 * - **Refusals** (a folder that isn't the game, a picker that failed) appear on the note line under the field, never as a toast; the
 *   line keeps its height, so a refusal appearing or clearing never moves anything. A cancelled picker says nothing. An owner's action
 *   that fails outright (its promise rejects) is a refusal too, in plain words, and the controls come back.
 */
export type FolderOutcome = { ok: true } | { ok: false; message: string; cancelled?: boolean };
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
};
export type FolderSettingState = {
  /** The chosen folder as a display path, or null when none is chosen. */
  chosen: string | null;
  /** The folder the app found, as a display path. */
  detected?: string | null;
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
  private readonly save: HTMLButtonElement;
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
    this.element = h("div", { class: "control folder-setting" },
      h("div", { class: "control-line" }, h("span", { class: "control-label", text: options.label }), options.help !== undefined ? helpTip(options.label, options.help) : null),
      this.using, h("div", { class: "row wrap gap-s folder-actions" }, this.choose, this.useDetected), this.typed, this.note);
    this.input.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); void this.commit(); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.closeTyped(); }
    });
  }
  private refuse(message: string) { setText(this.note, message); this.note.classList.toggle("empty", !message); }
  private async run(action?: () => Promise<FolderOutcome>) {
    if (!action || this.busy) return false;
    this.busy = true; this.refuse(""); this.paint();
    try {
      const outcome = await action();
      if (!outcome.ok && !outcome.cancelled) this.refuse(outcome.message);
      return outcome.ok;
    } catch {
      // Never an unhandled rejection or a silent failure (UI-124): say so on the note line, and keep the typed folder to try again.
      this.refuse("Couldn't change the folder. Try again.");
      return false;
    } finally { this.busy = false; this.paint(); }
  }
  private async chooseAnother() {
    if (this.state.canPick && this.options.onPick) { await this.run(this.options.onPick); return; }
    this.typed.hidden = false;
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
  private paint() {
    const { chosen, detected, disabled, reason } = this.state;
    setText(this.using, chosen ? `Using: ${chosen}` : detected ? `Detected: ${detected}` : "Not chosen yet");
    this.using.classList.toggle("muted", !chosen && !detected);
    const blocked = disabled ? { available: false, reason: reason ?? "Not available right now." } : this.busy ? { available: false, reason: "Saving…" } : undefined;
    applyCapability(this.choose, blocked ?? (this.state.canPick && this.state.pickCapability ? this.state.pickCapability : { available: true }));
    this.useDetected.hidden = !(detected && chosen && detected !== chosen && this.options.onUseDetected);
    applyCapability(this.useDetected, blocked ?? { available: true });
    applyCapability(this.save, blocked ?? { available: true });
    this.input.disabled = !!disabled;
  }
}

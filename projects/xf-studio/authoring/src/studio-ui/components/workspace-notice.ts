import { button } from "../controls";
import { h, setText } from "../dom";
import { openConfirmPopover } from "../menu";

/**
 * Workspace notice (style guide "Workspace notice", t-read-only-window, t-unprotected, t-recovering): the full-width band under the
 * header for a workspace state the person must act on or wait out. One line of warning-toned text, whole, then its labelled small
 * buttons, beside it where they fit and on the row under it where they don't (narrower than 720 px, always), wrapping, never shrinking
 * to icons. The owner says which state shows and which ways out it offers; the notice owns their words, their order and the one that
 * asks first (Discard those changes: the changes can't be got back).
 *
 * It never moves the dock for something transient: it opens only when the owner hands it a state, and an owner that is mid-gesture
 * asks it to wait (`deferOpen`): a closed notice stays closed until the gesture ends, an open one keeps showing.
 */
export type WorkspaceNoticeAction = "takeOver" | "retryRelease" | "exportCopy" | "protect" | "keepRestored" | "retryRestore" | "importSave" | "discardWaiting";
export type WorkspaceNoticeState = {
  readonly message: string;
  /** The ways out, in the order they show. */
  readonly actions: readonly WorkspaceNoticeAction[];
};
export type WorkspaceNoticeOptions = {
  /** A way out was chosen (Discard those changes only once the person confirms). */
  onAction(action: WorkspaceNoticeAction): void;
};

/** Each way out's label and tooltip (shared with the style guide's specimens). */
export const WORKSPACE_NOTICE_ACTIONS: Record<WorkspaceNoticeAction, { label: string; title?: string }> = {
  takeOver: { label: "Use it here", title: "Edit in this window: the other window finishes saving and becomes read-only" },
  retryRelease: { label: "Try again", title: "Save your latest changes again, then hand the workspace over" },
  // The recovery export: this window's own copy, with the changes the library doesn't have yet. It needs nothing from the library, so it
  // works in the states that offer it (a handover that couldn't save, a stuck restore, a failed backup), where saving first would fail.
  exportCopy: { label: "Export this window's copy", title: "Save the collection as this window shows it to a file, with the changes your library doesn't have yet. Nothing is saved to your library." },
  protect: { label: "Try again", title: "Back up your latest changes on this computer again" },
  keepRestored: { label: "Use restored", title: "Keep working on the restored version" },
  retryRestore: { label: "Try again", title: "Send the restored changes again now" },
  importSave: { label: "Import save…", title: "Import the game save again" },
  discardWaiting: { label: "Discard those changes", title: "Discard the restored changes that need that game save (asks first)" },
};
/** Discard those changes' confirmation (t-recovering, c-confirm): what goes, and that it can't be got back. */
export const DISCARD_WAITING_CONFIRM = { title: "Discard those changes",
  message: "Discard the restored changes that need that game save? What they changed goes back to the library's version, and they can't be got back.",
  confirm: "Discard" } as const;

const ORDER = Object.keys(WORKSPACE_NOTICE_ACTIONS) as WorkspaceNoticeAction[];

export class WorkspaceNotice {
  readonly element: HTMLElement;
  private readonly text = h("span", { class: "workspace-notice-text" });
  private readonly row = h("div", { class: "workspace-notice-actions" });
  private readonly buttons: Record<WorkspaceNoticeAction, HTMLButtonElement>;
  private order = "";

  constructor(private readonly options: WorkspaceNoticeOptions) {
    const make = (action: WorkspaceNoticeAction) => {
      const { label, title } = WORKSPACE_NOTICE_ACTIONS[action];
      const control: HTMLButtonElement = button({ label, small: true, title, onClick: () => this.choose(action, control) });
      control.dataset.action = action;
      control.hidden = true;
      return control;
    };
    this.buttons = Object.fromEntries(ORDER.map(action => [action, make(action)])) as Record<WorkspaceNoticeAction, HTMLButtonElement>;
    this.row.append(...ORDER.map(action => this.buttons[action]));
    this.element = h("div", { class: "state-line warning workspace-notice", role: "status", hidden: true }, this.text, this.row);
  }

  /**
   * The state to show (null: none, and the band takes no room). `deferOpen`: a gesture is in progress, so a closed notice waits for it
   * to end rather than move the panels under the pointer; an open one changes in place.
   */
  update(state: WorkspaceNoticeState | null, options: { deferOpen?: boolean } = {}): void {
    if (this.element.hidden && state && options.deferOpen) return;
    this.element.hidden = !state;
    setText(this.text, state?.message ?? "");
    const shown = new Set(state?.actions ?? []);
    for (const action of ORDER) this.buttons[action].hidden = !shown.has(action);
    // The ways out keep the owner's order; reordered only when it changes, so focus stays on a button that stays.
    const order = (state?.actions ?? []).join(",");
    if (order !== this.order) {
      this.order = order;
      this.row.append(...(state?.actions ?? []).map(action => this.buttons[action]));
    }
    this.row.hidden = !shown.size;
  }

  private choose(action: WorkspaceNoticeAction, control: HTMLButtonElement) {
    if (action !== "discardWaiting") { this.options.onAction(action); return; }
    openConfirmPopover(control, { ...DISCARD_WAITING_CONFIRM, danger: true, onConfirm: () => this.options.onAction(action) });
  }
}

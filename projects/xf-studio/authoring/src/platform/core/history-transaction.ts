/**
 * The platform's Undo transaction for continuous edits (feature-module platform §1, §3): a pointer
 * gesture or a form control's run of edits becomes one Undo step. DOM-free; imports only the platform API.
 *
 * - **One checkpoint** is recorded when the transaction opens; the transaction keeps that step's ID and
 *   labels or discards only that step, never by comparing depths (at the history limit a new step
 *   displaces the oldest, and discarding it brings that one back).
 * - **The first change names the step** (its label comes from the frame or edit that changed something).
 * - **Commit** keeps the step, unless the transaction is empty: then the history is left exactly as found.
 * - **Cancel (Escape)** restores the state the transaction began with and never creates Redo.
 *
 * The host decides what "empty" and "changed" mean through a policy, so each input keeps its rules.
 */
import type { HistoryLabel } from "../api/history";

/** Where a transaction records: the live look's history and a fingerprint of the content it edits. */
export interface TransactionHost<Id> {
  /** Record the content as it is now; the step's ID, or undefined when the top step already holds it. */
  checkpoint(): Id | undefined;
  relabel(step: Id, label: HistoryLabel): void;
  /** Remove `step` only while it is the top step. */
  discard(step: Id): boolean;
  /** Restore the latest checkpoint without Redo and publish it. */
  revert(): void;
  /** A fingerprint of the edited content (equal fingerprints: nothing changed). */
  content(): string;
}

/**
 * - `empty`: when a commit leaves no step. `unchanged`: nothing was applied and the content is as it
 *   began (a gesture: frames that changed something keep their step even if they moved back);
 *   `same-content`: the content is as it began (a form control).
 * - `revert`: when a cancel restores the start. `changed`: after any applied change (a gesture);
 *   `content-differs`: only when the content differs from the start (a form control).
 */
export type TransactionPolicy = { readonly empty: "unchanged" | "same-content"; readonly revert: "changed" | "content-differs" };
export const GESTURE_TRANSACTION: TransactionPolicy = Object.freeze({ empty: "unchanged", revert: "changed" });
export const CONTROL_TRANSACTION: TransactionPolicy = Object.freeze({ empty: "same-content", revert: "content-differs" });

export class HistoryTransaction<Id> {
  private changedAny = false;
  private constructor(private readonly host: TransactionHost<Id>, private readonly policy: TransactionPolicy,
    /** Whether the transaction's target (for eye makeup, the layer object it began on) still exists. */
    private readonly present: () => boolean, private readonly baseline: string,
    /** The step this transaction added (undefined when the top step already held the start state). */
    readonly checkpoint: Id | undefined) {}
  static open<Id>(host: TransactionHost<Id>, policy: TransactionPolicy, present: () => boolean): HistoryTransaction<Id> {
    const baseline = host.content();
    return new HistoryTransaction(host, policy, present, baseline, host.checkpoint());
  }
  /** Whether any applied frame or edit changed something. */
  get changed() { return this.changedAny; }
  /** Report one applied frame or edit; the first change names the step. */
  applied(changed: boolean, label: () => HistoryLabel) {
    if (!changed) return;
    if (!this.changedAny && this.checkpoint !== undefined) this.host.relabel(this.checkpoint, label());
    this.changedAny = true;
  }
  /** Keep the step; an empty transaction leaves the history as it found it. */
  commit() { this.discardIfEmpty(); }
  /** Escape: restore the start state without Redo (or, when nothing needs restoring, drop an empty step). */
  cancel() {
    const revert = this.policy.revert === "changed" ? this.changedAny && this.present()
      : this.present() && this.host.content() !== this.baseline;
    if (revert) this.host.revert(); else this.discardIfEmpty();
  }
  private discardIfEmpty() {
    if (this.checkpoint !== undefined && (this.policy.empty === "same-content" || !this.changedAny) && this.present() &&
      this.host.content() === this.baseline) this.host.discard(this.checkpoint);
  }
}

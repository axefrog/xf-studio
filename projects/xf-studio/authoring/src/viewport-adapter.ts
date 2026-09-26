/** Application-facing viewport lifecycle. Concrete UV and head editors own their own input/picking/render resources. */
export type ViewportPort = {
  resize(): void;
  cancelInput(): void;
  inputCapture(): boolean;
  dispose(): void;
};
/**
 * An editor's slot: the on-head editor of a 3D view (`surface`, the main view's) or a flat editor (`uv`). Slots are registered by
 * the device that owns the editors, not a fixed set (view-graph-design.md §2.6).
 */
export type EditorSlot = string;
/** The slots a browser viewport device registers today: the flat UV editor and the main view's on-head editor. */
export const DEFAULT_EDITOR_SLOTS: readonly EditorSlot[] = ["uv", "surface"];

export class ViewportAdapter {
  private ports = new Map<EditorSlot, ViewportPort>();
  constructor(private readonly slots: readonly EditorSlot[] = DEFAULT_EDITOR_SLOTS) {}
  attach(slot: EditorSlot, port: ViewportPort) {
    if (this.ports.get(slot) === port) return;
    this.detach(slot);
    this.ports.set(slot, port);
    port.resize();
  }
  detach(slot?: EditorSlot) {
    for (const key of slot ? [slot] : this.known()) {
      const port = this.ports.get(key);
      if (!port) continue;
      this.ports.delete(key);
      port.cancelInput();
      port.dispose();
    }
  }
  resize(slot?: EditorSlot) {
    for (const key of slot ? [slot] : this.known()) this.ports.get(key)?.resize();
  }
  cancelInput(slot?: EditorSlot) {
    for (const key of slot ? [slot] : this.known()) this.ports.get(key)?.cancelInput();
  }
  /** Whether each registered slot's editor holds pointer capture (false for a slot with no editor attached). */
  capture(): Readonly<Record<EditorSlot, boolean>> {
    return Object.fromEntries(this.known().map(slot => [slot, this.ports.get(slot)?.inputCapture() ?? false]));
  }
  /** Registered slots first, in order, then any other attached slot. */
  private known() { return [...new Set([...this.slots, ...this.ports.keys()])]; }
}

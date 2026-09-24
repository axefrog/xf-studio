import { PREVIEW_TEXTURE_SIZES, type PreviewTextureSize } from "./preview-quality";

export type QualityState = { size: PreviewTextureSize; error: string; blocked: boolean };
export type QualityAction = { kind: "quality.set"; size: PreviewTextureSize } | { kind: "quality.rebuild" };
export type QualityPort = { assess(size: PreviewTextureSize): { accepted: boolean; error?: string };
  replace(size: PreviewTextureSize): void };

/** Preview resource-tier choices are independent of recipe/history and presentation. */
export class PreviewQualityActions {
  private state: QualityState;
  private listeners = new Set<() => void>();
  constructor(initial: PreviewTextureSize, private port: QualityPort) {
    this.state = { size: initial, error: "", blocked: false };
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify() { for (const listener of this.listeners) listener(); }
  snapshot(): Readonly<QualityState> { return { ...this.state }; }
  capability(action: QualityAction): { available: boolean; reason?: string } {
    const size = action.kind === "quality.rebuild" ? this.state.size : action.size;
    if (!PREVIEW_TEXTURE_SIZES.includes(size)) return { available: false, reason: "Unsupported preview texture size." };
    const assessment = this.port.assess(size);
    return assessment.accepted ? { available: true } : { available: false, reason: assessment.error ?? "Preview texture size is unavailable." };
  }
  dispatch(action: QualityAction): boolean {
    const allowed = this.capability(action);
    if (!allowed.available) { this.state.error = allowed.reason!; this.notify(); return false; }
    const size = action.kind === "quality.rebuild" ? this.state.size : action.size;
    this.state = { size, error: "", blocked: false };
    this.port.replace(size);
    this.notify();
    return true;
  }
  fail(reason?: string) {
    this.state.error = reason ?? "Texture calculation failed. Rebuild the preview or edit again to retry.";
    this.state.blocked = true; this.notify();
  }
  recover() {
    const wasBlocked = this.state.blocked;
    this.state.blocked = false; this.state.error = "";
    if (wasBlocked) this.notify();
    return wasBlocked;
  }
}

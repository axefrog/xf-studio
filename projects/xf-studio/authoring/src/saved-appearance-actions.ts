import { parseSavedV, readSavedV, type SavedV } from "./save-reader";
import type { BodySex } from "./creator-lighting";
import { refusal, type Capability } from "./platform/api";

/**
 * What applying a save changed at once (facial shapes). The skin, face details, eyes, brows, lashes, hair, piercings and body
 * follow asynchronously from the resolved character record (character-detail-actions.ts).
 */
export type SavedAppearanceResult = { applied: string[]; appearanceReferences: number;
  /** The eye-shape choice the saved `(eyes, target)` pair selects in the loaded head, when it has one. */
  eyeShape?: number };
export type SavedAppearanceState = { savedV?: SavedV; result?: SavedAppearanceResult; suggestedEyeShape?: number };
export type SavedAppearancePort = {
  apply(savedV: SavedV): SavedAppearanceResult;
  /** Put the head back to its base facial shape (no save shown). */
  clear?(): void;
  /** The creator light rig follows V's body, as the game's preview controller does. Absent without the rig. */
  setBodySex?(sex: BodySex): void;
};
/** The body the shown V has: the save's, else the creator's default female V. */
export const bodySexOf = (savedV: SavedV | undefined): BodySex => savedV?.isMale ? "male" : "female";
export type SavedAppearanceAction = { kind: "savedV.load"; bytes: Uint8Array } |
  { kind: "savedV.restore"; value: SavedV } |
  /** Show no save: the creator's default V (the character context's Undo back to it). */
  { kind: "savedV.clear" };

/** Save parsing and preview application without file inputs or renderer object types. */
export class SavedAppearanceActions {
  private state: SavedAppearanceState = {};
  private listeners = new Set<() => void>();
  constructor(private port: SavedAppearancePort) {}
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  hasSavedV() { return !!this.state.savedV; }
  snapshot(): Readonly<SavedAppearanceState> { return structuredClone(this.state); }
  capability(action: SavedAppearanceAction): Capability {
    if (action.kind === "savedV.load" && action.bytes.byteLength > 128 * 1024 * 1024)
      return refusal("limit", "Save is larger than the supported limit.");
    if (action.kind === "savedV.clear" && !this.state.savedV) return refusal("invalid_value", "No save is shown.");
    return { available: true };
  }
  dispatch(action: SavedAppearanceAction): Readonly<SavedAppearanceState> {
    const allowed = this.capability(action);
    if (!allowed.available) throw Error(allowed.reason);
    if (action.kind === "savedV.clear") {
      // The head's facial shape follows the character context's view of the default V (character-context-actions.ts).
      this.port.clear?.();
      this.port.setBodySex?.("female");
      this.state = {};
      for (const listener of this.listeners) listener();
      return this.snapshot();
    }
    const savedV = action.kind === "savedV.load" ? readSavedV(action.bytes) : parseSavedV(action.value);
    const result = this.port.apply(savedV);
    this.port.setBodySex?.(bodySexOf(savedV));
    // The renderer matches the saved pair against the head's own eye-shape choices.
    const suggestedEyeShape = result.eyeShape;
    this.state = { savedV, result, suggestedEyeShape };
    for (const listener of this.listeners) listener();
    return this.snapshot();
  }
}

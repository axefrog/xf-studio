import { parseSavedV, readSavedV, type SavedV } from "./save-reader";
import type { BodySex } from "./creator-lighting";

/**
 * What applying a save changed at once (facial shapes, eye colour, piercings). Brows, lashes and hair
 * follow asynchronously from the resolved character record (character-detail-actions.ts).
 */
export type SavedAppearanceResult = { applied: string[]; appearanceReferences: number;
  matchedPiercing: boolean;
  eyeAppearance: { message: string };
  /** The eye-shape choice the saved `(eyes, target)` pair selects in the loaded head, when it has one. */
  eyeShape?: number };
export type SavedAppearanceState = { savedV?: SavedV; result?: SavedAppearanceResult; suggestedEyeShape?: number };
export type SavedAppearancePort = {
  apply(savedV: SavedV): SavedAppearanceResult;
  /** The creator light rig follows V's body, as the game's preview controller does. Absent without the rig. */
  setBodySex?(sex: BodySex): void;
};
/** The body the shown V has: the save's, else the creator's default female V. */
export const bodySexOf = (savedV: SavedV | undefined): BodySex => savedV?.isMale ? "male" : "female";
export type SavedAppearanceAction = { kind: "savedV.load"; bytes: Uint8Array } |
  { kind: "savedV.restore"; value: SavedV };

/** Save parsing and preview application without file inputs or renderer object types. */
export class SavedAppearanceActions {
  private state: SavedAppearanceState = {};
  private listeners = new Set<() => void>();
  constructor(private port: SavedAppearancePort) {}
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  hasSavedV() { return !!this.state.savedV; }
  snapshot(): Readonly<SavedAppearanceState> { return structuredClone(this.state); }
  capability(action: SavedAppearanceAction): { available: boolean; reason?: string } {
    if (action.kind === "savedV.load" && action.bytes.byteLength > 128 * 1024 * 1024)
      return { available: false, reason: "Save is larger than the supported limit." };
    return { available: true };
  }
  dispatch(action: SavedAppearanceAction): Readonly<SavedAppearanceState> {
    const allowed = this.capability(action);
    if (!allowed.available) throw Error(allowed.reason);
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

import { parseSavedV, readSavedV, type SavedV } from "./save-reader";

export type SavedAppearanceResult = { applied: string[]; appearanceReferences: number;
  matchedDetails: string[]; matchedHair: boolean; matchedPiercing: boolean;
  eyeAppearance: { message: string } };
export type SavedAppearanceState = { savedV?: SavedV; result?: SavedAppearanceResult; suggestedEyeShape?: number };
export type SavedAppearancePort = { apply(savedV: SavedV): SavedAppearanceResult };
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
    const group = savedV.groups.head.find(g => g.name === "character_customization") ??
      savedV.groups.head.find(g => g.name === "TPP");
    const eye = group?.morphs.find(m => m.region === "eyes");
    const suggestedEyeShape = eye ? Math.floor(Number(eye.target.slice(1)) / 10) : undefined;
    this.state = { savedV, result, suggestedEyeShape };
    for (const listener of this.listeners) listener();
    return this.snapshot();
  }
}

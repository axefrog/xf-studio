/**
 * The live documents of the selected look's features beside the primary editor document
 * (feature-module platform §1, §3; migration step 5). Each registered feature other than the one the
 * editor document edits has one `FeatureDocument`: its part (undefined while the look lacks it) and its
 * per-look editor state. The look history reads and restores them through `LiveFeatures`, so one Undo
 * step (a look transaction) can span several parts. DOM-free; imports only the platform API.
 */
import type { AnyFeatureModule } from "../api/feature";
import type { FeatureState } from "../api/document";

/** One feature's live state for a look: its parsed part (absent: the look lacks it) and its editor memory. */
export type LiveFeatureState = { part?: unknown; editor?: unknown };

export class FeatureDocument {
  private livePart: unknown;
  private liveEditor: unknown;
  constructor(readonly module: AnyFeatureModule, state: LiveFeatureState = {}) {
    this.livePart = state.part; this.liveEditor = this.parseEditor(state.editor, state.part);
  }
  get feature() { return this.module.id as string; }
  /** The look's part, or undefined when the look does not have this feature. Read-only; never a copy. */
  get part() { return this.livePart; }
  get editor() { return this.liveEditor; }
  /** What the feature's pure capability and apply read: an absent part reads as the codec's empty part. */
  state(): FeatureState<unknown, unknown> { return { part: this.livePart ?? this.module.part.empty(), editor: this.liveEditor }; }
  /** Publish an applied result. */
  set(part: unknown, editor: unknown) { this.livePart = part; this.liveEditor = editor; }
  /** The part an Undo, Redo or cancelled transaction restores (undefined: the look lacked it); the editor state is re-read against it. */
  restorePart(part: unknown | undefined) {
    this.livePart = part;
    this.liveEditor = this.parseEditor(this.module.editor.serialize(this.liveEditor), part);
  }
  /** Replace the whole state (a preset switch or a restore). */
  load(state: LiveFeatureState = {}) { this.livePart = state.part; this.liveEditor = this.parseEditor(state.editor, state.part); }
  /** A detached copy of the state (the editor as its codec parsed it, as a look's in-memory memory holds it). */
  export(): LiveFeatureState {
    return { ...(this.livePart === undefined ? {} : { part: structuredClone(this.livePart) }),
      editor: structuredClone(this.liveEditor) };
  }
  private parseEditor(value: unknown, part: unknown) { return this.module.editor.parse(value, part ?? this.module.part.empty()); }
}

/** Every live feature document of the look beside the primary one, keyed by feature. */
export class LiveFeatures {
  private readonly documents = new Map<string, FeatureDocument>();
  constructor(modules: readonly AnyFeatureModule[] = []) {
    for (const module of modules) {
      if (this.documents.has(module.id)) throw Error(`Feature ${module.id} has two live documents.`);
      this.documents.set(module.id, new FeatureDocument(module));
    }
  }
  get size() { return this.documents.size; }
  features(): string[] { return [...this.documents.keys()]; }
  has(feature: string) { return this.documents.has(feature); }
  document(feature: string): FeatureDocument | undefined { return this.documents.get(feature); }
  /** A feature's live part as the look history reads it (undefined: the look lacks it, or no such document). */
  read(feature: string): unknown | undefined { return this.documents.get(feature)?.part; }
  /** Restore the parts an Undo or Redo returned; features without a live document are ignored. Returns the restored ones. */
  restore(parts: Readonly<Record<string, unknown | undefined>>): string[] {
    const restored: string[] = [];
    for (const [feature, part] of Object.entries(parts)) {
      const document = this.documents.get(feature);
      if (document) { document.restorePart(part); restored.push(feature); }
    }
    return restored;
  }
  /** A fingerprint of the listed features' parts (all by default): equal text, equal content. */
  content(features: readonly string[] = this.features()): string {
    return JSON.stringify(features.filter(feature => this.documents.has(feature)).map(feature => [feature, this.documents.get(feature)!.part ?? null]));
  }
  /** Every document's state, detached (only features with a part or a non-default editor state matter to a caller). */
  export(): Record<string, LiveFeatureState> {
    return Object.fromEntries([...this.documents].map(([feature, document]) => [feature, document.export()]));
  }
  /** Load every document from `states` (a missing feature starts empty: the look lacks it). */
  load(states: Readonly<Record<string, LiveFeatureState>> | undefined) {
    for (const [feature, document] of this.documents) document.load(states?.[feature]);
  }
}

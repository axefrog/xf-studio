/**
 * The live documents of all of a look's features (CORE-03 slice 2). Each registered feature
 * has one `FeatureDocument`: its part (undefined while the look lacks it) and its
 * per-look editor state. The look history reads and restores them through `LiveFeatures`, so one Undo
 * step (a look transaction) can span several parts. DOM-free; imports only the platform API.
 */
import type { AnyFeatureModule } from "../api/feature";
import type { FeatureState } from "../api/document";

/** One feature's live state for a look: its parsed part (absent: the look lacks it) and its editor memory. */
export type LiveFeatureState = { part?: unknown; editor?: unknown };
/** A feature adapter's pure selection rule and post-commit replay notification; neither owns history/state. */
export type FeatureRestore = { editor?(previous: LiveFeatureState, part: unknown): unknown; restored?(previous: unknown): void };
export type LiveFeatureChange = { kind: "set" | "restore" | "load"; features: readonly string[] };

export class FeatureDocument {
  private livePart: unknown;
  private liveEditor: unknown;
  constructor(readonly module: AnyFeatureModule, state: LiveFeatureState = {},
    private readonly changed: (kind: LiveFeatureChange["kind"]) => void = () => {}, private readonly replay: FeatureRestore = {}) {
    this.livePart = state.part; this.liveEditor = this.parseEditor(state.editor, state.part);
  }
  get feature() { return this.module.id as string; }
  /** The look's part, or undefined when the look does not have this feature. Read-only; never a copy. */
  get part() { return this.livePart; }
  get editor() { return this.liveEditor; }
  /** What the feature's pure capability and apply read: an absent part reads as the codec's empty part. */
  state(): FeatureState<unknown, unknown> { return { part: this.livePart ?? this.module.part.empty(), editor: this.liveEditor }; }
  /** Publish an applied result. */
  set(part: unknown, editor: unknown) { this.livePart = part; this.liveEditor = editor; this.changed("set"); }
  /** Validate the whole proposed state before publishing any of it. */
  prepare(state: LiveFeatureState = {}): LiveFeatureState {
    const part = state.part === undefined ? undefined : this.module.part.parse(this.module.part.serialize(state.part));
    return { part, editor: this.parseEditor(state.editor, part) };
  }
  prepareRestore(part: unknown | undefined): LiveFeatureState {
    const parsed = part === undefined ? undefined : this.module.part.parse(this.module.part.serialize(part));
    const editor = this.replay.editor ? this.replay.editor({ part: this.livePart, editor: this.liveEditor }, parsed)
      : this.module.editor.serialize(this.liveEditor);
    return { part: parsed, editor: this.parseEditor(editor, parsed) };
  }
  /** Commit a prevalidated state; LiveFeatures batches the notification. */
  commit(state: LiveFeatureState, kind: LiveFeatureChange["kind"]) {
    this.livePart = state.part; this.liveEditor = state.editor;
    this.changed(kind);
  }
  restored(previous: unknown) { this.replay.restored?.(previous); }
  /** The part an Undo, Redo or cancelled transaction restores (undefined: the look lacked it); the editor state is re-read against it. */
  restorePart(part: unknown | undefined) {
    const previous = this.livePart;
    this.commit(this.prepareRestore(part), "restore"); this.restored(previous);
  }
  /** Replace the whole state (a preset switch or a restore). */
  load(state: LiveFeatureState = {}) { this.commit(this.prepare(state), "load"); }
  /** The look lacks the part and the editor state is the codec's default. */
  isBlank(): boolean {
    return this.livePart === undefined &&
      JSON.stringify(this.module.editor.serialize(this.liveEditor)) === JSON.stringify(this.module.editor.serialize(this.module.editor.empty()));
  }
  /** A detached copy of the state (the editor as its codec parsed it, as a look's in-memory memory holds it). */
  export(): LiveFeatureState {
    return { ...(this.livePart === undefined ? {} : { part: structuredClone(this.livePart) }),
      editor: structuredClone(this.liveEditor) };
  }
  private parseEditor(value: unknown, part: unknown) { return this.module.editor.parse(value, part ?? this.module.part.empty()); }
}

/** All live feature documents of a look, keyed by the existing module registration. */
export class LiveFeatures {
  private readonly documents = new Map<string, FeatureDocument>();
  private readonly listeners = new Set<(change: LiveFeatureChange) => void>();
  private batching = false;
  constructor(modules: readonly AnyFeatureModule[] = []) {
    for (const module of modules) this.add(module);
  }
  /** Composition-time assembly, including the transitional makeup adapter's registered part. */
  add(module: AnyFeatureModule, replay?: FeatureRestore): FeatureDocument {
    if (this.documents.has(module.id)) throw Error(`Feature ${module.id} has two live documents.`);
    const document = new FeatureDocument(module, {}, kind => this.notify({ kind, features: [module.id] }), replay);
    this.documents.set(module.id, document);
    return document;
  }
  subscribe(listener: (change: LiveFeatureChange) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify(change: LiveFeatureChange) { if (!this.batching) for (const listener of this.listeners) listener(change); }
  get size() { return this.documents.size; }
  features(): string[] { return [...this.documents.keys()]; }
  has(feature: string) { return this.documents.has(feature); }
  document(feature: string): FeatureDocument | undefined { return this.documents.get(feature); }
  /** A feature's live part as the look history reads it (undefined: the look lacks it, or no such document). */
  read(feature: string): unknown | undefined { return this.documents.get(feature)?.part; }
  /** Restore the parts an Undo or Redo returned; features without a live document are ignored. Returns the restored ones. */
  restore(parts: Readonly<Record<string, unknown | undefined>>): string[] {
    return this.restorePrepared(this.prepareRestore(parts));
  }
  prepareRestore(parts: Readonly<Record<string, unknown | undefined>>) {
    return Object.entries(parts).flatMap(([feature, part]) => {
      const document = this.documents.get(feature);
      return document ? [{ feature, document, state: document.prepareRestore(part) }] : [];
    });
  }
  restorePrepared(prepared: ReturnType<LiveFeatures["prepareRestore"]>) { return this.commit(prepared, "restore"); }
  /** A fingerprint of the listed features' parts (all by default): equal text, equal content. */
  content(features: readonly string[] = this.features()): string {
    return JSON.stringify(features.filter(feature => this.documents.get(feature)?.part !== undefined)
      .map(feature => [feature, this.documents.get(feature)!.part]));
  }
  /**
   * Every document's state that holds something, detached: a feature the look lacks whose editor state is its default is left out
   * (looks are sparse), so a look that never used a feature exports nothing for it.
   */
  export(features: readonly string[] = this.features()): Record<string, LiveFeatureState> {
    return Object.fromEntries(features.flatMap(feature => {
      const document = this.documents.get(feature);
      return document && !document.isBlank() ? [[feature, document.export()]] : [];
    }));
  }
  /** Load every document from `states` (a missing feature starts empty: the look lacks it). */
  load(states: Readonly<Record<string, LiveFeatureState>> | undefined) {
    this.loadPrepared(this.prepare(states));
  }
  /** Used by the look owner to validate state and history together before replacing anything. */
  prepare(states: Readonly<Record<string, LiveFeatureState>> | undefined) {
    if (states && Object.keys(states).some(feature => !this.documents.has(feature)))
      throw Error("This look's live state includes a feature this editor cannot show.");
    return [...this.documents].map(([feature, document]) => ({ feature, document, state: document.prepare(states?.[feature]) }));
  }
  loadPrepared(prepared: ReturnType<LiveFeatures["prepare"]>) { this.commit(prepared, "load"); }
  private commit(prepared: ReturnType<LiveFeatures["prepare"]>, kind: "load" | "restore") {
    const previous = prepared.map(item => item.document.part);
    this.batching = true;
    try { for (const item of prepared) item.document.commit(item.state, kind); }
    finally { this.batching = false; }
    if (kind === "restore") for (let i = 0; i < prepared.length; i++) prepared[i].document.restored(previous[i]);
    const features = prepared.map(item => item.feature);
    if (features.length) this.notify({ kind, features });
    return features;
  }
}

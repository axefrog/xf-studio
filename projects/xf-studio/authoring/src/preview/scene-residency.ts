/**
 * Which scene runtimes stay resident on the window's renderer device, and the superseding subject change (profiles design §4.5,
 * experiment 043 §10). DOM-free: the runtimes themselves, and what showing and hiding one means, come through the port.
 *
 * - **A want per drawn scene.** The drawn scene wants one runtime: its (scene, subject, body), named by `key`. The newest want wins: a
 *   build in flight for an older one is aborted (its `AbortSignal`), and whatever it still produces is disposed, never shown. Phase 4a
 *   draws one view, so the drawn scene's want is the only one; with several drawn views (4b) wants become per view.
 * - **The previous runtime stays shown** until the wanted one is built: `show` swaps them in one step (the shown one is hidden first, so it
 *   can hand over its camera and motion, then the new one is shown).
 * - **Residency is a budget** (decision D2): the shown runtime plus at most `warm` others (default 1). A runtime that stops being shown
 *   becomes warm; past the budget, the least recently shown is disposed. Wanting a warm runtime again shows it at once, with no build.
 * - **Context loss** drops the warm runtimes first (`contextLost`): the device restores only what is shown or still being built.
 * - **Disposal is ordinary disposal** (the port's `dispose`), the same for eviction, context loss, a superseded build and `dispose`.
 */

/** What a scene wants shown: `key` names the runtime that shows it (its scene, subject and body). */
export type ResidencyWant = { readonly scene: string; readonly key: string };
export type ResidencyPort<W extends ResidencyWant, R> = {
  /** Build a runtime for `want`, hidden. Rejects with `signal.reason` once aborted (a newer want superseded it). */
  build(want: W, signal: AbortSignal): Promise<R>;
  /** `runtime` becomes the shown one (the one shown before was hidden first). */
  show(runtime: R, want: W): void;
  /** `runtime` stops being shown (it is warm now, or about to be disposed). */
  hide(runtime: R): void;
  /** Dispose a runtime that isn't shown. */
  dispose(runtime: R): void;
};
export type ResidentState = "shown" | "warm";
/** A resident runtime as evidence: its want, state and when it was last shown (a sequence number, larger is later). */
export type ResidentView = { readonly scene: string; readonly key: string; readonly state: ResidentState; readonly shownAt: number };
export type ResidencySnapshot = { readonly residents: readonly ResidentView[]; readonly building: ResidencyWant | null; readonly warm: number };

type Resident<W, R> = { want: W; runtime: R; state: ResidentState; shownAt: number };
type Build<W, R> = { want: W; controller: AbortController; promise: Promise<R> };

/** The reason a superseded build is aborted with (a `DOMException` named `AbortError`, like `AbortSignal.abort()`'s). */
const superseded = () => new DOMException("A newer subject or body change superseded this one.", "AbortError");

export class SceneResidency<W extends ResidencyWant, R> {
  private readonly residents = new Map<string, Resident<W, R>>();
  private building: Build<W, R> | null = null;
  private sequence = 0;
  private disposed = false;
  /** How many runtimes may stay warm beside the shown one (decision D2's budget; a count, not bytes). */
  readonly warm: number;

  constructor(private readonly port: ResidencyPort<W, R>, options: { warm?: number } = {}) {
    const warm = options.warm ?? 1;
    if (!Number.isInteger(warm) || warm < 0) throw RangeError("The warm budget is a whole number, 0 or more.");
    this.warm = warm;
  }

  /**
   * The drawn scene wants `want` shown. Resolves with its runtime once it is shown; rejects with an `AbortError` when a newer want
   * superseded it first, or with the build's error (the runtime shown before stays shown).
   */
  want(want: W): Promise<R> {
    if (this.disposed) return Promise.reject(superseded());
    const resident = this.residents.get(want.key);
    if (this.building && (resident || this.building.want.key !== want.key)) this.supersede();
    if (resident) { this.swap(resident); return Promise.resolve(resident.runtime); }
    if (this.building) return this.building.promise;
    const controller = new AbortController();
    const build: Build<W, R> = { want, controller, promise: undefined as never };
    build.promise = this.port.build(want, controller.signal).then(runtime => {
      if (this.building !== build || controller.signal.aborted) { this.port.dispose(runtime); throw controller.signal.reason ?? superseded(); }
      this.building = null;
      const made: Resident<W, R> = { want, runtime, state: "warm", shownAt: 0 };
      this.residents.set(want.key, made);
      this.swap(made);
      return runtime;
    }, error => {
      if (this.building === build) this.building = null;
      throw controller.signal.aborted ? controller.signal.reason : error;
    });
    this.building = build;
    return build.promise;
  }
  /** The runtime shown now (undefined before the first is built). */
  shown(): R | undefined { return this.shownResident()?.runtime; }
  /** The want shown now. */
  shownWant(): W | undefined { return this.shownResident()?.want; }
  /** The wants of the resident runtimes (shown and warm). */
  wants(): readonly W[] { return [...this.residents.values()].map(resident => resident.want); }
  /** The want being built, if any. */
  pending(): W | undefined { return this.building?.want; }
  snapshot(): ResidencySnapshot {
    return { residents: [...this.residents.values()].map(({ want, state, shownAt }) => ({ scene: want.scene, key: want.key, state, shownAt })),
      building: this.building ? { scene: this.building.want.scene, key: this.building.want.key } : null, warm: this.warm };
  }
  /** The renderer's context was lost: the warm runtimes go first; the shown one, and one still being built, are restored by the device. */
  contextLost(): void { for (const resident of [...this.residents.values()]) if (resident.state === "warm") this.evict(resident); }
  /** A scene closed: its build stops and its runtimes go (a shown one is hidden first, and nothing is shown in its place). */
  close(scene: string): void {
    if (this.building?.want.scene === scene) this.supersede();
    for (const resident of [...this.residents.values()]) if (resident.want.scene === scene) {
      if (resident.state === "shown") this.port.hide(resident.runtime);
      this.evict(resident);
    }
  }
  /** Everything goes: the build in flight stops, the shown runtime is hidden, and every runtime is disposed. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.supersede();
    for (const resident of [...this.residents.values()]) {
      if (resident.state === "shown") this.port.hide(resident.runtime);
      this.evict(resident);
    }
  }

  private shownResident() { for (const resident of this.residents.values()) if (resident.state === "shown") return resident; return undefined; }
  private supersede() {
    const build = this.building;
    this.building = null;
    build?.controller.abort(superseded());
  }
  /** Show `next`: the runtime shown before is hidden first and becomes warm, then the budget is kept. */
  private swap(next: Resident<W, R>) {
    if (next.state === "shown") return;
    const previous = this.shownResident();
    if (previous) { this.port.hide(previous.runtime); previous.state = "warm"; }
    next.state = "shown"; next.shownAt = ++this.sequence;
    try { this.port.show(next.runtime, next.want); }
    catch (error) {
      // A runtime that can't be shown goes, and the one shown before is shown again.
      next.state = "warm";
      this.evict(next);
      if (previous) { previous.state = "shown"; previous.shownAt = ++this.sequence; this.port.show(previous.runtime, previous.want); }
      throw error;
    }
    const warm = [...this.residents.values()].filter(resident => resident.state === "warm").sort((a, b) => a.shownAt - b.shownAt);
    for (const resident of warm.slice(0, Math.max(0, warm.length - this.warm))) this.evict(resident);
  }
  private evict(resident: Resident<W, R>) {
    this.residents.delete(resident.want.key);
    this.port.dispose(resident.runtime);
  }
}

/**
 * Which scene runtimes stay resident on the window's renderer device, the superseding subject change, and preparing a runtime before it is
 * shown (profiles design §4.5, experiment 043 §10–§11). DOM-free: the runtimes themselves, and what building, preparing, showing and hiding
 * one means, come through the port.
 *
 * - **A want per drawn scene.** The drawn scene wants one runtime: its (scene, subject, body), named by `key`. The newest want wins: a
 *   build or preparation in flight for an older one is aborted (its `AbortSignal`), and whatever it still produces is disposed, never shown.
 *   Phase 4a draws one view, so the drawn scene's want is the only one; with several drawn views (4b) wants become per view.
 * - **Prepared before shown.** A runtime is built hidden, then prepared hidden (the port's `prepare`: its details, its programs compiled
 *   ahead, its maps uploaded, one hidden warm-up draw), and only then shown. Preparation is work done ahead: when it fails, the runtime is
 *   shown anyway and its first frame does what preparation couldn't; only an abort stops it.
 * - **The previous runtime stays shown** until the wanted one is prepared: `show` swaps them in one step (the shown one is hidden first, so
 *   it can hand over its camera and motion, then the new one is shown).
 * - **Progress, typed.** While a want is being built or prepared, `preparation()` says how far it is: its stage, an overall fraction that
 *   only ever grows, and what it waits on. Listeners hear every change (`subscribe`).
 * - **Residency is a budget** (decision D2): the shown runtime plus at most `warm` others (default 1). A runtime that stops being shown
 *   becomes warm; past the budget, the least recently shown is disposed. Wanting a warm runtime again shows it at once when it is still
 *   prepared (the port's `prepared`), with no build; otherwise it is prepared again first, and stays warm if that is superseded.
 * - **Context loss** drops the warm runtimes first (`contextLost`): the device restores only what is shown or still being built.
 * - **Disposal is ordinary disposal** (the port's `dispose`), the same for eviction, context loss, a superseded build and `dispose`.
 */

/** What a scene wants shown: `key` names the runtime that shows it (its scene, subject and body). */
export type ResidencyWant = { readonly scene: string; readonly key: string };

/**
 * The stages a want goes through, in order: the body's core head prepared by the host (`core`, a masculine V's on first use), the runtime
 * built hidden (`build`), the V's details loaded and made ready (`details`), its programs compiled ahead (`programs`), its maps uploaded
 * (`textures`) and the hidden warm-up draw (`warm-up`).
 */
export const PREPARATION_STAGES = ["core", "build", "details", "programs", "textures", "warm-up"] as const;
export type PreparationStage = typeof PREPARATION_STAGES[number];
/**
 * What a stage is waiting on, if anything: the host's preparation (`host`), files being read (`files`), the graphics driver linking
 * programs (`driver`) or the GPU finishing what it was sent (`gpu`).
 */
export type PreparationWait = "host" | "files" | "driver" | "gpu";
/** A step's report: its stage, how far into it (0–1; absent: just started), what it waits on, and the host's own line (`detail`). */
export type PreparationReport = { readonly stage: PreparationStage; readonly fraction?: number; readonly waiting?: PreparationWait | null;
  readonly detail?: string };
export type PreparationProgress = (report: PreparationReport) => void;
/**
 * A want being made ready, as plain data: its stage, the overall fraction (0–1, never decreasing for one want), what it waits on, the
 * host's own line while the host prepares (`detail`), and whether the runtime was already resident (a warm one prepared again).
 */
export type PreparationState = { readonly scene: string; readonly key: string; readonly stage: PreparationStage; readonly fraction: number;
  readonly waiting: PreparationWait | null; readonly detail?: string; readonly warm: boolean };

/**
 * How much of the whole each stage weighs in the overall fraction (only the stages a want goes through count). The host's core preparation
 * is long when it runs (18.5 s cold); the rest are orders of magnitude measured on a warm host (experiment 039).
 */
const STAGE_WEIGHT: Readonly<Record<PreparationStage, number>> = { core: 8, build: 2, details: 4, programs: 6, textures: 2, "warm-up": 1 };
/** The stages a want goes through unless the port says otherwise (no core preparation). */
const DEFAULT_STAGES: readonly PreparationStage[] = PREPARATION_STAGES.filter(stage => stage !== "core");

export type ResidencyPort<W extends ResidencyWant, R> = {
  /** Build a runtime for `want`, hidden, reporting its stages. Rejects with `signal.reason` once aborted (a newer want superseded it). */
  build(want: W, signal: AbortSignal, progress: PreparationProgress): Promise<R>;
  /**
   * Make a built (or warm) runtime ready to be shown, hidden: its first shown frame should need nothing more. Rejects with `signal.reason`
   * once aborted. Absent: a built runtime is ready.
   */
  prepare?(runtime: R, want: W, signal: AbortSignal, progress: PreparationProgress): Promise<void>;
  /** Whether a warm runtime is still prepared for `want` (shown at once), or must be prepared again first. Absent: it is. */
  prepared?(runtime: R, want: W): boolean;
  /** The stages a want goes through, in order (absent: every stage but `core`). */
  stages?(want: W): readonly PreparationStage[];
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
export type ResidencySnapshot = { readonly residents: readonly ResidentView[]; readonly building: ResidencyWant | null; readonly warm: number;
  /** The want being built or prepared, and how far it is (null: none). */
  readonly preparation: PreparationState | null };

type Resident<W, R> = { want: W; runtime: R; state: ResidentState; shownAt: number };
/** A want in flight: being built (no `resident`), or a warm resident being prepared again. */
type Build<W, R> = { want: W; controller: AbortController; promise: Promise<R>; resident?: Resident<W, R>;
  stages: readonly PreparationStage[]; state: PreparationState };

/** The reason a superseded build is aborted with (a `DOMException` named `AbortError`, like `AbortSignal.abort()`'s). */
const superseded = () => new DOMException("A newer subject or body change superseded this one.", "AbortError");
const isAbort = (error: unknown) => (error as { name?: string })?.name === "AbortError";
const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export class SceneResidency<W extends ResidencyWant, R> {
  private readonly residents = new Map<string, Resident<W, R>>();
  private building: Build<W, R> | null = null;
  private readonly listeners = new Set<() => void>();
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
    if (this.building && this.building.want.key !== want.key) this.supersede();
    if (this.building) return this.building.promise;
    if (resident) {
      if (resident.state === "shown" || (this.port.prepared?.(resident.runtime, want) ?? true)) { this.swap(resident); return Promise.resolve(resident.runtime); }
      return this.start(want, resident);
    }
    return this.start(want);
  }
  /** The runtime shown now (undefined before the first is shown). */
  shown(): R | undefined { return this.shownResident()?.runtime; }
  /** The want shown now. */
  shownWant(): W | undefined { return this.shownResident()?.want; }
  /** The wants of the resident runtimes (shown and warm). */
  wants(): readonly W[] { return [...this.residents.values()].map(resident => resident.want); }
  /** The want being built or prepared, if any. */
  pending(): W | undefined { return this.building?.want; }
  /** How far the want in flight is (null: none). */
  preparation(): PreparationState | null { return this.building ? { ...this.building.state } : null; }
  /** Hear every change of `preparation()` (a stage, its fraction, its end); returns the unsubscribe. */
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  snapshot(): ResidencySnapshot {
    return { residents: [...this.residents.values()].map(({ want, state, shownAt }) => ({ scene: want.scene, key: want.key, state, shownAt })),
      building: this.building ? { scene: this.building.want.scene, key: this.building.want.key } : null, warm: this.warm,
      preparation: this.preparation() };
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
    this.listeners.clear();
  }

  /** Build (unless a warm `resident` is given), prepare, then show `want`; superseded at any point by a newer want. */
  private start(want: W, resident?: Resident<W, R>): Promise<R> {
    const controller = new AbortController(), signal = controller.signal;
    const plan = this.planOf(want).filter(stage => !resident || (stage !== "core" && stage !== "build"));
    const stages = plan.length ? plan : DEFAULT_STAGES;
    const build: Build<W, R> = { want, controller, promise: undefined as never, ...(resident ? { resident } : {}), stages,
      state: { scene: want.scene, key: want.key, stage: stages[0]!, fraction: 0, waiting: null, warm: !!resident } };
    const progress: PreparationProgress = report => this.progress(build, report);
    const current = () => this.building === build && !signal.aborted;
    build.promise = (async () => {
      let runtime: R;
      if (resident) runtime = resident.runtime;
      else {
        runtime = await this.port.build(want, signal, progress);
        if (!current()) { this.port.dispose(runtime); throw signal.reason ?? superseded(); }
      }
      if (this.port.prepare) {
        try { await this.port.prepare(runtime, want, signal, progress); }
        catch (error) {
          // Only an abort stops a want: a preparation that failed otherwise leaves the rest to its first frame.
          if (!signal.aborted && !isAbort(error)) console.warn("A scene runtime couldn't be prepared ahead; it is shown anyway.", error);
        }
      }
      if (!current()) { if (!resident) this.port.dispose(runtime); throw signal.reason ?? superseded(); }
      this.building = null;
      this.publish();
      const made = resident ?? { want, runtime, state: "warm" as ResidentState, shownAt: 0 };
      if (!resident) this.residents.set(want.key, made);
      this.swap(made);
      return runtime;
    })().catch(error => {
      if (this.building === build) { this.building = null; this.publish(); }
      throw signal.aborted ? signal.reason ?? superseded() : error;
    });
    this.building = build;
    this.publish();
    return build.promise;
  }
  private planOf(want: W): readonly PreparationStage[] {
    const stages = this.port.stages?.(want) ?? DEFAULT_STAGES;
    return PREPARATION_STAGES.filter(stage => stages.includes(stage));
  }
  /** A report from `build`'s work: ignored once superseded, a stage never goes back, and the overall fraction never decreases. */
  private progress(build: Build<W, R>, report: PreparationReport) {
    if (this.building !== build || build.controller.signal.aborted) return;
    const index = build.stages.indexOf(report.stage), current = build.stages.indexOf(build.state.stage);
    if (index < 0 || index < current) return;
    const weight = (stages: readonly PreparationStage[]) => stages.reduce((sum, stage) => sum + STAGE_WEIGHT[stage], 0);
    const overall = (weight(build.stages.slice(0, index)) + STAGE_WEIGHT[report.stage] * clamp01(report.fraction ?? 0)) / weight(build.stages);
    const next: PreparationState = { scene: build.state.scene, key: build.state.key, stage: report.stage,
      fraction: Math.max(build.state.fraction, clamp01(overall)), waiting: report.waiting ?? null,
      ...(report.detail ? { detail: report.detail } : {}), warm: build.state.warm };
    if (JSON.stringify(next) === JSON.stringify(build.state)) return;
    build.state = next;
    this.publish();
  }
  private publish() { for (const listener of [...this.listeners]) listener(); }
  private shownResident() { for (const resident of this.residents.values()) if (resident.state === "shown") return resident; return undefined; }
  private supersede() {
    const build = this.building;
    if (!build) return;
    this.building = null;
    build.controller.abort(superseded());
    this.publish();
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
    // A warm runtime being prepared again stops first.
    if (this.building?.resident === resident) this.supersede();
    this.residents.delete(resident.want.key);
    this.port.dispose(resident.runtime);
  }
}

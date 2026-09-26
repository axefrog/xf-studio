/**
 * Host application service: prepares a Character panel row's choices ahead of a click, in the background, so a first-time choice is
 * ready (well under a second) when it is clicked. DOM-free and file-free: the host supplies what it reads and does (`PrefetchDeps`).
 *
 * - **A job per open row.** The panel names the V (its request), the row's option and the positions of the choices it shows, visible
 *   ones first (`update`). A different V or option replaces the job; closing the row cancels it (`cancel`). Each choice's request is the
 *   V with that choice set (`requestFor`).
 * - **States** per choice, as one compact string (one character each, `ChoiceFetchState`): not known yet, not prepared, queued, being
 *   prepared, ready, or failed. A choice whose manifest holds (choice-manifest.ts) is ready at once, in this session or a later one;
 *   the rest are queued in the panel's order.
 * - **Batches.** Queued choices are prepared together (`warm`: each level of all their resource chains in one WolvenKit batch, their
 *   parts exported in one launch), at low priority: a small first batch, so the choices in view come back soon, then larger ones.
 * - **A person's own change comes first.** While the host prepares a person's change the queue waits (`foregroundIdle`); a batch in
 *   WolvenKit when it starts is stopped (`pause`: its export launch is ended, reads already in WolvenKit finish and are kept), and its
 *   choices are queued again. A hover or focus hint (`focus`) moves a choice to the front of the queue; a click on it is the person's
 *   own change, shown as being prepared (`foreground`) and ready when it is (`prepared`). Nothing awaits between the loop's check that
 *   no change is being prepared and the start of a batch, so a change that starts meanwhile always finds the batch to stop.
 * - **Settles before a person's change.** `idle` resolves once no batch is being prepared, so a person's own change and Clear start only
 *   after a stopped batch has let go of the shared preparation cache (PREV-102).
 * - **Bounded.** A job stops after `timeMs`, and prefetching stops for the session once it has added `bytes` of prepared files; either
 *   leaves the remaining choices "not prepared" (the panel says why), and a click still prepares them. "Clear prepared game files"
 *   starts the session's byte budget again (`resetBudget`, PREV-104). A job nobody has asked about for `unpolledMs` (the page closed or
 *   went away) is stopped, its batch in WolvenKit too (PREV-105); asking again starts it afresh.
 * - **Never ends the host.** Background work has nobody to report to: an unexpected failure (a dependency throwing, a damaged manifest)
 *   stops the job, leaves its remaining choices "not prepared", and is reported once through `failed` (PREV-101). A choice whose
 *   readiness can't be checked is queued; one whose request can't be made is not prepared.
 */
import type { CharacterRequest } from "./character-detail-request";
import { canonicalJson } from "./eye-plate-recipe";

export const CHOICE_PREFETCH_SCHEMA = "xfs/choice-prefetch-1" as const;
/**
 * `?` not known yet, `n` not prepared (not queued: the job stopped), `q` queued, `f` being prepared, `r` ready, `x` failed this time.
 * The page reads a string of these, one per position it asked about.
 */
export type ChoiceFetchState = "?" | "n" | "q" | "f" | "r" | "x";
/**
 * `failed`: an unexpected failure stopped the job (the page shows its choices as not prepared, without naming a reason). `setup`: nothing
 * can be prepared until WolvenKit is set up (NATIVE-48).
 */
export type PrefetchStop = "time" | "disk" | "failed" | "setup" | null;
export type PrefetchAnswer = {
  schema: typeof CHOICE_PREFETCH_SCHEMA;
  option: string;
  /** The states of the positions asked about, in their order. */
  states: string;
  /** Why the job stopped before every choice was prepared (null: it didn't). */
  stopped: PrefetchStop;
  /** The job still has work (the page keeps asking while it does). */
  busy: boolean;
};
export type PrefetchInput = { base: CharacterRequest; option: string; positions: readonly number[]; focus?: number | null };
export type PrefetchDeps = {
  /** The V with one choice of the option set, or null when the installed catalogue doesn't offer it. */
  requestFor(base: CharacterRequest, option: string, position: number): Promise<CharacterRequest | null>;
  /** A check of whether a request is ready now (its manifest holds), on the installation as it is now. */
  readiness(): Promise<(request: CharacterRequest) => boolean>;
  /** Prepare several requests ahead (character-detail-service.ts `warmCharacters`); per request, whether it is ready. */
  warm(requests: readonly CharacterRequest[], signal: AbortSignal): Promise<readonly { ready: boolean }[]>;
  /** Resolves once no person's own change is being prepared. */
  foregroundIdle(): Promise<void>;
  /** The prepared files' size now (prepared-files.ts). */
  preparedBytes(): Promise<number>;
  /** After a batch: keep the prepared files within their budget. */
  afterBatch?(): Promise<void>;
  /** Nothing can be prepared until something is set up (WolvenKit): the job stops as `setup` before its first batch (NATIVE-48). */
  needsSetup?(): boolean;
  log?(message: string): void;
  /** A batch or the job failed for a reason other than being stopped (the host's diagnostics hook). */
  failed?(error: unknown): void;
  now?(): number;
};
/**
 * `batch`: choices in a job's first batch (the ones in view come back soonest); each later batch doubles, up to `maxBatch`, since every
 * batch costs its chain's depth in launches whatever its size (51 vanilla hairstyles took 70 launches in batches of 8).
 */
export type PrefetchLimits = { batch: number; maxBatch?: number; timeMs: number; bytes: number;
  /**
   * A job nobody has asked about for this long is stopped (PREV-105). The page asks every 0.8 s while its panel is looked at and every
   * 4 s otherwise; a hidden browser tab may be held to one timer a minute, so the default leaves room for that. 0 or absent: never.
   */
  unpolledMs?: number };
export const PREFETCH_LIMITS: PrefetchLimits = { batch: 8, maxBatch: 32, timeMs: 10 * 60_000, bytes: 2 * 1024 ** 3, unpolledMs: 90_000 };

type Item = { position: number; state: ChoiceFetchState; request: CharacterRequest | null; key: string | null; order: number };
type Job = { key: string; base: CharacterRequest; option: string; items: Map<number, Item>; controller: AbortController; startedAt: number;
  stopped: PrefetchStop; running: boolean; serial: number; batches: number; polledAt: number };

export const requestKey = (request: CharacterRequest) => canonicalJson(request);
/** A request without the choices of one option (`part/name`). */
export function withoutOption(request: CharacterRequest, option: string): CharacterRequest {
  const choices = (request.choices ?? []).filter(choice => `${choice.part}/${choice.option}` !== option);
  const { choices: _all, ...rest } = request;
  return (choices.length ? { ...rest, choices } : rest) as CharacterRequest;
}
const messageOf = (error: unknown) => (error as Error)?.message ?? String(error);

export class ChoicePrefetcher {
  private job: Job | null = null;
  /** The batch in WolvenKit now, stopped when a person's own change starts (`pause`). */
  private batch: AbortController | null = null;
  /** Prepared-file bytes when this session's first prefetch began, and whether the session's byte budget is spent. */
  private startBytes: number | null = null;
  private spent = false;
  /** The request a person's own change is preparing now (its key), if any. */
  private foregroundKey: string | null = null;
  /** The batch being prepared now, as a promise that settles with it and never rejects: what `idle` waits for. */
  private inflight: Promise<void> | null = null;
  /** Checks, while a job runs, that the page still asks about it (PREV-105). */
  private watchdog: ReturnType<typeof setInterval> | null = null;
  readonly stats = { batches: 0, warmed: 0, cancelled: 0, failed: 0, unpolled: 0 };

  constructor(private readonly deps: PrefetchDeps, private readonly limits: PrefetchLimits = PREFETCH_LIMITS) {}
  private now() { return this.deps.now?.() ?? Date.now(); }

  /** Start or update the job for a row and answer its states for `positions`. Never waits for preparation. */
  update(input: PrefetchInput): PrefetchAnswer {
    // The V without the row's own choice: choosing in the row doesn't start its job again (each choice's request replaces it).
    const base = withoutOption(input.base, input.option), key = `${requestKey(base)}\n${input.option}`;
    if (this.job?.key !== key) {
      this.cancel();
      this.job = { key, base, option: input.option, items: new Map(), controller: new AbortController(), startedAt: this.now(),
        stopped: this.spent ? "disk" : null, running: false, serial: 0, batches: 0, polledAt: this.now() };
    }
    const job = this.job!;
    job.polledAt = this.now();
    for (const position of input.positions) {
      if (!Number.isInteger(position) || position < 0 || job.items.has(position)) continue;
      job.items.set(position, { position, state: "?", request: null, key: null, order: job.serial++ });
    }
    if (input.focus !== undefined && input.focus !== null) {
      const item = job.items.get(input.focus) ?? { position: input.focus, state: "?" as const, request: null, key: null, order: 0 };
      // A hint moves the choice ahead of every other; a failed one is tried again.
      item.order = -(++job.serial);
      if (item.state === "x" || item.state === "n") item.state = "q";
      job.items.set(input.focus, item);
    }
    if (!job.running && !job.stopped && [...job.items.values()].some(item => item.state === "?" || item.state === "q")) this.start(job);
    return this.answer(job, input.positions);
  }

  private answer(job: Job, positions: readonly number[]): PrefetchAnswer {
    const states = positions.map(position => job.items.get(position)?.state ?? "?").join("");
    const busy = !job.stopped && [...job.items.values()].some(item => item.state === "?" || item.state === "q" || item.state === "f");
    return { schema: CHOICE_PREFETCH_SCHEMA, option: job.option, states, stopped: job.stopped, busy };
  }

  /** Closing the row: stop the job (a batch in WolvenKit is stopped too). */
  cancel(): void {
    const job = this.job;
    this.stopWatchdog();
    if (!job) return;
    job.controller.abort();
    this.batch?.abort();
    this.job = null;
    this.stats.cancelled++;
  }

  /** A batch is being prepared (or a stopped one hasn't settled yet). */
  get preparing(): boolean { return this.inflight !== null; }
  /** Resolves once no batch is being prepared (a stopped one has settled). Never rejects. */
  async idle(): Promise<void> {
    while (this.inflight) await this.inflight;
  }
  /** "Clear prepared game files": the session's byte budget starts again, so preparing ahead can run again (PREV-104). */
  resetBudget(): void {
    this.startBytes = null;
    this.spent = false;
  }

  /** A person's own change starts: stop the batch in WolvenKit (its choices are queued again) and wait until the change is prepared. */
  foreground(request: CharacterRequest): void {
    this.foregroundKey = requestKey(request);
    this.batch?.abort();
    const item = this.itemFor(this.foregroundKey);
    if (item && item.state !== "r") item.state = "f";
  }
  /** A person's own change was prepared (`ready`: fully, so it is ready from now on). */
  prepared(request: CharacterRequest, ready: boolean): void {
    const key = requestKey(request);
    if (this.foregroundKey === key) this.foregroundKey = null;
    const item = this.itemFor(key);
    if (item) item.state = ready ? "r" : "q";
    if (item && !ready && this.job && !this.job.running && !this.job.stopped) this.start(this.job);
  }
  private itemFor(key: string): Item | undefined {
    for (const item of this.job?.items.values() ?? []) if (item.key === key) return item;
    return undefined;
  }

  private queued(job: Job, state: ChoiceFetchState) {
    return [...job.items.values()].filter(item => item.state === state).sort((a, b) => a.order - b.order);
  }

  /** Start a job's loop. The loop catches its own failures (PREV-101); this catch is the last resort. */
  private start(job: Job): void {
    this.startWatchdog(job);
    this.run(job).catch(error => this.fail(job, error));
  }
  /** An unexpected failure: stop the job, leave its remaining choices not prepared, report it once. */
  private fail(job: Job, error: unknown): void {
    this.stats.failed++;
    if (this.job === job) {
      job.stopped = "failed";
      for (const item of job.items.values()) if (item.state === "?" || item.state === "q" || item.state === "f") item.state = "n";
    }
    try {
      this.deps.log?.(`Preparing choices ahead stopped: ${messageOf(error)}`);
      this.deps.failed?.(error);
    } catch { /* Reporting must not end the host either. */ }
  }

  private startWatchdog(job: Job): void {
    const limit = this.limits.unpolledMs;
    if (!limit) return;
    this.stopWatchdog();
    const timer = setInterval(() => {
      if (this.job !== job) { if (this.watchdog === timer) this.stopWatchdog(); return; }
      if (this.unpolled(job)) this.stopUnpolled(job);
    }, Math.max(10, Math.min(limit / 4, 5_000)));
    (timer as { unref?: () => void }).unref?.();
    this.watchdog = timer;
  }
  private stopWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
  }
  private unpolled(job: Job): boolean {
    return !!this.limits.unpolledMs && this.now() - job.polledAt > this.limits.unpolledMs;
  }
  /** Nobody asks about the job any more: stop it (its batch in WolvenKit too). The next question starts afresh. */
  private stopUnpolled(job: Job): void {
    if (this.job !== job) return;
    this.stats.unpolled++;
    this.deps.log?.("Preparing choices ahead stopped: the Character panel stopped asking about them.");
    this.cancel();
  }

  private async run(job: Job): Promise<void> {
    job.running = true;
    const live = () => !job.controller.signal.aborted && this.job === job;
    try {
      while (live()) {
        // Find out which choices are ready already (a manifest check each; no game file is read).
        const unknown = this.queued(job, "?").slice(0, 64);
        let ready: (request: CharacterRequest) => boolean = () => false;
        if (unknown.length) {
          try { ready = await this.deps.readiness(); }
          catch (error) { this.deps.log?.(`Choices prepared earlier couldn't be checked; they are prepared again: ${messageOf(error)}`); }
          if (!live()) return;
        }
        for (const item of unknown) {
          try { item.request = await this.deps.requestFor(job.base, job.option, item.position); }
          catch (error) { item.request = null; this.deps.log?.(`A choice couldn't be looked up to prepare it ahead: ${messageOf(error)}`); }
          if (!live()) return;
          item.key = item.request ? requestKey(item.request) : null;
          // One unreadable manifest queues its choice; it never stops the job.
          let holds = false;
          if (item.request) { try { holds = ready(item.request); } catch { holds = false; } }
          item.state = !item.request ? "n" : item.key === this.foregroundKey ? "f" : holds ? "r" : "q";
        }
        if (this.queued(job, "?").length) continue;
        if (this.startBytes === null) this.startBytes = await this.deps.preparedBytes();
        if (!live()) return;
        if (this.unpolled(job)) { this.stopUnpolled(job); return; }
        await this.deps.foregroundIdle();
        if (!live()) return;
        if (this.now() - job.startedAt > this.limits.timeMs) { job.stopped = "time"; break; }
        if (this.deps.needsSetup?.()) { job.stopped = "setup"; break; }
        const size = Math.min(this.limits.maxBatch ?? this.limits.batch, this.limits.batch * 2 ** job.batches);
        const batch = this.queued(job, "q").slice(0, size);
        if (!batch.length) break;
        // Nothing awaits between the foreground check and here: a person's change that starts from now on finds this batch (`foreground`).
        const controller = new AbortController();
        const stop = () => controller.abort();
        job.controller.signal.addEventListener("abort", stop, { once: true });
        this.batch = controller;
        let settled!: () => void;
        const inflight = new Promise<void>(resolve => { settled = resolve; });
        this.inflight = inflight;
        for (const item of batch) item.state = "f";
        this.stats.batches++; job.batches++;
        let outcomes: readonly { ready: boolean }[] | null = null;
        try { outcomes = await this.deps.warm(batch.map(item => item.request!), controller.signal); }
        catch (error) {
          if (!controller.signal.aborted) {
            this.deps.log?.(`Preparing choices ahead failed: ${messageOf(error)}`);
            try { this.deps.failed?.(error); } catch { /* Reporting must not end the host. */ }
          }
        } finally {
          job.controller.signal.removeEventListener("abort", stop);
          if (this.batch === controller) this.batch = null;
          if (this.inflight === inflight) this.inflight = null;
          settled();
        }
        if (!live()) return;
        // Stopped for a person's own change: queued again, unless that change prepared it meanwhile.
        if (!outcomes) {
          for (const item of batch) if (item.state === "f" && item.key !== this.foregroundKey) item.state = controller.signal.aborted ? "q" : "x";
          continue;
        }
        batch.forEach((item, index) => { if (item.state === "f") item.state = outcomes![index]?.ready ? "r" : "x"; });
        this.stats.warmed += batch.length;
        await this.deps.afterBatch?.();
        if (await this.deps.preparedBytes() - this.startBytes > this.limits.bytes) { this.spent = true; job.stopped = "disk"; break; }
      }
      if (job.stopped) for (const item of job.items.values()) if (item.state === "q" || item.state === "?") item.state = "n";
    } catch (error) {
      this.fail(job, error);
    } finally {
      job.running = false;
      // Nothing left to do: the watchdog has nothing to guard until the job starts again.
      if (this.job === job && (job.stopped || ![...job.items.values()].some(item => item.state === "?" || item.state === "q"))) this.stopWatchdog();
    }
  }
}

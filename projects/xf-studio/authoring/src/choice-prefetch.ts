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
 * - **Batches.** Up to `batch` queued choices are prepared together (`warm`: each level of all their resource chains in one WolvenKit
 *   batch, their parts exported in one launch), at low priority.
 * - **A person's own change comes first.** While the host prepares a person's change the queue waits (`foregroundIdle`); a batch in
 *   WolvenKit when it starts is stopped (`pause`: its export launch is ended, reads already in WolvenKit finish and are kept), and its
 *   choices are queued again. A hover or focus hint (`focus`) moves a choice to the front of the queue; a click on it is the person's
 *   own change, shown as being prepared (`foreground`) and ready when it is (`prepared`).
 * - **Bounded.** A job stops after `timeMs`, and prefetching stops for the session once it has added `bytes` of prepared files; either
 *   leaves the remaining choices "not prepared" (the panel says why), and a click still prepares them.
 */
import type { CharacterRequest } from "./character-detail-request";
import { canonicalJson } from "./eye-plate-recipe";

export const CHOICE_PREFETCH_SCHEMA = "xfs/choice-prefetch-1" as const;
/**
 * `?` not known yet, `n` not prepared (not queued: the job stopped), `q` queued, `f` being prepared, `r` ready, `x` failed this time.
 * The page reads a string of these, one per position it asked about.
 */
export type ChoiceFetchState = "?" | "n" | "q" | "f" | "r" | "x";
export type PrefetchStop = "time" | "disk" | null;
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
  log?(message: string): void;
  now?(): number;
};
export type PrefetchLimits = { batch: number; timeMs: number; bytes: number };
export const PREFETCH_LIMITS: PrefetchLimits = { batch: 8, timeMs: 10 * 60_000, bytes: 2 * 1024 ** 3 };

type Item = { position: number; state: ChoiceFetchState; request: CharacterRequest | null; key: string | null; order: number };
type Job = { key: string; base: CharacterRequest; option: string; items: Map<number, Item>; controller: AbortController; startedAt: number;
  stopped: PrefetchStop; running: boolean; serial: number };

export const requestKey = (request: CharacterRequest) => canonicalJson(request);

export class ChoicePrefetcher {
  private job: Job | null = null;
  /** The batch in WolvenKit now, stopped when a person's own change starts (`pause`). */
  private batch: AbortController | null = null;
  /** Prepared-file bytes when this session's first prefetch began, and whether the session's byte budget is spent. */
  private startBytes: number | null = null;
  private spent = false;
  /** The request a person's own change is preparing now (its key), if any. */
  private foregroundKey: string | null = null;
  readonly stats = { batches: 0, warmed: 0, cancelled: 0 };

  constructor(private readonly deps: PrefetchDeps, private readonly limits: PrefetchLimits = PREFETCH_LIMITS) {}
  private now() { return this.deps.now?.() ?? Date.now(); }

  /** Start or update the job for a row and answer its states for `positions`. Never waits for preparation. */
  update(input: PrefetchInput): PrefetchAnswer {
    const key = `${requestKey(input.base)}\n${input.option}`;
    if (this.job?.key !== key) {
      this.cancel();
      this.job = { key, base: input.base, option: input.option, items: new Map(), controller: new AbortController(), startedAt: this.now(),
        stopped: this.spent ? "disk" : null, running: false, serial: 0 };
    }
    const job = this.job!;
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
    if (!job.running && !job.stopped && [...job.items.values()].some(item => item.state === "?" || item.state === "q")) void this.run(job);
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
    if (!job) return;
    job.controller.abort();
    this.batch?.abort();
    this.job = null;
    this.stats.cancelled++;
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
    if (item && !ready && this.job && !this.job.running && !this.job.stopped) void this.run(this.job);
  }
  private itemFor(key: string): Item | undefined {
    for (const item of this.job?.items.values() ?? []) if (item.key === key) return item;
    return undefined;
  }

  private queued(job: Job, state: ChoiceFetchState) {
    return [...job.items.values()].filter(item => item.state === state).sort((a, b) => a.order - b.order);
  }

  private async run(job: Job): Promise<void> {
    job.running = true;
    const live = () => !job.controller.signal.aborted && this.job === job;
    try {
      while (live()) {
        // Find out which choices are ready already (a manifest check each; no game file is read).
        const unknown = this.queued(job, "?").slice(0, 64);
        const ready = unknown.length ? await this.deps.readiness() : () => false;
        for (const item of unknown) {
          item.request = await this.deps.requestFor(job.base, job.option, item.position);
          if (!live()) return;
          item.key = item.request ? requestKey(item.request) : null;
          item.state = !item.request ? "n" : item.key === this.foregroundKey ? "f" : ready(item.request) ? "r" : "q";
        }
        if (this.queued(job, "?").length) continue;
        await this.deps.foregroundIdle();
        if (!live()) return;
        if (this.now() - job.startedAt > this.limits.timeMs) { job.stopped = "time"; break; }
        if (this.startBytes === null) this.startBytes = await this.deps.preparedBytes();
        const batch = this.queued(job, "q").slice(0, this.limits.batch);
        if (!batch.length) break;
        const controller = new AbortController();
        const stop = () => controller.abort();
        job.controller.signal.addEventListener("abort", stop, { once: true });
        this.batch = controller;
        for (const item of batch) item.state = "f";
        this.stats.batches++;
        let outcomes: readonly { ready: boolean }[] | null = null;
        try { outcomes = await this.deps.warm(batch.map(item => item.request!), controller.signal); }
        catch (error) {
          if (!controller.signal.aborted) this.deps.log?.(`Preparing choices ahead failed: ${(error as Error)?.message ?? error}`);
        } finally {
          job.controller.signal.removeEventListener("abort", stop);
          if (this.batch === controller) this.batch = null;
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
    } finally { job.running = false; }
  }
}

/**
 * Host application service: prepares a Character panel row's choices ahead of a click, in the background, so a first-time choice is
 * ready (well under a second) when it is clicked. DOM-free and file-free: the host supplies what it reads and does (`PrefetchDeps`).
 *
 * - **A job per open row, per requester.** The panel names the V (its request), the row's option and the positions of the choices it
 *   shows, visible ones first (`update`), and who asks (`requester`: one character's panel instance, profiles design §7). A different V
 *   or option replaces that requester's job only; closing its row cancels it (`cancel(requester)`). Each requester's job is its own want
 *   with the scheduler, so two characters' rows never supersede each other. Each choice's request is the V with that choice set
 *   (`requestFor`).
 * - **Admitted fairly.** At most `PREFETCH_REQUESTERS` jobs run at once; a requester beyond them waits its turn, nothing is cancelled for
 *   it. Between completed units (a check or a batch), a running job whose requesters are waiting yields its place to the longest waiting
 *   one and joins the end of the line, keeping everything it has done. A place belongs to the job itself, not its requester: the end of a
 *   cancelled job's loop never touches the place of the job that replaced it.
 * - **States** per choice, as one compact string (one character each, `ChoiceFetchState`): not known yet, not prepared, queued, being
 *   prepared, ready, or failed. A choice whose manifest holds (choice-manifest.ts) is ready at once, in this session or a later one;
 *   the rest are queued in the panel's order.
 * - **Batches.** Queued choices are prepared together (`warm`: each level of all their resource chains in one WolvenKit batch, their
 *   parts exported in one launch), at low priority: a small first batch, so the choices in view come back soon, then larger ones.
 * - **Scheduled as work prepared ahead.** Each readiness check and each batch is an `ahead` job of the host's scheduler
 *   (platform/core/jobs.ts; one want at a time, `requester`): it starts only while no person's change waits or runs and the host has
 *   been quiet a moment, after a stopped batch's reads have let go (`afterwards`, PREV-120), and one at a time with the host's other
 *   work, so repeated clicks never pile up background preparations; a stopped batch doesn't grow the next one.
 * - **A person's own change comes first.** A person's change stops a batch in WolvenKit (the scheduler's rule, and `pause`: its export
 *   launch is ended, reads already in WolvenKit finish and are kept), and its choices are queued again; checks wait at their next turn.
 *   A hover or focus hint (`focus`) moves a choice to the front of the queue; a click on it is the person's own change, shown as being
 *   prepared (`foreground`) and ready when it is (`prepared`). A batch takes its choices from the queue only as it starts, so a change
 *   prepared meanwhile isn't prepared again.
 * - **Settles before a person's change.** A stopped batch's run returns before the person's change starts (`idle` resolves then), and
 *   Clear starts only after its reads have let go (PREV-102).
 * - **Bounded.** A job stops after `timeMs` of its own work (time spent waiting for a person's change or for a stopped batch isn't
 *   counted), and prefetching stops for the session once it has added `bytes` of prepared files; either
 *   leaves the remaining choices "not prepared" (the panel says why), and a click still prepares them. The byte budget is the session's:
 *   once spent, every job stops before its next batch. "Clear prepared game files"
 *   starts the session's byte budget again (`resetBudget`, PREV-104). A job nobody has asked about for `unpolledMs` (the page closed or
 *   went away: its lease ran out) is stopped, its batch in WolvenKit too (PREV-105); asking again starts it afresh.
 * - **Never ends the host.** Background work has nobody to report to: an unexpected failure (a dependency throwing, a damaged manifest)
 *   stops the job, leaves its remaining choices "not prepared", and is reported once through `failed` (PREV-101). A choice whose
 *   readiness can't be checked is queued; one whose request can't be made is not prepared.
 * - **Never holds the host up.** Checking which choices are ready gives the event loop a turn between choices (the job's `turn`), so a
 *   person's own change, a poll and every other request are answered while a row's choices are checked.
 */
import type { CharacterRequest } from "./character-detail-request";
import { canonicalJson } from "../legacy/eye-makeup/plate/eye-plate-recipe";
import { hostClock, type Clock } from "../platform/core/clock";
import { lease, type JobContext, type JobScheduler, type RunOutcome } from "../platform/core/jobs";

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
/** `requester`: who asks (a character's panel instance); absent, the page's one requester. */
export type PrefetchInput = { base: CharacterRequest; option: string; positions: readonly number[]; focus?: number | null; requester?: string };
/** Jobs that run at once; more requesters wait their turn. */
export const PREFETCH_REQUESTERS = 8;
/** Jobs held at all (running and waiting); one more stops the job asked about least recently. */
export const PREFETCH_JOBS = 64;
export type PrefetchDeps = {
  /** The host's scheduler: each readiness check and batch is one of its `ahead` jobs. */
  jobs: JobScheduler;
  /** The prefetcher's name with the scheduler (default `prefetch`); each requester's job wants as `<name>/<requester>`. */
  requester?: string;
  /** The V with one choice of the option set, or null when the installed catalogue doesn't offer it. */
  requestFor(base: CharacterRequest, option: string, position: number): Promise<CharacterRequest | null>;
  /**
   * A check of whether a request is ready now (its manifest holds), on the installation as it is now; long checks take the job's turn
   * between their units (choice-manifest.ts `manifestProblemSliced`).
   */
  readiness(context: JobContext): Promise<(request: CharacterRequest) => boolean | Promise<boolean>>;
  /**
   * Prepare several requests ahead (character-detail-service.ts `warmCharacters`); per request, whether it is ready. A stopped batch
   * answers at once, so a person's own change isn't held up by reads already in WolvenKit, and hands those reads to `afterwards`.
   */
  warm(requests: readonly CharacterRequest[], context: JobContext): Promise<readonly { ready: boolean }[]>;
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
  /** The clock of the job's lease (default the host's). */
  clock?: Clock;
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
type Job = { requester: string; key: string; base: CharacterRequest; option: string; items: Map<number, Item>; controller: AbortController; startedAt: number;
  stopped: PrefetchStop; running: boolean; serial: number;
  /** What the job wants of the scheduler now: a readiness check or a batch (a person's change stops only a batch, `pause`). */
  current: "check" | "batch" | null;
  /** While it runs: its lease, renewed by each question about it, which stops the job once nobody asks (PREV-105). */
  lease: { renew(): void; end: AbortController } | null;
  /** Batches that ran to the end (a stopped batch doesn't grow the next one, PREV-120). */
  batches: number;
  /** Time the job spent waiting for a person's change or for a stopped batch to settle: not counted toward `timeMs` (PREV-120). */
  pausedMs: number };

export const requestKey = (request: CharacterRequest) => canonicalJson(request);
/** A request without the choices of one option (`part/name`). */
export function withoutOption(request: CharacterRequest, option: string): CharacterRequest {
  const choices = (request.choices ?? []).filter(choice => `${choice.part}/${choice.option}` !== option);
  const { choices: _all, ...rest } = request;
  return (choices.length ? { ...rest, choices } : rest) as CharacterRequest;
}
const messageOf = (error: unknown) => (error as Error)?.message ?? String(error);
/** `work`'s answer, or a stop as soon as the job is stopped; `work` itself goes on as the job's tail. */
function untilStopped<T>(work: Promise<T>, context: JobContext): Promise<T> {
  context.afterwards(work);
  if (context.signal.aborted) return Promise.reject(new Error("Stopped."));
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new Error("Stopped."));
    context.signal.addEventListener("abort", stop, { once: true });
    work.then(value => { context.signal.removeEventListener("abort", stop); resolve(value); },
      error => { context.signal.removeEventListener("abort", stop); reject(error); });
  });
}

export class ChoicePrefetcher {
  /** Each requester's job, the one asked about least recently first. */
  private jobs = new Map<string, Job>();
  /** The jobs that may run now, and those waiting their turn (longest waiting first): each place is held by the job itself. */
  private readonly admitted = new Set<Job>();
  private waiting: Job[] = [];
  /** Prepared-file bytes when this session's first prefetch began, and whether the session's byte budget is spent. */
  private startBytes: number | null = null;
  private spent = false;
  /** The request a person's own change is preparing now (its key), if any. */
  private foregroundKey: string | null = null;
  /** The batch being prepared now (its run started and hasn't returned), as a promise that never rejects: what `idle` waits for. */
  private inflight: Promise<void> | null = null;
  private serial = 0;
  /** `peak`: most jobs running at once (their loops, among the jobs held). */
  readonly stats = { batches: 0, warmed: 0, cancelled: 0, failed: 0, unpolled: 0, peak: 0 };

  constructor(private readonly deps: PrefetchDeps, private readonly limits: PrefetchLimits = PREFETCH_LIMITS) {}
  private now() { return this.deps.now?.() ?? Date.now(); }
  /** A requester's name with the scheduler. */
  private wantName(requester: string) { const name = this.deps.requester ?? "prefetch"; return requester ? `${name}/${requester}` : name; }
  private live(job: Job) { return !job.controller.signal.aborted && this.jobs.get(job.requester) === job; }

  /** Start or update the job for a row and answer its states for `positions`. Never waits for preparation. */
  update(input: PrefetchInput): PrefetchAnswer {
    // The V without the row's own choice: choosing in the row doesn't start its job again (each choice's request replaces it).
    const base = withoutOption(input.base, input.option), key = `${requestKey(base)}\n${input.option}`, requester = input.requester ?? "";
    let job = this.jobs.get(requester);
    if (job?.key !== key) {
      this.cancel(requester);
      // Bounded: past every job the host holds, the one asked about least recently stops (it asks again if it still wants it).
      while (this.jobs.size >= PREFETCH_JOBS) this.cancel(this.jobs.keys().next().value!);
      job = { requester, key, base, option: input.option, items: new Map(), controller: new AbortController(), startedAt: this.now(),
        stopped: this.spent ? "disk" : null, running: false, serial: 0, batches: 0, pausedMs: 0, current: null, lease: null };
    }
    // Asked about now: the newest in the order the bound stops them.
    this.jobs.delete(requester);
    this.jobs.set(requester, job);
    job.lease?.renew();
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

  /** Closing a requester's row: stop its job (a batch in WolvenKit is stopped too). Without a requester, every job stops. */
  cancel(requester?: string): void {
    if (requester === undefined) { for (const name of [...this.jobs.keys()]) this.cancel(name); return; }
    const job = this.jobs.get(requester);
    if (!job) return;
    this.endLease(job);
    job.controller.abort();
    this.deps.jobs.release(this.wantName(requester));
    job.current = null;
    this.jobs.delete(requester);
    this.stats.cancelled++;
    this.vacate(job);
  }
  /** A job doesn't run any more: its place (its own, never its replacement's) goes to the longest waiting job with work. */
  private vacate(job: Job): void {
    this.admitted.delete(job);
    this.waiting = this.waiting.filter(other => other !== job);
    this.admitNext();
  }
  private admitNext(): void {
    while (this.admitted.size < PREFETCH_REQUESTERS && this.waiting.length) {
      const next = this.waiting.shift()!;
      if (this.jobs.get(next.requester) === next && !next.running && !next.stopped && this.hasWork(next)) this.start(next);
    }
  }
  private hasWork(job: Job) { return [...job.items.values()].some(item => item.state === "?" || item.state === "q"); }
  /** The session's byte budget is spent: every job stops before its next batch, and a batch waiting to start doesn't. */
  private exhaust(): void {
    this.spent = true;
    for (const job of this.jobs.values()) {
      if (job.stopped) continue;
      job.stopped = "disk";
      for (const item of job.items.values()) if (item.state === "q" || item.state === "?") item.state = "n";
      if (job.current === "batch") this.deps.jobs.release(this.wantName(job.requester));
    }
    for (const job of [...this.admitted]) if (!job.running) this.vacate(job);
  }

  /**
   * A choice's state in the current job, when the job is the row `option` on the V `base` (choice previews derive a source only from a
   * ready choice); `?` otherwise.
   */
  stateOf(base: CharacterRequest, option: string, position: number): ChoiceFetchState {
    const key = `${requestKey(withoutOption(base, option))}\n${option}`;
    for (const job of this.jobs.values()) if (job.key === key && job.items.has(position)) return job.items.get(position)!.state;
    return "?";
  }
  /** A job still has choices to check or prepare (other background work gives it a turn). */
  get pending(): boolean {
    return [...this.jobs.values()].some(job => !job.stopped && [...job.items.values()].some(item => item.state === "?" || item.state === "q"));
  }
  /** A batch is being prepared (its run started and hasn't returned yet). */
  get preparing(): boolean { return this.inflight !== null; }
  /** Resolves once no batch is being prepared (a stopped one has returned). Never rejects. */
  async idle(): Promise<void> {
    while (this.inflight) await this.inflight;
  }
  /** "Clear prepared game files": the session's byte budget starts again, so preparing ahead can run again (PREV-104). */
  resetBudget(): void {
    this.startBytes = null;
    this.spent = false;
  }

  /**
   * A person is waiting on the host (their change was asked for, prepared or not): stop the batch being prepared ahead (or about to
   * start); its choices are queued again, and the reads it already started finish and are kept. The next batch starts once the host is
   * quiet (the scheduler's rule).
   */
  pause(): void { this.stopBatch(); }
  private stopBatch(): void { for (const job of this.jobs.values()) if (job.current === "batch") this.deps.jobs.release(this.wantName(job.requester)); }
  /** A person's own change starts: stop the batch (its choices are queued again); the change's choice shows as being prepared. */
  foreground(request: CharacterRequest): void {
    this.foregroundKey = requestKey(request);
    this.stopBatch();
    for (const item of this.itemsFor(this.foregroundKey)) if (item.state !== "r") item.state = "f";
  }
  /** A person's own change was prepared (`ready`: fully, so it is ready from now on). */
  prepared(request: CharacterRequest, ready: boolean): void {
    const key = requestKey(request);
    if (this.foregroundKey === key) this.foregroundKey = null;
    for (const job of [...this.jobs.values()]) {
      const items = [...job.items.values()].filter(item => item.key === key);
      for (const item of items) item.state = ready ? "r" : "q";
      if (items.length && !ready && !job.running && !job.stopped) this.start(job);
    }
  }
  private itemsFor(key: string): Item[] {
    return [...this.jobs.values()].flatMap(job => [...job.items.values()].filter(item => item.key === key));
  }

  private queued(job: Job, state: ChoiceFetchState) {
    return [...job.items.values()].filter(item => item.state === state).sort((a, b) => a.order - b.order);
  }

  /** Start a job's loop once it has a place (otherwise it waits its turn). The loop catches its own failures (PREV-101); this catch is the last resort. */
  private start(job: Job): void {
    if (!job.lease) this.startLease(job);
    if (job.running) return;
    if (!this.admitted.has(job)) {
      if (this.admitted.size >= PREFETCH_REQUESTERS) { if (!this.waiting.includes(job)) this.waiting.push(job); return; }
      this.admitted.add(job);
    }
    this.run(job).catch(error => this.fail(job, error));
  }
  /** An unexpected failure: stop the job, leave its remaining choices not prepared, report it once. */
  private fail(job: Job, error: unknown): void {
    this.stats.failed++;
    if (this.jobs.get(job.requester) === job) {
      job.stopped = "failed";
      for (const item of job.items.values()) if (item.state === "?" || item.state === "q" || item.state === "f") item.state = "n";
    }
    try {
      this.deps.log?.(`Preparing choices ahead stopped: ${messageOf(error)}`);
      this.deps.failed?.(error);
    } catch { /* Reporting must not end the host either. */ }
  }

  /** A job nobody has asked about for `unpolledMs` is stopped, its batch in WolvenKit too (PREV-105): the page's lease on it. */
  private startLease(job: Job): void {
    const limit = this.limits.unpolledMs;
    if (!limit) return;
    this.endLease(job);
    const end = new AbortController();
    const held = lease(this.deps.clock ?? hostClock(), limit, end.signal);
    held.signal.addEventListener("abort", () => { if (job.lease?.end === end) this.stopUnpolled(job); }, { once: true });
    job.lease = { renew: held.renew, end };
  }
  private endLease(job: Job): void {
    job.lease?.end.abort();
    job.lease = null;
  }
  /** Nobody asks about the job any more: stop it (its batch in WolvenKit too). The next question starts afresh. */
  private stopUnpolled(job: Job): void {
    if (this.jobs.get(job.requester) !== job) return;
    this.stats.unpolled++;
    this.deps.log?.("Preparing choices ahead stopped: the Character panel stopped asking about them.");
    this.cancel(job.requester);
  }

  /** Wants one unit of the job's work of the scheduler (work prepared ahead) and answers how it ended. */
  private async unit<T>(job: Job, kind: "check" | "batch", run: (context: JobContext) => Promise<T>): Promise<RunOutcome<T>> {
    job.current = kind;
    const want = this.deps.jobs.want(this.wantName(job.requester), { key: `prefetch:${kind}:${++this.serial}`, lane: "ahead", run });
    try { return await want.settled; } finally { if (job.current === kind) job.current = null; }
  }

  /** Which of `items` are ready already (a manifest check each; no game file is read), a turn between choices. */
  private check(job: Job, items: readonly Item[], live: () => boolean): Promise<RunOutcome<void>> {
    return this.unit(job, "check", async context => {
      let ready: (request: CharacterRequest) => boolean | Promise<boolean> = () => false;
      try { ready = await this.deps.readiness(context); }
      catch (error) {
        // Stopped while it opened what it checks against: checked again later, never taken as not prepared.
        if (context.signal.aborted) return;
        this.deps.log?.(`Choices prepared earlier couldn't be checked; they are prepared again: ${messageOf(error)}`);
      }
      // Stopped (a person's change), the check lets go at once: a lookup under way (the catalogue being built) goes on as the job's tail,
      // and nothing it answers is written into the choices' states.
      const stopped = () => context.signal.aborted || !live();
      if (stopped()) return;
      for (const item of items) {
        if (stopped()) return;
        if (item.state !== "?") continue;
        let request: CharacterRequest | null;
        try { request = await untilStopped(this.deps.requestFor(job.base, job.option, item.position), context); }
        catch (error) {
          if (stopped()) return;
          request = null; this.deps.log?.(`A choice couldn't be looked up to prepare it ahead: ${messageOf(error)}`);
        }
        if (stopped()) return;
        // One unreadable manifest queues its choice; it never stops the job.
        let holds = false;
        if (request) { try { holds = await untilStopped(Promise.resolve(ready(request)), context); } catch { holds = false; } }
        if (stopped()) return;
        if (item.state !== "?") continue;
        item.request = request;
        item.key = request ? requestKey(request) : null;
        item.state = !request ? "n" : item.key === this.foregroundKey ? "f" : holds ? "r" : "q";
        await context.turn();
      }
    });
  }

  private async run(job: Job): Promise<void> {
    job.running = true;
    this.stats.peak = Math.max(this.stats.peak, [...this.jobs.values()].filter(other => other.running).length);
    const live = () => this.live(job);
    let units = 0, yielded = false;
    try {
      while (live() && !job.stopped) {
        // Between completed units: a waiting requester takes this job's place, and this one waits its turn again with what it has done.
        if (units && this.waiting.length) {
          yielded = true;
          this.admitted.delete(job);
          this.waiting.push(job);
          return;
        }
        const unknown = this.queued(job, "?").slice(0, 64);
        if (unknown.length) {
          const checked = await this.check(job, unknown, live);
          if (!live()) return;
          if (checked.status === "failed") throw checked.error;
          units++;
          continue;
        }
        if (this.startBytes === null) this.startBytes = await this.deps.preparedBytes();
        if (!live()) return;
        if (this.now() - job.startedAt - job.pausedMs > this.limits.timeMs) { job.stopped = "time"; break; }
        // The session's byte budget, spent by any job, stops this one before its next batch.
        if (this.spent) { job.stopped = "disk"; break; }
        if (this.deps.needsSetup?.()) { job.stopped = "setup"; break; }
        if (!this.queued(job, "q").length) break;
        const size = Math.min(this.limits.maxBatch ?? this.limits.batch, this.limits.batch * 2 ** job.batches);
        // The scheduler starts the batch once no person's change waits or runs, the host has been quiet a moment and a stopped batch's
        // reads have let go (PREV-120); the wait isn't the job's own time. The batch is taken from the queue as it starts, so a change
        // prepared meanwhile isn't prepared again.
        const asked = this.now();
        let batch: Item[] = [], began = 0, answered: readonly { ready: boolean }[] | null = null;
        const ended = await this.unit(job, "batch", async context => {
          began = this.now();
          job.pausedMs += began - asked;
          batch = this.queued(job, "q").slice(0, size);
          if (!batch.length || !live()) return [];
          for (const item of batch) item.state = "f";
          this.stats.batches++;
          let settled!: () => void;
          const inflight = this.inflight = new Promise<void>(resolve => { settled = resolve; });
          try { return answered = await this.deps.warm(batch.map(item => item.request!), context); }
          finally { if (this.inflight === inflight) this.inflight = null; settled(); }
        });
        if (!live()) return;
        // A batch stopped after its preparation had finished anyway: what it prepared is kept, not prepared again.
        const outcome: RunOutcome<readonly { ready: boolean }[]> = ended.status === "superseded" && answered ? { status: "done", result: answered } : ended;
        if (outcome.status !== "done") {
          if (outcome.status === "failed") {
            this.deps.log?.(`Preparing choices ahead failed: ${messageOf(outcome.error)}`);
            try { this.deps.failed?.(outcome.error); } catch { /* Reporting must not end the host. */ }
          }
          // Stopped for a person's change: queued again, unless that change prepared it meanwhile. A stopped batch's time was a person's
          // (it is prepared again later) and it doesn't grow the next batch.
          if (outcome.status === "superseded" && began) job.pausedMs += this.now() - began;
          for (const item of batch) if (item.state === "f" && item.key !== this.foregroundKey) item.state = outcome.status === "superseded" ? "q" : "x";
          continue;
        }
        if (!batch.length) continue;
        units++;
        job.batches++;
        const outcomes = outcome.result;
        batch.forEach((item, index) => { if (item.state === "f") item.state = outcomes[index]?.ready ? "r" : "x"; });
        this.stats.warmed += batch.length;
        await this.deps.afterBatch?.();
        if (await this.deps.preparedBytes() - this.startBytes > this.limits.bytes) { this.exhaust(); break; }
      }
      if (job.stopped) for (const item of job.items.values()) if (item.state === "q" || item.state === "?") item.state = "n";
    } catch (error) {
      this.fail(job, error);
    } finally {
      job.running = false;
      // Its place goes to the longest waiting job (it yielded and waits again, or is done). A cancelled job's place went at its cancel.
      if (yielded) this.admitNext();
      else if (this.admitted.has(job) && (job.stopped || !this.hasWork(job) || this.jobs.get(job.requester) !== job)) this.vacate(job);
      // Nothing left to do: the lease has nothing to guard until the job starts again.
      if (this.jobs.get(job.requester) === job && (job.stopped || ![...job.items.values()].some(item => item.state === "?" || item.state === "q"))) this.endLease(job);
    }
  }
}

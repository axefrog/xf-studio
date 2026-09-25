/**
 * One polled, read-only host state: the renderer side of a host service whose work runs on the
 * host (3D preview preparation, the WolvenKit download). It sends typed requests, validates each
 * detached state, polls while the host reports work in progress and, when a poll fails while work
 * was last known to be running, keeps polling with backoff instead of stopping for good. Failed
 * requests are counted and published, so a view can say that contact was lost and is being
 * retried; the first valid reply clears them. Shared by the preparation and WolvenKit ports.
 */
export type HostTransport<Request> = (request: Request) => Promise<{ ok: boolean; data: unknown }>;
export type HostOutcome = { ok: true } | { ok: false; message: string };
/** Contact with the host service: consecutive failed requests, and whether a retry is scheduled. */
export type HostConnection = { failures: number; retrying: boolean; message: string | null };
export type HostTimers = { set(run: () => void, ms: number): unknown; clear(handle: unknown): void };

export type PolledHostOptions<State, Request> = {
  transport: HostTransport<Request>;
  isState(value: unknown): value is State;
  /** Whether the host is working in this state, so the state is polled. */
  working(state: State): boolean;
  /** The read-only request used to poll. */
  refresh: Request;
  pollMs: number;
  /** Longest wait between retries after failed polls. */
  maxRetryMs?: number;
  /** Plain wording for a reply that isn't a state, and for no reply at all. */
  messages: { invalid: string; unreachable: string };
  timers?: HostTimers;
};

const DEFAULT_TIMERS: HostTimers = { set: (run, ms) => setTimeout(run, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };

export class PolledHostState<State extends { message: string }, Request> {
  private state: State | null = null;
  private contact: HostConnection = { failures: 0, retrying: false, message: null };
  private listeners = new Set<() => void>();
  private timer: unknown = null;
  private readonly timers: HostTimers;
  constructor(private readonly options: PolledHostOptions<State, Request>) {
    this.timers = options.timers ?? DEFAULT_TIMERS;
  }
  snapshot(): State | null { return this.state && structuredClone(this.state); }
  connection(): HostConnection { return { ...this.contact }; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  async request(request: Request): Promise<HostOutcome> {
    let response: { ok: boolean; data: unknown };
    try { response = await this.options.transport(request); }
    catch { return this.failed(this.options.messages.unreachable); }
    if (!this.options.isState(response.data)) return this.failed(this.options.messages.invalid);
    this.contact = { failures: 0, retrying: false, message: null };
    this.state = response.data;
    this.schedule(this.options.working(response.data) ? this.options.pollMs : null);
    this.notify();
    return response.ok ? { ok: true } : { ok: false, message: response.data.message };
  }

  /** A failed request keeps polling while the last known state was still working. */
  private failed(message: string): HostOutcome {
    const failures = this.contact.failures + 1;
    const retrying = !!this.state && this.options.working(this.state);
    this.contact = { failures, retrying, message };
    this.schedule(retrying ? Math.min(this.options.maxRetryMs ?? 8_000, this.options.pollMs * 2 ** Math.min(failures, 8)) : null);
    this.notify();
    return { ok: false, message };
  }
  private schedule(ms: number | null) {
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null; }
    if (ms !== null) this.timer = this.timers.set(() => { this.timer = null; void this.request(this.options.refresh); }, ms);
  }
  private notify() { for (const listener of this.listeners) listener(); }
  dispose() { this.schedule(null); this.listeners.clear(); }
}

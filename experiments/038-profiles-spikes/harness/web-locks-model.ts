/**
 * The browser's side of the localhost lease harness: one browser profile holding the Web Locks (exclusive mode, as the lease uses
 * them) for several windows, each a worker. A lock is granted to one window at a time, in request order; `ifAvailable` answers
 * null at once when it is held; a waiting request can be aborted; and a lock goes only when its holder lets it go or its window
 * ends (`ended`), as the Web Locks standard says. The window side is `locksProxy`, a `LockManager.request` over messages.
 */
export type LockMessage =
  | { op: "lock"; id: number; name: string; ifAvailable: boolean }
  | { op: "unlock"; id: number }
  | { op: "abort"; id: number };
export type LockAnswer = { op: "lock-granted" | "lock-unavailable" | "lock-aborted"; id: number };

type Request = { window: string; id: number };

export class WebLocksModel {
  private readonly held = new Map<string, Request>();
  private readonly queues = new Map<string, Request[]>();
  constructor(private readonly answer: (window: string, message: LockAnswer) => void) {}
  holder(name: string): string | null { return this.held.get(name)?.window ?? null; }
  message(window: string, message: LockMessage) {
    if (message.op === "lock") {
      const request = { window, id: message.id }, queue = this.queues.get(message.name) ?? [];
      if (!this.held.has(message.name) && !queue.length) { this.held.set(message.name, request); this.answer(window, { op: "lock-granted", id: message.id }); }
      else if (message.ifAvailable) this.answer(window, { op: "lock-unavailable", id: message.id });
      else this.queues.set(message.name, [...queue, request]);
    } else if (message.op === "unlock") {
      for (const [name, request] of this.held) if (request.window === window && request.id === message.id) { this.held.delete(name); this.next(name); }
    } else {
      for (const [name, queue] of this.queues) {
        const kept = queue.filter(request => !(request.window === window && request.id === message.id));
        if (kept.length !== queue.length) { this.queues.set(name, kept); this.answer(window, { op: "lock-aborted", id: message.id }); }
      }
    }
  }
  /** The window ended (closed, crashed or killed): its queued requests go, and so do its locks. */
  ended(window: string) {
    for (const [name, queue] of this.queues) this.queues.set(name, queue.filter(request => request.window !== window));
    for (const [name, request] of [...this.held]) if (request.window === window) { this.held.delete(name); this.next(name); }
  }
  private next(name: string) {
    const queue = this.queues.get(name) ?? [], next = queue.shift();
    if (!next) return;
    this.held.set(name, next);
    this.answer(next.window, { op: "lock-granted", id: next.id });
  }
}

/** The window's `LockManager.request` (exclusive mode) over `post`; `deliver` takes the browser's answers. */
export function locksProxy(post: (message: LockMessage) => void) {
  let next = 0;
  const pending = new Map<number, { callback(lock: Lock | null): unknown; resolve(value: unknown): void; reject(error: unknown): void; name: string }>();
  const manager = {
    request(name: string, options: LockOptions | ((lock: Lock | null) => unknown), maybe?: (lock: Lock | null) => unknown): Promise<any> {
      const callback = (typeof options === "function" ? options : maybe)!, settings = typeof options === "function" ? {} : options;
      const id = ++next;
      return new Promise((resolve, reject) => {
        pending.set(id, { callback, resolve, reject, name });
        settings.signal?.addEventListener("abort", () => post({ op: "abort", id }), { once: true });
        post({ op: "lock", id, name, ifAvailable: !!settings.ifAvailable });
      });
    },
  };
  return {
    manager: manager as unknown as Pick<LockManager, "request">,
    deliver(answer: LockAnswer) {
      const request = pending.get(answer.id);
      if (!request) return;
      if (answer.op === "lock-aborted") { pending.delete(answer.id); request.reject(new DOMException("The request was aborted.", "AbortError")); return; }
      const granted = answer.op === "lock-granted";
      if (!granted) pending.delete(answer.id);
      Promise.resolve().then(() => request.callback(granted ? { name: request.name, mode: "exclusive" } as Lock : null)).then(
        value => { if (granted) { pending.delete(answer.id); post({ op: "unlock", id: answer.id }); } request.resolve(value); },
        error => { if (granted) { pending.delete(answer.id); post({ op: "unlock", id: answer.id }); } request.reject(error); });
    },
  };
}

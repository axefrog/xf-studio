/**
 * The page's diagnostics device (docs/diagnostics.md): traps uncaught errors and unhandled rejections (a lost WebGL context comes
 * from the scene host, through the composition root), notes
 * the error reference of a failed host request (`X-XFS-Error-Ref`), forwards the page's failures to the host log in small batches
 * (bounded and rate-limited; the waiting queue is bounded too, and what can't be sent stays in a ring buffer), reads the page's
 * facts (browser, GPU), and does the report's clipboard, download and issue-page work. Only the composition root constructs it.
 */
import type { DiagnosticsActions, DiagnosticsDevice, DiagnosticsMode } from "../actions";
import { diagnosticEntry, DIAGNOSTIC_FORWARD_SCHEMA, DIAGNOSTIC_LIMITS, isErrorRef, type DiagnosticEntry } from "../model";
import { ISSUE_BASE, ISSUE_URL_LIMIT, type PageFacts, type ReportManifest } from "../report";

const ERROR_REF_HEADER = "X-XFS-Error-Ref";
/** A notice takes a failed host request's reference only this soon after the answer, so an unrelated later notice doesn't (DIAG-12). */
const HOST_REF_MS = 3_000;
/** Entries waiting to be forwarded; beyond this the oldest are dropped and counted in one line (DIAG-07). */
export const PAGE_QUEUE = 2 * DIAGNOSTIC_LIMITS.ring;
const UNREACHABLE = "XF Studio couldn't get the report ready. Try again in a moment.";

export type BrowserDiagnosticsOptions = {
  window: Window & typeof globalThis;
  /** `/api/diagnostics` on both hosts. */
  endpoint?: string;
  download(blob: Blob, name: string): void;
  signal?: AbortSignal;
};

/** A plain browser name and version from the user agent (the desktop's WebView2 reports its Edge version). */
export function browserName(userAgent: string): string {
  const edge = /Edg\/([\d.]+)/.exec(userAgent), chrome = /Chrome\/([\d.]+)/.exec(userAgent), firefox = /Firefox\/([\d.]+)/.exec(userAgent);
  const safari = /Version\/([\d.]+).*Safari/.exec(userAgent);
  const os = /Windows NT ([\d.]+)/.exec(userAgent)?.[1], system = os ? `Windows NT ${os}` : /Mac OS X|Linux|Android/.exec(userAgent)?.[0] ?? "unknown system";
  const name = edge ? `Microsoft Edge ${edge[1]}` : chrome ? `Chrome ${chrome[1]}` : firefox ? `Firefox ${firefox[1]}` : safari ? `Safari ${safari[1]}` : "an unrecognised browser";
  return `${name} on ${system}`;
}

export function createBrowserDiagnostics(options: BrowserDiagnosticsOptions) {
  const win = options.window, endpoint = options.endpoint ?? "/api/diagnostics";
  const life = new AbortController(), originalSend = win.fetch.bind(win);
  const send = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    life.signal.throwIfAborted();
    const signal = init?.signal ? AbortSignal.any([life.signal, init.signal]) : life.signal;
    const response = await originalSend(input, { ...init, signal });
    signal.throwIfAborted();
    return response;
  };
  let uninstall: (() => void) | undefined;
  let queue: DiagnosticEntry[] = [], ring: DiagnosticEntry[] = [], timer: ReturnType<typeof setTimeout> | null = null;
  let closing = false;
  const deliveries = new Set<DiagnosticEntry[]>();
  let windowStart = 0, sentInWindow = 0, droppedFromQueue = 0;
  const hostRefs: { ref: string; at: number; claimed: boolean }[] = [];
  let gpu: { renderer: string | null; webgl2: boolean } | null = null;

  const keep = (entries: DiagnosticEntry[]) => {
    const kept = [...ring, ...entries];
    // Once admission closes there can be no further growth beyond the already accepted queue and batch.
    ring = closing ? kept : kept.slice(-DIAGNOSTIC_LIMITS.ring);
  };
  /** A POST is on its way: the next flush waits for it, and `again` asks for one as soon as it ends (DIAG-07). */
  let flushing = false, again = false;
  const noteDropped = () => {
    if (!droppedFromQueue) return;
    queue.unshift(diagnosticEntry({ level: "warn", area: "page", code: "entries_dropped", origin: "page",
      message: "The window noticed more problems than it could pass on; the oldest were left out.", details: { count: droppedFromQueue } }));
    droppedFromQueue = 0;
  };
  async function deliver(batch: DiagnosticEntry[]) {
    deliveries.add(batch);
    try {
      // Logs already accepted have their own delivery lifetime. Never attach the report/read abort signal.
      const response = await originalSend(`${endpoint}/entries`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema: DIAGNOSTIC_FORWARD_SCHEMA, entries: batch }), keepalive: true });
      // Normal malformed batches retain their existing refusal policy; shutdown preserves every refused handoff.
      if (!response.ok && (closing || response.status >= 500)) throw Error(String(response.status));
    } catch { keep(batch); }
    finally { deliveries.delete(batch); }
  }
  /**
   * Send the next batch. One at a time: entries forwarded while a batch is on its way stay queued behind it (never overwritten by
   * what the flush took), and a flush asked for meanwhile runs when it ends (DIAG-07).
   */
  async function flush() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (closing) return;
    if (flushing) { again = true; return; }
    flushing = true;
    try {
      noteDropped();
      // What couldn't be sent earlier goes first, once the host answers again. The rest stays queued, and anything forwarded during
      // the request joins it.
      const waiting = [...ring, ...queue];
      const batch = waiting.slice(0, DIAGNOSTIC_LIMITS.batch);
      ring = []; queue = waiting.slice(DIAGNOSTIC_LIMITS.batch);
      if (!batch.length) return;
      const now = Date.now();
      if (now - windowStart > 60_000) { windowStart = now; sentInWindow = 0; }
      if (sentInWindow + batch.length > DIAGNOSTIC_LIMITS.perMinute) { keep(batch); schedule(10_000); return; }
      sentInWindow += batch.length;
      await deliver(batch);
      if (queue.length) schedule(again ? 0 : 250);
    } finally {
      flushing = false;
      if (again) { again = false; if (queue.length) schedule(0); }
    }
  }
  const schedule = (ms = 250) => { if (!closing && !life.signal.aborted && timer === null) timer = setTimeout(() => void flush(), ms); };

  async function api<T>(path: string, body?: unknown, failure = UNREACHABLE): Promise<T> {
    let response: Response;
    try {
      response = await send(`${endpoint}/${path}`, body === undefined ? { cache: "no-store" } :
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch { throw Error(failure); }
    if (!response.ok) {
      let message = failure, code: string | undefined;
      try {
        const answer = await response.json() as { error?: unknown; code?: unknown };
        if (typeof answer.error === "string") message = answer.error;
        if (typeof answer.code === "string") code = answer.code;
      } catch { /* Plain. */ }
      throw Object.assign(Error(message), { status: response.status, code });
    }
    const answer = await response.json() as T;
    life.signal.throwIfAborted();
    return answer;
  }

  function probeGpu() {
    if (gpu) return gpu;
    gpu = { renderer: null, webgl2: false };
    try {
      const canvas = win.document.createElement("canvas");
      const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
      if (gl) {
        gpu.webgl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        gpu.renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "") || null;
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    } catch { /* No GPU facts. */ }
    return gpu;
  }

  const device: DiagnosticsDevice = {
    forward(entries) {
      if (closing || life.signal.aborted) return;
      queue.push(...entries);
      if (queue.length > PAGE_QUEUE) { droppedFromQueue += queue.length - PAGE_QUEUE; queue = queue.slice(-PAGE_QUEUE); }
      schedule(entries.some(entry => entry.level === "error") ? 0 : 250);
    },
    pending: () => closing ? [...ring, ...[...deliveries].flat(), ...queue] : [...ring],
    claimHostRef() {
      const now = Date.now(), found = [...hostRefs].reverse().find(item => !item.claimed && now - item.at <= HOST_REF_MS);
      if (!found) return null;
      found.claimed = true;
      return found.ref;
    },
    pageFacts(): Omit<PageFacts, "state"> {
      life.signal.throwIfAborted();
      const { renderer, webgl2 } = probeGpu();
      return { browser: browserName(win.navigator.userAgent), gpu: renderer, webgl2 };
    },
    async state() {
      try { return await api<{ mode: DiagnosticsMode; until: string | null; minutes: number; preparing?: string | null }>("state"); } catch { return null; }
    },
    setMode: mode => api("mode", { mode }, "XF Studio couldn't change diagnostic mode. Try again."),
    prepare: ref => api<ReportManifest>("report", { ref }, "XF Studio couldn't prepare the report. Try again in a moment."),
    item: async (id, item) => (await api<{ text: string }>("item", { id, item }, "XF Studio couldn't show all of it. Try again in a moment.")).text,
    async bundle(request) {
      let response: Response;
      try {
        response = await send(`${endpoint}/bundle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      } catch { throw Error("XF Studio couldn't make the report file. Try again in a moment."); }
      if (!response.ok) {
        let message = "XF Studio couldn't make the report file. Try again in a moment.", code: string | undefined;
        try {
          const answer = await response.json() as { error?: unknown; code?: unknown };
          if (typeof answer.error === "string") message = answer.error;
          if (typeof answer.code === "string") code = answer.code;
        } catch { /* Plain. */ }
        throw Object.assign(Error(message), { code });
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      life.signal.throwIfAborted();
      return bytes;
    },
    save(name, bytes, type) { life.signal.throwIfAborted(); options.download(new Blob([bytes as BlobPart], { type }), name); },
    async copy(text) {
      life.signal.throwIfAborted();
      try { await win.navigator.clipboard.writeText(text); return; } catch { /* Fall back below. */ }
      life.signal.throwIfAborted();
      const area = win.document.createElement("textarea");
      area.value = text; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0";
      win.document.body.append(area); area.select();
      const copied = win.document.execCommand("copy");
      area.remove();
      if (!copied) throw Error("Your browser didn't allow copying. Save the report instead, or select the text and copy it.");
    },
    async openIssue(title, body) {
      // The host builds the link, redacted with the configured folders the page doesn't know (DIAG-19): the desktop opens it in the
      // person's browser (204); the dev server answers it for the page to open.
      const failed = "XF Studio couldn't open the issue page in your browser. Try again.";
      let response: Response;
      try {
        response = await send(`${endpoint}/open-issue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, body }) });
      } catch { throw Error(failed); }
      if (response.status === 204) return;
      const answer = response.ok ? await response.json().catch(() => null) as { url?: unknown } | null : null;
      life.signal.throwIfAborted();
      const url = typeof answer?.url === "string" ? answer.url : null;
      if (!url || !url.startsWith(`${ISSUE_BASE}?`) || url.length > ISSUE_URL_LIMIT) throw Error(failed);
      const opened = win.open(url, "_blank");
      if (!opened) throw Error("Your browser blocked the new tab. Allow pop-ups for XF Studio, then try again.");
      opened.opener = null;
    },
  };

  /** Trap the page's errors into `actions`; returns a function that stops trapping. */
  function install(actions: DiagnosticsActions): () => void {
    if (life.signal.aborted) return () => {};
    uninstall?.();
    const onError = (event: ErrorEvent) => {
      if (/^(?:chrome|moz|safari)-extension:/.test(event.filename ?? "")) return;
      actions.uncaught("error", event.error, event.message || String(event.error ?? ""));
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as { message?: unknown } | undefined;
      actions.uncaught("rejection", event.reason, typeof reason?.message === "string" ? reason.message : String(event.reason ?? ""));
    };
    win.addEventListener("error", onError);
    win.addEventListener("unhandledrejection", onRejection);
    // A failed host request's reference, so the notice that follows can show the same one.
    const original = win.fetch;
    const wrapped = (async (...args: Parameters<typeof fetch>) => {
      const response = await original.apply(win, args);
      const ref = response.headers.get(ERROR_REF_HEADER);
      if (!life.signal.aborted && ref && isErrorRef(ref)) { hostRefs.push({ ref, at: Date.now(), claimed: false }); if (hostRefs.length > 20) hostRefs.shift(); }
      return response;
    }) as typeof fetch;
    win.fetch = wrapped;
    const pagehide = () => void flush();
    win.addEventListener("pagehide", pagehide);
    let installed = true;
    return uninstall = () => {
      if (!installed) return;
      installed = false;
      win.removeEventListener("error", onError); win.removeEventListener("unhandledrejection", onRejection);
      win.removeEventListener("pagehide", pagehide);
      if (win.fetch === wrapped) win.fetch = original;
    };
  }

  const dispose = () => {
    if (closing) return;
    closing = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    noteDropped();
    const waiting = [...ring, ...queue]; ring = []; queue = [];
    // Hand every queued batch to the browser now, even beside an in-flight batch: a closing page cannot wait for its reply.
    // These keepalive requests are not aborted. Failed handoffs remain available through pending().
    for (let at = 0; at < waiting.length; at += DIAGNOSTIC_LIMITS.batch) void deliver(waiting.slice(at, at + DIAGNOSTIC_LIMITS.batch));
    life.abort();
    hostRefs.length = 0; again = false;
    uninstall?.();
    options.signal?.removeEventListener("abort", dispose);
  };
  options.signal?.addEventListener("abort", dispose, { once: true });
  if (options.signal?.aborted) dispose();
  return { device, install, dispose };
}

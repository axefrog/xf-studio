/**
 * The page's diagnostics device (docs/diagnostics.md): traps uncaught errors and unhandled rejections (a lost WebGL context comes
 * from the scene host, through the composition root), notes
 * the error reference of a failed host request (`X-XFS-Error-Ref`), forwards the page's failures to the host log in small batches
 * (bounded and rate-limited; the waiting queue is bounded too, and what can't be sent stays in a ring buffer), reads the page's
 * facts (browser, GPU), and does the report's clipboard, download and issue-page work. Only the composition root constructs it.
 */
import type { DiagnosticsActions, DiagnosticsDevice, DiagnosticsMode } from "./actions";
import { diagnosticEntry, DIAGNOSTIC_FORWARD_SCHEMA, DIAGNOSTIC_LIMITS, isErrorRef, type DiagnosticEntry } from "./model";
import { issueUrl, type PageFacts, type ReportManifest } from "./report";

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
  const send = win.fetch.bind(win);
  let queue: DiagnosticEntry[] = [], ring: DiagnosticEntry[] = [], timer: ReturnType<typeof setTimeout> | null = null;
  let windowStart = 0, sentInWindow = 0, droppedFromQueue = 0;
  const hostRefs: { ref: string; at: number; claimed: boolean }[] = [];
  let gpu: { renderer: string | null; webgl2: boolean } | null = null;

  const keep = (entries: DiagnosticEntry[]) => {
    ring = [...ring, ...entries].slice(-DIAGNOSTIC_LIMITS.ring);
  };
  async function flush() {
    timer = null;
    if (droppedFromQueue) {
      queue.unshift(diagnosticEntry({ level: "warn", area: "page", code: "entries_dropped", origin: "page",
        message: "The window noticed more problems than it could pass on; the oldest were left out.", details: { count: droppedFromQueue } }));
      droppedFromQueue = 0;
    }
    // What couldn't be sent earlier goes first, once the host answers again.
    const batch = [...ring, ...queue].slice(0, DIAGNOSTIC_LIMITS.batch);
    const rest = [...ring, ...queue].slice(DIAGNOSTIC_LIMITS.batch);
    ring = []; queue = [];
    if (!batch.length) return;
    const now = Date.now();
    if (now - windowStart > 60_000) { windowStart = now; sentInWindow = 0; }
    if (sentInWindow + batch.length > DIAGNOSTIC_LIMITS.perMinute) { keep(batch); queue = rest; schedule(10_000); return; }
    sentInWindow += batch.length;
    try {
      const response = await send(`${endpoint}/entries`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema: DIAGNOSTIC_FORWARD_SCHEMA, entries: batch }), keepalive: true });
      // The host refused this batch (malformed, too large): resending it would only be refused again, so it is dropped.
      if (!response.ok && response.status >= 500) throw Error(String(response.status));
    } catch { keep(batch); }
    queue = rest;
    if (queue.length) schedule(250);
  }
  const schedule = (ms = 250) => { if (!timer) timer = setTimeout(() => void flush(), ms); };

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
    return response.json() as Promise<T>;
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
      queue.push(...entries);
      if (queue.length > PAGE_QUEUE) { droppedFromQueue += queue.length - PAGE_QUEUE; queue = queue.slice(-PAGE_QUEUE); }
      schedule(entries.some(entry => entry.level === "error") ? 0 : 250);
    },
    pending: () => [...ring],
    claimHostRef() {
      const now = Date.now(), found = [...hostRefs].reverse().find(item => !item.claimed && now - item.at <= HOST_REF_MS);
      if (!found) return null;
      found.claimed = true;
      return found.ref;
    },
    pageFacts(): Omit<PageFacts, "state"> {
      const { renderer, webgl2 } = probeGpu();
      return { browser: browserName(win.navigator.userAgent), gpu: renderer, webgl2 };
    },
    async state() {
      try { return await api<{ mode: DiagnosticsMode; until: string | null; minutes: number }>("state"); } catch { return null; }
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
      return new Uint8Array(await response.arrayBuffer());
    },
    save(name, bytes, type) { options.download(new Blob([bytes as BlobPart], { type }), name); },
    async copy(text) {
      try { await win.navigator.clipboard.writeText(text); return; } catch { /* Fall back below. */ }
      const area = win.document.createElement("textarea");
      area.value = text; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0";
      win.document.body.append(area); area.select();
      const copied = win.document.execCommand("copy");
      area.remove();
      if (!copied) throw Error("Your browser didn't allow copying. Save the report instead, or select the text and copy it.");
    },
    async openIssue(title, body) {
      try { await api<unknown>("open-issue", { title, body }); return; }
      catch (error) {
        if ((error as { status?: number }).status !== 501) throw Error("XF Studio couldn't open the issue page in your browser. Try again.");
      }
      const opened = win.open(issueUrl(title, body), "_blank");
      if (!opened) throw Error("Your browser blocked the new tab. Allow pop-ups for XF Studio, then try again.");
      opened.opener = null;
    },
  };

  /** Trap the page's errors into `actions`; returns a function that stops trapping. */
  function install(actions: DiagnosticsActions): () => void {
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
    win.fetch = (async (...args: Parameters<typeof fetch>) => {
      const response = await original.apply(win, args);
      const ref = response.headers.get(ERROR_REF_HEADER);
      if (ref && isErrorRef(ref)) { hostRefs.push({ ref, at: Date.now(), claimed: false }); if (hostRefs.length > 20) hostRefs.shift(); }
      return response;
    }) as typeof fetch;
    win.addEventListener("pagehide", () => void flush());
    return () => {
      win.removeEventListener("error", onError); win.removeEventListener("unhandledrejection", onRejection);
      win.fetch = original;
    };
  }

  return { device, install };
}

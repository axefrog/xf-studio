import { afterEach, expect, jest, spyOn, test } from "bun:test";
import { DiagnosticsActions, type DiagnosticsDevice } from "../src/diagnostics/actions";
import { createBrowserDiagnostics, PAGE_QUEUE } from "../src/diagnostics/browser/browser-device";
import { diagnosticEntry, DIAGNOSTIC_LIMITS } from "../src/diagnostics/model";
import { pageFailure, setPageDiagnostics } from "../src/diagnostics/page-sink";
import type { ReportManifest } from "../src/diagnostics/report";

afterEach(() => jest.useRealTimers());
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const entry = () => diagnosticEntry({ level: "error", area: "page", code: "fixture", message: "Fixture", origin: "page" });
const settle = async () => { for (let turn = 0; turn < 8; turn++) await Promise.resolve(); };
const manifest: ReportManifest = { schema: "xfs/problem-report-manifest-1", id: "r", ref: null, made: "2026-10-29T00:00:00.000Z",
  facts: { app: { version: "0.1.0", commit: null, channel: null, host: "localhost" }, os: "", runtime: "", webView2: null,
    game: { version: null, found: false }, launchRoute: "", frameworks: null, wolvenKit: { version: null, source: "" } },
  problem: [], recent: [], items: [{ id: "log", group: "happened", label: "Log", detail: "", bytes: 10, included: true, preview: "" }],
  limits: { total: 100_000, modFiles: 100_000 }, window: { mode: "normal", minutes: 30, until: null } };

function windowFixture(fetcher: typeof fetch) {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const win = { fetch: fetcher, navigator: { userAgent: "Chrome/140.0" },
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const held = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>(); listeners.set(type, held); held.add(listener);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) { listeners.get(type)?.delete(listener); } };
  return { win: win as unknown as Window & typeof globalThis, count: () => [...listeners.values()].reduce((n, held) => n + held.size, 0) };
}

test("diagnostics abort cancels reads and hooks while accepted keepalive log delivery survives", async () => {
  jest.useFakeTimers();
  const life = new AbortController(), calls: { signal: AbortSignal | null | undefined; reply: ReturnType<typeof deferred<Response>> }[] = [];
  const original = ((_input: RequestInfo | URL, init?: RequestInit) => {
    const reply = deferred<Response>(); calls.push({ signal: init?.signal, reply }); return reply.promise;
  }) as typeof fetch;
  const { win, count } = windowFixture(original);
  const owner = createBrowserDiagnostics({ window: win, signal: life.signal, download() { throw Error("Late download"); } });
  const actions = new DiagnosticsActions(owner.device, Date.now, {}, life.signal);
  const off = owner.install(actions), wrapped = win.fetch;
  expect(count()).toBe(3); expect(wrapped).not.toBe(original);
  let published = 0; actions.subscribe(() => { published++; });
  const refreshing = actions.refresh();
  owner.device.forward([entry()]); jest.advanceTimersByTime(1);
  owner.device.forward([entry()]); jest.advanceTimersByTime(1);
  const hostRequest = wrapped("/fixture");
  expect(calls).toHaveLength(3);
  life.abort();
  expect(calls[0]!.signal?.aborted).toBe(true);
  expect(calls[1]!.signal).toBeUndefined();
  expect(calls).toHaveLength(4); // Queued logs are handed off before cancellation, beside the first batch.
  expect(count()).toBe(0); expect(win.fetch).toBe(original); expect(jest.getTimerCount()).toBe(0);
  // The transport deliberately ignores cancellation, including a host reference already on its way to the old wrapper.
  calls[0]!.reply.resolve(Response.json({ mode: "deep", until: null, minutes: 30 }));
  calls[1]!.reply.resolve(new Response(null, { status: 204 }));
  calls[2]!.reply.resolve(new Response(null, { headers: { "X-XFS-Error-Ref": "XF-0001" } }));
  calls[3]!.reply.resolve(new Response(null, { status: 204 }));
  await refreshing; await hostRequest; await settle();
  owner.device.forward([entry()]); actions.failure("fixture", "late", "Late notice", undefined, { notify: true });
  jest.advanceTimersByTime(120_000);
  expect([calls.length, published, jest.getTimerCount()]).toEqual([4, 0, 0]);
  expect(owner.device.pending()).toEqual([]); expect(owner.device.claimHostRef()).toBeNull();
  expect(actions.snapshot()).toEqual({ mode: null, report: null, opens: 0, notice: null });
  off(); owner.dispose(); expect(count()).toBe(0);
});

test("diagnostics abort clears the rate-limit retry and an already-aborted owner installs nothing", async () => {
  jest.useFakeTimers();
  const life = new AbortController(); let sends = 0;
  const { win, count } = windowFixture((async () => { sends++; return new Response(null, { status: 204 }); }) as unknown as typeof fetch);
  const owner = createBrowserDiagnostics({ window: win, signal: life.signal, download() {} });
  // Repeated zero-delay flushes exhaust the minute budget; the remaining batch schedules the long retry.
  const allowed = DIAGNOSTIC_LIMITS.perMinute / DIAGNOSTIC_LIMITS.batch;
  for (let batch = 0; batch <= allowed; batch++) {
    owner.device.forward(Array.from({ length: DIAGNOSTIC_LIMITS.batch }, entry));
    jest.advanceTimersByTime(1); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  }
  expect(sends).toBe(allowed); expect(owner.device.pending()).toHaveLength(DIAGNOSTIC_LIMITS.batch);
  expect(jest.getTimerCount()).toBe(1);
  life.abort(); const sent = sends;
  expect(sent).toBe(allowed + 1); // The rate-limited accepted batch is handed off on release.
  await settle();
  expect(jest.getTimerCount()).toBe(0);
  jest.advanceTimersByTime(120_000); expect(sends).toBe(sent);
  const ended = createBrowserDiagnostics({ window: win, signal: life.signal, download() {} });
  const actions = new DiagnosticsActions(ended.device, Date.now, {}, life.signal);
  ended.install(actions); ended.device.forward([entry()]); await actions.refresh();
  expect(count()).toBe(0); expect(sends).toBe(sent); expect(jest.getTimerCount()).toBe(0);
});

test("shutdown hands every queued batch off synchronously without waiting for an in-flight reply", async () => {
  jest.useFakeTimers();
  const life = new AbortController();
  const calls: { entries: string[]; init: RequestInit; reply: ReturnType<typeof deferred<Response>> }[] = [];
  const { win } = windowFixture(((_input: RequestInfo | URL, init: RequestInit) => {
    const reply = deferred<Response>(); calls.push({ init, entries: JSON.parse(String(init.body)).entries.map((value: { message: string }) => value.message), reply });
    return reply.promise;
  }) as typeof fetch);
  const owner = createBrowserDiagnostics({ window: win, signal: life.signal, download() {} });
  owner.device.forward([{ ...entry(), message: "in flight" }]); jest.advanceTimersByTime(1);
  owner.device.forward(Array.from({ length: 25 }, (_, i) => ({ ...entry(), message: `queued ${i}` })));
  expect(calls).toHaveLength(1);
  life.abort();
  expect(calls.map(call => call.entries.length)).toEqual([1, 10, 10, 5]);
  expect(calls.every(call => call.init.keepalive && !call.init.signal)).toBe(true);
  expect(owner.device.pending()).toHaveLength(26); expect(jest.getTimerCount()).toBe(0);
  for (const call of calls) call.reply.resolve(new Response(null, { status: 204 }));
  await settle();
  expect(owner.device.pending()).toEqual([]); owner.dispose(); expect(calls).toHaveLength(4);
});

for (const status of [400, 503]) test(`shutdown retains all accepted log entries when handoff answers ${status}`, async () => {
  jest.useFakeTimers();
  const life = new AbortController(); let sent = 0;
  const first = deferred<Response>();
  const { win } = windowFixture((async () => { sent++; return sent === 1 ? first.promise : new Response(null, { status }); }) as unknown as typeof fetch);
  const owner = createBrowserDiagnostics({ window: win, signal: life.signal, download() {} });
  owner.device.forward([{ ...entry(), message: "in flight" }]); jest.advanceTimersByTime(1);
  owner.device.forward(Array.from({ length: PAGE_QUEUE }, (_, i) => ({ ...entry(), message: `queued ${i}` })));
  life.abort();
  expect(sent).toBe(1 + PAGE_QUEUE / DIAGNOSTIC_LIMITS.batch);
  first.resolve(new Response(null, { status })); await settle();
  expect(owner.device.pending()).toHaveLength(PAGE_QUEUE + 1);
  expect(new Set(owner.device.pending().map(value => value.message)).size).toBe(PAGE_QUEUE + 1);
  const before = sent; owner.dispose(); jest.advanceTimersByTime(120_000);
  expect([sent, jest.getTimerCount()]).toEqual([before, 0]);
});

for (const stage of ["prepare", "bundle", "mode", "item"] as const) test(`diagnostics refuses late ${stage} completion after abort`, async () => {
  jest.useFakeTimers();
  const life = new AbortController(), answer = deferred<unknown>();
  let saved = 0, reads = 0, publications = 0;
  const device: DiagnosticsDevice = { forward() {}, pending: () => [], claimHostRef: () => null,
    pageFacts: () => ({ browser: "fixture", gpu: null, webgl2: false }), state: async () => { reads++; return null; },
    prepare: async () => stage === "prepare" ? await answer.promise as ReportManifest : manifest,
    bundle: async () => await answer.promise as Uint8Array,
    setMode: async () => await answer.promise as { mode: "deep"; until: null; minutes: number },
    item: async () => await answer.promise as string, save: () => { saved++; }, copy: async () => {}, openIssue: async () => {} };
  const actions = new DiagnosticsActions(device, Date.now, {}, life.signal);
  actions.subscribe(() => { publications++; });
  let pending: Promise<unknown>;
  if (stage === "mode") pending = actions.dispatch({ kind: "diagnostics.setMode", mode: "deep" });
  else {
    const preparing = actions.dispatch({ kind: "diagnostics.prepareReport" });
    if (stage === "prepare") pending = preparing;
    else { await preparing; pending = stage === "item" ? actions.fullText("log") : actions.dispatch({ kind: "diagnostics.saveReport" }); }
  }
  const before = actions.snapshot(), notifications = publications;
  life.abort(); expect(jest.getTimerCount()).toBe(0);
  jest.advanceTimersByTime(60_000);
  answer.resolve(stage === "prepare" ? manifest : stage === "bundle" ? new Uint8Array(1) : stage === "mode" ? { mode: "deep", until: null, minutes: 30 } : "late");
  const result = await pending;
  if (stage === "item") expect(result).toBeNull(); else expect(result).toMatchObject({ ok: false });
  expect([saved, reads, publications]).toEqual([0, 0, notifications]);
  expect(actions.snapshot()).toEqual(before);
  expect(actions.capability({ kind: "diagnostics.prepareReport" }).available).toBe(false);
});

test("a page sink withdraws on its own signal without withdrawing a newer owner's sink", () => {
  const a = new AbortController(), b = new AbortController(), calls: string[] = [];
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    setPageDiagnostics(() => { calls.push("a"); return "XF-0001"; }, a.signal);
    setPageDiagnostics(() => { calls.push("b"); return "XF-0002"; }, b.signal);
    a.abort(); expect(pageFailure("fixture", "live", "Live")).toBe("XF-0002");
    b.abort(); expect(pageFailure("fixture", "ended", "Ended")).toBeNull();
    setPageDiagnostics(() => { calls.push("ended"); return null; }, a.signal);
    expect(pageFailure("fixture", "ended", "Ended")).toBeNull();
    expect(calls).toEqual(["b"]); expect(log).toHaveBeenCalledTimes(2);
  } finally { setPageDiagnostics(null); log.mockRestore(); }
});

test("aborting from the busy publication prevents the diagnostics device step from starting", async () => {
  jest.useFakeTimers();
  const life = new AbortController(); let opened = 0;
  const device = { forward() {}, pending: () => [], pageFacts: () => ({ browser: "fixture", gpu: null, webgl2: false }),
    prepare: async () => manifest, openIssue: async () => { opened++; } } as unknown as DiagnosticsDevice;
  const actions = new DiagnosticsActions(device, Date.now, {}, life.signal);
  await actions.dispatch({ kind: "diagnostics.prepareReport" });
  actions.subscribe(() => { if (actions.snapshot().report?.busy) life.abort(); });
  expect(await actions.dispatch({ kind: "diagnostics.openIssue" })).toMatchObject({ ok: false, code: "cancelled" });
  expect(opened).toBe(0); expect(jest.getTimerCount()).toBe(0);
});

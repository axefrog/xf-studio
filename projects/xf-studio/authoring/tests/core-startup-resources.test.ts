import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { launch, startServer } from "../tools/cdp";
import { CHROME, chromeInstalled } from "./webgl-harness";
import { oracleTest } from "./optional-oracles";
import { STARTUP_RESOURCES, type StartupResourceCounts } from "./fixtures/startup-resources";
import { DEFAULT_CHARACTER } from "../src/character/character-detail-request";
import { FACIAL_ENDPOINT, FACIAL_STATE_SCHEMA } from "../src/platform/api/facial";
import { prepareReleaseHead } from "./fixtures/startup-head-preparation";
import { LocalSettingsStore } from "../src/setup/host/local-settings-store";
import { packageToolPaths } from "../src/setup/host/local-settings-readiness";
import { WolvenKitSetupHost } from "../src/setup/host/wolvenkit-setup-host";
import { localToolsRoot } from "../src/host/package-server";

function gameSetupAvailable(): boolean {
  try {
    const settings = new LocalSettingsStore().load().settings, paths = packageToolPaths(settings);
    if (!paths.gamepath || !existsSync(join(paths.gamepath, "archive", "pc", "content"))) return false;
    // Same configured/managed tool resolution as the disposable server, read-only (never install or prepare here).
    return !!new WolvenKitSetupHost({ root: localToolsRoot(), configured: () => paths.wolvenkit }).usable();
  } catch { return false; }
}
const chrome = chromeInstalled(), missingChrome = `Chrome is unavailable at ${CHROME} (set CHROME)`;
const browserTest = oracleTest(chrome, missingChrome);
const paintedTest = oracleTest(chrome && gameSetupAvailable(), chrome
  ? "the real-head release proof needs configured game files and usable WolvenKit (Studio settings or XFS_PACKAGE_GAMEPATH/XFS_PACKAGE_WOLVENKIT)."
  : missingChrome);
const FACE = { schema: FACIAL_STATE_SCHEMA, rig: { phase: "unconfigured", reason: "Release fixture" },
  solver: { phase: "missing", reason: "Release fixture" }, expressions: { phase: "ready", count: 0 }, blink: { available: false }, samples: [] };

for (const composition of ["normal", "empty"] as const) for (const partial of [false, true])
  (partial ? browserTest : paintedTest)(`real ${composition} ${partial ? "partial startup" : "painted mount"} returns resources to baseline in the same page`, async () => {
    const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const port = reservation.port!; reservation.stop(true);
    // Copy settings into an isolated host. Mounted rows require the coordinator's prepared game setup,
    // so a real renderer/context is exercised as well as the asset-free shell paint gate.
    const host = await startServer(port, { settings: partial ? "empty" : "copy" });
    let page: Awaited<ReturnType<typeof launch>> | undefined;
    try {
      const origin = `http://127.0.0.1:${port}`;
      if (!partial) await prepareReleaseHead(origin);
      // Half the previous pixel area; unchanged real assets, resource assertions and decoded-pixel paint gate.
      page = await launch(`${origin}/?verify=1&composition=${composition}`, { width: 960, height: 720, scheme: "light", init: STARTUP_RESOURCES + `
        window.releasePageIdentity = {};
        localStorage.setItem('xfs:character:last-request:verification', ${JSON.stringify(JSON.stringify(DEFAULT_CHARACTER))});
        const send = window.fetch;
        window.fetch = (input, init) => {
          const url = String(input), probe = window.xfsReleaseProbe;
          if (url === ${JSON.stringify(FACIAL_ENDPOINT)}) return probe.defer(url, init, ${JSON.stringify(FACE)});
          if (url === '/api/preview-character' && init?.headers?.['X-XFS-Warm']) return probe.defer(url, init, { phase: 'ready', record: 'a'.repeat(64) + '.json' });
          ${partial ? `if (url.startsWith('/api/verification/documents') && (!init?.method || init.method === 'GET')) return probe.defer(url, init, { ok: true, documents: [] });` : ""}
          return send(input, init);
        };
      ` });
      if (partial) {
        await page.waitFor(`window.xfsReleaseProbe?.held.some(row => row.url.startsWith('/api/verification/documents'))`, 90_000);
        expect(await page.evaluate(`!!document.querySelector('#studio.studio-ready')`) as boolean).toBe(false);
      } else {
        await page.waitFor(`document.querySelector('#studio.studio-ready') && window.xfStudioLifetime`, 90_000);
        await page.waitFor(`window.xfStudioPresentation.viewport.snapshot().head.phase === 'ready'`, 120_000);
        // Reuse 13b's independent decoded-pixel gate, including its transparent-shell negative control.
        const { verifyShellPaint } = await import("./fixtures/startup-shell-paint");
        await verifyShellPaint(page);
        await page.evaluate(`window.xfStudioShell.runtime.dock.reveal('lighting')`);
        await page.waitFor(`document.querySelector('#studio .direction-dial .dial-grip')`);
        const resizing = await page.evaluate(`(() => {
          const grip = window.releaseResizeGrip = document.querySelector('#studio .direction-dial .dial-grip');
          const before = window.xfsReleaseProbe.detail();
          grip.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 7303, clientY: 100, bubbles: true }));
          grip.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7303, clientY: 80, bubbles: true }));
          const added = [...window.xfsReleaseProbe.detail()];
          for (const row of before) { const at = added.indexOf(row); if (at >= 0) added.splice(at, 1); }
          return { dragging: grip.classList.contains('dragging'), added };
        })()`) as { dragging: boolean; added: string[] };
        // The drag owns at least the document Escape handler (SizeBar); the abort below must release it with the rest.
        expect(resizing.dragging).toBe(true);
        expect(resizing.added).toContain("document:keydown");
        await page.evaluate(`(() => {
          const rt = window.xfStudioShell.runtime;
          rt.feedback.toast('info', 'Release proof', 'Pending feedback');
          rt.feedback.announce('Pending announcement');
          window.dispatchEvent(new Event('resize'));
          document.querySelector('#studio button.header-commands').click();
        })()`);
      }
      const live = await page.evaluate(`({ counts: window.xfsReleaseProbe.counts(), made: window.xfsReleaseProbe.made, held: window.xfsReleaseProbe.held.length })`) as
        { counts: StartupResourceCounts; made: StartupResourceCounts; held: number };
      expect(live.counts.listeners).toBeGreaterThan(0);
      expect(live.counts.timers).toBeGreaterThan(0); // Warm expiry, plus mounted feedback/debounce when present.
      expect(live.held).toBeGreaterThan(0);
      if (!partial) {
        expect(live.counts.contexts).toBeGreaterThan(0); expect(live.made.frames).toBeGreaterThan(0); expect(live.counts.observers).toBeGreaterThan(0);
        if (composition === "normal") expect(live.counts.workers).toBeGreaterThan(0); else expect(live.counts.workers).toBe(0);
      }
      const identity = await page.evaluate(`window.releaseIdentityBefore = window.releasePageIdentity; true`);
      expect(identity).toBe(true);
      await page.evaluate(partial ? `window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))` : `window.xfStudioLifetime.abort()`);
      // The page stays alive. Wait for asynchronous context-loss / lease stop, with a bounded deadline.
      try {
        await page.waitFor(`JSON.stringify(window.xfsReleaseProbe.counts()) === JSON.stringify(window.xfsReleaseProbe.baseline)`, 10_000);
      } catch (error) {
        try {
          console.error(JSON.stringify({ composition, partial, ...await page.evaluate(`({ counts: window.xfsReleaseProbe.counts(),
            baseline: window.xfsReleaseProbe.baseline, detail: window.xfsReleaseProbe.detail() })`) }));
        } catch (diagnosticError) { console.error("Release diagnostic unavailable", diagnosticError); }
        throw error;
      }
      const retired = await page.evaluate(`({ baseline: window.xfsReleaseProbe.baseline, counts: window.xfsReleaseProbe.counts(),
        signals: window.xfsReleaseProbe.held.map(row => row.signal?.aborted), same: window.releaseIdentityBefore === window.releasePageIdentity,
        aborted: ${partial ? "true" : "window.xfStudioLifetime.signal.aborted"} })`) as
        { baseline: StartupResourceCounts; counts: StartupResourceCounts; signals: boolean[]; same: boolean; aborted: boolean };
      expect(retired.counts).toEqual(retired.baseline); expect(retired.same).toBe(true); expect(retired.aborted).toBe(true);
      expect(retired.signals.every(Boolean)).toBe(true);
      const late = await page.evaluate(`(async () => {
        const probe = window.xfsReleaseProbe;
        const before = document.body.innerHTML, theme = document.documentElement.getAttribute('style'), activity = window.xfStudioShell?.runtime.feedback.log.length;
        const history = JSON.stringify(window.xfStudioPresentation?.authoring.historyTimeline());
        const preferences = JSON.stringify(window.xfStudioShell?.runtime.port.preferences.snapshot());
        probe.watch();
        for (const row of probe.held) row.release();
        // New global input cannot wake a retired shell or write a history step.
        window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        for (const type of ['pointermove', 'pointerup', 'lostpointercapture'])
          window.releaseResizeGrip?.dispatchEvent(new PointerEvent(type, { pointerId: 7303, clientY: 200, bubbles: true }));
        await probe.settle(); await probe.wait(650); await probe.settle();
        return { counts: probe.counts(), baseline: probe.baseline, writes: probe.writes, draws: probe.draws, deliveries: probe.deliveries, domWrites: probe.domWrites,
          dom: document.body.innerHTML === before, theme: document.documentElement.getAttribute('style') === theme,
          activity: window.xfStudioShell?.runtime.feedback.log.length === activity,
          preferences: JSON.stringify(window.xfStudioShell?.runtime.port.preferences.snapshot()) === preferences,
          history: JSON.stringify(window.xfStudioPresentation?.authoring.historyTimeline()) === history, error: !!document.querySelector('.boot-error') };
      })()`) as { counts: StartupResourceCounts; baseline: StartupResourceCounts; writes: string[]; draws: string[]; deliveries: string[]; domWrites: string[];
        dom: boolean; theme: boolean; activity: boolean; preferences: boolean; history: boolean; error: boolean };
      expect(late).toMatchObject({ writes: [], draws: [], deliveries: [], domWrites: [], dom: true, theme: true, activity: true, preferences: true, history: true, error: false });
      expect(late.counts).toEqual(late.baseline);
      expect(page.console.filter(line => ["error", "exception"].includes(line.type))).toEqual([]);
      console.log(JSON.stringify({ composition, partial, live, retired, late }));
    } finally { await page?.close(); host.server.kill(); await host.server.exited; }
  }, 420_000);

// Keep the instrumentation executable under Bun too; browser behaviour is still the required oracle above.
test("release probe is a standalone pre-load script with no production evidence hooks", () => {
  expect(() => new Function(STARTUP_RESOURCES)).not.toThrow();
  expect(STARTUP_RESOURCES).not.toContain("xfStudio");
});

test("independent resource instrumentation detects leaks and returns exactly after real unregister operations", () => {
  const result = runInNewContext(String.raw`
    class EventTarget {
      constructor() { this.rows = []; }
      addEventListener(type, listener, options) { if (options?.signal?.aborted) return; this.rows.push({ type, listener, options });
        options?.signal?.addEventListener('abort', () => this.removeEventListener(type, listener), { once: true }); }
      removeEventListener(type, listener) { this.rows = this.rows.filter(row => row.type !== type || row.listener !== listener); }
      dispatchEvent(event) { for (const row of [...this.rows]) if (row.type === event.type) { if (row.options?.once) this.removeEventListener(row.type, row.listener); row.listener.call(this, event); } }
    }
    class AbortController { constructor() { this.signal = new EventTarget(); this.signal.aborted = false; } abort() { this.signal.aborted = true; this.signal.dispatchEvent({ type: 'abort' }); } }
    class Storage { setItem() {} removeItem() {} clear() {} }
    class Worker { terminate() {} }
    class ResizeObserver { constructor(run) { this.run = run; } observe() {} unobserve() {} disconnect() {} }
    class WebGL2RenderingContext { drawArrays() {} drawElements() {} }
    class HTMLCanvasElement extends EventTarget { getContext() { return this.context ??= new WebGL2RenderingContext(); } }
    const document = new EventTarget(), nativeTimers = new Map(), nativeFrames = new Map(); let id = 0;
    const window = new EventTarget();
    Object.assign(window, { Worker, ResizeObserver, WebGL2RenderingContext,
      setTimeout: run => { nativeTimers.set(++id, run); return id; }, setInterval: run => { nativeTimers.set(++id, run); return id; }, clearTimeout: id => nativeTimers.delete(id),
      requestAnimationFrame: run => { nativeFrames.set(++id, run); return id; }, cancelAnimationFrame: id => nativeFrames.delete(id) });
  ` + STARTUP_RESOURCES + String.raw`
    const probe = window.xfsReleaseProbe, baseline = probe.counts(), controller = new AbortController();
    const listener = () => {};
    window.addEventListener('resize', listener, { signal: controller.signal });
    window.addEventListener('resize', listener, { signal: controller.signal }); // Browser identity deduplicates it.
    document.addEventListener('once', listener, { once: true });
    const timer = window.setTimeout(listener, 10), interval = window.setInterval(listener, 20), frame = window.requestAnimationFrame(listener), worker = new window.Worker('probe-worker.js', { type: 'module' });
    const observer = new window.ResizeObserver(listener), target = {}; observer.observe(target);
    const canvas = new HTMLCanvasElement(), gl = canvas.getContext('webgl2'); canvas.getContext('webgl2');
    const leaked = probe.counts(), detail = probe.detail();
    document.dispatchEvent({ type: 'once' }); controller.abort();
    window.clearInterval(timer); window.clearTimeout(interval); window.cancelAnimationFrame(frame); worker.terminate(); observer.unobserve(target);
    canvas.dispatchEvent({ type: 'webglcontextlost' });
    const retired = probe.counts();
    probe.watch(); new Storage().setItem('late', 'value'); gl.drawArrays();
    window.dispatchEvent({ type: 'resize' }); document.dispatchEvent({ type: 'once' });
    ({ baseline, leaked, detail, retired, retiredDetail: probe.detail(), writes: probe.writes, draws: probe.draws, deliveries: probe.deliveries });
  `) as { baseline: StartupResourceCounts; leaked: StartupResourceCounts; detail: string[]; retired: StartupResourceCounts; retiredDetail: string[];
    writes: string[]; draws: string[]; deliveries: string[] };
  expect(result.leaked).toEqual({ listeners: 2, timers: 2, frames: 1, workers: 1, contexts: 1, observers: 1 });
  expect(result.detail).toEqual(["window:resize", "document:once", "timeout:10ms", "interval:20ms", "animation-frame:3",
    "Worker:module:probe-worker.js", "WebGLContext", "ResizeObserver:targets=1"]);
  expect(result.retired).toEqual(result.baseline);
  expect(result.retiredDetail).toEqual([]);
  expect(result.writes).toEqual(["setItem:late"]); expect(result.draws).toEqual(["WebGL2RenderingContext.drawArrays"]);
  expect(result.deliveries).toEqual([]);
});

test("release fixture prepares the real core then character before launching Chrome", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const request = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    expect(init?.signal?.aborted).toBe(false);
    expect(headers.get("Origin")).toBe("http://127.0.0.1:1234");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-XFS-Page")).toBe("core-release-preparation");
    calls.push({ url: String(url), body: JSON.parse(init?.body as string) });
    return Response.json({ phase: calls.length === 1 ? "preparing" : "ready" });
  }, { preconnect() {} }) as typeof fetch;
  await prepareReleaseHead("http://127.0.0.1:1234", request);
  expect(calls).toEqual([
    { url: "http://127.0.0.1:1234/api/preview-core", body: { action: "prepare" } },
    { url: "http://127.0.0.1:1234/api/preview-core", body: { action: "prepare" } },
    { url: "http://127.0.0.1:1234/api/preview-character", body: DEFAULT_CHARACTER },
  ]);
});

test("release preparation refuses unavailable/failed hosts and has a bounded deadline", async () => {
  for (const [phase, status] of [["needs-setup", 409], ["failed", 200]] as const) {
    const request = Object.assign(async () => Response.json({ phase }, { status }), { preconnect() {} }) as typeof fetch;
    await expect(prepareReleaseHead("http://127.0.0.1:1234", request)).rejects.toThrow(phase);
  }
  const preparing = Object.assign(async () => Response.json({ phase: "preparing" }), { preconnect() {} }) as typeof fetch;
  await expect(prepareReleaseHead("http://127.0.0.1:1234", preparing, 1)).rejects.toThrow();
});

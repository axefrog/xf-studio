/** Real product startup; synthetic selection lives solely in a test composition served by CDP. */
import { expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { launch, startServer } from "../tools/cdp";
import { CHROME, chromeInstalled } from "./webgl-harness";
import { oracleTest } from "./optional-oracles";
import { verifyShellPaint } from "./fixtures/startup-shell-paint";
import { STARTUP_RESOURCES, type StartupResourceCounts } from "./fixtures/startup-resources";

const browserTest = oracleTest(chromeInstalled(), `Chrome is unavailable at ${CHROME} (set CHROME)`);
for (const composition of ["empty", "synthetic"] as const) browserTest(`real ${composition} startup mounts, edits where contributed, and releases without makeup`, async () => {
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reservation.port!; reservation.stop(true);
  const host = await startServer(port, { settings: "empty" });
  let page: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    let script: string | undefined;
    if (composition === "synthetic") {
      const built = await Bun.build({ entrypoints: [fileURLToPath(new URL("./compose/synthetic-startup.ts", import.meta.url))], target: "browser", format: "esm" });
      expect(built.success).toBe(true); if (!built.success) throw Error(built.logs.join("\n"));
      script = await built.outputs[0]!.text();
    }
    // Install interception before navigating; the host, HTML, shell and startStudio are real.
    // Only the entry module becomes the test composition. No production selection or test hook is added.
    page = await launch("about:blank", { width: 960, height: 720, scheme: "light", init: STARTUP_RESOURCES + `
      window.substitutionRequests = [];
      const send = window.fetch;
      window.fetch = (input, init) => { window.substitutionRequests.push({ url: String(input), body: init?.body }); return send(input, init); };
    ` });
    if (script) {
      const session = page, body = Buffer.from(script).toString("base64");
      session.on("Fetch.requestPaused", event => {
        void session.send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "application/javascript" }], body });
      });
      await page.send("Fetch.enable", { patterns: [{ urlPattern: "*/build/studio-main.js", requestStage: "Request" }] });
    }
    const url = `http://127.0.0.1:${port}/?verify=1&composition=${composition}`;
    await page.send("Page.navigate", { url });
    await page.waitFor(`document.querySelector('#studio.studio-ready') && window.xfStudioLifetime`, 90_000);
    await verifyShellPaint(page);
    const mounted = await page.evaluate(`(() => {
      const p = window.xfStudioPresentation, badge = document.querySelector('.status-bar .ready-badge');
      const panels = [...document.querySelectorAll('#layout-dock .dock-group')].map(node => {
        const box = node.getBoundingClientRect(); return { width: box.width, height: box.height };
      });
      return { features: p.features().map(feature => feature.id), formats: ['recipe.export', 'mask.export', 'package.check', 'package.build'].map(kind => [kind, p.files.capability({kind}).available]),
        panels, badge: { hidden: badge.hidden, text: badge.textContent }, workers: window.xfsReleaseProbe.made.workers,
        requests: window.substitutionRequests, paints: performance.getEntriesByType('paint').map(row => row.name) };
    })()`) as { features: string[]; formats: [string, boolean][]; panels: { width: number; height: number }[];
      badge: { hidden: boolean; text: string }; workers: number; requests: { url: string; body?: string }[]; paints: string[] };
    expect(mounted.features).toEqual(composition === "empty" ? [] : ["closure-layers"]);
    expect(mounted.badge).toEqual({ hidden: true, text: "" }); expect(mounted.workers).toBe(0);
    expect(mounted.panels.length).toBeGreaterThan(0);
    expect(mounted.panels.every(panel => panel.width > 0 && panel.height > 0)).toBe(true);
    expect(mounted.paints).toContain("first-contentful-paint");
    expect(mounted.formats).toEqual([["recipe.export", composition === "synthetic"], ["mask.export", false], ["package.check", false], ["package.build", false]]);
    // The empty/synthetic setup may ask for neutral head status, but must never prepare the makeup plate.
    expect(mounted.requests.filter(row => /plate|raster|makeup/i.test(row.url + (row.body ?? "")))).toEqual([]);
    if (composition === "synthetic") {
      await page.waitFor(`document.querySelector('[data-closure-value]')?.textContent === '1'`);
      const click = async (label: string) => page!.evaluate(`(() => {
        const button = [...document.querySelectorAll('[data-closure-editor] button')].find(node => node.textContent === ${JSON.stringify(label)});
        if (!button) throw Error('Missing synthetic control'); button.click();
      })()`);
      await click("Increment first layer");
      await page.waitFor(`document.querySelector('[data-closure-value]')?.textContent === '2'`);
      const edited = await page.evaluate(`window.xfStudioPresentation.authoring.history().undo`);
      expect(edited).toBeDefined();
      await click("Undo closure edit");
      await page.waitFor(`document.querySelector('[data-closure-value]')?.textContent === '1'`);
      // Capture real file bytes before the browser download adapter; exercise the registered operation, not a fake facade.
      await page.evaluate(`(() => {
        const create = URL.createObjectURL; window.closureDownloads = [];
        URL.createObjectURL = blob => { window.closureDownloads.push(blob.text()); return create.call(URL, blob); };
        const click = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function() { if (!this.download) return click.call(this); window.closureFilename = this.download; };
      })()`);
      await click("Export closure layers");
      await page.waitFor(`window.closureDownloads.length > 0`);
      expect(await page.evaluate(`(async () => ({ name: window.closureFilename, value: JSON.parse(await window.closureDownloads[0]) }))()`)).toEqual({
        name: "closure.layers.json", value: { schema: "test/closure-layers-1", body: { layers: [{ id: "first", value: 1 }, { id: "second", value: 2 }] } } });
    }
    expect(await page.evaluate(`window.xfStudioLifetime.abort(); window.xfStudioLifetime.signal.aborted`)).toBe(true);
    await page.waitFor(`JSON.stringify(window.xfsReleaseProbe.counts()) === JSON.stringify(window.xfsReleaseProbe.baseline)`, 20_000);
    const released = await page.evaluate(`({ counts: window.xfsReleaseProbe.counts(), baseline: window.xfsReleaseProbe.baseline })`) as
      { counts: StartupResourceCounts; baseline: StartupResourceCounts };
    expect(released.counts).toEqual(released.baseline);
    expect(page.console.filter(line => ["error", "exception"].includes(line.type))).toEqual([]);
    console.log(JSON.stringify({ composition, url, mounted, released }));
  } finally { await page?.close(); host.server.kill(); await host.server.exited; }
}, 180_000);

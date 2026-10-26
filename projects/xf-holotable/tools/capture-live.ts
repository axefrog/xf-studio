// Offline visual QA only. Run after any machine quiet window, under the memory guard.
// bun tools/capture-live.ts [output directory]
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, type Session as BrowserSession } from "../../xf-studio/authoring/tools/cdp.ts";
import { createService } from "../src/service.ts";
import { FakeBridge, settle } from "../tests/live-fake.ts";
import { emptySolids } from "../src/solid-source.ts";
import type { Solid } from "../src/model.ts";

const output = resolve(process.argv[2] ?? join(import.meta.dir, "../../../local/holotable/evidence/live"));
mkdirSync(output, { recursive: true });
const authoring = join(import.meta.dir, "../../xf-studio/authoring");
const built = await Bun.build({ entrypoints: [join(import.meta.dir, "live-preview-client.ts")], target: "browser", format: "esm" });
if (!built.success) throw Error(built.logs.join("\n"));
const script = await built.outputs[0].text();
const cases = new Map<string, ReturnType<typeof createService>>();
function fixture(name: string, variant: string) {
  const key = `${name}:${variant}`;
  let service = cases.get(key); if (service) return service;
  const bridge = new FakeBridge();
  const rows: Record<string, unknown>[] = []; let seq = 0;
  for (let i = 0; i < 60; i++) {
    const t = 1000 + i * 0.1, position = [i * 2, Math.sin(i / 9) * 14, 10];
    rows.push({ schema: "xfb/source-record-1", session: "abc123", run: 1, world_generation: 1, seq: ++seq, source_s: t,
      channel: "v", valid: i !== 25, data: { position, yaw: 80, velocity: [2, 0, 0], vitals: { health: 100, health_max: 100 } } });
    rows.push({ schema: "xfb/source-record-1", session: "abc123", run: 1, world_generation: 1, seq: ++seq, source_s: t,
      channel: "camera", valid: true, data: { camera: { position: [position[0], position[1], 12], forward: [1, 0, 0], up: [0, 0, 1], fov: 60, aspect: 1.8 } } });
  }
  bridge.pages.push(bridge.page(rows, { more: name === "behind", now: name === "behind" ? 1011.9 : 1005.9 }));
  if (name === "connection-lost") bridge.pages.push(Error("Synthetic disconnect"));
  const shapes: Solid[] = [-1, 1].flatMap(side => Array.from({ length: 6 }, (_, i) => ({ id: `${side}:${i}`, kind: "box" as const,
    center: [i * 30, side * 45, 20] as [number, number, number], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Solid["axes"], size: [10, 12, 10] as [number, number, number] })));
  service = createService({ recordingsRoot: "", worldPackPath: "", liveBridge: bridge, liveClock: bridge.clock,
    solidSource: { status: async () => ({ cold: false }), around: async () => ({ ...emptySolids(), solids: shapes }) } });
  service.handlers["runs.list"] = () => [{ session: "synthetic-recording", run: 1, dir: "offline-fixture", start: 1000, end: 1005.9, bytes: 24000, complete: true }];
  const originalWatch = service.handlers["live.watch"];
  service.handlers["live.watch"] = async (p, signal) => {
    const watch = await originalWatch(p, signal); await settle();
    if (name === "connection-lost") { await bridge.clock.advance(1000); bridge.connected = false; }
    return watch;
  };
  cases.set(key, service); return service;
}
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/studio.css") return new Response(Bun.file(join(authoring, "public/studio.css")), { headers: { "content-type": "text/css" } });
  if (url.pathname === "/client.js") return new Response(script, { headers: { "content-type": "text/javascript" } });
  if (url.pathname === "/fixture" && request.method === "POST") {
    const { method, params } = await request.json() as { method: string; params: Record<string, unknown> };
    try { const handler = fixture(url.searchParams.get("case") ?? "watching", url.searchParams.get("variant") ?? "default").handlers[method];
      if (!handler) throw Error("Unknown fake method");
      return Response.json({ ok: true, result: await handler(params, request.signal) });
    } catch (e: any) { return Response.json({ ok: false, error: { code: e?.code ?? "failed", message: e?.message } }, { status: 502 }); }
  }
  if (url.searchParams.get("verify") !== "1") return new Response("Verification workspace required", { status: 400 });
  return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><title>Holotable live verification</title><link rel="stylesheet" href="/studio.css"><body><script type="module" src="/client.js"></script></body></html>', { headers: { "content-type": "text/html" } });
} });
let page: BrowserSession | undefined;
const measurements: unknown[] = [];
const deadline = setTimeout(() => { console.error("Live capture exceeded its 180 second deadline"); process.exit(1); }, 180000);
try {
  page = await launch(`http://127.0.0.1:${server.port}/?verify=1&case=watching`, { width: 1800, height: 740, motion: "reduce", args: ["--disable-gpu", "--no-sandbox"] });
  for (const name of ["watching", "behind", "connection-lost", "back-to-live"]) for (const theme of ["light", "dark"]) for (const width of ["narrow", "wide"]) {
    await page.viewport(width === "narrow" ? 930 : 1810, 740);
    await page.send("Page.navigate", { url: `http://127.0.0.1:${server.port}/?verify=1&case=${name}&theme=${theme}&width=${width}` });
    await page.waitFor('document.body.dataset.ready === "true" && document.body.dataset.shapes === "true"');
    const measured = await page.evaluate(`(() => {
      const panel = document.querySelector('.holotable-panel'), buttons = [...panel.querySelectorAll('button')].filter(b=>!b.hidden), text = panel.textContent;
      return {name:${JSON.stringify(name)},theme:${JSON.stringify(theme)},width:${JSON.stringify(width)},
        overflow:panel.scrollWidth > panel.clientWidth, controls:buttons.map(b=>b.textContent),
        live:text.includes('Live ·'), behind:text.includes('s behind'), disconnected:text.includes('The game stopped sending.'),
        back:buttons.some(b=>b.textContent==='Back to live'), samplesDrawn:panel.querySelectorAll('svg [data-id="v"]').length};
    })()`);
    measurements.push(measured);
    await page.screenshot(join(output, `${name}-${theme}-${width}.png`));
    console.log(`${name} ${theme} ${width}: ${JSON.stringify(measured)}`);
    if (measured.overflow || !measured.samplesDrawn || name === "behind" && !measured.behind || name === "connection-lost" && !measured.disconnected || name === "back-to-live" && !measured.back) throw Error(`Live capture assertion failed: ${name} ${theme} ${width}`);
  }
  if (page.console.some(e => e.type === "exception" || e.type === "error")) throw Error(JSON.stringify(page.console));
  writeFileSync(join(output, "measurements.json"), JSON.stringify(measurements, null, 2));
} finally {
  clearTimeout(deadline); await page?.close(); for (const service of cases.values()) service.close(); server.stop(true);
}

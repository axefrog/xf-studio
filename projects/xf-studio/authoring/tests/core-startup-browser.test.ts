/** Real localhost entry + real host, isolated settings/library/browser profile, no game assets required. */
import { expect } from "bun:test";
import { launch, startServer } from "../tools/cdp";
import { CHROME, chromeInstalled } from "./webgl-harness";
import { oracleTest } from "./optional-oracles";
import { assertStartupPaint, type StartupPaintLayout } from "./fixtures/startup-paint";

const browserTest = oracleTest(chromeInstalled(), `Chrome is unavailable at ${CHROME} (set CHROME)`);
for (const composition of ["normal", "empty"] as const) browserTest(`real start(host) mounts and paints ${composition} composition in verification`, async () => {
  // Reserve an ephemeral port; startServer checks again and refuses any race. No maintained Studio port is used.
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reservation.port!; reservation.stop(true);
  const host = await startServer(port, { settings: "empty" });
  let page: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    page = await launch(`http://127.0.0.1:${port}/?verify=1&composition=${composition}`, { width: 1440, height: 1000,
      scheme: "light", init: `
        localStorage.setItem("xfas.workspace.v1", "normal-sentinel");
        window.startupRequests = [];
        const originalFetch = window.fetch;
        window.fetch = (input, init) => { window.startupRequests.push(String(input)); return originalFetch(input, init); };
      ` });
    await page.waitFor(`document.querySelector("#studio.studio-ready") && window.xfStudioLifetime`, 90_000);
    await verifyShellPaint(page);
    const result = await page.evaluate(`(() => {
      const root = document.getElementById("studio"), box = root.getBoundingClientRect(), p = window.xfStudioPresentation;
      return { ready: root.classList.contains("studio-ready"), error: !!document.querySelector(".boot-error"),
        width: box.width, height: box.height, text: root.textContent.length,
        features: p.features().map(feature => feature.id), starters: !!p.starters, modules: p.views.modules().map(module => module.id),
        normal: localStorage.getItem("xfas.workspace.v1"), saved: localStorage.getItem("xfas.workspace.verification.v1"),
        requests: window.startupRequests, aborted: window.xfStudioLifetime.signal.aborted,
        paints: performance.getEntriesByType("paint").map(entry => entry.name) };
    })()`) as { ready: boolean; error: boolean; width: number; height: number; text: number; features: string[]; starters: boolean;
      modules: string[]; normal: string; saved: string; requests: string[]; aborted: boolean; paints: string[] };
    expect(result).toMatchObject({ ready: true, error: false, normal: "normal-sentinel", aborted: false });
    expect(result.width).toBeGreaterThan(500); expect(result.height).toBeGreaterThan(500); expect(result.text).toBeGreaterThan(100);
    expect(result.paints).toContain("first-contentful-paint"); expect(result.saved).not.toBeNull();
    const protectedRoutes = /^\/api\/(?:documents|workspace-lease|profiles\/migrate|local-settings|collections|part-presets|mod-install|pose-preferences|saves)(?:[/?]|$)/;
    expect(result.requests.filter(url => protectedRoutes.test(new URL(url, `http://127.0.0.1:${port}`).pathname))).toEqual([]);
    expect(result.requests.some(url => url.startsWith("/api/verification/documents"))).toBe(true);
    if (composition === "empty") {
      expect(result.features).toEqual([]); expect(result.modules).toEqual([]); expect(result.starters).toBe(false);
      expect(JSON.parse(result.saved).look.parts).toEqual({});
    } else { expect(result.features).toContain("eye-makeup"); expect(result.starters).toBe(true); }
    expect(page.console.filter(line => ["error", "exception"].includes(line.type))).toEqual([]);
    // The handle is signal-driven. Full resource release/count-baseline assertions belong to slice 13c.
    expect(await page.evaluate(`window.xfStudioLifetime.abort(); window.xfStudioLifetime.signal.aborted`) as boolean).toBe(true);
  } finally { await page?.close(); host.server.kill(); await host.server.exited; }
}, 180_000);

async function verifyShellPaint(page: Awaited<ReturnType<typeof launch>>): Promise<void> {
  const settle = () => page.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const capture = async () => Buffer.from((await page.send<{ data: string }>("Page.captureScreenshot", { format: "png" })).data, "base64");
  const hide = () => page.evaluate(`(() => {
    const style = document.createElement("style"); style.id = "startup-paint-hidden";
    style.textContent = "#studio.studio-ready { opacity: 0 !important; transition: none !important; }";
    document.head.append(style);
  })()`);
  const restore = () => page.evaluate(`document.getElementById("startup-paint-hidden").remove()`);

  // Capture the real page background without changing layout or retaining the boot message.
  await hide();
  let background: Buffer;
  try { await settle(); background = await capture(); } finally { await restore(); }
  await settle();
  const layout = await page.evaluate(`(() => {
    const shown = element => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return false;
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) <= .05) return false;
      }
      return true;
    };
    const measure = (selector, control = false) => {
      const nodes = [...document.querySelectorAll(selector)];
      const visible = node => {
        if (!shown(node)) return false;
        if (!control) return true;
        const rect = node.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, rect.x + rect.width / 2)), Math.max(0, Math.min(innerHeight - 1, rect.y + rect.height / 2)));
        return !!hit && node.contains(hit);
      };
      const node = nodes.find(visible);
      if (!node) return { x: 0, y: 0, width: 0, height: 0, visible: false };
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height, visible: true };
    };
    return { width: innerWidth, height: innerHeight,
      regions: { header: measure("#studio .shell-header"), workspace: measure("#layout-dock"), status: measure("#studio .status-bar") },
      controls: { commands: measure("#studio button.header-commands", true), newTab: measure("#studio .layout-tabs > button", true), panelMenu: measure("#layout-dock button.dock-menu-btn", true) } };
  })()`) as StartupPaintLayout;
  assertStartupPaint(await capture(), background, layout);

  // Negative control: an independently captured transparent mounted shell must fail the same pixel gate,
  // even with the original, still-populated DOM/geometry/visible-control observations.
  await hide();
  try {
    await settle();
    const transparent = await capture();
    expect(() => assertStartupPaint(transparent, background, layout)).toThrow("insufficient non-background pixels");
  } finally { await restore(); }
  await settle();
}

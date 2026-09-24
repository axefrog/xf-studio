/**
 * Browser QA for the built site (local; needs Chrome): bun tools/qa.ts [--no-shots]
 * Serves dist/ under the Pages base path, then for every page × viewport × colour scheme records console/CSP errors,
 * failed requests, horizontal overflow and text contrast, and saves full-page screenshots plus section crops to
 * .evidence/qa-<date>/ (git-ignored). Also exercises the theme override, no-JavaScript fallback and skip link.
 * Screenshots still need a human look; the numbers only catch regressions.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchChrome, type Browser } from "./cdp";
import { basePath, loadConfig, siteRoot } from "./config";
import { serveSite } from "./serve";

type Viewport = { name: string; width: number; height: number; scale: number; mobile: boolean; shots: boolean };
const VIEWPORTS: Viewport[] = [
  { name: "desktop", width: 1440, height: 900, scale: 1, mobile: false, shots: true },
  { name: "tablet", width: 834, height: 1112, scale: 1, mobile: true, shots: true },
  { name: "mobile", width: 390, height: 844, scale: 2, mobile: true, shots: true },
  { name: "narrow", width: 320, height: 640, scale: 1, mobile: true, shots: false },
];
const SCHEMES = ["light", "dark"] as const;
const PAGES = [
  { name: "index", path: "", sections: true },
  { name: "credits", path: "credits.html", sections: true },
  { name: "404", path: "no/such/page", sections: false, expectStatus: 404 },
];

/** Runs in the page: WCAG contrast of every visible text run against its composited background. */
const CONTRAST = `(() => {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const rgba = c => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, bottom) => [0, 1, 2].map(i => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1);
  const lum = c => { const [r, g, b] = c.slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const background = el => {
    const layers = []; let image = false;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== "none" && !node.classList.contains("stage")) image = true;
      layers.push(rgba(style.backgroundColor));
    }
    let color = [255, 255, 255, 1];
    for (const layer of layers.reverse()) color = over(layer, color);
    return { color, image };
  };
  const failures = []; let checked = 0, skipped = 0, min = Infinity;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const el = text.parentElement;
    if (!text.textContent.trim() || seen.has(el) || el.closest("svg, .sr-only, [hidden]")) continue;
    seen.add(el);
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const rect = el.getBoundingClientRect(); if (rect.width < 1 || rect.height < 1) continue;
    const style = getComputedStyle(el);
    const bg = background(el);
    if (bg.image) { skipped++; continue; }
    const fg = over(rgba(style.color), bg.color);
    const size = parseFloat(style.fontSize), weight = Number(style.fontWeight) || 400;
    const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
    const value = ratio(fg, bg.color); checked++; min = Math.min(min, value);
    if (value < need) failures.push({ text: text.textContent.trim().slice(0, 60), element: el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ").join(".") : ""), ratio: +value.toFixed(2), need, fg: fg.slice(0, 3), bg: bg.color.slice(0, 3) });
  }
  return { checked, skipped, min: +min.toFixed(2), failures };
})()`;

const LAYOUT = `(() => {
  const width = document.documentElement.clientWidth;
  const offenders = [...document.querySelectorAll("body *")].filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.right > width + 1 || r.left < -1) && !el.closest(".site-nav, .skip-link, .sr-only"); })
    .slice(0, 8).map(el => el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").join(".") : "") + " right=" + Math.round(el.getBoundingClientRect().right));
  const smallTargets = [...document.querySelectorAll("a, button")].filter(el => el.checkVisibility() && !el.closest("p, li p, dd, .sr-only") && !el.classList.contains("skip-link"))
    .filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.height < 24 || r.width < 24); }).map(el => (el.textContent.trim() || el.getAttribute("aria-label") || el.tagName).slice(0, 30));
  return { scrollWidth: document.documentElement.scrollWidth, clientWidth: width, offenders, smallTargets,
    theme: document.documentElement.dataset.theme ?? "system", bodyBackground: getComputedStyle(document.body).backgroundColor,
    cssLoaded: getComputedStyle(document.querySelector(".site-header")).borderBottomStyle === "solid" };
})()`;

async function waitForLoad(page: Browser, url: string) {
  const loaded = new Promise<void>(ok => { const off = page.on(event => { if (event.method === "Page.loadEventFired") { off(); ok(); } }); });
  await page.send("Page.navigate", { url });
  await Promise.race([loaded, Bun.sleep(10000)]);
  await page.evaluate("document.fonts ? document.fonts.ready.then(() => true) : true");
}

async function screenshot(page: Browser, file: string, clip?: { x: number; y: number; width: number; height: number }) {
  const metrics = await page.send<any>("Page.getLayoutMetrics");
  const size = metrics.cssContentSize;
  const area = clip ?? { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height) };
  const shot = await page.send<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...area, scale: 1 } });
  writeFileSync(file, Buffer.from(shot.data, "base64"));
}

const config = loadConfig({ baseUrl: "http://127.0.0.1/" + basePath(loadConfig()).slice(1) });
const shots = !process.argv.includes("--no-shots");
const date = new Date().toISOString().slice(0, 10);
const outDir = join(siteRoot, ".evidence", `qa-${date}`);
mkdirSync(outDir, { recursive: true });
const server = serveSite({ port: 0 });
const origin = `http://127.0.0.1:${server.port}`;
const base = origin + basePath(config);
const page = await launchChrome();
const results: any[] = [];
const problems: string[] = [];
try {
  const log: { kind: string; text: string; url?: string }[] = [];
  page.on(({ method, params }) => {
    if (method === "Runtime.exceptionThrown") log.push({ kind: "exception", text: params.exceptionDetails.exception?.description ?? params.exceptionDetails.text });
    if (method === "Runtime.consoleAPICalled" && ["error", "warning", "assert"].includes(params.type)) log.push({ kind: `console.${params.type}`, text: params.args.map((a: any) => a.value ?? a.description).join(" ") });
    if (method === "Log.entryAdded" && ["error", "warning"].includes(params.entry.level)) log.push({ kind: `log.${params.entry.level}`, text: params.entry.text, url: params.entry.url });
    if (method === "Network.responseReceived" && params.response.status >= 400) log.push({ kind: `http.${params.response.status}`, text: params.response.url, url: params.response.url });
    if (method === "Network.loadingFailed" && !params.canceled) log.push({ kind: "net.failed", text: params.errorText });
  });
  for (const domain of ["Page", "Runtime", "Log", "Network"]) await page.send(`${domain}.enable`);
  await page.send("Network.setCacheDisabled", { cacheDisabled: true });
  await waitForLoad(page, base);
  await page.evaluate("localStorage.clear()");

  for (const viewport of VIEWPORTS) {
    await page.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.scale, mobile: viewport.mobile });
    for (const scheme of SCHEMES) {
      await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "reduce" }] });
      for (const target of PAGES) {
        log.length = 0;
        await waitForLoad(page, base + target.path);
        await Bun.sleep(150);
        const layout = await page.evaluate<any>(LAYOUT);
        const contrast = await page.evaluate<any>(CONTRAST);
        const unexpected = log.filter(entry => !(target.expectStatus && entry.url === base + target.path && (entry.kind === `http.${target.expectStatus}` || entry.kind === "log.error")));
        const id = `${target.name}-${viewport.name}-${scheme}`;
        const record = { id, viewport: viewport.name, width: viewport.width, scheme, page: target.name, layout, contrast, log: unexpected };
        results.push(record);
        if (layout.scrollWidth > layout.clientWidth) problems.push(`${id}: horizontal overflow ${layout.scrollWidth} > ${layout.clientWidth} (${layout.offenders.join(", ")})`);
        if (!layout.cssLoaded) problems.push(`${id}: stylesheet did not apply`);
        if (layout.theme !== "system") problems.push(`${id}: expected system theme, found ${layout.theme}`);
        if (contrast.failures.length) problems.push(`${id}: ${contrast.failures.length} contrast failure(s), e.g. ${JSON.stringify(contrast.failures[0])}`);
        if (unexpected.length) problems.push(`${id}: ${unexpected.map(e => `${e.kind} ${e.text}`).join(" | ")}`);
        if (layout.smallTargets.length) problems.push(`${id}: targets under 24px: ${layout.smallTargets.join(", ")}`);
        if (shots && viewport.shots) {
          await screenshot(page, join(outDir, `${id}.png`));
          if (target.sections) {
            const boxes = await page.evaluate<any[]>(`[...document.querySelectorAll("body > header, main > section, main > header, body > footer")].map((el, i) => { const r = el.getBoundingClientRect(); return { i, id: el.id || el.className.split(" ")[0], x: 0, y: Math.round(r.top + scrollY), width: document.documentElement.clientWidth, height: Math.round(r.height) }; })`);
            for (const box of boxes) await screenshot(page, join(outDir, `${id}--${String(box.i).padStart(2, "0")}-${box.id}.png`), { x: box.x, y: box.y, width: box.width, height: box.height });
          }
        }
      }
    }
  }

  // Theme override: Light persists across reload, System clears it.
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await waitForLoad(page, base);
  const theme: Record<string, unknown> = {};
  theme.initial = await page.evaluate(`({ theme: document.documentElement.dataset.theme ?? "system", visible: !document.querySelector("[data-theme-switch]").hidden, pressed: document.querySelector("[aria-pressed=true]").dataset.themeChoice })`);
  await page.evaluate(`document.querySelector("[data-theme-choice=light]").click()`);
  theme.afterLight = await page.evaluate(`({ theme: document.documentElement.dataset.theme, stored: localStorage.getItem("xf-studio-site:theme"), bg: getComputedStyle(document.body).backgroundColor })`);
  await waitForLoad(page, base + "credits.html");
  theme.afterNavigate = await page.evaluate(`({ theme: document.documentElement.dataset.theme, pressed: document.querySelector("[aria-pressed=true]").dataset.themeChoice, themeColor: document.querySelector('meta[name=theme-color]').content })`);
  if (shots) await screenshot(page, join(outDir, "theme-override-light-on-dark-system.png"), { x: 0, y: 0, width: 1440, height: 900 });
  await page.evaluate(`document.querySelector("[data-theme-choice=system]").click()`);
  theme.afterSystem = await page.evaluate(`({ theme: document.documentElement.dataset.theme ?? "system", stored: localStorage.getItem("xf-studio-site:theme") })`);
  const t = theme as any;
  if (t.initial.theme !== "system" || !t.initial.visible || t.initial.pressed !== "system") problems.push(`theme: unexpected initial state ${JSON.stringify(t.initial)}`);
  if (t.afterLight.theme !== "light" || t.afterLight.stored !== "light") problems.push(`theme: Light did not apply/persist ${JSON.stringify(t.afterLight)}`);
  if (t.afterNavigate.theme !== "light" || t.afterNavigate.pressed !== "light" || t.afterNavigate.themeColor !== "#fcfdff") problems.push(`theme: override lost after navigation ${JSON.stringify(t.afterNavigate)}`);
  if (t.afterSystem.theme !== "system" || t.afterSystem.stored !== null) problems.push(`theme: System did not clear the override ${JSON.stringify(t.afterSystem)}`);

  // Skip link is the first focus stop and becomes visible.
  await waitForLoad(page, base);
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await Bun.sleep(200);
  const skip = await page.evaluate<any>(`(() => { const el = document.activeElement; const r = el.getBoundingClientRect(); return { cls: el.className, top: Math.round(r.top), visible: r.top >= 0 && r.bottom <= innerHeight, outline: getComputedStyle(el).outlineStyle }; })()`);
  if (shots) await screenshot(page, join(outDir, "focus-skip-link.png"), { x: 0, y: 0, width: 1440, height: 200 });
  if (skip.cls !== "skip-link" || !skip.visible || skip.outline === "none") problems.push(`skip link: ${JSON.stringify(skip)}`);

  // Without JavaScript the page follows the system scheme and hides the switch.
  await page.send("Emulation.setScriptExecutionDisabled", { value: true });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await waitForLoad(page, base);
  const noJs = await page.evaluate<any>(`({ hidden: document.querySelector("[data-theme-switch]").hidden, bg: getComputedStyle(document.body).backgroundColor })`).catch(() => null);
  await page.send("Emulation.setScriptExecutionDisabled", { value: false });
  if (!noJs?.hidden) problems.push(`no-JS: theme switch visible without script ${JSON.stringify(noJs)}`);

  // Forced colours (Windows high contrast) render for visual review only.
  if (shots) {
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }, { name: "prefers-color-scheme", value: "dark" }] });
    await waitForLoad(page, base);
    await screenshot(page, join(outDir, "forced-colors-index-desktop.png"), { x: 0, y: 0, width: 1440, height: 1800 });
  }

  const summary = { date, base, chrome: await page.evaluate("navigator.userAgent"), scenarios: results.length, problems, theme, skip, noJs,
    contrastMin: Math.min(...results.map(r => r.contrast.min)), contrastChecked: results.reduce((n, r) => n + r.contrast.checked, 0),
    contrastSkippedOverImages: results.reduce((n, r) => n + r.contrast.skipped, 0), results };
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 1));
  console.log(`${results.length} page scenarios; minimum text contrast ${summary.contrastMin}:1 over ${summary.contrastChecked} text runs (${summary.contrastSkippedOverImages} over images skipped).`);
  console.log(`Evidence: ${outDir}`);
  for (const problem of problems) console.error(`✗ ${problem}`);
  if (problems.length) process.exitCode = 1; else console.log("Browser QA passed.");
} finally {
  await page.close();
  server.stop(true);
}

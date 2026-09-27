/**
 * Captures of the Expression drawer's Transitions (research/animation/expression-editor-design.md §5.5) for design review, in an isolated
 * `?verify=1` workspace with a throwaway Chrome profile and its own authoring server (own port, own data folder; never 4317 or the
 * person's draft):
 *
 * - **Filmstrip:** the 3D head changing from one natural expression to another with Animate changes on (3 s, Linear, so time and blend
 *   agree), captured as fast as Chrome allows; the frames nearest 0, 25, 50, 75 and 100 % are composed into one strip, labelled with
 *   the progress each was really taken at. A second strip changes target halfway, to show that the change starts from the face on screen.
 * - **Drawer:** the Transitions section off and on, light and dark, at a narrow (300 px) and a wide (480 px) panel, and the style
 *   guide's Segmented specimen (the pattern Curve follows) in both themes.
 *
 * The body is turned off (the head alone shows) and the head is shown unmasked: keep outputs in the ignored local capture tree. The live
 * face needs the facial solver (`XFS_FACIAL_SOLVER`, `XFS_PYTHON`); point the caches at a warm checkout's (`XFS_PREVIEW_CORE_CACHE`,
 * `XFS_RESOLVER_CACHE`, `XFS_ASSET_OVERLAY`) with `XFS_PREPARED_BUDGET_GB=off` so nothing there is evicted.
 *
 *   bun tools/expression-transition-look.ts <out dir> [port]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { launch, startServer } from "./cdp";

const [outArg, portArg = "4483"] = process.argv.slice(2);
if (!outArg) throw Error("Usage: bun tools/expression-transition-look.ts <out dir> [port]");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const port = +portArg;
const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1440, height: 960, scheme: "dark", debugPort: port + 5000 });
const shots: string[] = [];
const notes: Record<string, unknown> = {};
const t0 = Date.now();
const log = (what: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s: ${what}`);
type Box = { x: number; y: number; width: number; height: number };
const box = (selector: string) => page.evaluate(`(() => { const e = ${selector}; if (!e) return null; const r = e.getBoundingClientRect();
  // Document coordinates (a capture's clip is), so a scrolled page (the style guide) captures what is on screen.
  return { x: Math.max(0, r.x) + scrollX, y: Math.max(0, r.y) + scrollY, width: Math.min(r.width, innerWidth - Math.max(0, r.x)),
    height: Math.min(r.height, innerHeight - Math.max(0, r.y)) }; })()`) as Promise<Box | null>;
const snap = async (name: string, selector: string) => {
  const clip = await box(selector);
  if (!clip) { console.log(`missing: ${name}`); return; }
  await page.screenshot(resolve(out, `${name}.png`), clip);
  shots.push(name);
};
const theme = async (scheme: "light" | "dark") => {
  await page.colorScheme(scheme);
  await page.evaluate(`(() => { const root = document.documentElement; root.dataset.theme = ${JSON.stringify(scheme)}; root.style.colorScheme = ${JSON.stringify(scheme)}; })()`);
  await page.wait(300);
};
const dispatch = (action: object) => page.evaluate(`window.xfStudioPresentation.authoring.dispatch(${JSON.stringify(action)})`);
const drawerWindow = `document.querySelector(".expr-drawer")?.closest(".dock-window, .dock-group")`;
const scrollTo = (selector: string) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e?.scrollIntoView({ block: "start" }); return !!e; })()`);
/** A natural sample's controls and links, from the facial preview's snapshot. */
const sample = (name: string) => page.evaluate(`(() => { const s = window.xfStudioPresentation.facial.snapshot().samples.find(x => x.name.toLowerCase().startsWith(${JSON.stringify(name.toLowerCase())}));
  return s ? { id: s.id, name: s.name, controls: s.controls, links: s.links } : null; })()`) as Promise<{ id: string; name: string; controls: object; links: object } | null>;
const startFrom = async (name: string) => {
  const s = await sample(name);
  if (!s) throw Error(`No natural sample named ${name}`);
  return dispatch({ kind: "expression.startFrom", origin: { kind: "preset", id: s.id, name: s.name }, controls: s.controls, links: s.links });
};
/** Frames of the head view while a change plays: each JPEG with the ms since the change was made (the midpoint of its capture). */
async function record(clip: Box, ms: number, change: () => Promise<unknown>, midway?: { at: number; change: () => Promise<unknown> }) {
  const first = await page.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 92, clip: { ...clip, scale: 1 }, captureBeyondViewport: false });
  const frames: { t: number; data: string }[] = [{ t: 0, data: first.data }];
  await change();
  const start = Date.now();
  let changed = false;
  while (Date.now() - start < ms) {
    if (midway && !changed && Date.now() - start >= midway.at) { await midway.change(); changed = true; notes.midwayAt = Date.now() - start; }
    const before = Date.now() - start;
    const shot = await page.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 92, clip: { ...clip, scale: 1 }, captureBeyondViewport: false });
    frames.push({ t: (before + Date.now() - start) / 2, data: shot.data });
  }
  return frames;
}
/** The frames nearest each target time, composed side by side with their labels, as one PNG (rendered in a blank tab of the same Chrome). */
async function strip(name: string, title: string, frames: { t: number; data: string }[], targets: { at: number; label: (t: number) => string }[]) {
  const picked = targets.map(target => { const frame = frames.reduce((a, b) => Math.abs(b.t - target.at) < Math.abs(a.t - target.at) ? b : a); return { frame, label: target.label(frame.t) }; });
  const html = `<html><body style="margin:0;background:#15181c;font:600 15px system-ui;color:#e6e8eb"><div id="s" style="display:inline-flex;flex-direction:column;gap:8px;padding:12px">
    <div>${title}</div><div style="display:flex;gap:8px">${picked.map(p => `<figure style="margin:0;display:flex;flex-direction:column;gap:6px;align-items:center">
    <img src="data:image/jpeg;base64,${p.frame.data}" style="width:250px;display:block"><figcaption>${p.label}</figcaption></figure>`).join("")}</div></div></body></html>`;
  writeFileSync(resolve(out, `${name}.html`), html);
  await page.send("Page.navigate", { url: `file:///${resolve(out, `${name}.html`).replaceAll("\\", "/")}` });
  await page.wait(1500);
  await snap(name, `document.getElementById("s")`);
  notes[name] = picked.map(p => ({ at: Math.round(p.frame.t), label: p.label }));
}

try {
  await page.waitFor("document.querySelector('.dock-group') && !!window.xfStudioShell && !!window.xfStudioPresentation", 120000);
  log("page ready");
  await page.waitFor(`window.xfStudioPresentation.authoring.capability({ kind: "preview.setBody", enabled: false }).available`, 300000).catch(() => {});
  await dispatch({ kind: "preview.setBody", enabled: false }).catch(() => {});
  log("body off");
  await page.evaluate(`window.xfStudioShell.runtime.modules.set("expressions", true)`);
  await page.wait(800);
  await page.evaluate(`window.xfStudioShell.dock.reveal("expressions.controls")`);
  await page.waitFor(`document.querySelectorAll(".expr-drawer .group-section").length > 0`, 300000);
  await page.waitFor(`window.xfStudioPresentation.facial.snapshot().samples.length > 0`, 120000);
  log("drawer built");

  if (!process.env.ONLY_HARNESS) {
  // ---- The drawer: Transitions off, then on, both themes, narrow and wide. ----
  await startFrom("Warm smile");
  for (const scheme of ["dark", "light"] as const) {
    await theme(scheme);
    for (const width of [300, 480]) {
      await page.evaluate(`window.xfStudioShell.dock.moveTo("expressions.controls", { kind: "float", x: ${1420 - width}, y: 30, w: ${width}, h: 900 }, "")`);
      await page.wait(700);
      for (const enabled of [false, true]) {
        await dispatch({ kind: "transition.set", source: "expression", enabled, seconds: 1, easing: "linear" });
        await page.wait(400);
        await scrollTo(".expr-drawer");
        await snap(`${scheme}-${width}-${enabled ? "on" : "off"}`, drawerWindow);
      }
      // On with another curve and duration, and the Curve's tooltip-named segments.
      await dispatch({ kind: "transition.set", source: "expression", enabled: true, seconds: 0.75, easing: "inOutStrong" });
      await page.wait(400);
      await snap(`${scheme}-${width}-on-strong`, `document.querySelector('.expr-drawer [data-view-key="expressions.transitions"]')`);
      // Beside the reference pattern, a switch over the slider it unlocks: Pigment & edge's Smooth point gradients → Point blend, off.
      await dispatch({ kind: "transition.set", source: "expression", enabled: false, seconds: 1, easing: "linear" });
      await page.evaluate(`window.xfStudioShell.dock.reveal("edge")`);
      await page.evaluate(`(() => { const row = [...document.querySelectorAll(".toggle-row")].find(r => r.textContent.includes("Smooth point gradients"));
        const input = row?.querySelector("input"); if (input?.checked) input.click(); })()`);
      await page.evaluate(`window.xfStudioShell.dock.moveTo("edge", { kind: "float", x: ${1400 - 2 * width}, y: 30, w: ${width}, h: 900 }, "")`);
      await page.evaluate(`window.xfStudioShell.dock.reveal("expressions.controls")`);
      await page.wait(900);
      // Transitions at the drawer's top, beside Pigment strength at the Pigment & edge panel's.
      await scrollTo('.expr-drawer [data-view-key="expressions.transitions"]');
      await page.wait(300);
      await page.screenshot(resolve(out, `${scheme}-${width}-beside-point-blend.png`), { x: 1390 - 2 * width, y: 20, width: 2 * width + 40, height: 400 });
      shots.push(`${scheme}-${width}-beside-point-blend`);
    }
  }
  // ---- Focus, hover and the curves' names (dark, narrow). ----
  await theme("dark");
  await page.evaluate(`window.xfStudioShell.dock.moveTo("expressions.controls", { kind: "float", x: 1120, y: 30, w: 300, h: 900 }, "")`);
  await dispatch({ kind: "transition.set", source: "expression", enabled: true, seconds: 1, easing: "linear" });
  await page.wait(600);
  await scrollTo(".expr-drawer");
  const section = `document.querySelector('.expr-drawer [data-view-key="expressions.transitions"]')`;
  // Keyboard focus (a key first, so the browser shows the focus ring): the switch, then the chosen curve, then one step right.
  await page.key("Shift");
  await page.evaluate(`document.querySelector('.expr-drawer .expr-animate input').focus()`);
  await page.wait(200);
  await snap("dark-300-focus-switch", section);
  await page.evaluate(`document.querySelector('.expr-drawer .expr-curve .segment[tabindex="0"]').focus()`);
  await page.wait(200);
  await snap("dark-300-focus-curve", section);
  await page.key("ArrowRight", { code: "ArrowRight" });
  await page.wait(200);
  await snap("dark-300-focus-curve-arrow", section);
  notes.focusAfterArrow = await page.evaluate(`document.activeElement?.getAttribute("aria-label")`);
  // Hover on Strong ease out. Chrome draws a native tooltip outside the page, so no capture shows it: its words are recorded here.
  const hovered = await box(`document.querySelectorAll('.expr-drawer .expr-curve .segment')[3]`);
  if (hovered) {
    await page.evaluate(`document.activeElement?.blur()`);
    await page.mouse("mouseMoved", hovered.x + hovered.width / 2, hovered.y + hovered.height / 2);
    await page.wait(400);
    await snap("dark-300-hover-curve", section);
    notes.hoverTooltip = await page.evaluate(`document.querySelectorAll('.expr-drawer .expr-curve .segment')[3].title`);
    await page.mouse("mouseMoved", 10, 10);
  }
  // Intensity's curves beside the Curve strip: one control, frameless on its label line.
  for (const width of [300, 480]) for (const scheme of ["dark", "light"] as const) {
    await page.evaluate(`window.xfStudioShell.dock.moveTo("expressions.controls", { kind: "float", x: ${1420 - width}, y: 30, w: ${width}, h: 900 }, "")`);
    await page.wait(500);
    await scrollTo(".expr-drawer");
    await theme(scheme);
    await snap(`${scheme}-${width}-transitions-and-intensity`, `(() => { const a = document.querySelector('.expr-drawer [data-view-key="expressions.transitions"]'),
      b = document.querySelector('.expr-drawer [data-view-key="expressions.adjust-all"]'); if (!a || !b) return null;
      const r = a.getBoundingClientRect(), q = b.getBoundingClientRect(); return { getBoundingClientRect: () => ({ x: r.x, y: r.y, width: r.width, height: q.bottom - r.y }) }; })()`);
  }
  // The pattern Curve follows: the style guide's Segmented specimens, in both themes.
  await page.send("Page.navigate", { url: `file:///${resolve(import.meta.dir, "..", "public", "style-guide.html").replaceAll("\\", "/")}#lib-segmented` });
  await page.waitFor(`!!document.querySelector("#lib-segmented .segmented.icon-only")`, 30000).catch(() => log("style guide specimen not found"));
  await page.wait(500);
  for (const scheme of ["dark", "light"] as const) {
    await theme(scheme);
    await page.evaluate(`document.getElementById("lib-segmented")?.scrollIntoView({ block: "start" })`);
    await page.wait(400);
    await snap(`${scheme}-style-guide-segmented`, `document.querySelector("#lib-segmented .live-specimen")`);
  }

  // ---- The filmstrip: back to the Studio, dark, the head from the front. ----
  await page.send("Page.navigate", { url: `http://127.0.0.1:${port}/?verify=1` });
  await page.waitFor("document.querySelector('.dock-group') && !!window.xfStudioShell && !!window.xfStudioPresentation", 120000);
  await theme("dark");
  await page.waitFor(`window.xfStudioPresentation.facial.snapshot().phase === "ready" || window.xfStudioPresentation.facial.snapshot().phase === "idle"`, 600000);
  log(`face: ${JSON.stringify(await page.evaluate(`(() => { const s = window.xfStudioPresentation.facial.snapshot(); return { phase: s.phase, reason: s.reason, latency: s.latency }; })()`))}`);
  await page.evaluate(`window.xfStudioShell.dock.moveTo("expressions.controls", { kind: "float", x: 1120, y: 30, w: 300, h: 900 }, "")`);
  // The head from the front, without eye makeup's on-head editing controls.
  await dispatch({ kind: "view.setTool", tool: "eye-makeup.surface", enabled: false }).catch(() => {});
  await dispatch({ kind: "camera.front" });
  await page.wait(1500);
  const head = await box(`document.querySelector(".viewport-slot")`);
  if (!head) throw Error("No 3D view to capture.");
  await page.screenshot(resolve(out, "head-view.png"), head);
  // The face: brows to chin, square, from the middle of the head view (FACE_Y and FACE_SIDE as fractions of the view, to re-frame).
  const side = Math.min(head.width, head.height) * Number(process.env.FACE_SIDE ?? 0.7);
  const face: Box = { x: Math.round(head.x + head.width / 2 - side / 2), y: Math.round(head.y + head.height * Number(process.env.FACE_Y ?? 0.5) - side / 2),
    width: Math.round(side), height: Math.round(side) };
  await dispatch({ kind: "transition.set", source: "expression", enabled: false });
  await startFrom("Warm smile");
  await page.wait(1500);
  await dispatch({ kind: "transition.set", source: "expression", enabled: true, seconds: 3, easing: "linear" });
  const seconds = 3000;
  const pct = (t: number) => `${Math.round(Math.min(100, Math.max(0, t / seconds * 100)))} % (${(t / 1000).toFixed(2)} s)`;
  const plain = await record(face, seconds + 700, () => startFrom("Mild surprise"));
  notes.frames = plain.length;
  log(`${plain.length} frames over ${(seconds + 700) / 1000} s`);
  await page.wait(800);
  const midway = await record(face, seconds + 2200, () => startFrom("Warm smile"), { at: 1500, change: () => startFrom("Confusion") });
  log(`${midway.length} frames with a change halfway`);
  await strip("filmstrip-warm-smile-to-mild-surprise", "Warm smile → Mild surprise · Animate changes on, 3 s, Linear (progress at capture)", plain,
    [0, 0.25, 0.5, 0.75, 1].map(f => ({ at: f * seconds, label: pct })));
  const at = (notes.midwayAt as number | undefined) ?? 1500;
  await strip("filmstrip-interrupted", `Mild surprise → Warm smile, changed to Confusion at ${(at / 1000).toFixed(2)} s · 3 s, Linear`, midway,
    [0, at - 60, at + 150, at + 1500, at + 3000].map(t => ({ at: t, label: (x: number) => `${(x / 1000).toFixed(2)} s${x >= at ? " (after the change)" : ""}` })));
  }
  // ---- The live face preview isn't connected (a host without the facial preview; no Studio host reaches it today): the drawer on its
  // own, with the Studio's stylesheet, over a fake view context with no facial preview. ----
  const harness = resolve(tmpdir(), `xfs-transition-harness-${Date.now()}`);
  mkdirSync(harness, { recursive: true });
  const drawerPath = resolve(import.meta.dir, "..", "src", "features", "expressions", "view", "drawer.ts").replaceAll("\\", "/");
  writeFileSync(resolve(harness, "entry.ts"), `import { expressionDrawer } from "${drawerPath}";
    const ctx = { facade: { view: () => ({ part: { controls: {}, links: {} } }), editable: () => ({ available: true }), controlBegin: () => true,
      controlEdit: () => ({ ok: true }), controlCommit: () => {}, controlCancel: () => {} }, dispatch: () => true, platform: () => true,
      feedback: { toast: () => {}, announce: () => {}, record: () => {} }, easing: { get: () => undefined, set: () => {} },
      facial: { snapshot: () => undefined, retry: () => {} },
      presets: { list: () => ({ phase: "ready", items: [] }), capability: () => ({ available: true }), execute: async () => ({ ok: true }) },
      links: { open: async () => {} }, openSettings: () => {} };
    for (const width of [300, 480]) { const panel = expressionDrawer(ctx as never); panel.update(undefined as never);
      const host = document.createElement("div"); host.className = "harness"; host.style.width = width + "px"; host.append(panel.spec.element);
      document.getElementById("hosts")!.append(host); }`);
  const built = await Bun.build({ entrypoints: [resolve(harness, "entry.ts")], outdir: harness, target: "browser", format: "iife" });
  if (!built.success) throw Error(built.logs.map(String).join("\n"));
  const css = resolve(import.meta.dir, "..", "public", "studio.css").replaceAll("\\", "/");
  writeFileSync(resolve(harness, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="file:///${css}"><style>body{margin:0;background:var(--bg-app)}
    #hosts{display:flex;gap:24px;padding:16px;align-items:flex-start}.harness{background:var(--bg-panel);border:1px solid var(--line)}</style></head>
    <body><div id="hosts"></div><script src="entry.js"></script></body></html>`);
  await page.send("Page.navigate", { url: `file:///${resolve(harness, "index.html").replaceAll("\\", "/")}` });
  await page.waitFor(`document.querySelectorAll(".harness").length === 2`, 30000);
  for (const scheme of ["dark", "light"] as const) {
    await theme(scheme);
    for (const [index, width] of [[0, 300], [1, 480]] as const) {
      // The drawer's top (its status line says the preview isn't connected) down to Transitions: the state is said once.
      await snap(`${scheme}-${width}-not-connected`, `(() => { const h = document.querySelectorAll(".harness")[${index}], s = h?.querySelector('[data-view-key="expressions.transitions"]');
        if (!h || !s) return null; const a = h.getBoundingClientRect(), b = s.getBoundingClientRect();
        return { getBoundingClientRect: () => ({ x: a.x, y: a.y, width: a.width, height: b.bottom - a.y }) }; })()`);
    }
  }

  writeFileSync(resolve(out, "run.json"), JSON.stringify({ date: new Date().toISOString(), shots, notes,
    console: page.console.filter(m => m.type === "error" || m.type === "exception").slice(0, 20) }, null, 2));
  console.log(`Wrote ${shots.length} captures to ${out}`);
} finally { await page.close(); server.kill(); }

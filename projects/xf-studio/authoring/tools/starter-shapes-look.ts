/**
 * Coordinator-only captures for the starter eye-makeup shapes (research/backlog/README.md, polish lane):
 *
 *   bun tools/starter-shapes-look.ts <output-folder-on-C> [port=4571] [--only uv,menu,save,head] [--no-game]
 *
 * It never uses the person's server or draft: a disposable-data server (`startServer`: a throwaway data folder holding a read-only copy of
 * the host's local settings, as experiments/044-profile-tabs/capture-p2-6.ts seeds it, so the real 3D head prepares), a headless Chrome
 * with a throwaway profile, the isolated `?verify=1` workspace, and the real actions. Sections (each light and dark):
 *
 *   uv     the UV map holding one layer of each starter (every contributed one, "Wing (original)" included), in both eye modes
 *          (Both eyes, Single eye)
 *   menu   the starter menu beside Add layer at 300 px and 620 px panel widths: eye makeup's starters alone, then with own starters
 *          (a long name, a same-named pair, one the default, so the Default mark sits on a long row)
 *   save   Save shape as starter…: the layer's menu, the name popover, the notice, and the saved starter in the menu
 *   head   the 3D view on the game's default feminine V and its default masculine V with each starter, both eyes and the brow in frame, from
 *          the front (the hair is off, so no strand covers a lid; every menu, popover and floating panel is closed first, and each shot records
 *          whether anything was open over the view)
 *
 * Verification hooks (installed only with ?verify=1, compose/studio-startup.ts):
 *   window.xfStudioStarters.fixtures()   saves the own starters above through the real owner and makes the first the default
 *   window.xfStudioStarters.only(id)     the shown look holds one layer of starter `id` (the others removed), through the real actions
 *   window.xfStudioStarters.defaultId()  the starter new layers use now
 * and the existing xfStudioShell.dock.moveTo / xfStudioShell.runtime.dispatch / xfStudioPresentation. The menu opens by pressing the
 * chevron beside Add layer (its name is "Add a layer from a starter shape").
 *
 * Not run in the implementation sandbox (no browser or GPU); it typechecks with `bun run check`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, startServer, type Session } from "./cdp";
import { EYE_STARTERS } from "../src/features/eye-makeup/starters";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); if (at < 0) return undefined; const value = args[at + 1]; args.splice(at, 2); return value; };
const bare = (name: string) => { const at = args.indexOf(name); if (at < 0) return false; args.splice(at, 1); return true; };
const only = flag("--only"), noGame = bare("--no-game");
// Baselines use explicit game/tool environment overrides and never borrow personal settings.
const emptySettings = bare("--empty-settings");
const want = (section: string) => !only || only.split(",").includes(section);
const [outArg, portArg] = args;
if (!outArg) throw Error("Usage: bun tools/starter-shapes-look.ts <output-folder-on-C> [port=4571] [--only uv,menu,save,head] [--no-game]");
const out = resolve(outArg), port = Number(portArg ?? 4571);
if ([port, port + 5000].some(p => p === 4317 || p === 4331)) throw Error("That port is the person's own Studio.");
if (process.platform === "win32" && !/^C:[\\/]/i.test(out)) throw Error("Keep capture work on C.");
mkdirSync(out, { recursive: true });

const P = "window.xfStudioPresentation", S = "window.xfStudioShell", X = "window.xfStudioStarters";
const NARROW = 300, WIDE = 620, HEIGHT = 900;
type Box = { x: number; y: number; width: number; height: number };
const shots: { name: string; section: string; shows: string }[] = [], notes: Record<string, unknown> = {};
const unreached: { state: string; why: string }[] = [];

const run = (page: Session, action: object) => page.evaluate(`${S}.runtime.dispatch(${JSON.stringify(action)})`);
const clip = (page: Session, selectors: string[], pad = 8) => page.evaluate(`(() => {
  const rects = ${JSON.stringify(selectors)}.flatMap(s => [...document.querySelectorAll(s)]).filter(e => e && !e.hidden && !e.closest("[hidden]")).map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
  if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.max(0, Math.min(...rects.map(r => r.left)) - ${pad}), y = Math.max(0, Math.min(...rects.map(r => r.top)) - ${pad});
  const right = Math.min(innerWidth, Math.max(...rects.map(r => r.right)) + ${pad}), bottom = Math.min(innerHeight, Math.max(...rects.map(r => r.bottom)) + ${pad});
  return { x: x + scrollX, y: y + scrollY, width: right - x, height: bottom - y };
})()`) as Promise<Box>;
const theme = async (page: Session, value: "light" | "dark") => {
  await page.colorScheme(value);
  await page.evaluate(`(() => { const r = document.documentElement; r.dataset.theme = ${JSON.stringify(value)}; r.style.colorScheme = ${JSON.stringify(value)}; })()`);
  await page.wait(300);
};
/** The clip of `selectors` as it is now, light and dark, named `<name>-<scheme>.png`. */
async function capture(page: Session, name: string, selectors: string[], section: string, shows: string, pad = 8) {
  for (const value of ["light", "dark"] as const) {
    await theme(page, value);
    const area = await clip(page, selectors, pad);
    if (area.width > 0 && area.height > 0) {
      await page.screenshot(join(out, `${name}-${value}.png`), area);
      if (value === "light") shots.push({ name: `${name}-{light,dark}`, section, shows });
    } else { unreached.push({ state: name, why: `nothing matched ${selectors.join(", ")}` }); break; }
  }
  await theme(page, "light");
}
/**
 * Every menu, popover and floating panel closed before a state: Escape twice (a menu, then a popover), then the shown tab reset to its
 * default arrangement (which docks the panels a section floated; `reset` false leaves the camera alone between shots). Returns what is still open over the page, which should be nothing.
 */
async function tidy(page: Session, reset = true): Promise<string[]> {
  await page.key("Escape"); await page.key("Escape");
  if (reset) await page.evaluate(`(() => { const shown = ${P}.tabs?.snapshot().shown; if (shown) ${S}.runtime.dispatch({ kind: "tabs.reset", tab: shown }); })()`).catch(() => {});
  await page.wait(500);
  return await page.evaluate(`[...document.querySelectorAll(".menu, .popover, .dock-floating > *")].filter(e => e.getClientRects().length).map(e => e.className)`) as string[];
}
const press = (page: Session, find: string) => page.evaluate(`(() => { const e = ${find}; if (!e) return false; e.click(); return true; })()`) as Promise<boolean>;
const MENU = `.menu-layer .menu`;
const chevron = `document.querySelector('button[aria-label="Add a layer from a starter shape"]')`;
const item = (label: string) => `[...document.querySelectorAll(".menu-item")].find(e => e.querySelector(".menu-label")?.textContent?.startsWith(${JSON.stringify(label)}))`;
const headReady = `${P}.viewport.snapshot().head.phase === "ready"`;
const settle = async (page: Session) => { await page.waitFor(`${P}.previewReadiness.snapshot().phase === "ready"`, 240_000).catch(() => {}); await page.wait(1200); };
const floatLayers = (page: Session, width: number) =>
  page.evaluate(`${S}.dock.moveTo("layers", { kind: "float", x: 24, y: 24, w: ${width}, h: 640 }, "Capture starter shapes")`);

const { server } = await startServer(port, { settings: noGame || emptySettings ? "empty" : "copy" });
let page: Session | undefined;
try {
  page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1600, height: HEIGHT, scheme: "light", debugPort: port + 5000 });
  await page.waitFor(`!!${S} && !!${P} && !!${X} && !!document.querySelector(".layout-tabs") && !!${P}.library.summary().draft && !${P}.library.summary().busy`, 120_000);
  await page.wait(1500);
  // The game setup card's "Not now" never blocks a capture.
  await press(page, `[...document.querySelectorAll("#preview-card .setup-card-actions button")].find(b => b.textContent.trim() === "Not now" && !b.closest("[hidden]"))`);
  if (!noGame) await page.waitFor(headReady, 240_000).catch(() => unreached.push({ state: "ready head", why: "the 3D head was not ready in four minutes" }));
  notes.contributed = EYE_STARTERS.map(starter => starter.id);
  notes.defaultAtStart = await page.evaluate(`${X}.defaultId()`);

  // ---- The UV map with each starter, both eye modes. ----
  if (want("uv")) for (const starter of EYE_STARTERS) {
    await tidy(page);
    await page.evaluate(`${X}.only(${JSON.stringify(starter.id)})`);
    for (const mode of ["both", "single"] as const) {
      await page.evaluate(`${P}.viewport.uvCommand(${JSON.stringify(mode)})`);
      await page.wait(900);
      await capture(page, `uv-${starter.id}-${mode}`, ["#device-uv"], "uv", `${starter.name} on the UV map, ${mode === "both" ? "Both eyes" : "Single eye"}`, 4);
    }
  }

  // ---- The starter menu at a narrow and a wide panel. ----
  if (want("menu")) {
    const open = async (width: number, state: string, shows: string) => {
      await tidy(page!);
      await floatLayers(page!, width); await page!.wait(500);
      if (!await press(page!, chevron)) { unreached.push({ state: `${state}-${width}`, why: "the chevron beside Add layer was not found" }); return; }
      await page!.waitFor(`!!document.querySelector("${MENU}")`, 5_000).catch(() => {});
      await capture(page!, `menu-${state}-${width}`, [MENU], "menu", `${shows}, ${width} px panel`, 10);
      await page!.key("Escape");
    };
    for (const width of [NARROW, WIDE]) await open(width, "feature-only", "The starter menu with eye makeup's starters alone (Lid wash is the default)");
    await page.evaluate(`${X}.fixtures()`);
    await page.wait(600);
    notes.defaultAfterFixtures = await page.evaluate(`${X}.defaultId()`);
    for (const width of [NARROW, WIDE]) await open(width, "with-own", "The starter menu with own starters: a long name (the default), a same-named pair told apart by when each was saved");
  }

  // ---- Save shape as starter…. ----
  if (want("save")) {
    await tidy(page);
    await floatLayers(page, WIDE); await page.wait(400);
    await press(page, `document.querySelector('button[aria-label^="Actions for"]')`);
    await page.waitFor(`!!${item("Save shape as starter")}`, 5_000).catch(() => {});
    await capture(page, "save-layer-menu", [MENU], "save", "The layer's menu with Save shape as starter…", 10);
    await press(page, item("Save shape as starter"));
    await page.waitFor(`!!document.querySelector(".popover")`, 5_000).catch(() => {});
    await capture(page, "save-popover", [".popover"], "save", "The name popover (the layer's name to start, 1 to 60 characters)", 12);
    await page.key("a", { modifiers: 2 });
    await page.type("Capture starter");
    await page.key("Enter");
    await page.wait(700);
    await capture(page, "save-notice", [".toasts"], "save", "The notice after saving", 12);
    await press(page, chevron);
    await page.waitFor(`!!document.querySelector("${MENU}")`, 5_000).catch(() => {});
    await capture(page, "save-menu-after", [MENU], "save", "The menu with the saved starter under Yours", 10);
    await page.key("Escape");
  }

  // ---- The real head, both default Vs, each starter. ----
  if (want("head") && !noGame) {
    // Both eyes of the default plate, from the front (world metres, measured on the prepared plates: knowledge/face-makeup.md, landmarks).
    const eyes = { female: { y: 1.691 }, male: { y: 1.6957 } } as const;
    notes.headOpenOverView = {};
    await page.viewport(2400, HEIGHT);
    await page.wait(1500);
    await tidy(page);
    await page.waitFor(headReady, 240_000).catch(() => {});
    for (const body of ["female", "male"] as const) {
      await run(page, { kind: "character.useDefault", bodyGender: body });
      await page.waitFor(headReady, 240_000).catch(() => {});
      await settle(page);
      // The next V's progress chip (a status over the corner of the view) has gone before any shot.
      await page.waitFor(`!/building the head|Next V/.test(document.body.innerText)`, 180_000).catch(() => unreached.push({ state: `head-${body}`, why: "the next-V progress chip stayed over the view" }));
      // The hair off (a strand across a lid hides what the shot is for) and the brow on; no idle, no surface controls.
      for (const action of [{ kind: "motion.setIdle", enabled: false }, { kind: "preview.setSurfaceControls", enabled: false }, { kind: "preview.setHair", enabled: false }])
        await run(page, action).catch(() => {});
      (notes.headOpenOverView as Record<string, unknown>)[body] = await tidy(page, false);
      // The window is widened (below) so the 3D view is landscape: both eyes with the wings' outer ends and the brows, large, nothing cut at its edge.
      const camera = { position: [0, eyes[body].y, -0.46], target: [0, eyes[body].y, -0.06], fov: 22 };
      await run(page, { kind: "camera.restore", camera }).catch(error => notes[`camera-${body}`] = String(error));
      for (const starter of EYE_STARTERS) {
        await page.evaluate(`${X}.only(${JSON.stringify(starter.id)})`);
        await settle(page);
        const open = await tidy(page, false);
        if (open.length) unreached.push({ state: `head-${body}-${starter.id}`, why: `still open over the view: ${open.join(", ")}` });
        await capture(page, `head-${body}-${starter.id}`, ["#device-head canvas"], "head", `${starter.name} on the default ${body === "female" ? "feminine" : "masculine"} V`, 0);
      }
    }
  }
} finally {
  const errors = page?.console.filter(entry => entry.type === "error" || entry.type === "exception") ?? [];
  await page?.close(); server.kill(); await server.exited;
  writeFileSync(join(out, "console.json"), JSON.stringify(errors, null, 2));
  writeFileSync(join(out, "report.json"), JSON.stringify({ notes, unreached, shots }, null, 2));
  writeFileSync(join(out, "review.html"), `<!doctype html><meta charset="utf-8"><title>Starter shapes review</title><style>body{font:14px system-ui;margin:24px}section{margin-bottom:28px}div{display:flex;gap:16px;flex-wrap:wrap}figure{margin:0}img{max-width:480px;border:1px solid #888}</style><h1>Starter shapes</h1>${
    shots.map(shot => `<section><h2>${shot.shows}</h2><div>${["light", "dark"].map(scheme => { const file = shot.name.replace("{light,dark}", scheme); return `<figure><figcaption>${scheme}</figcaption><a href="${file}.png"><img src="${file}.png"></a></figure>`; }).join("")}</div></section>`).join("")}${
    unreached.length ? `<h2>Not reached</h2><pre>${JSON.stringify(unreached, null, 2)}</pre>` : ""}`);
}

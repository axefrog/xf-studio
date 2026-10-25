/**
 * Coordinator-only captures of the guided tour "Your first eye makeup mod" (guidance/tours.ts, id `first-eye-mod`):
 *
 *   bun tools/eye-tour-look.ts <output-folder-on-C> [port=4575] [--only steps,states,doit]
 *
 * It never uses the person's server or draft: a disposable-data server with EMPTY settings (`startServer`; nothing of the person's
 * settings is read, so the game is not set up, which is the tour's own not-set-up variant), a headless Chrome with a throwaway profile,
 * and the isolated `?verify=1` workspace. Each state is captured at 900 and 1,600 px wide, light and dark, as the whole window (the
 * spotlight and card are the subject). Every menu, popover and dialog is closed before each state, before the tour starts, because Esc
 * outside the card ends a tour (and the tour is started afterwards).
 *
 *   steps    every step of the tour in the ready state (set up, a window that can make changes, nothing built):
 *            intro, first-look-add, first-look-style, second-look-add, second-look-shape, second-look-style, check, build, in-game
 *   states   the variants: `built` (a Build result showing: install; the row itself exists only after a real Build, so the step lights
 *            the Mod package panel here), `needs-setup` (setup, in place of build and install) and `read-only` (read-only)
 *   doit     the real path: from a fresh draft, each step's "Do it for me" is pressed in turn (the button, as a person would) and the
 *            window captured after each, so the looks it makes are seen with the step that follows
 *
 * Verification hooks (installed only with ?verify=1, studio-ui/app.ts, studio-ui/guidance/controller.ts):
 *   window.xfStudioShell.guidance.reach(tourId, stepId)   starts the tour and goes to that step; false when the held facts hide it
 *   window.xfStudioShell.guidance.verifyFacts(facts|null) holds some guidance facts at set values over the real ones (writable, setup:
 *                                                         "ready" | "needs" | "loading", package: "none" | "check" | "build",
 *                                                         lastPackage, installed); null returns to the real ones
 *   window.xfStudioShell.guidance.snapshot()              the runner's snapshot (step, count, target, buttons, waiting)
 * and the existing window.xfStudioPresentation (library, files, status).
 *
 * Not run in the implementation sandbox (no browser or GPU); it typechecks with `bun run check`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, startServer, type Session } from "./cdp";
import { EYE_TOUR_ID, TOURS } from "../src/studio-ui/guidance/tours";
import type { GuidanceFacts } from "../src/studio-ui/guidance/types";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); if (at < 0) return undefined; const value = args[at + 1]; args.splice(at, 2); return value; };
const only = flag("--only");
const want = (section: string) => !only || only.split(",").includes(section);
const [outArg, portArg] = args;
if (!outArg) throw Error("Usage: bun tools/eye-tour-look.ts <output-folder-on-C> [port=4575] [--only steps,states,doit]");
const out = resolve(outArg), port = Number(portArg ?? 4575);
if (!Number.isInteger(port) || port < 1024 || port > 60000 || [port, port + 5000].some(p => p === 4317 || p === 4331)) throw Error("Choose a dedicated capture port.");
if (process.platform === "win32" && !/^C:[\\/]/i.test(out)) throw Error("Keep capture work on C.");
mkdirSync(out, { recursive: true });

const tour = TOURS.find(item => item.id === EYE_TOUR_ID)!;
const P = "window.xfStudioPresentation", G = "window.xfStudioShell.guidance";
const WIDTHS = [900, 1600] as const, HEIGHT = 900;
type Facts = Partial<GuidanceFacts>;
const READY: Facts = { writable: true, setup: "ready", package: "none", lastPackage: "", installed: 0 };
const shots: { file: string; state: string; step: string; width: number; scheme: string; target: string; count: string }[] = [];
const unreached: { state: string; step: string; why: string }[] = [];

const theme = async (page: Session, value: "light" | "dark") => {
  await page.colorScheme(value);
  await page.evaluate(`(() => { const r = document.documentElement; r.dataset.theme = ${JSON.stringify(value)}; r.style.colorScheme = ${JSON.stringify(value)}; })()`);
  await page.wait(250);
};
/** Everything open over the page, which should be nothing before a state. */
const open = (page: Session) => page.evaluate(`[...document.querySelectorAll(".menu, .popover, dialog[open], .dock-floating > *")].filter(e => e.getClientRects().length).map(e => e.className || e.tagName)`) as Promise<string[]>;
/** Close menus, popovers and dialogs (Esc twice; the tour, if one runs, ends with the second, which is what we want here). */
async function tidy(page: Session): Promise<string[]> {
  await page.key("Escape"); await page.key("Escape");
  await page.evaluate(`${G}.verifyFacts(null)`).catch(() => {});
  await page.wait(300);
  return open(page);
}
const snapshot = (page: Session) => page.evaluate(`(() => { const a = ${G}.snapshot().active; return a && { step: a.step, index: a.index, count: a.count, target: a.target.kind + (a.target.anchor ? ":" + a.target.anchor : ""),
  buttons: a.buttons.map(b => b.label), waiting: a.waiting }; })()`) as Promise<{ step: number; index: number; count: number; target: string; buttons: string[]; waiting: boolean } | null>;

/** The window as it is now at both widths, light and dark. */
async function capture(page: Session, state: string, step: string) {
  const now = await snapshot(page);
  for (const width of WIDTHS) {
    await page.viewport(width, HEIGHT); await page.wait(500);
    for (const scheme of ["light", "dark"] as const) {
      await theme(page, scheme);
      const blocking = await open(page);
      if (blocking.length) unreached.push({ state, step, why: `${blocking.join(", ")} was open over the page at ${width}px` });
      const file = `${state}-${step}-${width}-${scheme}.png`;
      await page.screenshot(join(out, file));
      shots.push({ file, state, step, width, scheme, target: now?.target ?? "none", count: now ? `${now.index + 1} of ${now.count}` : "no tour" });
    }
  }
  await theme(page, "light");
}
/** Hold the state's facts, start the tour at the step and wait for its card. */
async function show(page: Session, state: string, facts: Facts, step: string) {
  const blocking = await tidy(page);
  if (blocking.length) unreached.push({ state, step, why: `${blocking.join(", ")} stayed open after Esc` });
  await page.evaluate(`${G}.verifyFacts(${JSON.stringify(facts)})`);
  const reached = await page.evaluate(`${G}.reach(${JSON.stringify(EYE_TOUR_ID)}, ${JSON.stringify(step)})`) as boolean;
  if (!reached) { unreached.push({ state, step, why: "the step is not shown in this state" }); return false; }
  await page.waitFor(`!!document.querySelector(".guidance-callout:not([hidden])")`, 10_000).catch(() => {});
  await page.wait(500);
  return true;
}
const press = (page: Session, label: string) => page.evaluate(`(() => { const b = [...document.querySelectorAll(".guidance-callout:not([hidden]) .btn")].find(e => e.textContent.trim() === ${JSON.stringify(label)} && !e.disabled);
  if (!b) return false; b.click(); return true; })()`) as Promise<boolean>;

const { server } = await startServer(port, { settings: "empty" });
let page: Session | undefined;
try {
  page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1600, height: HEIGHT, scheme: "light", debugPort: port + 5000 });
  await page.waitFor(`!!window.xfStudioShell && !!${G} && !!${P} && !!document.querySelector(".layout-tabs") && !!${P}.library.summary().draft && !${P}.library.summary().busy`, 120_000);
  await page.wait(1500);
  // The 3D view's setup card never blocks a capture.
  await page.evaluate(`(() => { const b = [...document.querySelectorAll("#preview-card .setup-card-actions button")].find(b => b.textContent.trim() === "Not now" && !b.closest("[hidden]")); b?.click(); })()`);

  // ---- Every step, ready to go. ----
  if (want("steps")) for (const id of ["intro", "first-look-add", "first-look-style", "second-look-add", "second-look-shape", "second-look-style", "check", "build", "in-game"])
    if (await show(page, "ready", READY, id)) await capture(page, "ready", id);

  // ---- The variants. ----
  if (want("states")) {
    if (await show(page, "built", { ...READY, package: "build", lastPackage: "build@1" }, "install")) await capture(page, "built", "install");
    for (const id of ["check", "setup", "in-game"])
      if (await show(page, "needs-setup", { ...READY, setup: "needs" }, id)) await capture(page, "needs-setup", id);
    if (await show(page, "read-only", { ...READY, writable: false }, "read-only")) await capture(page, "read-only", "read-only");
  }

  // ---- Do it for me, pressed for real, step after step. ----
  if (want("doit")) {
    await tidy(page);
    const walk = ["first-look-add", "first-look-style", "second-look-add", "second-look-shape", "second-look-style"];
    if (await show(page, "doit", {}, walk[0])) {
      await page.evaluate(`${G}.verifyFacts({ setup: "ready" })`);
      for (let i = 0; i < walk.length; i++) {
        if (!await press(page, "Do it for me")) { unreached.push({ state: "doit", step: walk[i], why: "Do it for me was not offered or not available" }); break; }
        // The step moves on by itself once the look has changed; capture what the person sees next.
        const next = i + 1 < walk.length ? walk[i + 1] : "check";
        await page.waitFor(`${G}.snapshot().active?.step === ${tour.steps.findIndex(step => step.id === next)}`, 10_000)
          .catch(() => unreached.push({ state: "doit", step: next, why: "the tour did not move on after Do it for me" }));
        await page.wait(600);
        await capture(page, "doit-after", walk[i]);
      }
    }
  }
} finally {
  const errors = page?.console.filter(entry => entry.type === "error" || entry.type === "exception") ?? [];
  await page?.close(); server.kill(); await server.exited;
  writeFileSync(join(out, "console.json"), JSON.stringify(errors, null, 2));
  writeFileSync(join(out, "report.json"), JSON.stringify({ shots, unreached }, null, 2));
  const steps = [...new Set(shots.map(shot => `${shot.state}/${shot.step}`))];
  writeFileSync(join(out, "review.html"), `<!doctype html><meta charset="utf-8"><title>Eye tour review</title><style>body{font:14px system-ui;margin:24px}section{margin-bottom:28px}div{display:flex;gap:16px;flex-wrap:wrap}figure{margin:0}img{max-width:46vw;border:1px solid #888}</style><h1>Your first eye makeup mod</h1>${
    steps.map(name => `<section><h2>${name}</h2>${shots.filter(shot => `${shot.state}/${shot.step}` === name).map(shot =>
      `<figure><figcaption>${shot.width}px · ${shot.scheme} · ${shot.count} · ${shot.target}</figcaption><a href="${shot.file}"><img src="${shot.file}"></a></figure>`).join("")}</section>`).join("")}${
    unreached.length ? `<h2>Not reached</h2><pre>${JSON.stringify(unreached, null, 2)}</pre>` : ""}`);
}

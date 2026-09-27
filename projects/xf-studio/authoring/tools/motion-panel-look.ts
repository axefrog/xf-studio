/**
 * The Motion panel under the desktop's conditions (the body idle read from the game, no face idle, no blink, no Python), floated at a
 * narrow and a wide width in the light and dark themes, in three states: the idle playing, Still, and Body movement off. Hair is hidden so
 * the Hair physics toggle shows its own muted reason line under the Facial movement note while the hair loads (the reference pattern; the
 * style guide's Switch has no disabled specimen), and the Blink line is the same muted note in every capture. Also records each note's
 * tone (`info` class and colour) and whether the Hair section moves as the panel updates. Isolated `?verify=1` workspace, disposable data.
 *
 *   bun tools/motion-panel-look.ts <out dir> [port] [--widths 300,480]
 *
 * Pass the caches the usual way (`XFS_PREVIEW_CORE_CACHE`, `XFS_RESOLVER_CACHE`, `XFS_PREPARED_BUDGET_GB=off`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, startServer } from "./cdp";

const argv = process.argv.slice(2), widthsAt = argv.indexOf("--widths");
const widths = widthsAt >= 0 ? argv.splice(widthsAt, 2)[1]!.split(",").map(Number) : [300, 480];
const [outArg, portArg = "4485"] = argv;
if (!outArg) throw Error("Usage: bun tools/motion-panel-look.ts <out dir> [port] [--widths 300,480]");
const out = resolve(outArg), port = +portArg;
mkdirSync(out, { recursive: true });
const saved = { ...process.env };
// What the desktop has: no prepared motion files and no Python.
Object.assign(process.env, { XFS_PREPARED_MOTION: "off", XFS_PYTHON: resolve(out, "no-python", "python.exe"), XFS_IDLE_SOURCE: "game" });
const { server } = await startServer(port);
process.env = saved;
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1440, height: 960, scheme: "dark", debugPort: port + 5000 });
const run = (action: object) => page.evaluate(`window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)})`);
const panel = `[...document.querySelectorAll(".dock-window, .dock-group")].find(w => /Game idle/i.test(w.textContent) && w.getBoundingClientRect().width < 700)`;
const shots: string[] = [], checks: Record<string, unknown> = {};
const snap = async (name: string) => {
  const box = await page.evaluate(`(() => { const e = ${panel}; if (!e) return null; const r = e.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, innerWidth - Math.max(0, r.x)), height: Math.min(r.height, innerHeight - Math.max(0, r.y)) }; })()`);
  if (!box) throw Error("The Motion panel wasn't found.");
  await page.screenshot(resolve(out, `${name}.png`), box as never);
  shots.push(name);
};
/** Each note line in the panel: its text, whether it has the muted `info` tone, its colour, its line count and its top. */
const notes = () => page.evaluate(`(() => { const e = ${panel}; return [...e.querySelectorAll(".control-note, .note")].filter(n => !n.hidden && n.textContent.trim())
  .map(n => { const r = n.getBoundingClientRect(), s = getComputedStyle(n), lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.4;
    return { text: n.textContent.trim(), info: n.classList.contains("info") || n.classList.contains("muted"), color: s.color, lines: Math.round(r.height / lh),
      overflows: n.scrollWidth > n.clientWidth + 1, top: Math.round(r.top) }; }); })()`);
const hairTop = () => page.evaluate(`(() => { const e = ${panel}; const h = [...e.querySelectorAll("*")].find(n => n.children.length === 0 && n.textContent.trim() === "Hair physics");
  return h ? Math.round(h.getBoundingClientRect().top) : null; })()`);
try {
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 240000);
  await page.waitFor(`!!window.xfStudioPresentation.authoring.previewState().motion?.available`, 240000);
  await run({ kind: "preview.setHair", enabled: false }).catch(() => undefined);
  await page.wait(3000);
  await page.evaluate(`window.xfStudioShell.dock.reveal("motion")`).catch(() => undefined);
  checks.motion = await page.evaluate(`JSON.parse(JSON.stringify(window.xfStudioPresentation.authoring.previewState().motion))`);
  const states: [string, () => Promise<unknown>][] = [
    ["idle", async () => { await run({ kind: "motion.setIdle", enabled: true }); await run({ kind: "motion.setContributions", body: true, face: false }); }],
    ["still", async () => { await run({ kind: "motion.setIdle", enabled: false }); }],
    ["body-off", async () => { await run({ kind: "motion.setIdle", enabled: true }); await run({ kind: "motion.setContributions", body: false, face: false }); }],
  ];
  for (const scheme of ["light", "dark"] as const) {
    await page.colorScheme(scheme);
    for (const width of widths) {
      await page.evaluate(`window.xfStudioShell.dock.moveTo("motion", { kind: "float", x: ${1420 - width}, y: 30, w: ${width}, h: 720 }, "")`);
      await page.wait(700);
      for (const [state, apply] of states) {
        await apply();
        await page.wait(500);
        const tag = `${scheme}-${width}-${state}`;
        // The Hair section's place across a few panel updates (the idle playing publishes state): it must not move.
        const tops: (number | null)[] = [];
        for (let i = 0; i < 4; i++) { tops.push(await hairTop()); await page.wait(250); }
        checks[tag] = { notes: await notes(), hairTops: tops, hairStill: new Set(tops).size === 1 };
        await snap(tag);
      }
    }
  }
  writeFileSync(resolve(out, "run.json"), JSON.stringify({ date: new Date().toISOString(), widths, shots, checks,
    console: page.console.filter(m => m.type === "error" || m.type === "exception").slice(0, 20) }, null, 2));
  console.log(`Wrote ${shots.length} captures to ${out}`);
} finally { await page.close(); server.kill(); await server.exited; }

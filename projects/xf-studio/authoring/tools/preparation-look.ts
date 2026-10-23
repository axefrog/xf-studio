/**
 * Captures of the 3D pane's preparation progress (profiles phase 4a-v, experiment 043 §11) for the UI review: the quiet status line while
 * the V shown stays and the next one is made ready (every stage), and the pane's loading state on a first load, in light and dark, at a
 * narrow, a wide and a ~300 px pane (where the line's 60 % floor binds); plus the Character panel's eye-shape fallback line (4a-iv's
 * finding 7), from a real body switch, at a wide and a ~300 px panel. An isolated `?verify=1` workspace on its own port with a throwaway
 * data folder (tools/cdp.ts `startServer`) and a throwaway Chrome profile: never 4317, 4331 or the person's draft. The states are put in
 * the pane with the verification hook `xfStudioShowPreparation`, so each is drawn by the pane's own code. The line's box is measured in
 * each (and the text read is what is visible, `innerText`), and `run.json` checks that it has one height at every stage in each window.
 *
 *   bun tools/preparation-look.ts <out dir> [port]
 *
 * The 3D view shows the default V from the local game files: keep the outputs in an ignored folder.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, startServer } from "./cdp";

const [outArg, portArg = "4593"] = process.argv.slice(2);
if (!outArg) throw Error("Usage: bun tools/preparation-look.ts <out dir> [port]");
const out = resolve(outArg), port = +portArg;
mkdirSync(out, { recursive: true });

type Stage = "core" | "build" | "details" | "programs" | "textures" | "warm-up";
const state = (stage: Stage, fraction: number, waiting: string | null = null, detail?: string) =>
  ({ scene: "capture", key: `capture|${stage}`, stage, fraction, waiting, warm: false, ...(detail ? { detail } : {}) });
// The host's own core line carries a step count in this fixture, to show that a line beside a bar never says it.
const NEXT: [string, ReturnType<typeof state>][] = [
  ["core", state("core", 0.12, "host", "Preparing the masculine V's head from your Cyberpunk 2077 files… (step 3 of 9)")],
  ["build", state("build", 0.38)],
  ["details", state("details", 0.5, "host")],
  ["programs", state("programs", 0.72, "driver")],
  ["textures", state("textures", 0.9)],
  ["warm-up", state("warm-up", 0.97, "gpu")],
];
const PANE: [string, ReturnType<typeof state>][] = [["pane-core", NEXT[0]![1]], ["pane-details", NEXT[2]![1]], ["pane-programs", NEXT[3]![1]]];
// `pane300`: a window that leaves the 3D pane about 300 px wide.
const WINDOWS = { narrow: { width: 1000, height: 760 }, wide: { width: 1700, height: 1000 }, pane300: { width: 808, height: 760 } } as const;
type Box = { x: number; y: number; width: number; height: number };
type Line = { width: number; height: number; text: string; textLines: number; textOverflows: boolean };
const EYE_NOTE = `[...document.querySelectorAll(".cc-reserved-note")].find(e => e.textContent.includes("has no shape"))`;

const { server } = await startServer(port);
const report: Record<string, unknown> = { date: new Date().toISOString(), port, captures: [] as unknown[] };
const captures = report.captures as { scheme: string; size: string; place: string; stage: string; line: Line | null }[];
try {
  for (const scheme of ["light", "dark"] as const) for (const [size, window] of Object.entries(WINDOWS)) {
    const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { ...window, scheme, debugPort: port + 5000 });
    try {
      await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 240000);
      await page.waitFor("(() => { const e = window.xfStudioSceneEvidence?.(); return !!e && e.characterDetails.components.length > 0; })()", 240000);
      await page.wait(1500);
      const pane = () => page.evaluate(`(() => { const e = document.querySelector('.viewport-panel:not(.uv)'); const r = e.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`) as Promise<Box>;
      // The visible text only (`innerText` leaves out hidden buttons), the box, and how many lines the text takes.
      const line = () => page.evaluate(`(() => { const e = document.querySelector('.viewport-detail-status'); if (!e || e.hidden) return null;
        const r = e.getBoundingClientRect(), t = e.querySelector('.viewport-detail-text'), tr = t.getBoundingClientRect(), lh = parseFloat(getComputedStyle(t).lineHeight);
        return { width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10, text: e.innerText.trim(), textLines: Math.round(tr.height / lh),
          textOverflows: t.scrollWidth > t.clientWidth }; })()`) as Promise<Line | null>;
      const paneText = () => page.evaluate(`document.querySelector('.viewport-state:not([hidden])')?.innerText.trim() ?? null`);
      const rect = await pane();
      for (const [name, value] of [...NEXT, ...PANE]) {
        const first = name.startsWith("pane-");
        await page.evaluate(`window.xfStudioShowPreparation(${JSON.stringify(value)}, { pane: ${first} })`);
        await page.wait(450);
        const file = `${scheme}-${size}-${name}.png`;
        await page.screenshot(resolve(out, file), rect);
        (report.captures as unknown[]).push({ file, scheme, size, stage: value.stage, place: first ? "pane" : "next", pane: rect,
          line: first ? null : await line(), ...(first ? { paneText: await paneText() } : {}) });
        await page.evaluate(`window.xfStudioShowPreparation(null)`);
        await page.wait(200);
      }
      // 4a-iv's finding 7, at the wide and the ~300 px window: the feminine head's last eye shape, then the masculine V (whose head may lack it).
      if (size !== "narrow") {
        await page.evaluate(`window.xfStudioShell.dock.reveal("character")`);
        await page.wait(1500);
        const shapes = await page.evaluate(`window.xfStudioPresentation.authoring.previewState()?.eyeShapeOptions?.choices?.length ?? null`);
        report[`${scheme}-${size}-eyeShapes`] = shapes;
        await page.evaluate(`window.xfStudioShell.runtime.dispatch({ kind: "preview.setEyeShape", index: ${Number(shapes ?? 1) - 1} })`).catch(() => {});
        await page.evaluate(`window.xfStudioShell.runtime.dispatch({ kind: "character.useDefault", bodyGender: "male" })`).catch(() => {});
        const found = await page.waitFor(`!!(${EYE_NOTE})`, 240000).then(() => true, () => false);
        report[`${scheme}-${size}-eyeShapeFallback`] = found;
        if (found) {
          await page.wait(1000);
          // At the ~300 px window the Character panel may be wider than a narrow panel: its control column is then held to 300 px so the note
          // wraps as it would in one (run.json says whether it was).
          const forced = size === "pane300" ? 300 : 0;
          const info = await page.evaluate(`(() => { const note = ${EYE_NOTE}; const control = note.closest(".cc-control") ?? note.parentElement;
            const natural = Math.round(control.getBoundingClientRect().width), force = ${forced} && natural > ${forced};
            if (force) control.style.width = "${forced}px";
            const row = note.closest(".cc-row") ?? control; row.scrollIntoView({ block: "center" }); const r = row.getBoundingClientRect();
            return { text: note.innerText.trim(), naturalWidth: natural, shotWidth: Math.round(control.getBoundingClientRect().width), forcedWidth: force ? ${forced} : null,
              noteHeight: Math.round(note.getBoundingClientRect().height),
              box: { x: Math.max(0, Math.round(r.x) - 8), y: Math.max(0, Math.round(r.y) - 8), width: Math.round(r.width) + 16, height: Math.round(r.height) + 16 } }; })()`) as { box: Box };
          await page.screenshot(resolve(out, `${scheme}-${size}-character-eye-shape-fallback.png`), info.box);
          report[`${scheme}-${size}-eyeShapeNote`] = info;
        }
      }
      report[`${scheme}-${size}-console`] = page.console.filter(m => m.type === "error" || m.type === "exception").slice(0, 10);
    } finally { await page.close(); }
  }
  // One height for every stage's status line in each window (the fix list's check), and no stage's words on more than one line.
  const heights: Record<string, { heights: number[]; same: boolean; allOneLine: boolean; texts: string[] }> = {};
  for (const c of captures.filter(c => c.place === "next" && c.line)) {
    const key = `${c.scheme}-${c.size}`, entry = (heights[key] ??= { heights: [], same: true, allOneLine: true, texts: [] });
    entry.heights.push(c.line!.height); entry.texts.push(c.line!.text);
    entry.same = new Set(entry.heights).size === 1;
    entry.allOneLine &&= c.line!.textLines === 1 && !c.line!.textOverflows;
  }
  report.lineHeights = heights;
  writeFileSync(resolve(out, "run.json"), JSON.stringify(report, null, 2));
  console.log(`Wrote ${captures.length} captures to ${out}`);
  for (const [key, entry] of Object.entries(heights)) console.log(`${key}: heights ${[...new Set(entry.heights)].join(", ")} same=${entry.same} oneLine=${entry.allOneLine}`);
} finally { server.kill(); }

/**
 * Captures of the 3D pane's preparation progress (profiles phase 4a-v, experiment 043 §11) for the UI review: the quiet status line while
 * the V shown stays and the next one is made ready (every stage), and the pane's loading state on a first load, in light and dark, at a
 * narrow and a wide window; plus the Character panel's eye-shape fallback line (4a-iv's finding 7), from a real body switch. An isolated
 * `?verify=1` workspace on its own port with a throwaway data folder (tools/cdp.ts `startServer`) and a throwaway Chrome profile: never
 * 4317, 4331 or the person's draft. The states are put in the pane with the verification hook `xfStudioShowPreparation`, so each is
 * drawn by the pane's own code; the line's box is measured in each, to show its stages never resize it.
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
const NEXT: [string, ReturnType<typeof state>][] = [
  ["core", state("core", 0.12, "host", "Preparing the masculine V's head… (step 3 of 9)")],
  ["build", state("build", 0.38)],
  ["details", state("details", 0.5, "host")],
  ["programs", state("programs", 0.72, "driver")],
  ["textures", state("textures", 0.9)],
  ["warm-up", state("warm-up", 0.97, "gpu")],
];
const PANE: [string, ReturnType<typeof state>][] = [["pane-core", NEXT[0]![1]], ["pane-details", NEXT[2]![1]], ["pane-programs", NEXT[3]![1]]];
const WINDOWS = { narrow: { width: 1000, height: 760 }, wide: { width: 1700, height: 1000 } } as const;

const { server } = await startServer(port);
const report: Record<string, unknown> = { date: new Date().toISOString(), port, captures: [] as unknown[] };
try {
  for (const scheme of ["light", "dark"] as const) for (const [size, window] of Object.entries(WINDOWS)) {
    const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { ...window, scheme, debugPort: port + 5000 });
    try {
      await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 240000);
      await page.waitFor("(() => { const e = window.xfStudioSceneEvidence?.(); return !!e && e.characterDetails.components.length > 0; })()", 240000);
      await page.wait(1500);
      const pane = () => page.evaluate(`(() => { const e = document.querySelector('.viewport-panel:not(.uv)'); const r = e.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`) as Promise<{ x: number; y: number; width: number; height: number }>;
      const line = () => page.evaluate(`(() => { const e = document.querySelector('.viewport-detail-status'); if (!e || e.hidden) return null;
        const r = e.getBoundingClientRect(); return { width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10, text: e.textContent }; })()`);
      const rect = await pane();
      for (const [name, value] of [...NEXT, ...PANE]) {
        const first = name.startsWith("pane-");
        await page.evaluate(`window.xfStudioShowPreparation(${JSON.stringify(value)}, { pane: ${first} })`);
        await page.wait(450);
        const file = `${scheme}-${size}-${name}.png`;
        await page.screenshot(resolve(out, file), rect);
        (report.captures as unknown[]).push({ file, scheme, size, stage: value.stage, place: first ? "pane" : "next", pane: rect, line: first ? null : await line() });
        await page.evaluate(`window.xfStudioShowPreparation(null)`);
        await page.wait(200);
      }
      // 4a-iv's finding 7, once per scheme at the wide window: the feminine head's last eye shape, then the masculine V (whose head may lack it).
      if (size === "wide") {
        await page.evaluate(`window.xfStudioShell.dock.reveal("character")`);
        await page.wait(1500);
        const shapes = await page.evaluate(`window.xfStudioPresentation.authoring.previewState()?.eyeShapeOptions?.choices?.length ?? null`);
        report[`${scheme}-eyeShapes`] = shapes;
        await page.evaluate(`window.xfStudioShell.runtime.dispatch({ kind: "preview.setEyeShape", index: ${Number(shapes ?? 1) - 1} })`).catch(() => {});
        await page.evaluate(`window.xfStudioShell.runtime.dispatch({ kind: "character.useDefault", bodyGender: "male" })`).catch(() => {});
        const found = await page.waitFor(`[...document.querySelectorAll(".cc-reserved-note")].some(e => e.textContent.includes("doesn't have the eye shape"))`, 240000)
          .then(() => true, () => false);
        report[`${scheme}-eyeShapeFallback`] = found;
        if (found) {
          await page.wait(1000);
          const box = await page.evaluate(`(() => { const note = [...document.querySelectorAll(".cc-reserved-note")].find(e => e.textContent.includes("doesn't have the eye shape"));
            const row = note.closest(".cc-row") ?? note.closest(".cc-control"); row.scrollIntoView({ block: "center" }); const r = row.getBoundingClientRect();
            return { x: Math.max(0, Math.round(r.x) - 8), y: Math.max(0, Math.round(r.y) - 8), width: Math.round(r.width) + 16, height: Math.round(r.height) + 16 }; })()`);
          await page.screenshot(resolve(out, `${scheme}-character-eye-shape-fallback.png`), box as { x: number; y: number; width: number; height: number });
        }
      }
      report[`${scheme}-${size}-console`] = page.console.filter(m => m.type === "error" || m.type === "exception").slice(0, 10);
    } finally { await page.close(); }
  }
  writeFileSync(resolve(out, "run.json"), JSON.stringify(report, null, 2));
  console.log(`Wrote ${(report.captures as unknown[]).length} captures to ${out}`);
} finally { server.kill(); }

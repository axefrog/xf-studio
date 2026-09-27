/**
 * Fixed-camera renders of expression vectors on V, in an isolated `?verify=1` workspace of an already running isolated Studio server
 * (throwaway headless Chrome profile; never the maintainer's server or draft). Each vector is applied with the expressions feature's own
 * `expression.startFrom` action, solved by the live facial solver and captured from the front and three-quarter views.
 *
 *     bun experiments/026-natural-expressions/expression-look.ts --server http://127.0.0.1:4463 --out <dir> <vectors.json> [...]
 *
 * A vectors file is `{ "<name>": { "<control>": weight, ... }, ... }`, an expression sample (`{ name, part: { body: { controls } } }`),
 * or the special name `installed:<clip>` in a list file, which starts from that installed photo-mode expression. Renders are private
 * (the player's own game assets): keep them in the ignored `projects/xf-studio/authoring/evidence/screenshots/` tree.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { launch } from "../../projects/xf-studio/authoring/tools/cdp";

const argv = process.argv.slice(2);
const take = (name: string, fallback?: string) => { const i = argv.indexOf(name); if (i < 0) return fallback; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const server = take("--server", "http://127.0.0.1:4463")!;
const out = resolve(take("--out", "projects/xf-studio/authoring/evidence/screenshots/natural-expressions")!);
const views = (take("--views", "front,tq")!).split(",");
const hair = take("--hair", "off") === "on";
mkdirSync(out, { recursive: true });

type Vector = Record<string, number>;
const subjects: { name: string; controls?: Vector; installed?: string }[] = [];
for (const file of argv) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (data?.part?.body?.controls) subjects.push({ name: basename(file, ".json"), controls: data.part.body.controls });
  else if (Array.isArray(data)) for (const item of data) subjects.push(typeof item === "string" ? { name: item.replace(/^installed:/, ""), installed: item.replace(/^installed:/, "") } : item);
  else for (const [name, controls] of Object.entries(data)) subjects.push({ name, controls: controls as Vector });
}

// V faces −Z in the preview; the character's left is −X.
const CAMERAS: Record<string, { position: number[]; target: number[]; fov: number }> = {
  front: { position: [0, 1.662, -0.62], target: [0, 1.658, -0.05], fov: 19 },
  tq: { position: [-0.40, 1.672, -0.53], target: [0.03, 1.656, -0.04], fov: 19 },
  tqr: { position: [0.40, 1.672, -0.53], target: [-0.03, 1.656, -0.04], fov: 19 },
  eyes: { position: [0, 1.69, -0.42], target: [0, 1.688, -0.05], fov: 10 },
};

const page = await launch(`${server}/?verify=1`, { width: 1600, height: 1000, scheme: "light" });
const run = (action: object) => page.evaluate(`window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)})`);
const report: Record<string, unknown> = { date: new Date().toISOString(), server, captures: [] };
try {
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 240000);
  await page.waitFor(`(() => { const e = window.xfStudioSceneEvidence?.(); return !!e && (e.characterDetails?.components?.length ?? 0) > 0
    && !document.querySelector('[role=status]')?.textContent?.includes('Preparing your V'); })()`, 240000).catch(error => console.log("details:", error.message));
  await page.evaluate(`window.xfStudioShell.runtime.modules.set("expressions", true)`);
  await page.evaluate(`document.querySelector('[aria-label="Hide Eye makeup"]')?.click()`);
  for (const action of [{ kind: "motion.setIdle", enabled: false }, { kind: "preview.setHair", enabled: hair }]) await run(action);
  const installed = await (await fetch(`${server}/api/facial/expressions`)).json() as { items: { clip: string; row: number; set: string; provider: string; controls: Vector }[] };
  await page.wait(3000);
  const canvas = await page.evaluate(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`);
  for (const subject of subjects) {
    let controls = subject.controls ?? {}, origin: object = { kind: "rest" };
    if (subject.installed) {
      const point = installed.items.find(item => item.clip === subject.installed);
      if (!point) { console.log("not installed:", subject.installed); continue; }
      controls = point.controls; origin = { kind: "installed", clip: point.clip, set: point.set, row: point.row, provider: point.provider };
    }
    await run({ kind: "expression.startFrom", origin, controls });
    const want = Object.keys(controls).length ? "ready" : "idle";
    const phase = await page.waitFor(`(() => { const p = window.xfStudioPresentation.facial.snapshot()?.phase; return p === "${want}" ? p : p === "failed" || p === "unavailable" ? p : false; })()`, 90000)
      .catch(() => page.evaluate(`window.xfStudioPresentation.facial.snapshot()?.phase`));
    if (phase !== want) throw Error(`The face preview is ${phase} for ${subject.name}: ${await page.evaluate(`window.xfStudioPresentation.facial.snapshot()?.reason`)}`);
    for (const view of views) {
      await run({ kind: "camera.restore", camera: CAMERAS[view] });
      await page.wait(1500);
      const file = `${subject.name}-${view}.png`;
      await page.screenshot(resolve(out, file), canvas);
      (report.captures as unknown[]).push({ subject: subject.name, view, file, controls: Object.keys(controls).length });
      console.log("captured", file);
    }
  }
  report.latency = await page.evaluate(`window.xfStudioPresentation.facial.snapshot()?.latency`);
  report.console = page.console.filter(m => m.type === "error").slice(0, 20);
  writeFileSync(resolve(out, `run-${Date.now()}.json`), JSON.stringify(report, null, 2));
} finally { await page.close(); }

/**
 * Fixed-camera captures of V's body idle read natively (idle-host.ts) against the developer preparation's (the Python oracle), in an isolated
 * `?verify=1` workspace with disposable data and a throwaway Chrome profile: each idle paused at the same motion times, the face's motion
 * off on both sides so only the body is compared, then the Motion panel as the app shows it without prepared motion files.
 *
 *   bun tools/idle-source-look.ts <out dir> [port] [prepared assets folder | -] [game | prepared]
 *
 * Runs two servers on `port`, one after the other: `game` (`XFS_PREPARED_MOTION=off`, `XFS_PYTHON` pointing nowhere: what the desktop app
 * has) and `prepared` (`XFS_IDLE_SOURCE=prepared` with `XFS_ASSET_OVERLAY` at the preparation). Pass the caches the usual way
 * (`XFS_PREVIEW_CORE_CACHE`, `XFS_RESOLVER_CACHE`, `XFS_PREPARED_BUDGET_GB=off`). Outputs are private renders of local game assets:
 * keep them in an ignored folder.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, startServer } from "./cdp";

const [outArg, portArg = "4485", assetsArg, only] = process.argv.slice(2);
/** Vanilla photo-mode poses held on the game source: a standing one and a cheering one. */
const POSES = ["PhotoModePoses.idle_stand_01", "PhotoModePoses.action___woo_02"];
if (!outArg) throw Error("Usage: bun tools/idle-source-look.ts <out dir> [port] [prepared assets folder]");
const out = resolve(outArg), port = +portArg;
mkdirSync(out, { recursive: true });
const times = [0, 3, 6.5, 10];
const shots: { source: string; idle: string; view: string; time: number; file: string }[] = [];
const runs: Record<string, unknown> = {};
const views = { head: { position: [0, 1.62, -0.75], target: [0, 1.6, 0], fov: 30 }, body: "body" } as const;

for (const source of ["game", "prepared"] as const) {
  if (source === "prepared" && (!assetsArg || assetsArg === "-")) continue;
  if (only && only !== source) continue;
  const saved = { ...process.env };
  Object.assign(process.env, source === "game" ? { XFS_PREPARED_MOTION: "off", XFS_PYTHON: resolve(out, "no-python", "python.exe"), XFS_IDLE_SOURCE: "game" }
    : { XFS_PREPARED_MOTION: "on", XFS_IDLE_SOURCE: "prepared", XFS_ASSET_OVERLAY: resolve(assetsArg!) });
  const started = performance.now();
  const { server } = await startServer(port);
  process.env = saved;
  const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1400, height: 1000, scheme: "dark", debugPort: port + 5000 });
  const run = (action: object) => page.evaluate(`window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)})`);
  const motion = () => page.evaluate(`JSON.parse(JSON.stringify(window.xfStudioPresentation.authoring.previewState().motion ?? null))`);
  try {
    await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 240000);
    const headReadyMs = Math.round(performance.now() - started);
    await page.waitFor(`(() => { const e = window.xfStudioSceneEvidence(); return !!e && e.characterDetails.components.some(c => c.slot === "body"); })()`, 900000);
    await page.wait(3000);
    for (const action of [{ kind: "preview.setSurfaceControls", enabled: false }, { kind: "preview.setLightingPreset", preset: "studio" },
      { kind: "preview.setHair", enabled: false }]) await run(action).catch(() => undefined);
    const state = await motion();
    for (const idle of ["closeup", "fullbody"]) {
      await run({ kind: "motion.setIdleClip", clip: idle });
      await run({ kind: "motion.setIdle", enabled: true });
      await page.waitFor(`!window.xfStudioPresentation.authoring.previewState().motion.idleLoading`, 60000);
      // Only the body: the prepared face would move the head's joints where the app's face holds still.
      await run({ kind: "motion.setContributions", body: true, face: false }).catch(() => undefined);
      await run({ kind: "motion.setPaused", paused: true });
      for (const [view, camera] of Object.entries(views)) {
        if (idle === "fullbody" && view === "head") continue;
        await run(camera === "body" ? { kind: "camera.body" } : { kind: "camera.restore", camera });
        for (const time of times) {
          await page.evaluate(`window.xfStudioSeekIdle(${time})`);
          await page.wait(1200);
          const file = `${source}-${idle}-${view}-${String(time).replace(".", "_")}s.png`;
          await page.screenshot(resolve(out, file));
          shots.push({ source, idle, view, time, file });
        }
      }
    }
    // The Motion panel as a person sees it with the idle playing (its face and blink lines), on the game source only.
    await run({ kind: "motion.setContributions", body: true, face: true }).catch(() => undefined);
    await run({ kind: "motion.setIdleClip", clip: "closeup" });
    await run({ kind: "motion.setPaused", paused: false });
    const panel = await page.evaluate(`(() => {
      const tab = [...document.querySelectorAll('[role=tab]')].find(t => t.textContent.trim() === 'Motion');
      tab?.click();
      return !!tab;
    })()`);
    await page.wait(1000);
    const box = await page.evaluate(`(() => { const heading = [...document.querySelectorAll('h2,h3,.section-title')].find(h => /Game idle/.test(h.textContent));
      const content = heading?.closest('.panel-content'); if (!content) return null; const r = content.getBoundingClientRect();
      return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.max(1, r.width), height: Math.max(1, Math.min(r.height, 900)) }; })()`);
    if (source === "game" && box) { await page.screenshot(resolve(out, `${source}-motion-panel.png`), box); shots.push({ source, idle: "closeup", view: "motion-panel", time: 0, file: `${source}-motion-panel.png` }); }
    const texts = await page.evaluate(`(() => { const heading = [...document.querySelectorAll('h2,h3,.section-title')].find(h => /Game idle/.test(h.textContent));
      return heading?.closest('.panel-content')?.innerText ?? null; })()`);
    const idleCapability = await page.evaluate(`window.xfStudioPresentation.authoring.capability?.({ kind: "motion.setIdle", enabled: true }) ?? null`).catch(() => null);
    const evidence = await page.evaluate(`window.xfStudioSceneEvidence().core.idle`);
    // A photo-mode pose on the same rig (poses need the idle's rig): the Poses module shown, one vanilla pose held, the whole body framed.
    let poses: unknown = null;
    if (source === "game") {
      await page.evaluate(`window.xfStudioShell.runtime.modules.set("poses", true)`);
      const module = `window.xfStudioPresentation.module("poses")`;
      await page.waitFor(`${module}.snapshot().catalogue.phase === "ready"`, 240000);
      const playable = await page.evaluate(`${module}.snapshot().playable`);
      poses = { playable };
      for (const id of POSES) {
        const result = await page.evaluate(`${module}.dispatch(${JSON.stringify({ kind: "pose.select", id })})`).catch(error => String(error));
        await page.waitFor(`(() => { const m = window.xfStudioPresentation.authoring.previewState().motion; return !!m?.pose && !m.poseLoading; })()`, 120000).catch(() => undefined);
        await run({ kind: "camera.body" });
        await page.wait(1500);
        const file = `${source}-pose-${id.replace(/[^A-Za-z0-9_]+/g, "_")}.png`;
        await page.screenshot(resolve(out, file));
        shots.push({ source, idle: id, view: "body", time: 0, file });
        poses = { ...(poses as object ?? {}), [id]: { result, motion: await motion() } };
      }
    }
    runs[source] = { headReadyMs, motionAtLoad: state, panelFound: panel, panelText: texts, idleCapability, idleEvidence: evidence, poses,
      console: page.console.filter(m => m.type === "error" || m.type === "exception" || m.type === "warning").slice(0, 40) };
  } finally { await page.close(); server.kill(); await server.exited; }
}
writeFileSync(resolve(out, "run.json"), JSON.stringify({ date: new Date().toISOString(), times, shots, runs }, null, 2));
console.log(`Wrote ${shots.length} captures to ${out}`);

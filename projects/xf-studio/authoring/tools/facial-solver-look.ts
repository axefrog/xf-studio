/**
 * Captures of V's face moved by the facial solver in an isolated `?verify=1` workspace: the creator idle's face at fixed times, the game's
 * blink at 50 and 100 %, and a few expressions (a natural sample and vanilla photo-mode expressions), each from a face and an eye camera.
 * Body off (only the head is drawn), hair off, the default V.
 *
 *   bun tools/facial-solver-look.ts <out dir> <native|oracle> [port]
 *
 * `native`: the desktop's conditions: XF Studio's own solver on the host, no Python (XFS_PYTHON and XFS_FACIAL_SOLVER point nowhere), no
 * prepared motion files. `oracle`: the developer's IO Suite path for comparison: the prepared idle faces and blink (XFS_IDLE_SOURCE=prepared)
 * and the pinned IO Suite solver for expressions (XFS_FACIAL_SOLVER_ORACLE=1; XFS_PYTHON and XFS_FACIAL_SOLVER from the environment).
 * Pass the caches the usual way (`XFS_PREVIEW_CORE_CACHE`, `XFS_RESOLVER_CACHE`, `XFS_ASSET_OVERLAY`, `XFS_PREPARED_BUDGET_GB=off`).
 * Outputs are private renders of local assets.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, startServer } from "./cdp";

const [outArg, mode = "native", portArg = "4497"] = process.argv.slice(2);
if (!outArg || (mode !== "native" && mode !== "oracle")) throw Error("Usage: bun tools/facial-solver-look.ts <out dir> <native|oracle> [port]");
const out = resolve(outArg), port = +portArg;
mkdirSync(out, { recursive: true });
const saved = { ...process.env };
if (mode === "native") {
  Object.assign(process.env, { XFS_PREPARED_MOTION: "off", XFS_IDLE_SOURCE: "game", XFS_PYTHON: resolve(out, "no-python", "python.exe"),
    XFS_FACIAL_SOLVER: resolve(out, "no-io-suite") });
  delete process.env.XFS_FACIAL_SOLVER_ORACLE;
} else Object.assign(process.env, { XFS_IDLE_SOURCE: "prepared", XFS_PREPARED_MOTION: "on", XFS_FACIAL_SOLVER_ORACLE: "1" });
const { server } = await startServer(port);
process.env = saved;
const views = {
  face: { position: [0, 1.655, -0.62], target: [0, 1.655, -0.05], fov: 18 },
  eyes: { position: [0, 1.692, -0.4], target: [0, 1.691, -0.05], fov: 14 },
};
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1400, height: 1000, scheme: "dark", debugPort: port + 5000 });
const run = (action: object) => page.evaluate(`window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)})`);
const report: Record<string, unknown> = { date: new Date().toISOString(), mode, views, shots: [] as string[] };
const shots = report.shots as string[];
const log = (message: string) => console.log(`[${mode}] ${message}`);
try {
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 300000);
  const canvas = await page.evaluate(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`) as never;
  await page.waitFor(`window.xfStudioPresentation.authoring.capability({ kind: "preview.setBody", enabled: false }).available`, 240000).catch(() => {});
  await run({ kind: "preview.setBody", enabled: false }).catch(() => undefined);
  await run({ kind: "preview.setHair", enabled: false }).catch(() => undefined);
  await page.waitFor(`!!window.xfStudioPresentation.authoring.previewState().motion?.available`, 240000);
  // The V's details (skin, brows, lashes) in place before the first capture.
  await page.waitFor(`(() => { const e = window.xfStudioSceneEvidence?.(); return !!e && (e.characterDetails?.components?.length ?? 0) > 0
    && !document.querySelector('[role=status]')?.textContent?.includes('Preparing your V'); })()`, 300000).catch(error => log(`details: ${error.message}`));
  await page.wait(2000);
  const snap = async (name: string) => {
    for (const [view, camera] of Object.entries(views)) {
      await run({ kind: "camera.restore", camera });
      await page.wait(700);
      const file = `${name}-${view}-${mode}.png`;
      await page.screenshot(resolve(out, file), canvas);
      shots.push(file);
    }
  };
  // The creator idle's face, paused at fixed times (the body is off: only the head's own motion shows).
  await run({ kind: "motion.setIdle", enabled: true });
  await page.wait(1500);
  report.motion = await page.evaluate(`JSON.parse(JSON.stringify(window.xfStudioPresentation.authoring.previewState().motion))`);
  report.idleEvidence = await page.evaluate(`window.xfStudioSceneEvidence().core.idle`);
  await run({ kind: "motion.setPaused", paused: true });
  for (const seconds of [2.0, 4.0, 11.0]) {
    await page.evaluate(`window.xfStudioSeekIdle(${seconds})`);
    await page.wait(600);
    await snap(`idle-${seconds.toFixed(1)}s`);
    log(`idle at ${seconds} s`);
  }
  // The eyes section's showcase at 1.5 s (brows up).
  const eyes = await run({ kind: "motion.setIdleClip", clip: "closeup-eyes" }).then(() => true, () => false);
  if (eyes) {
    await page.wait(3000);
    await run({ kind: "motion.setPaused", paused: true }).catch(() => undefined);
    await page.evaluate(`window.xfStudioSeekIdle(1.5)`);
    await page.wait(600);
    await snap("idle-eyes-section-1.5s");
  }
  await run({ kind: "motion.setIdle", enabled: false });
  await page.wait(800);
  // The game's blink.
  report.blinkEvidence = await page.evaluate(`window.xfStudioSceneEvidence().core.blink`);
  for (const value of [0.5, 1]) {
    await run({ kind: "motion.setBlink", value });
    await page.wait(800);
    await snap(`blink-${value * 100}`);
  }
  await run({ kind: "motion.setBlink", value: 0 });
  // Expressions from the drawer's start points (a natural sample, then vanilla photo-mode expressions).
  await page.evaluate(`window.xfStudioShell.runtime.modules.set("expressions", true)`);
  await page.wait(800);
  await page.evaluate(`window.xfStudioShell.dock.reveal("expressions.controls")`);
  await page.waitFor(`document.querySelectorAll(".expr-drawer .tree-row").length > 0`, 300000).catch(() => {});
  const facial = () => page.evaluate(`(() => { const s = window.xfStudioPresentation.facial?.snapshot?.(); return s ? { phase: s.phase, reason: s.reason ?? null, latency: s.latency ?? null } : null; })()`);
  const expressions: Record<string, unknown> = {};
  await page.waitFor(`window.xfStudioPresentation.facial.snapshot().startPoints.phase !== "preparing"`, 300000).catch(() => {});
  for (const name of ["Warm smile", "facial_happy", "facial_surprised", "facial_furious"]) {
    // The natural sample from its row; a vanilla expression by its start point (the game's rows may be folded).
    const clicked = name.startsWith("facial_")
      ? await page.evaluate(`(() => { const item = window.xfStudioPresentation.facial.snapshot().startPoints.items.find(i => i.clip === ${JSON.stringify(name)} && i.provider === "Base game")
          ?? window.xfStudioPresentation.facial.snapshot().startPoints.items.find(i => i.clip === ${JSON.stringify(name)});
        if (!item) return false;
        window.xfStudioShell.runtime.dispatch({ kind: "expression.startFrom", origin: { kind: "installed", clip: item.clip, set: item.set, row: item.row, provider: item.provider }, controls: item.controls });
        return true; })()`)
      : await page.evaluate(`(() => { const row = [...document.querySelectorAll(".expr-drawer .tree-row")].find(r => r.textContent.trim().startsWith(${JSON.stringify(name)})); row?.click(); return !!row; })()`);
    if (!clicked) { expressions[name] = "not listed"; continue; }
    await page.wait(2500);
    expressions[name] = await facial();
    await snap(`expression-${name.toLowerCase().replaceAll(" ", "-")}`);
    log(`expression ${name}`);
  }
  report.expressions = expressions;
  report.console = page.console.filter(m => m.type === "error" || m.type === "exception").slice(0, 30);
  writeFileSync(resolve(out, `run-${mode}.json`), JSON.stringify(report, null, 2));
  log(`Wrote ${shots.length} captures to ${out}`);
} finally { await page.close(); server.kill(); await server.exited; }

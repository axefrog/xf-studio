/**
 * Fixed-camera captures of the game's blink in an isolated `?verify=1` workspace (throwaway Chrome profile, disposable
 * workspace data): the default V, then each supplied save copy, at closure 0, 50 and 100 %, a Play blink frame and the
 * idle toggle. It also records the blink controls' state, surface picks over the lids while the blink is held, and
 * console errors.
 *
 *   bun tools/blink-look.ts <out dir under evidence/screenshots> [save copy ...]
 *
 * Outputs are private renders of local assets: keep them in the ignored evidence/screenshots tree.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, startServer } from "./cdp";

const [outArg, ...saves] = process.argv.slice(2);
if (!outArg) throw Error("Usage: bun tools/blink-look.ts <out dir> [save copy ...]");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const port = 4393;
const views = {
  eyes: { position: [0, 1.692, -0.4], target: [0, 1.691, -0.05], fov: 14 },
  eye: { position: [-0.03, 1.693, -0.26], target: [-0.03, 1.691, -0.06], fov: 12 },
  side: { position: [-0.15, 1.7, -0.19], target: [-0.03, 1.691, -0.06], fov: 14 },
};
const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1600, height: 1000, scheme: "dark", debugPort: port + 5000 });
const run = (action: object) => page.evaluate(`window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)})`);
const motion = () => page.evaluate(`window.xfStudioPresentation.authoring.previewState().motion`);
const detailsReady = `(() => { const e = window.xfStudioSceneEvidence?.(); return !!e && (e.characterDetails?.components?.length ?? 0) > 0
  && !document.querySelector('[role=status]')?.textContent?.includes('Preparing your V'); })()`;
const report: Record<string, unknown> = { date: new Date().toISOString(), views, subjects: {} };
try {
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 180000);
  const canvas = await page.evaluate(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`);
  report.blinkEvidence = await page.evaluate(`window.xfStudioSceneEvidence().core.blink`);
  for (const [index, subject] of ["default", ...saves].entries()) {
    if (index) {
      await page.chooseFiles([resolve(subject)]);
      await page.send("Runtime.evaluate", { expression: `window.xfStudioShell.runtime.file({ kind: "savedV.import" })`, awaitPromise: true, userGesture: true });
      await page.wait(3000);
    }
    await page.waitFor(detailsReady, 240000).catch(error => console.log("details:", error.message));
    await page.wait(2000);
    const label = index ? `save${index}` : "default";
    const evidence = await page.evaluate(`(() => { const e = window.xfStudioSceneEvidence(); return { components: e.characterDetails.components.map(c => c.slot + ":" + c.component) }; })()`);
    for (const action of [{ kind: "motion.setIdle", enabled: false }, { kind: "preview.setHair", enabled: false }]) await run(action);
    const captures: string[] = [], picks: Record<string, number> = {};
    for (const [name, camera] of Object.entries(views)) {
      await run({ kind: "camera.restore", camera });
      for (const value of [0, .5, 1]) {
        await run({ kind: "motion.setBlink", value });
        await page.wait(900);
        const file = `${label}-${name}-${value * 100}.png`;
        await page.screenshot(resolve(out, file), canvas); captures.push(file);
        if (name === "eye") {
          // Surface picks over the lid region while the pose is held: every hit is read on the posed surface.
          picks[`closure${value * 100}`] = await page.evaluate(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); let hits = 0;
            for (let x = 0.3; x <= 0.7; x += 0.05) for (let y = 0.3; y <= 0.6; y += 0.05)
              if (window.xfStudioPresentation.viewport.contextAt("head", r.left + r.width * x, r.top + r.height * y)) hits++; return hits; })()`);
        }
      }
    }
    await run({ kind: "camera.restore", camera: views.eye });
    await run({ kind: "motion.setBlink", value: 0 });
    await run({ kind: "motion.playBlink", playing: true });
    await page.wait(2500 + 80);
    await page.screenshot(resolve(out, `${label}-eye-play.png`), canvas); captures.push(`${label}-eye-play.png`);
    const playing = await motion();
    await run({ kind: "motion.playBlink", playing: false });
    await run({ kind: "motion.setBlink", value: .8 });
    await run({ kind: "motion.setIdle", enabled: true });
    await page.wait(1500);
    const withIdle = await motion();
    const disabled = await page.evaluate(`window.xfStudioPresentation.authoring.capability({ kind: "motion.setBlink", value: .5 })`);
    await page.screenshot(resolve(out, `${label}-eye-idle.png`), canvas); captures.push(`${label}-eye-idle.png`);
    await run({ kind: "motion.setIdle", enabled: false });
    await page.wait(500);
    const afterIdle = await motion();
    (report.subjects as Record<string, unknown>)[label] = { subject: index ? subject.split(/[\\/]/).pop() : "default V", evidence, captures, picks,
      playing, withIdle, blinkWhileIdle: disabled, afterIdle };
  }
  report.console = page.console.filter(m => m.type === "error" || m.type === "warning").slice(0, 40);
  writeFileSync(resolve(out, "run.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await page.close(); server.kill(); }

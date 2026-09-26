/**
 * Fixed-camera captures of V's worn clothing (knowledge/clothing.md) in an isolated `?verify=1` workspace with disposable data and a
 * throwaway Chrome profile: a save's V under each Clothing state (clothing-dressing.ts), framed as the head view and the whole-body view,
 * with the idle off, plus the scene's evidence (which garments drew, their layers and chunk masks) and the host's log.
 *
 *   bun tools/clothing-look.ts <out dir under evidence/screenshots> [port] <save copy> [states, comma-separated]
 *
 * Outputs are private renders of local game assets and a private save: keep them in the ignored evidence/screenshots tree.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, startServer } from "./cdp";

const [outArg, portArg = "4394", saveArg, statesArg = "no-headwear,saved,underwear"] = process.argv.slice(2);
if (!outArg || !saveArg) throw Error("Usage: bun tools/clothing-look.ts <out dir> [port] <save copy> [states]");
const out = resolve(outArg), port = +portArg;
mkdirSync(out, { recursive: true });
const views: Record<string, object | "body"> = {
  head: { position: [0, 1.62, -0.75], target: [0, 1.6, 0], fov: 30 },
  body: "body",
  side: { position: [-3.2, 1.05, -1.6], target: [0, 0.93, 0], fov: 30 },
  torso: { position: [0, 1.3, -1.1], target: [0, 1.25, 0], fov: 30 },
};
const { server } = await startServer(port);
const log: string[] = [];
const drain = async (stream: ReadableStream<Uint8Array> | undefined, tag: string) => {
  if (!stream) return;
  const decoder = new TextDecoder();
  for await (const chunk of stream) for (const line of decoder.decode(chunk).split(/\r?\n/)) if (line.trim()) log.push(`${tag} ${line}`);
};
void drain(server.stdout as ReadableStream<Uint8Array>, "[out]");
void drain(server.stderr as ReadableStream<Uint8Array>, "[err]");
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1400, height: 1000, scheme: "dark", debugPort: port + 5000 });
const run = (action: object) => page.evaluate(`window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)})`);
const evidence = () => page.evaluate(`(() => { const e = window.xfStudioSceneEvidence?.()?.characterDetails; return e ? { identity: e.identity,
  components: e.components.filter(c => c.slot === "clothing" || c.slot === "body") } : null; })()`);
const identity = () => page.evaluate(`window.xfStudioSceneEvidence?.()?.characterDetails?.identity ?? null`);
const settled = `(() => { const d = window.xfStudioPresentation.status.snapshot().assets?.characterDetails;
  return !!d && d.phase === "ready" && !d.updating; })()`;
const results: Record<string, unknown> = {};
try {
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 240000);
  await page.chooseFiles([resolve(saveArg)]);
  await page.send("Runtime.evaluate", { expression: `window.xfStudioShell.runtime.file({ kind: "savedV.import" })`, awaitPromise: true, userGesture: true });
  await page.waitFor(`(() => { const e = window.xfStudioSceneEvidence?.(); return !!e && e.characterDetails.components.some(c => c.slot === "body"); })()`, 1200000);
  await page.waitFor(settled, 1200000);
  for (const action of [{ kind: "preview.setSurfaceControls", enabled: false }, { kind: "preview.setExposure", value: 1.2 },
    { kind: "preview.setKeyAngle", degrees: 0 }, { kind: "motion.setIdle", enabled: false }]) await run(action).catch(() => undefined);
  for (const state of statesArg.split(",")) {
    const before = await identity();
    const dispatched = await run({ kind: "character.setClothing", state }).catch((error: unknown) => ({ error: String(error) }));
    // A state already shown is refused (`ok: false`): nothing to wait for.
    if ((dispatched as { ok?: boolean })?.ok) await page.waitFor(`(() => { const e = window.xfStudioSceneEvidence?.()?.characterDetails;
      return !!e && e.identity !== ${JSON.stringify(before)}; })()`, 1200000).catch(() => undefined);
    await page.waitFor(settled, 1200000);
    await page.wait(3000);
    for (const [name, camera] of Object.entries(views)) {
      await run(camera === "body" ? { kind: "camera.body" } : { kind: "camera.restore", camera });
      await page.wait(1500);
      await page.screenshot(resolve(out, `${state}-${name}.png`));
    }
    const status = await page.evaluate(`JSON.parse(JSON.stringify(window.xfStudioPresentation.status.snapshot().assets?.characterDetails ?? null))`);
    results[state] = { dispatched, status, evidence: await evidence() };
  }
  const gpu = await page.evaluate(`(() => { const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info"); return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown"; })()`);
  writeFileSync(resolve(out, "run.json"), JSON.stringify({ date: new Date().toISOString(), save: "(private save copy)", gpu, results,
    console: page.console.filter(m => m.type === "error" || m.type === "exception" || m.type === "warning").slice(0, 60) }, null, 2));
  console.log(`Wrote captures to ${out}`);
} finally {
  writeFileSync(resolve(out, "host.log"), log.join("\n"));
  await page.close(); server.kill();
}

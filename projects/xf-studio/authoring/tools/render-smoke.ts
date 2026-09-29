/**
 * Render smoke test: the Studio drawing a full V in a real GPU browser, failing on any shader or WebGL error (the full `bun test` suite
 * runs no GPU, so a program that fails to compile only shows in a page: 8474bb3 fixed a face skin program that declared its second
 * joint attributes twice, which drew a white face while every test passed).
 *
 *   bun tools/render-smoke.ts [--port 4497] [--cache <folder>]
 *
 * It starts its own isolated server (its own port, data folder and settings copied from the installed ones; never 4317), opens its
 * `?verify=1` workspace in a headless Chrome (GPU through ANGLE, a fresh profile, so every program is compiled), waits until the V's
 * details are ready and drawn, lets the programs compiled ahead while idle finish, chooses every finish on the first layer, switches the
 * hairstyle, and fails (exit 1) on any `THREE.WebGLProgram` shader error, WebGL error (`INVALID_OPERATION` and the like, a lost context),
 * uncaught exception or other console error, or when the V is not drawn. `--cache <folder>` keeps the preview and resolver caches there
 * between runs (a warm run takes about a minute; the first, cold, prepares the V from the game files and takes a few). Needs the game
 * set up in the installed settings, a GPU and Chrome, so it runs locally, not in CI (GitHub's hosted runners have neither the game nor a
 * GPU). Run it under the memory guard: `python tools/memory_guard.py --limit 6 -- bun tools/render-smoke.ts --cache <folder>`.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch } from "./cdp";
import { localSettingsDirectory } from "../src/local-settings-store";

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] ?? null : null; };
const port = Number(option("port") ?? 4497);
if (port === 4317) throw Error("Never test against the person's own server (4317).");
const cacheArg = option("cache");
const folder = cacheArg ? resolve(cacheArg) : mkdtempSync(join(tmpdir(), "xfs-render-smoke-"));
const data = join(folder, "data");
mkdirSync(data, { recursive: true });
const settings = join(localSettingsDirectory(), "settings.json");
if (!existsSync(settings)) { console.error("render smoke: no installed settings (set the game folder up in XF Studio first)."); process.exit(2); }
if (!existsSync(join(data, "settings.json"))) copyFileSync(settings, join(data, "settings.json"));

/** Console lines that fail the run: shader and WebGL errors in any level, and every error or exception. */
const FAILING = /WebGLProgram|Shader Error|shader error|INVALID_(OPERATION|VALUE|ENUM|FRAMEBUFFER_OPERATION)|GL_INVALID|CONTEXT_LOST|context lost|OUT_OF_MEMORY/i;
/** Errors that say nothing about drawing: a missing favicon. */
const BENIGN = /favicon\.ico/i;
/**
 * A program that linked, with only the D3D compiler's warnings in its log (three.js reports a non-empty log as a warning; X4122 is a
 * constant's rounding): drawn correctly, so it passes. A failed compile or link is `Shader Error`, an error.
 */
const compilerWarningsOnly = (text: string) => /Program Info Log/.test(text) && !/Shader Error/i.test(text)
  && text.split("\n").slice(1).every(line => !line.trim() || /warning X\d+/.test(line)) && /warning X\d+/.test(text);

const root = resolve(import.meta.dir, "..");
const server = Bun.spawn(["bun", "server.ts"], { cwd: root, stdout: "ignore", stderr: "pipe", env: { ...process.env, PORT: String(port), XFAS_DATA_DIR: data,
  XFS_SETTINGS_DIR: "", XFS_MOD_INSTALL: "off", XFS_PREVIEW_CORE_CACHE: join(folder, "preview-cache"), XFS_RESOLVER_CACHE: join(folder, "resolver-cache"),
  XFS_CHOICE_PREVIEW_CACHE: join(folder, "choice-previews"), XFS_PREPARED_BUDGET_GB: "off" } });
const failures: string[] = [];
let exitCode = 0;
try {
  let up = false;
  for (let i = 0; i < 1200 && !up; i++) {
    try { up = (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch { /* starting */ }
    if (!up) await Bun.sleep(100);
  }
  if (!up) throw Error("the server did not start");
  const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1200, height: 800 });
  try {
    const P = "window.xfStudioPresentation", EM = `${P}.feature('eye-makeup')`, status = `${P}.snapshot().status?.assets?.characterDetails`;
    const drawn = `(() => { const s = ${status}; const f = performance.getEntriesByName("xfs:character:frame"), p = performance.getEntriesByName("xfs:character:placed");
      return s?.phase === 'ready' && !s.updating && f.length > 0 && f.at(-1).startTime > (p.at(-1)?.startTime ?? 0); })()`;
    const started = performance.now();
    await page.waitFor(`${drawn} || ${status}?.phase === 'failed'`, 900_000);
    const shown = await page.evaluate(`${status}`) as { phase: string; message: string; slots: { slot: string; state: string }[] };
    if (shown.phase !== "ready") failures.push(`the V's details were not prepared: ${shown.message}`);
    console.log(`V ready in ${((performance.now() - started) / 1000).toFixed(1)} s: ${shown.slots.map(s => `${s.slot} ${s.state}`).join(", ")}`);
    // Programs compiled ahead while the view is idle (Glitter's glints and flakes) report their errors when first checked.
    await page.wait(6000);
    await page.waitFor(`!!${EM}?.view?.()?.recipe`, 60_000);
    for (const finish of ["matte", "regular", "metallic", "shimmer", "glitter", "glossy", "iridescent"]) {
      await page.evaluate(`(() => { const f = ${EM}, layer = f.view().recipe().layers[0];
        f.dispatch({ kind: 'layer.select', layerId: layer.id }); f.dispatch({ kind: 'layer.setFinish', layerId: layer.id, finish: ${JSON.stringify(finish)} }); })()`);
      await page.wait(1200);
    }
    // A hairstyle switch: a part new to the page, with its programs compiled ahead of its first frame.
    const hair = await page.evaluate(`(async () => {
      const a = ${P}.authoring;
      for (let i = 0; i < 200; i++) { const c = a.characterChoices("head/hairstyle", { offset: 0, limit: 8 }, ""); if (!c.loading) return c.choices[3] ?? null; await new Promise(r => setTimeout(r, 100)); }
      return null; })()`) as { key: string; activates?: string[] } | null;
    if (hair) {
      await page.evaluate(`(() => { performance.clearMarks("xfs:character:frame"); performance.clearMarks("xfs:character:placed");
        ${P}.authoring.dispatch({ kind: "character.setOption", part: "head", option: "hairstyle", choice: ${JSON.stringify(hair.key)}${hair.activates ? `, activates: ${JSON.stringify(hair.activates)}` : ""} }); })()`);
      await page.waitFor(`${drawn} || !!${status}?.updateError`, 300_000);
      const after = await page.evaluate(`${status}?.updateError`);
      if (after) failures.push(`the hairstyle switch failed: ${after}`);
    } else failures.push("no hairstyle choices were listed");
    await page.wait(2000);
    for (const entry of page.console) {
      const line = `${entry.type}: ${entry.text.slice(0, 600)}`;
      if (BENIGN.test(entry.text) || entry.type === "warning" && compilerWarningsOnly(entry.text)) continue;
      if (FAILING.test(entry.text) || entry.type === "error" || entry.type === "exception" || entry.type === "log:error") failures.push(line);
    }
  } finally { await page.close(); }
} catch (error) {
  failures.push(`the smoke test could not run: ${(error as Error).message}`);
} finally {
  server.kill();
  await server.exited;
  if (!cacheArg) rmSync(folder, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`render smoke FAILED (${failures.length}):\n${[...new Set(failures)].slice(0, 40).map(line => `  ${line}`).join("\n")}`);
  exitCode = 1;
} else console.log("render smoke passed: the V drew with every finish and a hairstyle switch, no shader, WebGL or console errors.");
process.exit(exitCode);

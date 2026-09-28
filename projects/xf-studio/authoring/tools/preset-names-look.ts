/**
 * Captures of new presets' default names (CORE-124) for design review, in an isolated `?verify=1` workspace with a throwaway Chrome
 * profile and its own authoring server (own port, own data folder; never 4317 or the person's draft). Starting from a fresh collection
 * ("First look"), the Presets panel floats beside the Lighting panel's light list (the other list whose new items are numbered, "Light N")
 * at a narrow (300 px) and a wide (480 px) width in both themes, after each step: Add twice; remove "Preset 2"; Add (the add, remove, add
 * case); remove "Preset 3", Add; then Restore. `run.json` records every step's names in list order and the pending Restore, and whether
 * any two presets share a name. The 3D view is masked (MASK_VIEWPORTS).
 *
 *   bun tools/preset-names-look.ts <out dir> [port]
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { launch, MASK_VIEWPORTS, saveJson, startServer } from "./cdp";

const [outArg, portArg = "4327"] = process.argv.slice(2);
if (!outArg) throw Error("Usage: bun tools/preset-names-look.ts <out dir> [port]");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const port = +portArg;
if (port === 4317) throw Error("Port 4317 is the person's own Studio; use another.");
// The Presets panel needs no game: an empty-settings server keeps V unloaded and the run small.
const { server } = await startServer(port, { settings: "empty" });
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1440, height: 960, scheme: "dark" }).catch(error => { server.kill(); throw error; });
type Box = { x: number; y: number; width: number; height: number };
const steps: { step: string; names: string[]; restore: string | null; duplicates: string[] }[] = [];
const shots: string[] = [];
const draft = `window.xfStudioShell.runtime.port.library.summary().draft`;
const theme = async (scheme: "light" | "dark") => {
  await page.colorScheme(scheme);
  await page.evaluate(`(() => { const root = document.documentElement; root.dataset.theme = ${JSON.stringify(scheme)}; root.style.colorScheme = ${JSON.stringify(scheme)}; })()`);
  await page.wait(300);
};
const dispatch = (command: string) => page.evaluate(`window.xfStudioShell.runtime.dispatch({ kind: "preset.edit", command: ${command} })`);
const idOf = (name: string) => page.evaluate(`${draft}.presets.find(p => p.name === ${JSON.stringify(name)})?.id`) as Promise<string>;
/** Click the panel's own button, as a person would. */
const click = (label: RegExp) => page.evaluate(`(() => { const b = [...document.querySelectorAll('[data-view-key="presets"] button, .dock-window button, .dock-group button')]
  .find(e => ${label}.test(e.textContent.trim()) && e.offsetParent); b?.click(); return !!b; })()`);
let lighting = false;
try {
  await page.waitFor("document.querySelector('.dock-group') && !!window.xfStudioShell && !!window.xfStudioPresentation", 120000);
  await page.evaluate(MASK_VIEWPORTS);
  await page.waitFor(`${draft}?.presets.length > 0`, 120000);
  await page.evaluate(`window.xfStudioShell.dock.reveal("presets")`);
  lighting = await page.evaluate(`(() => { try { window.xfStudioShell.dock.reveal("lighting"); return true; } catch { return false; } })()`);
  await page.wait(1000);
  const record = async (step: string) => {
    const state = await page.evaluate(`(() => { const d = ${draft}; return { names: d.presets.map(p => p.name), restore: d.removed.at(-1)?.name ?? null }; })()`) as { names: string[]; restore: string | null };
    const duplicates = state.names.filter((name, i) => state.names.indexOf(name) !== i);
    steps.push({ step, ...state, duplicates });
    console.log(`${step}: ${state.names.join(", ")}${state.restore ? ` | Restore “${state.restore}”` : ""}${duplicates.length ? ` | DUPLICATE ${duplicates.join(", ")}` : ""}`);
    for (const scheme of ["light", "dark"] as const) {
      await theme(scheme);
      for (const width of [300, 480]) {
        const x = 1420 - width, other = x - width - 30;
        await page.evaluate(`window.xfStudioShell.dock.moveTo("presets", { kind: "float", x: ${x}, y: 30, w: ${width}, h: 560 }, "")`);
        if (lighting) await page.evaluate(`window.xfStudioShell.dock.moveTo("lighting", { kind: "float", x: ${other}, y: 30, w: ${width}, h: 560 }, "")`).catch(() => { lighting = false; });
        await page.mouse("mouseMoved", 5, 950, { button: "none", buttons: 0 });
        await page.wait(600);
        const clip: Box = { x: (lighting ? other : x) - 10, y: 20, width: (lighting ? 2 * width + 30 : width) + 20, height: 580 };
        const name = `${step}-${scheme}-${width}`;
        await page.screenshot(resolve(out, `${name}.png`), clip);
        shots.push(name);
      }
    }
  };
  await record("0-start");
  if (!await click(/^Add preset$/)) await dispatch(`{ kind: "add" }`);
  await page.wait(200);
  if (!await click(/^Add preset$/)) await dispatch(`{ kind: "add" }`);
  await page.wait(200);
  await record("1-added-two");
  await dispatch(`{ kind: "remove", id: ${JSON.stringify(await idOf("Preset 2"))} }`);
  await page.wait(200);
  await record("2-removed-preset-2");
  if (!await click(/^Add preset$/)) await dispatch(`{ kind: "add" }`);
  await page.wait(200);
  await record("3-add-remove-add");
  await dispatch(`{ kind: "remove", id: ${JSON.stringify(await idOf("Preset 3"))} }`);
  await page.wait(200);
  if (!await click(/^Add preset$/)) await dispatch(`{ kind: "add" }`);
  await page.wait(200);
  await record("4-removed-preset-3-then-add");
  if (!await click(/^Restore “/)) await dispatch(`{ kind: "restore" }`);
  await page.wait(200);
  await record("5-restored");
  saveJson(resolve(out, "run.json"), { port, lighting, steps, shots });
} finally {
  await page.close();
  server.kill();
}

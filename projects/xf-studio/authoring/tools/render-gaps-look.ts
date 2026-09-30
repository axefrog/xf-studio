/**
 * Before-and-after captures of the render gap fixes (research/character-customization/render-gap-plans.md) in an isolated `?verify=1`
 * workspace (throwaway Chrome profile, headless) on an already running disposable-data server:
 *
 * - `teeth`: the default feminine V's mouth under the Character creator lighting at the idle's breath and a closed-mouth moment, the
 *   idle paused; with a build that has the mouth aperture also the earlier stand-in pinned (`xfStudioPinMouthInterior`), and each frame's
 *   measured aperture and the teeth crop's mean scene-linear luminance in `run.json`;
 * - `beard`: the default masculine V with a beard (the creator's beard switcher at `--beard <position>`, 5 by default), a three-quarter
 *   face view, and the Character panel's beard rows in the light and dark themes at a narrow and a wide panel;
 * - `arms`: a save copy (`--save <sav.dat>`) with its body on, both forearms in frame, under the studio and the creator lighting;
 * - `hair`: the default feminine V at the creator's hair framing under the Character creator lighting at three hair colours (the hair
 *   colour row's positions `--colours a,b,c`).
 *
 *   bun tools/render-gaps-look.ts <out dir> <port> [teeth,beard,arms,hair] [--save <sav.dat>] [--beard n] [--colours a,b,c]
 *
 * Outputs are private renders of local game assets: keep them in the ignored `local-evidence/` tree. The server is the caller's (run it
 * and this under the memory guard, and stop it by its own PID).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodePng } from "../src/png";
import { readSavedV } from "../src/save-reader";
import { launch } from "./cdp";

const argv = process.argv.slice(2);
const take = (name: string) => { const at = argv.indexOf(name); return at >= 0 ? argv.splice(at, 2)[1]! : null; };
const save = take("--save"), beardAt = Number(take("--beard") ?? 5), colours = (take("--colours") ?? "3,12,30").split(",").map(Number);
const [outArg, portArg, which = "teeth,beard,arms,hair"] = argv;
if (!outArg || !portArg) throw Error("Usage: bun tools/render-gaps-look.ts <out dir> <port> [teeth,beard,arms,hair] [--save file] [--beard n] [--colours a,b,c]");
const out = resolve(outArg), port = +portArg, scenarios = new Set(which.split(","));
mkdirSync(out, { recursive: true });
const report: Record<string, unknown> = { date: new Date().toISOString(), port, scenarios: [...scenarios] };
const linear = (byte: number) => { const c = byte / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
/** Mean scene-linear luminance of a PNG's box (fractions of its size). */
const boxLuminance = (file: string, box: [number, number, number, number]) => {
  const png = decodePng(readFileSync(file));
  const [x0, y0, x1, y1] = [box[0] * png.width, box[1] * png.height, box[2] * png.width, box[3] * png.height].map(Math.round) as [number, number, number, number];
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * png.width + x) * 4;
    sum += 0.2126 * linear(png.data[i]!) + 0.7152 * linear(png.data[i + 1]!) + 0.0722 * linear(png.data[i + 2]!); n++;
  }
  return n ? +(sum / n).toFixed(5) : null;
};

async function session(scheme: "light" | "dark", width = 960, height = 680, body = false) {
  const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width, height, scheme });
  const run = (action: object) => page.evaluate(`Promise.resolve(window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)}))`);
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 300000);
  // The body off unless the scenario needs it: the host then prepares the head alone, and the page holds far less (a 4 GB guard).
  if (!body) await run({ kind: "preview.setBody", enabled: false });
  /** The shown V placed and nothing preparing (the viewport's status line gone). */
  const ready = async (slot?: string) => {
    await page.wait(1500);
    await page.waitFor(`(() => { const e = window.xfStudioSceneEvidence?.()?.characterDetails; if (!e || !e.skin) return false;
      ${slot ? `if (!(e.components ?? []).some(c => c.slot === ${JSON.stringify(slot)})) return false;` : ""}
      return !/Preparing your V/.test(document.body.innerText); })()`, 900000);
  };
  const settle = async (ms = 1500) => {
    await page.wait(ms);
    await page.waitFor("(() => { const e = window.xfStudioSceneEvidence?.(); return e && !e.frames.running; })()", 60000).catch(() => undefined);
    await page.wait(300);
  };
  const identity = () => page.evaluate<string | null>(`window.xfStudioSceneEvidence()?.characterDetails?.identity ?? null`);
  /** Wait for a V other than `before` to be placed (with a skin). */
  const placed = (before: string | null, ms = 900000) => page.waitFor(`(() => { const e = window.xfStudioSceneEvidence()?.characterDetails;
    return !!e && e.identity !== ${JSON.stringify(before)} && !!e.skin; })()`, ms);
  const canvasRect = () => page.evaluate<{ x: number; y: number; width: number; height: number }>(`(() => {
    const g = document.getElementById("dock-tab-head")?.closest("[data-group]") ?? document;
    const c = [...g.querySelectorAll("canvas")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
  const maximize = () => page.evaluate(`(() => { const g = document.getElementById("dock-tab-head")?.closest("[data-group]");
    if (g) window.xfStudioShell.dock.toggleMaximize(g.dataset.group); })()`);
  /** Set a creator option by its panel row: the first option whose name matches, at a choice position. */
  const choose = async (pattern: string, position: number) => {
    await page.waitFor(`!!window.xfStudioPresentation.authoring.characterPanel()`, 300000);
    const option = await page.evaluate<{ id: string; part: string; name: string; label: string; count: number } | null>(`(() => {
      const panel = window.xfStudioPresentation.authoring.characterPanel();
      const view = window.xfStudioPresentation.authoring.characterView();
      const matching = panel.options.filter(o => new RegExp(${JSON.stringify(pattern)}, "i").test(o.name) && !/cyberware|fpp/i.test(o.name));
      // The one the shown V uses (an active row with a value), else the first.
      const o = matching.find(o => view?.values?.[o.id]) ?? matching[0];
      return o ? { id: o.id, part: o.part, name: o.name, label: o.label, count: o.count } : null; })()`);
    if (!option) throw Error(`No creator option matches ${pattern}`);
    await page.waitFor(`window.xfStudioPresentation.authoring.characterChoices(${JSON.stringify(option.id)}, 400).choices.length >= ${Math.min(position + 1, option.count)}`, 120000);
    const choice = await page.evaluate<{ key: string; label: string; position: number } | null>(`(() => {
      const c = window.xfStudioPresentation.authoring.characterChoices(${JSON.stringify(option.id)}, 400).choices.find(c => c.position === ${position});
      return c ? { key: c.key, label: c.label, position: c.position } : null; })()`);
    if (!choice) throw Error(`${option.label} has no choice at ${position}`);
    const before = await identity();
    await run({ kind: "character.setOption", part: option.part, option: option.name, choice: choice.key });
    await placed(before);
    return { option, choice };
  };
  return { page, run, settle, identity, placed, canvasRect, maximize, choose, ready };
}

try {
  if (scenarios.has("teeth")) {
    const s = await session("dark");
    await s.ready("teeth");
    for (const action of [{ kind: "preview.setSurfaceControls", enabled: false }, { kind: "preview.setLightingPreset", preset: "creator" },
      { kind: "preview.setHair", enabled: false }, { kind: "motion.setIdle", enabled: true }, { kind: "motion.setPaused", paused: true }]) await s.run(action).catch(() => undefined);
    await s.maximize(); await s.settle(3000);
    const rect = await s.canvasRect();
    await s.run({ kind: "camera.restore", camera: { position: [0, 1.627, -0.30], target: [0, 1.622, -0.068], fov: 10 } });
    // Where the parting sits in the frame (the camera restore keeps the idle's displacement, so the mouth is off centre).
    const teethBox: [number, number, number, number] = [0.1, 0.585, 0.38, 0.625];
    const hasMouth = await s.page.evaluate<boolean>(`!!window.xfStudioSceneEvidence()?.mouth`);
    const frames: Record<string, unknown>[] = [];
    for (const t of [2.4, 14.45, 6.0]) {
      await s.page.evaluate(`window.xfStudioSeekIdle(${t})`);
      // The mouth crop's box: the middle of the frame, where the parting is.
      const shoot = async (name: string) => {
        await s.settle(1200);
        const file = resolve(out, `${name}.png`);
        await s.page.screenshot(file, rect);
        return { name, mouth: hasMouth ? await s.page.evaluate(`window.xfStudioSceneEvidence().mouth`) : null,
          luminance: { teethBox: boxLuminance(file, teethBox) } };
      };
      frames.push({ t, ...(await shoot(`teeth-t${t}`)) });
      if (hasMouth) {
        await s.page.evaluate(`window.xfStudioPinMouthInterior({ parting: 0.010, floor: 0.3 })`);
        frames.push({ t, pinnedOld: true, ...(await shoot(`teeth-t${t}-old-stand-in`)) });
        await s.page.evaluate(`window.xfStudioPinMouthInterior(null)`);
      }
    }
    report.teeth = { hasMouth, frames };
    await s.page.close();
  }
  if (scenarios.has("beard")) {
    const dark = await session("dark");
    const before = await dark.identity();
    await dark.run({ kind: "character.useDefault", bodyGender: "male" });
    await dark.placed(before);
    const picked = await dark.choose("^beard$", beardAt);
    await dark.ready("face");
    for (const action of [{ kind: "preview.setSurfaceControls", enabled: false }, { kind: "preview.setLightingPreset", preset: "creator" },
      { kind: "motion.setIdle", enabled: false }]) await dark.run(action).catch(() => undefined);
    const evidence = await dark.page.evaluate(`(() => { const e = window.xfStudioSceneEvidence().characterDetails;
      return { slots: e.slots ?? null, face: (e.components ?? []).filter(c => c.slot === "face").map(c => ({ option: c.option, component: c.component, meshes: c.meshes ?? null })) }; })()`);
    const panelShot = async (s: Awaited<ReturnType<typeof session>>, name: string) => {
      await s.page.evaluate(`window.xfStudioShell.dock.reveal("character")`);
      await s.page.wait(1500);
      // The Character panel's beard rows: the panel scrolled to the first row whose label mentions a beard.
      const box = await s.page.evaluate<{ x: number; y: number; width: number; height: number } | null>(`(() => {
        const row = [...document.querySelectorAll(".cc-row")].find(r => /beard/i.test(r.querySelector(".cc-row-label")?.textContent ?? ""));
        if (!row) return null; row.scrollIntoView({ block: "center" });
        const panel = row.closest("[data-group]") ?? row.parentElement; const r = panel.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
      await s.page.wait(800);
      if (box) await s.page.screenshot(resolve(out, `${name}.png`), box);
      return !!box;
    };
    await dark.maximize(); await dark.settle(3000);
    const rect = await dark.canvasRect();
    await dark.run({ kind: "camera.restore", camera: { position: [-0.25, 1.64, -0.42], target: [0, 1.62, 0], fov: 20 } });
    await dark.settle(); await dark.page.screenshot(resolve(out, "beard-three-quarter.png"), rect);
    await dark.run({ kind: "camera.restore", camera: { position: [0, 1.63, -0.5], target: [0, 1.62, 0], fov: 16 } });
    await dark.settle(); await dark.page.screenshot(resolve(out, "beard-front.png"), rect);
    await dark.maximize(); await dark.settle(1500);
    const panels: Record<string, boolean> = { "panel-dark-wide": await panelShot(dark, "beard-panel-dark-wide") };
    await dark.page.close();
    const light = await session("light", 820, 760);
    const b2 = await light.identity();
    await light.run({ kind: "character.useDefault", bodyGender: "male" });
    await light.placed(b2);
    await light.choose("^beard$", beardAt);
    panels["panel-light-narrow"] = await panelShot(light, "beard-panel-light-narrow");
    await light.page.close();
    report.beard = { picked, evidence, panels };
  }
  if (scenarios.has("arms") && save) {
    // The head first (body off), then the save, then the body: a body-on first load is the heaviest page state.
    const s = await session("dark", 800, 560);
    await s.ready();
    // Hair and clothes off: the forearms in view, and less for the page to hold.
    await s.run({ kind: "preview.setHair", enabled: false }).catch(() => undefined);
    await s.run({ kind: "quality.set", size: 1024 }).catch(() => undefined);
    const before = await s.identity();
    // The save decoded here with XF Studio's own reader and shown through the character context (no file picker in a headless page).
    const decoded = readSavedV(new Uint8Array(readFileSync(resolve(save))));
    report.armsSave = { isMale: decoded.isMale, arms: decoded.loadout?.arms ?? null };
    await s.run({ kind: "character.loadSave", value: decoded });
    await s.placed(before, 240000);
    await s.run({ kind: "character.setClothing", state: "underwear" }).catch(() => undefined);
    for (const action of [{ kind: "preview.setSurfaceControls", enabled: false }, { kind: "preview.setBody", enabled: true },
      { kind: "motion.setIdle", enabled: false }]) await s.run(action).catch(() => undefined);
    await s.page.waitFor(`(window.xfStudioSceneEvidence()?.characterDetails?.components ?? []).some(c => c.slot === "body")`, 900000);
    await s.maximize(); await s.settle(4000);
    const rect = await s.canvasRect();
    const arms = await s.page.evaluate(`(window.xfStudioSceneEvidence().characterDetails.components ?? []).filter(c => c.slot === "body").map(c => c.option ?? c.component)`);
    const shots: string[] = [];
    for (const preset of ["studio", "creator"]) {
      await s.run({ kind: "preview.setLightingPreset", preset });
      await s.run({ kind: "camera.body" }).catch(() => undefined);
      await s.settle(2000);
      await s.page.screenshot(resolve(out, `arms-${preset}-body.png`), rect);
      shots.push(`arms-${preset}-body`);
      for (const [name, camera] of Object.entries({ right: { position: [-0.55, 1.05, -0.75], target: [-0.22, 1.0, 0], fov: 24 },
        left: { position: [0.55, 1.05, -0.75], target: [0.22, 1.0, 0], fov: 24 } })) {
        await s.run({ kind: "camera.restore", camera });
        await s.settle(2000);
        await s.page.screenshot(resolve(out, `arms-${preset}-${name}.png`), rect);
        shots.push(`arms-${preset}-${name}`);
      }
    }
    report.arms = { components: arms, shots, notes: await s.page.evaluate(`window.xfStudioSceneEvidence().characterDetails.notes ?? null`) };
    await s.page.close();
  }
  if (scenarios.has("hair")) {
    const s = await session("dark");
    await s.ready("hair");
    for (const action of [{ kind: "preview.setSurfaceControls", enabled: false }, { kind: "motion.setIdle", enabled: false },
      { kind: "preview.setLightingPreset", preset: "creator" }, { kind: "camera.creatorFraming", page: "hair" }]) await s.run(action).catch(() => undefined);
    await s.maximize(); await s.settle(3000);
    const rect = await s.canvasRect();
    const picked: unknown[] = [];
    for (const position of colours) {
      picked.push(await s.choose("^hair_color", position));
      await s.ready("hair");
      await s.run({ kind: "camera.creatorFraming", page: "hair" }).catch(() => undefined);
      await s.settle(2500);
      const file = resolve(out, `hair-colour-${position}.png`);
      await s.page.screenshot(file, rect);
      // The crown (top middle) and the lengths (lower sides), as hair shading §8's regions roughly place them.
      picked.push({ position, crown: boxLuminance(file, [0.4, 0.12, 0.6, 0.22]), lengthLeft: boxLuminance(file, [0.28, 0.5, 0.38, 0.7]) });
    }
    report.hair = picked;
    await s.page.close();
  }
} finally {
  writeFileSync(resolve(out, "run.json"), JSON.stringify(report, null, 2));
  console.log(`Wrote ${out}`);
}

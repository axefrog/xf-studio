/**
 * Captures of the Rendering options (the Preview quality panel's Rendering group) in an isolated `?verify=1` workspace (disposable data,
 * throwaway Chrome profile) on its own port (never 4317 or the person's draft):
 * - with `3d`: the default feminine V at one framing each, side by side: Hair look Crisp | Game-like (the creator's hair camera) and
 *   Skin scattering on | off (the creator's face camera), each pair drawn back to back with nothing else changed;
 * - the Preview quality panel floating at 300 px, with Hair look at Crisp, 60 % and Game-like.
 *
 *   bun tools/rendering-look.ts <out dir under evidence/screenshots> [port] [light|dark] [3d]
 *
 * A server already answering on the port is used as it is (its data is the caller's to isolate); otherwise one is started with a
 * disposable data folder. The server inherits this process's environment (point `XFS_PREVIEW_CORE_CACHE` and `XFS_RESOLVER_CACHE` at
 * warm caches). The 3D captures show game-derived imagery, so keep the outputs in the ignored evidence/screenshots tree.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, startServer } from "./cdp";

const [outArg, portArg = "4377", schemeArg = "dark", mode = ""] = process.argv.slice(2);
if (!outArg || (schemeArg !== "light" && schemeArg !== "dark")) throw Error("Usage: bun tools/rendering-look.ts <out dir> [port] [light|dark] [3d]");
const out = resolve(outArg), port = +portArg;
mkdirSync(out, { recursive: true });
const running = await fetch(`http://127.0.0.1:${port}/health`).then(response => response.ok, () => false);
const started = running ? null : await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1300, height: 940, scheme: schemeArg, debugPort: port + 5000 });
const run = (action: object) => page.evaluate(`window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)})`);
const ready = "window.xfStudioPresentation?.authoring.previewState().character?.phase === 'ready' && window.xfStudioPresentation.viewport.snapshot().head.phase === 'ready'";
try {
  await page.waitFor(`document.querySelector('.dock-group') && ${ready}`, 300000);
  // The head is the subject: without the body or the idle the capture's memory stays small.
  for (const action of [{ kind: "preview.setBody", enabled: false }, { kind: "motion.setIdle", enabled: false }]) await run(action).catch(() => undefined);
  if (mode === "3d") {
    await run({ kind: "character.useDefault", bodyGender: "female" });
    await page.wait(1500);
    await page.waitFor(`${ready} && window.xfStudioPresentation.authoring.previewState().character.bodyGender === 'female'
      && window.xfStudioSceneEvidence().characterDetails?.slots?.some(s => s.slot === 'hair' && s.state === 'shown')`, 300000);
    await page.evaluate(`window.xfStudioShell.dock.moveTo("head", { kind: "float", x: 20, y: 20, w: 640, h: 800 }, "")`);
    await page.wait(2500);
    /** Draw each state back to back and lay the frames side by side, labelled, in one PNG (the drawing buffer read in the same task). */
    const pair = async (name: string, camera: "face" | "hair", states: [string, object][], crop: number, at = { x: 0.5, y: 0.45 }, zoom = 1) => {
      await run({ kind: "camera.creatorFraming", page: camera });
      await page.wait(1500);
      const url = await page.evaluate(`(() => {
        const canvas = document.querySelector(".device-head canvas"), a = window.xfStudioPresentation.authoring, rig = window.xfStudioCreatorRig;
        const states = ${JSON.stringify(states)}, frames = [];
        for (const [label, action] of states) { a.dispatch(action); rig.frameMs(2); const copy = document.createElement("canvas");
          copy.width = canvas.width; copy.height = canvas.height; copy.getContext("2d").drawImage(canvas, 0, 0); frames.push([label, copy]); }
        a.dispatch({ kind: "view.endEdit" });
        const side = Math.round(Math.min(canvas.width, canvas.height) * ${crop}), x = canvas.width * ${at.x} - side / 2, y = canvas.height * ${at.y} - side / 2;
        const shown = side * ${zoom}, out = document.createElement("canvas"); out.width = shown * frames.length; out.height = shown + 28;

        const g = out.getContext("2d"); g.fillStyle = "#111"; g.fillRect(0, 0, out.width, out.height); g.font = "16px system-ui"; g.fillStyle = "#eee";
        g.imageSmoothingEnabled = false;
        frames.forEach(([label, frame], i) => { g.drawImage(frame, x, y, side, side, i * shown, 28, shown, shown); g.fillText(label, i * shown + 8, 20); });
        return out.toDataURL("image/png"); })()`);
      writeFileSync(resolve(out, `${name}.png`), Buffer.from(String(url).split(",")[1]!, "base64"));
    };
    await pair("hair-crisp-vs-game-like", "hair", [["Hair look: Crisp", { kind: "preview.setHairLook", value: 0 }],
      ["Hair look: Game-like", { kind: "preview.setHairLook", value: 1 }]], 0.5);
    await pair("hair-crisp-vs-game-like-close", "hair", [["Hair look: Crisp", { kind: "preview.setHairLook", value: 0 }],
      ["Hair look: Game-like", { kind: "preview.setHairLook", value: 1 }]], 0.25, { x: 0.3, y: 0.42 }, 2);
    await run({ kind: "preview.setHairLook", value: 0 });
    await pair("scatter-on-vs-off", "face", [["Skin scattering on", { kind: "preview.setSkinScatter", enabled: true }],
      ["Skin scattering off", { kind: "preview.setSkinScatter", enabled: false }]], 0.62);
    await pair("face-shadows-on-vs-off", "face", [["Face shadows on", { kind: "preview.setFaceShadows", enabled: true }],
      ["Face shadows off", { kind: "preview.setFaceShadows", enabled: false }]], 0.62);
    for (const action of [{ kind: "preview.setSkinScatter", enabled: true }, { kind: "preview.setFaceShadows", enabled: true }]) await run(action);
  }
  // The panel at 300 px: as it opens (Hair look Crisp), then at a middle value and Game-like with the switches off.
  const width = 300;
  await page.evaluate(`window.xfStudioShell.dock.moveTo("quality", { kind: "float", x: 760, y: 20, w: ${width}, h: 480 }, "")`);
  await page.wait(1200);
  const box = async () => page.evaluate(`(() => { const e = [...document.querySelectorAll(".dock-floating > *")].find(n => n.textContent.includes("Hair look"));
    const r = e?.getBoundingClientRect(); if (!r) return null; const y = Math.max(0, r.top - 20);
    return { x: Math.round(r.left), y: Math.round(y), width: Math.round(r.width), height: Math.round(Math.min(innerHeight, r.bottom + 20) - y) }; })()`);
  for (const [name, look, on] of [["look-0", 0, true], ["look-60", 0.6, false], ["look-100", 1, false]] as const) {
    for (const action of [{ kind: "preview.setSkinScatter", enabled: on }, { kind: "preview.setFaceShadows", enabled: on },
      { kind: "preview.setHairLook", value: look }, { kind: "view.endEdit" }]) await run(action);
    await page.wait(700);
    await page.screenshot(resolve(out, `${schemeArg}-${width}-${name}.png`), (await box()) ?? undefined);
  }
  for (const action of [{ kind: "preview.setSkinScatter", enabled: true }, { kind: "preview.setFaceShadows", enabled: true },
    { kind: "preview.setHairLook", value: 0 }, { kind: "view.endEdit" }]) await run(action);
  writeFileSync(resolve(out, `${schemeArg}-console.json`), JSON.stringify(page.console.filter(m => m.type === "error" || m.type === "exception").slice(0, 20), null, 2));
} finally { await page.close(); started?.server.kill(); }

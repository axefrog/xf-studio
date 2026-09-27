/**
 * Fixed-camera captures of hair physics (research/animation/hair-physics-plan.md) in an isolated `?verify=1` workspace with disposable data
 * and a throwaway Chrome profile: the default V's hair standing still with physics off (its authored shape) and on (the settled drape),
 * then a short frame sequence of one of the game's idles (paused at fixed motion times, which re-simulate deterministically) with
 * physics off and on, plus the dangles' evidence (every chain bone's position) and the tips' travel.
 *
 *   bun tools/hair-physics-look.ts <out dir under evidence/screenshots> [port] [idle id] [frames] [step seconds]
 *
 * The server inherits this process's environment, so point `XFS_PREVIEW_CORE_CACHE` and `XFS_RESOLVER_CACHE` at warm caches to avoid
 * exporting everything again. Outputs are private renders of local game assets: keep them in the ignored evidence/screenshots tree.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, startServer } from "./cdp";

const [outArg, portArg = "4471", idleArg = "inventory", framesArg = "12", stepArg = "0.25"] = process.argv.slice(2);
if (!outArg) throw Error("Usage: bun tools/hair-physics-look.ts <out dir> [port] [idle id] [frames] [step seconds]");
const out = resolve(outArg), port = +portArg, frames = +framesArg, step = +stepArg;
mkdirSync(out, { recursive: true });
// The head is about 1.6 m up; V faces −Z (the front camera stands at −Z).
const views = {
  side: { position: [1.25, 1.5, 0.05], target: [0, 1.45, 0.02], fov: 30 },
  back: { position: [0.45, 1.52, 1.2], target: [0, 1.45, 0.02], fov: 30 },
};
const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 900, height: 800, scheme: "dark", debugPort: port + 5000 });
const run = (action: object) => page.evaluate(`window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)})`);
const dangles = () => page.evaluate(`window.xfStudioSceneEvidence()?.dangles ?? null`) as Promise<{ physics: boolean; parts: number; simulated: boolean; simTime: number;
  notes: string[]; bones: { part: string; name: string; at: number[] }[] } | null>;
try {
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 240000);
  await page.waitFor(`(window.xfStudioSceneEvidence()?.dangles?.parts ?? 0) > 0`, 900000);
  await page.wait(3000);
  for (const action of [{ kind: "preview.setSurfaceControls", enabled: false }, { kind: "preview.setExposure", value: 1.2 },
    { kind: "preview.setKeyAngle", degrees: 30 }, { kind: "preview.setBody", enabled: true }]) await run(action).catch(() => undefined);
  const shots: string[] = [];
  // Only the 3D view.
  const clip = await page.evaluate(`(() => { const r = document.querySelector('#device-head canvas').getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
  const capture = async (name: string) => { await page.wait(1200); await page.screenshot(resolve(out, `${name}.png`), clip); shots.push(name); };
  const record: Record<string, unknown> = {};
  // Still: the authored shape (physics off) and the settled drape (physics on).
  await run({ kind: "motion.setIdle", enabled: false });
  for (const physics of [false, true]) {
    await run({ kind: "motion.setPhysics", enabled: physics });
    record[`still-${physics ? "on" : "off"}`] = await dangles();
    for (const [name, camera] of Object.entries(views)) { await run({ kind: "camera.restore", camera }); await capture(`still-physics-${physics ? "on" : "off"}-${name}`); }
  }
  // The idle, paused at fixed motion times: each time re-simulates from the loop's start, so the frames don't depend on capture timing.
  await run({ kind: "motion.setIdleClip", clip: idleArg }).catch(() => undefined);
  await run({ kind: "motion.setIdle", enabled: true });
  await page.wait(3000);
  await run({ kind: "motion.setPaused", paused: true });
  await run({ kind: "camera.restore", camera: views.side });
  const sequence: Record<string, { t: number; bones: { part: string; name: string; at: number[] }[] }[]> = {};
  for (const physics of [false, true]) {
    await run({ kind: "motion.setPhysics", enabled: physics });
    const key = physics ? "on" : "off";
    sequence[key] = [];
    for (let k = 0; k < frames; k++) {
      const t = +(k * step).toFixed(4);
      await page.evaluate(`window.xfStudioSeekIdle(${t})`);
      const d = await dangles();
      sequence[key]!.push({ t, bones: d?.bones ?? [] });
      await capture(`idle-${idleArg}-physics-${key}-${String(k).padStart(2, "0")}`);
    }
  }
  // Tip travel: each strand's last joint (the highest-numbered joint of its chain), how far it moves over the sequence.
  const travel = (key: string) => {
    const seq = sequence[key]!, names = [...new Set(seq[0]!.bones.map(b => b.name))];
    const last = new Map<string, string>();
    for (const name of names) { const chain = name.replace(/_\d+$/, ""); if (!last.has(chain) || name > last.get(chain)!) last.set(chain, name); }
    return Object.fromEntries([...last.values()].map(name => {
      const at = seq.map(frame => frame.bones.find(b => b.name === name)?.at ?? [0, 0, 0]);
      const path = at.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0]! - at[i]![0]!, p[1]! - at[i]![1]!, p[2]! - at[i]![2]!), 0);
      return [name, Math.round(path * 1000) / 10];
    }));
  };
  const timing = await page.evaluate(`window.xfStudioSceneEvidence()?.frames ?? null`).catch(() => null);
  writeFileSync(resolve(out, "run.json"), JSON.stringify({ date: new Date().toISOString(), idle: idleArg, frames, step, shots, still: record,
    tipTravelCm: { off: travel("off"), on: travel("on") }, sequence, timing,
    console: page.console.filter(m => m.type === "error" || m.type === "exception" || m.type === "warning").slice(0, 60) }, null, 2));
  console.log(`Wrote ${shots.length} captures to ${out}`);
} finally { await page.close(); server.kill(); }

/**
 * Headless evaluation of the face-capture prototype (experiment 026). Opens the prototype (serve.ts) in a throwaway headless Chrome
 * whose fake camera plays generated/media/camera.y4m, then:
 *
 * 1. still images: MediaPipe blendshapes and mapped controls for every still (V renders of known vectors, side probes, CC0 photos);
 *    for V renders, how far the recovered vector is from the one that made the render (round trip);
 * 2. the camera path: getUserMedia on the fake camera, V driven live for a while, frame rate and latency sampled, page screenshots;
 * 3. capture: one snapshot saved as an expression preset in the verification library;
 * 4. privacy: every network request the page made, which must all stay on 127.0.0.1.
 *
 *     bun experiments/026-natural-expressions/face-capture/evaluate.ts --page http://127.0.0.1:4464 --out <dir>
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch } from "../../../projects/xf-studio/authoring/tools/cdp";

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1]! : fallback; };
const page = arg("--page", "http://127.0.0.1:4464"), out = resolve(arg("--out", resolve(import.meta.dir, "..", "generated", "evaluation")));
const seconds = Number(arg("--seconds", "30"));
mkdirSync(out, { recursive: true });
const here = resolve(import.meta.dir, "..");
const media = resolve(here, "generated", "media");

// Truth vectors for V renders.
const truth: Record<string, Record<string, number>> = { rest: {} };
for (const f of readdirSync(resolve(here, "../../projects/xf-studio/authoring/data/expression-samples")))
  truth[f.replace(".json", "")] = JSON.parse(readFileSync(resolve(here, "../../projects/xf-studio/authoring/data/expression-samples", f), "utf8")).part.body.controls;
for (const item of JSON.parse(readFileSync(resolve(here, "generated/installed-expressions.json"), "utf8")).items) truth[item.clip] ??= item.controls;
Object.assign(truth, JSON.parse(readFileSync(resolve(here, "generated/probes.json"), "utf8")));

const session = await launch(`${page}/face-capture/`, { width: 1600, height: 1000, scheme: "light", args: ["--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${resolve(media, "camera.y4m")}`, "--autoplay-policy=no-user-gesture-required"] });
const requests: string[] = [];
session.on("Network.requestWillBeSent", (p: any) => requests.push(p.request.url));
await session.send("Network.enable");
const report: Record<string, any> = { date: new Date().toISOString(), page };
try {
  await session.waitFor("!!window.faceCapture", 60000);
  await session.evaluate("window.faceCapture.ready.then(() => true)");
  await session.waitFor("window.faceCapture && true", 5000);
  // 1. Stills
  const stills = readdirSync(resolve(media, "stills")).sort();
  const analyse = (name: string) => session.evaluate(`window.faceCapture.analyseImage("./media/stills/${name}")`);
  await session.send("Runtime.evaluate", { expression: `window.faceCapture.analyseImage("./media/stills/v-rest.png").then(r => { window.__restScores = r.scores; return true; })`, awaitPromise: true });
  const results: any[] = [];
  for (const neutral of ["none", "v-rest"]) {
    if (neutral === "v-rest") await session.evaluate(`window.faceCapture.setNeutral(window.__restScores)`);
    for (const name of stills) {
      const r = (await session.send("Runtime.evaluate", { expression: `window.faceCapture.analyseImage("./media/stills/${name}")`, awaitPromise: true, returnByValue: true })).result.value;
      const key = name.replace(/^(v|bald)-/, "").replace(/\.(png|jpg)$/, "");
      const t = truth[key];
      let error: any = null;
      if (t && name.startsWith("v-") || t && name.startsWith("bald-")) {
        const names = new Set([...Object.keys(t), ...Object.keys(r.controls)]);
        const diffs = [...names].map(n => ({ n, truth: t[n] ?? 0, got: r.controls[n] ?? 0 }));
        const mae = diffs.reduce((s, d) => s + Math.abs(d.truth - d.got), 0) / Math.max(1, diffs.length);
        const dot = diffs.reduce((s, d) => s + d.truth * d.got, 0), nt = Math.hypot(...diffs.map(d => d.truth)), ng = Math.hypot(...diffs.map(d => d.got));
        error = { mae, cosine: nt && ng ? dot / (nt * ng) : null, worst: diffs.sort((a, b) => Math.abs(b.truth - b.got) - Math.abs(a.truth - a.got)).slice(0, 6) };
      }
      results.push({ neutral, name, found: r.found, ms: r.ms, top: Object.entries(r.scores as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 10), controls: r.controls, error });
    }
  }
  report.stills = results;
  await session.evaluate(`window.faceCapture.setNeutral(null)`);
  // 2. Camera path
  const started = (await session.send("Runtime.evaluate", { expression: `window.faceCapture.start("camera").then(() => window.faceCapture.state.running)`, awaitPromise: true, returnByValue: true })).result.value;
  report.cameraStarted = started;
  report.cameraMetrics = [];
  for (let s = 0; s < seconds; s += 3) {
    await session.wait(3000);
    report.cameraMetrics.push(await session.evaluate(`window.faceCapture.metrics()`));
    if (s % 6 === 0) await session.screenshot(resolve(out, `camera-${String(s).padStart(2, "0")}.png`));
  }
  // 3. Capture
  report.capture = (await session.send("Runtime.evaluate", { expression: `window.faceCapture.capture("Captured from the test camera")`, awaitPromise: true, returnByValue: true })).result.value;
  await session.evaluate(`window.faceCapture.stop()`);
  report.indicatorAfterStop = await session.evaluate(`document.getElementById("indicator").classList.contains("on")`);
  // 4. Privacy
  report.requests = { total: requests.length, offOrigin: requests.filter(u => !/^(https?:\/\/127\.0\.0\.1[:/]|data:|blob:|chrome|about:)/.test(u)) };
  report.console = session.console.filter(m => m.type === "error" || m.type === "warning").map(m => m.text).slice(0, 30);
} finally {
  writeFileSync(resolve(out, "evaluation.json"), JSON.stringify(report, null, 1));
  await session.close();
}
const summary = (report.stills ?? []).filter((r: any) => r.error).map((r: any) => `${r.neutral.padEnd(6)} ${r.name.padEnd(34)} mae ${r.error.mae.toFixed(3)} cos ${r.error.cosine?.toFixed(2)}`);
console.log(summary.join("\n"));
console.log("camera:", JSON.stringify(report.cameraMetrics?.at(-1)));
console.log("off-origin requests:", JSON.stringify(report.requests?.offOrigin));

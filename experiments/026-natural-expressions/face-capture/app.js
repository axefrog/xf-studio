// Face capture prototype (experiment 026): camera or test file -> MediaPipe Face Landmarker (52 blendshapes, on this computer) ->
// 1€ smoothing -> neutral correction -> ARKit-to-CP2077 mapping -> V's face in the Studio iframe through the expressions feature's
// own `expression.startFrom` action and the live facial solver. Frames are never uploaded or stored; the page's Content Security
// Policy (connect-src 'self') also blocks the MediaPipe library's own usage-metrics upload.
import { FaceLandmarker, FilesetResolver } from "./mp/vision_bundle.mjs";
import { mapBlendshapes, neutralCorrect } from "./mapping.js";
import { FilterBank } from "./filters.js";

const $ = id => document.getElementById(id);
const video = $("video"), frame = $("studio");
const params = new URLSearchParams(location.search);
const state = { stream: null, source: null, running: false, neutral: null, last: {}, controls: {}, sent: null, sending: false, lastSend: 0,
  detect: [], map: [], frames: 0, started: 0, sends: 0, noFace: 0, delegate: "" };
const filters = new FilterBank({ minCutoff: 1.5, beta: 0.3 });
const settings = () => ({ swapSides: $("swap").checked, gain: +$("gain").value, regionGain: { brows: +$("upper").value, eyes: +$("upper").value } });
const status = text => { $("status").textContent = text; };

// ---- MediaPipe (served from this origin: the official @mediapipe/tasks-vision build and face_landmarker.task) ----
let videoLandmarker = null, imageLandmarker = null, fileset = null;
async function landmarker(mode) {
  fileset ??= await FilesetResolver.forVisionTasks(new URL("./mp/wasm", location.href).href);
  const make = async delegate => FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: new URL("./model/face_landmarker.task", location.href).href, delegate },
    runningMode: mode, numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: false });
  try { const l = await make("GPU"); state.delegate = "GPU"; return l; }
  catch { const l = await make("CPU"); state.delegate = "CPU"; return l; }
}
const scoresOf = result => Object.fromEntries((result?.faceBlendshapes?.[0]?.categories ?? []).map(c => [c.categoryName, c.score]));

// ---- The Studio beside us (same origin through the prototype's proxy; an isolated ?verify=1 workspace) ----
const studio = () => frame.contentWindow;
async function studioReady() {
  for (let i = 0; i < 600; i++) {
    const w = studio();
    try { if (w?.xfStudioPresentation?.viewport.snapshot().head.phase === "ready" && w.xfStudioShell) break; } catch { /* loading */ }
    await new Promise(r => setTimeout(r, 500));
  }
  const w = studio();
  w.xfStudioShell.runtime.modules.set("expressions", true);
  w.document.querySelector('[aria-label="Hide Eye makeup"]')?.click();
  for (const action of [{ kind: "motion.setIdle", enabled: false }, { kind: "camera.restore", camera: { position: [0, 1.662, -0.62], target: [0, 1.658, -0.05], fov: 19 } }])
    await w.xfStudioShell.runtime.dispatch(action);
}
const ready = studioReady();
function sendToStudio(controls, force = false) {
  const now = performance.now();
  const changed = !state.sent || Object.keys({ ...controls, ...state.sent }).some(k => Math.abs((controls[k] ?? 0) - (state.sent[k] ?? 0)) > 0.01);
  if (!force && (!changed || state.sending || now - state.lastSend < 40)) return;
  state.sending = true; state.lastSend = now; state.sent = controls; state.sends++;
  // Prototype limitation: each send is one Undo step in the verification workspace (the feature would use one gesture transaction).
  Promise.resolve(studio().xfStudioShell.runtime.dispatch({ kind: "expression.startFrom", origin: { kind: "rest" }, controls }))
    .finally(() => { state.sending = false; });
}

// ---- One frame ----
function process(scores, time) {
  const t0 = performance.now();
  const smooth = filters.filter(scores, time);
  const corrected = neutralCorrect(smooth, state.neutral);
  const controls = mapBlendshapes(corrected, settings());
  state.map.push(performance.now() - t0); if (state.map.length > 120) state.map.shift();
  state.last = smooth; state.controls = controls;
  return controls;
}
function loop() {
  if (!state.running) return;
  const tick = (now, meta) => {
    if (!state.running) return;
    if (video.readyState >= 2) {
      const t0 = performance.now();
      const result = videoLandmarker.detectForVideo(video, now);
      state.detect.push(performance.now() - t0); if (state.detect.length > 120) state.detect.shift();
      state.frames++;
      const scores = scoresOf(result);
      if (Object.keys(scores).length) sendToStudio(process(scores, now)); else state.noFace++;
    }
    video.requestVideoFrameCallback ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
  };
  video.requestVideoFrameCallback ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
}
async function start(kind, url) {
  stop();
  videoLandmarker ??= await landmarker("VIDEO");
  await ready;
  if (kind === "camera") {
    try { state.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false }); }
    catch (error) { status(error?.name === "NotAllowedError" ? "The camera wasn't allowed. You can allow it from the camera icon in the address bar, then try again."
      : "No camera was found. Connect one, or use a test file."); return; }
    video.srcObject = state.stream; $("stage").classList.add("mirrored"); $("indicator").classList.add("on");
    $("camera").disabled = true; $("stop").disabled = false;
  } else { video.src = url; video.loop = true; $("stage").classList.remove("mirrored"); }
  await video.play();
  Object.assign(state, { running: true, source: kind, frames: 0, sends: 0, noFace: 0, started: performance.now() });
  filters.reset(); loop();
  status(kind === "camera" ? "Camera on. Make a face; press Capture to keep it." : "Playing the test file.");
}
function stop() {
  state.running = false;
  state.stream?.getTracks().forEach(t => t.stop()); state.stream = null;
  video.pause(); video.removeAttribute("src"); video.srcObject = null; video.load();
  $("indicator").classList.remove("on"); $("camera").disabled = false; $("stop").disabled = true;
}

// ---- Still images (evaluation) ----
async function analyseImage(url) {
  imageLandmarker ??= await landmarker("IMAGE");
  const img = new Image(); img.src = url; await img.decode();
  const t0 = performance.now(), result = imageLandmarker.detect(img), ms = performance.now() - t0;
  const scores = scoresOf(result);
  return { url, found: Object.keys(scores).length > 0, ms, scores, controls: mapBlendshapes(neutralCorrect(scores, state.neutral), settings()) };
}

// ---- Capture: the current numbers become a saved expression (no picture is kept) ----
async function capture(name) {
  const controls = { ...state.controls };
  if (!Object.keys(controls).length) { status("There's no expression to capture yet."); return null; }
  const response = await fetch("/api/verification/part-presets", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feature: "expressions", name: name || "Captured expression", part: { schema: "xfs/expression-part-1", body: { controls, links: {}, origin: { kind: "rest" } } } }) });
  const saved = await response.json();
  status(response.ok ? `Saved "${saved.name}" to your expressions.` : saved.error ?? "That couldn't be saved.");
  return saved;
}

// ---- Metrics ----
const pct = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
function metrics() {
  const secs = (performance.now() - state.started) / 1000, facial = studio()?.xfStudioPresentation?.facial.snapshot();
  return { source: state.source, delegate: state.delegate, frames: state.frames, noFace: state.noFace, fps: state.running ? state.frames / secs : 0,
    detectP50: pct(state.detect, .5), detectP95: pct(state.detect, .95), mapP50: pct(state.map, .5), sendsPerSecond: state.running ? state.sends / secs : 0,
    solve: facial?.latency ?? null, facialPhase: facial?.phase };
}
setInterval(() => {
  const m = metrics();
  $("metrics").textContent = `source ${m.source ?? "-"} (${m.delegate || "model not loaded"})\ndetect ${m.fps.toFixed(1)} fps, ${m.detectP50.toFixed(1)} ms p50, ${m.detectP95.toFixed(1)} ms p95\n` +
    `map ${m.mapP50.toFixed(2)} ms; sent ${m.sendsPerSecond.toFixed(1)} /s; no face ${m.noFace}\nsolve round trip ${m.solve ? `${m.solve.median.toFixed(1)} ms median, ${m.solve.max.toFixed(1)} max` : "-"}\n` +
    `estimated face-to-V: ${m.solve ? (m.detectP50 + m.mapP50 + m.solve.median + 16.7).toFixed(0) : "-"} ms + camera delay`;
  const top = Object.entries(state.last).sort((a, b) => b[1] - a[1]).slice(0, 14);
  $("bars").innerHTML = top.map(([k, v]) => `<span>${k}</span><span class="bar"><i style="width:${(v * 100).toFixed(0)}%"></i></span>`).join("");
}, 250);

// ---- Controls ----
$("camera").onclick = () => start("camera");
$("stop").onclick = () => { stop(); status("Camera off."); };
$("play").onclick = () => $("media").value && start("video", $("media").value);
$("neutral").onclick = () => { state.neutral = { ...state.last }; status("Neutral face set: your resting face now reads as V's rest."); };
$("clearNeutral").onclick = () => { state.neutral = null; status("Neutral face cleared."); };
$("capture").onclick = () => capture($("name").value.trim());
for (const [id, fmt] of [["gain", 2], ["upper", 2], ["smooth", 1]]) $(id).oninput = () => { $(`${id}v`).textContent = (+$(id).value).toFixed(fmt); if (id === "smooth") filters.set({ minCutoff: +$(id).value }); };
fetch("./media/").then(r => r.ok ? r.json() : []).then(list => { for (const name of list) $("media").add(new Option(name, `./media/${name}`)); }).catch(() => {});

// Automation hook for the headless evaluation (experiment 026 evaluate.ts).
window.faceCapture = { start, stop, analyseImage, capture, metrics, ready, setNeutral: scores => { state.neutral = scores; }, state, send: c => sendToStudio(c, true) };
if (params.get("autostart") === "camera") start("camera");

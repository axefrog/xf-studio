import type { createScene } from "./scene";
import type { PreviewState } from "./workspace-state";

type MotionViewer = Pick<Awaited<ReturnType<typeof createScene>>, "idle" | "evidence" | "setIdle" |
  "setIdlePaused" | "setIdleContributions" | "setBlink" | "animateBlink">;

/** Presentation adapter; playback/composition remain in the independent animation core. */
export function setupMotionControls(viewer: MotionViewer, preview: PreviewState) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const enabled = $<HTMLInputElement>("cc-idle"), body = $<HTMLInputElement>("idle-body"),
    face = $<HTMLInputElement>("idle-face"), pause = $<HTMLButtonElement>("idle-pause"),
    blink = $<HTMLInputElement>("blink"), play = $<HTMLButtonElement>("play");
  const available = viewer.evidence.idle.available;
  function blinkButton(playing: boolean) {
    play.setAttribute("aria-pressed", String(playing)); play.textContent = playing ? "Ⅱ Pause" : "▶ Blink";
  }
  function refresh() {
    enabled.disabled = body.disabled = face.disabled = !available;
    enabled.checked = viewer.idle?.enabled ?? false;
    body.checked = viewer.idle?.bodyEnabled ?? preview.idleBody;
    face.checked = viewer.idle?.faceEnabled ?? preview.idleFace;
    pause.disabled = !enabled.checked;
    pause.textContent = viewer.idle?.paused ? "Resume idle" : "Pause idle";
    blink.disabled = play.disabled = enabled.checked;
    $("idle-note").textContent = available
      ? enabled.checked
        ? `${viewer.idle?.paused ? "Pose paused" : "Idle playing"} · ${body.checked ? "head motion" : "head still"} · ${face.checked ? "facial motion" : "face still"}`
        : "Game close-up motion + facial animation · preview"
      : `Idle unavailable: ${viewer.evidence.idle.error}`;
  }
  enabled.onchange = () => {
    viewer.setIdle(enabled.checked); blink.value = "0"; blinkButton(false); refresh();
  };
  pause.onclick = () => { viewer.setIdlePaused(!viewer.idle?.paused); refresh(); };
  body.onchange = face.onchange = () => { viewer.setIdleContributions(body.checked, face.checked); refresh(); };
  blink.oninput = () => { viewer.setBlink(+blink.value); blinkButton(false); };
  play.onclick = () => {
    const playing = play.getAttribute("aria-pressed") !== "true";
    viewer.animateBlink(playing); blinkButton(playing);
  };
  // Restore composition before clock and camera. Pause never uses the reset path.
  viewer.setIdleContributions(preview.idleBody, preview.idleFace);
  viewer.setIdle(preview.idle && available);
  if (viewer.idle?.enabled) {
    viewer.idle.seek(preview.idleTime); viewer.setIdlePaused(preview.idlePaused);
    blink.value = "0"; blinkButton(false);
  } else {
    blink.value = String(preview.blink); viewer.setBlink(preview.blink);
    viewer.animateBlink(preview.blinkPlaying); blinkButton(preview.blinkPlaying);
  }
  refresh();
}

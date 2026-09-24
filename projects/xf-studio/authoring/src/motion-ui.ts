import type { MotionActions } from "./motion-actions";

/** DOM controls for the presentation-independent motion action service. */
export function setupMotionControls(actions: MotionActions) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const enabled = $<HTMLInputElement>("cc-idle"), body = $<HTMLInputElement>("idle-body"),
    face = $<HTMLInputElement>("idle-face"), pause = $<HTMLButtonElement>("idle-pause"),
    blink = $<HTMLInputElement>("blink"), play = $<HTMLButtonElement>("play");
  function refresh() {
    const state = actions.snapshot();
    enabled.disabled = body.disabled = face.disabled = !state.available;
    enabled.checked = state.idle;
    body.checked = state.idleBody;
    face.checked = state.idleFace;
    pause.disabled = !state.idle;
    pause.textContent = state.idlePaused ? "Resume idle" : "Pause idle";
    blink.disabled = play.disabled = state.idle;
    blink.value = String(state.blink);
    play.setAttribute("aria-pressed", String(state.blinkPlaying));
    play.textContent = state.blinkPlaying ? "Ⅱ Pause" : "▶ Blink";
    $("idle-note").textContent = state.available
      ? state.idle
        ? `${state.idlePaused ? "Pose paused" : "Idle playing"} · ${state.idleBody ? "head motion" : "head still"} · ${state.idleFace ? "facial motion" : "face still"}`
        : "Game close-up motion + facial animation · preview"
      : `Idle unavailable: ${state.error}`;
  }
  enabled.onchange = () => actions.dispatch({ kind: "motion.setIdle", enabled: enabled.checked });
  pause.onclick = () => actions.dispatch({ kind: "motion.setPaused", paused: !actions.snapshot().idlePaused });
  body.onchange = face.onchange = () => actions.dispatch({ kind: "motion.setContributions", body: body.checked, face: face.checked });
  blink.oninput = () => actions.dispatch({ kind: "motion.setBlink", value: +blink.value });
  play.onclick = () => actions.dispatch({ kind: "motion.playBlink", playing: !actions.snapshot().blinkPlaying });
  actions.subscribe(refresh);
  refresh();
}

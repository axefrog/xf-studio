import type { PreviewTextureSize } from "../../preview-quality";
import { applyCapability, badge, button, emptyState, note, section, Segmented, Slider, Toggle } from "../controls";
import { h, setText } from "../dom";
import { helpTip, setHelp } from "../help-tip";
import { comingSoon, liveFeatures } from "../coming-soon";
import { ChoiceList } from "../components/choice-list";
import { icon } from "../icons";
import type { Frame, StudioRuntime } from "../runtime";
import type { PanelController } from "./collection";
import { PANEL_META } from "../panel-meta";
import { readinessText } from "../readiness-text";
import type { ConeReading, IntensityForm, LightingPreset } from "../../creator-lighting";
import type { LightingStatus } from "../../preview-actions";
import type { MotionState } from "../../motion-actions";
import type { DetailLimit, DetailNotice } from "../../detail-limits";
import type { StudioLightKey, StudioSetupId } from "../../studio-lighting";

/** What the field-of-view slider does, in plain words (UI-85): its help tip. The line under it is kept for limits and loading. */
const FOV_HELP = "Changing the lens angle moves the camera, so your V's face stays the same size.";
const enableReason = (rt: StudioRuntime, action: Parameters<StudioRuntime["port"]["authoring"]["capability"]>[0]) => rt.port.authoring.capability(action);
type DetailStatus = NonNullable<Frame["status"]["assets"]["characterDetails"]>;
const SLOT_NAMES = { skin: "Skin", face: "Face details", brows: "Eyebrows", lashes: "Eyelashes", hair: "Hair", eyes: "Eyes", teeth: "Teeth", piercings: "Piercings", body: "Body", clothing: "Clothes" } as const;
/** What each renderer limit code means for the person using the app (detail-limits.ts). */
export const DETAIL_LIMIT_TEXT: Readonly<Record<DetailLimit, string>> = {
  "head-shape": "An installed mod changes your V's head shape. The preview shows it, but eye makeup is still placed on the original head shape.",
  "skin-glow": "Glowing skin details from your installed mods aren't shown yet.",
  "eye-design": "Your V's eye design couldn't be drawn, so the default eye is shown in its place.",
  "layered-material": "Some of your V's piercings or other layered parts couldn't be drawn, so they aren't shown.",
  "layered-mask": "Part of the pattern on your V's piercings or eye design couldn't be read, so those parts show their base colour only.",
  "layered-base": "The base finish of some of your V's piercings or layered parts couldn't be read, so a plain grey stands in for it.",
  "decal-template": "Some of your V's face details use materials the preview can't draw yet, so those parts aren't shown.",
  "rigid-part": "A piercing part stays in place while your V's head moves in the idle, because its shape carries no skinning.",
  "rigid-body-part": "Part of your V's body, such as the nails, moves as one piece with the hand in the idle, because its shape carries no skinning.",
  "part-unread": "Some parts of your V's details couldn't be prepared from your game files, so they aren't shown. Report a problem from Help to see which.",
};
/** Why none of the V's details are shown, when a code says so (detail-limits.ts). */
export const DETAIL_NOTICE_TEXT: Readonly<Record<DetailNotice, string>> = {
  "version-skew": "XF Studio was updated while it was running. Restart it to see your V's skin, face details, eyes, brows, lashes, hair, piercings and body.",
};

/**
 * One plain line about the shown V's details while they are on their way or couldn't be prepared; once they are ready the Character
 * panel shows them as a list instead (`characterDetailRows`), so the line is empty.
 */
export function characterDetailLine(details: DetailStatus | undefined): { done: boolean; text: string } {
  if (!details || details.phase === "idle") return { done: false, text: "" };
  const who = details.source === "save" ? "your V" : "the default V";
  if (details.phase === "preparing") return { done: false, text: `Preparing ${who}'s details from your game files…` };
  if (details.phase === "failed") return { done: true, text: details.notice ? DETAIL_NOTICE_TEXT[details.notice] : details.message };
  return { done: true, text: "" };
}
/** One row of the V's details (the Character panel's "In the 3D view" list): a part of V, what the 3D view shows, and why when it doesn't. */
export type CharacterDetailRow = { term: string; value: string; shown: boolean; note?: string };
/**
 * The shown V's details as rows, once they are ready (ui-copy-and-layout-review.md §3.10): each slot's label, "None" or "Not shown" with its
 * reason; the renderer's limits, each sentence once and only for slots it draws; and the status's own line when no row already says it.
 */
export function characterDetailRows(details: DetailStatus | undefined): { rows: CharacterDetailRow[]; limits: string[]; message: string } | null {
  if (!details || details.phase !== "ready") return null;
  const capital = (text: string) => text ? text[0]!.toUpperCase() + text.slice(1) : text;
  const rows = details.slots.map(slot => ({ term: SLOT_NAMES[slot.slot], shown: slot.state === "shown",
    value: slot.state === "shown" ? capital(slot.label) : slot.state === "none" ? "None" : "Not shown", ...(slot.message ? { note: slot.message } : {}) }));
  const limits = [...new Set(details.slots.flatMap(slot => slot.state === "shown" ? slot.limits ?? [] : []))].map(limit => DETAIL_LIMIT_TEXT[limit]);
  return { rows, limits, message: details.message && !rows.some(row => row.note === details.message) ? details.message : "" };
}

/** One plain line about the lighting preset and where its colour grade came from. */
export function lightingPresetLine(preset: LightingPreset | undefined, status: LightingStatus | null | undefined): string {
  // Studio lighting needs no line (its segment's tooltip says what it is); creator lighting states where its colour grade came from.
  if (preset !== "creator") return "";
  const lut = status?.lut;
  return !lut || lut.phase !== "ready" ? "Loading the game's colour grade…" : lut.source?.note ?? "";
}
/** What the two lighting presets are (the Light heading's help tip). */
const LIGHT_HELP = ["Studio: soft authoring light you can adjust. Character creator: the game's creator lights for your V's body, on black, with fixed exposure.",
  "The lights the game flags for shadows cast them onto your V; the creator's light strengths are still being calibrated."];

export function lightingPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  // Every camera and light change goes through the validated dispatch, and a refusal is said (UI-15); the feedback shows a repeated
  // refusal once while it is on screen, so a slider drag can't flood it.
  const edit = (action: Parameters<typeof port.authoring.dispatch>[0]) => {
    const result = port.authoring.dispatch(action);
    rt.report(action.kind, result);
    return result;
  };
  // A released slider (or the end of a keyboard burst) ends its View and lighting step: the next drag is a step of its own (CORE-95).
  const endEdit = () => { port.authoring.dispatch({ kind: "view.endEdit" }); };
  const preset = new Segmented<LightingPreset>({ label: "Lighting", options: [
    { value: "studio", label: "Studio", title: "The Studio's soft authoring light" },
    { value: "creator", label: "Character creator", title: "The game's creator and mirror lighting, for comparing with the game" }],
  onSelect: value => rt.dispatch({ kind: "preview.setLightingPreset", preset: value }) });
  const presetNote = note("");
  const live = liveFeatures(port);
  const creatorFace = button({ label: "Creator face", icon: "front", small: true, title: "The creator's face-page camera: 15° lens, 1.2 m",
    onClick: () => rt.dispatch({ kind: "camera.creatorFraming", page: "face" }) });
  const creatorHair = button({ label: "Creator hair", icon: "front", small: true, title: "The creator's hair-page camera: 15° lens, 2 m",
    onClick: () => rt.dispatch({ kind: "camera.creatorFraming", page: "hair" }) });
  const intensity = new Segmented<IntensityForm>({ label: "Light intensity from lumens", options: [
    { value: "isotropic", label: "Φ ÷ 4π" }, { value: "cone", label: "Spread over cone" }],
  onSelect: value => rt.dispatch({ kind: "preview.setCreatorLighting", key: "intensity", value }) });
  const cone = new Segmented<ConeReading>({ label: "Stored cone angles are", options: [
    { value: "full", label: "Full angles" }, { value: "half", label: "Half angles" }],
  onSelect: value => rt.dispatch({ kind: "preview.setCreatorLighting", key: "cone", value }) });
  const log = (value: number) => Math.log10(value), exposureRange = rt.range("preview.setCreatorLighting", "value", "exposure");
  const creatorExposure = new Slider({ label: "Creator exposure (k)", min: log(exposureRange.min), max: log(exposureRange.max), step: .01,
    format: value => (10 ** value).toPrecision(3),
    transaction: { edit: value => { edit({ kind: "preview.setCreatorLighting", key: "exposure", value: Number((10 ** value).toPrecision(4)) }); },
      commit: endEdit, cancel: endEdit } });
  const creatorShadows = new Toggle({ label: "Shadows from the flagged lights",
    help: "The lights the game flags for shadows cast them onto the V: the key light's nose shadow, and no rim light through the head.",
    onChange: enabled => rt.dispatch({ kind: "preview.setCreatorShadows", enabled }) });
  const resetCalibration = button({ label: "Restore defaults", icon: "reset", small: true, variant: "quiet",
    title: "Put the intensity reading, cone angles, creator exposure and shadows back to their defaults",
    onClick: () => rt.dispatch({ kind: "preview.resetCreatorLighting" }) });
  // A research tool (UI-85): shown only with View preferences › Show research tools.
  const diagnostics = h("details", { class: "section" }, h("summary", { text: "Research: creator lighting calibration" }),
    h("div", { class: "control-line" }, h("span", { class: "muted small", text: "Calibration" }),
      helpTip("the calibration", "For matching a creator or mirror screenshot. The capture decides these; leave them at their defaults otherwise.")),
    intensity.element, cone.element, creatorExposure.element, creatorShadows.element, h("div", { class: "row" }, resetCalibration));
  // A framing limit is said once, as a notice (no line is reserved under the slider for something this rare; the feedback shows a
  // repeated notice once while it is on screen, so a drag at the limit doesn't flood it).
  const fovLine = (text: string) => { if (text) rt.feedback.toast("info", "Camera", text); };
  const fov = new Slider({ label: "Field of view (vertical)", ...rt.range("camera.setFov", "degrees"), step: 1, format: value => `${Math.round(value)}°`, help: FOV_HELP,
    transaction: {
      edit: value => {
        const result = edit({ kind: "camera.setFov", degrees: value });
        const limited = result.ok && (result.result as { limited?: boolean } | undefined)?.limited;
        fovLine(limited ? "The camera is at its limit. Pan, or use Front view to bring your V back." : "");
      },
      commit: () => { edit({ kind: "camera.endFovGesture" }); },
      cancel: () => { edit({ kind: "camera.endFovGesture" }); },
    } });
  const front = button({ label: "Front view", icon: "front", small: true, onClick: () => {
    const result = edit({ kind: "camera.front" });
    const limited = result.ok && (result.result as { limited?: boolean } | undefined)?.limited;
    if (limited) fovLine("Too narrow for the whole front view. Widen the panel or raise the field of view.");
  } });
  const bodyView = button({ label: "Whole body", icon: "body", small: true, title: "Frame your V's whole body", onClick: () => {
    const result = edit({ kind: "camera.body" });
    const limited = result.ok && (result.result as { limited?: boolean } | undefined)?.limited;
    if (limited) fovLine("Too narrow for the whole body. Widen the panel or raise the field of view.");
  } });
  // Studio stage: named setups, then each control on its own (studio-lighting.ts). Exposure is in stops, on a log scale.
  // The setups arrive with the preview's read model (StudioApplication.previewState().studioSetups).
  let setupButtons: { id: StudioSetupId; button: HTMLButtonElement }[] = [];
  const setupRow = h("div", { class: "chip-row", role: "group", "aria-label": "Studio lighting setup" });
  // The pressed chip is the setup in use (none pressed once a light is adjusted); no readout repeats it.
  const setups = h("div", { class: "control" }, h("span", { class: "control-label" }, h("span", { text: "Setup" })), setupRow);
  const studioExposureRange = rt.range("preview.setExposure", "value"), stops = (value: number) => Math.log2(value);
  const exposure = new Slider({ label: "Exposure", min: stops(studioExposureRange.min), max: stops(studioExposureRange.max), step: .05,
    format: value => `${value < -.005 ? "−" : "+"}${Math.abs(value).toFixed(1)} EV`,
    transaction: { edit: value => { edit({ kind: "preview.setExposure", value: Number((2 ** value).toPrecision(4)) }); }, commit: endEdit, cancel: endEdit } });
  const angle = new Slider({ label: "Key light direction", ...rt.range("preview.setKeyAngle", "degrees"), step: 1,
    format: value => { const degrees = Math.round(value) % 360; return `${Math.round(value)}° ${degrees === 0 ? "front" : degrees === 180 ? "behind"
      : degrees < 180 ? "from V's right" : "from V's left"}`; },
    transaction: { edit: degrees => { edit({ kind: "preview.setKeyAngle", degrees }); }, commit: endEdit, cancel: endEdit } });
  const studioSlider = (key: StudioLightKey, label: string, format: (value: number) => string, step: number, help?: string) => new Slider({ label, help,
    ...rt.range("preview.setStudioLight", "value", key), step, format,
    transaction: { edit: value => { edit({ kind: "preview.setStudioLight", key, value }); }, commit: endEdit, cancel: endEdit } });
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  const elevation = studioSlider("elevation", "Key light height", value => `${Math.round(value)}°`, 1);
  const keyStrength = studioSlider("key", "Key light strength", percent, .05);
  const environmentStrength = studioSlider("environment", "Room light", percent, .05, "Ambient light and reflections from the room.");
  const fillStrength = studioSlider("fill", "Fill light strength", percent, .05);
  const rimStrength = studioSlider("rim", "Rim light strength", percent, .05);
  const neutral = new Toggle({ label: "Untinted lights", help: "Grey lights of the same brightness instead of the warm key and cool fill, for judging colour.",
    onChange: enabled => rt.dispatch({ kind: "preview.setStudioNeutral", enabled }) });
  const resetStudio = button({ label: "Restore defaults", icon: "reset", small: true, variant: "quiet",
    title: "Put every studio light and the exposure back to Soft studio",
    onClick: () => rt.dispatch({ kind: "preview.resetStudioLighting" }) });
  const studioControls = h("div", { class: "section" }, setups, exposure.element, angle.element, elevation.element, keyStrength.element,
    environmentStrength.element, fillStrength.element, rimStrength.element, neutral.element, h("div", { class: "row" }, resetStudio));
  const normals = new Toggle({ label: "Preview normal map", onChange: enabled => rt.dispatch({ kind: "preview.setNormals", enabled }) });
  // The view's tool toggles (view-graph-design.md §3.9): the shown modules' tools, derived like the toolbar, one Toggle each.
  const toolToggles = h("div", { class: "view-tool-toggles" });
  const toggles = new Map<string, Toggle>();
  const optics = new Toggle({ label: "Eye's own roughness", onChange: enabled => rt.dispatch({ kind: "preview.setEyeOptics", enabled }) });
  const opticsNote = note("");
  // Skin scattering quality (shader-skin.md §11, "a viewing preference beside the lighting presets"): Coming soon until it lands.
  const scatterEntry = comingSoon("lightingSubsurface", live);
  const scatter = scatterEntry ? new Segmented<string>({ label: scatterEntry.label, showLabel: false, onSelect: () => {},
    options: [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }] }) : undefined;
  scatter?.update(undefined, () => ({ available: false, reason: scatterEntry!.reason }));
  const scatterControl = scatterEntry && scatter ? h("div", { class: "control" }, h("div", { class: "control-line" },
    h("span", { class: "control-label", text: scatterEntry.label }), helpTip(scatterEntry.label, scatterEntry.reason)), scatter.element) : null;
  const element = h("div", { class: "panel-content" },
    section({ title: "Camera", help: ["Camera and light are saved with your workspace; they never change your looks or your mod.",
      "Ctrl+Z in this panel undoes view and lighting changes, which have their own history."] }, fov.element, h("div", { class: "row wrap gap-s" }, front, bodyView, creatorFace, creatorHair)),
    section({ title: "Light", help: LIGHT_HELP }, preset.element, presetNote, studioControls),
    diagnostics,
    section("Display", toolToggles, normals.element, scatterControl, h("div", { class: "research-only" }, optics.element, opticsNote)));
  return {
    spec: { id: "lighting", ...PANEL_META["lighting"], element },
    update(frame) {
      const preview = frame.preview.preview, ready = !!preview, assets = frame.status.assets;
      const loading = { disabled: !ready, reason: (frame.viewport.head.error ?? frame.viewport.head.message) ?? "Preview is still loading." };
      fov.update(preview?.camera.fov, loading);
      const studioOnly = (action: Parameters<typeof port.authoring.capability>[0]) => {
        const allowed = port.authoring.capability(action);
        return ready ? { disabled: !allowed.available, reason: allowed.reason } : loading;
      };
      // The studio controls belong to the studio stage: while the creator rig shows, only the switch back is offered.
      studioControls.hidden = preview?.lightingPreset === "creator";
      exposure.update(preview ? Math.log2(preview.exposure) : undefined, studioOnly({ kind: "preview.setExposure", value: preview?.exposure ?? 1.2 }));
      angle.update(preview?.lightAngle, studioOnly({ kind: "preview.setKeyAngle", degrees: preview?.lightAngle ?? 0 }));
      const lights = preview?.studioLights;
      for (const [slider, key] of [[elevation, "elevation"], [keyStrength, "key"], [environmentStrength, "environment"], [fillStrength, "fill"],
        [rimStrength, "rim"]] as const) slider.update(lights?.[key], studioOnly({ kind: "preview.setStudioLight", key, value: lights?.[key] ?? 0 }));
      neutral.update(!!lights?.neutral, studioOnly({ kind: "preview.setStudioNeutral", enabled: !lights?.neutral }));
      const offered = frame.preview.studioSetups, matched = offered?.active ?? null;
      const setupKey = JSON.stringify(offered?.setups ?? []);
      if (setupRow.dataset.key !== setupKey) {
        setupRow.dataset.key = setupKey;
        setupButtons = (offered?.setups ?? []).map(entry => ({ id: entry.id, button: h("button", { class: "chip-button", type: "button",
          "aria-pressed": "false", title: entry.title, "data-title": entry.title,
          onclick: () => rt.dispatch({ kind: "preview.applyStudioSetup", setup: entry.id }) }, h("span", { text: entry.label })) }));
        setupRow.replaceChildren(...setupButtons.map(item => item.button));
      }
      for (const { id, button: control } of setupButtons) {
        control.setAttribute("aria-pressed", String(id === matched));
        applyCapability(control, ready ? port.authoring.capability({ kind: "preview.applyStudioSetup", setup: id }) : { available: false, reason: loading.reason });
      }
      applyCapability(resetStudio, ready ? port.authoring.capability({ kind: "preview.resetStudioLighting" }) : { available: false, reason: loading.reason });
      preset.update(preview?.lightingPreset, value => ready ? port.authoring.capability({ kind: "preview.setLightingPreset", preset: value }) : { available: false, reason: loading.reason });
      setText(presetNote, lightingPresetLine(preview?.lightingPreset, frame.preview.lighting));
      presetNote.hidden = !presetNote.textContent;
      applyCapability(creatorFace, port.authoring.capability({ kind: "camera.creatorFraming", page: "face" }));
      applyCapability(creatorHair, port.authoring.capability({ kind: "camera.creatorFraming", page: "hair" }));
      const creator = preview?.creatorLighting;
      intensity.update(creator?.intensity, value => port.authoring.capability({ kind: "preview.setCreatorLighting", key: "intensity", value }));
      cone.update(creator?.cone, value => port.authoring.capability({ kind: "preview.setCreatorLighting", key: "cone", value }));
      creatorExposure.update(creator ? log(creator.exposure) : undefined, { ...studioOnly({ kind: "preview.setCreatorLighting", key: "exposure", value: creator?.exposure ?? 1 }),
        note: preview?.lightingPreset === "creator" ? "Scene light × k before the game's colour grade. Fitted to a capture's forehead." : "Applies while Character creator lighting is on." });
      creatorShadows.update(creator?.shadows ?? true, studioOnly({ kind: "preview.setCreatorShadows", enabled: !(creator?.shadows ?? true) }));
      applyCapability(resetCalibration, ready ? port.authoring.capability({ kind: "preview.resetCreatorLighting" }) : { available: false, reason: loading.reason });
      // The panel's loading reason is said once, in the line that is always there (UI-90).
      // Research tools (UI-85): the calibration and the display studies show only when asked for.
      const research = !!frame.preferences?.researchTools;
      diagnostics.hidden = !research;
      for (const node of element.querySelectorAll<HTMLElement>(".research-only")) node.hidden = !research;
      applyCapability(front, port.authoring.capability({ kind: "camera.front" }));
      applyCapability(bodyView, port.authoring.capability({ kind: "camera.body" }));
      normals.update(!!preview?.normals, loading);
      const tools = frame.viewTools.filter(tool => tool.kind === "toggle" && tool.state === "tools");
      for (const tool of tools) if (!toggles.has(tool.id)) toggles.set(tool.id, new Toggle({ label: tool.label,
        onChange: enabled => { rt.report("view.setTool", rt.port.views.setTool(undefined, tool.id, enabled)); } }));
      const wanted = tools.map(tool => toggles.get(tool.id)!.element);
      if (wanted.length !== toolToggles.children.length || wanted.some((node, index) => toolToggles.children[index] !== node)) toolToggles.replaceChildren(...wanted);
      for (const tool of tools) toggles.get(tool.id)!.update(!!tool.on, ready ? { disabled: !tool.capability.available, reason: tool.capability.reason } : loading);
      optics.update(preview?.eyeOwnRoughness ?? true, loading);
      const eye = assets.eyeOptics;
      setText(opticsNote, !eye ? "Uses the shown eye's own roughness from your game files instead of the preview's even gloss." : eye.active
        ? "The eye's own roughness from your game files: a glassy eye with a crisp catch light, lit the way the game lights eyes."
        : !eye.requested ? "Off: the eyes use the preview's earlier even gloss, for comparison."
          : "The eye shown has no roughness the preview can read, so it keeps the even gloss.");
    },
  };
}

export function motionPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  // The body source: Still (the bind pose), one of the game's own preview idles (the creator's close-up and full body, the inventory…), or
  // the photo-mode pose chosen in Poses (its own chosen choice while one is held; choosing another source leaves it).
  const STILL = "still", POSE = "pose";
  // One choice per source (the list can change), all shown, in the Character panel's choice look (ChoiceList). The chosen one moves at
  // once (the chosen idle is optimistic while its clip loads); the loading line keeps its place under them.
  const source = new ChoiceList<string>({ label: "Body", reserveNote: true, quietReason: true, options: [{ value: STILL, label: "Still" }], onSelect: value => {
    if (value === POSE) return;
    if (value === STILL) { rt.dispatch({ kind: "motion.setIdle", enabled: false }); return; }
    rt.dispatch({ kind: "motion.setIdleClip", clip: value });
    if (!port.authoring.previewState().motion?.idle) rt.dispatch({ kind: "motion.setIdle", enabled: true });
  } });
  const pause = button({ label: "Pause idle", icon: "pause", small: true, onClick: () => {
    const motion = port.authoring.previewState().motion; rt.dispatch({ kind: "motion.setPaused", paused: !motion?.idlePaused });
  } });
  const setContributions = (body?: boolean, face?: boolean) => {
    const motion = port.authoring.previewState().motion; if (!motion) return;
    rt.dispatch({ kind: "motion.setContributions", body: body ?? motion.idleBody, face: face ?? motion.idleFace });
  };
  const head = new Toggle({ label: "Body movement", onChange: value => setContributions(value, undefined) });
  const face = new Toggle({ label: "Facial movement", onChange: value => setContributions(undefined, value),
    help: "Turn off either to hold that part still. The idle keeps time, so it carries on smoothly when you turn it back on." });
  // The blink's reasons (the idle blinks on its own, still loading) are information, so they keep the muted tone.
  const blink = new Slider({ label: "Closure", ...rt.range("motion.setBlink", "value"), step: .01, reserveNote: true, quietReason: true,
    format: value => value < .01 ? "Open" : value > .99 ? "Closed" : `${Math.round(value * 100)}%`,
    transaction: { edit: value => { const action = { kind: "motion.setBlink" as const, value }; rt.report(action.kind, port.authoring.dispatch(action)); } } });
  const play = button({ label: "Play blink", icon: "play", small: true, onClick: () => {
    const motion = port.authoring.previewState().motion; rt.dispatch({ kind: "motion.playBlink", playing: !motion?.blinkPlaying });
  } });
  // Where the blink hasn't been prepared, its controls give way to one plain line (UI-86): preparing it needs developer tools, so the
  // person is never sent to a developer guide.
  const blinkNote = h("p", { class: "note muted" });
  const blinkControls = h("div", {}, blink.element, h("div", { class: "row" }, play));
  // Hair physics: the scene's dangle simulation, one setting per scene (hair-physics-plan.md §3.6); off until it is calibrated in game.
  const physics = new Toggle({ label: "Hair physics", reserveNote: true, quietReason: true, onChange: value => rt.dispatch({ kind: "motion.setPhysics", enabled: value }),
    help: "Hair that has physics in the game swings and hangs with gravity here too, worked out from the hairstyle's own files." });
  const idleSection = section({ title: "Game idle", help: IDLE_HELP }, source.element, h("div", { class: "row" }, pause), head.element, face.element);
  const blinkSection = section({ title: "Blink", help: blinkHelp(undefined) }, blinkControls, blinkNote);
  const blinkTip = blinkSection.querySelector<HTMLElement>(".help-tip")!;
  const element = h("div", { class: "panel-content" }, idleSection, section("Hair", physics.element), blinkSection);
  return {
    spec: { id: "motion", ...PANEL_META["motion"], element },
    update(frame) {
      const motion = frame.preview.motion;
      const unavailable = { disabled: !motion?.available, reason: (frame.viewport.head.error ?? frame.viewport.head.message) ??
        motion?.error ?? "Your V's motion appears once the 3D preview is ready." };
      const idles = motion?.idles.length ? motion.idles : [{ id: "closeup", label: "Creator close-up" }];
      // The Body buttons' reserved line says the one thing that matters now: loading, or why motion is off.
      source.setOptions([{ value: STILL, label: "Still", title: "V stands in her bind pose." },
        ...idles.map(entry => ({ value: entry.id, label: entry.label, title: idleTitle("screen" in entry ? entry.screen : "creator") })),
        ...(motion?.pose ? [{ value: POSE, label: `Pose: ${motion.pose.label}`, title: "The photo-mode pose chosen in Poses. Choose Still or an idle to leave it." }] : [])]);
      source.update(motion?.pose ? POSE : motion?.idle ? motion.idleClip : STILL, undefined, unavailable.disabled ? { disabled: true, reason: unavailable.reason }
        : { note: motion?.idleLoading ? "Loading that idle; the previous one plays until it's ready."
          : motion?.pose && motion.poseLoading ? `Loading ${motion.pose.label}; V keeps her current pose until it's ready.` : "" });
      head.update(motion?.idleBody ?? true, unavailable); face.update(motion?.idleFace ?? true, unavailable);
      applyCapability(pause, port.authoring.capability({ kind: "motion.setPaused", paused: !motion?.idlePaused }));
      setText(pause.querySelector("span")!, motion?.idlePaused ? "Resume idle" : "Pause idle");
      pause.replaceChild(icon(motion?.idlePaused ? "play" : "pause"), pause.querySelector("svg")!);
      const blinkAllowed = port.authoring.capability({ kind: "motion.setBlink", value: 0 });
      // Before motion is ready its reason is said once, on the Body line; Blink and Hair physics carry it only as their description.
      const saidOnce = !motion?.available;
      blink.update(motion?.blink, { disabled: !blinkAllowed.available, reason: blinkAllowed.reason, reasonOnLine: !saidOnce });
      applyCapability(play, port.authoring.capability({ kind: "motion.playBlink", playing: !motion?.blinkPlaying }));
      setText(play.querySelector("span")!, motion?.blinkPlaying ? "Stop blink" : "Play blink");
      blinkControls.hidden = !!motion && !motion.blinkAvailable;
      setText(blinkNote, blinkNoteLine(motion));
      blinkNote.hidden = !blinkNote.textContent;
      setHelp(blinkTip, blinkHelp(motion));
      const physicsAllowed = port.authoring.capability({ kind: "motion.setPhysics", enabled: !motion?.physics });
      physics.update(motion?.physics ?? false, { disabled: !physicsAllowed.available, reason: physicsAllowed.reason, note: physicsNoteLine(motion), reasonOnLine: !saidOnce });
    },
  };
}

/** The hair physics note: what it does now (a held pose settles; the idle swings it). */
export function physicsNoteLine(motion: Pick<MotionState, "physics" | "physicsAvailable" | "idle" | "idlePaused"> | undefined): string | undefined {
  if (!motion?.physics || !motion.physicsAvailable) return undefined;
  return motion.idle && !motion.idlePaused ? "The hair swings as your V moves." : "The hair hangs as it would at rest in this pose.";
}

/** A body-source button's tooltip: where the game plays that idle. */
const idleTitle = (screen: string) => `The idle the game plays on V in its ${screen === "creator" ? "character creator" : screen === "inventory" ? "inventory" : "gender selection"}.`;

/** What the game idles are (the Game idle heading's help tip). */
const IDLE_HELP = ["Idles the game plays on V in its character creator and inventory, made from your game files.",
  "Their timing may differ slightly from the game's."];
/** What the blink is and how its controls work (the Blink heading's help tip). */
export function blinkHelp(motion: Pick<MotionState, "blinkRepeatSeconds"> | undefined): string[] {
  const every = motion ? `, every ${Number(motion.blinkRepeatSeconds.toFixed(2))} s` : "";
  return ["The game's own blink, made from your game files: lids, lashes, brows and makeup move together.",
    `Closure scrubs the closing half. Play blink plays it at the game's speed${every}.`];
}
/** The Motion panel's blink line: why the blink isn't available, or nothing (what it is lives in the heading's help tip). */
export function blinkNoteLine(motion: Pick<MotionState, "blinkAvailable" | "blinkError"> | undefined): string {
  // Not prepared: one plain line and nothing to do (UI-86). A damaged or mismatched one says so (it was prepared, and can be again).
  return motion && !motion.blinkAvailable ? motion.blinkError ?? "" : "";
}

export function qualityPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const sizes: PreviewTextureSize[] = [512, 1024, 2048, 4096];
  const tiers = new Segmented<PreviewTextureSize>({ label: "Texture size", options: sizes.map(size => ({ value: size, label: size === 512 ? "512" : `${size / 1024}K` })),
    onSelect: size => rt.dispatch({ kind: "quality.set", size }) });
  const stateLine = h("div", { class: "quality-state" });
  const rebuild = button({ label: "Rebuild preview", icon: "refresh", small: true, onClick: () => rt.dispatch({ kind: "quality.rebuild" }) });
  const element = h("div", { class: "panel-content" },
    section({ title: "Makeup preview textures", help: ["The size of the makeup textures in the 3D view. The head and eyes keep their own detail.",
      "Saved on this computer; your looks and your mod are unchanged."] }, tiers.element, stateLine, h("div", { class: "row" }, rebuild)));
  return {
    spec: { id: "quality", ...PANEL_META["quality"], element },
    update(frame) {
      const quality = frame.preview.quality, readiness = frame.readiness;
      tiers.update(quality?.size, size => port.authoring.capability({ kind: "quality.set", size }));
      const key = JSON.stringify([readiness, frame.viewport.head.phase]);
      if (stateLine.dataset.key !== key) {
        stateLine.dataset.key = key;
        // The same wording as the status bar and the head's badge (UI-92).
        const text = readinessText(frame);
        stateLine.replaceChildren(badge(text.label, readiness.phase === "ready" ? "success" : readiness.phase === "updating" ? "info" : "error"),
          h("span", { class: "small", text: text.detail }),
          h("span", { class: "muted small", text: `About ${Math.ceil(readiness.estimatedBytes / 1048576)} MiB of memory at this size.` }));
      }
      applyCapability(rebuild, port.authoring.capability({ kind: "quality.rebuild" }));
    },
  };
}

export function activityPanel(rt: StudioRuntime): PanelController {
  const list = h("ol", { class: "activity", "aria-label": "Recent activity, newest first" });
  const empty = emptyState("Nothing yet", "Saves, checks, imports, exports and errors appear here for this session.");
  // What the log keeps, in a help tip on its heading (help-tip.ts).
  const head = h("div", { class: "list-head" }, h("span", { class: "control-line" }, h("span", { class: "eyebrow", text: "This session" }),
    helpTip("the activity log", "This log is cleared when XF Studio closes. Your saved versions and built mods are kept elsewhere.")));
  let count = -1;
  const element = h("div", { class: "panel-content" }, head, empty, list);
  const draw = () => {
    const log = rt.feedback.log;
    const newest = log.at(-1)?.id ?? 0;
    if (newest === count) return;
    count = newest;
    empty.hidden = log.length > 0;
    list.replaceChildren(...[...log].reverse().slice(0, 80).map(entry => h("li", { class: `activity-item ${entry.tone}` },
      h("time", { datetime: entry.time.toISOString(), text: entry.time.toLocaleTimeString() }), h("strong", { text: entry.source }), h("span", { text: entry.message }))));
  };
  rt.feedback.subscribe(draw);
  return {
    spec: { id: "activity", ...PANEL_META["activity"], element },
    update(_frame: Frame) { draw(); },
  };
}

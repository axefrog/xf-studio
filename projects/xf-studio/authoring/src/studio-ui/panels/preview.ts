import type { PreviewTextureSize } from "../../preview-quality";
import { applyCapability, badge, button, emptyState, note, section, Segmented, SelectField, Slider, Toggle } from "../controls";
import { h, setText } from "../dom";
import { icon } from "../icons";
import type { Frame, StudioRuntime } from "../runtime";
import type { PanelController } from "./collection";
import { PANEL_META } from "../panel-meta";
import type { ConeReading, IntensityForm, LightingPreset } from "../../creator-lighting";
import type { LightingStatus } from "../../preview-actions";
import type { DetailLimit, DetailNotice } from "../../detail-limits";
import type { StudioLightKey, StudioSetupId } from "../../studio-lighting";

const enableReason = (rt: StudioRuntime, action: Parameters<StudioRuntime["port"]["authoring"]["capability"]>[0]) => rt.port.authoring.capability(action);
type DetailStatus = NonNullable<Frame["status"]["assets"]["characterDetails"]>;
const SLOT_NAMES = { skin: "Skin", face: "Face details", brows: "Eyebrows", lashes: "Eyelashes", hair: "Hair", eyes: "Eyes", piercings: "Piercings" } as const;
/** What each renderer limit code means for the person using the app (detail-limits.ts). */
export const DETAIL_LIMIT_TEXT: Readonly<Record<DetailLimit, string>> = {
  "head-shape": "An installed mod changes your V's head shape. The preview shows it, but eye makeup is still placed on the original head shape.",
  "skin-glow": "Glowing skin details from your installed mods aren't shown yet.",
  "eye-design": "Your V's eye design couldn't be drawn, so the default eye is shown in its place.",
  "layered-material": "Some of your V's piercings or other layered parts couldn't be drawn, so they aren't shown.",
  "layered-mask": "Part of the pattern on your V's piercings or eye design couldn't be read, so those parts show their base colour only.",
  "decal-template": "Some of your V's face details use materials the preview can't draw yet, so those parts aren't shown.",
  "rigid-part": "A piercing part stays in place while your V's head moves in the idle, because its shape carries no skinning.",
};
/** Why none of the V's details are shown, when a code says so (detail-limits.ts). */
export const DETAIL_NOTICE_TEXT: Readonly<Record<DetailNotice, string>> = {
  "version-skew": "XF Studio was updated while it was running. Restart it to see your V's skin, face details, eyes, brows, lashes, hair and piercings.",
};

/** One plain line about the shown V's skin, face details, eyes, brows, lashes, hair and piercings, from the resolved-detail status. */
export function characterDetailLine(details: DetailStatus | undefined): { done: boolean; text: string } {
  if (!details || details.phase === "idle") return { done: false, text: "" };
  const who = details.source === "save" ? "your V" : "the default V";
  if (details.phase === "preparing") return { done: false, text: `Preparing ${who}'s skin, face details, eyes, brows, lashes, hair and piercings from your game files…` };
  if (details.phase === "failed") return { done: true, text: details.notice ? DETAIL_NOTICE_TEXT[details.notice] : details.message };
  const parts = details.slots.map(slot => `${SLOT_NAMES[slot.slot]}: ${slot.state === "shown" ? slot.label : slot.state === "none" ? "none" : "not shown"}`);
  const limits = [...new Set(details.slots.flatMap(slot => slot.state === "shown" ? slot.limits ?? [] : []))].map(limit => DETAIL_LIMIT_TEXT[limit]);
  return { done: true, text: [`${parts.join(" · ")}.`, details.message, ...limits, "Shading and lighting are approximate."].filter(Boolean).join(" ") };
}

export function characterPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const load = button({ label: "Load V from a save…", icon: "import", onClick: () => void rt.file({ kind: "savedV.import" }) });
  const exportV = button({ label: "Export appearance data", icon: "export", small: true, variant: "quiet", onClick: () => void rt.file({ kind: "savedV.export" }) });
  const summary = h("div", { class: "fact-list" });
  const eyeShape = new SelectField<string>({ label: "Eye shape", onChange: value => rt.dispatch({ kind: "preview.setEyeShape", index: Number(value) }) });
  const eyeNote = note("");
  const brows = new Toggle({ label: "Eyebrows", onChange: enabled => rt.dispatch({ kind: "preview.setDetail", detail: "brows", enabled }) });
  const lashes = new Toggle({ label: "Eyelashes", onChange: enabled => rt.dispatch({ kind: "preview.setDetail", detail: "lashes", enabled }) });
  const hair = new Toggle({ label: "Hair", onChange: enabled => rt.dispatch({ kind: "preview.setHair", enabled }) });
  const piercings = new Toggle({ label: "Piercings", onChange: enabled => rt.dispatch({ kind: "preview.setPiercings", enabled }) });
  const piercingChoices = () => port.authoring.previewState().character?.choices.find(entry => entry.slot === "piercings")?.options ?? [];
  const style = new SelectField<string>({ label: "Try a piercing style", onChange: value => {
    const entry = piercingChoices().find(option => option.choice === value);
    rt.dispatch({ kind: "character.tryChoice", slot: "piercings", choice: entry?.choice ?? "", definition: entry?.definitions[0]?.name ?? "" });
  } });
  const colour = new SelectField<string>({ label: "Piercing colour", onChange: value => {
    const tried = port.authoring.previewState().character?.tried;
    rt.dispatch({ kind: "character.tryChoice", slot: "piercings", choice: tried?.choice ?? "", definition: value });
  } });
  const detailNote = note("");
  const element = h("div", { class: "panel-content" },
    section("Saved V", note("A save is read locally for your V's face, skin, eyes, brows, lashes, hair and piercings. It is never modified or uploaded."),
      h("div", { class: "row wrap gap-s" }, load, exportV), summary),
    section("Eyes", eyeShape.element, eyeNote),
    section("Preview context", brows.element, lashes.element, hair.element, piercings.element, style.element, colour.element, detailNote,
      note("These details are preview context only — not authoring tools. A piercing style you try changes this viewport, never the imported V or your makeup.")));
  return {
    spec: { id: "character", ...PANEL_META["character"], element },
    update(frame) {
      const state = frame.preview, preview = state.preview, saved = state.savedV, assets = frame.status.assets;
      applyCapability(load, port.files.capability({ kind: "savedV.import" }));
      applyCapability(exportV, port.files.capability({ kind: "savedV.export" }));
      const detailLine = characterDetailLine(assets.characterDetails);
      const key = JSON.stringify([saved, (frame.viewport.head.error ?? frame.viewport.head.message), detailLine]);
      if (summary.dataset.key !== key) {
        summary.dataset.key = key;
        const result = saved.result;
        summary.replaceChildren(...(!saved.loaded || !result ? [emptyState("Reference head", (frame.viewport.head.error ?? frame.viewport.head.message) ??
          "Load a save to preview your V's facial shape. Makeup authoring works without it.")] : [
          fact(icon("check"), `${result.applied.length} facial regions applied`, `${result.appearanceReferences} appearance references read${saved.gameVersion ? ` · game ${(saved.gameVersion / 1000).toFixed(2)}` : ""}`),
          fact(icon(detailLine.done && assets.characterDetails?.slots.every(slot => slot.state !== "unavailable") ? "check" : "info"),
            "Skin, face details, eyes, brows, lashes, hair and piercings", detailLine.text || "Waiting for the 3D head."),
        ]));
      }
      // Choices come from the loaded head's own eye-shape targets, numbered like the character creator.
      const shapes = state.eyeShapeOptions?.choices ?? [];
      const shapeLabel = (index: number) => {
        const choice = shapes.find(entry => entry.index === index);
        return choice ? `Eye shape ${choice.number}${choice.target ? ` (${choice.target})` : " (base)"}` : "";
      };
      eyeShape.update(shapes.map(choice => ({ value: String(choice.index), label: shapeLabel(choice.index) })), String(preview?.eyeShape ?? 9),
        !preview || !shapes.length, (frame.viewport.head.error ?? frame.viewport.head.message) ?? (preview ? "This head has no eye shapes." : "Preview is still loading."));
      const overriding = saved.suggestedEyeShape !== undefined && preview && saved.suggestedEyeShape !== preview.eyeShape
        ? `Overriding the saved eye shape (${shapeLabel(saved.suggestedEyeShape)}) in this viewport only.` : "";
      setText(eyeNote, overriding);
      eyeNote.hidden = !eyeNote.textContent;
      for (const [control, detail] of [[brows, "brows"], [lashes, "lashes"]] as const) {
        const enabled = !!preview?.[detail], allowed = enableReason(rt, { kind: "preview.setDetail", detail, enabled: true });
        control.update(enabled, { disabled: !preview || (!enabled && !allowed.available), reason: allowed.reason ??
          (frame.viewport.head.error ?? frame.viewport.head.message) ?? "Preview is still loading." });
      }
      const hairAllowed = enableReason(rt, { kind: "preview.setHair", enabled: true });
      hair.update(!!preview?.hair, { disabled: !preview || (!preview.hair && !hairAllowed.available), reason: hairAllowed.reason ?? "Preview is still loading.",
        note: "Hair physics is not simulated." });
      const options = state.character?.choices.find(entry => entry.slot === "piercings")?.options ?? [];
      const tried = state.character?.tried, trying = state.character?.trying;
      const piercingAllowed = enableReason(rt, { kind: "preview.setPiercings", enabled: true });
      piercings.update(!!preview?.piercings, { disabled: !preview || (!preview.piercings && !piercingAllowed.available),
        reason: piercingAllowed.reason ?? "Preview is still loading." });
      // The styles on offer are the creator's own on this installation, vanilla and modded alike; they arrive with the V's details.
      const chosen = options.find(option => option.choice === tried?.choice);
      // A try keeps the V on screen; the control says which style is on its way instead of covering the view.
      const tryingLabel = !trying ? undefined : trying.choice ? options.find(option => option.choice === trying.choice)?.label : "your V's own piercings";
      style.update([{ value: "", label: "Your V's own" }, ...options.map(option => ({ value: option.choice, label: option.label }))], chosen ? chosen.choice : "", !options.length,
        options.length ? undefined : !preview ? ((frame.viewport.head.error ?? frame.viewport.head.message) ?? "Preview is still loading.") :
          "Piercing styles appear once your V's details are ready.");
      colour.update((chosen?.definitions ?? []).map((definition, index) => ({ value: definition.name, label: `${index + 1}. ${definition.label}` })), tried?.definition, !chosen,
        "Choose a preview style first.");
      colour.element.hidden = !chosen;
      // The shown V's resolved details, read from your own installed game and mods.
      setText(detailNote, tryingLabel ? (trying?.choice ? `Trying ${tryingLabel}…` : `Going back to ${tryingLabel}…`) : saved.loaded ? "" : detailLine.text);
      detailNote.hidden = !detailNote.textContent;
    },
  };
}
function fact(mark: Element, title: string, detail: string) {
  return h("div", { class: "fact" }, h("span", { class: "fact-mark" }, mark), h("div", {}, h("strong", { text: title }), h("p", { class: "muted small", text: detail })));
}

/** One plain line about the lighting preset and where its colour grade came from. */
export function lightingPresetLine(preset: LightingPreset | undefined, status: LightingStatus | null | undefined): string {
  if (preset !== "creator") return "The Studio's own lighting, for authoring. Pick a setup, then adjust it as you like.";
  const lut = status?.lut;
  const grade = !lut || lut.phase !== "ready" ? "Loading the game's colour grade…" : lut.source?.note ?? "";
  return [`The game's character-creator lights (${status?.sex === "male" ? "male" : "female"} rig) on black, with fixed exposure.`, grade,
    "Shadows are not simulated, and light strengths are still being calibrated."].filter(Boolean).join(" ");
}

export function lightingPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const preset = new Segmented<LightingPreset>({ label: "Lighting", options: [
    { value: "studio", label: "Studio", title: "The Studio's soft authoring light" },
    { value: "creator", label: "Character creator", title: "The game's creator and mirror lighting, for comparing with the game" }],
  onSelect: value => rt.dispatch({ kind: "preview.setLightingPreset", preset: value }) });
  const presetNote = note("");
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
    transaction: { edit: value => { port.authoring.dispatch({ kind: "preview.setCreatorLighting", key: "exposure", value: Number((10 ** value).toPrecision(4)) }); } } });
  const resetCalibration = button({ label: "Restore defaults", icon: "reset", small: true, variant: "quiet",
    title: "Put the intensity reading, cone angles and creator exposure back to their defaults",
    onClick: () => rt.dispatch({ kind: "preview.resetCreatorLighting" }) });
  const diagnostics = h("details", { class: "section" }, h("summary", { text: "Advanced: creator lighting calibration" }),
    note("For matching a creator or mirror screenshot. The capture decides these; leave them at their defaults otherwise."),
    intensity.element, cone.element, creatorExposure.element, h("div", { class: "row" }, resetCalibration));
  const fovNote = note("");
  const fov = new Slider({ label: "Field of view (vertical)", ...rt.range("camera.setFov", "degrees"), step: 1, format: value => `${Math.round(value)}°`,
    transaction: {
      edit: value => {
        const result = port.authoring.dispatch({ kind: "camera.setFov", degrees: value });
        const limited = result.ok && (result.result as { limited?: boolean } | undefined)?.limited;
        setText(fovNote, limited ? "Framing reached the camera limit. Pan or use Front view to recover the subject." :
          "Camera distance follows the viewed face area as the lens angle changes. Game FOV numbers may use a different convention.");
      },
      commit: () => { port.authoring.dispatch({ kind: "camera.endFovGesture" }); },
      cancel: () => { port.authoring.dispatch({ kind: "camera.endFovGesture" }); },
    } });
  const front = button({ label: "Front view", icon: "front", small: true, onClick: () => {
    const result = port.authoring.dispatch({ kind: "camera.front" });
    const limited = result.ok && (result.result as { limited?: boolean } | undefined)?.limited;
    if (limited) setText(fovNote, "This pane is too narrow to fit the full Front view within the camera range. Widen the pane or increase FOV.");
  } });
  // Studio stage: named setups, then each control on its own (studio-lighting.ts). Exposure is in stops, on a log scale.
  // The setups arrive with the preview's read model (StudioApplication.previewState().studioSetups).
  let setupButtons: { id: StudioSetupId; button: HTMLButtonElement }[] = [];
  const setupReadout = h("output", { class: "readout" });
  const setupRow = h("div", { class: "chip-row", role: "group", "aria-label": "Studio lighting setup" });
  const setups = h("div", { class: "control" }, h("span", { class: "control-label" }, h("span", { text: "Setup" }), setupReadout), setupRow);
  const studioExposureRange = rt.range("preview.setExposure", "value"), stops = (value: number) => Math.log2(value);
  const exposure = new Slider({ label: "Exposure", min: stops(studioExposureRange.min), max: stops(studioExposureRange.max), step: .05,
    format: value => `${value < -.005 ? "−" : "+"}${Math.abs(value).toFixed(1)} EV`,
    transaction: { edit: value => { port.authoring.dispatch({ kind: "preview.setExposure", value: Number((2 ** value).toPrecision(4)) }); } } });
  const angle = new Slider({ label: "Key light direction", ...rt.range("preview.setKeyAngle", "degrees"), step: 1,
    format: value => { const degrees = Math.round(value) % 360; return `${Math.round(value)}° ${degrees === 0 ? "front" : degrees === 180 ? "behind"
      : degrees < 180 ? "from V's right" : "from V's left"}`; },
    transaction: { edit: degrees => { port.authoring.dispatch({ kind: "preview.setKeyAngle", degrees }); } } });
  const studioSlider = (key: StudioLightKey, label: string, format: (value: number) => string, step: number) => new Slider({ label,
    ...rt.range("preview.setStudioLight", "value", key), step, format,
    transaction: { edit: value => { port.authoring.dispatch({ kind: "preview.setStudioLight", key, value }); } } });
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  const elevation = studioSlider("elevation", "Key light height", value => `${Math.round(value)}°`, 1);
  const keyStrength = studioSlider("key", "Key light strength", percent, .05);
  const environmentStrength = studioSlider("environment", "Room light (ambient and reflections)", percent, .05);
  const fillStrength = studioSlider("fill", "Fill light strength", percent, .05);
  const rimStrength = studioSlider("rim", "Rim light strength", percent, .05);
  const neutral = new Toggle({ label: "Untinted lights", onChange: enabled => rt.dispatch({ kind: "preview.setStudioNeutral", enabled }) });
  const resetStudio = button({ label: "Restore defaults", icon: "reset", small: true, variant: "quiet",
    title: "Put every studio light and the exposure back to Soft studio",
    onClick: () => rt.dispatch({ kind: "preview.resetStudioLighting" }) });
  const studioControls = h("div", { class: "section" }, setups, exposure.element, angle.element, elevation.element, keyStrength.element,
    environmentStrength.element, fillStrength.element, rimStrength.element, neutral.element, h("div", { class: "row" }, resetStudio));
  const normals = new Toggle({ label: "Preview normal map", onChange: enabled => rt.dispatch({ kind: "preview.setNormals", enabled }) });
  const surface = new Toggle({ label: "Surface controls on the head", onChange: enabled => rt.dispatch({ kind: "preview.setSurfaceControls", enabled }) });
  const wire = new Toggle({ label: "Plate wireframe", onChange: enabled => rt.dispatch({ kind: "preview.setWire", enabled }) });
  const optics = new Toggle({ label: "Eye's own roughness", onChange: enabled => rt.dispatch({ kind: "preview.setEyeOptics", enabled }) });
  const opticsNote = note("");
  const element = h("div", { class: "panel-content" },
    section("Camera", fov.element, fovNote, h("div", { class: "row wrap gap-s" }, front, creatorFace, creatorHair)),
    section("Light", preset.element, presetNote, studioControls),
    diagnostics,
    section("Display", surface.element, wire.element, normals.element, optics.element, opticsNote),
    note("Camera and light are workspace preferences: they persist locally and never enter recipes, Undo or export."));
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
      neutral.update(!!lights?.neutral, { ...studioOnly({ kind: "preview.setStudioNeutral", enabled: !lights?.neutral }),
        note: "Grey lights of the same brightness instead of the warm key and cool fill, for judging colour." });
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
      setText(setupReadout, !preview ? "" : offered?.setups.find(entry => entry.id === matched)?.label ?? "Adjusted");
      applyCapability(resetStudio, ready ? port.authoring.capability({ kind: "preview.resetStudioLighting" }) : { available: false, reason: loading.reason });
      preset.update(preview?.lightingPreset, value => ready ? port.authoring.capability({ kind: "preview.setLightingPreset", preset: value }) : { available: false, reason: loading.reason });
      setText(presetNote, lightingPresetLine(preview?.lightingPreset, frame.preview.lighting));
      applyCapability(creatorFace, port.authoring.capability({ kind: "camera.creatorFraming", page: "face" }));
      applyCapability(creatorHair, port.authoring.capability({ kind: "camera.creatorFraming", page: "hair" }));
      const creator = preview?.creatorLighting;
      intensity.update(creator?.intensity, value => port.authoring.capability({ kind: "preview.setCreatorLighting", key: "intensity", value }));
      cone.update(creator?.cone, value => port.authoring.capability({ kind: "preview.setCreatorLighting", key: "cone", value }));
      creatorExposure.update(creator ? log(creator.exposure) : undefined, { ...studioOnly({ kind: "preview.setCreatorLighting", key: "exposure", value: creator?.exposure ?? 1 }),
        note: preview?.lightingPreset === "creator" ? "Scene light × k before the game's colour grade. Fitted to a capture's forehead." : "Applies while Character creator lighting is on." });
      applyCapability(resetCalibration, ready ? port.authoring.capability({ kind: "preview.resetCreatorLighting" }) : { available: false, reason: loading.reason });
      if (!fovNote.textContent) setText(fovNote, "Camera distance follows the viewed face area as the lens angle changes. Game FOV numbers may use a different convention.");
      applyCapability(front, port.authoring.capability({ kind: "camera.front" }));
      normals.update(!!preview?.normals, loading); surface.update(!!preview?.surface, loading); wire.update(!!preview?.wire, loading);
      optics.update(!!preview?.eyeOptics, loading);
      const eye = assets.eyeOptics;
      setText(opticsNote, !eye ? "Uses the shown eye's own roughness from your game files instead of the preview's even gloss." : eye.active
        ? "The eye's own roughness from your game files. The eye's surface detail, depth and the game's eye lighting aren't reproduced yet."
        : !eye.requested ? "Off: the eyes use the preview's even gloss."
          : "The eye shown has no roughness the preview can read, so it keeps the even gloss.");
    },
  };
}

export function motionPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const idle = new Toggle({ label: "Character-creator idle", onChange: enabled => rt.dispatch({ kind: "motion.setIdle", enabled }) });
  const pause = button({ label: "Pause idle", icon: "pause", small: true, onClick: () => {
    const motion = port.authoring.previewState().motion; rt.dispatch({ kind: "motion.setPaused", paused: !motion?.idlePaused });
  } });
  const setContributions = (body?: boolean, face?: boolean) => {
    const motion = port.authoring.previewState().motion; if (!motion) return;
    rt.dispatch({ kind: "motion.setContributions", body: body ?? motion.idleBody, face: face ?? motion.idleFace });
  };
  const head = new Toggle({ label: "Head movement", onChange: value => setContributions(value, undefined) });
  const face = new Toggle({ label: "Facial movement", onChange: value => setContributions(undefined, value) });
  const idleNote = note("");
  const blink = new Slider({ label: "Eyelid closure", ...rt.range("motion.setBlink", "value"), step: .01, format: value => value < .01 ? "Open" : value > .99 ? "Closed" : `${Math.round(value * 100)}%`,
    transaction: { edit: value => { port.authoring.dispatch({ kind: "motion.setBlink", value }); } } });
  const play = button({ label: "Play blink", icon: "play", small: true, onClick: () => {
    const motion = port.authoring.previewState().motion; rt.dispatch({ kind: "motion.playBlink", playing: !motion?.blinkPlaying });
  } });
  const element = h("div", { class: "panel-content" },
    section("Game idle", idle.element, h("div", { class: "row" }, pause), head.element, face.element, idleNote),
    section("Eyelid study", blink.element, h("div", { class: "row" }, play),
      note("A separate synthetic study for checking makeup on closed lids. It is unavailable while the game idle plays.")));
  return {
    spec: { id: "motion", ...PANEL_META["motion"], element },
    update(frame) {
      const motion = frame.preview.motion;
      const unavailable = { disabled: !motion?.available, reason: (frame.viewport.head.error ?? frame.viewport.head.message) ??
        (motion?.error ? `Idle unavailable: ${motion.error}` : "Motion preview is still loading.") };
      idle.update(!!motion?.idle, unavailable);
      head.update(motion?.idleBody ?? true, unavailable); face.update(motion?.idleFace ?? true, unavailable);
      applyCapability(pause, port.authoring.capability({ kind: "motion.setPaused", paused: !motion?.idlePaused }));
      setText(pause.querySelector("span")!, motion?.idlePaused ? "Resume idle" : "Pause idle");
      pause.replaceChild(icon(motion?.idlePaused ? "play" : "pause"), pause.querySelector("svg")!);
      setText(idleNote, !motion?.available ? unavailable.reason : motion.idle
        ? `${motion.idlePaused ? "Pose paused" : "Idle playing"} · ${motion.idleBody ? "head moves" : "head still"} · ${motion.idleFace ? "face moves" : "face still"}. Muting both holds the pose without losing its phase.`
        : "Extracted close-up body clip with offline-solved facial motion. Preview only; exact game timing is unverified.");
      const blinkAllowed = port.authoring.capability({ kind: "motion.setBlink", value: 0 });
      blink.update(motion?.blink, { disabled: !blinkAllowed.available, reason: blinkAllowed.reason });
      applyCapability(play, port.authoring.capability({ kind: "motion.playBlink", playing: !motion?.blinkPlaying }));
      setText(play.querySelector("span")!, motion?.blinkPlaying ? "Stop blink" : "Play blink");
    },
  };
}

export function qualityPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const sizes: PreviewTextureSize[] = [512, 1024, 2048, 4096];
  const tiers = new Segmented<PreviewTextureSize>({ label: "Generated texture resolution", options: sizes.map(size => ({ value: size, label: size === 512 ? "512" : `${size / 1024}K` })),
    onSelect: size => rt.dispatch({ kind: "quality.set", size }) });
  const stateLine = h("div", { class: "quality-state" });
  const rebuild = button({ label: "Rebuild preview", icon: "refresh", small: true, onClick: () => rt.dispatch({ kind: "quality.rebuild" }) });
  const element = h("div", { class: "panel-content" },
    section("Makeup preview textures", tiers.element, stateLine, h("div", { class: "row" }, rebuild),
      note("Applies to generated masks and optical maps only. Head, eye and imported textures keep their detail. Preview quality is a local preference: it never changes recipes, Undo, library revisions or the 2048² export.")));
  return {
    spec: { id: "quality", ...PANEL_META["quality"], element },
    update(frame) {
      const quality = frame.preview.quality, readiness = frame.readiness;
      tiers.update(quality?.size, size => port.authoring.capability({ kind: "quality.set", size }));
      const key = JSON.stringify([readiness, frame.viewport.head.phase]);
      if (stateLine.dataset.key !== key) {
        stateLine.dataset.key = key;
        const label = readiness.size >= 1024 ? `${readiness.size / 1024}K` : String(readiness.size);
        stateLine.replaceChildren(
          readiness.phase === "ready" ? badge(`${frame.viewport.head.phase === "ready" ? "Preview" : "UV masks"} ready · ${label}`, "success") :
            readiness.phase === "updating" ? badge(`Updating UV masks · ${label}`, "info") : badge("UV masks blocked", "error"),
          h("span", { class: "small", text: readiness.error ?? (readiness.phase === "updating"
            ? `${readiness.pending} texture job${readiness.pending === 1 ? "" : "s"} queued${readiness.waiting ? "; some layers still show their previous complete result" : ""}.`
            : frame.viewport.head.phase === "ready" ? "Every enabled layer shows its latest complete texture."
              : "Generated UV masks are ready; the 3D head preview is unavailable.") }),
          h("span", { class: "muted small", text: `Estimated generated-texture peak ${Math.ceil(readiness.estimatedBytes / 1048576)} MiB; native assets and browser overhead are additional.` }));
      }
      applyCapability(rebuild, port.authoring.capability({ kind: "quality.rebuild" }));
    },
  };
}

export function activityPanel(rt: StudioRuntime): PanelController {
  const list = h("ol", { class: "activity", "aria-label": "Recent activity, newest first" });
  const empty = emptyState("Nothing yet", "Saves, checks, imports, exports and errors appear here for this session.");
  const clearHint = note("This log lasts only until XF Studio closes. Results that matter — library revisions, package manifests — are stored by their own services.");
  let count = -1;
  const element = h("div", { class: "panel-content" }, empty, list, clearHint);
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

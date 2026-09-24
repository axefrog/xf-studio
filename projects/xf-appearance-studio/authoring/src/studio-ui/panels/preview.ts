import type { PreviewTextureSize } from "../../preview-quality";
import { applyCapability, badge, button, emptyState, note, section, Segmented, SelectField, Slider, Toggle } from "../controls";
import { h, setText } from "../dom";
import { icon } from "../icons";
import type { Frame, StudioRuntime } from "../runtime";
import type { PanelController } from "./collection";

const enableReason = (rt: StudioRuntime, action: Parameters<StudioRuntime["port"]["authoring"]["capability"]>[0]) => rt.port.authoring.capability(action);

export function characterPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const load = button({ label: "Load V from a save…", icon: "import", onClick: () => void rt.file({ kind: "savedV.import" }) });
  const exportV = button({ label: "Export appearance data", icon: "export", small: true, variant: "quiet", onClick: () => void rt.file({ kind: "savedV.export" }) });
  const summary = h("div", { class: "fact-list" });
  const eyeShape = new SelectField<string>({ label: "Eye shape", onChange: value => rt.dispatch({ kind: "preview.setEyeShape", index: Number(value) }) });
  const eyeChoices = Array.from({ length: 22 }, (_, i) => ({ value: String(i), label: i ? `Eye shape ${String(i).padStart(2, "0")}` : "Base mesh" }));
  const eyeNote = note("");
  const brows = new Toggle({ label: "Eyebrows", onChange: enabled => rt.dispatch({ kind: "preview.setDetail", detail: "brows", enabled }) });
  const lashes = new Toggle({ label: "Eyelashes", onChange: enabled => rt.dispatch({ kind: "preview.setDetail", detail: "lashes", enabled }) });
  const hair = new Toggle({ label: "Saved V hair", onChange: enabled => rt.dispatch({ kind: "preview.setHair", enabled }) });
  const piercings = new Toggle({ label: "Piercings", onChange: enabled => rt.dispatch({ kind: "preview.setPiercings", enabled }) });
  const style = new SelectField<string>({ label: "Preview piercing style", onChange: value => {
    const options = port.authoring.previewState().previewOptions ?? [];
    const entry = options.find(option => option.id === value);
    rt.dispatch({ kind: "preview.setPiercingPreview", style: entry?.id ?? "", definition: entry?.choices[0]?.definition ?? "" });
  } });
  const colour = new SelectField<string>({ label: "Preview piercing colour", onChange: value => {
    const state = port.authoring.previewState().preview;
    rt.dispatch({ kind: "preview.setPiercingPreview", style: state?.piercingStyle ?? "", definition: value });
  } });
  const detailNote = note("");
  const element = h("div", { class: "panel-content" },
    section("Saved V", note("A save is read locally for facial shape and appearance references. It is never modified or uploaded."),
      h("div", { class: "row wrap gap-s" }, load, exportV), summary),
    section("Eyes", eyeShape.element, eyeNote),
    section("Preview context", brows.element, lashes.element, hair.element, piercings.element, style.element, colour.element, detailNote,
      note("These details are preview context only — not authoring tools. Piercing choices change this viewport, never the imported V or your makeup.")));
  return {
    spec: { id: "character", title: "Character", icon: "character", description: "V from your save, eye shape and preview-only details.", element },
    update(frame) {
      const state = frame.preview, preview = state.preview, saved = state.savedV, assets = frame.status.assets;
      applyCapability(load, port.files.capability({ kind: "savedV.import" }));
      applyCapability(exportV, port.files.capability({ kind: "savedV.export" }));
      const key = JSON.stringify(saved);
      if (summary.dataset.key !== key) {
        summary.dataset.key = key;
        const result = saved.result;
        summary.replaceChildren(...(!saved.loaded || !result ? [emptyState("Reference head", "Load a save to preview your V's facial shape. Makeup authoring works without it.")] : [
          fact(icon("check"), `${result.applied.length} facial regions applied`, `${result.appearanceReferences} appearance references read${saved.gameVersion ? ` · game ${(saved.gameVersion / 1000).toFixed(2)}` : ""}`),
          fact(icon(result.matchedDetails.length === 2 ? "check" : "info"), result.matchedDetails.length === 2 ? "Brows and lashes matched" : "Brows and lashes: reference styles",
            result.matchedDetails.length === 2 ? "Colours are approximate." : "Not a resolved match for this save."),
          fact(icon(result.matchedHair ? "check" : "info"), result.matchedHair ? "Hair mesh matched" : "Hair unresolved", result.matchedHair ? "Colour, strand shading and physics are approximate." : "Local assets unavailable or no exact match."),
          fact(icon(result.matchedPiercing ? "check" : "info"), result.matchedPiercing ? "Vanilla piercing matched" : "No matching vanilla piercing", result.matchedPiercing ? "Materials remain approximate." : "You can try a viewport-only style below."),
          fact(icon("info"), "Eyes", result.eyeAppearance.message),
        ]));
      }
      eyeShape.update(eyeChoices, String(preview?.eyeShape ?? 9), !preview, "Preview is still loading.");
      setText(eyeNote, saved.suggestedEyeShape !== undefined && preview && saved.suggestedEyeShape !== preview.eyeShape
        ? `Overriding the saved eye shape (${String(saved.suggestedEyeShape).padStart(2, "0")}) in this viewport only.` : "");
      eyeNote.hidden = !eyeNote.textContent;
      for (const [control, detail] of [[brows, "brows"], [lashes, "lashes"]] as const) {
        const enabled = !!preview?.[detail], allowed = enableReason(rt, { kind: "preview.setDetail", detail, enabled: true });
        control.update(enabled, { disabled: !preview || (!enabled && !allowed.available), reason: allowed.reason ?? "Preview is still loading." });
      }
      const hairAllowed = enableReason(rt, { kind: "preview.setHair", enabled: true });
      hair.update(!!preview?.hair, { disabled: !preview || (!preview.hair && !hairAllowed.available), reason: hairAllowed.reason ?? "Preview is still loading.",
        note: assets.hairError ? `Some local hair styles unavailable: ${assets.hairError}` : "Appears for a matching imported V. Colour, shading and physics are approximate." });
      const options = state.previewOptions ?? [];
      const piercingAllowed = enableReason(rt, { kind: "preview.setPiercings", enabled: true });
      piercings.update(!!preview?.piercings, { disabled: !preview || !options.length, reason: piercingAllowed.reason ?? "Preview is still loading." });
      style.update([{ value: "", label: "Saved V / off" }, ...options.map(option => ({ value: option.id, label: option.label }))], preview?.piercingStyle ?? "", !options.length,
        options.length ? undefined : `Piercing preview unavailable${assets.piercingError ? `: ${assets.piercingError}` : ""}.`);
      const chosen = options.find(option => option.id === preview?.piercingStyle);
      colour.update((chosen?.choices ?? []).map(choice => ({ value: choice.definition, label: `${choice.index}. ${choice.label}` })), preview?.piercingDefinition, !chosen,
        "Choose a preview style first.");
      colour.element.hidden = !chosen;
      const provenance = assets.detailErrors.length ? `Some details unavailable: ${assets.detailErrors.join("; ")}`
        : assets.browMaterial === "saved-double-diffuse" ? assets.lashColor === "saved-profile-swatch-approximation"
          ? "Saved Arkhe brow maps · lash profile colour approximate." : "Saved Arkhe brow maps + installed ombre gradient · lash shading approximate."
          : assets.loaded ? "Reference brow and lash styles · approximate colours." : "";
      setText(detailNote, [provenance, chosen?.id.startsWith("prc_") ? "Private PRC slot preview: materials and effective game winners remain unverified." : ""].filter(Boolean).join(" "));
      detailNote.hidden = !detailNote.textContent;
    },
  };
}
function fact(mark: Element, title: string, detail: string) {
  return h("div", { class: "fact" }, h("span", { class: "fact-mark" }, mark), h("div", {}, h("strong", { text: title }), h("p", { class: "muted small", text: detail })));
}

export function lightingPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
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
    } });
  const front = button({ label: "Front view", icon: "front", small: true, onClick: () => {
    const result = port.authoring.dispatch({ kind: "camera.front" });
    const limited = result.ok && (result.result as { limited?: boolean } | undefined)?.limited;
    if (limited) setText(fovNote, "This pane is too narrow to fit the full Front view within the camera range. Widen the pane or increase FOV.");
  } });
  const exposure = new Slider({ label: "Exposure", ...rt.range("preview.setExposure", "value"), step: .05, format: value => value.toFixed(2),
    transaction: { edit: value => { port.authoring.dispatch({ kind: "preview.setExposure", value }); } } });
  const angle = new Slider({ label: "Key light angle", ...rt.range("preview.setKeyAngle", "degrees"), step: 1, format: value => `${Math.round(value)}°`,
    transaction: { edit: degrees => { port.authoring.dispatch({ kind: "preview.setKeyAngle", degrees }); } } });
  const normals = new Toggle({ label: "Preview normal map", onChange: enabled => rt.dispatch({ kind: "preview.setNormals", enabled }) });
  const surface = new Toggle({ label: "Surface controls on the head", onChange: enabled => rt.dispatch({ kind: "preview.setSurfaceControls", enabled }) });
  const wire = new Toggle({ label: "Plate wireframe", onChange: enabled => rt.dispatch({ kind: "preview.setWire", enabled }) });
  const optics = new Toggle({ label: "Source eye roughness study", onChange: enabled => rt.dispatch({ kind: "preview.setEyeOptics", enabled }) });
  const opticsNote = note("");
  const element = h("div", { class: "panel-content" },
    section("Camera", fov.element, fovNote, h("div", { class: "row" }, front)),
    section("Light", exposure.element, angle.element),
    section("Display", surface.element, wire.element, normals.element, optics.element, opticsNote),
    note("Camera and light are workspace preferences: they persist locally and never enter recipes, Undo or export."));
  return {
    spec: { id: "lighting", title: "Camera & light", icon: "lighting", description: "Field of view, framing, exposure, key light and display studies.", element },
    update(frame) {
      const preview = frame.preview.preview, ready = !!preview, assets = frame.status.assets;
      const loading = { disabled: !ready, reason: "Preview is still loading." };
      fov.update(preview?.camera.fov, loading); exposure.update(preview?.exposure, loading); angle.update(preview?.lightAngle, loading);
      if (!fovNote.textContent) setText(fovNote, "Camera distance follows the viewed face area as the lens angle changes. Game FOV numbers may use a different convention.");
      front.disabled = !ready;
      normals.update(!!preview?.normals, loading); surface.update(!!preview?.surface, loading); wire.update(!!preview?.wire, loading);
      optics.update(!!preview?.eyeOptics, loading);
      const eye = assets.eyeOptics;
      setText(opticsNote, !eye ? "Opt-in browser material study for an exactly matched saved eye." : eye.active
        ? "Source roughness R × material scale. Browser study only; eye normals, refraction and game lighting remain unmatched."
        : !eye.requested ? "Off: original diffuse-only eye preview. Enable for the exactly matched saved eye."
          : eye.error ? `Source eye roughness unavailable: ${eye.error}. Diffuse-only fallback is active.`
            : "No matching source roughness map is loaded. Diffuse-only fallback is active.");
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
    spec: { id: "motion", title: "Motion", icon: "motion", description: "Game close-up idle and the synthetic eyelid study.", element },
    update(frame) {
      const motion = frame.preview.motion;
      const unavailable = { disabled: !motion?.available, reason: motion?.error ? `Idle unavailable: ${motion.error}` : "Motion preview is still loading." };
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
    spec: { id: "quality", title: "Preview quality", icon: "quality", description: "Resolution of generated preview textures, readiness and resource use.", element },
    update(frame) {
      const quality = frame.preview.quality, readiness = frame.readiness;
      tiers.update(quality?.size, size => port.authoring.capability({ kind: "quality.set", size }));
      const key = JSON.stringify(readiness);
      if (stateLine.dataset.key !== key) {
        stateLine.dataset.key = key;
        const label = readiness.size >= 1024 ? `${readiness.size / 1024}K` : String(readiness.size);
        stateLine.replaceChildren(
          readiness.phase === "ready" ? badge(`Ready · ${label}`, "success") : readiness.phase === "updating" ? badge(`Updating · ${label}`, "info") : badge("Blocked", "error"),
          h("span", { class: "small", text: readiness.error ?? (readiness.phase === "updating"
            ? `${readiness.pending} texture job${readiness.pending === 1 ? "" : "s"} queued${readiness.waiting ? "; some layers still show their previous complete result" : ""}.`
            : "Every enabled layer shows its latest complete texture.") }),
          h("span", { class: "muted small", text: `Estimated generated-texture peak ${Math.ceil(readiness.estimatedBytes / 1048576)} MiB; native assets and browser overhead are additional.` }));
      }
      applyCapability(rebuild, port.authoring.capability({ kind: "quality.rebuild" }));
    },
  };
}

export function activityPanel(rt: StudioRuntime): PanelController {
  const list = h("ol", { class: "activity", "aria-label": "Recent activity, newest first" });
  const empty = emptyState("Nothing yet", "Saves, checks, imports, exports and errors appear here for this session.");
  const clearHint = note("This log lives only in this browser tab. Results that matter — library revisions, package manifests — are stored by their own services.");
  let count = -1;
  const element = h("div", { class: "panel-content" }, empty, list, clearHint);
  const draw = () => {
    const log = rt.feedback.log;
    if (log.length === count) return;
    count = log.length;
    empty.hidden = log.length > 0;
    list.replaceChildren(...[...log].reverse().slice(0, 80).map(entry => h("li", { class: `activity-item ${entry.tone}` },
      h("time", { datetime: entry.time.toISOString(), text: entry.time.toLocaleTimeString() }), h("strong", { text: entry.source }), h("span", { text: entry.message }))));
  };
  rt.feedback.subscribe(draw);
  return {
    spec: { id: "activity", title: "Activity", icon: "activity", description: "Session log of results, warnings and errors.", element },
    update(_frame: Frame) { draw(); },
  };
}

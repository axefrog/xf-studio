import type { PreviewTextureSize } from "../../preview-quality";
import { applyCapability, badge, button, ColorField, emptyState, note, section, Segmented, Slider, Toggle } from "../controls";
import { h, setText } from "../dom";
import { helpTip, setHelp } from "../help-tip";
import { ChoiceList, DirectionDial, GroupSection, LightList, SliderWithValue } from "../components";
import { openMenu, openValuePopover } from "../menu";
import { icon } from "../icons";
import type { Frame, StudioRuntime } from "../runtime";
import type { PanelController } from "./collection";
import { PANEL_META } from "../panel-meta";
import { readinessText } from "../readiness-text";
import type { ConeReading, IntensityForm, LightingPreset } from "../../creator-lighting";
import type { LightingStatus } from "../../preview-actions";
import type { MotionState } from "../../motion-actions";
import type { DetailLimit, DetailNotice } from "../../detail-limits";
import type { LightType, SetupBackdrop, SetupDisplay } from "../../lighting-setups";

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

/** What the Colour grade choice is (its help tip; UI-129). */
const GRADE_HELP = "How colours are finished for the screen. Studio is XF Studio's own tone mapping; Game grade is the one your game uses, read from your game files.";
/**
 * The Colour grade control's state (UI-129): where the game's grade came from goes in its help tip (what it is); loading, or a stand-in
 * grade while the Character creator setup draws through it, is said in place under the choice (what is happening now).
 */
export function colourGradeState(preset: LightingPreset | undefined, status: LightingStatus | null | undefined): { note: string; source: string } {
  const lut = status?.lut;
  if (!lut || lut.phase !== "ready") return { note: preset === "creator" ? "Loading the game's colour grade…" : "", source: "" };
  const text = lut.source?.note ?? "";
  return preset === "creator" && lut.source?.kind !== "installed" ? { note: text, source: "" } : { note: "", source: text };
}
/** What lighting setups are (the Light heading's help tip). */
const LIGHT_HELP = ["Built-in setups are starting points and never change: changing one makes your own copy, so nothing you change is lost.",
  "Character creator uses the game's creator lights for your V's body, on black, with the game's colour grade. Its light strengths are still being calibrated."];
type LightView = NonNullable<Frame["preview"]["lightingSetups"]>["shown"]["lights"][number];
/** One light's glance line in the list: its strength and whether it casts shadows (the row's glyph shows its kind). */
export function lightMeta(light: Pick<LightView, "intensity" | "shadows">): string {
  const strength = light.intensity >= 100 ? Math.round(light.intensity) : Number(light.intensity.toPrecision(2));
  return [String(strength), light.shadows ? "shadows" : ""].filter(Boolean).join(" · ");
}
/** The direction dial's key in the kept control sizes. */
const DIAL_SIZE_KEY = "lighting-direction";
/** The strength slider's range for a kind of light (lux for directional, candela for spot). */
const STRENGTH_RANGE = { directional: { min: 0, max: 20, step: .05 }, spot: { min: 0, max: 500, step: .5 } } as const;

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
  const capability = (action: Parameters<typeof port.authoring.capability>[0]) => port.authoring.capability(action);
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
      helpTip("the calibration", "How the built-in Character creator reads the game's rig, for matching a creator or mirror screenshot. The capture decides these; leave them at their defaults otherwise. Your own setups keep what they copied.")),
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

  // ----- Lighting setups (lighting-setups.ts): one flat list, the built-ins first, then the person's own. -----
  let shownId = "soft";
  const setupList = new ChoiceList<string>({ label: "Lighting setup", showLabel: false, layout: "chips", quietReason: true,
    onSelect: setup => rt.dispatch({ kind: "preview.selectLightingSetup", setup }) });
  const shown = () => port.authoring.previewState().lightingSetups?.shown;
  const newSetup = button({ label: "New setup", icon: "plus", small: true, onClick: () => rt.dispatch({ kind: "preview.createLightingSetup", from: shownId }) });
  const renameSetup = button({ label: "Rename…", icon: "rename", small: true, onClick: event => {
    const current = shown(); if (!current) return;
    openValuePopover({ kind: "text", label: "Name", value: current.label, maxLength: 60 }, event.currentTarget as Element, { title: "Rename lighting setup", apply: "Rename",
      validate: value => capability({ kind: "preview.renameLightingSetup", setup: current.id, name: String(value) }),
      commit: value => rt.dispatch({ kind: "preview.renameLightingSetup", setup: current.id, name: String(value) }) });
  } });
  const resetSetup = button({ label: "Reset", icon: "reset", small: true, onClick: () => rt.dispatch({ kind: "preview.resetLightingSetup", setup: shownId }) });
  const deleteSetup = button({ label: "Delete", icon: "trash", small: true, onClick: () => rt.dispatch({ kind: "preview.deleteLightingSetup", setup: shownId }) });
  const setupActions = h("div", { class: "row wrap gap-s" }, newSetup, renameSetup, resetSetup, deleteSetup);
  // The shown setup's surroundings: exposure (in stops, whichever display), the room's light, the backdrop and the colour grade.
  const exposure = new SliderWithValue({ label: "Exposure", min: Math.log2(0.125), max: Math.log2(8), step: .1, unit: "EV",
    format: value => `${value < -.05 ? "−" : "+"}${Math.abs(value).toFixed(1)} EV`,
    transaction: { edit: value => { edit({ kind: "preview.setExposure", value: Number((2 ** value).toPrecision(4)) }); }, commit: endEdit, cancel: endEdit } });
  const room = new SliderWithValue({ label: "Room light", min: 0, max: 300, step: 5, unit: "%", help: "Ambient light and reflections from the room around your V.",
    format: value => `${Math.round(value)} %`,
    transaction: { edit: value => { edit({ kind: "preview.setRoomLight", value: value / 100 }); }, commit: endEdit, cancel: endEdit } });
  const backdrop = new Segmented<SetupBackdrop>({ label: "Backdrop", options: [{ value: "studio", label: "Studio" }, { value: "black", label: "Black" }],
    onSelect: value => rt.dispatch({ kind: "preview.setBackdrop", backdrop: value }) });
  const grade = new Segmented<SetupDisplay>({ label: "Colour grade", help: GRADE_HELP, options: [
    { value: "aces", label: "Studio", title: "The Studio's tone mapping (ACES)" }, { value: "game", label: "Game grade", title: "The game's colour grade from your game files" }],
  onSelect: value => rt.dispatch({ kind: "preview.setDisplayTransform", display: value }) });
  const surroundings = new GroupSection({ title: "Surroundings", key: "lighting.surroundings", level: "subsection", expanded: true });
  surroundings.body.append(exposure.element, room.element, backdrop.element, grade.element);

  // The shown setup's lights: the list, then the chosen light's controls.
  let selectedLight: string | undefined;
  const lightMenu = (id: string, anchor: Element | { x: number; y: number }, invoker: Element) => {
    const light = shown()?.lights.find(item => item.id === id); if (!light) return;
    openMenu([
      { kind: "action", label: "Rename", icon: "rename", run: () => lights.rename(id) },
      { kind: "action", label: "Duplicate", icon: "duplicate", capability: capability({ kind: "preview.duplicateLight", light: id }),
        run: () => rt.dispatch({ kind: "preview.duplicateLight", light: id }) },
      { kind: "action", label: "Aim at the head", icon: "target", run: () => rt.dispatch({ kind: "preview.aimLightAtHead", light: id }) },
      { kind: "action", label: "Remove", icon: "trash", danger: true, run: () => rt.dispatch({ kind: "preview.removeLight", light: id }) },
    ], anchor, { label: `${light.name} actions`, invoker });
  };
  const lights = new LightList({ label: "Lights", maxLength: 60, onSelect: id => { selectedLight = id; paintLight(); },
    onMove: (light, index) => rt.dispatch({ kind: "preview.moveLight", light, index }),
    onRename: (light, name) => rt.dispatch({ kind: "preview.renameLight", light, name }),
    onDelete: light => rt.dispatch({ kind: "preview.removeLight", light }),
    onDuplicate: light => rt.dispatch({ kind: "preview.duplicateLight", light }), onMenu: lightMenu });
  const addLight = button({ label: "Add light", icon: "plus", small: true, menu: true, onClick: event => openMenu([
    { kind: "action", label: "Directional light", icon: "sun", capability: capability({ kind: "preview.addLight", type: "directional" }),
      run: () => rt.dispatch({ kind: "preview.addLight", type: "directional" }) },
    { kind: "action", label: "Spot light", icon: "lighting", capability: capability({ kind: "preview.addLight", type: "spot" }),
      run: () => rt.dispatch({ kind: "preview.addLight", type: "spot" }) }], event.currentTarget as Element, { label: "Add light" }) });
  const lightId = () => selectedLight ?? "";
  // The dial's size is a UI preference (`controlSize.set`), kept when the resize bar is released.
  const direction = new DirectionDial({ label: "Direction", onResize: (size, final) => {
    if (!final) return;
    const action = { kind: "controlSize.set" as const, control: DIAL_SIZE_KEY, size };
    if (port.preferences.capability(action).available) port.preferences.dispatch(action);
  }, transaction: {
    edit: value => { edit({ kind: "preview.setLight", light: lightId(), key: "azimuth", value: value.azimuth });
      edit({ kind: "preview.setLight", light: lightId(), key: "elevation", value: value.elevation }); },
    commit: endEdit, cancel: endEdit } });
  const lightSlider = (key: "distance" | "intensity" | "cone" | "softness", label: string, range: { min: number; max: number; step: number },
    unit: string, toValue: (shown: number) => number, format: (value: number) => string, help?: string) => new SliderWithValue({ label, ...range, unit, format, help,
    transaction: { edit: value => { edit({ kind: "preview.setLight", light: lightId(), key, value: toValue(value) }); }, commit: endEdit, cancel: endEdit } });
  const strength = lightSlider("intensity", "Strength", STRENGTH_RANGE.directional, "", value => value, value => String(Number(value.toPrecision(3))),
    "Lux for a directional light, candela for a spot light.");
  const distance = lightSlider("distance", "Distance", { min: .1, max: 10, step: .05 }, "m", value => value, value => `${value.toFixed(2)} m`,
    "How far the light is from your V's head. A spot light's strength falls off with it.");
  const coneSlider = lightSlider("cone", "Cone", { min: 1, max: 89.5, step: .5 }, "°", value => value, value => `${value.toFixed(1)}°`, "Half the spot light's cone angle.");
  const softness = lightSlider("softness", "Cone softness", { min: 0, max: 100, step: 1 }, "%", value => value / 100, value => `${Math.round(value)} %`);
  const colour = new ColorField({ label: "Colour", transaction: {
    edit: value => { edit({ kind: "preview.setLightColour", light: lightId(), colour: value }); }, commit: endEdit, cancel: endEdit } });
  const kind = new Segmented<LightType>({ label: "Kind", reserveNote: true, options: [{ value: "directional", label: "Directional" }, { value: "spot", label: "Spot" }],
    onSelect: type => rt.dispatch({ kind: "preview.setLightType", light: lightId(), type }) });
  const shadows = new Toggle({ label: "Casts shadows", reserveNote: true, onChange: enabled => rt.dispatch({ kind: "preview.setLightShadows", light: lightId(), enabled }) });
  // The chosen light's controls in titled subgroups (UI-126): where it is, what it gives, and the spot light's cone.
  const lightGroup = (title: string, key: string, ...controls: HTMLElement[]) => {
    const group = new GroupSection({ title, key: `lighting.light.${key}`, level: "row", heading: 5, expanded: true });
    group.body.append(...controls);
    return group.element;
  };
  const lightControls = h("div", { class: "light-editor" }, kind.element,
    lightGroup("Position", "position", direction.element, distance.element),
    lightGroup("Output", "output", strength.element, colour.element, shadows.element),
    lightGroup("Spot cone", "cone", coneSlider.element, softness.element));
  const noLights = emptyState("No lights", "Add a light to light your V directly; the room light still shows her.");
  const lightsGroup = new GroupSection({ title: "Lights", key: "lighting.lights", level: "subsection", expanded: true });
  lightsGroup.body.append(lights.element, h("div", { class: "row" }, addLight), noLights, lightControls);
  let lastFrame: Frame | undefined;
  /** Paint the chosen light's controls from the last frame (also straight after a selection, before the next frame). */
  function paintLight() {
    const view = lastFrame?.preview.lightingSetups, ready = !!lastFrame?.preview.preview;
    const list = view?.shown.lights ?? [];
    if (!list.some(light => light.id === selectedLight)) selectedLight = list[0]?.id;
    lights.update(list.map(light => ({ id: light.id, name: light.name, meta: lightMeta(light), colour: light.colour, kind: light.type })), selectedLight, !ready);
    const light = list.find(item => item.id === selectedLight);
    noLights.hidden = !!light; lightControls.hidden = !light;
    if (!light) return;
    const gate = (action: Parameters<typeof port.authoring.capability>[0]) => {
      if (!ready) return { disabled: true, reason: "The preview is still loading." };
      const allowed = capability(action); return { disabled: !allowed.available, reason: allowed.reason };
    };
    kind.update(light.type, type => ready ? capability({ kind: "preview.setLightType", light: light.id, type }) : { available: false, reason: "The preview is still loading." },
      { note: light.type === "directional" ? "Cone and softness apply to spot lights." : "" });
    direction.update({ azimuth: light.azimuth, elevation: light.elevation }, { colour: light.colour,
      size: port.preferences.snapshot().controlSizes?.[DIAL_SIZE_KEY],
      others: list.filter(item => item.id !== light.id).map(item => ({ azimuth: item.azimuth, elevation: item.elevation, colour: item.colour })),
      ...gate({ kind: "preview.setLight", light: light.id, key: "azimuth", value: light.azimuth }) });
    distance.update(light.distance, gate({ kind: "preview.setLight", light: light.id, key: "distance", value: light.distance }));
    const range = STRENGTH_RANGE[light.type];
    strength.update(light.intensity, { ...gate({ kind: "preview.setLight", light: light.id, key: "intensity", value: light.intensity }),
      min: range.min, max: Math.max(range.max, light.intensity) });
    colour.update(light.colour, !ready);
    coneSlider.update(light.cone, gate({ kind: "preview.setLight", light: light.id, key: "cone", value: light.cone }));
    softness.update(light.softness * 100, gate({ kind: "preview.setLight", light: light.id, key: "softness", value: light.softness }));
    shadows.update(light.shadows, gate({ kind: "preview.setLightShadows", light: light.id, enabled: !light.shadows }));
  }

  const normals = new Toggle({ label: "Preview normal map", onChange: enabled => rt.dispatch({ kind: "preview.setNormals", enabled }) });
  // The view's tool toggles (view-graph-design.md §3.9): the shown modules' tools, derived like the toolbar, one Toggle each.
  const toolToggles = h("div", { class: "view-tool-toggles" });
  const toggles = new Map<string, Toggle>();
  const optics = new Toggle({ label: "Eye's own roughness", onChange: enabled => rt.dispatch({ kind: "preview.setEyeOptics", enabled }) });
  const opticsNote = note("");
  // The normal-map preview is a research study (release-readiness-audit.md item 6), like the eye optics comparison; the section shows
  // only when it has something to offer.
  const display = section("Display", toolToggles, h("div", { class: "research-only" }, normals.element, optics.element, opticsNote));
  const element = h("div", { class: "panel-content" },
    section({ title: "Camera", help: ["Camera and light are saved with your workspace; they never change your looks or your mod.",
      "Ctrl+Z in this panel undoes view and lighting changes, which have their own history."] }, fov.element, h("div", { class: "row wrap gap-s" }, front, bodyView, creatorFace, creatorHair)),
    section({ title: "Light", help: LIGHT_HELP }, setupList.element, setupActions, surroundings.element, lightsGroup.element),
    diagnostics,
    display);
  return {
    spec: { id: "lighting", ...PANEL_META["lighting"], element },
    update(frame) {
      lastFrame = frame;
      const preview = frame.preview.preview, ready = !!preview, assets = frame.status.assets;
      const loading = { disabled: !ready, reason: (frame.viewport.head.error ?? frame.viewport.head.message) ?? "Preview is still loading." };
      fov.update(preview?.camera.fov, loading);
      const gated = (action: Parameters<typeof port.authoring.capability>[0]) => {
        const allowed = capability(action);
        return ready ? { disabled: !allowed.available, reason: allowed.reason } : loading;
      };
      // The setups: one flat list, the built-ins marked as such by their group.
      const view = frame.preview.lightingSetups;
      shownId = view?.active ?? "soft";
      setupList.setOptions((view?.setups ?? []).map(entry => ({ value: entry.id, label: entry.label, group: entry.builtIn ? "Built-in" : "Your setups",
        title: entry.builtIn ? `${entry.title}. Built in: changing it makes your own copy.` : entry.title })));
      setupList.update(view?.active, setup => capability({ kind: "preview.selectLightingSetup", setup }), ready ? {} : loading);
      const current = view?.shown;
      setText(newSetup.querySelector("span")!, "New setup");
      newSetup.title = current ? `A new setup of your own, starting from ${current.label}` : "";
      applyCapability(newSetup, ready ? capability({ kind: "preview.createLightingSetup", from: shownId }) : { available: false, reason: loading.reason });
      applyCapability(renameSetup, ready ? capability({ kind: "preview.renameLightingSetup", setup: shownId, name: current?.label ?? "" }) : { available: false, reason: loading.reason });
      resetSetup.title = current && !current.builtIn ? `Put ${current.label} back to ${current.baseLabel}` : "";
      applyCapability(resetSetup, ready ? capability({ kind: "preview.resetLightingSetup", setup: shownId }) : { available: false, reason: loading.reason });
      applyCapability(deleteSetup, ready ? capability({ kind: "preview.deleteLightingSetup", setup: shownId }) : { available: false, reason: loading.reason });
      if (current) {
        const range = current.exposureRange;
        exposure.update(Math.log2(current.exposure), { ...gated({ kind: "preview.setExposure", value: current.exposure }), min: Math.log2(range.min), max: Math.log2(range.max) });
        room.update(current.environment * 100, gated({ kind: "preview.setRoomLight", value: current.environment }));
        backdrop.update(current.backdrop, value => ready ? capability({ kind: "preview.setBackdrop", backdrop: value }) : { available: false, reason: loading.reason });
        const gradeState = colourGradeState(preview?.lightingPreset, frame.preview.lighting);
        grade.update(current.display, value => ready ? capability({ kind: "preview.setDisplayTransform", display: value }) : { available: false, reason: loading.reason },
          { note: gradeState.note });
        grade.setHelp(gradeState.source ? [GRADE_HELP, gradeState.source] : GRADE_HELP);
      }
      paintLight();
      addLight.hidden = false;
      applyCapability(addLight, ready ? capability({ kind: "preview.addLight", type: "spot" }) : { available: false, reason: loading.reason });
      applyCapability(creatorFace, capability({ kind: "camera.creatorFraming", page: "face" }));
      applyCapability(creatorHair, capability({ kind: "camera.creatorFraming", page: "hair" }));
      const creator = preview?.creatorLighting;
      intensity.update(creator?.intensity, value => capability({ kind: "preview.setCreatorLighting", key: "intensity", value }));
      cone.update(creator?.cone, value => capability({ kind: "preview.setCreatorLighting", key: "cone", value }));
      creatorExposure.update(creator ? log(creator.exposure) : undefined, { ...gated({ kind: "preview.setCreatorLighting", key: "exposure", value: creator?.exposure ?? 1 }),
        note: "Scene light × k before the game's colour grade, for the built-in Character creator. Fitted to a capture's forehead." });
      creatorShadows.update(creator?.shadows ?? true, gated({ kind: "preview.setCreatorShadows", enabled: !(creator?.shadows ?? true) }));
      applyCapability(resetCalibration, ready ? capability({ kind: "preview.resetCreatorLighting" }) : { available: false, reason: loading.reason });
      // Research tools (UI-85): the calibration and the display studies show only when asked for.
      const research = !!frame.preferences?.researchTools;
      diagnostics.hidden = !research;
      for (const node of element.querySelectorAll<HTMLElement>(".research-only")) node.hidden = !research;
      applyCapability(front, capability({ kind: "camera.front" }));
      applyCapability(bodyView, capability({ kind: "camera.body" }));
      normals.update(!!preview?.normals, loading);
      const tools = frame.viewTools.filter(tool => tool.kind === "toggle" && tool.state === "tools");
      for (const tool of tools) if (!toggles.has(tool.id)) toggles.set(tool.id, new Toggle({ label: tool.label,
        onChange: enabled => { rt.report("view.setTool", rt.port.views.setTool(undefined, tool.id, enabled)); } }));
      const wanted = tools.map(tool => toggles.get(tool.id)!.element);
      if (wanted.length !== toolToggles.children.length || wanted.some((node, index) => toolToggles.children[index] !== node)) toolToggles.replaceChildren(...wanted);
      for (const tool of tools) toggles.get(tool.id)!.update(!!tool.on, ready ? { disabled: !tool.capability.available, reason: tool.capability.reason } : loading);
      display.hidden = !research && !tools.length;
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
  // Its reason (facial movement not in this version) is information, so it keeps the muted tone on its line.
  const face = new Toggle({ label: "Facial movement", quietReason: true, onChange: value => setContributions(undefined, value), help: FACE_HELP });
  const faceTip = face.element.querySelector<HTMLElement>(".help-tip")!;
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
  // Hair physics: the scene's dangle simulation, one setting per scene (hair-physics-plan.md §3.6); off until it is calibrated in game,
  // so it is labelled early access (components/stage-tag.ts).
  const physics = new Toggle({ label: "Hair physics", stage: "preview", reserveNote: true, quietReason: true, onChange: value => rt.dispatch({ kind: "motion.setPhysics", enabled: value }),
    help: ["Hair that has physics in the game swings and hangs with gravity here too, worked out from the hairstyle's own files.",
      "An early-access setting: how the hair moves hasn't been matched to the game yet."] });
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
      // Without a face idle (not in this version: DESK-02) the face toggle is off and says why; the body still moves.
      const faceMissing = !!motion?.available && !motion.faceAvailable;
      // Its help describes turning the face off, which doesn't apply while there is no face motion: the tip hides (keeping its place).
      setHelp(faceTip, faceMissing ? "" : FACE_HELP);
      head.update(motion?.idleBody ?? true, unavailable);
      face.update(faceMissing ? false : motion?.idleFace ?? true, faceMissing ? { disabled: true, reason: motion!.faceError, note: motion!.faceError } : unavailable);
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
export function blinkHelp(motion: Pick<MotionState, "blinkRepeatSeconds"> & Partial<Pick<MotionState, "blinkAvailable">> | undefined): string[] {
  // Without the blink its controls are hidden, so the tip describing them hides too (the note line says why).
  if (motion?.blinkAvailable === false) return [];
  const every = motion ? `, every ${Number(motion.blinkRepeatSeconds.toFixed(2))} s` : "";
  return ["The game's own blink, made from your game files: lids, lashes, brows and makeup move together.",
    `Closure scrubs the closing half. Play blink plays it at the game's speed${every}.`];
}
/** The Motion panel's blink line: why the blink isn't available, or nothing (what it is lives in the heading's help tip). */
export function blinkNoteLine(motion: Pick<MotionState, "blinkAvailable" | "blinkError"> | undefined): string {
  // Not prepared: one plain line and nothing to do (UI-86). A damaged or mismatched one says so (it was prepared, and can be again).
  return motion && !motion.blinkAvailable ? motion.blinkError ?? "" : "";
}

/** The Facial movement toggle's help tip (hidden while the idle has no face motion). */
const FACE_HELP = "Turn off either to hold that part still. The idle keeps time, so it carries on smoothly when you turn it back on.";

/** What each Rendering option does, in plain words (their help tips). */
export const RENDERING_HELP = {
  scatter: "Light spreads a little under your V's skin, as in the game: shadow edges soften and turn warm, while lit skin stays neutral, not reddened.",
  shadows: "The lights cast shadows on your V's face and body, such as the nose's shadow. Turn off to see the face evenly lit.",
  hairLook: ["Crisp shows each strand as sharply as the hair's own files draw it. Game-like approximates the thicker, softer hair the game shows after smoothing.",
    "Preview only: your looks and your mod are unchanged."],
} as const;
/** The Hair look's readout: its two ends by name, per cent between them (the value is 0 Crisp … 1 Game-like). */
export const hairLookText = (percent: number) => percent < .5 ? "Crisp" : percent > 99.5 ? "Game-like" : `${Math.round(percent)} % game-like`;

export function qualityPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const sizes: PreviewTextureSize[] = [512, 1024, 2048, 4096];
  const tiers = new Segmented<PreviewTextureSize>({ label: "Texture size", options: sizes.map(size => ({ value: size, label: size === 512 ? "512" : `${size / 1024}K` })),
    onSelect: size => rt.dispatch({ kind: "quality.set", size }) });
  const stateLine = h("div", { class: "quality-state" });
  const rebuild = button({ label: "Rebuild preview", icon: "refresh", small: true, onClick: () => rt.dispatch({ kind: "quality.rebuild" }) });
  // Rendering (how the 3D view draws; the view's display node, View and lighting history): library Toggles and a SliderWithValue. The
  // crease occlusion switch joins this group when it lands (claude/fix-plate-seam).
  const endEdit = () => { port.authoring.dispatch({ kind: "view.endEdit" }); };
  const scatter = new Toggle({ label: "Skin scattering", help: RENDERING_HELP.scatter,
    onChange: enabled => rt.dispatch({ kind: "preview.setSkinScatter", enabled }) });
  const shadows = new Toggle({ label: "Face shadows", help: RENDERING_HELP.shadows,
    onChange: enabled => rt.dispatch({ kind: "preview.setFaceShadows", enabled }) });
  const hairLook = new SliderWithValue({ label: "Hair look", min: 0, max: 100, step: 1, unit: "%", format: hairLookText, help: RENDERING_HELP.hairLook,
    ends: { min: "Crisp", max: "Game-like" },
    defaultValue: 0, reset: true, transaction: {
      edit: value => { const action = { kind: "preview.setHairLook" as const, value: value / 100 }; rt.report(action.kind, port.authoring.dispatch(action)); },
      commit: endEdit, cancel: endEdit } });
  // Rebuild is a recovery step, offered only when the textures are in trouble (release-readiness-audit.md item 6); the palette keeps it.
  const rebuildRow = h("div", { class: "row" }, rebuild);
  // Rendering is a set of fidelity studies (research tools, UI-85): everyone else keeps its defaults.
  const rendering = section({ title: "Rendering", help: ["Research: how the 3D view draws your V. Saved with your workspace; your looks and your mod are unchanged.",
    "Ctrl+Z in this panel undoes these with the other view and lighting changes."] }, scatter.element, shadows.element, hairLook.element);
  const element = h("div", { class: "panel-content" },
    section({ title: "Makeup preview textures", help: ["The size of the makeup textures in the 3D view. The head and eyes keep their own detail.",
      "Saved on this computer; your looks and your mod are unchanged."] }, tiers.element, stateLine, rebuildRow),
    rendering);
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
        // Ready: the badge says it; the sentence speaks only for a state that needs words (updating, an error).
        const ready = readiness.phase === "ready" && frame.viewport.head.phase === "ready";
        stateLine.replaceChildren(badge(text.label, readiness.phase === "ready" ? "success" : readiness.phase === "updating" ? "info" : "error"),
          ...(ready ? [] : [h("span", { class: "small", text: text.detail })]),
          h("span", { class: "muted small", text: `About ${Math.ceil(readiness.estimatedBytes / 1048576)} MiB of memory at this size.` }));
      }
      applyCapability(rebuild, port.authoring.capability({ kind: "quality.rebuild" }));
      rebuildRow.hidden = readiness.phase !== "blocked";
      rendering.hidden = !frame.preferences?.researchTools;
      const preview = frame.preview.preview;
      const gate = (action: Parameters<typeof port.authoring.capability>[0]) => {
        const allowed = port.authoring.capability(action);
        return { disabled: !allowed.available, reason: allowed.reason };
      };
      const scattering = preview?.skinScatter ?? true, shadowing = preview?.faceShadows ?? true, look = preview?.hairLook ?? 0;
      scatter.update(scattering, gate({ kind: "preview.setSkinScatter", enabled: !scattering }));
      shadows.update(shadowing, gate({ kind: "preview.setFaceShadows", enabled: !shadowing }));
      hairLook.update(look * 100, gate({ kind: "preview.setHairLook", value: look }));
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

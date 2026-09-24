import { allowsNativeTextMenu } from "../context-menu";
import type { StudioAction } from "../studio-application";
import type { StudioFileAction } from "../studio-file-operations";
import { effectiveTheme, type ThemePreference } from "../ui-preferences";
import { openPalette, openShortcuts, type Command } from "./commands";
import { studioShortcut } from "./shortcuts";
import { button } from "./controls";
import { DockView } from "./dock/dock-view";
import type { PanelId } from "./dock/layout";
import { restoreDockPreference, serializeDockState } from "./dock/persist";
import { h, isTextInput, setAttr, setText } from "./dom";
import { Feedback } from "./feedback";
import { icon } from "./icons";
import { defaultCompact, defaultWide, sizeClassFor } from "./layout-defaults";
import { closeMenus, openMenu, type MenuItem } from "./menu";
import { activityPanel, characterPanel, lightingPanel, motionPanel, qualityPanel } from "./panels/preview";
import { importCollection, libraryPanel, libraryState, packagePanel, presetsPanel, type PanelController } from "./panels/collection";
import { edgePanel, finishPanel, shapePanel, warpPanel } from "./panels/inspector";
import { layersPanel } from "./panels/layers";
import { headPanel, uvPanel } from "./panels/viewports";
import { Frame, StudioRuntime, type Port } from "./runtime";

/**
 * Mount the XF Studio presentation. It receives only the public presentation
 * port: every edit, save, package and preview change is an application action.
 */
export function mountStudio(port: Port, root: HTMLElement) {
  const feedback = new Feedback();
  const rt = new StudioRuntime(port, feedback);
  const theme = themeController(port, feedback);
  const panels: PanelController[] = [presetsPanel(rt), layersPanel(rt), libraryPanel(rt), packagePanel(rt), headPanel(rt), uvPanel(rt),
    finishPanel(rt), shapePanel(rt), edgePanel(rt), warpPanel(rt), characterPanel(rt), lightingPanel(rt), motionPanel(rt), qualityPanel(rt),
    activityPanel(rt)];
  const byId = new Map(panels.map(panel => [panel.spec.id, panel]));
  const restored = restoreDockPreference(port.preferences.snapshot().layout,
    { x: 0, y: 0, w: window.innerWidth, h: Math.max(200, window.innerHeight - 84) });
  const dock = new DockView({
    panels: panels.map(panel => ({ ...panel.spec, visibility: visible => {
      panel.spec.visibility?.(visible);
      if (visible) panel.update(new Frame(port));
    } })),
    state: restored.state,
    sizeClass: () => sizeClassFor(window.innerWidth),
    defaults: size => size === "wide" ? defaultWide() : defaultCompact(),
    save: state => {
      const layout = serializeDockState(state), allowed = port.preferences.capability({ kind: "layout.set", layout });
      if (allowed.available) port.preferences.dispatch({ kind: "layout.set", layout });
      else feedback.toast("warning", "Layout", allowed.reason ?? "This layout could not be saved.");
    },
    announce: message => feedback.announce(message),
    beforeLayout: () => port.viewport.cancelInput(),
    afterLayout: () => requestAnimationFrame(() => port.viewport.resize()),
  });
  rt.dock = dock;
  const header = shellHeader(rt, theme);
  const status = statusBar(rt);
  const main = h("main", { class: "workspace", "aria-label": "Workspace panels" }, dock.element);
  root.replaceChildren(header.element, main, status.element, feedback.toasts, feedback.live, feedback.assertive);
  root.classList.add("studio-ready");
  dock.render();
  requestAnimationFrame(() => dock.recover());
  if (restored.recovered === false && port.preferences.snapshot().layout)
    feedback.toast("warning", "Layout", "The saved panel layout could not be restored safely, so the default layout is shown.");

  let queued = false, lastClass = dock.sizeClass, lastMessage = port.status.snapshot().message?.id ?? 0;
  const paint = () => {
    queued = false;
    const frame = new Frame(port);
    // Editor adapters report limits and rejected gestures; show each once.
    const message = frame.status.message;
    if (message && message.id !== lastMessage) {
      lastMessage = message.id;
      // Routine raster timings are not activity; failures also surface through readiness.
      if (message.source === "preview") { if (/fail|error|unavailable|exceed/i.test(message.text)) feedback.record("warning", "Preview", message.text); }
      else feedback.toast("warning", message.source === "uv" ? "UV map" : "Head", message.text);
    }
    header.update(frame); status.update(frame);
    // Decide once per paint so every visible heavy panel repaints together.
    const heavyOk = [...heavy].some(id => dock.isVisible(id)) && heavyDue(frame);
    for (const panel of panels) {
      if (!dock.isVisible(panel.spec.id)) continue;
      if (heavy.has(panel.spec.id) && !heavyOk) continue;
      panel.update(frame);
    }
  };
  // Library and Mod package read file-operation capabilities that re-validate the whole
  // draft (~30 ms with long Undo histories). Never repaint them mid-gesture, and otherwise
  // at most every 400 ms unless the library's busy/progress state changes.
  const heavy = new Set<PanelId>(["library", "package"]);
  let heavyAt = 0, heavyKey = "", heavyTimer: ReturnType<typeof setTimeout> | undefined;
  const heavyDue = (frame: Frame) => {
    const library = frame.library, key = JSON.stringify([library.busy, library.progress, library.summaries.length, library.draft?.revision, library.draft?.previous?.id]);
    const now = performance.now(), busy = !!(frame.preview.gesture || frame.preview.control);
    if (!busy && (key !== heavyKey || now - heavyAt >= 400)) { heavyAt = now; heavyKey = key; return true; }
    if (!heavyTimer) heavyTimer = setTimeout(() => { heavyTimer = undefined; schedule(); }, 420);
    return false;
  };
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
  port.subscribe(schedule); rt.subscribe(schedule); feedback.subscribe(schedule);
  paint();
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (dock.sizeClass !== lastClass) {
        lastClass = dock.sizeClass; dock.render();
        feedback.announce(`${lastClass === "wide" ? "Wide" : "Compact"} layout`);
      }
      dock.recover(); dock.condenseTabs(); port.viewport.resize(); schedule();
    }, 120);
  });

  const commands = () => buildCommands(rt, theme, byId);
  // Native menus stay in text fields; custom menus are opened by their targets.
  document.addEventListener("contextmenu", event => { if (!allowsNativeTextMenu(event)) event.preventDefault(); });
  window.addEventListener("keydown", event => {
    if (event.defaultPrevented) return;
    const modalOpen = !!document.querySelector("dialog[open]");
    const shortcut = studioShortcut(event, { textInput: isTextInput(event.target), modalOpen });
    if (!shortcut) return;
    event.preventDefault();
    if (shortcut === "palette") { if (!modalOpen) { closeMenus(false); openPalette(commands); } }
    else if (shortcut === "save") void rt.request({ kind: "save" });
    else if (shortcut === "undo" || shortcut === "redo") {
      // An editor adapter cancels its own active gesture; never undo an earlier edit underneath it.
      const state = port.authoring.previewState();
      if (state.gesture || state.control) { feedback.announce("Finish or cancel the current adjustment first (Esc)."); return; }
      rt.dispatch({ kind: shortcut === "redo" ? "recipe.redo" : "recipe.undo" });
    } else if (shortcut === "regions" || shortcut === "regions-back") cycleRegions(root, shortcut === "regions-back");
    else openShortcuts();
  });
  header.bindPalette(() => openPalette(commands));
  if (verificationMode(port)) Object.assign(window, { xfStudioShell: { dock, runtime: rt, commands } });
  return { dock, runtime: rt };
}

const verificationMode = (port: Port) => port.status.snapshot().verification;

function themeController(port: Port, feedback: Feedback) {
  const media = matchMedia("(prefers-color-scheme: dark)");
  let preference: ThemePreference = port.preferences.snapshot().theme;
  const apply = () => {
    const resolved = effectiveTheme(preference, media.matches);
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.style.colorScheme = resolved;
  };
  media.addEventListener("change", apply);
  apply();
  return {
    get preference() { return preference; },
    get system() { return media.matches ? "dark" : "light"; },
    set(next: ThemePreference) {
      port.preferences.dispatch({ kind: "theme.set", theme: next });
      preference = next; apply();
      feedback.announce(next === "system" ? `Theme follows the system (${media.matches ? "dark" : "light"})` : `${next === "dark" ? "Dark" : "Light"} theme`);
    },
  };
}
type Theme = ReturnType<typeof themeController>;

function themeItems(theme: Theme): MenuItem[] {
  return [{ kind: "heading", label: "Appearance", detail: "Stored with this browser workspace" },
    { kind: "action", label: `Match system (${theme.system})`, icon: "monitor", checked: theme.preference === "system", run: () => theme.set("system") },
    { kind: "action", label: "Light", icon: "sun", checked: theme.preference === "light", run: () => theme.set("light") },
    { kind: "action", label: "Dark", icon: "moon", checked: theme.preference === "dark", run: () => theme.set("dark") }];
}

function shellHeader(rt: StudioRuntime, theme: Theme) {
  const port = rt.port;
  const category = h("button", { class: "category", type: "button", "aria-haspopup": "menu", title: "Authoring category" },
    icon("category"), h("span", { text: "Eye makeup" }), icon("chevronDown"));
  category.addEventListener("click", () => openMenu([
    { kind: "heading", label: "Authoring category" },
    { kind: "action", label: "Eye makeup", icon: "finish", checked: true, hint: "Presets, layers, finishes and one game selector", run: () => {} },
    { kind: "separator" },
    { kind: "heading", label: "More categories are planned", detail: "Piercings, brows, cheeks, hair, expressions and tattoos will each be discussed before they are built. Brows, lashes, hair and piercings in the preview are context only." },
  ], category, { label: "Authoring category", invoker: category }));
  const collection = h("span", { class: "crumb-collection" }), preset = h("span", { class: "crumb-preset" });
  const chip = h("span", { class: "chip" });
  const undo = button({ label: "Undo", icon: "undo", iconOnly: true, variant: "ghost", title: "Undo (Ctrl+Z)", onClick: () => rt.dispatch({ kind: "recipe.undo" }) });
  const redo = button({ label: "Redo", icon: "redo", iconOnly: true, variant: "ghost", title: "Redo (Ctrl+Shift+Z)", onClick: () => rt.dispatch({ kind: "recipe.redo" }) });
  const save = button({ label: "Save", icon: "save", title: "Save to library (Ctrl+S)", onClick: () => void rt.request({ kind: "save" }) });
  const pkg = button({ label: "Package", icon: "package", variant: "quiet", title: "Open mod package review", onClick: () => rt.dock.reveal("package") });
  const palette = button({ label: "Commands", icon: "command", variant: "ghost", title: "Command palette (Ctrl+K)", onClick: () => {} });
  const panelsButton = button({ label: "Panels", icon: "layout", iconOnly: true, variant: "ghost", title: "Panels and layout", onClick: event => {
    const dock = rt.dock;
    openMenu([{ kind: "heading", label: "Panels", detail: `${dock.sizeClass === "wide" ? "Wide" : "Compact"} layout · each size keeps its own arrangement` },
      ...dock.panelList().map(panel => ({ kind: "action" as const, label: panel.title, icon: panel.icon, checked: dock.isOpen(panel.id),
        hint: panel.description, run: () => dock.toggle(panel.id) })),
      { kind: "separator" },
      { kind: "action", label: "Reset this layout", icon: "reset", run: () => dock.reset() },
      { kind: "action", label: "Keyboard shortcuts", icon: "keyboard", shortcut: "?", run: () => openShortcuts() }],
    event.currentTarget as Element, { label: "Panels and layout", invoker: event.currentTarget as Element });
  } });
  const themeButton = button({ label: "Theme", icon: "monitor", iconOnly: true, variant: "ghost", onClick: event =>
    openMenu(themeItems(theme), event.currentTarget as Element, { label: "Theme", invoker: event.currentTarget as Element }) });
  const verify = h("span", { class: "verify-flag", title: "Isolated verification draft and library. Your normal work is untouched.", hidden: true }, "Verification workspace");
  const element = h("header", { class: "shell-header" },
    h("div", { class: "brand", "aria-label": "XF Studio" }, h("span", { class: "brand-mark", "aria-hidden": "true" }, "XF"), h("span", { class: "brand-name" }, "Studio")),
    category,
    h("nav", { class: "crumbs", "aria-label": "Current document" }, collection, icon("chevronRight"), preset, chip),
    verify,
    h("div", { class: "header-actions" }, undo, redo, save, pkg, h("span", { class: "divider", "aria-hidden": "true" }), palette, panelsButton, themeButton));
  return {
    element,
    bindPalette(open: () => void) { palette.onclick = open; },
    update(frame: Frame) {
      const draft = frame.library.draft;
      setText(collection, draft?.name ?? "Loading…");
      setText(preset, draft?.presets.find(item => item.id === draft.selected)?.name ?? "No preset");
      const state = libraryState(frame);
      setText(chip, state.label); chip.className = `chip ${state.tone}`; chip.title = state.detail;
      const undoCap = port.authoring.capability({ kind: "recipe.undo" }), redoCap = port.authoring.capability({ kind: "recipe.redo" });
      const history = port.authoring.history();
      undo.disabled = !undoCap.available; undo.title = undoCap.available ? `Undo ${history.undo?.label ?? ""} (Ctrl+Z)`.replace("  ", " ") : `Undo — ${undoCap.reason}`;
      redo.disabled = !redoCap.available; redo.title = redoCap.available ? `Redo ${history.redo?.label ?? ""} (Ctrl+Shift+Z)`.replace("  ", " ") : `Redo — ${redoCap.reason}`;
      const saveCap = port.authoring.requestCapability({ kind: "save" });
      save.disabled = !saveCap.available; save.title = saveCap.available ? "Save to library (Ctrl+S)" : saveCap.reason ?? "";
      verify.hidden = !frame.status.verification;
      themeButton.replaceChildren(icon(theme.preference === "system" ? "monitor" : theme.preference === "dark" ? "moon" : "sun"));
      setAttr(themeButton, "aria-label", `Theme: ${theme.preference === "system" ? `system (${theme.system})` : theme.preference}`);
    },
  };
}

function statusBar(rt: StudioRuntime) {
  const workspace = h("span", { class: "status-item" }), activity = h("button", { class: "status-item status-message", type: "button",
    title: "Open the activity log" }), ready = h("span", { class: "status-item ready-badge" }), gesture = h("span", { class: "status-item muted" });
  activity.addEventListener("click", () => rt.dock.reveal("activity"));
  const element = h("footer", { class: "status-bar", "aria-label": "Status" }, workspace, activity, h("span", { class: "grow" }), gesture, ready);
  return {
    element,
    update(frame: Frame) {
      const save = frame.status.workspace;
      workspace.dataset.tone = save.kind;
      setText(workspace, save.kind === "saved" ? "● Draft autosaved in this browser" : save.kind === "idle" ? "○ Draft autosave starting" : `▲ ${save.message}`);
      workspace.title = save.kind === "protected" ? save.message : "Browser autosave keeps your draft between sessions; the library holds explicit revisions.";
      const library = frame.library;
      const last = rt.feedback.log.at(-1);
      const message = library.busy && library.progress?.phase === "working" ? library.progress.message : last?.message ?? "Ready";
      setText(activity, message); activity.dataset.tone = library.busy ? "progress" : last?.tone ?? "info";
      const preview = frame.preview;
      setText(gesture, preview.gesture ? "Gesture in progress · Esc cancels" : preview.control ? "Adjusting · Esc restores" : "");
      const r = frame.readiness, label = r.size >= 1024 ? `${r.size / 1024}K` : String(r.size);
      ready.dataset.phase = r.phase;
      const labelPrefix = frame.viewport.head.phase === "ready" ? "Preview" : "UV masks";
      setText(ready, r.phase === "ready" ? `${labelPrefix} ${label} · ready` : r.phase === "updating"
        ? `${labelPrefix} ${label} · updating` : `${labelPrefix} blocked`);
      ready.title = r.error ?? frame.viewport.head.error ?? "";
    },
  };
}

function cycleRegions(root: HTMLElement, backwards: boolean) {
  const regions = [root.querySelector<HTMLElement>(".shell-header"), ...root.querySelectorAll<HTMLElement>(".dock-group"),
    root.querySelector<HTMLElement>(".status-bar")].filter((node): node is HTMLElement => !!node);
  const current = regions.findIndex(region => region.contains(document.activeElement));
  const next = regions[(current + (backwards ? -1 : 1) + regions.length) % regions.length];
  const target = next.querySelector<HTMLElement>(".dock-tab[aria-selected=true], button:not(:disabled), [tabindex='0']");
  (target ?? next).focus();
}

function buildCommands(rt: StudioRuntime, theme: Theme, panels: Map<PanelId, PanelController>): Command[] {
  const port = rt.port, layer = port.editor.layer(), field = port.editor.selectedField();
  const act = (id: string, title: string, group: string, action: StudioAction | undefined, extra: Partial<Command> = {}): Command => ({
    id, title, group, ...extra,
    capability: () => action ? port.authoring.capability(action) : { available: false, reason: "Select a layer first." },
    run: () => { if (action) rt.dispatch(action); },
  });
  const file = (id: string, title: string, group: string, action: StudioFileAction, extra: Partial<Command> = {}): Command => ({
    id, title, group, ...extra, capability: () => port.files.capability(action), run: () => void rt.file(action) });
  const request = (id: string, title: string, group: string, value: Parameters<StudioRuntime["request"]>[0], extra: Partial<Command> = {}): Command => ({
    id, title, group, ...extra, capability: () => port.authoring.requestCapability(value), run: () => void rt.request(value) });
  const always = { capability: () => ({ available: true }) };
  const preview = port.authoring.previewState(), motion = preview.motion;
  return [
    act("undo", "Undo", "Edit", { kind: "recipe.undo" }, { icon: "undo", shortcut: "Ctrl+Z" }),
    act("redo", "Redo", "Edit", { kind: "recipe.redo" }, { icon: "redo", shortcut: "Ctrl+Shift+Z", keywords: "ctrl+y" }),
    act("preset.add", "Add preset", "Edit", { kind: "preset.edit", command: { kind: "add" } }, { icon: "plus" }),
    act("preset.restore", "Restore removed preset", "Edit", { kind: "preset.edit", command: { kind: "restore" } }, { icon: "reset" }),
    { id: "layer.add", title: "Add layer", group: "Edit", icon: "plus", capability: () => rt.addLayerCapability(), run: () => { rt.dispatch({ kind: "layer.edit", command: { kind: "add" } }); } },
    act("layer.duplicate", "Duplicate selected layer", "Edit", layer && { kind: "layer.edit", command: { kind: "duplicate", id: layer.id } }, { icon: "duplicate" }),
    act("layer.remove", "Remove selected layer", "Edit", layer && { kind: "layer.edit", command: { kind: "remove", id: layer.id } }, { icon: "trash" }),
    act("layer.reset", "Reset selected layer", "Edit", layer && { kind: "layer.edit", command: { kind: "reset", id: layer.id } }, { icon: "reset" }),
    act("layer.toggle", layer?.enabled === false ? "Show selected layer" : "Hide selected layer", "Edit", layer && { kind: "layer.setEnabled", id: layer.id, enabled: !layer.enabled }, { icon: "eye" }),
    act("point.remove", "Remove selected point", "Shape", layer && { kind: "point.remove", layerId: layer.id, index: port.editor.selected() }, { icon: "trash" }),
    act("path.bezier", "Enable Bézier handles", "Shape", layer && { kind: "path.edit", layerId: layer.id, command: { kind: "enable-bezier" } }, { icon: "shape" }),
    act("layer.mirror", layer?.symmetry ? "Stop mirroring across the face" : "Mirror across the face", "Shape", layer && { kind: "layer.setSymmetry", layerId: layer.id, symmetry: !layer.symmetry }, { icon: "mirror" }),
    act("field.add", "Add warp control", "Shape", layer && { kind: "field.add", layerId: layer.id }, { icon: "warp" }),
    act("field.remove", "Remove selected warp", "Shape", layer && field && { kind: "field.remove", layerId: layer.id, fieldId: field.id }, { icon: "trash" }),
    ...rt.finishes.map(finish => act(`finish.${finish.id}`, `Finish: ${finish.label}`, "Colour & finish", layer && { kind: "layer.setFinish", layerId: layer.id, finish: finish.id },
      { icon: "finish", keywords: finish.exportAdapter === "none" ? "preview study" : "exports" })),
    request("library.save", "Save to library", "Library", { kind: "save" }, { icon: "save", shortcut: "Ctrl+S" }),
    request("library.copy", "Save as new collection", "Library", { kind: "saveCopy" }, { icon: "duplicate", keywords: "copy" }),
    request("library.refresh", "Refresh saved collections", "Library", { kind: "refresh" }, { icon: "refresh" }),
    file("library.recover", "Recover previous collection draft", "Library", { kind: "collection.recover" }, { icon: "undo" }),
    { id: "collection.import", title: "Import collection…", group: "Files", icon: "import", capability: () => port.files.capability({ kind: "collection.import" }),
      run: () => importCollection(rt, { x: Math.round(window.innerWidth / 2 - 170), y: 120 }) },
    file("collection.export", "Export collection (saves first)", "Files", { kind: "collection.export" }, { icon: "export" }),
    file("collection.plan", "Export compiler plan (saves first; not a mod)", "Files", { kind: "collection.plan" }, { icon: "export", keywords: "build plan" }),
    file("recipe.import", "Import recipe as preset…", "Files", { kind: "recipe.import" }, { icon: "import" }),
    file("recipe.export", "Export preset recipe", "Files", { kind: "recipe.export" }, { icon: "export" }),
    file("mask.export", "Export selected layer mask (2048²)", "Files", { kind: "mask.export" }, { icon: "export" }),
    file("package.check", "Check mod export", "Mod package", { kind: "package.check" }, { icon: "check" }),
    file("package.build", "Build mod files", "Mod package", { kind: "package.build" }, { icon: "package", keywords: "archive build" }),
    file("savedV.import", "Load V from a save…", "Character", { kind: "savedV.import" }, { icon: "character" }),
    file("savedV.export", "Export appearance data", "Character", { kind: "savedV.export" }, { icon: "export" }),
    act("camera.front", "Front view", "View", { kind: "camera.front" }, { icon: "front" }),
    ...(["both", "single", "other", "fit"] as const).map(command => ({ id: `uv.${command}`, title: `UV: ${{ both: "Both eyes", single: "Single eye", other: "Other eye", fit: "Fit shape" }[command]}`,
      group: "View", icon: "uv" as const, capability: () => port.viewport.uvCommandCapability(command), run: () => { port.viewport.uvCommand(command); } })),
    act("surface", preview.preview?.surface ? "Hide surface controls" : "Show surface controls", "View", { kind: "preview.setSurfaceControls", enabled: !preview.preview?.surface }, { icon: "handles" }),
    act("wire", preview.preview?.wire ? "Hide plate wireframe" : "Show plate wireframe", "View", { kind: "preview.setWire", enabled: !preview.preview?.wire }, { icon: "wire" }),
    ...([512, 1024, 2048, 4096] as const).map(size => act(`quality.${size}`, `Preview quality: ${size === 512 ? "512" : `${size / 1024}K`}`, "View", { kind: "quality.set", size }, { icon: "quality" })),
    act("quality.rebuild", "Rebuild preview", "View", { kind: "quality.rebuild" }, { icon: "refresh" }),
    act("idle", motion?.idle ? "Stop character-creator idle" : "Play character-creator idle", "Motion", { kind: "motion.setIdle", enabled: !motion?.idle }, { icon: "motion" }),
    act("idle.pause", motion?.idlePaused ? "Resume idle" : "Pause idle", "Motion", { kind: "motion.setPaused", paused: !motion?.idlePaused }, { icon: "pause" }),
    ...[...panels.values()].map(panel => ({ id: `panel.${panel.spec.id}`, title: `${rt.dock.isOpen(panel.spec.id) ? "Go to" : "Open"} ${panel.spec.title}`, group: "Panels",
      icon: panel.spec.icon, keywords: panel.spec.description, ...always, run: () => rt.dock.reveal(panel.spec.id) })),
    ...[...panels.values()].filter(panel => rt.dock.isOpen(panel.spec.id)).map(panel => ({ id: `panel.float.${panel.spec.id}`, title: `Float ${panel.spec.title}`,
      group: "Layout", icon: "float" as const, ...always, run: () => rt.dock.float(panel.spec.id) })),
    { id: "layout.reset", title: "Reset layout", group: "Layout", icon: "reset", ...always, run: () => rt.dock.reset() },
    { id: "theme.system", title: `Theme: match system (${theme.system})`, group: "Appearance", icon: "monitor", ...always, run: () => theme.set("system") },
    { id: "theme.light", title: "Theme: light", group: "Appearance", icon: "sun", ...always, run: () => theme.set("light") },
    { id: "theme.dark", title: "Theme: dark", group: "Appearance", icon: "moon", ...always, run: () => theme.set("dark") },
    { id: "help.shortcuts", title: "Keyboard shortcuts", group: "Help", icon: "keyboard", shortcut: "?", ...always, run: () => openShortcuts() },
  ];
}

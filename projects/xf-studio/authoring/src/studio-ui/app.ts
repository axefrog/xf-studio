import { allowsNativeTextMenu } from "../context-menu";
import type { StudioAction } from "../studio-application";
import type { StudioFileAction } from "../studio-file-operations";
import { effectiveTheme, type ThemePreference } from "../ui-preferences";
import { shortcutLabel } from "../input-bindings";
import { openInputReference, openPalette, type Command } from "./commands";
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
import { importCollection, libraryState, type PanelController } from "./panels/collection";
import { historyCommandLabel, historyCommandTitle } from "./history-model";
import { previewSetupCard } from "./preview-setup-card";
import { panelAnchor } from "./guidance/anchors";
import { mountGuidance, type GuidanceController } from "./guidance/controller";
import { CLOSED_PANEL_HOMES, PANEL_IDS, type StudioPanelId } from "./layout-defaults";
import { STUDIO_CATALOGUE } from "./views";
import { PANEL_FACTORIES, type ViewContext } from "./views/panels";
import { Frame, StudioRuntime, type Port } from "./runtime";

/**
 * Mount the XF Studio presentation. It receives only the public presentation
 * port: every edit, save, package and preview change is an application action.
 */
export function mountStudio(port: Port, root: HTMLElement) {
  const feedback = new Feedback();
  const rt = new StudioRuntime(port, feedback);
  const theme = themeController(port, feedback);
  const view = viewPreferences(port, feedback);
  // Guidance (tours, spotlights, Help) is created once the dock exists; the Help panel reaches it lazily.
  let guidance!: GuidanceController;
  const context: ViewContext = { guidance: { tours: () => guidance.service.tourList(), status: id => guidance.status(id), start: id => guidance.start(id) } };
  // Every panel comes from a view contribution (the shell's and each feature's), in catalogue order.
  const panels: PanelController[] = PANEL_IDS.map(id => PANEL_FACTORIES[id](rt, context));
  const byId = new Map(panels.map(panel => [panel.spec.id, panel]));
  const help = byId.get("help") as PanelController & { focusSearch?(): void };
  for (const panel of panels) rt.anchors.register(panelAnchor(panel.spec.id as StudioPanelId), panel.spec.element);
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
    homes: CLOSED_PANEL_HOMES,
  });
  rt.dock = dock;
  const openHelp = () => { dock.reveal("help", false); requestAnimationFrame(() => help.focusSearch?.()); };
  guidance = mountGuidance(rt, { openHelp });
  const header = shellHeader(rt, theme, view, openHelp);
  const status = statusBar(rt);
  const setupCard = previewSetupCard(rt);
  const main = h("main", { class: "workspace", "aria-label": "Workspace panels" }, dock.element);
  root.replaceChildren(header.element, main, status.element, setupCard.element, setupCard.consent, ...guidance.elements, feedback.toasts, feedback.live, feedback.assertive);
  root.classList.add("studio-ready");
  dock.render();
  requestAnimationFrame(() => dock.recover());
  if (restored.recovered === false && port.preferences.snapshot().layout)
    feedback.toast("warning", "Layout", "The saved panel layout could not be restored safely, so the default layout is shown.");

  let queued = false, lastClass = dock.sizeClass, lastMessage = port.status.snapshot().message?.id ?? 0;
  let setupRequests = port.previewSetup.snapshot().setupRequests;
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
    header.update(frame); status.update(frame); setupCard.update(frame); guidance.update(frame);
    // The preview setup asked for the game folder or WolvenKit on a host without its own setup form.
    if (frame.previewSetup.setupRequests !== setupRequests) {
      setupRequests = frame.previewSetup.setupRequests;
      dock.reveal("package");
      byId.get("package")?.showSetup?.();
    }
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
  const heavy = new Set<PanelId>(STUDIO_CATALOGUE.heavy);
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

  const commands = () => [...buildCommands(rt, theme, view, byId), ...guidance.commands()];
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
      rt.dispatch({ kind: shortcut === "redo" ? "history.redo" : "history.undo" });
    } else if (shortcut === "regions" || shortcut === "regions-back") cycleRegions(root, shortcut === "regions-back");
    else if (shortcut === "guide") { closeMenus(false); openHelp(); }
    else view.openReference();
  });
  header.bindPalette(() => openPalette(commands));
  if (verificationMode(port)) Object.assign(window, { xfStudioShell: { dock, runtime: rt, commands,
    guidance: { start: guidance.start, service: guidance.service, snapshot: () => guidance.service.snapshot(), offerOnboarding: () => guidance.offerOnboarding(new Frame(port)) } } });
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

/** View preferences beyond the theme: viewport input hints (persisted, on by default). */
function viewPreferences(port: Port, feedback: Feedback) {
  const hints = () => port.preferences.snapshot().inputHints;
  const setHints = (enabled: boolean) => {
    const action = { kind: "inputHints.set" as const, enabled }, allowed = port.preferences.capability(action);
    if (!allowed.available) { feedback.toast("warning", "View", allowed.reason ?? "This preference could not be saved."); return; }
    port.preferences.dispatch(action);
    feedback.announce(enabled ? "Viewport input hints shown" : "Viewport input hints hidden");
  };
  const openReference = () => openInputReference({ hints: { enabled: hints(), set: setHints } });
  return {
    hints, setHints, openReference,
    items(): MenuItem[] {
      return [{ kind: "heading", label: "Viewports", detail: "Stored with your workspace" },
        { kind: "action", label: "Show input hints", icon: "keyboard", checked: hints(), hint: "Corner strip and target tooltips that follow the pointer and held keys",
          run: () => setHints(!hints()) },
        { kind: "action", label: "Keyboard & mouse…", icon: "keyboard", shortcut: shortcutLabel("shell.shortcuts"), run: openReference }];
    },
  };
}
type ViewPrefs = ReturnType<typeof viewPreferences>;

function themeItems(theme: Theme): MenuItem[] {
  return [{ kind: "heading", label: "Appearance", detail: "Stored with your workspace" },
    { kind: "action", label: `Match system (${theme.system})`, icon: "monitor", checked: theme.preference === "system", run: () => theme.set("system") },
    { kind: "action", label: "Light", icon: "sun", checked: theme.preference === "light", run: () => theme.set("light") },
    { kind: "action", label: "Dark", icon: "moon", checked: theme.preference === "dark", run: () => theme.set("dark") }];
}

function shellHeader(rt: StudioRuntime, theme: Theme, view: ViewPrefs, openHelp: () => void) {
  const port = rt.port;
  // The registered features are the authoring categories; with only one there is nothing to choose, so it is a label, not a menu.
  const features = port.features(), categoryLabel = features.length === 1 ? features[0].label : `${features.length} features`;
  const category = h("span", { class: "category", title: `Authoring category: ${categoryLabel.toLowerCase()}` },
    icon("category"), h("span", { text: categoryLabel }));
  const collection = h("span", { class: "crumb-collection" }), preset = h("span", { class: "crumb-preset" });
  const chip = h("span", { class: "chip" });
  const keys = { undo: shortcutLabel("shell.undo"), redo: shortcutLabel("shell.redo"), save: shortcutLabel("shell.save"), palette: shortcutLabel("shell.palette") };
  const undo = button({ label: "Undo", icon: "undo", iconOnly: true, variant: "ghost", title: `Undo (${keys.undo})`, onClick: () => rt.dispatch({ kind: "history.undo" }) });
  const redo = button({ label: "Redo", icon: "redo", iconOnly: true, variant: "ghost", title: `Redo (${keys.redo})`, onClick: () => rt.dispatch({ kind: "history.redo" }) });
  const historyButton = button({ label: "History", icon: "history", iconOnly: true, variant: "ghost", title: "History: every recent change to this preset",
    onClick: () => rt.dock.reveal("history") });
  const save = button({ label: "Save", icon: "save", title: `Save to library (${keys.save})`, onClick: () => void rt.request({ kind: "save" }) });
  const pkg = button({ label: "Package", icon: "package", variant: "quiet", title: "Open mod package review", onClick: () => rt.dock.reveal("package") });
  const palette = button({ label: "Commands", icon: "command", variant: "ghost", title: `Command palette (${keys.palette})`, onClick: () => {} });
  const helpButton = button({ label: "Help", icon: "help", iconOnly: true, variant: "ghost", title: `Help: tours, answers and shortcuts (${shortcutLabel("shell.help")})`, onClick: openHelp });
  for (const [anchor, control] of [["header.save", save], ["header.package", pkg], ["header.history", historyButton], ["header.palette", palette], ["header.help", helpButton]] as const)
    rt.anchors.register(anchor, control);
  const panelsButton = button({ label: "Panels", icon: "layout", iconOnly: true, variant: "ghost", title: "Panels and layout", onClick: event => {
    const dock = rt.dock;
    openMenu([{ kind: "heading", label: "Panels", detail: `${dock.sizeClass === "wide" ? "Wide" : "Compact"} layout · each size keeps its own arrangement` },
      ...dock.panelList().map(panel => ({ kind: "action" as const, label: panel.title, icon: panel.icon, checked: dock.isOpen(panel.id),
        hint: panel.description, run: () => dock.toggle(panel.id) })),
      { kind: "separator" },
      { kind: "action", label: "Reset this layout", icon: "reset", run: () => dock.reset() },
      { kind: "action", label: "Keyboard & mouse", icon: "keyboard", shortcut: shortcutLabel("shell.shortcuts"), run: () => view.openReference() }],
    event.currentTarget as Element, { label: "Panels and layout", invoker: event.currentTarget as Element });
  } });
  const themeButton = button({ label: "View preferences", icon: "monitor", iconOnly: true, variant: "ghost", onClick: event =>
    openMenu([...themeItems(theme), { kind: "separator" }, ...view.items()], event.currentTarget as Element,
      { label: "View preferences", invoker: event.currentTarget as Element }) });
  const verify = h("span", { class: "verify-flag", title: "Isolated verification draft and library. Your normal work is untouched.", hidden: true }, "Verification workspace");
  const element = h("header", { class: "shell-header" },
    h("div", { class: "brand", "aria-label": "XF Studio" }, h("span", { class: "brand-mark", "aria-hidden": "true" }, "XF"), h("span", { class: "brand-name" }, "Studio")),
    category,
    h("nav", { class: "crumbs", "aria-label": "Current document" }, collection, icon("chevronRight"), preset, chip),
    verify,
    h("div", { class: "header-actions" }, h("span", { class: "history-controls", role: "group", "aria-label": "Undo and Redo" }, undo, redo, historyButton), save, pkg, h("span", { class: "divider", "aria-hidden": "true" }), palette, helpButton, panelsButton, themeButton));
  return {
    element,
    bindPalette(open: () => void) { palette.onclick = open; },
    update(frame: Frame) {
      const draft = frame.library.draft;
      setText(collection, draft?.name ?? "Loading…");
      setText(preset, draft?.presets.find(item => item.id === draft.selected)?.name ?? "No preset");
      const state = libraryState(frame);
      setText(chip, state.label); chip.className = `chip ${state.tone}`; chip.title = state.detail;
      const undoCap = port.authoring.capability({ kind: "history.undo" }), redoCap = port.authoring.capability({ kind: "history.redo" });
      const history = port.authoring.history();
      // Name what each would change, and keep the shortcut visible even while unavailable.
      undo.disabled = !undoCap.available; undo.title = historyCommandTitle("undo", undoCap, history.undo?.label, keys.undo);
      redo.disabled = !redoCap.available; redo.title = historyCommandTitle("redo", redoCap, history.redo?.label, keys.redo);
      setAttr(undo, "aria-label", historyCommandLabel("undo", undoCap, history.undo?.label));
      setAttr(redo, "aria-label", historyCommandLabel("redo", redoCap, history.redo?.label));
      const saveCap = port.authoring.requestCapability({ kind: "save" });
      save.disabled = !saveCap.available; save.title = saveCap.available ? `Save to library (${keys.save})` : saveCap.reason ?? "";
      verify.hidden = !frame.status.verification;
      themeButton.replaceChildren(icon(theme.preference === "system" ? "monitor" : theme.preference === "dark" ? "moon" : "sun"));
      setAttr(themeButton, "aria-label", `View preferences (theme: ${theme.preference === "system" ? `system (${theme.system})` : theme.preference})`);
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
      setText(workspace, save.kind === "saved" ? "● Draft autosaved" : save.kind === "idle" ? "○ Draft autosave starting" : `▲ ${save.message}`);
      workspace.title = save.kind === "protected" ? save.message : "Your draft autosaves on this computer between sessions; the library keeps the versions you save.";
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
      ready.title = r.error ?? (frame.viewport.head.error ?? frame.viewport.head.message) ?? "";
    },
  };
}

/**
 * F6 / Shift+F6: move focus between the shell's regions. The visible guidance callouts (the tour card and the
 * onboarding offer) are regions too (UI-41); in one, focus lands on its primary action, never its close button.
 */
function cycleRegions(root: HTMLElement, backwards: boolean) {
  const callouts = [...root.querySelectorAll<HTMLElement>(".guidance-callout")].filter(node => !node.hidden && !node.closest("[hidden]"));
  const regions = [root.querySelector<HTMLElement>(".shell-header"), ...root.querySelectorAll<HTMLElement>(".dock-group"),
    root.querySelector<HTMLElement>(".status-bar"), ...callouts].filter((node): node is HTMLElement => !!node);
  const current = regions.findIndex(region => region.contains(document.activeElement));
  const next = regions[(current + (backwards ? -1 : 1) + regions.length) % regions.length];
  const target = next.classList.contains("guidance-callout")
    ? next.querySelector<HTMLElement>(".guidance-actions .btn.primary:not(:disabled)") ?? next.querySelector<HTMLElement>(".guidance-actions .btn:not(:disabled)")
      ?? next.querySelector<HTMLElement>(".guidance-title")
    : next.querySelector<HTMLElement>(".dock-tab[aria-selected=true], button:not(:disabled), [tabindex='0']");
  (target ?? next).focus();
}

function buildCommands(rt: StudioRuntime, theme: Theme, view: ViewPrefs, panels: Map<PanelId, PanelController>): Command[] {
  const port = rt.port, layer = rt.editor.layer(), field = rt.editor.selectedField();
  const act = (id: string, title: string, group: string, action: StudioAction | undefined, extra: Partial<Command> = {},
    missing = "Select a layer first."): Command => ({
    id, title, group, ...extra,
    capability: () => action ? port.authoring.capability(action) : { available: false, reason: missing },
    run: () => { if (action) rt.dispatch(action); },
  });
  const file = (id: string, title: string, group: string, action: StudioFileAction, extra: Partial<Command> = {}): Command => ({
    id, title, group, ...extra, capability: () => port.files.capability(action), run: () => void rt.file(action) });
  const request = (id: string, title: string, group: string, value: Parameters<StudioRuntime["request"]>[0], extra: Partial<Command> = {}): Command => ({
    id, title, group, ...extra, capability: () => port.authoring.requestCapability(value), run: () => void rt.request(value) });
  const always = { capability: () => ({ available: true }) };
  const preview = port.authoring.previewState(), motion = preview.motion, history = port.authoring.history();
  return [
    act("undo", historyCommandLabel("undo", port.authoring.capability({ kind: "history.undo" }), history.undo?.label), "Edit", { kind: "history.undo" },
      { icon: "undo", shortcut: shortcutLabel("shell.undo"), keywords: "undo back" }),
    act("redo", historyCommandLabel("redo", port.authoring.capability({ kind: "history.redo" }), history.redo?.label), "Edit", { kind: "history.redo" },
      { icon: "redo", shortcut: shortcutLabel("shell.redo"), keywords: "redo ctrl+y forward" }),
    { id: "history.open", title: "Show History (every recent change)", group: "Edit", icon: "history", keywords: "undo redo steps changes go back",
      ...always, run: () => rt.dock.reveal("history") },
    act("preset.add", "Add preset", "Edit", { kind: "preset.edit", command: { kind: "add" } }, { icon: "plus" }),
    act("preset.restore", "Restore removed preset", "Edit", { kind: "preset.edit", command: { kind: "restore" } }, { icon: "reset" }),
    { id: "layer.add", title: "Add layer", group: "Edit", icon: "plus", capability: () => rt.addLayerCapability(), run: () => { rt.dispatch({ kind: "layer.edit", command: { kind: "add" } }); } },
    act("layer.duplicate", "Duplicate selected layer", "Edit", layer && { kind: "layer.edit", command: { kind: "duplicate", id: layer.id } }, { icon: "duplicate", shortcut: `${shortcutLabel("rows.duplicate")} in Layers` }),
    act("layer.remove", "Remove selected layer", "Edit", layer && { kind: "layer.edit", command: { kind: "remove", id: layer.id } }, { icon: "trash", shortcut: `${shortcutLabel("rows.remove")} in Layers` }),
    act("layer.reset", "Reset selected layer", "Edit", layer && { kind: "layer.edit", command: { kind: "reset", id: layer.id } }, { icon: "reset" }),
    act("layer.toggle", layer?.enabled === false ? "Show selected layer" : "Hide selected layer", "Edit", layer && { kind: "layer.setEnabled", id: layer.id, enabled: !layer.enabled }, { icon: "eye" }),
    act("point.remove", "Remove selected point", "Shape", layer && { kind: "point.remove", layerId: layer.id, index: rt.editor.selected() }, { icon: "trash" }),
    act("path.bezier", "Enable Bézier handles", "Shape", layer && { kind: "path.edit", layerId: layer.id, command: { kind: "enable-bezier" } }, { icon: "shape" }),
    act("layer.mirror", layer?.symmetry ? "Stop mirroring across the face" : "Mirror across the face", "Shape", layer && { kind: "layer.setSymmetry", layerId: layer.id, symmetry: !layer.symmetry }, { icon: "mirror" }),
    act("field.add", "Add warp control", "Shape", layer && { kind: "field.add", layerId: layer.id }, { icon: "warp" }),
    act("field.remove", "Remove selected warp", "Shape", layer && field && { kind: "field.remove", layerId: layer.id, fieldId: field.id }, { icon: "trash" },
      layer ? "Select a warp control first." : "Select a layer first."),
    ...rt.finishes.map(finish => act(`finish.${finish.id}`, `Finish: ${finish.label}${finish.exportAdapter === "none" ? " (preview only)" : finish.exportAdapter === "experimental" ? " (experimental export)" : ""}`, "Colour & finish", layer && { kind: "layer.setFinish", layerId: layer.id, finish: finish.id },
      { icon: "finish", keywords: finish.exportAdapter === "none" ? "preview only study" : "exports" })),
    request("library.save", "Save to library", "Library", { kind: "save" }, { icon: "save", shortcut: shortcutLabel("shell.save") }),
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
    // Viewport keys work while that viewport has focus; the palette names the scope.
    act("camera.front", "Front view", "View", { kind: "camera.front" }, { icon: "front", shortcut: `${shortcutLabel("head.front")} in Head` }),
    ...(["both", "single", "other", "fit"] as const).map(command => ({ id: `uv.${command}`, title: `UV: ${{ both: "Both eyes", single: "Single eye", other: "Other eye", fit: "Fit shape" }[command]}`,
      group: "View", icon: "uv" as const, shortcut: `${shortcutLabel(`uv.${command}`)} in UV`,
      capability: () => port.viewport.uvCommandCapability(command), run: () => { port.viewport.uvCommand(command); } })),
    act("surface", preview.preview?.surface ? "Hide surface controls" : "Show surface controls", "View", { kind: "preview.setSurfaceControls", enabled: !preview.preview?.surface }, { icon: "handles" }),
    act("wire", preview.preview?.wire ? "Hide plate wireframe" : "Show plate wireframe", "View", { kind: "preview.setWire", enabled: !preview.preview?.wire }, { icon: "wire" }),
    act("lighting.preset", preview.preview?.lightingPreset === "creator" ? "Lighting: studio" : "Lighting: character creator (game)", "View",
      { kind: "preview.setLightingPreset", preset: preview.preview?.lightingPreset === "creator" ? "studio" : "creator" },
      { icon: "lighting", keywords: "creator mirror game lights lut grade compare calibration" }),
    act("camera.creatorFace", "Camera: character-creator face page", "View", { kind: "camera.creatorFraming", page: "face" }, { icon: "front", keywords: "creator 15 fov eyes brows lashes" }),
    act("camera.creatorHair", "Camera: character-creator hair page", "View", { kind: "camera.creatorFraming", page: "hair" }, { icon: "front", keywords: "creator 15 fov hair skin" }),
    ...([["isotropic", "lumens ÷ 4π"], ["cone", "spread over the cone"]] as const).map(([value, label]) =>
      act(`lighting.creator.intensity.${value}`, `Creator lighting diagnostic: intensity ${label}`, "Diagnostics",
        { kind: "preview.setCreatorLighting", key: "intensity", value }, { icon: "lighting", keywords: "creator calibration lumen candela" })),
    ...([["full", "full cone angles"], ["half", "half cone angles"]] as const).map(([value, label]) =>
      act(`lighting.creator.cone.${value}`, `Creator lighting diagnostic: ${label}`, "Diagnostics",
        { kind: "preview.setCreatorLighting", key: "cone", value }, { icon: "lighting", keywords: "creator calibration spot angle" })),
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
    { id: "view.hints", title: view.hints() ? "Hide viewport input hints" : "Show viewport input hints", group: "View", icon: "keyboard",
      keywords: "shortcut hints tooltips status", ...always, run: () => view.setHints(!view.hints()) },
    { id: "help.shortcuts", title: "Keyboard & mouse", group: "Help", icon: "keyboard", shortcut: shortcutLabel("shell.shortcuts"),
      keywords: "shortcuts keys bindings gestures", ...always, run: () => view.openReference() },
  ];
}

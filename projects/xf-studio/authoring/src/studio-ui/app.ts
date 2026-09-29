import { allowsNativeTextMenu } from "../context-menu";
import { checkForUpdatesNow, startupUpdateCheck } from "./update-check";
import { comingSoon, liveFeatures, plannedShown } from "./coming-soon";
import type { StudioAction } from "../studio-application";
import type { StudioFileAction } from "../studio-file-operations";
import { effectiveTheme, type ThemePreference } from "../ui-preferences";
import { shortcutLabel } from "../input-bindings";
import { openInputReference, openPalette, type Command } from "./commands";
import { studioShortcut } from "./shortcuts";
import { applyCapability, badge, button, setButtonLabel } from "./controls";
import { installReasonTips } from "./reason-tip";
import { installHelpTips } from "./help-tip";
import { DockView } from "./dock/dock-view";
import type { PanelId } from "./dock/layout";
import { defaultDockStateFor, restoreDockPreference, serializeDockState } from "./dock/persist";
import type { StudioModule } from "../platform/api";
import { h, isTextInput, setAttr, setText } from "./dom";
import { Feedback } from "./feedback";
import { icon, isIconName } from "./icons";
import { sizeClassFor } from "./layout-defaults";
import { layoutController, type LayoutController } from "./layouts";
import { closeMenus, openMenu, type Capability, type MenuItem } from "./menu";
import { importCollection, libraryState, type PanelController } from "./panels/collection";
import { HISTORY_SCOPE, historyCommandLabel, historyCommandTitle } from "./history-model";
import { previewSetupCard } from "./preview-setup-card";
import { panelAnchor } from "./guidance/anchors";
import { mountGuidance, type GuidanceController } from "./guidance/controller";
import type { ViewComposition, ViewContext } from "./views/panels";
import { featureCommands, featureViewContext, moduleViewContext } from "./views/feature-context";
import type { FeatureViewContext, ModuleViewContext } from "./views/feature-view";
import { Frame, modulePanelChanges, StudioRuntime, type Port } from "./runtime";
import { desktopAppEntry, openDesktopApp, openDesktopAppSheet } from "./guidance/desktop-app-sheet";
import { openReportDialog } from "./diagnostics/report-dialog";
import { readinessText } from "./readiness-text";
import { SETTINGS_PANEL, type SettingsSection } from "./settings-sections";
import { bindViewState, PreferenceViewState } from "./view-state";
import { flushScrollMemories } from "./scroll-anchor";

/**
 * Mount the XF Studio presentation. It receives only the public presentation
 * port: every edit, save, package and preview change is an application action.
 * `views` is the composition root's view list (the shell's and each feature's
 * panels, `compose/views.ts`); the shell names no feature's panels.
 */
export function mountStudio(port: Port, root: HTMLElement, views: ViewComposition) {
  // Error notices carry a reference and "Report this problem" (docs/diagnostics.md).
  const feedback = new Feedback({ notice: failure => port.diagnostics.notice(failure), report: ref => openReportDialog(rt, ref),
    expected: code => port.diagnostics.expected(code) });
  installReasonTips(document);
  installHelpTips(document);
  // Remembered folds and scroll positions (view-state.ts) are the workspace's, before any panel is built. Scroll positions are recorded
  // before the page is hidden: capture listeners run ahead of the workspace save's own (browser-workspace-device.ts).
  bindViewState(new PreferenceViewState(port.preferences));
  window.addEventListener("pagehide", flushScrollMemories, { capture: true });
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushScrollMemories(); }, { capture: true });
  const catalogue = views.catalogue;
  const rt = new StudioRuntime(port, feedback, catalogue);
  const theme = themeController(port, feedback);
  const view = viewPreferences(port, feedback);
  // Guidance (tours, spotlights, Help) is created once the dock exists; the Help panel reaches it lazily.
  let guidance!: GuidanceController;
  // Each feature's view gets one context over its own facade, never the runtime or the port (UI-73).
  const featureViews = views.features.map(binding => ({ binding, ctx: featureViewContext(rt, binding.owner) as FeatureViewContext }));
  // Each part-less module's view gets one context over its own service (view-graph-design.md §5).
  const moduleViews = (views.modules ?? []).map(binding => ({ binding, ctx: moduleViewContext(rt, binding.owner) }));
  // Studio modules (view-graph-design.md §4): a panel belongs to the module presenting its view's feature; the shell's belong to none.
  const modules = port.views.modules();
  const moduleOfOwner = (owner: string) => modules.find(module => (module.feature ?? module.id) === owner);
  const moduleOfPanel = (panel: PanelId) => { const entry = catalogue.panels.find(item => item.id === panel); return entry ? moduleOfOwner(entry.owner) : undefined; };
  const panelsOf = (module: StudioModule) => catalogue.panels.filter(panel => moduleOfOwner(panel.owner)?.id === module.id).map(panel => panel.id);
  /** The panels of hidden modules: withdrawn from the dock, their places parked (design §4.3). */
  const parkedPanels = () => { const shown = new Set(rt.shownModules()); return catalogue.panels.filter(panel => {
    const module = moduleOfOwner(panel.owner); return !!module && !shown.has(module.id); }).map(panel => panel.id); };
  const featureViewOf = (module: StudioModule) => featureViews.find(entry => entry.binding.owner === (module.feature ?? module.id));
  const context: ViewContext = {
    guidance: { tours: () => guidance.service.tourList(), status: id => guidance.status(id), start: id => guidance.start(id) },
    // Settings › Appearance sets the same preferences as the header's View preferences menu.
    appearance: { theme: () => theme.preference, setTheme: next => theme.set(next), hints: view.hints, setHints: view.setHints,
      research: view.research, setResearch: view.setResearch, openReference: view.openReference },
    // What the shown modules contribute to a view: their crumbs (in module order) and the first readiness badge.
    view: {
      summaries: () => port.views.summaries(undefined, { modules: rt.shownModules() }).flatMap(summary => {
        const module = modules.find(item => item.id === summary.module), entry = module && featureViewOf(module);
        return entry?.binding.summary ? [entry.binding.summary(entry.ctx as never)] : [];
      }),
      badge: () => {
        for (const id of rt.shownModules()) {
          const module = modules.find(item => item.id === id), entry = module && featureViewOf(module);
          const badge = entry?.binding.readiness?.(entry.ctx as never);
          if (badge) return badge;
        }
        return undefined;
      },
    },
  };
  // Every panel comes from a view contribution (the shell's and each feature's), in catalogue order.
  const panels: PanelController[] = catalogue.panels.map(({ id, owner }) => {
    if (owner === "shell") {
      const factory = views.shell[id];
      if (!factory) throw Error(`Panel ${id} has no factory.`);
      return factory(rt, context);
    }
    const moduleView = moduleViews.find(entry => entry.binding.owner === owner), moduleFactory = moduleView?.binding.panels[id];
    if (moduleView && moduleFactory) return (moduleFactory as (ctx: ModuleViewContext) => PanelController)(moduleView.ctx);
    const view = featureViews.find(entry => entry.binding.owner === owner), factory = view?.binding.panels[id];
    if (!view || !factory) throw Error(`Panel ${id} has no factory.`);
    return (factory as (ctx: FeatureViewContext) => PanelController)(view.ctx);
  });
  const byId = new Map(panels.map(panel => [panel.spec.id, panel]));
  const help = byId.get("help") as PanelController & { focusSearch?(): void };
  for (const panel of panels) rt.anchors.register(panelAnchor(panel.spec.id), panel.spec.element);
  const parkedAtStart = parkedPanels();
  const restored = restoreDockPreference(port.preferences.snapshot().layout,
    { x: 0, y: 0, w: window.innerWidth, h: Math.max(200, window.innerHeight - 84) }, catalogue, parkedAtStart);
  // A preview module's panels carry its stage on their tabs (components/stage-tag.ts).
  const specOf = (panel: PanelController) => ({ ...panel.spec, stage: moduleOfPanel(panel.spec.id)?.stage, visibility: (visible: boolean) => {
    panel.spec.visibility?.(visible);
    if (visible) panel.update(new Frame(port));
  } });
  /** Put the 3D preview setup card where it belongs now (set below, once the card exists): after every dock layout too (UI-164). */
  let placeSetupCard = () => {};
  const dock = new DockView({
    // A hidden module's panels are not in the dock: they come back when it is shown (design §4.3).
    panels: panels.filter(panel => !parkedAtStart.includes(panel.spec.id)).map(specOf),
    state: restored.state,
    sizeClass: () => sizeClassFor(window.innerWidth),
    defaults: size => { const defaults = defaultDockStateFor(catalogue, parkedPanels()); return size === "wide" ? defaults.wide : defaults.compact; },
    withdrawn: id => {
      const module = moduleOfPanel(id);
      if (module) feedback.toast("info", "Modules", `${catalogue.meta[id]?.title ?? id} belongs to ${module.label}, which is hidden.`,
        [{ label: `Show ${module.label}`, run: () => setModuleShown(module.id, true) }]);
    },
    save: state => {
      const layout = serializeDockState(state), allowed = port.preferences.capability({ kind: "layout.set", layout });
      if (allowed.available) port.preferences.dispatch({ kind: "layout.set", layout });
      else feedback.toast("warning", "Layout", allowed.reason ?? "This layout could not be saved.");
    },
    announce: message => feedback.announce(message),
    beforeLayout: () => port.viewport.cancelInput(),
    // A layout change (a tab switched, a pane hidden or resized) may leave the setup card in a pane that is no longer shown or roomy:
    // it is placed again then, not only on the next paint (UI-164).
    afterLayout: () => requestAnimationFrame(() => { port.viewport.resize(); placeSetupCard(); }),
  });
  rt.dock = dock;
  /**
   * Withdraw every view tool this presentation doesn't offer (UI-102): a hidden module's, and research tools while they are hidden; and
   * the research-only view settings with them (the Rendering options, UI-163: drawn at their defaults). Each keeps its state, and no
   * device acts on it (Surface controls neither draws nor edits) until it is offered again. The
   * application gets tool IDs only, never which modules show (design §6.3 rule 6). Recomputed only when the filter changes (the
   * registered tools are fixed for the session), so a paint costs one comparison.
   */
  let withdrawnKey = "";
  const withdrawUnoffered = () => {
    const filter = rt.toolFilter(), key = JSON.stringify(filter);
    if (key === withdrawnKey) return;
    withdrawnKey = key;
    const everything = { modules: modules.map(module => module.id), research: true };
    const all = [...port.views.tools(undefined, everything).map(tool => tool.id), ...port.views.settings(everything)];
    const offered = new Set([...port.views.tools(undefined, filter).map(tool => tool.id), ...port.views.settings(filter)]);
    port.views.withdraw(all.filter(id => !offered.has(id)));
  };
  withdrawUnoffered();
  /**
   * Show or hide a module (design §4.3): its panels leave the dock with their places parked, or come back where they were; its view
   * tools and crumb follow at once because they are derived. An open gesture or form edit is finished first. Its data and exports
   * are untouched, and its actions stay dispatchable.
   */
  /** Finish an open gesture or form edit before its panels may leave the dock. */
  function finishInput() {
    port.viewport.cancelInput();
    const control = port.authoring.previewState().control;
    if (control) port.authoring.controlCommit(control.id);
  }
  function setModuleShown(id: string, shown: boolean) {
    const module = modules.find(item => item.id === id);
    if (!module || rt.shownModules().includes(id) === shown) return;
    if (!shown) finishInput();
    if (!setPreference(port, feedback, { kind: "modules.set", module: id, shown }, `${module.label} ${shown ? "shown" : "hidden"}`)) return;
    placeModules();
  }
  /**
   * Bring the dock in line with the modules preference (CORE-115): the menu above calls it at once, and every paint checks it, so a
   * `modules.set` dispatched through the port by anything else places (or parks) the module's panels the same way. A saved layout's
   * switch loads its own arrangement first, so there is nothing left to do by then.
   */
  let placedModules = rt.shownModules().join(",");
  function placeModules() {
    const shown = rt.shownModules();
    placedModules = shown.join(",");
    const { add, remove } = modulePanelChanges(modules, shown, panelsOf, panel => !!dock.panel(panel));
    if (!add.length && !remove.length) return;
    if (remove.length) { finishInput(); dock.removePanels(remove); }
    if (add.length) dock.addPanels(add.map(panel => specOf(byId.get(panel)!)));
    withdrawUnoffered();
    schedule();
  }
  rt.modules = { list: modules, panels: panelsOf, set: setModuleShown };
  // Saved layouts (view-graph-design.md §4.5): a layout loads its arrangement and modules, and the rest is derived as for a module toggle.
  const layouts = layoutController({ port, feedback, dock, catalogue, modules, shownModules: () => rt.shownModules(), parkedPanels,
    panelSpecs: () => panels.map(specOf), area: () => dock.area(), finishInput, changed: () => { withdrawUnoffered(); schedule(); } });
  const openHelp = () => { dock.reveal("help", false); requestAnimationFrame(() => help.focusSearch?.()); };
  /**
   * Settings (UI-109) is summoned like any panel (`reveal`, dock/layout.ts `summonPanel`): with no home among the docked groups a closed
   * Settings opens floating, or where the person last had it; one already open is brought forward where it is, its group expanded if
   * collapsed. Then the group asked for is shown and focused.
   */
  const settingsPanel = byId.get(SETTINGS_PANEL);
  rt.settings = { open: (section?: SettingsSection) => {
    dock.reveal(SETTINGS_PANEL, false);
    requestAnimationFrame(() => settingsPanel?.show?.(section));
  } };
  guidance = mountGuidance(rt, { openHelp });
  const header = shellHeader(rt, theme, view, openHelp, layouts);
  const status = statusBar(rt);
  const setupCard = previewSetupCard(rt);
  const main = h("main", { class: "workspace", "aria-label": "Workspace panels" }, dock.element);
  root.replaceChildren(header.element, main, status.element, setupCard.element, setupCard.consent, ...guidance.elements, feedback.toasts, feedback.live, feedback.assertive);
  root.classList.add("studio-ready");
  dock.render();
  requestAnimationFrame(() => dock.recover());
  if (restored.recovered === false && port.preferences.snapshot().layout)
    feedback.toast("warning", "Layout", "The saved panel layout could not be restored safely, so the default layout is shown.");
  // A window that opens in another size class than last time counts as crossing into it.
  requestAnimationFrame(() => layouts.sizeClass(dock.sizeClass, false));

  /**
   * The 3D preview setup card sits in the 3D view pane, its subject, whenever that pane is shown and has room for it
   * (release-readiness-audit.md item 10), so it never covers an inspector; it floats over the window only while the pane is hidden or
   * squeezed below the card's reading size. Placed only while the card shows (its size is read then); moving it keeps focus.
   */
  const headPane = byId.get("head")?.spec.element;
  const dockSetupCard = (open: boolean) => {
    if (open) {
      const pane = headPane && dock.isVisible("head") ? headPane.getBoundingClientRect() : undefined;
      // A pane not laid out yet (0 × 0, the first paint) counts as roomy; the card scrolls inside a pane down to 280 × 220.
      const roomy = !!pane && ((pane.width === 0 && pane.height === 0) || (pane.width >= 280 && pane.height >= 220));
      const host = roomy ? headPane! : root;
      if (setupCard.element.parentElement !== host) {
        const focused = setupCard.element.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
        if (host === root) root.insertBefore(setupCard.element, setupCard.consent); else host.append(setupCard.element);
        focused?.focus({ preventScroll: true });
      }
    }
    // While a tour runs, a floating card would sit over what the tour points at: it waits, and comes back when the tour ends.
    if (open && setupCard.element.parentElement === root && guidance.service.snapshot().active) setupCard.element.hidden = true;
    // The card says what the pane needs, so the pane doesn't say it a second time while the card shows (docked or floating).
    headPane?.classList.toggle("setup-card-open", open);
  };
  placeSetupCard = () => dockSetupCard(port.previewSetup.snapshot().card.open);
  let queued = false, lastClass = dock.sizeClass, lastMessage = port.status.snapshot().message?.id ?? 0;
  let lastNotice = port.diagnostics.snapshot().notice?.id ?? 0;
  let setupRequests = port.previewSetup.snapshot().setupRequests;
  const paint = () => {
    queued = false;
    // A module shown or hidden through the port (a typed `modules.set`) places its panels as the Modules menu does (CORE-115).
    if (rt.shownModules().join(",") !== placedModules) placeModules();
    // The research preference may have changed: its tools are withdrawn or offered again before anything reads the tools.
    withdrawUnoffered();
    const frame = new Frame(port);
    // Editor adapters report limits and rejected gestures; show each once.
    const message = frame.status.message;
    if (message && message.id !== lastMessage) {
      lastMessage = message.id;
      // Routine raster timings are not activity; failures also surface through readiness.
      if (message.source === "preview") { if (/fail|error|unavailable|exceed/i.test(message.text)) feedback.record("warning", "Preview", message.text); }
      else feedback.toast("warning", message.source === "uv" ? "UV map" : "3D view", message.text);
    }
    // A failure an app service met in the background (a V that couldn't be prepared): shown once, with its reference.
    const notice = port.diagnostics.snapshot().notice;
    if (notice && notice.id !== lastNotice) {
      lastNotice = notice.id;
      // A V that couldn't be prepared is said by the 3D view's own line while the 3D view is open: no toast repeats it over the
      // panels (G3, release-readiness-audit.md C-18); the Activity log keeps it with its reference for a report.
      const inView = notice.area === "character" && dock.isOpen("head") && frame.viewport.head.phase === "ready"
        && frame.status.assets.characterDetails?.phase === "failed";
      if (inView) feedback.record("error", notice.source, notice.message, notice.ref ?? undefined);
      else feedback.toast("error", notice.source, notice.message, [], { ref: notice.ref });
    }
    header.update(frame); status.update(frame); setupCard.update(frame); dockSetupCard(frame.previewSetup.card.open); guidance.update(frame);
    // A view's tab is titled from the view graph (its name, numbered when there are several) with what it shows as context.
    for (const view of frame.viewTitles) dock.retitle(view.panel, view.title, view.subject);
    // The preview setup asked for the game folder or WolvenKit on a host without its own setup form: Settings › Game.
    if (frame.previewSetup.setupRequests !== setupRequests) {
      setupRequests = frame.previewSetup.setupRequests;
      rt.settings.open("game");
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
  const heavy = new Set<PanelId>(catalogue.heavy);
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
        layouts.sizeClass(lastClass, true);
      }
      dock.recover(); dock.condenseTabs(); port.viewport.resize(); schedule();
    }, 120);
  });

  const commands = () => withPreviewSetup(rt, [...buildCommands(rt, theme, view, byId,
    featureViews.flatMap(({ binding, ctx }) => featureCommands(binding, ctx)), layouts), ...panels.flatMap(panel => panel.commands?.() ?? []), ...guidance.commands()]);
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
      // Undo follows focus (view-graph-design.md §3.6): in Camera & light and Preview quality (its Rendering options) it steps the View
      // and lighting history, not the look's.
      if (["lighting", "quality"].some(id => byId.get(id)?.spec.element.contains(document.activeElement))) { rt.dispatch({ kind: shortcut === "redo" ? "view.redo" : "view.undo" }); return; }
      rt.dispatch({ kind: shortcut === "redo" ? "history.redo" : "history.undo" });
    } else if (shortcut === "regions" || shortcut === "regions-back") cycleRegions(root, shortcut === "regions-back");
    else if (shortcut === "guide") { closeMenus(false); openHelp(); }
    else view.openReference();
  });
  header.bindPalette(() => openPalette(commands));
  // The check at start (the host skips it when Settings › Updates turns it off); the service waits until after first paint.
  startupUpdateCheck(rt);
  if (verificationMode(port)) Object.assign(window, { xfStudioShell: { dock, runtime: rt, commands, layouts, preferences: () => port.preferences.snapshot(),
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
      if (!setPreference(port, feedback, { kind: "theme.set", theme: next },
        next === "system" ? `Theme follows the system (${media.matches ? "dark" : "light"})` : `${next === "dark" ? "Dark" : "Light"} theme`)) return;
      preference = next; apply();
    },
  };
}
type Theme = ReturnType<typeof themeController>;

/** A preference change through its capability; a refusal or failure is said plainly, never swallowed (UI-15). */
function setPreference(port: Port, feedback: Feedback, action: Parameters<Port["preferences"]["dispatch"]>[0], announce: string) {
  const allowed = port.preferences.capability(action);
  if (!allowed.available) { feedback.toast("warning", "View", allowed.reason ?? "This preference could not be saved."); return false; }
  try { port.preferences.dispatch(action); }
  catch (error) { feedback.toast("warning", "View", error instanceof Error ? error.message : "This preference could not be saved."); return false; }
  feedback.announce(announce);
  return true;
}

/** View preferences beyond the theme: viewport input hints (persisted, on by default) and research tools (off by default, UI-85). */
function viewPreferences(port: Port, feedback: Feedback) {
  const hints = () => port.preferences.snapshot().inputHints;
  const setHints = (enabled: boolean) => { setPreference(port, feedback, { kind: "inputHints.set", enabled }, enabled ? "Viewport input hints shown" : "Viewport input hints hidden"); };
  const research = () => !!port.preferences.snapshot().researchTools;
  const setResearch = (enabled: boolean) => { setPreference(port, feedback, { kind: "researchTools.set", enabled }, enabled ? "Research tools shown" : "Research tools hidden"); };
  const openReference = () => openInputReference({ hints: { enabled: hints(), set: setHints } });
  return {
    hints, setHints, research, setResearch, openReference,
    items(): MenuItem[] {
      return [{ kind: "heading", label: "Viewports", detail: "Stored with your workspace" },
        { kind: "action", label: "Show input hints", icon: "keyboard", checked: hints(), hint: "Hints in the 3D view and UV map that follow the pointer and the keys you hold",
          run: () => setHints(!hints()) },
        { kind: "action", label: "Keyboard & mouse…", icon: "keyboard", shortcut: shortcutLabel("shell.shortcuts"), run: openReference },
        { kind: "separator" },
        { kind: "action", label: "Show research tools", icon: "activity", checked: research(),
          hint: "Finishes still waiting for a game check, rendering and lighting studies, raw exports, developer IDs and planned features", run: () => setResearch(!research()) }];
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

function shellHeader(rt: StudioRuntime, theme: Theme, view: ViewPrefs, openHelp: () => void, layouts: LayoutController) {
  const port = rt.port;
  // The Modules menu (view-graph-design.md §4.2): the shown modules' names, and a menu to show or hide each.
  const categoryText = h("span");
  const category = h("button", { class: "category", type: "button", "aria-haspopup": "menu", title: "Modules: show or hide parts of the Studio",
    onclick: (event: MouseEvent) => openMenu(moduleMenuItems(rt, view.research()), event.currentTarget as Element,
      { label: "Modules", invoker: event.currentTarget as Element }) }, icon("category"), categoryText);
  const collection = h("span", { class: "crumb-collection" }), preset = h("span", { class: "crumb-preset" });
  const chip = h("span", { class: "chip" });
  const keys = { undo: shortcutLabel("shell.undo"), redo: shortcutLabel("shell.redo"), save: shortcutLabel("shell.save"), palette: shortcutLabel("shell.palette") };
  const undo = button({ label: "Undo", icon: "undo", iconOnly: true, variant: "ghost", title: `Undo (${keys.undo})`, onClick: () => rt.dispatch({ kind: "history.undo" }) });
  const redo = button({ label: "Redo", icon: "redo", iconOnly: true, variant: "ghost", title: `Redo (${keys.redo})`, onClick: () => rt.dispatch({ kind: "history.redo" }) });
  const historyButton = button({ label: "History", icon: "history", iconOnly: true, variant: "ghost", title: `History: every recent change to this preset\n${HISTORY_SCOPE}`,
    onClick: () => rt.dock.reveal("history") });
  const save = button({ label: "Save", icon: "save", title: `Save to library (${keys.save})`, onClick: () => void rt.request({ kind: "save" }) });
  const pkg = button({ label: "Package", icon: "package", variant: "quiet", title: "Open mod package review", onClick: () => rt.dock.reveal("package") });
  const palette = button({ label: "Commands", icon: "command", variant: "ghost", title: `Command palette (${keys.palette})`, onClick: () => {} });
  const helpButton = button({ label: "Help", icon: "help", iconOnly: true, variant: "ghost", title: `Help: tours, answers and shortcuts (${shortcutLabel("shell.help")})`, onClick: openHelp });
  // One place for everything configured (UI-109): the game and mod manager, the saves folder, WolvenKit, appearance and diagnostics.
  const settingsButton = button({ label: "Settings", icon: "settings", iconOnly: true, variant: "ghost",
    title: "Settings: game, mod manager, saves, tools and appearance", onClick: () => rt.settings.open() });
  for (const [anchor, control] of [["header.save", save], ["header.package", pkg], ["header.history", historyButton], ["header.palette", palette], ["header.help", helpButton],
    ["header.settings", settingsButton]] as const)
    rt.anchors.register(anchor, control);
  const panelsButton = button({ label: "Panels", icon: "layout", iconOnly: true, variant: "ghost", menu: true, title: "Panels, modules and views", onClick: event => {
    openMenu([...panelMenuItems(rt, view.research()),
      { kind: "separator" },
      // Which arrangement a reset applies to is the entry's tooltip (C-32: the menu fits a 900 px window, one row per entry). Keyboard &
      // mouse lives in Help, Settings › Appearance and the palette, where people look for it, not among the panels.
      { kind: "action", label: "Reset this layout", icon: "reset", tip: `Resets the ${rt.dock.sizeClass === "wide" ? "wide" : "compact"} arrangement: each window size keeps its own.`,
        run: () => rt.dock.reset() }],
    event.currentTarget as Element, { label: "Panels and layout", invoker: event.currentTarget as Element });
  } });
  // Saved layouts (view-graph-design.md §4.5): the current layout's name, collapsing to its icon in narrow windows.
  const layoutsButton = button({ label: "Layouts", icon: "layouts", variant: "ghost", menu: true, className: "layouts-btn", onClick: event => {
    const anchor = event.currentTarget as Element;
    openMenu(layouts.menuItems(anchor), anchor, { label: "Layouts", invoker: anchor });
  } });
  rt.anchors.register("header.layouts", layoutsButton);
  const themeButton = button({ label: "View preferences", icon: "monitor", iconOnly: true, variant: "ghost", menu: true, onClick: event =>
    openMenu([...themeItems(theme), { kind: "separator" }, ...view.items(), { kind: "separator" },
      { kind: "action", label: "All settings…", icon: "settings", hint: "Game, saves folder, WolvenKit, appearance and diagnostics", run: () => rt.settings.open("appearance") }],
    event.currentTarget as Element,
      { label: "View preferences", invoker: event.currentTarget as Element }) });
  const verify = h("span", { class: "verify-flag", title: "Isolated verification draft and library. Your normal work is untouched.", hidden: true }, "Verification workspace");
  const element = h("header", { class: "shell-header" },
    // The release stage beside the name (release-readiness-audit.md item 22): the first public release is a beta.
    h("div", { class: "brand", "aria-label": "XF Studio beta" }, h("span", { class: "brand-mark", "aria-hidden": "true" }, "XF"), h("span", { class: "brand-name" }, "Studio"),
      Object.assign(badge("Beta", "accent"), { title: "XF Studio is in beta: it may not work on every setup yet. Help › Report a problem… tells us what doesn't." })),
    category,
    // The library chip sits after the crumbs, not inside them, so the names give way before it and it never runs over the verification
    // flag in a crowded header (DESK-06).
    h("nav", { class: "crumbs", "aria-label": "Current document" }, collection, icon("chevronRight"), preset), chip,
    verify,
    h("div", { class: "header-actions" }, h("span", { class: "history-controls", role: "group", "aria-label": "Undo and Redo" }, undo, redo, historyButton), save, pkg, h("span", { class: "divider", "aria-hidden": "true" }), palette, helpButton, settingsButton, panelsButton, layoutsButton, themeButton));
  return {
    element,
    bindPalette(open: () => void) { palette.onclick = open; },
    update(frame: Frame) {
      const shown = frame.toolFilter.modules, names = rt.modules.list.filter(module => shown.includes(module.id)).map(module => module.label);
      setText(categoryText, names.length ? names.join(" · ") : "Modules");
      // The list may end with an ellipsis in a crowded header, so its whole text is the tooltip (I3).
      category.title = names.length ? `${names.join(" · ")}: show or hide parts of the Studio` : "Modules: show or hide parts of the Studio";
      const draft = frame.library.draft;
      setText(collection, draft?.name ?? "Loading…");
      setText(preset, draft?.presets.find(item => item.id === draft.selected)?.name ?? "No preset");
      const state = libraryState(frame);
      setText(chip, state.label); chip.className = `chip ${state.tone}`; chip.title = state.detail;
      const undoCap = port.authoring.capability({ kind: "history.undo" }), redoCap = port.authoring.capability({ kind: "history.redo" });
      const history = port.authoring.history();
      // Name what each would change, and keep the shortcut visible even while unavailable.
      applyCapability(undo, undoCap); undo.title = historyCommandTitle("undo", undoCap, history.undo?.label, keys.undo);
      applyCapability(redo, redoCap); redo.title = historyCommandTitle("redo", redoCap, history.redo?.label, keys.redo);
      setAttr(undo, "aria-label", historyCommandLabel("undo", undoCap, history.undo?.label));
      setAttr(redo, "aria-label", historyCommandLabel("redo", redoCap, history.redo?.label));
      const saveCap = port.authoring.requestCapability({ kind: "save" });
      applyCapability(save, saveCap); save.title = saveCap.available ? `Save to library (${keys.save})` : saveCap.reason ?? "";
      verify.hidden = !frame.status.verification;
      const layout = layouts.label();
      setButtonLabel(layoutsButton, layout.name);
      layoutsButton.title = layout.title; layoutsButton.dataset.title = layout.title; setAttr(layoutsButton, "aria-label", layout.accessible);
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
      // One save status (UI-89): the header's library chip says whether your work is saved; the draft's own autosave shows here
      // only when it has a problem to tell you about.
      const save = frame.status.workspace, problem = save.kind !== "saved" && save.kind !== "idle";
      workspace.dataset.tone = save.kind;
      workspace.hidden = !problem;
      setText(workspace, problem ? `▲ ${save.message}` : "");
      workspace.title = problem ? save.message : "";
      const library = frame.library;
      const last = rt.feedback.log.at(-1);
      const message = library.busy && library.progress?.phase === "working" ? library.progress.message : last?.message ?? "Ready";
      setText(activity, message); activity.dataset.tone = library.busy ? "progress" : last?.tone ?? "info";
      const preview = frame.preview;
      setText(gesture, preview.gesture ? "Gesture in progress · Esc cancels" : preview.control ? "Adjusting · Esc restores" : "");
      const readiness = readinessText(frame);
      ready.dataset.phase = readiness.phase;
      setText(ready, readiness.label);
      ready.title = frame.readiness.error ?? frame.viewport.head.error ?? readiness.detail;
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

/** Module groups in the Modules menu, in order. */
const MODULE_GROUPS: Record<StudioModule["group"], string> = { character: "Character", world: "World", assets: "Assets", tools: "Tools" };

/**
 * The Modules menu (view-graph-design.md §4.2): one row per module, grouped, each a checkbox with its stage (an Early access stage tag) and what it adds. Hiding
 * one keeps its work and exports; its panels and view tools leave until it is shown again.
 */
function moduleMenuItems(rt: StudioRuntime, research: boolean): MenuItem[] {
  const shown = rt.shownModules(), items: MenuItem[] = [{ kind: "heading", label: "Modules", detail: "Show or hide; your work and exports are kept either way" }];
  for (const [group, label] of Object.entries(MODULE_GROUPS)) {
    const members = rt.modules.list.filter(module => module.group === group);
    const planned = plannedShown(rt.port.views.plannedModules(), research).filter(module => module.group === group);
    if (!members.length && !planned.length) continue;
    items.push({ kind: "heading", label });
    for (const module of members) items.push({ kind: "action", label: module.label, icon: isIconName(module.icon) ? module.icon : "category",
      checked: shown.includes(module.id), stage: module.stage, hint: `${module.description} ${moduleAdds(rt, module)}`,
      run: () => rt.modules.set(module.id, !shown.includes(module.id)) });
    // Planned modules (ui-copy-and-layout-review.md §6), only with research tools on (coming-soon.ts): each says what it will let the person do.
    for (const module of planned) items.push({ kind: "action", label: module.label, icon: isIconName(module.icon) ? module.icon : "category",
      tag: "Soon", capability: { available: false, reason: `Coming soon: ${module.comingSoon}` }, run: () => {} });
  }
  return items;
}
/** "Adds 6 panels and 2 view tools", from the module's contributions. */
function moduleAdds(rt: StudioRuntime, module: StudioModule) {
  const panels = rt.modules.panels(module).length;
  const tools = rt.port.views.tools(undefined, { modules: [module.id], research: true }).filter(tool => tool.module === module.id).length;
  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  return `Adds ${[panels ? count(panels, "panel") : "", tools ? count(tools, "view tool") : ""].filter(Boolean).join(" and ") || "nothing yet"}.`;
}
/**
 * The Panels menu (the header's top-right flyout): the shell's panels, then each module's panels under its own visibility toggle,
 * each with its state (open, collapsed, closed, or parked while its module is hidden), then the views. Derived from the view
 * catalogue, the module registry and the view graph; nothing is listed by hand.
 */
function panelMenuItems(rt: StudioRuntime, research: boolean): MenuItem[] {
  const dock = rt.dock, shown = rt.shownModules();
  const row = (id: string): MenuItem => {
    const meta = rt.views.meta[id], state = dock.panelState(id);
    const module = rt.modules.list.find(item => rt.modules.panels(item).includes(id));
    // One row per panel (C-32): the tick says it's open, and what the panel is lives in the row's tooltip, so the menu fits the
    // window. Only a state the tick can't show gets a line: collapsed. A parked panel sits under its hidden module's unticked switch,
    // and its tooltip says that choosing it shows the module too.
    const tip = [meta?.description, state === "parked" ? `Choosing it shows ${module?.label ?? "its module"} too.` : ""].filter(Boolean).join(" ");
    return { kind: "action", label: meta?.title ?? id, icon: meta?.icon ?? "dot", checked: state === "open" || state === "collapsed",
      ...(tip ? { tip } : {}), ...(state === "collapsed" ? { hint: "Collapsed" } : {}),
      // A parked panel is one choice away (UI-144): choosing it shows its module again, which puts its panels back where they were,
      // then brings this one forward.
      run: () => {
        if (state === "parked" && module) { rt.modules.set(module.id, true); dock.reveal(id); }
        else if (state === "collapsed") dock.reveal(id);
        else if (id === SETTINGS_PANEL && state === "closed") rt.settings.open();
        else dock.toggle(id);
      } };
  };
  const owned = new Set(rt.modules.list.flatMap(module => rt.modules.panels(module)));
  const items: MenuItem[] = [{ kind: "heading", label: "Panels" },
    ...rt.views.panels.filter(panel => !owned.has(panel.id)).map(panel => row(panel.id))];
  for (const module of rt.modules.list) {
    const on = shown.includes(module.id);
    // The module's group: its heading, its visibility toggle, then its panels.
    // Its switch heads the group: the switch's name says the module, its tick whether it is shown, and what showing it does is its
    // tooltip, so a module adds no heading or lines of its own (C-32).
    items.push({ kind: "separator" },
      { kind: "action", label: `Show ${module.label}`, icon: isIconName(module.icon) ? module.icon : "category", checked: on, stage: module.stage,
        tip: on ? "Turn off to hide its panels and view tools; your work is kept" : "Its panels are parked where they were and come back there",
        run: () => rt.modules.set(module.id, !on) },
      ...rt.modules.panels(module).map(row));
  }
  // The views (view-graph-design.md §3.4): each 3D view and its panel, then, only with research tools on, New view and Duplicate view
  // (shared camera) as Coming soon until P4 registers their actions (coming-soon.ts).
  const graph = rt.port.views.snapshot();
  const live = liveFeatures(rt.port);
  const upcoming = (["viewsNew", "viewsDuplicate"] as const).flatMap(id => { const entry = comingSoon(id, live, research);
    return entry ? [{ kind: "action" as const, label: entry.label, icon: "plus" as const, tag: "Soon", capability: { available: false, reason: entry.reason }, run: () => {} }] : []; });
  // One 3D view and nothing planned: its row would do what the 3D view panel's row above does, so the section isn't listed (C-32).
  if (graph && (graph.views.length > 1 || upcoming.length)) items.push({ kind: "separator" }, { kind: "heading", label: "Views", detail: `${graph.views.length} 3D view${graph.views.length === 1 ? "" : "s"}` },
    ...graph.views.map(entry => { const panel = entry.panel;
      return { kind: "action" as const, label: entry.title ?? rt.views.meta[panel]?.title ?? entry.id, icon: "head" as const,
        hint: `${entry.id === graph.focused ? "Focused · " : ""}${entry.sceneKind === "character" ? "Your V" : entry.sceneKind}${entry.shared.length ? ` · shares ${entry.shared.join(", ")}` : ""}`,
        run: () => dock.reveal(panel) }; }), ...upcoming);
  return items;
}

/**
 * Palette hygiene (release-readiness-audit.md item 8): while the 3D view isn't ready, the commands that wait for it (refused as
 * `asset_unavailable`, or with the head's own words) are not listed one by one with the same reason; one "Set up the 3D preview…"
 * entry takes their place, at the first one's position, and runs the head's next step (or opens the setup card). Their keywords go
 * with it, so searching for "idle" or "lighting" still finds the way there.
 */
export function withPreviewSetup(rt: Pick<StudioRuntime, "port" | "feedback" | "changed">, commands: Command[]): Command[] {
  const port = rt.port, head = port.viewport.snapshot().head;
  if (head.phase === "ready") return commands;
  const reasons = new Set([head.message, head.error].filter((text): text is string => !!text));
  const waits = (command: Command) => {
    const capability = command.capability() as Capability & { code?: string };
    return !capability.available && (capability.code === "asset_unavailable" || (!!capability.reason && reasons.has(capability.reason)));
  };
  const waiting = new Set(commands.filter(waits));
  if (!waiting.size) return commands;
  // The setup's state as it is when the entry is asked or run, not when the palette opened (UI-164): the step may have moved on.
  const now = () => {
    const setup = port.previewSetup.snapshot();
    return { open: setup.card.open, next: setup.head.next?.action ?? { kind: "previewSetup.show" as const } };
  };
  const entry: Command = { id: "preview.setup", title: "Set up the 3D view…", group: "View", icon: "head",
    keywords: `3d preview view head game folder wolvenkit ${[...waiting].map(command => `${command.title} ${command.keywords ?? ""}`).join(" ").toLowerCase()}`,
    // Showing the card while it already shows is refused as "already showing": the card is the answer, so the entry stays available.
    capability: () => { const { open, next } = now(); return open && next.kind === "previewSetup.show" ? { available: true } : port.previewSetup.capability(next); },
    run: () => {
      const { open, next } = now();
      if (open && next.kind === "previewSetup.show") { document.getElementById("preview-card-title")?.focus(); return; }
      void port.previewSetup.dispatch(next).then(outcome => { if (!outcome.ok) rt.feedback.toast("warning", "3D view", outcome.message); rt.changed(); });
    } };
  const first = commands.findIndex(command => waiting.has(command));
  return [...commands.slice(0, first).filter(command => !waiting.has(command)), entry, ...commands.slice(first).filter(command => !waiting.has(command))];
}

/** The palette's commands: the platform's own, with each feature view's commands after the platform's Edit entries. */
function buildCommands(rt: StudioRuntime, theme: Theme, view: ViewPrefs, panels: Map<PanelId, PanelController>, features: Command[], layouts: LayoutController): Command[] {
  const port = rt.port;
  const act = (id: string, title: string, group: string, action: StudioAction, extra: Partial<Command> = {}): Command => ({
    id, title, group, ...extra,
    capability: () => port.authoring.capability(action),
    run: () => { rt.dispatch(action); },
  });
  const file = (id: string, title: string, group: string, action: StudioFileAction, extra: Partial<Command> = {}): Command => ({
    id, title, group, ...extra, capability: () => port.files.capability(action), run: () => void rt.file(action) });
  const request = (id: string, title: string, group: string, value: Parameters<StudioRuntime["request"]>[0], extra: Partial<Command> = {}): Command => ({
    id, title, group, ...extra, capability: () => port.authoring.requestCapability(value), run: () => void rt.request(value) });
  const always = { capability: () => ({ available: true }) };
  const preview = port.authoring.previewState(), motion = preview.motion, history = port.authoring.history(), character = preview.character;
  const views = port.views.snapshot() ?? { history: { depth: 0, redoDepth: 0 } as { undo?: string; redo?: string; depth: number; redoDepth: number } };
  // Research tools (UI-85) are offered only once the person turns them on.
  const research = (commands: Command[]) => view.research() ? commands : [];
  return [
    act("undo", historyCommandLabel("undo", port.authoring.capability({ kind: "history.undo" }), history.undo?.label), "Edit", { kind: "history.undo" },
      { icon: "undo", shortcut: shortcutLabel("shell.undo"), keywords: "undo back" }),
    act("redo", historyCommandLabel("redo", port.authoring.capability({ kind: "history.redo" }), history.redo?.label), "Edit", { kind: "history.redo" },
      { icon: "redo", shortcut: shortcutLabel("shell.redo"), keywords: "redo ctrl+y forward" }),
    { id: "history.open", title: "Show History (every recent change)", group: "Edit", icon: "history", keywords: "undo redo steps changes go back",
      ...always, run: () => rt.dock.reveal("history") },
    act("preset.add", "Add preset", "Edit", { kind: "preset.edit", command: { kind: "add" } }, { icon: "plus" }),
    act("preset.restore", "Restore removed preset", "Edit", { kind: "preset.edit", command: { kind: "restore" } }, { icon: "reset" }),
    ...features,
    request("library.save", "Save to library", "Library", { kind: "save" }, { icon: "save", shortcut: shortcutLabel("shell.save") }),
    request("library.copy", "Save as new collection", "Library", { kind: "saveCopy" }, { icon: "duplicate", keywords: "copy" }),
    // The saved list updates itself (release-readiness-audit.md item 13), so there is no Refresh command.
    file("library.recover", "Recover previous draft", "Library", { kind: "collection.recover" }, { icon: "undo" }),
    { id: "collection.import", title: "Import collection…", group: "Files", icon: "import", capability: () => port.files.capability({ kind: "collection.import" }),
      run: () => importCollection(rt, { x: Math.round(window.innerWidth / 2 - 170), y: 120 }) },
    file("collection.export", "Export collection (saves first)", "Files", { kind: "collection.export" }, { icon: "export" }),
    ...research([file("collection.plan", "Export compiler plan (saves first; not a mod)", "Research", { kind: "collection.plan" }, { icon: "export", keywords: "build plan" })]),
    file("recipe.import", "Import recipe as preset…", "Files", { kind: "recipe.import" }, { icon: "import" }),
    file("recipe.export", "Export preset recipe", "Files", { kind: "recipe.export" }, { icon: "export" }),
    // A raw layer texture and the saved appearance record are research outputs (release-readiness-audit.md item 6).
    ...research([file("mask.export", "Export selected layer mask (2048²)", "Research", { kind: "mask.export" }, { icon: "export" }),
      file("savedV.export", "Export appearance data", "Research", { kind: "savedV.export" }, { icon: "export" })]),
    file("package.check", "Check mod export", "Mod package", { kind: "package.check" }, { icon: "check" }),
    file("package.build", "Build mod files", "Mod package", { kind: "package.build" }, { icon: "package", keywords: "archive build" }),
    file("savedV.import", "Load V from a save…", "Character", { kind: "savedV.import" }, { icon: "character" }),
    file("characterPreset.import", "Load a character preset…", "Character", { kind: "characterPreset.import" }, { icon: "import", keywords: "creator preset v load" }),
    file("characterPreset.export", "Save a character preset…", "Character", { kind: "characterPreset.export" }, { icon: "export", keywords: "creator preset v save" }),
    act("character.useDefault", "Show the default feminine V", "Character", { kind: "character.useDefault", bodyGender: "female" },
      { icon: "character", keywords: "default v creator female woman feminine" }),
    act("character.useDefault.male", "Show the default masculine V", "Character", { kind: "character.useDefault", bodyGender: "male" },
      { icon: "character", keywords: "default v creator male man masculine" }),
    act("character.setOwnMakeup", character?.ownMakeup === false ? "Show my V's own makeup" : "Hide my V's own makeup", "Character",
      { kind: "character.setOwnMakeup", shown: character?.ownMakeup === false }, { icon: "eye", keywords: "makeup off on show hide creator options" }),
    act("character.resetAll", "Reset every creator change", "Character", { kind: "character.resetAll" }, { icon: "reset", keywords: "creator options undo back to my v" }),
    act("character.undo", character?.undo ? `Undo in the Character panel: ${character.undo}` : "Undo in the Character panel", "Character", { kind: "character.undo" },
      { icon: "undo", keywords: "character creator clothing undo" }),
    act("character.redo", character?.redo ? `Redo in the Character panel: ${character.redo}` : "Redo in the Character panel", "Character", { kind: "character.redo" },
      { icon: "redo", keywords: "character creator clothing redo" }),
    ...(character?.clothing?.states ?? []).map(state => act(`character.clothing.${state.value}`, `Clothes in the 3D view: ${state.label}`, "Character",
      { kind: "character.setClothing", state: state.value }, { icon: "body", keywords: "clothing clothes outfit underwear headwear" })),
    act("character.clearPreparedFiles", "Clear prepared game files", "Character", { kind: "character.clearPreparedFiles" }, { icon: "trash", keywords: "cache disk space prepared files" }),
    // The view's tools (view-graph-design.md §3.9), derived like its toolbar; the scene's motion is offered in Motion below.
    // Viewport keys work while that viewport has focus; the palette names the scope.
    ...port.views.tools(undefined, rt.toolFilter()).filter(tool => tool.state !== "scene").map(tool => act(`tool.${tool.id}`,
      tool.kind === "toggle" ? `${tool.on ? "Hide" : "Show"} ${tool.label.toLowerCase()}` : tool.label, tool.placement === "research" ? "Research" : "View",
      tool.action, { icon: isIconName(tool.icon) ? tool.icon : "dot", ...(tool.binding ? { shortcut: `${shortcutLabel(tool.binding)} in the 3D view` } : {}),
        ...(tool.keywords ? { keywords: tool.keywords } : {}) })),
    act("camera.back", "Camera: back to where it was", "View", { kind: "camera.back" }, { icon: "undo", keywords: "camera previous position jump return" }),
    act("camera.forward", "Camera: forward again", "View", { kind: "camera.forward" }, { icon: "redo", keywords: "camera next position jump" }),
    act("view.undo", views.history.undo ? `Undo view or lighting change: ${views.history.undo}` : "Undo view or lighting change", "View", { kind: "view.undo" },
      { icon: "undo", keywords: "undo light lighting camera display view" }),
    act("view.redo", views.history.redo ? `Redo view or lighting change: ${views.history.redo}` : "Redo view or lighting change", "View", { kind: "view.redo" },
      { icon: "redo", keywords: "redo light lighting camera display view" }),
    // Modules (view-graph-design.md §4.2): shown or hidden, never exclusive.
    ...rt.modules.list.map(module => { const shown = rt.shownModules().includes(module.id); return { id: `module.${module.id}`,
      title: `${shown ? "Hide" : "Show"} ${module.label}`, group: "Modules", icon: "category" as const, keywords: `module ${module.description}`,
      ...always, run: () => rt.modules.set(module.id, !shown) }; }),
    act("preview.body", preview.preview?.body === false ? "Show the body" : "Hide the body", "View", { kind: "preview.setBody", enabled: preview.preview?.body === false },
      { icon: "body", keywords: "body arms hands feet nails tattoos visibility 3d view" }),
    // The 3D view's switches (UI-91): the same actions as the Character panel's.
    ...(["brows", "lashes"] as const).map(detail => act(`preview.${detail}`, `${preview.preview?.[detail] ? "Hide" : "Show"} ${detail === "brows" ? "eyebrows" : "eyelashes"}`,
      "View", { kind: "preview.setDetail", detail, enabled: !preview.preview?.[detail] }, { icon: "eye", keywords: "3d view visibility brows lashes" })),
    act("preview.hair", preview.preview?.hair ? "Hide hair" : "Show hair", "View", { kind: "preview.setHair", enabled: !preview.preview?.hair }, { icon: "eye", keywords: "3d view visibility hair" }),
    act("preview.piercings", preview.preview?.piercings ? "Hide piercings" : "Show piercings", "View", { kind: "preview.setPiercings", enabled: !preview.preview?.piercings },
      { icon: "eye", keywords: "3d view visibility piercings earrings" }),
    ...(["both", "single", "other", "fit"] as const).map(command => ({ id: `uv.${command}`, title: `UV: ${{ both: "Both eyes", single: "Single eye", other: "Other eye", fit: "Fit shape" }[command]}`,
      group: "View", icon: "uv" as const, shortcut: `${shortcutLabel(`uv.${command}`)} in UV`,
      capability: () => port.viewport.uvCommandCapability(command), run: () => { port.viewport.uvCommand(command); } })),
    // One entry per lighting setup (the one flat list), and the shown setup's own actions: a new setup from it, and Reset for the person's own.
    ...(preview.lightingSetups?.setups ?? []).map(entry => act(`lighting.setup.${entry.id}`, `Lighting: ${entry.label}`, "View",
      { kind: "preview.selectLightingSetup", setup: entry.id }, { icon: "lighting",
        keywords: `lighting setup light ${entry.builtIn ? "built-in" : "my own custom"} ${entry.title}${entry.id === "creator" ? " creator mirror game lut grade compare" : ""}` })),
    ...(preview.lightingSetups ? [act("lighting.setup.new", `Lighting: new setup from ${preview.lightingSetups.shown.label}`, "View",
      { kind: "preview.createLightingSetup", from: preview.lightingSetups.shown.id }, { icon: "lighting", keywords: "lighting setup new copy duplicate template my own" })] : []),
    ...(preview.lightingSetups && !preview.lightingSetups.shown.builtIn ? [act("lighting.setup.reset",
      `Lighting: reset ${preview.lightingSetups.shown.label} to ${preview.lightingSetups.shown.baseLabel}`, "View",
      { kind: "preview.resetLightingSetup", setup: preview.lightingSetups.shown.id }, { icon: "lighting", keywords: "lighting setup reset default restore" })] : []),
    act("camera.creatorFace", "Camera: character-creator face page", "View", { kind: "camera.creatorFraming", page: "face" }, { icon: "front", keywords: "creator 15 fov eyes brows lashes" }),
    act("camera.creatorHair", "Camera: character-creator hair page", "View", { kind: "camera.creatorFraming", page: "hair" }, { icon: "front", keywords: "creator 15 fov hair skin" }),
    // Research tools (UI-85): the creator lighting calibration, only when asked for.
    ...research([...([["isotropic", "lumens ÷ 4π"], ["cone", "spread over the cone"]] as const).map(([value, label]) =>
      act(`lighting.creator.intensity.${value}`, `Creator lighting calibration: intensity ${label}`, "Research",
        { kind: "preview.setCreatorLighting", key: "intensity", value }, { icon: "lighting", keywords: "creator calibration lumen candela" })),
    ...([["full", "full cone angles"], ["half", "half cone angles"]] as const).map(([value, label]) =>
      act(`lighting.creator.cone.${value}`, `Creator lighting calibration: ${label}`, "Research",
        { kind: "preview.setCreatorLighting", key: "cone", value }, { icon: "lighting", keywords: "creator calibration spot angle" })),
    ...([true, false] as const).map(enabled => act(`lighting.creator.shadows.${enabled ? "on" : "off"}`,
      `Creator lighting calibration: shadows ${enabled ? "on" : "off"}`, "Research",
      { kind: "preview.setCreatorShadows", enabled }, { icon: "lighting", keywords: "creator calibration shadow nose rim" })),
    act("lighting.creator.reset", "Creator lighting calibration: restore defaults", "Research",
      { kind: "preview.resetCreatorLighting" }, { icon: "lighting", keywords: "creator calibration reset default exposure" })]),
    // Rendering options (the Preview quality panel's Rendering group, a research study): each switch both ways, and the Hair look's two ends.
    ...research([...([true, false] as const).map(enabled => act(`rendering.scatter.${enabled ? "on" : "off"}`, `Rendering: skin scattering ${enabled ? "on" : "off"}`, "Research",
      { kind: "preview.setSkinScatter", enabled }, { icon: "quality", keywords: "skin scatter subsurface sss soft shadow warm" })),
    ...([true, false] as const).map(enabled => act(`rendering.shadows.${enabled ? "on" : "off"}`, `Rendering: face shadows ${enabled ? "on" : "off"}`, "Research",
      { kind: "preview.setFaceShadows", enabled }, { icon: "quality", keywords: "shadow maps nose face lights" })),
    ...([[0, "crisp"], [1, "game-like"]] as const).map(([value, label]) => act(`rendering.hairLook.${value ? "game" : "crisp"}`,
      `Rendering: hair look ${label}`, "Research", { kind: "preview.setHairLook", value }, { icon: "quality", keywords: "hair strands soft thick taa dlss coverage" }))]),
    ...([512, 1024, 2048, 4096] as const).map(size => act(`quality.${size}`, `Preview quality: ${size === 512 ? "512" : `${size / 1024}K`}`, "View", { kind: "quality.set", size }, { icon: "quality" })),
    act("quality.rebuild", "Preview quality: Try again", "View", { kind: "quality.rebuild" }, { icon: "refresh", keywords: "rebuild retry preview textures try again" }),
    act("idle", motion?.idle ? "Stop the game idle" : "Play the game idle", "Motion", { kind: "motion.setIdle", enabled: !motion?.idle }, { icon: "motion" }),
    act("idle.pause", motion?.idlePaused ? "Resume idle" : "Pause idle", "Motion", { kind: "motion.setPaused", paused: !motion?.idlePaused }, { icon: "pause" }),
    act("blink.play", motion?.blinkPlaying ? "Stop blink" : "Play blink", "Motion", { kind: "motion.playBlink", playing: !motion?.blinkPlaying }, { icon: "play", keywords: "blink eyes lids" }),
    // Settings (UI-109): opened by name, and by what people look for in it. Its generic "Open Settings" entry is left out below.
    { id: "settings.open", title: "Settings", group: "Settings", icon: "settings",
      keywords: "preferences options configure setup game folder mod manager wolvenkit saves theme appearance diagnostics privacy", ...always, run: () => rt.settings.open() },
    { id: "settings.game", title: "Game folder and mod manager (Settings › Game)", group: "Settings", icon: "settings",
      keywords: "game folder cyberpunk install mod organizer mo2 vortex profile mod manager eye plate head setup tools", ...always, run: () => rt.settings.open("game") },
    { id: "settings.saves", title: "Where are my saves? (Settings › Saves)", group: "Settings", icon: "folder",
      keywords: "saves folder save files saved games location explorer choose", ...always, run: () => rt.settings.open("saves") },
    // WolvenKit's setup step sits beside the Game line that says it's needed (UI-161); your own copy is named in Tools.
    { id: "settings.tools", title: "WolvenKit (Settings › Game)", group: "Settings", icon: "settings",
      keywords: "wolvenkit cli tools download path set up", ...always, run: () => rt.settings.open("game") },
    ...[...panels.values()].filter(panel => panel.spec.id !== SETTINGS_PANEL && panel.spec.id !== "help").map(panel => ({ id: `panel.${panel.spec.id}`, title: `Go to ${panel.spec.title}`, group: "Panels",
      icon: panel.spec.icon, keywords: panel.spec.description, ...always, run: () => rt.dock.reveal(panel.spec.id) })),
    ...[...panels.values()].filter(panel => rt.dock.isOpen(panel.spec.id)).map(panel => ({ id: `panel.float.${panel.spec.id}`, title: `Float ${panel.spec.title}`,
      group: "Layout", icon: "float" as const, ...always, run: () => rt.dock.float(panel.spec.id) })),
    // Collapse keeps a group's tab bar and gives its space to the neighbours; saved with the layout.
    ...[...panels.values()].filter(panel => rt.dock.isOpen(panel.spec.id)).map(panel => { const collapsed = rt.dock.isCollapsed(panel.spec.id), blocked = rt.dock.collapseBlocked(panel.spec.id);
      return { id: `panel.collapse.${panel.spec.id}`, title: `${collapsed ? "Expand" : "Collapse"} ${panel.spec.title}`, group: "Layout",
        icon: (collapsed ? "chevronRight" : "chevronDown") as "chevronRight", keywords: "collapse expand fold minimise header",
        capability: () => collapsed || !blocked ? { available: true } : { available: false, reason: blocked }, run: () => rt.dock.toggleCollapse(panel.spec.id) }; }),
    { id: "layout.reset", title: "Reset to factory layout", group: "Layout", icon: "reset", keywords: "reset layout default factory", ...always, run: () => layouts.resetFactory() },
    ...layouts.commands(),
    { id: "theme.system", title: `Theme: match system (${theme.system})`, group: "Appearance", icon: "monitor", ...always, run: () => theme.set("system") },
    { id: "theme.light", title: "Theme: light", group: "Appearance", icon: "sun", ...always, run: () => theme.set("light") },
    { id: "theme.dark", title: "Theme: dark", group: "Appearance", icon: "moon", ...always, run: () => theme.set("dark") },
    { id: "view.hints", title: view.hints() ? "Hide input hints" : "Show input hints", group: "View", icon: "keyboard",
      keywords: "shortcut hints tooltips status", ...always, run: () => view.setHints(!view.hints()) },
    { id: "view.research", title: view.research() ? "Hide research tools" : "Show research tools", group: "View", icon: "activity",
      keywords: "research calibration glitter shimmer finish rendering scattering shadows hair look normal map mask appearance data model study compiler plan developer ids advanced",
      ...always, run: () => view.setResearch(!view.research()) },
    { id: "help.about", title: "About XF Studio", group: "Help", icon: "info", keywords: "version licence license update data folder",
      capability: () => port.about.capability(), run: () => port.about.open() },
    // Localhost only (the desktop app leaves it out): open the installed desktop app, or how to get it.
    ...(port.desktopApp.offered() ? [(() => { const entry = desktopAppEntry(port.desktopApp.snapshot());
      return { id: "help.desktopApp", title: entry.label, group: "Help", icon: "monitor" as const, keywords: "desktop app windows install setup download installer",
        ...always, run: () => { if (entry.opens) void openDesktopApp(rt); else openDesktopAppSheet(rt); } }; })()] : []),
    { id: "help.shortcuts", title: "Keyboard & mouse", group: "Help", icon: "keyboard", shortcut: shortcutLabel("shell.shortcuts"),
      keywords: "shortcuts keys bindings gestures", ...always, run: () => view.openReference() },
    // A way to learn about updates (release-readiness-audit.md item 22): checks now and says what it found, with the releases page.
    { id: "help.updates", title: "Check for updates", group: "Help", icon: "refresh", keywords: "update new version release download latest beta github",
      capability: () => port.updates.capability({ kind: "updates.check" }), run: () => void checkForUpdatesNow(rt, true) },
    { id: "help.report", title: "Report a problem…", group: "Help", icon: "warning", keywords: "bug issue error crash diagnostics log github",
      capability: () => port.diagnostics.capability({ kind: "diagnostics.prepareReport" }), run: () => { openReportDialog(rt, null); } },
    ...(["deep", "normal"] as const).filter(mode => (port.diagnostics.snapshot().mode?.mode ?? "normal") !== mode).map(mode => ({
      id: `help.diagnosticMode.${mode}`, title: mode === "deep" ? "Turn diagnostic mode on (more detail for a day)" : "Turn diagnostic mode off", group: "Help",
      icon: "activity" as const, keywords: "diagnostics verbose detail log trace", capability: () => port.diagnostics.capability({ kind: "diagnostics.setMode", mode }),
      run: () => void port.diagnostics.dispatch({ kind: "diagnostics.setMode", mode }).then(result =>
        result.ok ? rt.feedback.record("info", "Diagnostics", result.message) : rt.feedback.toast("warning", "Diagnostics", result.message)) })),
  ];
}

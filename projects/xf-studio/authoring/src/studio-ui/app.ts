import { viewCatalogue } from "./views/contribution";
import { withEmptyChoices } from "./panels/empty-choices";
import { tabViews, viewPanelEntries, viewPanelIds, ViewPanels } from "./panels/view-panels";
import { allowsNativeTextMenu } from "./context-menu";
import { checkForUpdatesNow, startupUpdateCheck } from "./update-check";
import { plannedShown } from "./coming-soon";
import type { PresentationAction } from "../app/studio-presentation";
import type { PresentationFileAction } from "../app/studio-presentation";
import { effectiveTheme, type ThemePreference } from "../app/ui-preferences";
import { shortcutLabel } from "../app/input-bindings";
import { openInputReference, openPalette, type Command } from "./commands";
import { studioShortcut } from "./shortcuts";
import { applyCapability, badge, button } from "./controls";
import { installReasonTips } from "./reason-tip";
import { installHelpTips } from "./help-tip";
import { DockView } from "./dock/dock-view";
import type { PanelId } from "./dock/layout";
import { defaultDockStateFor, restoreDockPreference, serializeDockState } from "./dock/persist";
import type { StudioModule } from "../platform/api";
import { h, isTextInput, setAttr, setText } from "./dom";
import { markReadOnly } from "./read-only-sweep";
import { Feedback } from "./feedback";
import { icon, isIconName } from "./icons";
import { sizeClassFor } from "./layout-defaults";
import { layoutTabs } from "./layout-tabs";
import { closeMenus, openMenu, type Capability, type MenuItem } from "./menu";
import { importCollection, libraryState, type PanelController } from "./panels/collection";
import { HISTORY_SCOPE, historyCommandLabel, historyCommandTitle } from "./history-model";
import { previewSetupCard } from "./preview-setup-card";
import { isAnchorId, panelAnchor } from "./guidance/anchors";
import { mountGuidance, type GuidanceController } from "./guidance/controller";
import type { ViewComposition, ViewContext, ViewPaneFactory } from "./views/panels";
import { featureCommands, featureViewContext, moduleViewContext } from "./views/feature-context";
import type { FeatureViewContext, ModuleViewContext } from "./views/feature-view";
import { Frame, StudioRuntime, type Port } from "./runtime";
import { desktopAppEntry, openDesktopApp, openDesktopAppSheet } from "./guidance/desktop-app-sheet";
import { openReportDialog } from "./diagnostics/report-dialog";
import { readinessText } from "./readiness-text";
import { SETTINGS_PANEL, type SettingsPart, type SettingsSection } from "./settings-sections";
import { bindViewState, PreferenceViewState } from "./view-state";
import { flushScrollMemories } from "./scroll-anchor";
import { HeaderFit } from "./header-fit";
import { BACKUP_PENDING, BACKUP_STORAGE_FULL, LIBRARY_CHIP_WIDEST, MISSING_SAVE, RESTORING, RESTORING_LONG, RESTORING_UNCONFIRMED, UNPROTECTED } from "./notice-text";
import { EmptyChoices, progressBar, WorkspaceNotice, type WorkspaceNoticeAction, type WorkspaceNoticeState } from "./components";

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
  const catalogue = { ...views.catalogue, panels: [...views.catalogue.panels], ids: [...views.catalogue.ids], meta: { ...views.catalogue.meta } };
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
  const modules = [...port.views.modules()];
  const moduleOfOwner = (owner: string) => modules.find(module => (module.feature ?? module.id) === owner);
  const moduleOfPanel = (panel: PanelId) => { const entry = catalogue.panels.find(item => item.id === panel); return entry ? moduleOfOwner(entry.owner) : undefined; };
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
  /**
   * The live catalogue (experiment 044 P2-iii-b): the composition's panels with the 3D view's entry (`head`) replaced by one entry per view
   * of the shown tab (`head` for the main view, `view.<id>` otherwise, in graph order), then the optional experiments' panels. The dock's
   * restore and factory home read it, so a view's panel is placed where its arrangement keeps it, or beside the other 3D views.
   */
  const headEntry = views.catalogue.panels.find(panel => panel.id === "head");
  let viewEntries: typeof catalogue.panels = [], extraEntries: typeof catalogue.panels = [];
  const rebuildCatalogue = () => {
    catalogue.panels.splice(0, catalogue.panels.length, ...views.catalogue.panels.flatMap(panel => panel.id === "head" ? viewEntries : [panel]), ...extraEntries);
    catalogue.ids.splice(0, catalogue.ids.length, ...catalogue.panels.map(panel => panel.id));
    for (const id of Object.keys(catalogue.meta)) if (!catalogue.ids.includes(id)) delete catalogue.meta[id];
    for (const panel of catalogue.panels) catalogue.meta[panel.id] ??= { title: panel.title, icon: panel.icon, description: panel.description };
  };
  const isViewPane = (id: PanelId) => id === "head" || viewEntries.some(entry => entry.id === id);
  // Every panel comes from a view contribution (the shell's and each feature's), in catalogue order; the 3D views' panes come from the
  // view panes' owner below.
  const panels: PanelController[] = catalogue.panels.filter(({ id }) => !isViewPane(id)).map(({ id, owner }) => {
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
  }).map(panel => catalogue.context(panel.spec.id).kind === "profile" ? panel : withEmptyChoices(rt, panel));
  const byId = new Map(panels.map(panel => [panel.spec.id, panel]));
  const help = byId.get("help") as PanelController & { focusSearch?(): void; openTopic?(id: string): void };
  // A view's panel ID (`view.<id>`) need not be an anchor's form; only the panels a tour can name are anchors.
  const anchorPanel = (panel: PanelController) => isAnchorId(panelAnchor(panel.spec.id)) ? rt.anchors.register(panelAnchor(panel.spec.id), panel.spec.element) : () => {};
  for (const panel of panels) anchorPanel(panel);
  /**
   * A pane per 3D view of the shown tab (panels/view-panels.ts): made and withdrawn as the tab's views change, the canvas in the pane that
   * holds the picture. The dock is made below, so the panes' owner reaches it late.
   */
  let dockRef: DockView | undefined;
  const paneAnchors = new Map<PanelController, () => void>();
  const viewPanes = new ViewPanels({
    instances: { controllers: () => panels, instance: panel => port.panels.instance(panel) },
    arrangement: () => ({ tab: port.focus.targets().tab || undefined, layout: port.tabs?.dock() ?? null }),
    opening: () => port.tabs?.snapshot().opening,
    openView: (panel, arrangement, focus) => dock.openView(panel, arrangement, focus),
    save: (tab, state) => {
      // View-panel reconciliation also saves on load/resize. A read-only window may arrange its
      // local view, but must neither persist that automatic arrangement nor toast its refusal.
      const lease = port.status.snapshot().lease;
      if (!tab || (lease && !lease.writable)) return;
      const action = { kind: "tabs.arrange" as const, tab, layout: serializeDockState(state) }, allowed = port.authoring.capability(action);
      if (allowed.available) {
        const result = port.authoring.dispatch(action);
        if (!result.ok) feedback.toast("warning", "Layout", result.message);
      } else feedback.toast("warning", "Layout", allowed.reason ?? "This layout could not be saved.");
    },
    restore: layout => dock.load(restoreDockPreference(layout, dock.area(), catalogue, [], viewPanelIds(port.views.snapshot()), !!port.tabs).state, panels.map(specOf)),
    views: () => { const graph = port.views.snapshot(); return graph ? tabViews(graph.views, port.focus.targets().tab) : []; },
    drawn: () => port.viewport.snapshot().head,
    make: panel => (views.shell.head as ViewPaneFactory)(rt, context, panel),
    catalogue: shown => { viewEntries = headEntry ? viewPanelEntries(headEntry, shown) : []; rebuildCatalogue(); },
    dock: { addPanels: specs => dockRef?.addPanels(specs), removePanels: (ids, options) => dockRef?.removePanels(ids, options),
      get dockState() { return dockRef!.dockState; } },
    spec: pane => specOf(pane),
    attach: slot => port.viewport.attach("head", slot),
    added: pane => { panels.push(pane); byId.set(pane.spec.id, pane); paneAnchors.set(pane, anchorPanel(pane)); },
    removed: pane => { panels.splice(panels.indexOf(pane), 1); byId.delete(pane.spec.id); paneAnchors.get(pane)?.(); paneAnchors.delete(pane); },
  });
  if (headEntry) viewPanes.start();
  const restored = restoreDockPreference(port.tabs?.dock(),
    { x: 0, y: 0, w: window.innerWidth, h: Math.max(200, window.innerHeight - 84) }, catalogue, [], viewPanelIds(port.views.snapshot()), !!port.tabs);
  // A preview module's panels carry its stage on their tabs (components/stage-tag.ts).
  const specOf = (panel: PanelController) => ({ ...panel.spec, stage: moduleOfPanel(panel.spec.id)?.stage, visibility: (visible: boolean) => {
    panel.spec.visibility?.(visible);
    if (visible) panel.update(new Frame(port, catalogue, dockRef?.tree));
  } });
  /** Put the 3D preview setup card where it belongs now (set below, once the card exists): after every dock layout too (UI-164). */
  let placeSetupCard = () => {};
  const dock = new DockView({
    panels: panels.map(specOf),
    state: restored.state,
    sizeClass: () => sizeClassFor(window.innerWidth),
    defaults: size => { const defaults = defaultDockStateFor(catalogue); return size === "wide" ? defaults.wide : defaults.compact; },
    save: state => viewPanes.save(state),
    announce: message => feedback.announce(message),
    emptyState: () => port.tabs && !port.tabs.snapshot().tabs.length ? h("div", { class: "dock-empty" },
      h("p", { text: "No tabs are open." }), h("p", { class: "muted", text: "Use New tab above to choose a layout." })) : undefined,
    beforeLayout: () => port.viewport.cancelInput(),
    // A layout change (a tab switched, a pane hidden or resized) may leave the setup card in a pane that is no longer shown or roomy:
    // it is placed again then, not only on the next paint (UI-164).
    afterLayout: () => requestAnimationFrame(() => { port.viewport.resize(); placeSetupCard(); }),
  });
  rt.dock = dock;
  dockRef = dock;
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
  const openHelp = (topic?: string) => { dock.reveal("help", false); requestAnimationFrame(() => topic ? help.openTopic?.(topic) : help.focusSearch?.()); };
  /**
   * Settings (UI-109) is summoned like any panel (`reveal`, dock/layout.ts `summonPanel`): with no home among the docked groups a closed
   * Settings opens floating, or where the person last had it; one already open is brought forward where it is, its group expanded if
   * collapsed. Then the group asked for is shown and focused.
   */
  const settingsPanel = byId.get(SETTINGS_PANEL);
  rt.settings = { open: (section?: SettingsSection, part?: SettingsPart) => {
    dock.reveal(SETTINGS_PANEL, false);
    requestAnimationFrame(() => settingsPanel?.show?.(section, part));
  } };
  guidance = mountGuidance(rt, { openHelp });
  const header = shellHeader(rt, theme, view, () => openHelp());
  const status = statusBar(rt);
  const leaseNotice = workspaceNotice(rt);
  const setupCard = previewSetupCard(rt);
  const main = h("main", { class: "workspace", id: "layout-dock", "aria-label": "Workspace panels" }, dock.element);
  const tabs = port.tabs ? layoutTabs({ tabs: port.tabs, capability: action => port.authoring.capability(action),
    dispatch: action => port.authoring.dispatch(action), feedback, dock: main,
    moduleIcon: id => modules.find(module => module.id === id)?.icon,
    changed: () => { viewPanes.sync(); schedule(); } }) : undefined;
  const upgrade = new EmptyChoices("viewport");
  upgrade.element.classList.add("workspace-upgrade");
  main.append(upgrade.element);
  if (tabs) rt.anchors.register("tabs.strip", tabs.element);
  // A read-only window: controls marked unavailable never act, whatever kind of control they are (the reason tip answers instead).
  const refuseUnavailable = (event: Event) => {
    if (root.dataset.workspace !== "read-only") return;
    const target = event.target as Element | null, control = target?.closest?.("[aria-disabled='true']");
    if (control && main.contains(control)) { event.preventDefault(); event.stopPropagation(); }
  };
  for (const type of ["click", "dblclick", "pointerdown"]) main.addEventListener(type, refuseUnavailable, true);
  // Where the person works (profiles design §3.3): the panel holding keyboard focus, and a pointer press or keyboard focus inside a 3D view
  // makes that view the most recently focused. The application never reads it; actions name what it resolves to. Never an Undo step.
  const reportFocus = (target: EventTarget | null, keyboard: boolean) => {
    const node = target instanceof Node ? target : null;
    const panel = node ? [...byId.keys()].find(id => byId.get(id)!.spec.element.contains(node)) : undefined;
    const view = panel === undefined ? undefined : port.views.snapshot()?.views.find(entry => entry.panel === panel)?.id;
    if (view !== undefined) port.focus.view(view);
    if (keyboard) port.focus.panel(panel);
  };
  main.addEventListener("focusin", event => reportFocus(event.target, true));
  main.addEventListener("pointerdown", event => reportFocus(event.target, false), true);
  root.replaceChildren(header.element, leaseNotice.element, ...(tabs ? [tabs.element] : []), main, status.element, setupCard.element, setupCard.consent, ...guidance.elements, feedback.toasts, feedback.live, feedback.assertive);
  root.classList.add("studio-ready");
  dock.render();
  requestAnimationFrame(() => dock.recover());
  /**
   * The 3D preview setup card sits in the 3D view pane, its subject, whenever that pane is shown and has room for it
   * (release-readiness-audit.md item 10), so it never covers an inspector; it floats over the window only while the pane is hidden or
   * squeezed below the card's reading size. Placed only while the card shows (its size is read then); moving it keeps focus.
   */
  let markedPane: HTMLElement | undefined;
  const dockSetupCard = (open: boolean) => {
    // The 3D view's pane is the one holding the picture (the drawn view's while nothing is shown yet).
    const headId = viewPanes.canvasPanel(), headPane = headId === undefined ? undefined : byId.get(headId)?.spec.element;
    if (markedPane && markedPane !== headPane) markedPane.classList.remove("setup-card-open");
    markedPane = headPane;
    if (open) {
      const pane = headPane && headId !== undefined && dock.isVisible(headId) ? headPane.getBoundingClientRect() : undefined;
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
  const showMessage = (message: ReturnType<Port["status"]["snapshot"]>["message"]) => {
    if (!message || message.id === lastMessage) return;
    lastMessage = message.id;
    // Routine raster timings are not activity; failures also surface through readiness.
    if (message.source === "preview") { if (/fail|error|unavailable|exceed/i.test(message.text)) feedback.record("warning", "Preview", message.text); }
    else if (message.source === "layout-default") feedback.toast("info", "Layout defaults", message.text);
    else feedback.toast("warning", message.source === "uv" ? "UV map" : "3D view", message.text);
  };
  let lastNotice = port.diagnostics.snapshot().notice?.id ?? 0;
  let setupRequests = port.previewSetup.snapshot().setupRequests;
  let optionalViews: ReturnType<NonNullable<ViewComposition["optional"]>> = [];
  let optionalGeneration: number | undefined;
  const optionalAnchors = new Map<PanelController, () => void>();
  let experimentFocus = "";
  function syncOptional() {
    const generation = views.optionalGeneration?.();
    if (generation !== undefined && generation === optionalGeneration) return;
    const optional = views.optional?.() ?? [];
    if (generation === undefined && optional.length === optionalViews.length && optional.every((item, i) => item === optionalViews[i])) return;
    const owners = new Map(optional.map(item => [item.contribution.owner, item]));
    const gone = panels.filter(panel => { const entry = catalogue.panels.find(item => item.id === panel.spec.id);
      return entry && !isViewPane(entry.id) && !views.catalogue.ids.includes(entry.id)
        && owners.get(entry.owner) !== optionalViews.find(item => item.contribution.owner === entry.owner); });
    for (const panel of gone) {
      panel.spec.visibility?.(false); panel.dispose?.(); optionalAnchors.get(panel)?.(); optionalAnchors.delete(panel);
      byId.delete(panel.spec.id); panels.splice(panels.indexOf(panel), 1);
    }
    const extra = viewCatalogue(optional.map(item => item.contribution));
    extraEntries = extra.panels;
    rebuildCatalogue();
    Object.assign(catalogue.meta, extra.meta);
    modules.splice(0, modules.length, ...port.views.modules());
    for (const { contribution, binding } of optional) {
      const ctx = moduleViewContext(rt, contribution.owner);
      for (const entry of contribution.panels) if (!byId.has(entry.id)) {
        const panel = (binding.panels[entry.id] as (ctx: ModuleViewContext) => PanelController)(ctx);
        panel.bind?.(port.panels.instance(entry.id));
        panels.push(panel); byId.set(entry.id, panel); optionalAnchors.set(panel, anchorPanel(panel));
      }
    }
    optionalViews = optional; optionalGeneration = generation; withdrawnKey = ""; experimentFocus = "";
    // One restore from the destination tab, without an intermediate withdrawal save into a possibly newly shown tab. Unknown types
    // park on withdrawal and known types resume their remembered places, even in a read-only window (only persistence needs a lease).
    dock.load(restoreDockPreference(port.tabs?.dock(), dock.area(), catalogue, [], viewPanelIds(port.views.snapshot()), !!port.tabs).state, panels.map(specOf));
  }
  const paint = () => {
    queued = false;
    tabs?.sync();
    const pendingMigration = !!port.status.snapshot().lease?.migrationPending;
    if (tabs) tabs.element.hidden = pendingMigration;
    dock.element.hidden = pendingMigration;
    root.classList.toggle("workspace-upgrade-open", pendingMigration);
    upgrade.update(pendingMigration ? { title: "Workspace needs updating", body: "This workspace is open in an older XF Studio window. Reload that window, or choose Use it here above.",
      choices: [] } : null);
    syncOptional();
    // The shown tab's 3D views each have their pane, and the canvas is in the one holding the picture.
    if (headEntry) viewPanes.sync();
    const focused = rt.shownModules(), focusKey = JSON.stringify(focused);
    if (experimentFocus !== focusKey) {
      experimentFocus = focusKey;
      for (const registration of port.experiments?.registrations() ?? []) registration.visibility?.(focused.includes(registration.module.id));
    }
    // The research preference may have changed: its tools are withdrawn or offered again before anything reads the tools.
    withdrawUnoffered();
    const frame = new Frame(port, catalogue, dockRef?.tree);
    // Editor adapters report limits and rejected gestures; show each once.
    showMessage(frame.status.message);
    // A failure an app service met in the background (a V that couldn't be prepared): shown once, with its reference.
    const notice = port.diagnostics.snapshot().notice;
    if (notice && notice.id !== lastNotice) {
      lastNotice = notice.id;
      // A V that couldn't be prepared is said by the 3D view's own line while the 3D view is open: no toast repeats it over the
      // panels (G3, release-readiness-audit.md C-18); the Activity log keeps it with its reference for a report.
      const shownPane = viewPanes.canvasPanel();
      const inView = notice.area === "character" && shownPane !== undefined && dock.isOpen(shownPane) && frame.viewport.head.phase === "ready"
        && frame.status.assets.characterDetails?.phase === "failed";
      if (inView) feedback.record("error", notice.source, notice.message, notice.ref ?? undefined);
      else feedback.toast("error", notice.source, notice.message, [], { ref: notice.ref });
    }
    // A read-only window opens no prompt that would write settings or data (t-read-only-window): the setup card and the onboarding
    // offer wait for a window that holds the workspace.
    const lease = frame.status.lease, readOnly = !!lease && !lease.writable;
    root.dataset.workspace = readOnly ? "read-only" : "writable";
    header.update(frame); status.update(frame); leaseNotice.update(frame);
    if (readOnly) { setupCard.element.hidden = true; dockSetupCard(false); }
    else { setupCard.update(frame); dockSetupCard(frame.previewSetup.card.open); }
    guidance.update(frame);
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
    if (readOnly) for (const panel of panels)
      if (!READ_SAFE_PANELS.has(panel.spec.id) && dock.isVisible(panel.spec.id)) markReadOnly(panel.spec.element, lease!.refusal);
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
  port.subscribe(() => {
    // A preservation notice must reach feedback before another adapter message can replace it while a paint is queued.
    const message = port.status.snapshot().message;
    if (message?.source === "layout-default") showMessage(message);
    schedule();
  }); rt.subscribe(schedule); feedback.subscribe(schedule);
  paint();
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (dock.sizeClass !== lastClass) {
        lastClass = dock.sizeClass; dock.render();
        feedback.announce(`${lastClass === "wide" ? "Wide" : "Compact"} layout`);
        tabs?.fit();
      }
      dock.recover(); dock.condenseTabs(); port.viewport.resize(); schedule();
    }, 120);
  });

  const commands = () => withPreviewSetup(rt, [...buildCommands(rt, theme, view, byId,
    featureViews.flatMap(({ binding, ctx }) => featureCommands(binding, ctx))), ...panels.flatMap(panel => panel.commands?.() ?? []), ...(tabs?.commands() ?? []), ...guidance.commands()]);
  // Native menus stay in text fields; custom menus are opened by their targets.
  document.addEventListener("contextmenu", event => { if (!allowsNativeTextMenu(event)) event.preventDefault(); });
  window.addEventListener("keydown", event => {
    if (event.defaultPrevented || tabs?.globalKey(event)) return;
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
      // A focused panel's own history comes first: in the 3D view Ctrl+Z undoes the look it shows, even when a creator choice was changed
      // last (the Character panel steps its V's history itself). Elsewhere Undo follows the editing context, as the header's and History's do.
      const focusedPanel = [...byId.keys()].find(id => byId.get(id)!.spec.element.contains(document.activeElement));
      const scope = focusedPanel ? port.panels.historyScope(focusedPanel) : undefined;
      rt.dispatch({ kind: shortcut === "redo" ? "history.redo" : "history.undo", ...(scope ? { scope } : {}) });
    } else if (shortcut === "regions" || shortcut === "regions-back") cycleRegions(root, shortcut === "regions-back");
    else if (shortcut === "guide") { closeMenus(false); openHelp(); }
    else view.openReference();
  });
  header.bindPalette(() => openPalette(commands));
  // The check at start (the host skips it when Settings › Updates turns it off); the service waits until after first paint.
  startupUpdateCheck(rt);
  if (verificationMode(port)) Object.assign(window, { xfStudioShell: { dock, runtime: rt, commands, tabs, panelsMenu: () => panelMenuItems(rt, view.research()), preferences: () => port.preferences.snapshot(),
    guidance: { start: guidance.start, reach: guidance.reach, verifyFacts: guidance.verifyFacts, service: guidance.service, snapshot: () => guidance.service.snapshot(), offerOnboarding: () => guidance.offerOnboarding(new Frame(port, catalogue, dockRef?.tree)) } } });
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

function shellHeader(rt: StudioRuntime, theme: Theme, view: ViewPrefs, openHelp: () => void) {
  const port = rt.port;
  const collection = h("span", { class: "crumb-collection" }), preset = h("span", { class: "crumb-preset" });
  const chip = h("span", { class: "chip" });
  // The chip's room is kept at its widest word, so a save or an edit that changes it moves nothing in the header (header-fit.ts).
  const chipSlot = h("span", { class: "chip-slot" }, chip);
  const keys = { undo: shortcutLabel("shell.undo"), redo: shortcutLabel("shell.redo"), save: shortcutLabel("shell.save"), palette: shortcutLabel("shell.palette") };
  const undo = button({ label: "Undo", icon: "undo", iconOnly: true, variant: "ghost", title: `Undo (${keys.undo})`, onClick: () => rt.dispatch({ kind: "history.undo" }) });
  const redo = button({ label: "Redo", icon: "redo", iconOnly: true, variant: "ghost", title: `Redo (${keys.redo})`, onClick: () => rt.dispatch({ kind: "history.redo" }) });
  const historyButton = button({ label: "History", icon: "history", iconOnly: true, variant: "ghost", title: `History: recent changes to what you last edited\n${HISTORY_SCOPE}`,
    onClick: () => rt.dock.reveal("history") });
  // The labelled actions carry their stage's class: each shows its icon alone when the header needs the room (header-fit.ts).
  const save = button({ label: "Save version", icon: "save", className: "header-save", title: `Save version (${keys.save})`, onClick: () => void rt.request({ kind: "save" }) });
  const pkg = button({ label: "Package", icon: "package", variant: "quiet", className: "header-package", title: "Package: open the mod package review", onClick: () => rt.dock.reveal("package") });
  const palette = button({ label: "Commands", icon: "command", variant: "ghost", className: "header-commands", title: `Command palette (${keys.palette})`, onClick: () => {} });
  const helpButton = button({ label: "Help", icon: "help", iconOnly: true, variant: "ghost", title: `Help: tours, answers and shortcuts (${shortcutLabel("shell.help")})`, onClick: openHelp });
  // One place for everything configured (UI-109): the game and mod manager, the saves folder, WolvenKit, appearance and diagnostics.
  const settingsButton = button({ label: "Settings", icon: "settings", iconOnly: true, variant: "ghost",
    title: "Settings: game, mod manager, saves, tools and appearance", onClick: () => rt.settings.open() });
  for (const [anchor, control] of [["header.save", save], ["header.package", pkg], ["header.history", historyButton], ["header.palette", palette], ["header.help", helpButton],
    ["header.settings", settingsButton]] as const)
    rt.anchors.register(anchor, control);
  const panelsButton = button({ label: "Panels", icon: "layout", iconOnly: true, variant: "ghost", menu: true, title: "Panels in this tab", onClick: event => {
    openMenu(panelMenuItems(rt, view.research()), event.currentTarget as Element,
      { label: "Panels", invoker: event.currentTarget as Element, placement: "below" });
  } });
  const themeButton = button({ label: "View preferences", icon: "monitor", iconOnly: true, variant: "ghost", menu: true, onClick: event =>
    openMenu([...themeItems(theme), { kind: "separator" }, ...view.items(), { kind: "separator" },
      { kind: "action", label: "All settings…", icon: "settings", hint: "Game, saves folder, WolvenKit, appearance and diagnostics", run: () => rt.settings.open("appearance") }],
    event.currentTarget as Element,
      { label: "View preferences", invoker: event.currentTarget as Element }) });
  // "Verification workspace", shortened to "Verification" when the header needs the room (header-fit.ts); the tooltip says the rest.
  const verify = h("span", { class: "verify-flag", title: "Verification workspace: an isolated draft and library. Your normal work is untouched.", hidden: true },
    "Verification", h("span", { class: "verify-rest" }, " workspace"));
  const element = h("header", { class: "shell-header" },
    // The release stage beside the name (release-readiness-audit.md item 22): the first public release is a beta.
    h("div", { class: "brand", "aria-label": "XF Studio beta" }, h("span", { class: "brand-mark", "aria-hidden": "true" }, "XF"), h("span", { class: "brand-name" }, "Studio"),
      Object.assign(badge("Beta", "accent"), { title: "XF Studio is in beta: it may not work on every setup yet. Help › Report a problem… tells us what doesn't." })),
    // The library chip sits after the crumbs, not inside them, so the names give way before it and it never runs over the verification
    // flag in a crowded header (DESK-06).
    h("nav", { class: "crumbs", "aria-label": "Current document" }, collection, icon("chevronRight"), preset), verify, chipSlot,
    h("div", { class: "header-actions" }, h("span", { class: "history-controls", role: "group", "aria-label": "Undo and Redo" }, undo, redo, historyButton), save, pkg, h("span", { class: "divider", "aria-hidden": "true" }), palette, helpButton, settingsButton, panelsButton, themeButton));
  // The crumbs stay readable (UI-187): the header's other items give way first, in a fixed order, whenever the window or the words change.
  const fit = new HeaderFit(element, [collection, preset], { slot: chipSlot, element: chip, words: LIBRARY_CHIP_WIDEST });
  let fitKey = "";
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
      const history = port.authoring.history(), context = frame.history.documentLabel ?? port.focus.editing()?.name;
      // Name what each would change and in what (the editing context, profiles design §3.7), and keep the shortcut visible even while unavailable.
      applyCapability(undo, undoCap); undo.title = historyCommandTitle("undo", undoCap, history.undo?.label, keys.undo, context);
      applyCapability(redo, redoCap); redo.title = historyCommandTitle("redo", redoCap, history.redo?.label, keys.redo, context);
      setAttr(undo, "aria-label", historyCommandLabel("undo", undoCap, history.undo?.label));
      setAttr(redo, "aria-label", historyCommandLabel("redo", redoCap, history.redo?.label));
      const saveCap = port.authoring.requestCapability({ kind: "save" });
      applyCapability(save, saveCap); save.title = saveCap.available ? `Save version (${keys.save})` : saveCap.reason ?? "";
      verify.hidden = !frame.status.verification;
      themeButton.replaceChildren(icon(theme.preference === "system" ? "monitor" : theme.preference === "dark" ? "moon" : "sun"));
      setAttr(themeButton, "aria-label", `View preferences (theme: ${theme.preference === "system" ? `system (${theme.system})` : theme.preference})`);
      // Not the chip's words: its room is reserved (above), so they change no stage.
      const key = JSON.stringify([collection.textContent, preset.textContent, verify.hidden]);
      if (key !== fitKey) { fitKey = key; fit.refit(); }
    },
  };
}

/**
 * The workspace notice's state now (style guide t-read-only-window, t-unprotected, t-recovering): this window read-only, taking over,
 * waiting, handing over or kept; changes not backed up on this computer; restoring that is taking a while; restored changes waiting for
 * a missing save. Nothing transient opens it (F5, transient UI never shifts layout): restoring's first seconds are said in the status
 * bar's fixed line instead (`restoringLine`). The lease's states come first: they change what this window can do.
 */
export function workspaceNoticeState(frame: Frame): WorkspaceNoticeState | null {
  const lease = frame.status.lease;
  if (lease?.message) {
    // A handover that couldn't save names two ways on, so it offers both: Try again, and the recovery export, which needs nothing from the
    // library that couldn't take the changes (condition 1).
    const actions: WorkspaceNoticeAction[] = [...(lease.canTakeOver ? ["takeOver" as const] : []), ...(lease.canCancel ? ["cancelTakeOver" as const] : []), ...(lease.canRetry ? ["retryRelease" as const, "exportCopy" as const] : [])];
    return { message: lease.message, actions, progress: lease.phase === "taking-over" || lease.phase === "waiting" };
  }
  const outbox = frame.status.outbox, restoring = outbox?.recovering;
  if (outbox?.unprotected) return { message: outbox.unprotectedReason === "pending" ? BACKUP_PENDING : outbox.unprotectedReason === "storage-full" ? BACKUP_STORAGE_FULL : UNPROTECTED,
    actions: ["protect", "exportCopy", ...(frame.files.workspaceFile ? ["showInFolder" as const] : [])] };
  if (restoring?.missing) return { message: MISSING_SAVE, actions: ["importSave", "discardWaiting"] };
  if (restoring?.shown && restoring.long) return { message: restoring.safe ? RESTORING_LONG : RESTORING_UNCONFIRMED, progress: true, actions: restoring.safe ? ["retryRestore", "keepRestored"] : ["retryRestore", "exportCopy"] };
  return null;
}

/**
 * The workspace notice under the header (components/workspace-notice.ts), wired to the workspace's actions. A state other than the
 * lease's never opens it in the middle of a gesture or slider adjustment: it waits until that ends, so the panels never move under the
 * pointer; the lease's states show at once.
 */
export function workspaceNotice(rt: StudioRuntime) {
  const toastRefusal = (outcome: { ok: boolean; message?: string; code?: string }) => {
    if (!outcome.ok) rt.feedback.toast("warning", "Workspace", outcome.message ?? "", [], { code: outcome.code });
  };
  const workspace = (kind: "workspace.takeOver" | "workspace.retryRelease" | "workspace.cancelTakeOver") => void rt.port.workspace.dispatch({ kind }).then(toastRefusal);
  const documents = (kind: "documents.protect" | "documents.retryRecovery" | "documents.keepRestored" | "documents.discardWaiting") =>
    void rt.port.documents.dispatch({ kind }).then(toastRefusal);
  const run: Record<WorkspaceNoticeAction, () => void> = {
    showInFolder: () => void rt.file({ kind: "workspace.showInFolder" }),
    cancelTakeOver: () => workspace("workspace.cancelTakeOver"),
    takeOver: () => workspace("workspace.takeOver"), retryRelease: () => workspace("workspace.retryRelease"),
    exportCopy: () => void rt.file({ kind: "collection.exportWindowCopy" }), protect: () => documents("documents.protect"),
    keepRestored: () => documents("documents.keepRestored"), retryRestore: () => documents("documents.retryRecovery"),
    importSave: () => void rt.file({ kind: "savedV.import" }), discardWaiting: () => documents("documents.discardWaiting"),
  };
  const notice = new WorkspaceNotice({ onAction: action => run[action]() });
  return {
    element: notice.element,
    update(frame: Frame) {
      const state = workspaceNoticeState(frame);
      notice.update(state, { deferOpen: !frame.status.lease?.message && !!(frame.preview.gesture || frame.preview.control) });
    },
  };
}

/**
 * Restoring's first seconds (t-recovering): while restored changes wait and it isn't yet taking a while, the status bar's fixed line
 * says so, in place of the band, so nothing moves when it comes and goes. Empty otherwise.
 */
export function restoringLine(frame: Frame): string {
  const lease = frame.status.lease, outbox = frame.status.outbox, restoring = outbox?.recovering;
  if (lease?.message || outbox?.unprotected || restoring?.missing || !restoring?.shown || restoring.long) return "";
  return RESTORING;
}

/**
 * The status bar's activity message (s-status): the library's progress while it works, else the latest activity, else "Ready". The idle
 * "Ready" gives way while the restoring line shows, which it would contradict (condition 5); real activity stays.
 */
export function statusActivity(frame: Frame, last: { message: string; tone: string } | undefined) {
  const library = frame.library, working = library.busy && library.progress?.phase === "working";
  return { text: working ? library.progress!.message : last?.message ?? "Ready", tone: library.busy ? "progress" : last?.tone ?? "info",
    hidden: !!restoringLine(frame) && !working && !last };
}

/** Panels whose controls only read or open things (Help, Activity): a read-only window keeps them all (t-read-only-window). */
const READ_SAFE_PANELS = new Set<string>(["help", "activity"]);
function statusBar(rt: StudioRuntime) {
  // Restoring's first seconds (t-recovering) take this fixed line, not the workspace notice: nothing moves when they come and go.
  const restoring = h("div", { class: "status-item", "data-tone": "restoring", role: "status", hidden: true });
  const restoringProgress = progressBar({ label: RESTORING, className: "status-restoring-progress" });
  const restoringTextNode = h("span");
  restoring.append(restoringTextNode, restoringProgress.element);
  const workspace = h("span", { class: "status-item" }), activity = h("button", { class: "status-item status-message", type: "button",
    title: "Open the activity log" }), ready = h("span", { class: "status-item ready-badge" }), gesture = h("span", { class: "status-item muted" });
  activity.addEventListener("click", () => rt.dock.reveal("activity"));
  const element = h("footer", { class: "status-bar", "aria-label": "Status" }, restoring, workspace, activity, h("span", { class: "grow" }), gesture, ready);
  return {
    element,
    update(frame: Frame) {
      // One save status (UI-89): the header's library chip says whether your work is saved; the draft's own autosave shows here
      // only when it has a problem to tell you about.
      // A read-only window writes nothing, so it has no autosave problem to tell; the notice under the header says what it is.
      const readOnly = !!frame.status.lease && !frame.status.lease.writable;
      const save = frame.status.workspace, problem = !readOnly && save.kind !== "saved" && save.kind !== "idle";
      workspace.dataset.tone = save.kind;
      workspace.hidden = !problem;
      setText(workspace, problem ? `▲ ${save.message}` : "");
      workspace.title = problem ? save.message : "";
      const restoringText = restoringLine(frame);
      restoring.hidden = !restoringText;
      setText(restoringTextNode, restoringText);
      const shown = statusActivity(frame, rt.feedback.log.at(-1));
      setText(activity, shown.text); activity.dataset.tone = shown.tone; activity.hidden = shown.hidden;
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

/** The Panels flyout changes panels in the shown tab. Module ownership supplies headings, never switches. */
export function panelMenuItems(rt: StudioRuntime, research: boolean): MenuItem[] {
  const dock = rt.dock, modules = rt.port.views.modules();
  const titles = new Map(rt.port.views.titles().map(entry => [entry.panel, entry.title]));
  const row = (id: string): MenuItem => {
    const meta = rt.views.meta[id], state = dock.panelState(id);
    const owner = rt.views.panels.find(panel => panel.id === id)?.owner;
    return { kind: "action", label: titles.get(id) ?? meta?.title ?? id, icon: meta?.icon ?? "dot",
      checked: state === "open" || state === "collapsed", tip: meta?.description, stage: modules.find(module => (module.feature ?? module.id) === owner)?.stage,
      ...(state === "collapsed" ? { hint: "Collapsed" } : {}),
      run: () => {
        if (state === "collapsed") dock.reveal(id);
        else if (id === SETTINGS_PANEL && state === "closed") rt.settings.open();
        else dock.toggle(id);
      } };
  };
  const items: MenuItem[] = [{ kind: "heading", label: "Panels", detail: "In this tab" },
    ...rt.views.panels.filter(panel => panel.owner === "shell" && !!dock.panel(panel.id)).map(panel => row(panel.id))];
  for (const module of modules) {
    const panels = rt.views.panels.filter(panel => panel.owner === (module.feature ?? module.id) && !!dock.panel(panel.id));
    if (!panels.length) continue;
    items.push({ kind: "separator" }, { kind: "heading", label: module.label }, ...panels.map(panel => row(panel.id)));
  }
  const planned = plannedShown(rt.port.views.plannedModules(), research);
  if (planned.length) items.push({ kind: "separator" }, { kind: "submenu", label: "Coming soon", items: () => planned.map(module => ({
    kind: "action", label: module.label, icon: isIconName(module.icon) ? module.icon : "category", tag: "Soon",
    capability: { available: false, reason: `Coming soon: ${module.comingSoon}` }, run: () => {},
  })) });
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
export function buildCommands(rt: StudioRuntime, theme: Theme, view: ViewPrefs, panels: Map<PanelId, PanelController>, features: Command[]): Command[] {
  const port = rt.port;
  const act = (id: string, title: string, group: string, action: PresentationAction, extra: Partial<Command> = {}): Command => ({
    id, title, group, ...extra,
    capability: () => port.authoring.capability(action),
    run: () => { rt.dispatch(action); },
  });
  const file = (id: string, title: string, group: string, action: PresentationFileAction, extra: Partial<Command> = {}): Command => ({
    id, title, group, ...extra, capability: () => port.files.capability(action), run: () => void rt.file(action) });
  const request = (id: string, title: string, group: string, value: Parameters<StudioRuntime["request"]>[0], extra: Partial<Command> = {}): Command => ({
    id, title, group, ...extra, capability: () => port.authoring.requestCapability(value), run: () => void rt.request(value) });
  const always = { capability: () => ({ available: true }) };
  const preview = port.authoring.previewState(), motion = preview.motion, history = port.authoring.history(), character = preview.character;
  const characterScope = port.panels.historyScope("character");
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
    request("library.save", "Save version", "Library", { kind: "save" }, { icon: "save", shortcut: shortcutLabel("shell.save") }),
    request("library.copy", "Save as new collection", "Library", { kind: "saveCopy" }, { icon: "duplicate", keywords: "copy" }),
    // The saved list updates itself (release-readiness-audit.md item 13), so there is no Refresh command.
    // Reopen (style guide glossary): the one name for showing a collection you had open again, in every place it is offered.
    file("library.recover", "Reopen previous collection", "Library", { kind: "collection.recover" }, { icon: "undo", keywords: "undo open recover previous draft" }),
    { id: "collection.import", title: "Import collection…", group: "Files", icon: "import", capability: () => port.files.capability({ kind: "collection.import" }),
      run: () => importCollection(rt, { x: Math.round(window.innerWidth / 2 - 170), y: 120 }) },
    file("collection.export", "Export collection (saves first)", "Files", { kind: "collection.export" }, { icon: "export" }),
    ...(port.files.snapshot().workspaceFile ? [file("workspace.showInFolder", "Show workspace file in folder", "Files", { kind: "workspace.showInFolder" }, { icon: "folder" })] : []),
    file("collection.exportWindowCopy", "Export this window's copy", "Files", { kind: "collection.exportWindowCopy" },
      { icon: "export", keywords: "backup recovery changes file without saving library" }),
    ...research([file("collection.plan", "Export compiler plan (saves first; not a mod)", "Research", { kind: "collection.plan" }, { icon: "export", keywords: "build plan" })]),
    file("recipe.import", "Import recipe as preset…", "Files", { kind: "recipe.import" }, { icon: "import" }),
    file("recipe.export", "Export preset recipe", "Files", { kind: "recipe.export" }, { icon: "export" }),
    // A raw layer texture and the saved appearance record are research outputs (release-readiness-audit.md item 6).
    ...research([file("mask.export", "Export selected layer mask (2048²)", "Research", { kind: "mask.export" }, { icon: "export" }),
      file("savedV.export", "Export appearance data", "Research", { kind: "savedV.export" }, { icon: "export" })]),
    file("package.check", "Check mod export", "Mod package", { kind: "package.check" }, { icon: "check" }),
    file("package.stop", "Stop Build", "Mod package", { kind: "package.stop" }, { icon: "close", keywords: "cancel abort" }),
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
    // The Character panel's Undo and Redo: its V's history, named (profiles design §3.7); offered while the panel shows a V.
    ...(characterScope ? [act("character.undo", character?.undo ? `Undo in the Character panel: ${character.undo}` : "Undo in the Character panel", "Character",
      { kind: "history.undo", scope: characterScope }, { icon: "undo", keywords: "character creator clothing undo" }),
    act("character.redo", character?.redo ? `Redo in the Character panel: ${character.redo}` : "Redo in the Character panel", "Character",
      { kind: "history.redo", scope: characterScope }, { icon: "redo", keywords: "character creator clothing redo" })] : []),
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

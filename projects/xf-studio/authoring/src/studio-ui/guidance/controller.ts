import { shortcutLabel } from "../../input-bindings";
import type { TourRecord } from "../../ui-preferences";
import type { Command } from "../commands";
import { isTextInput } from "../dom";
import { PANEL_IDS } from "../layout-defaults";
import type { Frame, StudioRuntime } from "../runtime";
import { panelAnchor } from "./anchors";
import { GuidanceService, type GuidanceAction, type GuidanceCapability, type GuidanceEnvironment, type StepButton } from "./engine";
import { Callout, TourOverlay } from "./overlay";
import { ONBOARDING_TOUR_ID, toursFor } from "./tours";
import type { GuidanceFacts, TourCommand, TourNavigation } from "./types";

/** Read-only facts for `advanceWhen`, from the port's snapshots and the dock. */
export function guidanceFacts(rt: StudioRuntime): GuidanceFacts {
  const port = rt.port, layer = rt.editor.layer(), history = port.authoring.historyTimeline();
  return {
    layers: rt.editor.recipe().layers.length,
    activeLayer: layer?.id ?? null, finish: layer?.finish ?? null, color: layer?.color ?? null,
    edit: `${history.steps.length}:${history.current}:${history.steps[history.current]?.id ?? history.startId}`,
    presets: port.library.summary().draft?.presets.length ?? 0,
    lighting: port.authoring.previewState().preview?.lightingPreset ?? null,
    visiblePanels: PANEL_IDS.filter(id => rt.dock.isVisible(id)),
  };
}

/** The capability of a tour button's command, from the same port capabilities every other control uses. */
export function commandCapability(rt: StudioRuntime, command: TourCommand): GuidanceCapability {
  const port = rt.port;
  switch (command.kind) {
    case "studio": return port.authoring.capability(command.action);
    case "studio.activeLayer": {
      const layer = rt.editor.layer();
      return layer ? port.authoring.capability({ ...command.action, layerId: layer.id } as Parameters<typeof port.authoring.capability>[0])
        : { available: false, reason: "Add or select a layer first." };
    }
    case "file": return port.files.capability(command.action);
    case "previewSetup": return port.previewSetup.capability(command.action);
    case "panel": return { available: true };
  }
}
/** Run a tour button's command through the ordinary validated paths (dispatch, file workflow, dock). */
export async function runCommand(rt: StudioRuntime, command: TourCommand): Promise<boolean> {
  switch (command.kind) {
    case "studio": return rt.dispatch(command.action);
    case "studio.activeLayer": {
      const layer = rt.editor.layer();
      if (!layer) { rt.feedback.toast("info", "Tour", "Add or select a layer first."); return false; }
      return rt.dispatch({ ...command.action, layerId: layer.id } as Parameters<StudioRuntime["dispatch"]>[0]);
    }
    case "file": return (await rt.file(command.action)).ok;
    case "previewSetup": {
      const outcome = await rt.port.previewSetup.dispatch(command.action);
      if (!outcome.ok) rt.feedback.toast("warning", "3D preview", outcome.message);
      rt.changed();
      return outcome.ok;
    }
    case "panel": rt.dock.reveal(command.panel, false); return true;
  }
}

const NAV_ACTIONS: Record<TourNavigation, GuidanceAction> = {
  next: { kind: "guidance.next" }, back: { kind: "guidance.back" }, skip: { kind: "guidance.skip" }, finish: { kind: "guidance.finish" },
};

/**
 * Wires the tour runner to the shell: the overlay, the one-time onboarding offer, the Escape key,
 * the palette commands and tour progress in the workspace's UI preferences.
 */
export function mountGuidance(rt: StudioRuntime, options: { openHelp(): void }) {
  const port = rt.port;
  const record = (tourId: string, outcome: TourRecord) => {
    const action = { kind: "tours.record" as const, tourId, outcome };
    if (port.preferences.capability(action).available) port.preferences.dispatch(action);
  };
  const env: GuidanceEnvironment = {
    facts: () => guidanceFacts(rt),
    anchor: id => rt.anchors.state(id),
    panelVisible: panel => rt.dock.isVisible(panel),
    capability: command => commandCapability(rt, command),
    record,
  };
  const service = new GuidanceService(toursFor(rt.finishes), env);
  const overlay = new TourOverlay({
    rect: target => target.kind === "anchor" ? rt.anchors.rect(target.anchor) : target.kind === "panel" ? rt.anchors.rect(panelAnchor(target.panel)) : undefined,
    press: button => void press(button),
    nav: action => navigate(action),
    // Dock changes (tab switches, floating, closing) don't touch the port; re-check anchors a few times a second.
    refresh: () => { service.observe(); paint(false); },
  });
  let invoker: HTMLElement | null = null, shown = "", running = false;

  /** Repaint; `focus` moves focus into the card (a person's own navigation), never on an automatic advance. */
  function paint(focus: boolean) {
    const snapshot = service.snapshot(), active = snapshot.active;
    overlay.render(active);
    if (active) {
      running = true;
      // A step is identified by its tour too: starting another tour at the same index still announces it.
      const step = `${active.tour.id}:${active.index}`;
      if (step !== shown || snapshot.revision !== lastRevision) {
        if (step !== shown) {
          rt.feedback.announce(`${active.tour.title}, step ${active.index + 1} of ${active.count}: ${active.content.title}`);
          // Bring an anchor scrolled out of its panel into view (the panel scrolls, never the page).
          const target = active.target;
          if (target.kind === "anchor" || target.kind === "panel") rt.anchors.element(target.anchor)?.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
        shown = step;
        if (focus) requestAnimationFrame(() => overlay.callout.focusTitle());
      }
    } else if (running) {
      running = false; shown = "";
      const last = snapshot.last;
      rt.feedback.announce(last?.outcome === "completed" ? "Tour finished. Replay it any time from Help." : "Tour closed. Replay it any time from Help.");
      // Back to where the person was; if that has gone (the offer card), to Help, where tours live.
      const back = invoker?.isConnected && invoker.getClientRects().length ? invoker : rt.anchors.element("header.help");
      back?.focus({ preventScroll: true });
      invoker = null;
    }
    lastRevision = snapshot.revision;
  }
  let lastRevision = -1;
  function dispatch(action: GuidanceAction, focus = true) {
    const result = service.dispatch(action);
    if (!result.ok) { rt.feedback.announce(result.reason); return false; }
    paint(focus);
    return true;
  }
  function navigate(action: TourNavigation) { dispatch(NAV_ACTIONS[action]); }
  async function press(button: StepButton) {
    if (typeof button.action === "string") { navigate(button.action); return; }
    // Read the step before the command runs: a shell paint during an async command can already have advanced
    // the tour on its `advanceWhen`, and `then: "next"` must not move it a second time (UI-42).
    const before = service.snapshot().active?.index;
    const ok = await runCommand(rt, button.action);
    // A satisfied `advanceWhen` moves on by itself; `then: "next"` covers commands without one.
    if (ok && !service.observe() && button.then === "next" && service.snapshot().active?.index === before) dispatch({ kind: "guidance.next" });
    else paint(true);
  }
  function start(tourId: string) {
    hideOffer();
    if (!running) invoker = document.activeElement instanceof HTMLElement && !overlay.element.contains(document.activeElement) &&
      !offer.element.contains(document.activeElement) && document.activeElement !== document.body ? document.activeElement : null;
    return dispatch({ kind: "guidance.startTour", tourId });
  }

  // ----- The one-time onboarding offer -----
  const offer = new Callout({ className: "guidance-offer", closeLabel: "Not now", onClose: () => declineOffer(),
    onKey: event => { if (event.key !== "Escape") return false; declineOffer(); return true; } });
  offer.update({ eyebrow: "Welcome", title: "New to XF Studio?",
    body: "A short tour shows where everything is: layers, drawing, the head view, colour and finish, your library and making your mod. It takes about two minutes, and you can replay it from Help.",
    actions: [{ id: "later", label: "Not now", variant: "quiet", run: () => declineOffer() },
      { id: "start", label: "Show me around", variant: "primary", run: () => { start(ONBOARDING_TOUR_ID); } }] });
  let offerState: "waiting" | "shown" | "done" = "waiting";
  const mountedAt = performance.now();
  function hideOffer() { if (offerState === "shown") offerState = "done"; offer.hide(); }
  function declineOffer() {
    const hadFocus = offer.element.contains(document.activeElement);
    record(ONBOARDING_TOUR_ID, "declined");
    hideOffer();
    rt.feedback.announce(`Tour declined. Help (${shortcutLabel("shell.help")}) has it whenever you want it.`);
    if (hadFocus) document.querySelector<HTMLElement>(".shell-header button")?.focus();
  }
  /**
   * Offer onboarding once, after the welcome screen: never while a dialog is open, while the 3D
   * preview card is asking for something, or in a verification workspace unless `force` asks.
   */
  function maybeOffer(frame: Frame, force = false) {
    if (offerState !== "waiting" || running) return;
    if (!force) {
      if (frame.status.verification || frame.preferences.tours?.[ONBOARDING_TOUR_ID]) { offerState = "done"; return; }
      const card = frame.previewSetup.card;
      if (performance.now() - mountedAt < 1500 || document.querySelector("dialog[open]") || (card.open && !card.busy)) return;
    }
    offerState = "shown";
    offer.show();
    rt.feedback.announce(`A short tour of XF Studio is available. Press ${shortcutLabel("shell.help")} for Help at any time.`);
  }

  // Esc outside the card also stops the tour, unless a gesture, menu, dialog or text field has it.
  window.addEventListener("keydown", event => {
    if (!running || event.defaultPrevented || event.key !== "Escape") return;
    if (overlay.element.contains(event.target as Node) || isTextInput(event.target) || document.querySelector("dialog[open], .menu, .popover")) return;
    const state = port.authoring.previewState();
    if (state.gesture || state.control) return;
    event.preventDefault();
    navigate("skip");
  });

  return {
    service, overlay, offer,
    elements: [overlay.element, offer.element],
    start, openHelp: options.openHelp,
    /** Verification harnesses ask for the offer explicitly; it never appears by itself there. */
    offerOnboarding(frame: Frame) { offerState = "waiting"; maybeOffer(frame, true); },
    status: (tourId: string) => port.preferences.snapshot().tours?.[tourId],
    /** Called on each shell paint: advance on `advanceWhen`, refresh the card and consider the offer. */
    update(frame: Frame) {
      if (running) { service.observe(); paint(false); }
      maybeOffer(frame);
    },
    commands(): Command[] {
      return [
        { id: "help.open", title: "Help: tours, answers and shortcuts", group: "Help", icon: "help", shortcut: shortcutLabel("shell.help"),
          keywords: "help guide tour topics questions support", capability: () => ({ available: true }), run: () => options.openHelp() },
        ...service.tourList().map(tour => ({ id: `tour.${tour.id}`, title: `Start tour: ${tour.title}`, group: "Help", icon: "play" as const,
          keywords: `tour guide walkthrough ${tour.audience === "whats-new" ? "new release changes" : "onboarding introduction"}`,
          capability: () => service.capability({ kind: "guidance.startTour", tourId: tour.id }), run: () => { start(tour.id); } })),
      ];
    },
  };
}
export type GuidanceController = ReturnType<typeof mountGuidance>;

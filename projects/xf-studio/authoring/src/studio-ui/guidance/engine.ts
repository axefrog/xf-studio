import type { PayloadSchema } from "../../studio-action-descriptors";
import { PANEL_META } from "../panel-meta";
import type { StudioPanelId } from "../layout-defaults";
import { anchorInfo, type AnchorId, type AnchorState } from "./anchors";
import type { AppCondition, GuidanceEvent, GuidanceFacts, HelpContent, Side, Tour, TourButton, TourCommand, TourNavigation } from "./types";

/**
 * The tour runner: a DOM-free presentation service with a typed snapshot and typed actions.
 * It owns only which tour and step are showing. Everything a step does to the look goes through
 * the ordinary validated actions its buttons name (dispatched by the shell), and what it reads
 * comes from the read-only facts, anchor states and capabilities its environment supplies.
 */
export type GuidanceAction =
  | { kind: "guidance.startTour"; tourId: string }
  | { kind: "guidance.next" } | { kind: "guidance.back" } | { kind: "guidance.skip" } | { kind: "guidance.finish" };
export type GuidanceCapability = { available: boolean; reason?: string };
export type GuidanceResult = { ok: true } | { ok: false; reason: string };
export type TourOutcome = "completed" | "skipped";

/** Catalogue entries: presentation-only actions with no Undo and no document effect. */
export type GuidanceDescriptor = { scope: readonly ["guidance"]; payload: PayloadSchema; effect: "view"; undo: "none" };
const view = (payload: PayloadSchema = {}): GuidanceDescriptor => ({ scope: ["guidance"], payload, effect: "view", undo: "none" });
export const GUIDANCE_DESCRIPTORS = {
  "guidance.startTour": view({ tourId: { type: "string", required: true, from: "input", minLength: 1, maxLength: 64 } }),
  "guidance.next": view(),
  "guidance.back": view(),
  "guidance.skip": view(),
  "guidance.finish": view(),
} satisfies Record<GuidanceAction["kind"], GuidanceDescriptor>;

export interface GuidanceEnvironment {
  facts(): GuidanceFacts;
  anchor(id: AnchorId): AnchorState;
  panelVisible(panel: StudioPanelId): boolean;
  capability(command: TourCommand): GuidanceCapability;
  /** Remember how a tour ended (UI preferences); optional for tests. */
  record?(tourId: string, outcome: TourOutcome): void;
}

/**
 * Where a step points. `anchor`: its anchor is showing. `panel`: the anchor isn't laid out (for
 * example Colour & finish with no layer selected) but its panel is, so the panel is lit instead.
 * `offer`: the panel is closed or behind another tab, so the step offers to open it. `none`: the
 * step has no anchor, or asks for no spotlight.
 */
export type StepTarget =
  | { kind: "anchor"; anchor: AnchorId }
  | { kind: "panel"; anchor: AnchorId; panel: StudioPanelId }
  | { kind: "offer"; anchor: AnchorId; panel: StudioPanelId; panelTitle: string }
  | { kind: "none" };
export type StepButton = { id: string; label: string; role: "command" | "nav"; primary: boolean;
  action: TourCommand | TourNavigation; then?: "next"; capability: GuidanceCapability };
export type ActiveTour = {
  tour: { id: string; title: string; audience: Tour["audience"]; version?: string };
  index: number; count: number; first: boolean; last: boolean;
  content: HelpContent; placement: "auto" | Side; target: StepTarget; buttons: StepButton[];
  /** The step moves on by itself once its condition holds. */
  waiting: boolean;
};
export type GuidanceSnapshot = { active: ActiveTour | null; revision: number; last: { tourId: string; outcome: TourOutcome } | null };

/** Did `event` happen between two readings of the facts? */
export function eventHappened(event: GuidanceEvent, before: GuidanceFacts, now: GuidanceFacts): boolean {
  switch (event) {
    case "layer.added": return now.layers > before.layers;
    case "recipe.edited": return now.edit !== before.edit;
    case "finish.changed": return now.finish !== null && now.finish !== before.finish && now.activeLayer === before.activeLayer;
    case "color.changed": return now.color !== null && now.color !== before.color && now.activeLayer === before.activeLayer;
    case "preset.added": return now.presets > before.presets;
    case "lighting.changed": return now.lighting !== before.lighting;
  }
}
export function conditionHolds(condition: AppCondition, before: GuidanceFacts, now: GuidanceFacts,
  capability: (command: TourCommand) => GuidanceCapability): boolean {
  if ("event" in condition) return eventHappened(condition.event, before, now);
  if ("panelVisible" in condition) return now.visiblePanels.includes(condition.panelVisible);
  if ("capability" in condition) return capability(condition.capability).available === condition.available;
  return condition.any.some(item => conditionHolds(item, before, now, capability));
}

const NAV_LABELS: Record<TourNavigation, string> = { next: "Next", back: "Back", skip: "Skip tour", finish: "Done" };

export class GuidanceService {
  private active?: { tour: Tour; index: number; baseline: GuidanceFacts };
  private revision = 0;
  private last: GuidanceSnapshot["last"] = null;
  private listeners = new Set<() => void>();
  constructor(private tours: readonly Tour[], private env: GuidanceEnvironment) {}

  tourList(): readonly Tour[] { return this.tours; }
  descriptors() { return structuredClone(GUIDANCE_DESCRIPTORS); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { this.revision++; for (const listener of this.listeners) listener(); }

  /** Whether a step can be shown at all: an unavailable anchor without a panel to open is skipped. */
  private showable(tour: Tour, index: number) {
    const anchor = tour.steps[index]?.anchor;
    if (!anchor) return true;
    return this.env.anchor(anchor) === "visible" || !!anchorInfo(anchor)?.panel;
  }
  private nearest(tour: Tour, from: number, step: 1 | -1) {
    for (let index = from; index >= 0 && index < tour.steps.length; index += step) if (this.showable(tour, index)) return index;
    return undefined;
  }

  capability(action: GuidanceAction): GuidanceCapability {
    if (action.kind === "guidance.startTour") {
      if (typeof action.tourId !== "string" || !this.tours.some(tour => tour.id === action.tourId))
        return { available: false, reason: "That tour isn't available in this version." };
      return { available: true };
    }
    const active = this.active;
    if (!active) return { available: false, reason: "No tour is running." };
    if (action.kind === "guidance.back" && this.nearest(active.tour, active.index - 1, -1) === undefined)
      return { available: false, reason: "This is the first step." };
    if (action.kind === "guidance.finish" && this.nearest(active.tour, active.index + 1, 1) !== undefined)
      return { available: false, reason: "There are more steps; use Skip tour to stop now." };
    return { available: true };
  }

  dispatch(action: GuidanceAction): GuidanceResult {
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, reason: allowed.reason ?? "Unavailable." };
    switch (action.kind) {
      case "guidance.startTour": {
        const tour = this.tours.find(item => item.id === action.tourId)!;
        const index = this.nearest(tour, 0, 1);
        if (index === undefined) { this.end(tour.id, "completed"); return { ok: true }; }
        this.active = { tour, index, baseline: this.env.facts() };
        break;
      }
      case "guidance.next": {
        const { tour, index } = this.active!;
        const next = this.nearest(tour, index + 1, 1);
        if (next === undefined) { this.end(tour.id, "completed"); return { ok: true }; }
        this.active = { tour, index: next, baseline: this.env.facts() };
        break;
      }
      case "guidance.back": {
        const { tour, index } = this.active!;
        this.active = { tour, index: this.nearest(tour, index - 1, -1)!, baseline: this.env.facts() };
        break;
      }
      case "guidance.skip": this.end(this.active!.tour.id, "skipped"); return { ok: true };
      case "guidance.finish": this.end(this.active!.tour.id, "completed"); return { ok: true };
    }
    this.changed();
    return { ok: true };
  }
  private end(tourId: string, outcome: TourOutcome) {
    this.active = undefined;
    this.last = { tourId, outcome };
    this.env.record?.(tourId, outcome);
    this.changed();
  }

  /**
   * Re-read the app after it changed: advance when the step's condition holds, and move past a
   * step whose anchor has gone with no panel to open. Returns whether the step changed.
   */
  observe(): boolean {
    const active = this.active;
    if (!active) return false;
    const step = active.tour.steps[active.index];
    if (!this.showable(active.tour, active.index)) { this.dispatch({ kind: "guidance.next" }); return true; }
    if (step.advanceWhen && conditionHolds(step.advanceWhen, active.baseline, this.env.facts(), command => this.env.capability(command))) {
      this.dispatch({ kind: "guidance.next" });
      return true;
    }
    return false;
  }

  private target(anchor: AnchorId | undefined, spotlight: "anchor" | "none" | undefined): StepTarget {
    if (!anchor) return { kind: "none" };
    const state = this.env.anchor(anchor), panel = anchorInfo(anchor)?.panel;
    if (state === "visible") return spotlight === "none" ? { kind: "none" } : { kind: "anchor", anchor };
    if (panel && this.env.panelVisible(panel)) return spotlight === "none" ? { kind: "none" } : { kind: "panel", anchor, panel };
    if (panel) return { kind: "offer", anchor, panel, panelTitle: PANEL_META[panel].title };
    return { kind: "none" };
  }

  snapshot(): GuidanceSnapshot {
    const active = this.active;
    if (!active) return { active: null, revision: this.revision, last: this.last };
    const { tour, index } = active, step = tour.steps[index];
    const target = this.target(step.anchor, step.spotlight);
    const first = this.capability({ kind: "guidance.back" }).available === false;
    const last = this.capability({ kind: "guidance.finish" }).available;
    const nav = (action: TourNavigation, primary = false, label = NAV_LABELS[action]): StepButton =>
      ({ id: `nav.${action}`, label, role: "nav", primary, action, capability: { available: true } });
    let buttons: StepButton[];
    if (target.kind === "offer") {
      // The step's own buttons may need the panel; offer the panel, or moving on.
      buttons = [{ id: "offer", label: `Show ${target.panelTitle}`, role: "command", primary: true,
        action: { kind: "panel", panel: target.panel }, capability: this.env.capability({ kind: "panel", panel: target.panel }) },
      ...(first ? [] : [nav("back")]), nav(last ? "finish" : "next", false, last ? "Done" : "Skip this step")];
    } else {
      const own = step.buttons ?? [];
      const commands = own.filter((button): button is TourButton & { action: TourCommand } => typeof button.action !== "string")
        .map((button, i): StepButton => ({ id: `command.${i}`, label: button.label, role: "command", primary: false, action: button.action,
          ...(button.then ? { then: button.then } : {}), capability: this.env.capability(button.action) }));
      const ownNav = own.filter(button => typeof button.action === "string") as (TourButton & { action: TourNavigation })[];
      const navButtons = ownNav.length ? ownNav.map(button => nav(button.action, button.action === "next" || button.action === "finish", button.label))
        : [...(first ? [] : [nav("back")]), nav(last ? "finish" : "next", true)];
      buttons = [...commands, ...navButtons];
    }
    return {
      revision: this.revision, last: this.last,
      active: {
        tour: { id: tour.id, title: tour.title, audience: tour.audience, ...(tour.version ? { version: tour.version } : {}) },
        index, count: tour.steps.length, first, last,
        content: step.content, placement: step.placement ?? "auto", target, buttons, waiting: !!step.advanceWhen,
      },
    };
  }
}

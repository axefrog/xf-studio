/**
 * Feature views (feature-module platform §1 `features/<id>/view/`, §7 rule 4; UI-73): what the shell hands
 * a feature's view, and how the view contributes its panels and commands.
 *
 * A feature's panel factories receive a `FeatureViewContext` over that feature's facade, never the shell's
 * runtime or the presentation port. The context has no `port`, no other feature's facade and no dispatch
 * for the feature's own kinds except the facade's: the facade-only rule (UI-52) holds by type. Platform
 * actions a view offers (Add preset) go through `platform`, which takes only the platform families' actions.
 *
 * Types and one pure helper only: the shell builds the contexts (`feature-context.ts`), and a feature's
 * view imports this module to bind its factories (`featureView`).
 */
import type { StudioCapability, StudioOwnerActions, StudioOwnerId, StudioTarget } from "../../studio-application";
import type { StudioContextHit } from "../../studio-context-targets";
import type { FeatureFacade, GenericFeatureFacade, PresentationFeatures, ProjectLinkPort } from "../../studio-presentation";
import type { Command } from "../commands";
import type { Feedback, FeedbackAction } from "../feedback";
import type { AnchorRegistry } from "../guidance/anchors";
import type { IconName } from "../icons";
import type { ViewportInputHints } from "../input-hints";
import type { MenuAnchor, MenuSection } from "../menu";
import type { PanelController } from "../panels/collection";
import type { DispatchFeedback, Port } from "../runtime";
import type { ViewContribution } from "./contribution";

/** The action type a facade dispatches. */
export type FacadeAction<F> = F extends { dispatch(action: infer A): unknown } ? A : never;
/** A registered feature's facade by ID: typed where the port types it (`PresentationFeatures`), else generic. */
export type FacadeOf<K extends string> = K extends keyof PresentationFeatures ? PresentationFeatures[K] : GenericFeatureFacade;
/** The platform families' actions (history, collection, preview, camera …): never a feature's own kinds. */
export type PlatformAction = StudioOwnerActions[Exclude<StudioOwnerId, keyof PresentationFeatures>];
/** A target the application's context query and a feature's capability checks both accept (a layer, preset, point …). */
export type MenuTarget = Extract<StudioTarget, StudioContextHit>;

/**
 * An entry of a feature's target menu. The shell renders it: an action's availability is the facade's
 * per-target capability unless the entry carries its own (a choice's), and choosing it dispatches through
 * the facade with the shell's feedback.
 */
export type FeatureMenuItem<A> =
  | { kind: "action"; label: string; icon?: IconName; action: A; capability?: StudioCapability;
      shortcut?: string; hint?: string; checked?: boolean }
  | { kind: "submenu"; label: string; icon?: IconName; items(): FeatureMenuItem<A>[] };
/**
 * A feature's menu for one of its targets. The shell puts the application-bound context entries for the
 * target first, under `label` and `detail`, then these items; `title` is the menu's accessible name.
 */
export type FeatureTargetMenu<A> = { label: string; detail?: string; title: string; items: FeatureMenuItem<A>[] };
/**
 * A command-palette entry a feature's view contributes. The shell renders it: available by the facade's
 * capability for `action`, or unavailable with `unavailable` as the reason while there is no action; running it
 * dispatches through the facade with the shell's feedback.
 */
export type FeatureCommand<A> = Pick<Command, "id" | "title" | "group" | "icon" | "shortcut" | "keywords"> & {
  action: A | undefined; unavailable?: string };

/** The flat UV editor a view hosts in one of its panels (today only eye makeup's UV map; UI-75). */
export type UvViewportSlot = {
  attach(slot: HTMLElement): void;
  resize(): void;
  command: Port["viewport"]["uvCommand"];
  commandCapability: Port["viewport"]["uvCommandCapability"];
  /** The UV viewport's context menu (the hit's entries, then the view commands). */
  menu(anchor: MenuAnchor, at?: { x: number; y: number }, invoker?: Element): void;
  /** The shared viewport input hints (strip, target tooltip and cursor) for this viewport. */
  hints(slot: HTMLElement, host: HTMLElement): ViewportInputHints;
};

/** Everything a feature's view may reach: its own facade and the shell's presentation services. */
export type FeatureViewContext<F extends FeatureFacade = FeatureFacade> = {
  /** The feature's facade: its actions, capabilities, limits, choices and read-only view. */
  readonly facade: F;
  /** The facade's dispatch, with the shell's feedback (a refusal toasts its reason unless quiet). */
  dispatch(action: FacadeAction<F>, options?: DispatchFeedback): boolean;
  /** An action field's registered range (descriptor limits drive control ranges), for the feature's own kinds. */
  range(kind: FacadeAction<F>["kind"], field: string, variant?: string): { min: number; max: number };
  /** A platform action the view offers (Add preset); a feature's own kind is refused. */
  platform(action: PlatformAction, options?: DispatchFeedback): boolean;
  /** A toast "Undo" that only undoes the change it announced. */
  undoAction(): FeedbackAction;
  readonly feedback: Pick<Feedback, "toast" | "announce" | "record">;
  readonly anchors: Pick<AnchorRegistry, "register">;
  /** Open (or bring forward) a panel. */
  reveal(panel: string, focus?: boolean): void;
  /** XF Studio's own public pages. */
  readonly links: ProjectLinkPort;
  /** Presentation-local changes that need a repaint. */
  changed(): void;
  /** Open a target's menu: the application-bound entries for the target, then the feature's items. */
  targetMenu(target: MenuTarget, menu: FeatureTargetMenu<FacadeAction<F>>, anchor: MenuAnchor, invoker?: Element): void;
  /** The sections `targetMenu` shows (for tests and the style guide). */
  targetSections(target: MenuTarget, menu: FeatureTargetMenu<FacadeAction<F>>, anchor: MenuAnchor): MenuSection[];
  readonly uv: UvViewportSlot;
};

/** A feature panel's factory: it gets the feature's context, nothing else. */
export type FeatureViewFactory<F extends FeatureFacade> = (ctx: FeatureViewContext<F>) => PanelController;
/**
 * A feature's bound view, as the composition hands it to the shell: its owner, its panel factories keyed by
 * its panel IDs, and its palette commands. The shell builds one context per owner from `port.feature(owner)`.
 */
export type FeatureViewBinding = {
  readonly owner: string;
  readonly panels: Readonly<Record<string, (ctx: never) => PanelController>>;
  readonly commands?: (ctx: never) => readonly FeatureCommand<{ kind: string }>[];
};

/**
 * Bind a feature's view contribution to its panel factories (keyed by exactly its panel IDs, so a panel
 * without a factory does not compile) and its palette commands, all typed by its facade.
 */
export function featureView<V extends ViewContribution,
  P extends { readonly [Id in V["panels"][number]["id"]]: FeatureViewFactory<FacadeOf<V["owner"]>> }>(view: V, parts: {
  panels: P;
  commands?: (ctx: FeatureViewContext<FacadeOf<V["owner"]>>) => FeatureCommand<FacadeAction<FacadeOf<V["owner"]>>>[];
}): FeatureViewBinding & { readonly owner: V["owner"]; readonly panels: P } {
  return Object.freeze({ owner: view.owner, panels: parts.panels, ...(parts.commands ? { commands: parts.commands } : {}) });
}

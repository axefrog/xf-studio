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
import type { EasingId } from "../../platform/api/easing";
import type { StudioContextHit } from "../../studio-context-targets";
import type { FacialPort, FeatureFacade, GenericFeatureFacade, PresentationFeatures, ProjectLinkPort } from "../../studio-presentation";
import type { PartPresetList, PartPresetOutcome, PartPresetRequest, PartPresetSetList, SetExportState } from "../../part-presets";
import type { ModuleService } from "../../platform/api";
import type { Command } from "../commands";
import type { Feedback, FeedbackAction } from "../feedback";
import type { AnchorRegistry } from "../guidance/anchors";
import type { IconName } from "../icons";
import type { ViewportInputHints } from "../input-hints";
import type { MenuAnchor, MenuSection } from "../menu";
import type { PanelController } from "../panels/collection";
import type { DispatchFeedback, Port } from "../runtime";
import type { ViewContribution } from "./contribution";
import type { SettingsSection } from "../settings-sections";

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
  /** Open the Settings panel at one of its groups (the game folder and WolvenKit are chosen in Settings › Game and › Tools). */
  openSettings(section?: SettingsSection): void;
  /** XF Studio's own public pages. */
  readonly links: ProjectLinkPort;
  /** Presentation-local changes that need a repaint. */
  changed(): void;
  /** Whether research tools show (Settings › Appearance, UI-85): research-only choices and commands are offered only then. */
  research(): boolean;
  /** The easing curve remembered for a multi-control operation (`scope`, e.g. `expression-intensity`): a UI preference, never Undo. */
  readonly easing: { get(scope: string): EasingId | undefined; set(scope: string, easing: EasingId): void };
  /** Open a target's menu: the application-bound entries for the target, then the feature's items. */
  targetMenu(target: MenuTarget, menu: FeatureTargetMenu<FacadeAction<F>>, anchor: MenuAnchor, invoker?: Element): void;
  /** The sections `targetMenu` shows (for tests and the style guide). */
  targetSections(target: MenuTarget, menu: FeatureTargetMenu<FacadeAction<F>>, anchor: MenuAnchor): MenuSection[];
  readonly uv: UvViewportSlot;
  /** The makeup preview's readiness in the shell's one wording (UI-92), for a view's readiness badge. */
  readiness(): ViewBadge;
  /** The live facial preview (the held expression on the head): its readiness, controls and start points; `retry` tries again. */
  readonly facial: FacialPort;
  /** This feature's part presets in the library: its list, and save, rename and delete (the `presets` family, feature filled in). */
  readonly presets: {
    list(): PartPresetList;
    /** This feature's sets of saved presets (an expression set exports as one mod). */
    sets(): PartPresetSetList;
    /** Each set's latest Check or Build, and what runs now. */
    exports(): SetExportState;
    capability(request: FeaturePresetRequest): StudioCapability;
    execute(request: FeaturePresetRequest): Promise<PartPresetOutcome>;
  };
  /**
   * "Add to my mod manager" for a mod this feature's view built (an expression set's Build): the shell's review-then-consent
   * sheet over `port.modInstall`, the same flow the Mod package panel uses (UI-82). The view names the built mod by its product.
   */
  readonly modInstall: {
    /** The button's words for the saved launch route ("Add to Mod Organizer 2…", "Add to the game folder…"). */
    label(): string;
    /** Whether the plan can be reviewed now, or why not (no verified Build, another install running, already added). */
    capability(product: string): StudioCapability;
    /** What happened last for this product's current build: added, or refused, in plain words. */
    outcome(product: string): { ok: boolean; message: string } | undefined;
    /** Open the review; `rename` renames the mod where its name is set, for a plan whose next step is renaming. */
    review(product: string, options?: { rename?(): void }): void;
  };
};
/** A part preset request without its feature (the view context adds its own). */
export type FeaturePresetRequest = PartPresetRequest extends infer R ? R extends { kind: "partPreset.save" } ? Omit<R, "feature" | "part">
  : R extends { feature: string } ? Omit<R, "feature"> : never : never;

/** A view's corner badge (the readiness a module contributes, view-graph-design.md §3.9). */
export type ViewBadge = { phase: string; label: string; detail: string };
/** A module's crumb in a view after the preset: its `text`, or `empty` when neither the preset nor any module names anything. */
export type ViewSummary = { text?: string; empty: string };

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
  /** The module's crumb in a view of a scene its summary contribution names (eye makeup: the selected layer). */
  readonly summary?: (ctx: never) => ViewSummary;
  /** The module's readiness badge in a view (eye makeup: its layer textures). */
  readonly readiness?: (ctx: never) => ViewBadge | undefined;
};

/**
 * Bind a feature's view contribution to its panel factories (keyed by exactly its panel IDs, so a panel
 * without a factory does not compile) and its palette commands, all typed by its facade.
 */
export function featureView<V extends ViewContribution,
  P extends { readonly [Id in V["panels"][number]["id"]]: FeatureViewFactory<FacadeOf<V["owner"]>> }>(view: V, parts: {
  panels: P;
  commands?: (ctx: FeatureViewContext<FacadeOf<V["owner"]>>) => FeatureCommand<FacadeAction<FacadeOf<V["owner"]>>>[];
  summary?: (ctx: FeatureViewContext<FacadeOf<V["owner"]>>) => ViewSummary;
  readiness?: (ctx: FeatureViewContext<FacadeOf<V["owner"]>>) => ViewBadge | undefined;
}): FeatureViewBinding & { readonly owner: V["owner"]; readonly panels: P } {
  return Object.freeze({ owner: view.owner, panels: parts.panels, ...(parts.commands ? { commands: parts.commands } : {}),
    ...(parts.summary ? { summary: parts.summary } : {}), ...(parts.readiness ? { readiness: parts.readiness } : {}) });
}

/**
 * What a module without a document part gets in its view (view-graph-design.md §5; the Save Explorer): its own service's facade (from
 * `port.module(owner)`, typed by the view, which knows its module) and the shell's presentation services. No port, runtime or other
 * module's service, as for feature views.
 */
export type ModuleViewContext<F extends ModuleService = ModuleService> = {
  readonly facade: F;
  /** The facade's dispatch, awaited, with the shell's feedback (a refusal or failure toasts its reason unless quiet). */
  dispatch(action: Parameters<F["dispatch"]>[0], options?: DispatchFeedback): Promise<boolean>;
  readonly feedback: Pick<Feedback, "toast" | "announce" | "record">;
  readonly anchors: Pick<AnchorRegistry, "register">;
  /** Open (or bring forward) a panel. */
  reveal(panel: string, focus?: boolean): void;
  /** Open the Settings panel at one of its groups (a saves folder is chosen in Settings › Saves). */
  openSettings(section?: SettingsSection): void;
  readonly links: ProjectLinkPort;
  /** Presentation-local changes that need a repaint. */
  changed(): void;
};
export type ModuleViewFactory<F extends ModuleService> = (ctx: ModuleViewContext<F>) => PanelController;
/** A module's bound view: its owner (the module ID) and its panel factories keyed by its panel IDs. */
export type ModuleViewBinding = {
  readonly owner: string;
  readonly panels: Readonly<Record<string, (ctx: never) => PanelController>>;
};
/**
 * Bind a module's view contribution to its panel factories, keyed by exactly its panel IDs. Each factory names its module's facade type
 * (`ModuleViewFactory<F>`); the shell hands it `port.module(owner)`, which the composition registered for that module.
 */
export function moduleView<V extends ViewContribution, P extends { readonly [Id in V["panels"][number]["id"]]: (ctx: never) => PanelController }>(
  view: V, panels: P): ModuleViewBinding & { readonly owner: V["owner"]; readonly panels: P } {
  return Object.freeze({ owner: view.owner, panels });
}

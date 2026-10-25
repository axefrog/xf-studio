import type { PreviewSetupAction } from "../../preview/preview-setup";
import type { PresentationAction } from "../../app/studio-presentation";
import type { PresentationFileAction } from "../../app/studio-presentation";
import type { StudioPanelId } from "../layout-defaults";
import type { SettingsSection } from "../settings-sections";
import type { AnchorId } from "./anchors";

/**
 * Guidance data types (feature-module-platform §6a). Tours and help topics are plain data: they
 * name anchors, typed commands and typed conditions, never DOM selectors or callbacks.
 */

/**
 * Markdown-lite help text: blank lines separate paragraphs, lines starting "- " are bullets,
 * **bold** is emphasis and `[[key:<binding id>]]` shows that key binding's current chord, so the
 * text can never drift from the input binding catalogue.
 */
export type HelpContent = Readonly<{ title: string; body: string }>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** Layer actions whose `layerId` a tour fills in from the active layer when the button is pressed. */
export type ActiveLayerAction = DistributiveOmit<Extract<PresentationAction, { layerId: string }>, "layerId">;

/**
 * What a tour button may do ("Do it for me"). Each is an ordinary typed action dispatched through
 * the same validated port as a menu or button, so tours never bypass validation or Undo.
 */
export type SingleTourCommand =
  | { kind: "studio"; action: PresentationAction }
  | { kind: "studio.activeLayer"; action: ActiveLayerAction }
  /** Start the active layer over from a starter shape (`layer.edit` reset, which names the layer inside its command). */
  | { kind: "studio.resetActiveLayer"; starter: string }
  | { kind: "file"; action: PresentationFileAction }
  | { kind: "previewSetup"; action: PreviewSetupAction }
  /** The existing dock command that opens (or brings forward) a panel. */
  | { kind: "panel"; panel: StudioPanelId }
  /** Settings, at one of its groups. */
  | { kind: "settings"; section: SettingsSection };
/**
 * Commands one after another, each an ordinary action with its own Undo step. It stops at the first one that is refused, and it is
 * available while its first one is (the rest depend on what the first changes).
 */
export type TourCommand = SingleTourCommand | { kind: "sequence"; steps: readonly SingleTourCommand[] };

export type TourNavigation = "next" | "back" | "skip" | "finish";
export type TourButton = Readonly<{ label: string; action: TourCommand | TourNavigation;
  /** After the command succeeds, move to the next step (unless `advanceWhen` already did). */
  then?: "next" }>;

/** Facts the guidance reads from read-only snapshots; events are changes between two readings. */
export type GuidanceFacts = Readonly<{
  layers: number; activeLayer: string | null; finish: string | null; color: string | null;
  /** Changes whenever the current preset gains or moves through an Undo step. */
  edit: string;
  presets: number; lighting: string | null;
  visiblePanels: readonly StudioPanelId[];
  /** Whether this window can change anything (false while another window holds the workspace). */
  writable: boolean;
  /** Whether the game and mod manager are set up well enough to Build (`loading` until the settings are read). */
  setup: "ready" | "needs" | "loading";
  /** What the Mod package panel shows now: nothing, a Check result or a Build result. */
  package: "none" | "check" | "build";
  /** The last finished successful Check or Build, as `check@<time>` or `build@<time>`; empty when the last request was something else. */
  lastPackage: string;
  /** How many mods have been added to the mod manager from the latest Build. */
  installed: number;
}>;
export type GuidanceEvent = "layer.added" | "recipe.edited" | "finish.changed" | "color.changed" | "preset.added" | "lighting.changed"
  | "package.checked" | "package.built" | "mod.installed";
/**
 * A step shown only in some states (an unmet gate skips it, in either direction, and a step that stops meeting its gate while it
 * shows hands over to the next). Each named field must match; absent fields are not asked.
 */
export type TourGate = Readonly<{
  writable?: boolean;
  /** `ready` also holds while the settings are still loading. */
  setup?: "ready" | "needs";
  /** `built`: a Build result is showing (its mods can be added). */
  built?: boolean;
}>;
/** A typed predicate over app events (relative to when the step started) or capabilities. */
export type AppCondition =
  | Readonly<{ event: GuidanceEvent }>
  | Readonly<{ panelVisible: StudioPanelId }>
  | Readonly<{ capability: TourCommand; available: boolean }>
  | Readonly<{ any: readonly AppCondition[] }>;

export type Side = "top" | "right" | "bottom" | "left";
export type TourStep = Readonly<{
  /** A stable name, for tests and capture hooks. */
  id?: string;
  anchor?: AnchorId;
  /** Shown only in these states. */
  when?: TourGate;
  /** `anchor` (default when an anchor is named) lights the anchor; `none` dims everything and centres the callout. */
  spotlight?: "anchor" | "none";
  placement?: "auto" | Side;
  content: HelpContent;
  /** Command buttons shown before Back/Next. Navigation buttons are added unless the step names its own. */
  buttons?: readonly TourButton[];
  advanceWhen?: AppCondition;
}>;
export type TourAudience = "onboarding" | "howto" | "whats-new";
export type Tour = Readonly<{ id: string; title: string; summary: string; version?: string; audience: TourAudience;
  /** Extra words the command palette matches. */
  keywords?: string; steps: readonly TourStep[] }>;

export type HelpTopic = Readonly<{ id: string; title: string; keywords: string; body: string;
  /** Tours that show this topic in the app. */
  tours?: readonly string[] }>;

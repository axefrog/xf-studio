import type { PreviewSetupAction } from "../../preview-setup";
import type { StudioAction } from "../../studio-application";
import type { StudioFileAction } from "../../studio-file-operations";
import type { StudioPanelId } from "../layout-defaults";
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
export type ActiveLayerAction = DistributiveOmit<Extract<StudioAction, { layerId: string }>, "layerId">;

/**
 * What a tour button may do ("Do it for me"). Each is an ordinary typed action dispatched through
 * the same validated port as a menu or button, so tours never bypass validation or Undo.
 */
export type TourCommand =
  | { kind: "studio"; action: StudioAction }
  | { kind: "studio.activeLayer"; action: ActiveLayerAction }
  | { kind: "file"; action: StudioFileAction }
  | { kind: "previewSetup"; action: PreviewSetupAction }
  /** The existing dock command that opens (or brings forward) a panel. */
  | { kind: "panel"; panel: StudioPanelId };

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
}>;
export type GuidanceEvent = "layer.added" | "recipe.edited" | "finish.changed" | "color.changed" | "preset.added" | "lighting.changed";
/** A typed predicate over app events (relative to when the step started) or capabilities. */
export type AppCondition =
  | Readonly<{ event: GuidanceEvent }>
  | Readonly<{ panelVisible: StudioPanelId }>
  | Readonly<{ capability: TourCommand; available: boolean }>
  | Readonly<{ any: readonly AppCondition[] }>;

export type Side = "top" | "right" | "bottom" | "left";
export type TourStep = Readonly<{
  anchor?: AnchorId;
  /** `anchor` (default when an anchor is named) lights the anchor; `none` dims everything and centres the callout. */
  spotlight?: "anchor" | "none";
  placement?: "auto" | Side;
  content: HelpContent;
  /** Command buttons shown before Back/Next. Navigation buttons are added unless the step names its own. */
  buttons?: readonly TourButton[];
  advanceWhen?: AppCondition;
}>;
export type TourAudience = "onboarding" | "howto" | "whats-new";
export type Tour = Readonly<{ id: string; title: string; summary: string; version?: string; audience: TourAudience; steps: readonly TourStep[] }>;

export type HelpTopic = Readonly<{ id: string; title: string; keywords: string; body: string;
  /** Tours that show this topic in the app. */
  tours?: readonly string[] }>;

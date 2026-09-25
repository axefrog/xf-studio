/**
 * The panel factories of each view contribution: the shell binds a panel's catalogue entry (`views/`)
 * to the code that builds it. Each record is keyed by exactly its view's panel IDs, so a contributed panel
 * without a factory, or a factory for a panel no view contributes, does not compile.
 */
import type { PanelController } from "../panels/collection";
import { activityPanel, characterPanel, lightingPanel, motionPanel, qualityPanel } from "../panels/preview";
import { libraryPanel, packagePanel, presetsPanel } from "../panels/collection";
import { edgePanel, finishPanel, shapePanel, warpPanel } from "../panels/inspector";
import { layersPanel } from "../panels/layers";
import { historyPanel } from "../panels/history";
import { headPanel, uvPanel } from "../panels/viewports";
import { helpPanel, type HelpGuidance } from "../guidance/help-panel";
import type { StudioRuntime } from "../runtime";
import type { EYE_MAKEUP_VIEW } from "./eye-makeup";
import type { SHELL_VIEW } from "./shell";
import type { StudioPanelId } from ".";

/** What the shell hands a panel factory besides the runtime: the guidance the Help view lists and starts. */
export type ViewContext = { readonly guidance: HelpGuidance };
export type PanelFactory = (rt: StudioRuntime, context: ViewContext) => PanelController;
type Factories<V extends { panels: readonly { id: string }[] }> = { readonly [K in V["panels"][number]["id"]]: PanelFactory };

export const SHELL_PANELS: Factories<typeof SHELL_VIEW> = {
  presets: presetsPanel, history: historyPanel, library: libraryPanel, package: packagePanel, head: headPanel,
  character: characterPanel, lighting: lightingPanel, motion: motionPanel, quality: qualityPanel, activity: activityPanel,
  help: (rt, context) => helpPanel(rt, context.guidance),
};
export const EYE_MAKEUP_PANELS: Factories<typeof EYE_MAKEUP_VIEW> = {
  layers: layersPanel, uv: uvPanel, finish: finishPanel, shape: shapePanel, edge: edgePanel, warp: warpPanel,
};
/** Every contributed panel's factory. */
export const PANEL_FACTORIES: { readonly [K in StudioPanelId]: PanelFactory } = { ...SHELL_PANELS, ...EYE_MAKEUP_PANELS };

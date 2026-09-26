/**
 * The shell's panel factories and the shape of a view composition: the shell binds a panel's catalogue
 * entry (`views/`) to the code that builds it. A feature's view binds its own panels the same way
 * (`features/<id>/view/`, through `featureView`, with factories that receive only a `FeatureViewContext`),
 * and the composition roots join them (`compose/views.ts`). Each record is keyed by exactly its view's
 * panel IDs, so a contributed panel without a factory, or a factory for a panel no view contributes, does
 * not compile.
 */
import type { PanelController } from "../panels/collection";
import { activityPanel, lightingPanel, motionPanel, qualityPanel } from "../panels/preview";
import { characterPanel } from "../panels/character";
import { libraryPanel, packagePanel, presetsPanel } from "../panels/collection";
import { historyPanel } from "../panels/history";
import { headPanel } from "../panels/viewports";
import { helpPanel, type HelpGuidance } from "../guidance/help-panel";
import type { StudioRuntime } from "../runtime";
import type { ViewCatalogue } from "./contribution";
import type { FeatureViewBinding } from "./feature-view";
import type { SHELL_VIEW } from "./shell";

/** What the shell hands its own panel factories besides the runtime: the guidance the Help view lists and starts. */
export type ViewContext = { readonly guidance: HelpGuidance };
/** One of the shell's own panel factories. A feature's panels get a `FeatureViewContext` instead (`feature-view.ts`). */
export type PanelFactory = (rt: StudioRuntime, context: ViewContext) => PanelController;
/** A view's factories, keyed by exactly its panel IDs. */
export type PanelFactories<V extends { panels: readonly { id: string }[] }> = { readonly [K in V["panels"][number]["id"]]: PanelFactory };

export const SHELL_PANELS: PanelFactories<typeof SHELL_VIEW> = {
  presets: presetsPanel, history: historyPanel, library: libraryPanel, package: packagePanel, head: headPanel,
  character: characterPanel, lighting: lightingPanel, motion: motionPanel, quality: qualityPanel, activity: activityPanel,
  help: (rt, context) => helpPanel(rt, context.guidance),
};

/**
 * What a composition root hands `mountStudio`: the catalogue of every contributed panel (the shell's and
 * each feature's), the shell's own factories and each feature's bound view (its factories and commands).
 */
export type ViewComposition = {
  readonly catalogue: ViewCatalogue;
  readonly shell: Readonly<Record<string, PanelFactory>>;
  readonly features: readonly FeatureViewBinding[];
};

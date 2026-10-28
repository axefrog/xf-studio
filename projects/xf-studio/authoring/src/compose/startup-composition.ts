/** Browser composition data. Every host starts the same root with this value. */
import type { StudioComposition } from "../app/trusted-authoring-core";
import type { ProductDefaults } from "../platform/api/product";
import type { ViewComposition } from "../studio-ui/views/panels";
import type { ViewContribution } from "../studio-ui/views/contribution";
import type { ModuleRegistration } from "../platform/api";
import type { FeatureRendererFactory } from "../platform/api/scene";
import type { LayeredSurfaceRenderer } from "../engines/layered-makeup/render/makeup-stack";
import { Registry } from "../platform/core/registry";
import { PartRegistry } from "../platform/core/document";
import { PLATFORM_VIEW_TOOLS } from "../platform/core/view-tools";
import { viewCatalogue } from "../studio-ui/views/contribution";
import { SHELL_VIEW } from "../studio-ui/views/shell";
import { SHELL_PANELS } from "../studio-ui/views/panels";
import { STUDIO_COMPOSITION, STUDIO_PRODUCT } from "./studio-registry";
import { STUDIO_VIEW_COMPOSITION } from "./view-panels";
import { STUDIO_VIEWS } from "./views";
import { STUDIO_FACE_POSES, STUDIO_LAYERED_SURFACES, STUDIO_RENDERERS } from "./renderers";

export type StudioStartupComposition = StudioComposition & {
  readonly product?: ProductDefaults;
  readonly modules: ModuleRegistration;
  readonly views: readonly ViewContribution[];
  readonly view: ViewComposition;
  readonly renderers: readonly FeatureRendererFactory[];
  readonly surfaces: ReadonlyMap<string, FeatureRendererFactory<LayeredSurfaceRenderer>>;
  readonly facePoses: typeof STUDIO_FACE_POSES;
  readonly frameworkProducts?: readonly (import("../platform/api/product").FrameworkProduct & { readonly feature: string })[];
};

import { EXPRESSION_FRAMEWORK_REQUIREMENTS } from "../features/expressions/requirements";
export const STUDIO_STARTUP_COMPOSITION: StudioStartupComposition = Object.freeze({ ...STUDIO_COMPOSITION, product: STUDIO_PRODUCT,
  view: STUDIO_VIEW_COMPOSITION, views: STUDIO_VIEWS, renderers: STUDIO_RENDERERS, surfaces: STUDIO_LAYERED_SURFACES,
  facePoses: STUDIO_FACE_POSES, frameworkProducts: [{ feature: "expressions", name: "expression sets", requirements: EXPRESSION_FRAMEWORK_REQUIREMENTS }] });

// Same system owners, no feature or part-less module; the shell's slots determine its arrangement.
const modules = Object.freeze({ modules: [], tools: PLATFORM_VIEW_TOOLS, summaries: [], scenes: ["character"], planned: [] });
const catalogue = viewCatalogue([SHELL_VIEW]);
export const EMPTY_STARTUP_COMPOSITION: StudioStartupComposition = Object.freeze({
  registry: new Registry(STUDIO_COMPOSITION.registry.owners().filter(owner => owner.owner === "system")),
  documents: { parts: new PartRegistry([]) }, modules,
  view: { catalogue, shell: SHELL_PANELS, features: [], modules: [] }, views: [SHELL_VIEW],
  renderers: [], surfaces: new Map(), facePoses: [],
});

/** Chosen before workspace/lease/outbox startup. No query can change a normal workspace's composition: outside an isolated
 * ?verify=1 workspace a `composition` query is ignored and the normal Studio starts; a supplied alternate is a programming error. */
export function selectStartupComposition(search: string, supplied?: StudioStartupComposition): StudioStartupComposition {
  const query = new URLSearchParams(search), verify = query.get("verify") === "1";
  if (supplied && supplied !== STUDIO_STARTUP_COMPOSITION && !verify) throw Error("Alternate compositions require an isolated ?verify=1 workspace.");
  if (supplied) return supplied;
  const name = verify ? query.get("composition") : null;
  if (!name || name === "normal") return STUDIO_STARTUP_COMPOSITION;
  if (name === "empty") return EMPTY_STARTUP_COMPOSITION;
  throw Error(`Unknown verification composition: ${name}.`);
}

/** Frozen on c0378c9c before slice 13b production edits. */
import { expect, test } from "bun:test";
import { studioLayoutDefaults } from "../src/compose/layout-defaults";
import { OFF_EXPERIMENTS } from "../src/platform/core/experiments";
import { loadCompositionWorkspace } from "../src/app/browser/browser-workspace-device";
import { serializeWorkspace } from "../src/app/workspace/workspace-state";
import { migrationSnapshot, sessionOfWorkspace } from "../src/app/profiles/profiles-migration-data";
import { STUDIO_STARTUP_COMPOSITION } from "../src/compose/startup-composition";

test("normal startup defaults, catalogue and workspace match c0378c9c", () => {
  const composition = STUDIO_STARTUP_COMPOSITION;
  const restored = loadCompositionWorkspace({ getItem: () => null }, true, composition);
  const region = composition.region!;
  const layouts = studioLayoutDefaults(OFF_EXPERIMENTS, undefined, { modules: composition.modules, views: composition.views, catalogue: composition.view.catalogue });
  const snapshot = {
    registry: composition.registry.entries(), async: composition.registry.owners().filter(owner => "async" in owner).map(owner => ({ id: owner.id, descriptors: composition.registry.asyncDescriptors(owner.id) })), modules: composition.modules,
    product: composition.product, views: composition.views, catalogue: { ids: composition.view.catalogue.ids, panels: composition.view.catalogue.panels },
    bindings: { shell: Object.keys(composition.view.shell), features: composition.view.features.map(view => ({ owner: view.owner, panels: Object.keys(view.panels) })),
      modules: composition.view.modules?.map(view => ({ owner: view.owner, panels: Object.keys(view.panels) })) },
    renderers: composition.renderers.map(renderer => renderer.feature), surfaces: [...composition.surfaces.keys()], poses: composition.facePoses.map(pose => pose.feature),
    defaults: layouts.contributed.list(), initial: layouts.initial, contributed: layouts.contributed.list(),
    knowledge: { panels: composition.view.catalogue.ids.map(id => [id, layouts.known.panel(id)]), tools: composition.modules!.tools.map(tool => [tool.id, layouts.known.tool(tool.id)]) },
    workspace: serializeWorkspace(restored.state, composition.documents),
    migration: migrationSnapshot(restored.state, composition.documents, "startup-parity"),
    session: sessionOfWorkspace(restored.state, { tab: "Tab 1" }, () => .125, layouts.initial),
    starters: { default: region.defaultStarter, contributed: region.starters, part: region.starter() },
  };
  // Functions are intentionally excluded; the data they select and their resulting defaults are covered above.
  expect(JSON.stringify(snapshot, null, 2).split("\n")).toMatchSnapshot();
});

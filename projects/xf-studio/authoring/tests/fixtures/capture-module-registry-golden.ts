/**
 * Captures `tests/golden/module-registry.json` (view-graph-design.md §6.3 rule 7): the modules, their view tools and summaries, and
 * the scene kinds, so module and tool ID churn fails a test. Rerun only to review a deliberate change, and read the diff.
 *   bun tests/fixtures/capture-module-registry-golden.ts
 */
import { writeFileSync } from "node:fs";
import { STUDIO_MODULE_REGISTRATION } from "../../src/compose/modules";

export function moduleRegistrySnapshot() {
  const r = STUDIO_MODULE_REGISTRATION;
  return {
    modules: r.modules.map(({ id, group, stage, feature, shownByDefault }) => ({ id, group, stage, feature: feature ?? null, shownByDefault })),
    tools: r.tools.map(({ id, module, order, scenes, placement, kind, state, dispatches, editing }) =>
      ({ id, module, order, scenes, placement, kind, state, dispatches, editing: editing ?? false })),
    summaries: r.summaries, scenes: r.scenes,
  };
}

if (import.meta.main) {
  writeFileSync(new URL("../golden/module-registry.json", import.meta.url), JSON.stringify(moduleRegistrySnapshot(), null, 1) + "\n");
  console.log(`${STUDIO_MODULE_REGISTRATION.modules.length} modules and ${STUDIO_MODULE_REGISTRATION.tools.length} view tools captured.`);
}

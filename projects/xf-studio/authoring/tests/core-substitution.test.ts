import { expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { COMPOSITION } from "./compose/synthetic-startup";
import { ID, codec } from "./features/synthetic-layers";
import { createTrustedAuthoringCore } from "../src/app/trusted-authoring-core";
import { loadCompositionWorkspace } from "../src/app/browser/browser-workspace-device";
import { registeredFeatureFiles } from "../src/app/feature-files";
import { registeredMaskBake } from "../src/app/browser/browser-file-device";
import { registeredCollectionExport } from "../src/library/collection-export";
import { imports, COMPUTED } from "./fixtures/import-scan";

const root = resolve(import.meta.dir, ".."), folder = "tests/features/synthetic-layers/", composition = "tests/compose/synthetic-startup.ts";
type Edge = { from: string; to: string };
const isIntegration = (file: string) => file.startsWith(folder) || file === composition;
const evidence = new Set(["tests/core-substitution.test.ts", "tests/core-substitution-browser.test.ts"]);
function violations(edges: Edge[]) {
  return edges.filter(({ from, to }) => isIntegration(to) && !isIntegration(from) && !evidence.has(from) ||
    isIntegration(from) && to.startsWith("tests/") && !isIntegration(to) ||
    from.startsWith(folder) && to.startsWith("src/") && !/^src\/(?:platform\/api(?:\/|\.ts)|studio-ui\/|app\/feature-files\.ts$)/.test(to));
}
test("synthetic integration enumerates only its feature folder and test composition, with no production importer", () => {
  const edges: Edge[] = [];
  // Existing boundary scanner includes type-only/static/dynamic/require and worker/module URL loads.
  for (const area of ["src", "tests"]) for (const file of new Bun.Glob(`${area}/**/*.ts`).scanSync({ cwd: root })) {
    const text = readFileSync(resolve(root, file), "utf8");
    const specifiers = imports(text);
    if (isIntegration(file.replaceAll("\\", "/"))) expect(specifiers).not.toContain(COMPUTED);
    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) continue;
      const base = resolve(root, dirname(file), specifier.replace(/\.(?:js|mjs)$/, ""));
      const target = [base, `${base}.ts`, `${base}/index.ts`].find(path => existsSync(path) && /\.ts$/.test(path));
      if (target) edges.push({ from: file.replaceAll("\\", "/"), to: relative(root, target).replaceAll("\\", "/") });
    }
  }
  const adjacent = edges.filter(edge => isIntegration(edge.from) || isIntegration(edge.to)).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  expect(violations(adjacent)).toEqual([]);
  expect(violations([...adjacent, { from: "src/studio-ui/app.ts", to: `${folder}index.ts` }])).toHaveLength(1);
  expect(violations([...adjacent, { from: `${folder}index.ts`, to: "src/features/eye-makeup/index.ts" }])).toHaveLength(1);
  expect(violations([...adjacent, { from: `${folder}index.ts`, to: "tests/fixtures/another-owner.ts" }])).toHaveLength(1);
  const integration = [...new Set(adjacent.flatMap(edge => [edge.from, edge.to]).filter(isIntegration))].sort();
  expect(integration).toEqual([composition, `${folder}index.ts`, `${folder}view.ts`]);
  expect(adjacent).toMatchSnapshot();
  console.log(JSON.stringify({ integration, productionImporters: adjacent.filter(edge => isIntegration(edge.to) && !edge.from.startsWith("tests/")), edges: adjacent.length }));
});

test("synthetic composition uses the real core, registered editor/action/history/file owners and abort", () => {
  const loaded = loadCompositionWorkspace({ getItem: () => null }, true, COMPOSITION);
  const core = createTrustedAuthoringCore(loaded.state, { selectedCollection: () => "local" }, COMPOSITION);
  const editor = core.editors.get(ID)!;
  const files = registeredFeatureFiles(COMPOSITION.registry, ID, { document: core.lookDocument, application: core.app,
    signal: core.signal, imported() {} })!;
  try {
    expect(core.document.features.features()).toEqual([ID]); expect(core.projections.size).toBe(0);
    expect("recipe" in core.document).toBe(false); expect(core.editors.has("eye-makeup")).toBe(false);
    expect(editor.snapshot()).toMatchObject({ part: codec.empty() });
    expect(core.app.dispatch({ kind: "closure.setValue", look: { collection: "local", look: "local" }, id: "first", value: 7 } as never).ok).toBe(true);
    expect(editor.snapshot()).toMatchObject({ part: { layers: [{ id: "first", value: 7 }, { id: "second", value: 2 }] } });
    expect(core.document.history.undo()).toBe(true); expect(editor.snapshot()).toMatchObject({ part: codec.empty() });
    expect(files.portable!.serialize()).toEqual(codec.serialize(codec.empty()));
    expect(registeredMaskBake(COMPOSITION.registry, COMPOSITION.documents)).toBeUndefined();
    expect(registeredCollectionExport(COMPOSITION.documents)).toBeUndefined();
  } finally { core.app.dispose(); core.dispose(); }
  expect(core.signal.aborted).toBe(true);
  expect(() => editor.snapshot()).toThrow(); expect(() => files.portable!.serialize()).toThrow();
});

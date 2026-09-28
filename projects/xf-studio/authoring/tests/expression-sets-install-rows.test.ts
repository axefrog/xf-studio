// The Expression sets panel's install rows (features/expressions/view/sets.ts), in the light DOM: after a Build, the result card offers
// "Add to my mod manager…" for the built mod, and each paint updates only the rows the shown result holds, never a deleted set's (CORE-119).
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { installLightDom, uninstallLightDom } from "./light-dom";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());
beforeEach(async () => { (await import("../src/studio-ui/view-state")).bindViewState(); document.body.replaceChildren(); });

const built = (product: string) => ({ kind: "build", key: "k", result: { originalPresetCount: 0, omissions: [],
  products: [{ productId: product, modName: `XF Expressions - ${product}`, features: [{ presets: [], omissions: [], notes: [], details: {} }] }] } });

test("each paint updates the shown result's install row only: a deleted set's row is let go (CORE-119)", async () => {
  const { expressionSets } = await import("../src/features/expressions/view/sets");
  let sets = [{ id: "a", name: "Smiles", members: [], revision: 1 }, { id: "b", name: "Frowns", members: [], revision: 1 }];
  const asked: string[] = [];
  const ctx = {
    presets: { sets: () => ({ phase: "ready", items: sets }), list: () => ({ phase: "ready", items: [] }),
      exports: () => ({ results: { a: built("product-a"), b: built("product-b") } }), capability: () => ({ available: true }), execute: async () => ({ ok: true }) },
    modInstall: { label: () => "Add to my mod manager…", capability: (product: string) => { asked.push(product); return { available: true }; },
      outcome: () => undefined, review: () => {} },
    facade: { view: () => undefined, editable: () => ({ available: true }) },
    feedback: { toast: () => {}, announce: () => {}, record: () => {} }, changed: () => {}, links: { open: async () => {} }, openSettings: () => {},
  };
  const panel = expressionSets(ctx as never);
  document.body.append(panel.spec.element);
  panel.update(undefined as never);
  expect(asked).toEqual(["product-a"]);
  // Set a is deleted: the panel shows b, and paints only b's row from now on.
  sets = sets.filter(set => set.id !== "a");
  asked.length = 0;
  panel.update(undefined as never);
  expect(asked).toEqual(["product-b"]);
  asked.length = 0;
  panel.update(undefined as never);
  expect(asked).toEqual(["product-b"]);
  // No set left: no rows at all.
  sets = [];
  asked.length = 0;
  panel.update(undefined as never);
  expect(asked).toEqual([]);
});

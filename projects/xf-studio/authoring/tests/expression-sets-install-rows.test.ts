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

test("a set's mod renames from its button while the name is the default, with the popover's hint; a renamed one opens its menu (UI-143)", async () => {
  const { expressionSets } = await import("../src/features/expressions/view/sets");
  let sets: { id: string; name: string; members: never[]; revision: number; modName?: string }[] = [{ id: "a", name: "Smiles", members: [], revision: 1 }];
  const ctx = {
    presets: { sets: () => ({ phase: "ready", items: sets }), list: () => ({ phase: "ready", items: [] }), exports: () => ({ results: {}, busy: { id: "a", action: "build" } }),
      capability: () => ({ available: true }), execute: async () => ({ ok: true }) },
    modInstall: { label: () => "Add to my mod manager…", capability: () => ({ available: true }), outcome: () => undefined, review: () => {} },
    facade: { view: () => undefined, editable: () => ({ available: true }) },
    feedback: { toast: () => {}, announce: () => {}, record: () => {} }, changed: () => {}, links: { open: async () => {} }, openSettings: () => {},
  };
  const panel = expressionSets(ctx as never);
  document.body.append(panel.spec.element);
  panel.update(undefined as never);
  const root = panel.spec.element as unknown as HTMLElement;
  const modButton = () => [...root.querySelectorAll("button")].find(button => /^Rename |options$/.test(button.getAttribute("aria-label") ?? "")) as HTMLButtonElement;
  expect(modButton().getAttribute("aria-label")).toStartWith("Rename ");
  expect(modButton().getAttribute("aria-haspopup")).toBeNull();
  // The value popover shows the hint while the name is accepted (the light DOM has no window: give it one for this call).
  const { openValuePopover } = await import("../src/studio-ui/components");
  const { MOD_NAME_HINT } = await import("../src/mod-branding");
  const globals = globalThis as { window?: unknown; requestAnimationFrame?: unknown };
  const had = { window: globals.window, raf: globals.requestAnimationFrame };
  globals.window = { innerWidth: 1200, innerHeight: 800 };
  // Focus placement after a frame isn't what this checks: a frame that never comes keeps it out of the light DOM.
  globals.requestAnimationFrame = () => 0;
  try {
    const { close } = openValuePopover({ kind: "text", label: "Mod name", value: "XF Smiles", maxLength: 80 }, { x: 10, y: 10 },
      { title: "Rename mod", apply: "Rename", hint: MOD_NAME_HINT, validate: () => ({ available: true }), commit: () => {} });
    const note = document.body.querySelector(".popover-note")!;
    expect([note.textContent, note.classList.contains("hint")]).toEqual(["The name your mod manager shows for this mod.", true]);
    // Let the popover arm its outside-click listener, then close it, so nothing of it outlives this test.
    await new Promise(done => setTimeout(done, 5));
    close(false);
  } finally { globals.window = had.window; if (had.raf) globals.requestAnimationFrame = had.raf; else delete globals.requestAnimationFrame; }
  // While a Build runs, the line says what it does and how long it usually takes, never a bare "Building…" (UI-142).
  expect([...root.querySelectorAll("span")].some(span => span.textContent === "Making and checking the mod files. This usually takes a minute or two…")).toBe(true);
  sets = [{ ...sets[0]!, modName: "XF Grins", revision: 2 }];
  panel.update(undefined as never);
  expect(modButton().getAttribute("aria-label")).toBe("XF Grins options");
});

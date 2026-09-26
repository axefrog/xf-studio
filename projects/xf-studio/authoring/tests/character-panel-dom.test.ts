// The Character panel's DOM over a light DOM harness (light-dom.ts) and a real character context over the asset-free fixture creator
// (UI-67, UI-68, UI-70, CORE-70, CORE-71): choices update in place and keep keyboard focus, the listbox keys move focus without
// choosing, same-named choices are marked by identity, the status line never adds or removes nodes, and the quick action dispatches.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CatalogueIndex } from "../src/cc-catalogue";
import { choicePage, panelProjection, searchChoices, type CcPanelChoice, type CreatorView } from "../src/cc-panel";
import { catalogueCoverage } from "../src/cc-render-coverage";
import { deriveCharacter } from "../src/character-context";
import { CharacterContextActions, type CreatorPort } from "../src/character-context-actions";
import { fixtureSource } from "./cc-fixtures";
import { installLightDom, lightDocument, lightEvent, type LightElement, uninstallLightDom } from "./light-dom";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());
const settle = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));

async function harness() {
  const source = await fixtureSource(true);
  const { panel, mods } = panelProjection(source.catalogue, catalogueCoverage(source.catalogue), "fixture");
  const index = new CatalogueIndex(source.catalogue);
  // The fixture has no makeup category: its scars section stands in for it.
  const marked = { ...panel, sections: panel.sections.map(section => ({ ...section, makeup: section.id === "Scars" })) };
  let failView = false;
  const prefetches: { option: string; positions: number[]; focus: number | null }[] = [], stops: true[] = [];
  const fetchStates = new Map<number, string>();
  const port: CreatorPort = {
    panel: async () => ({ phase: "ready", message: "", panel: structuredClone(marked) }),
    page: async (_gender, option, offset, _signal, query) => choicePage(index, mods, option, offset, { identity: "fixture", query })!,
    search: async (_gender, query) => searchChoices(index, query, "fixture"),
    view: async request => {
      if (failView) throw Error("XF Studio couldn't reach its preview host. Restart XF Studio if this keeps happening.");
      const { view } = deriveCharacter(source, { kind: "default" }, request.choices ?? []);
      const values = Object.fromEntries(Object.entries(view.values).map(([id, value]) => [id, { ...value, label: value.choice, color: null, ownLabel: value.own }]));
      return { ...view, identity: "fixture", values, faceMorphs: [] } as CreatorView;
    },
    preset: async () => ({ text: "", values: 0, leftOut: 0, personal: 0 }), wait: async () => {},
    // Preparing choices ahead: each position's state is what the test sets (queued by default).
    prefetch: async (_request, option, positions, focus) => {
      prefetches.push({ option, positions: [...positions], focus });
      return { states: positions.map(position => fetchStates.get(position) ?? "q").join(""), stopped: null, busy: false };
    },
    stopPrefetch: async () => { stops.push(true); },
    preparedFiles: async () => ({ bytes: 3 * 1024 ** 3 / 2 }),
    clearPrepared: async () => ({ freed: 3 * 1024 ** 3 / 2 }),
  };
  const context = new CharacterContextActions({ creator: port, showSave: () => {} });
  const dispatched: { kind: string }[] = [];
  const rt = {
    port: {
      authoring: { characterPanel: () => context.panel(), characterView: () => context.view(),
        characterChoices: (option: string, want?: number, query?: string) => context.choices(option, want, query), characterSearch: (query: string) => context.search(query),
        characterPrefetch: (option: string, positions: number[], focus?: number | null) => context.prefetch(option, positions, focus ?? null),
        characterStopPrefetch: (option: string) => context.stopPrefetch(option),
        capability: (action: { kind: string }) => action.kind.startsWith("character.") ? context.capability(action as never) : { available: true } },
      files: { capability: () => ({ available: true }) },
    },
    dispatch: (action: { kind: string }) => { dispatched.push(action); if (action.kind.startsWith("character.")) context.dispatch(action as never); return { ok: true }; },
    file: async () => {}, changed: () => {},
  };
  const { characterPanel } = await import("../src/studio-ui/panels/character");
  const controller = characterPanel(rt as never);
  const root = controller.spec.element as unknown as LightElement;
  lightDocument.body.append(root);
  const frame = () => ({ preview: { character: context.snapshot(), preview: undefined, savedV: {}, eyeShapeOptions: undefined },
    status: { assets: { characterDetails: undefined } }, viewport: { head: { error: null, message: null } } }) as never;
  const paint = () => controller.update(frame());
  context.start(); await settle();
  paint(); await settle(); paint();
  return { context, root, paint, dispatched, setFailView: (value: boolean) => { failView = value; }, prefetches, stops, fetchStates };
}
const row = (root: LightElement, label: string) => root.querySelectorAll(".cc-row").find(element => element.querySelector(".cc-row-label")?.textContent === label)!;
const items = (element: LightElement) => element.querySelectorAll(".cc-choice");

describe("the Character panel's DOM", () => {
  test("choosing keeps the focused element and updates the listbox in place; arrow keys move focus without choosing", async () => {
    const h = await harness();
    const eyes = row(h.root, "Eye Color");
    eyes.querySelector(".cc-row-main")!.click();
    h.paint(); await settle(); h.paint();
    const list = eyes.querySelector("[role=listbox]")!;
    const before = items(eyes);
    expect(before.length).toBe(4);
    expect(before.every(item => item.getAttribute("role") === "option")).toBe(true);
    expect(before.filter(item => item.getAttribute("aria-selected") === "true").map(item => item.getAttribute("data-position"))).toEqual(["0"]);
    expect(before.filter(item => item.tabIndex === 0)).toHaveLength(1);
    expect(before[2]!.getAttribute("aria-description")).toContain("From ");
    // Arrow keys move focus only.
    before[0]!.focus();
    list.dispatchEvent(lightEvent("keydown", { key: "ArrowRight" }));
    expect(lightDocument.activeElement).toBe(before[1]!);
    expect(h.dispatched).toEqual([]);
    // Enter or a click chooses; the list is updated in place and the focused element stays.
    before[1]!.click();
    expect(h.dispatched.map(action => action.kind)).toEqual(["character.setOption"]);
    h.paint(); await settle(); h.paint();
    const after = items(eyes);
    expect(after).toEqual(before);
    expect(lightDocument.activeElement).toBe(before[1]!);
    expect(after.filter(item => item.getAttribute("aria-selected") === "true").map(item => item.getAttribute("data-position"))).toEqual(["1"]);
    expect(after.filter(item => item.tabIndex === 0)).toEqual([before[1]!]);
  });

  test("the status line and its actions never add or remove nodes; Keep and Try again are reserved in place", async () => {
    const h = await harness();
    const status = h.root.querySelector(".cc-status")!;
    const nodes = () => status.descendants().length;
    const shape = nodes();
    const [keep] = status.querySelectorAll("button").filter(button => button.textContent.startsWith("Keep"));
    expect(keep!.classList.contains("cc-unoffered")).toBe(true);
    h.context.dispatch({ kind: "character.setOption", part: "head", option: "teeth", choice: "t_gold" });
    h.paint();
    expect(status.querySelector(".cc-status-text")!.textContent).toBe("Updating…");
    await settle(); h.paint();
    h.context.dispatch({ kind: "character.useDefault", bodyGender: "female" });
    h.paint(); await settle(); h.paint();
    expect(keep!.classList.contains("cc-unoffered")).toBe(false);
    expect(nodes()).toBe(shape);
    // A failed view is one line in the status, behind Details, without new nodes in the line.
    h.setFailView(true);
    h.context.dispatch({ kind: "character.keepChanges" });
    h.paint(); await settle(); h.paint();
    expect(status.querySelector(".cc-status-text")!.textContent).toContain("couldn't reach its preview host");
    expect(nodes()).toBe(shape);
  });

  test("the quick action and Reset all dispatch typed actions; a row's detail line is reserved only where it can have one", async () => {
    const h = await harness();
    h.context.dispatch({ kind: "character.setOption", part: "head", option: "scars", choice: "scar_01" });
    h.paint(); await settle(); h.paint();
    const hide = h.root.querySelectorAll("button").find(button => button.textContent === "Hide my V's own makeup")!;
    expect(hide.disabled).toBe(false);
    hide.click();
    expect(h.dispatched.at(-1)).toEqual({ kind: "character.hideOwnMakeup" });
    expect(h.context.request().choices).toEqual([{ part: "head", option: "scars", choice: "" }]);
    h.paint(); await settle(); h.paint();
    expect(hide.disabled).toBe(true);
    const resetAll = h.root.querySelectorAll("button").find(button => button.textContent === "Reset all")!;
    resetAll.click();
    expect(h.dispatched.at(-1)).toEqual({ kind: "character.resetAll" });
    // The fixture's piercing colour depends on the style switcher, so its row keeps a detail line; the eye colour has none.
    expect(row(h.root, "Eye Color").querySelector(".cc-row-detail")).toBeNull();
  });
});

describe("the choice list", () => {
  const choice = (position: number, key: string, extra: Partial<CcPanelChoice> = {}): CcPanelChoice =>
    ({ key, position, label: key, off: false, color: null, mod: -1, ...extra });
  const input = (choices: CcPanelChoice[], selected: number | null, extra = {}) =>
    ({ option: "head/hairstyle", query: "", label: "Hairstyle", grid: false, choices, selected, mods: ["A mod"], loading: false, error: null, ...extra });

  test("a later page is appended (Off joins the front); another option rebuilds and focus returns to the same choice", async () => {
    const { ChoiceList } = await import("../src/studio-ui/panels/character-choices");
    const chosen: CcPanelChoice[] = [];
    const list = new ChoiceList("x", value => chosen.push(value));
    const element = list.element as unknown as LightElement;
    lightDocument.body.append(element);
    const first = [choice(1, "a"), choice(2, "b")];
    list.update(input(first, 2));
    const before = items(element);
    list.update(input([...first, choice(0, "off", { off: true }), choice(3, "c")], 2));
    const after = items(element);
    expect(after.slice(1, 3)).toEqual(before);
    expect(after.map(item => item.getAttribute("data-position"))).toEqual(["0", "1", "2", "3"]);
    // A search (another list) rebuilds; the focused choice keeps focus when it is still listed.
    after[3]!.focus();
    list.update(input([choice(3, "c")], 2, { query: "c" }));
    expect((lightDocument.activeElement as LightElement).getAttribute("data-position")).toBe("3");
    expect(items(element)).toHaveLength(1);
  });

  test("two same-named choices: only the one at the V's position is marked (CORE-70)", async () => {
    const { ChoiceList } = await import("../src/studio-ui/panels/character-choices");
    const list = new ChoiceList("y", () => {});
    const element = list.element as unknown as LightElement;
    list.update(input([choice(0, "Long", { activates: ["hair_a"] }), choice(1, "Long", { activates: ["hair_b"], mod: 0 })], 1));
    expect(items(element).map(item => item.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(items(element)[1]!.getAttribute("aria-description")).toBe("From A mod");
    list.update(input([choice(0, "Long", { activates: ["hair_a"] }), choice(1, "Long", { activates: ["hair_b"], mod: 0 })], 0));
    expect(items(element).map(item => item.getAttribute("aria-selected"))).toEqual(["true", "false"]);
  });

  test("an open row's choices are prepared ahead: marks and descriptions per state, a hint moves one first, closing stops it", async () => {
    const h = await harness();
    h.fetchStates.set(0, "r").set(1, "f").set(3, "x");
    const eyes = row(h.root, "Eye Color");
    eyes.querySelector(".cc-row-main")!.click();
    for (let i = 0; i < 4; i++) { h.paint(); await settle(); }
    // The row's loaded choices were asked about (list order without layout), no hint yet.
    expect(h.prefetches.at(-1)).toMatchObject({ option: "head/eyes_color", positions: [0, 1, 2, 3], focus: null });
    const marks = items(eyes).map(item => [item.getAttribute("data-position"), item.getAttribute("data-fetch")]);
    expect(marks).toEqual([["0", null], ["1", "fetching"], ["2", "pending"], ["3", "failed"]]);
    expect(items(eyes)[2]!.getAttribute("aria-description")).toMatch(/not prepared yet$/);
    expect(items(eyes)[1]!.getAttribute("aria-description")).toMatch(/being prepared$/);
    expect(items(eyes)[0]!.getAttribute("aria-description")).not.toMatch(/prepared/);
    // One line explains the marks, once, whatever row is open.
    expect(h.root.querySelector(".cc-legend")!.textContent).toContain("Not prepared yet");
    // A state that changes updates the item in place (no rebuild).
    const node = items(eyes)[2]!;
    h.fetchStates.set(2, "r");
    items(eyes)[3]!.dispatchEvent(lightEvent("pointerenter"));
    for (let i = 0; i < 3; i++) { h.paint(); await settle(); }
    expect(h.prefetches.at(-1)).toMatchObject({ positions: [0, 1, 2, 3], focus: 3 });
    expect(items(eyes)[2]).toBe(node);
    expect(node.getAttribute("data-fetch")).toBeNull();
    // A choice that wasn't ready is a first-time change; one that was isn't.
    items(eyes)[3]!.click();
    expect(h.context.snapshot().firstTime).toBe(true);
    items(eyes)[2]!.click();
    expect(h.context.snapshot().firstTime).toBe(false);
    // Closing the row stops preparing ahead.
    eyes.querySelector(".cc-row-main")!.click();
    h.paint();
    expect(h.stops.length).toBe(1);
  });

  test("the prepared game files' size and Clear prepared game files", async () => {
    const h = await harness();
    for (let i = 0; i < 3; i++) { h.paint(); await settle(); }
    const text = () => h.root.querySelector(".cc-prepared-text")!.textContent;
    expect(text()).toBe("Prepared game files on this computer: 1.5 GB.");
    const clear = h.root.querySelectorAll("button").find(button => button.textContent?.includes("Clear prepared game files"))!;
    clear.click();
    expect(h.dispatched.at(-1)).toEqual({ kind: "character.clearPreparedFiles" });
    h.paint();
    expect(text()).toBe("Clearing the prepared game files…");
    for (let i = 0; i < 3; i++) { await settle(); h.paint(); }
    expect(text()).toBe("Prepared game files on this computer: 1.5 GB. Cleared 1.5 GB.");
  });
});

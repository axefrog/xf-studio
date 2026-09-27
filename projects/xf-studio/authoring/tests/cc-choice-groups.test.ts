// Grouping a row's choices by who made them (cc-controls backlog 4a): the projection's maker groups (the base game, XF Studio by its
// `xfs_` resources, authors as mod managers record them, else the mod's name), the host's maker reader (Vortex's records; MO2 records
// none; hand-placed game-folder mods together), and the choice list's collapsible, keyboard-navigable groups that keep instant selection.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildCatalogue, type CcCatalogue } from "../src/cc-catalogue";
import type { CcoResource } from "../src/cco-model";
import { BASE_GAME_GROUP, type CcChoiceGroup, type CcPanelChoice, choiceGroup, compareGroups, isXfResource, OTHER_MODS_INDEX, OWN_GROUP_MIN_CHOICES, panelProjection,
  pooledGroups, readCcPanel, XF_GROUP } from "../src/cc-panel";
import { catalogueCoverage } from "../src/cc-render-coverage";
import { GAME_FOLDER_MODS, makerText, modMakers } from "../src/mod-makers";
import type { VortexModIdentity } from "../src/vortex-deployment";
import { installLightDom, lightDocument, lightEvent, type LightElement, uninstallLightDom } from "./light-dom";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());

/** A creator with two options: one whose choices come from the game and four mods, one with a single mod's choices. */
function catalogue(): CcCatalogue {
  const definition = (name: string, index: number, providedBy: string) => ({ name, index, localizedName: "", tags: [], providedBy });
  const option = (name: string, index: number, definitions: ReturnType<typeof definition>[]) => ({ type: "appearance" as const, name, uiSlot: name, link: "",
    linkController: false, hidden: false, enabled: true, index, defaultIndex: 0, localizedName: "", editTags: ["NewGame"], definedBy: "base game",
    resource: { hash: String(100 + index), path: `base\\${name}.app` }, definitions });
  const options = [
    option("hair_color", 0, [definition("vanilla_a", 0, "base game"), definition("zeta", 1, "zeta"), definition("alpha_1", 2, "alpha 1"),
      definition("xf_look", 3, "xf"), definition("alpha_2", 4, "alpha 2"), definition("vanilla_b", 5, "base game")]),
    option("brow_color", 1, [definition("only_1", 0, "alpha 1"), definition("only_2", 1, "alpha 1")]),
  ];
  const cco: CcoResource = { label: "t", version: 1, parts: { head: { options, groups: [{ name: "TPP", options: options.map(o => o.name) }] },
    body: { options: [], groups: [] }, arms: { options: [], groups: [] } } };
  return buildCatalogue({ bodyGender: "female", cco, text: null, presentation: null, customs: [
    { path: "xl\\zeta\\zeta.inkcharcustomization", label: "zeta", mod: "Zeta Hair Colours" },
    { path: "xl\\alpha\\one.inkcharcustomization", label: "alpha 1", mod: "Alpha Pack One" },
    { path: "xl\\alpha\\two.inkcharcustomization", label: "alpha 2", mod: "Alpha Pack Two" },
    { path: "xfs\\eye_artistry\\xfs_collection.inkcharcustomization", label: "xf", mod: "My renamed build" },
  ] });
}

describe("maker groups in the projection", () => {
  test("the base game and XF Studio have their own groups; mods by one author share one; a mod with no author goes by its name", () => {
    const makers = new Map([["Alpha Pack One", { author: "Alice" }], ["Alpha Pack Two", { author: "alice" }]]);
    const { panel } = panelProjection(catalogue(), new Map(), "t", makers);
    expect(readCcPanel(JSON.parse(JSON.stringify(panel)))).toEqual(panel);
    expect(panel.groups[0]).toEqual(BASE_GAME_GROUP);
    const groupOf = (mod: string) => panel.groups[panel.modGroups[panel.mods.indexOf(mod)]!];
    // Renamed by its user, still XF Studio's: its creator resource carries the generated prefix.
    expect(groupOf("My renamed build")).toEqual(XF_GROUP);
    expect(groupOf("Alpha Pack One")).toEqual({ label: "Alice", kind: "author" });
    expect(panel.modGroups[panel.mods.indexOf("Alpha Pack Two")]).toBe(panel.modGroups[panel.mods.indexOf("Alpha Pack One")]);
    expect(groupOf("Zeta Hair Colours")).toEqual({ label: "Zeta Hair Colours", kind: "mod" });
    // Each option counts the makers of its choices: four for the mixed row, one for the single-mod row (not grouped).
    expect(panel.options.find(option => option.name === "hair_color")!.groups).toBe(4);
    expect(panel.options.find(option => option.name === "brow_color")!.groups).toBe(1);
    // Shown order: the base game, XF Studio, then makers by name.
    const order = panel.groups.map((_, index) => index).sort(compareGroups(panel.groups)).map(index => panel.groups[index]!.label);
    expect(order).toEqual(["Base game", "Made with XF Studio", "Alice", "Zeta Hair Colours"]);
    expect(choiceGroup({ mod: -1 }, panel)).toBe(0);
  });

  test("a maker's own name stands in for a staging folder; the reader refuses groups that don't add up", () => {
    const { panel } = panelProjection(catalogue(), new Map(), "t", new Map([["Zeta Hair Colours", { author: null, name: "Zeta: all colours" }]]));
    expect(panel.groups.map(group => group.label)).toContain("Zeta: all colours");
    const wire = JSON.parse(JSON.stringify(panel));
    expect(() => readCcPanel({ ...wire, groups: [] })).toThrow();
    expect(() => readCcPanel({ ...wire, groups: [{ label: "Somebody", kind: "author" }, ...wire.groups] })).toThrow();
    expect(() => readCcPanel({ ...wire, modGroups: wire.modGroups.slice(1) })).toThrow();
    expect(() => readCcPanel({ ...wire, modGroups: wire.modGroups.map(() => wire.groups.length) })).toThrow();
    expect(() => readCcPanel({ ...wire, groups: wire.groups.map((group: object, at: number) => at ? { ...group, kind: "evil" } : group) })).toThrow();
  });

  test("makers with a single choice in an option share one 'Other mods' heading there, when there are two or more of them", () => {
    // Nobody records an author (MO2): the mixed row has Zeta, Alpha Pack One and Alpha Pack Two with one choice each, and XF Studio's.
    const { panel } = panelProjection(catalogue(), new Map(), "t");
    const hair = panel.options.find(option => option.name === "hair_color")!;
    expect(OWN_GROUP_MIN_CHOICES).toBe(2);
    expect(panel.pools[hair.pool]!.map(index => panel.groups[index]!.label).sort()).toEqual(["Alpha Pack One", "Alpha Pack Two", "Zeta Hair Colours"]);
    // Headings: the base game, XF Studio (never pooled) and Other mods.
    expect(hair.groups).toBe(3);
    // The single-mod row isn't grouped at all.
    expect(panel.options.find(option => option.name === "brow_color")!).toMatchObject({ groups: 1, pool: -1 });
    expect(readCcPanel(JSON.parse(JSON.stringify(panel)))).toEqual(panel);
    // A lone small group keeps its own heading; the base game and XF Studio are never pooled.
    const groups: CcChoiceGroup[] = [BASE_GAME_GROUP, XF_GROUP, { label: "A", kind: "mod" }, { label: "B", kind: "author" }, { label: "C", kind: "mod" }];
    expect(pooledGroups(new Map([[0, 1], [1, 1], [2, 1], [3, 5]]), groups)).toEqual([]);
    expect(pooledGroups(new Map([[0, 1], [1, 1], [2, 1], [4, 1], [3, 5]]), groups)).toEqual([2, 4]);
    // "Other mods" shows last.
    expect([OTHER_MODS_INDEX, 3, 0, 1].sort(compareGroups(groups))).toEqual([0, 1, 3, OTHER_MODS_INDEX]);
    // A host from before pooling sends none: nothing pooled; a pooled base game is refused.
    const wire = JSON.parse(JSON.stringify(panel));
    const { pools: _pools, ...older } = wire;
    expect(readCcPanel({ ...older, options: wire.options.map(({ pool: _pool, ...option }: { pool: number }) => option) }).options.every(option => option.pool === -1)).toBe(true);
    expect(() => readCcPanel({ ...wire, pools: [[0]] })).toThrow();
    expect(() => readCcPanel({ ...wire, options: wire.options.map((option: object) => ({ ...option, pool: 5 })) })).toThrow();
  });

  test("an XF resource is known by its file name alone", () => {
    expect(isXfResource("xfs\\a\\xfs_collection.inkcharcustomization")).toBe(true);
    expect(isXfResource("base/XFS_thing.inkcharcustomization")).toBe(true);
    expect(isXfResource("xfs_folder\\other.inkcharcustomization")).toBe(false);
    expect(isXfResource(null)).toBe(false);
  });
});

describe("who made each mod (host)", () => {
  const archive = (providerName: string, provider: "game" | "mo2-mod", group: "mod" | "content" = "mod") => ({ providerName, provider, group });
  const identity = (id: string, author: string | null, name: string | null): VortexModIdentity =>
    ({ id, name, version: null, nexus: null, source: null, author, enabled: true });

  test("MO2 records no author; hand-placed game-folder mods share one group; base-game archives are not mods", async () => {
    const makers = await modMakers({ plan: { archives: [archive("Some MO2 Mod", "mo2-mod"), archive("Installed game", "game"),
      archive("Installed game", "game", "content")] } }, "GAME", { inspect: async () => { throw Error("Vortex isn't read without a deployment"); } });
    expect([...makers]).toEqual([["Installed game", { author: null, name: GAME_FOLDER_MODS }]]);
  });

  test("Vortex's records name each deployed mod's author and its own name, within a time budget", async () => {
    let asked: { deadline?: number } | null = null;
    const makers = await modMakers({ plan: { archives: [archive("hair-1-0", "game"), archive("local-mod", "game"), archive("Installed game", "game")] },
      vortexMods: new Map([["hair-1-0", "hair-1-0"], ["local-mod", "local-mod"]]) }, "GAME", { now: () => 1000, budgetMs: 50,
      inspect: async (_root, _env, options) => {
        asked = options;
        return { state: { game: { mods: new Map([["hair-1-0", identity("hair-1-0", "A. Modder\u0007", "Hair Colours")], ["local-mod", identity("local-mod", null, null)]]) } } as never };
      } });
    expect(asked!.deadline).toBe(1050);
    expect(makers.get("hair-1-0")).toEqual({ author: "A. Modder", name: "Hair Colours" });
    expect(makers.get("local-mod")).toEqual({ author: null, name: null });
    expect(makers.get("Installed game")).toEqual({ author: null, name: GAME_FOLDER_MODS });
  });

  test("a maker's name is plain, bounded text", () => {
    expect(makerText("  Name\u0000with\ncontrols  ")).toBe("Name with controls");
    expect(makerText("x".repeat(300))).toHaveLength(80);
    expect(makerText(" \u0001 ")).toBeNull();
  });
});

describe("the choice list grouped by maker", () => {
  const groups = { list: [BASE_GAME_GROUP, { label: "Zeta", kind: "mod" as const }, XF_GROUP, { label: "Alice", kind: "author" as const }], modGroups: [1, 2, 3] };
  const choice = (position: number, mod: number, extra: Partial<CcPanelChoice> = {}): CcPanelChoice =>
    ({ key: `c${position}`, position, label: `C${position}`, off: false, color: null, mod, ...extra });
  const choices = [choice(0, -1, { off: true, key: "" }), choice(1, -1), choice(2, 0), choice(3, 2), choice(4, 1), choice(5, 2), choice(6, -1)];
  const input = (list: CcPanelChoice[], selected: number | null, extra = {}) => ({ option: "head/hair_color", query: "", label: "Hair Color", grid: false,
    choices: list, selected, mods: ["Zeta Hair Colours", "My build", "Alpha Pack"], loading: false, error: null, groups, ...extra });
  const text = (element: LightElement) => element.textContent;
  async function list(selected: number | null = 1) {
    const { ChoiceList } = await import("../src/studio-ui/panels/character-choices");
    const chosen: CcPanelChoice[] = [];
    const view = new ChoiceList("g", value => chosen.push(value));
    const element = view.element as unknown as LightElement;
    lightDocument.body.append(element);
    view.update(input(choices, selected));
    return { view, element, chosen };
  }
  const heads = (element: LightElement) => element.querySelectorAll(".cc-maker-head");
  const key = (target: LightElement, name: string) => target.dispatchEvent(lightEvent("keydown", { key: name }));

  test("Off above the groups; the base game, XF Studio, then makers by name; the creator's order within each", async () => {
    const { element } = await list();
    const root = element.querySelector(".cc-choices")!;
    expect(root.classList.contains("grouped")).toBe(true);
    expect(root.children[0]!.querySelectorAll(".cc-choice").map(item => item.getAttribute("data-position"))).toEqual(["0"]);
    expect(heads(element).map(head => head.querySelector(".cc-maker-label")!.textContent)).toEqual(["Base game", "Made with XF Studio", "Alice", "Zeta"]);
    expect(element.querySelectorAll(".cc-maker").map(group => group.querySelectorAll(".cc-choice").map(item => item.getAttribute("data-position"))))
      .toEqual([["1", "6"], ["4"], ["3", "5"], ["2"]]);
    expect(heads(element).map(head => text(head.querySelector(".cc-maker-count")!))).toEqual(["2", "1", "2", "1"]);
    // Each group is labelled by its heading.
    const group = element.querySelector(".cc-maker")!;
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-labelledby")).toBe(heads(element)[0]!.id);
  });

  test("a click marks the choice at once, inside its group; a later page joins its group without a rebuild", async () => {
    const { view, element, chosen } = await list();
    const five = element.querySelector('[data-position="5"]')!;
    five.click();
    expect(chosen.map(value => value.position)).toEqual([5]);
    expect(element.querySelectorAll('[aria-selected="true"]').map(item => item.getAttribute("data-position"))).toEqual(["5"]);
    const groupsBefore = element.querySelectorAll(".cc-maker");
    view.update(input([...choices, choice(7, 2), choice(8, 0)], 5));
    expect(element.querySelectorAll(".cc-maker")).toEqual(groupsBefore);
    expect(groupsBefore[2]!.querySelectorAll(".cc-choice").map(item => item.getAttribute("data-position"))).toEqual(["3", "5", "7"]);
    expect(element.querySelector('[data-position="5"]')).toBe(five);
  });

  test("a heading folds its group away and back, by click or Left and Right; a folded group holding the V's choice says so", async () => {
    const { view, element } = await list(3);
    const alice = heads(element)[2]!;
    const body = element.querySelectorAll(".cc-maker-items").find(items => items.id === alice.getAttribute("aria-controls"))!;
    alice.click();
    expect(alice.getAttribute("aria-expanded")).toBe("false");
    expect(body.hidden).toBe(true);
    expect(alice.hasAttribute("data-chosen")).toBe(true);
    expect(alice.getAttribute("aria-description")).toBe("Your choice is in this group");
    // The fold is kept across paints and the list's rebuilds for the same option.
    view.update(input(choices, 3, { query: "c" }));
    view.update(input(choices, 3));
    const again = heads(element)[2]!;
    expect(again.getAttribute("aria-expanded")).toBe("false");
    again.focus();
    key(again, "ArrowRight");
    expect(again.getAttribute("aria-expanded")).toBe("true");
    expect(again.hasAttribute("aria-description")).toBe(false);
    key(again, "ArrowLeft");
    expect(again.getAttribute("aria-expanded")).toBe("false");
  });

  test("arrow keys move through Off, headings and unfolded choices in the order they show; folding moves focus to the heading", async () => {
    const { element } = await list(null);
    const off = element.querySelector('[data-position="0"]')!;
    off.focus();
    const walk: string[] = [];
    for (let i = 0; i < 8; i++) {
      key(lightDocument.activeElement!, "ArrowDown");
      const at = lightDocument.activeElement!;
      walk.push(at.getAttribute("data-position") ?? at.querySelector(".cc-maker-label")!.textContent);
    }
    expect(walk).toEqual(["Base game", "1", "6", "Made with XF Studio", "4", "Alice", "3", "5"]);
    // Only one Tab stop in the whole list.
    expect(element.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    // Folding a group takes the Tab stop out of it, onto its heading; the arrows skip its choices.
    const alice = heads(element)[2]!;
    alice.focus(); alice.click();
    expect(lightDocument.activeElement).toBe(alice);
    expect(alice.tabIndex).toBe(0);
    expect(element.querySelectorAll('[tabindex="0"]')).toEqual([alice]);
    key(alice, "ArrowDown");
    expect(lightDocument.activeElement).toBe(heads(element)[3]!);
    key(lightDocument.activeElement!, "ArrowUp");
    key(lightDocument.activeElement!, "ArrowUp");
    expect(lightDocument.activeElement!.getAttribute("data-position")).toBe("4");
  });

  test("'Other mods' comes last, its choices sorted by label; each says its mod", async () => {
    const { ChoiceList } = await import("../src/studio-ui/panels/character-choices");
    const view = new ChoiceList("o", () => {});
    const element = view.element as unknown as LightElement;
    const list = [choice(0, -1, { off: true, key: "" }), choice(1, -1), choice(2, 0, { label: "Zed" }), choice(3, 2, { label: "Alpha" }), choice(4, 1, { label: "Mid" })];
    // Zeta (group 1) and Alice (group 3) are pooled; XF Studio (group 2) keeps its heading.
    view.update(input(list, 1, { groups: { ...groups, pooled: [1, 3] } }));
    expect(heads(element).map(head => head.querySelector(".cc-maker-label")!.textContent)).toEqual(["Base game", "Made with XF Studio", "Other mods"]);
    const other = element.querySelectorAll(".cc-maker").at(-1)!;
    expect(other.getAttribute("data-kind")).toBe("other");
    expect(other.querySelectorAll(".cc-choice").map(item => item.getAttribute("aria-label"))).toEqual(["Alpha", "Zed"]);
    expect(other.querySelectorAll(".cc-choice").map(item => item.getAttribute("aria-description"))).toEqual(["From Alpha Pack", "From Zeta Hair Colours"]);
    // A later page joins in label order, without a rebuild.
    view.update(input([...list, choice(5, 0, { label: "Beta" })], 1, { groups: { ...groups, pooled: [1, 3] } }));
    expect(other.querySelectorAll(".cc-choice").map(item => item.getAttribute("aria-label"))).toEqual(["Alpha", "Beta", "Zed"]);
    // Folding everything and unfolding it again (the section's Expand all).
    view.setAllFolded(true);
    expect(view.anyFolded()).toBe(true);
    expect(heads(element).every(head => head.getAttribute("aria-expanded") === "false")).toBe(true);
    view.setAllFolded(false);
    expect(view.anyFolded()).toBe(false);
    // Every heading is the shared expander.
    expect(heads(element).every(head => head.classList.contains("expander") && head.getAttribute("data-level") === "maker")).toBe(true);
  });

  test("a row with one maker has no headings", async () => {
    const { element } = await list();
    const { ChoiceList } = await import("../src/studio-ui/panels/character-choices");
    const plain = new ChoiceList("p", () => {});
    plain.update(input(choices, 1, { groups: null }));
    const root = plain.element as unknown as LightElement;
    expect(root.querySelectorAll(".cc-maker-head")).toHaveLength(0);
    expect(root.querySelector(".cc-choices")!.classList.contains("grouped")).toBe(false);
    expect(heads(element)).toHaveLength(4);
  });
});

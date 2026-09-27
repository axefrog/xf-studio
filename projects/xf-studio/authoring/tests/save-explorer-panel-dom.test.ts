// The Save Explorer panel over the light DOM harness and the real service on a synthetic save: the list appears when the panel is first
// shown, a row opens its save, the tree is a keyboard tree (arrows move focus, Right opens, Enter shows a node), a node's objects open
// the inspector, and the mod-data view lists namespaces. It reaches the service only through its module context.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SaveExplorerActions, saveExplorerFacade, type SaveExplorerDevice, type SaveExplorerFacade } from "../src/features/save-explorer";
import { explorerPanel } from "../src/features/save-explorer/view/panel";
import type { ModuleViewContext } from "../src/studio-ui/views/feature-view";
import { installLightDom, lightDocument, lightEvent, type LightElement, uninstallLightDom } from "./light-dom";
import { syntheticSave } from "./fixtures/synthetic-explorer-save";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());
const settle = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));

function harness() {
  const device: SaveExplorerDevice = {
    list: async () => ({ available: true, saves: [{ folder: "ManualSave-7", kind: "manual", savedAt: "2026-09-20T10:00:00.000Z", location: "Watson", level: 3,
      lifePath: "Nomad", gameVersion: "2.31", saveVersion: 269, bytes: 100, screenshot: false, modded: false }] }),
    read: async () => syntheticSave(), pick: async () => undefined, thumbnail: () => null,
    names: async () => ({ engine: { enums: ["gameStatIDType"], bitfields: [], classes: [], properties: [] },
      scripts: { available: true, names: ["DoorControllerPS", "m_isOpen", "SomeMod.OutfitState", "App.DynamicEntitySystemPS"] } }),
  };
  const facade = saveExplorerFacade(new SaveExplorerActions(device, () => Promise.resolve()));
  const toasts: string[] = [];
  let panel!: ReturnType<typeof explorerPanel>;
  const ctx: ModuleViewContext<SaveExplorerFacade> = {
    facade,
    dispatch: async (action, _options) => { const outcome = await facade.dispatch(action as never); if (!outcome.ok) toasts.push(outcome.message); panel.update(undefined as never); return outcome.ok; },
    feedback: { toast: (_tone, _source, message) => { toasts.push(message); return undefined as never; }, announce: () => {}, record: () => undefined as never },
    anchors: { register: () => () => {} }, reveal: () => {}, links: { open: async () => ({ ok: true }) }, changed: () => panel.update(undefined as never),
  };
  panel = explorerPanel(ctx);
  facade.subscribe(() => panel.update(undefined as never));
  const root = panel.spec.element as unknown as LightElement;
  return { panel, facade, root, toasts };
}
const texts = (elements: LightElement[]) => elements.map(element => element.textContent);

describe("Save Explorer panel", () => {
  test("lists saves when first shown, opens one, and shows its tree with sizes and status", async () => {
    const { panel, root, facade } = harness();
    panel.update(undefined as never);
    expect(root.querySelectorAll("button.save-row")).toHaveLength(0);
    panel.spec.visibility?.(true);
    await settle();
    const rows = root.querySelectorAll("button.save-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Watson");
    expect(rows[0]!.getAttribute("aria-label")).toContain("Manual save");
    rows[0]!.dispatchEvent(lightEvent("click"));
    await settle(20);
    expect(facade.snapshot().open.phase).toBe("ready");
    const items = root.querySelectorAll("li.save-tree-row");
    expect(items.map(item => item.querySelector("span.save-tree-name")?.textContent)).toEqual(["TypeDatabase_v2", "PersistencySystem2", "inventory",
      "ScriptableSystemsContainer", "StatsSystem", "TimeSystem"]);
    expect(items[2]!.getAttribute("aria-expanded")).toBe("false");
    expect(items.every(item => item.getAttribute("role") === "treeitem")).toBe(true);
    expect(items[0]!.getAttribute("aria-selected")).toBe("true");
    expect(root.querySelector(".save-node-title")?.textContent).toBe("TypeDatabase_v2");
  });

  test("the tree is keyboard-operable: arrows move focus, Right opens a container, Enter shows the node", async () => {
    const { panel, root, facade } = harness();
    panel.spec.visibility?.(true);
    await settle();
    root.querySelector("button.save-row")!.dispatchEvent(lightEvent("click"));
    await settle(20);
    const tree = root.querySelector("ul.save-tree")!;
    const key = (name: string) => tree.dispatchEvent(lightEvent("keydown", { key: name } as never));
    key("ArrowDown"); key("ArrowDown");
    await settle();
    const focused = () => root.querySelector("li.save-tree-row[tabindex=\"0\"]")!;
    expect(focused().getAttribute("data-node")).toBe("2");
    key("ArrowRight");
    await settle();
    expect(root.querySelectorAll("li.save-tree-row")).toHaveLength(7);
    expect(focused().getAttribute("aria-expanded")).toBe("true");
    key("ArrowRight");
    await settle();
    expect(focused().getAttribute("data-node")).toBe("3");
    key("Enter");
    await settle();
    expect(facade.snapshot().selection.node).toBe(3);
    expect(root.querySelector("pre.save-hex")?.textContent).toContain("05 05 05");
    key("ArrowLeft");
    await settle();
    expect(focused().getAttribute("data-node")).toBe("2");
    key("End");
    await settle();
    expect(focused().getAttribute("data-node")).toBe("6");
  });

  test("a package's objects open the inspector; handles link to their target; Mod data lists namespaces", async () => {
    const { panel, root, facade } = harness();
    panel.spec.visibility?.(true);
    await settle();
    root.querySelector("button.save-row")!.dispatchEvent(lightEvent("click"));
    await settle(20);
    const systemsId = facade.tree().find(row => row.name === "ScriptableSystemsContainer")!.id;
    (root.querySelector(`li.save-tree-row[data-node="${systemsId}"]`) as LightElement).dispatchEvent(lightEvent("click"));
    await settle();
    const objects = root.querySelector("ul.save-objects")!.querySelectorAll("button");
    expect(texts(objects)).toEqual(["#0 OutfitSystem", "#1 SomeMod.OutfitStatePartly read"]);
    objects[0]!.dispatchEvent(lightEvent("click"));
    await settle();
    const inspector = () => root.querySelector("div.save-object")!;
    expect(inspector().querySelector("h4.save-node-title")?.textContent).toBe("OutfitSystem");
    const link = inspector().querySelector("button.link-button")!;
    expect(link.textContent).toBe("→ SomeMod.OutfitState #1");
    link.dispatchEvent(lightEvent("click"));
    await settle();
    expect(inspector().querySelector("h4.save-node-title")?.textContent).toBe("SomeMod.OutfitState");
    expect(inspector().textContent).toContain("Night out");
    await facade.dispatch({ kind: "saves.setView", view: "mods" });
    await settle();
    expect(texts(root.querySelectorAll("details.save-mod").map(group => group.querySelector("strong")!))).toEqual(["App", "SomeMod"]);
    expect(lightDocument.body).toBeDefined();
  });
});

// The Poses panel over the light DOM harness and the real service with a fake host and motion: groups open and close, one click applies a
// pose, the star keeps a favourite, the tree is a keyboard tree (Down from search, arrows, Right opens, Enter applies, F stars), a greyed
// pose says why, the outfit
// note offers Show them, and a needs-setup catalogue offers Settings › Game. It reaches the service only through its module context.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PoseLibraryActions, poseLibraryFacade, type PoseLibraryDevice, type PoseLibraryFacade, type PoseMotionPort, type PoseStage,
  defaultPosePreferences } from "../src/features/poses";
import { posesPanel } from "../src/features/poses/view/panel";
import type { ModuleViewContext } from "../src/studio-ui/views/feature-view";
import { installLightDom, lightDocument, lightEvent, type LightElement, uninstallLightDom } from "./light-dom";
import { CATALOGUE } from "./fixtures/pose-listing";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());
const settle = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));

function harness(options: { phase?: string; worn?: string[] } = {}) {
  const calls: string[] = [];
  let pose: { id: string; label: string; moves: boolean } | null = null;
  const motion: PoseMotionPort = {
    snapshot: () => ({ idle: true, pose, poseLoading: false }), poseCapability: () => ({ available: true }),
    holdPose: async (next, sample) => { const value = await sample; pose = next; calls.push(`hold ${value.id}`); return true; },
    pendingPose: () => null, dropPendingPose: () => {}, bodyCapability: () => ({ available: true }), setBody: idle => { pose = null; calls.push(idle ? "idle" : "still"); },
  };
  const stage: PoseStage = { bodyGender: () => "female", wornTags: () => options.worn ?? [], motion: () => motion, frame: () => ({ available: true }),
    frameCapability: () => ({ available: true }), subscribe: () => () => {} };
  const device: PoseLibraryDevice = {
    catalogue: async request => request.method === "GET" && request.query.pose ? { ok: true, status: 200, data: { schema: "xfs/pose-sample-1", id: request.query.pose } }
      : { ok: true, status: 200, data: options.phase === "needs-setup" ? { schema: "xfs/pose-catalogue-state-1", phase: "needs-setup", message: "Poses come from your game. Choose your game folder in Settings › Game." }
        : { schema: "xfs/pose-catalogue-state-1", phase: "ready", message: "", catalogue: CATALOGUE } },
    preferences: { load: async () => ({ revision: 0, preferences: defaultPosePreferences() }), save: async (revision, preferences) => ({ ok: true, status: 200, data: { revision: revision + 1, preferences } }) },
    wait: () => Promise.resolve(),
  };
  const facade = poseLibraryFacade(new PoseLibraryActions(device, stage));
  const revealed: string[] = [];
  let panel!: ReturnType<typeof posesPanel>;
  const ctx: ModuleViewContext<PoseLibraryFacade> = {
    facade,
    dispatch: async action => { const outcome = await facade.dispatch(action as never); panel.update(undefined as never); return outcome.ok; },
    feedback: { toast: () => undefined as never, announce: () => {}, record: () => undefined as never },
    anchors: { register: () => () => {} }, reveal: () => {}, openSettings: section => { revealed.push(`settings:${section}`); }, links: { open: async () => ({ ok: true }) }, changed: () => panel.update(undefined as never),
  };
  panel = posesPanel(ctx);
  facade.subscribe(() => panel.update(undefined as never));
  return { panel, facade, root: panel.spec.element as unknown as LightElement, calls, revealed };
}
const key = (target: LightElement, name: string) => target.dispatchEvent(lightEvent("keydown", { key: name }));
/** Items in visual order: the tree positions reused items by their offset, so page order isn't visual order. */
const top = (item: LightElement) => Number(/translateY\((\d+)px\)/.exec((item as unknown as HTMLElement).style.transform ?? "")?.[1] ?? 0);
const byTop = (items: LightElement[]) => [...items].sort((a, b) => top(a) - top(b));
const rows = (root: LightElement) => byTop(root.querySelectorAll(".tree-row"));
const groups = (root: LightElement) => byTop(root.querySelectorAll(".tree-group"));
const label = (item: LightElement) => item.querySelector(".tree-label")?.textContent;
const poseId = (item: LightElement) => item.dataset.id!.split("")[1];
const click = (item: LightElement) => (item as unknown as HTMLElement).click();

describe("Poses panel", () => {
  test("lists categories collapsed with counts and packs; opening one shows its poses; one click applies", async () => {
    const { root, calls, facade } = harness();
    await settle();
    expect(groups(root).map(label)).toEqual(["Idle", "bv_serene_f"]);
    expect(groups(root)[1]!.querySelector(".tree-secondary")?.textContent).toBe("Serene Poses");
    expect(groups(root).every(group => group.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(root.querySelector(".poses-count")?.textContent).toBe("4 poses in 2 categories");
    click(groups(root)[1]!);
    await settle();
    expect(rows(root).map(label)).toEqual(["01", "02"]);
    expect(rows(root)[0]!.getAttribute("aria-label")).toContain("Moves");
    // The pose without its clip is greyed with its reason, and a click does nothing.
    expect(rows(root)[1]!.getAttribute("aria-disabled")).toBe("true");
    expect(rows(root)[1]!.getAttribute("title")).toContain("isn't installed");
    click(rows(root)[1]!);
    click(rows(root)[0]!);
    await settle();
    expect(calls).toEqual(["hold PhotoModePoses.sera_01"]);
    expect(facade.snapshot().current?.id).toBe("PhotoModePoses.sera_01");
    // Recent appears first, and the applied row is marked current there.
    expect(label(groups(root)[0]!)).toBe("Recent");
    expect(root.querySelectorAll(".tree-row").filter(row => row.getAttribute("aria-current") === "true").map(poseId)).toEqual(["PhotoModePoses.sera_01"]);
    expect(root.querySelector(".poses-current")?.textContent).toBe("V holds 01.");
    // The star adds it to Favourites.
    click(rows(root).find(row => poseId(row) === "PhotoModePoses.sera_02")!.querySelector(".favourite-toggle")!);
    await settle();
    expect(facade.snapshot().preferences.favourites.map(item => item.id)).toEqual(["PhotoModePoses.sera_02"]);
  });

  test("keyboard: Down from search enters the tree, arrows move, Right opens, Enter applies, F stars", async () => {
    const { root, calls, facade } = harness();
    await settle();
    const input = root.querySelector("input.search-input")!;
    key(input, "ArrowDown");
    const tree = root.querySelector(".poses-tree")!;
    expect(label(lightDocument.activeElement!)).toBe("Idle");
    key(tree, "ArrowRight");
    await settle();
    key(tree, "ArrowDown");
    expect(label(lightDocument.activeElement!)).toBe("Standing");
    key(tree, "ArrowDown");
    key(tree, "Enter");
    await settle();
    expect(calls).toEqual(["hold PhotoModePoses.idle_lean"]);
    key(tree, "f");
    await settle();
    expect(facade.snapshot().preferences.favourites.map(item => item.id)).toEqual(["PhotoModePoses.idle_lean"]);
  });

  test("search opens every group with a match; the outfit note offers Show them", async () => {
    const { root, facade } = harness({ worn: ["Coat"] });
    await settle();
    const input = root.querySelector("input.search-input")! as unknown as { value: string; dispatchEvent(event: unknown): void };
    input.value = "serene";
    input.dispatchEvent(lightEvent("input"));
    await settle(200);
    expect(rows(root).map(poseId)).toEqual(["PhotoModePoses.sera_01", "PhotoModePoses.sera_02"]);
    expect(root.querySelector(".poses-count")?.textContent).toBe("2 poses match");
    const outfit = root.querySelector(".poses-outfit")!;
    expect(outfit.hidden).toBe(false);
    expect(outfit.textContent).toContain("1 pose is hidden while V wears a coat");
    click(outfit.querySelector("button")!);
    await settle();
    expect(facade.snapshot().showFiltered).toBe(true);
    expect(outfit.textContent).toContain("Hide them");
  });

  test("without a game folder it says so and offers Settings › Game", async () => {
    const { root, revealed } = harness({ phase: "needs-setup" });
    await settle();
    expect(root.querySelector(".poses-state")?.textContent).toContain("Poses come from your game");
    click(root.querySelector(".poses-state")!.querySelector("button")!);
    expect(revealed).toEqual(["settings:game"]);
  });
});

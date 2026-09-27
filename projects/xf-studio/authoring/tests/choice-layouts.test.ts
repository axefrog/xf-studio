// Choice previews phase 2 (research/character-customization/choice-previews-design.md §7): the pictures' layouts (grid, list, details
// with its large picture), which choice's turntable the list wants, the turntable's hover and drag (a drag never chooses, a click still
// does at once), and the listbox's PageUp/PageDown and type-ahead.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { CcPanelChoice } from "../src/cc-panel";
import type { ChoicePreviewRow } from "../src/choice-preview-service";
import { installLightDom, lightDocument, lightEvent, type LightElement, uninstallLightDom } from "./light-dom";

beforeAll(() => installLightDom());
beforeEach(async () => (await import("../src/studio-ui/view-state")).bindViewState());
afterAll(() => uninstallLightDom());

const LABELS = ["Afro", "Bob", "Braids", "Bun", "Curly", "Dreads", "Émile", "Fringe", "Mohawk", "Pixie", "Ponytail", "Quiff", "Topknot", "Undercut"];
const choices: CcPanelChoice[] = LABELS.map((label, position) => ({ key: `k${position}`, position, label, off: false, color: null, mod: position % 2 ? 0 : -1 }));
const row = (over: Partial<ChoicePreviewRow> = {}): ChoicePreviewRow => ({ kind: "hair", urls: new Map([[1, "blob:still-1"], [3, "blob:still-3"]]),
  spins: new Map([[3, "blob:spin-3"]]), frames: 24, none: new Set(), busy: false, ...over });
const input = (layout: "grid" | "list" | "details", size: "s" | "m" | "l" = "m", extra = {}) => ({ option: "head/hair", query: "", label: "Hairstyle", grid: false,
  choices, selected: 1, mods: ["Sample Hair Pack"], loading: false, error: null, groups: null,
  fetch: new Map([[0, "r" as const], [1, "r" as const], [2, "n" as const]]), previews: { size, layout, row: row() }, ...extra });

async function list(layout: "grid" | "list" | "details" = "grid", size: "s" | "m" | "l" = "m") {
  const { ChoiceList } = await import("../src/studio-ui/panels/character-choices");
  const chosen: CcPanelChoice[] = [], spins: (number | null)[] = [];
  const view = new ChoiceList("l", value => chosen.push(value), () => {}, position => spins.push(position));
  const element = view.element as unknown as LightElement;
  lightDocument.body.append(element);
  view.update(input(layout, size));
  const item = (position: number) => element.querySelector(`[data-position="${position}"]`)!;
  return { view, element, chosen, spins, item, listbox: element.querySelector(".cc-choices")! };
}
const key = (target: LightElement, name: string, extra = {}) => target.dispatchEvent(lightEvent("keydown", { key: name, ...extra }));
const pointer = (target: LightElement, type: string, extra = {}) => target.dispatchEvent(lightEvent(type, { pointerType: "mouse", pointerId: 1, button: 0, buttons: 1, clientX: 0, ...extra }));

describe("layouts", () => {
  test("grid keeps its sizes; list and details are rows that say where each choice comes from, details its prepared state too", async () => {
    const { view, element, listbox, item } = await list("grid", "l");
    expect(listbox.getAttribute("data-layout")).toBe("grid");
    expect(listbox.getAttribute("data-size")).toBe("l");
    expect(item(1).querySelector(".pv-meta")!.textContent).toBe("");
    const before = item(1);
    view.update(input("list"));
    expect(listbox.getAttribute("data-layout")).toBe("list");
    expect(listbox.hasAttribute("data-size")).toBe(false);
    // The same items (focus and scroll stay with them); a row with one maker says its source once, in the row, not on every choice.
    expect(item(1)).toBe(before);
    expect(item(1).querySelector(".pv-meta")!.textContent).toBe("");
    expect(item(2).querySelector(".pv-state")!.textContent).toBe("");
    view.update(input("details"));
    expect(element.getAttribute("data-layout")).toBe("details");
    expect(item(2).querySelector(".pv-state")!.textContent).toBe("Not prepared yet");
    expect(item(0).querySelector(".pv-state")!.textContent).toBe("");
  });

  test("a row's source shows only where its heading doesn't say it: the pooled 'Other mods', not under its maker's own heading", async () => {
    const { ChoiceList } = await import("../src/studio-ui/panels/character-choices");
    const { BASE_GAME_GROUP } = await import("../src/cc-panel");
    const view = new ChoiceList("g", () => {});
    lightDocument.body.append(view.element as unknown as LightElement);
    const grouped = { list: [BASE_GAME_GROUP, { label: "Sample Hair Pack", kind: "mod" as const }, { label: "Other Pack", kind: "mod" as const }], modGroups: [1, 2], pooled: [2] };
    const mixed = choices.map(choice => ({ ...choice, mod: choice.position === 5 ? 1 : choice.mod }));
    view.update({ ...input("list"), choices: mixed, mods: ["Sample Hair Pack", "Other Pack"], groups: grouped });
    const meta = (position: number) => (view.element as unknown as LightElement).querySelector(`[data-position="${position}"]`)!.querySelector(".pv-meta")!.textContent;
    expect(meta(0)).toBe("");
    expect(meta(1)).toBe("");
    expect(meta(5)).toBe("From Other Pack");
  });

  test("details: the large picture sits outside the listbox and shows the hovered choice, else the focused one, else the V's", async () => {
    const { view, element, listbox, item } = await list("details");
    const stage = element.querySelector(".pv-stage")!;
    expect(stage).not.toBeNull();
    expect(listbox.contains(stage)).toBe(false);
    expect(stage.getAttribute("aria-hidden")).toBe("true");
    const label = () => stage.querySelector(".pv-label")!.textContent;
    expect(label()).toBe("Bob");
    item(3).focus();
    expect(label()).toBe("Bun");
    pointer(item(5), "pointerover");
    expect(label()).toBe("Dreads");
    pointer(listbox, "pointerleave");
    expect(label()).toBe("Bun");
    view.update(input("grid"));
    expect(element.querySelector(".pv-stage")).toBeNull();
  });

  test("the turntable wanted: the hovered tile in the large grid, none in the smaller sizes, the shown choice in details", async () => {
    const small = await list("grid", "m");
    pointer(small.item(3), "pointerover");
    expect(small.spins).toEqual([]);
    const large = await list("grid", "l");
    pointer(large.item(3), "pointerover");
    pointer(large.listbox, "pointerleave");
    expect(large.spins).toEqual([3, null]);
    const details = await list("details");
    // The V's choice is shown large at once, so its turntable is wanted.
    expect(details.spins).toEqual([1]);
    pointer(details.item(4), "pointerover");
    expect(details.spins.at(-1)).toBe(4);
  });
});

describe("the turntable", () => {
  test("a drag turns the picture and never chooses; a click without a drag chooses at once", async () => {
    const { item, chosen } = await list("grid", "l");
    const frame = item(3).querySelector(".pv-frame")!;
    expect(frame.hasAttribute("data-spinnable")).toBe(true);
    pointer(frame, "pointerenter");
    pointer(frame, "pointerdown", { clientX: 10 });
    // The strip loads while it is wanted.
    const strip = frame.querySelector(".pv-strip")!;
    expect((strip as unknown as { src?: string }).src).toBe("blob:spin-3");
    strip.dispatchEvent(lightEvent("load"));
    pointer(frame, "pointermove", { clientX: 12 });
    expect(frame.hasAttribute("data-spin")).toBe(false);
    pointer(frame, "pointermove", { clientX: 40 });
    expect(frame.hasAttribute("data-spin")).toBe(true);
    expect(frame.querySelector(".pv-spin")!.hidden).toBe(false);
    pointer(frame, "pointerup", { clientX: 40 });
    frame.dispatchEvent(lightEvent("click"));
    expect(chosen).toEqual([]);
    // Leaving puts the still back and drops the strip.
    pointer(frame, "pointerleave");
    expect(frame.hasAttribute("data-spin")).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    item(3).click();
    expect(chosen.map(choice => choice.position)).toEqual([3]);
  });

  test("resting the pointer turns it after the dwell; the medium grid never turns", async () => {
    const { SPIN } = await import("../src/studio-ui/components/choice-preview");
    const { item } = await list("grid", "l");
    const frame = item(3).querySelector(".pv-frame")!;
    pointer(frame, "pointerenter");
    frame.querySelector(".pv-strip")!.dispatchEvent(lightEvent("load"));
    expect(frame.hasAttribute("data-spin")).toBe(false);
    await new Promise(resolve => setTimeout(resolve, SPIN.dwellMs + 30));
    expect(frame.hasAttribute("data-spin")).toBe(true);
    pointer(frame, "pointerleave");
    expect(frame.hasAttribute("data-spin")).toBe(false);
    const medium = await list("grid", "m");
    expect(medium.item(3).querySelector(".pv-frame")!.hasAttribute("data-spinnable")).toBe(false);
  });

  test("under reduced motion nothing turns by itself, but a drag still turns it", async () => {
    const { SPIN } = await import("../src/studio-ui/components/choice-preview");
    const saved = (globalThis as { matchMedia?: unknown }).matchMedia;
    (globalThis as { matchMedia?: unknown }).matchMedia = (query: string) => ({ matches: query.includes("reduce") });
    try {
      const { item } = await list("grid", "l");
      const frame = item(3).querySelector(".pv-frame")!;
      pointer(frame, "pointerenter");
      frame.querySelector(".pv-strip")!.dispatchEvent(lightEvent("load"));
      await new Promise(resolve => setTimeout(resolve, SPIN.dwellMs + 30));
      expect(frame.hasAttribute("data-spin")).toBe(false);
      pointer(frame, "pointerdown", { clientX: 0 });
      pointer(frame, "pointermove", { clientX: 30 });
      expect(frame.hasAttribute("data-spin")).toBe(true);
      pointer(frame, "pointerup", { clientX: 30 });
      pointer(frame, "pointerleave");
    } finally { (globalThis as { matchMedia?: unknown }).matchMedia = saved; }
  });
});

describe("keyboard", () => {
  test("PageDown and PageUp move focus by a screenful without choosing", async () => {
    const { item, chosen } = await list("list");
    item(0).focus();
    key(item(0), "PageDown");
    // Without layout a screenful is ten rows.
    expect(lightDocument.activeElement).toBe(item(10));
    key(item(10), "PageDown");
    expect(lightDocument.activeElement).toBe(item(13));
    key(item(13), "PageUp");
    expect(lightDocument.activeElement).toBe(item(3));
    expect(chosen).toEqual([]);
  });

  test("type-ahead: a letter goes to the next label starting with it, again cycles, a word narrows, accents are ignored", async () => {
    const { item, chosen } = await list("grid", "m");
    item(0).focus();
    key(item(0), "b");
    expect(lightDocument.activeElement).toBe(item(1));
    key(item(1), "b");
    expect(lightDocument.activeElement).toBe(item(2));
    await new Promise(resolve => setTimeout(resolve, 750));
    key(item(2), "b"); key(lightDocument.activeElement!, "u");
    expect(lightDocument.activeElement).toBe(item(3));
    await new Promise(resolve => setTimeout(resolve, 750));
    key(item(3), "e");
    expect(lightDocument.activeElement).toBe(item(6));
    // A space outside a word chooses (the button's own behaviour): type-ahead leaves it alone.
    const space = lightEvent("keydown", { key: " " });
    await new Promise(resolve => setTimeout(resolve, 750));
    item(6).dispatchEvent(space);
    expect(space.defaultPrevented).toBeFalsy();
    expect(chosen).toEqual([]);
  });

  test("the library's choice list has type-ahead and PageUp/PageDown too", async () => {
    const { ChoiceList } = await import("../src/studio-ui/components/choice-list");
    const choice = new ChoiceList({ label: "Idle", onSelect: () => {}, options: LABELS.map(label => ({ value: label, label })) });
    lightDocument.body.append(choice.element as unknown as LightElement);
    const items = (choice.list as unknown as LightElement).querySelectorAll(".choice");
    items[0]!.focus();
    key(items[0]!, "p");
    expect(lightDocument.activeElement).toBe(items[9]!);
    key(items[9]!, "PageUp");
    expect(lightDocument.activeElement).toBe(items[0]!);
  });
});

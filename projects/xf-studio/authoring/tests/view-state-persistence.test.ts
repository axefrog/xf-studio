// Remembered view state (view-state.ts, scroll-anchor.ts, UI-133): folds and scroll positions survive a reload. Scroll positions are
// remembered as the element at the container's top edge plus its clip offset, and restored once the content is there, over a light DOM
// with a small stacking layout (light-dom.ts has no layout of its own).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { parseUIPreferences, UIPreferenceActions, type ScrollAnchor } from "../src/ui-preferences";
import { installLightDom, lightEvent, type LightElement, uninstallLightDom } from "./light-dom";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());

const viewState = () => import("../src/studio-ui/view-state");
const anchors = () => import("../src/studio-ui/scroll-anchor");
beforeEach(async () => { (await viewState()).bindViewState(); document.body.replaceChildren(); });

/** The container's top edge in the viewport, and its visible height. */
const EDGE = 100, VIEW = 300;
/**
 * A scroll container whose keyed children stack top to bottom at their `data-height` (a child with keyed children of its own is as tall
 * as they are); `scrollTop` clamps to the content like a browser's.
 */
function scroller() {
  const container = document.createElement("div") as unknown as LightElement & { scrollTop: number; clientHeight: number };
  let scroll = 0;
  const height = (element: LightElement): number => element.hasAttribute("hidden") ? 0
    // A choice (a picture tile) is 40 px.
    : element.getAttribute("role") === "option" ? 40
    : element.children.length ? element.children.reduce((sum, child) => sum + height(child), 0) : Number(element.getAttribute("data-height") ?? 0);
  const content = () => container.children.reduce((sum, child) => sum + height(child), 0);
  /** The element's top within the content. */
  const offsetOf = (target: LightElement): number => {
    let y = 0;
    const walk = (parent: LightElement): boolean => {
      for (const child of parent.children) {
        if (child === target) return true;
        if (child.contains(target)) return walk(child);
        y += height(child);
      }
      return false;
    };
    walk(container);
    return y;
  };
  Object.defineProperty(container, "scrollTop", { get: () => scroll, set: (value: number) => { scroll = Math.max(0, Math.min(Math.max(0, content() - VIEW), value)); } });
  Object.defineProperty(container, "clientHeight", { get: () => VIEW });
  container.getBoundingClientRect = () => ({ x: 0, y: EDGE, left: 0, top: EDGE, right: 200, bottom: EDGE + VIEW, width: 200, height: VIEW });
  const item = (key: string, rowHeight: number, ...children: LightElement[]) => {
    const element = document.createElement("div") as unknown as LightElement;
    element.setAttribute("data-view-key", key);
    if (!children.length) element.setAttribute("data-height", String(rowHeight));
    for (const child of children) element.append(child as never);
    element.getBoundingClientRect = () => {
      const top = EDGE + offsetOf(element) - scroll, tall = height(element);
      return { x: 0, y: top, left: 0, top, right: 200, bottom: top + tall, width: 200, height: tall };
    };
    return element;
  };
  /** Where an element's top is, relative to the container's top edge (any element in it, keyed or not). */
  const top = (element: LightElement) => offsetOf(element) - scroll;
  document.body.append(container as never);
  return { container: container as unknown as HTMLElement & LightElement, item, top };
}
const rows = (make: ReturnType<typeof scroller>["item"], names: string, rowHeight = 40) => names.split("").map(name => make(name, rowHeight));

describe("scroll anchors", () => {
  test("the element at the top edge and how far it is scrolled past (its clip offset); the ones before it as fallbacks", async () => {
    const { captureAnchor } = await anchors();
    const s = scroller();
    s.container.append(...rows(s.item, "abcdefghij") as never[]);
    expect(captureAnchor(s.container)).toEqual({ top: 0 });
    // b starts at 40: scrolled to 54, b is 14 px past the edge.
    s.container.scrollTop = 54;
    expect(captureAnchor(s.container)).toEqual({ key: "b", offset: 14, near: [{ key: "a", offset: 0 }], top: 54 });
  });

  test("inside a section the deepest element anchors; the section keeps how far it is scrolled past", async () => {
    const { captureAnchor } = await anchors();
    const s = scroller();
    s.container.append(s.item("intro", 100), s.item("section:Hair", 0, ...rows(s.item, "pqrs", 50)), s.item("outro", 400));
    s.container.scrollTop = 100 + 50 + 20;
    expect(captureAnchor(s.container)).toEqual({ key: "q", offset: 20, near: [{ key: "p", offset: 0 }, { key: "section:Hair", offset: 70 }, { key: "intro", offset: 0 }], top: 170 });
  });

  test("a restore brings the same element back to the top, corrected by its clip offset, even when content above it changed", async () => {
    const { restoreAnchor } = await anchors();
    const s = scroller();
    // Since the anchor was taken, a row above grew and another was added.
    const [a, b, c] = rows(s.item, "abc");
    a!.setAttribute("data-height", "90");
    s.container.append(s.item("new", 30), a!, b!, c!, ...rows(s.item, "defghij") as never[]);
    const anchor: ScrollAnchor = { key: "b", offset: 14, near: [{ key: "a", offset: 0 }], top: 54 };
    expect(restoreAnchor(s.container, anchor)).toBe("exact");
    expect(s.top(b!)).toBe(-14);
  });

  test("a missing anchor falls back to the nearest element before it, then to the plain position", async () => {
    const { restoreAnchor } = await anchors();
    const s = scroller();
    const made = rows(s.item, "acdefghij");
    s.container.append(...made as never[]);
    const anchor: ScrollAnchor = { key: "b", offset: 14, near: [{ key: "x", offset: 0 }, { key: "a", offset: 0 }], top: 54 };
    expect(restoreAnchor(s.container, anchor)).toBe("near");
    expect(s.top(made[0]!)).toBe(0);
    // Nothing it knows: the plain scroll position, and more may still come.
    const t = scroller();
    t.container.append(...rows(t.item, "klmnopqrst") as never[]);
    expect(restoreAnchor(t.container, anchor)).toBe("wait");
    expect(t.container.scrollTop).toBe(54);
  });

  test("content that arrives later: the restore waits, then lands on the anchor; nothing is recorded meanwhile", async () => {
    const { ScrollMemory } = await anchors();
    const { MemoryViewState } = await viewState();
    const store = new MemoryViewState();
    const stored: ScrollAnchor = { key: "g", offset: 14, near: [{ key: "f", offset: 0 }], top: 254 };
    store.setAnchor("panel:test", stored);
    const s = scroller();
    s.container.append(...rows(s.item, "ab") as never[]);
    const memory = new ScrollMemory(s.container, "panel:test", { store: () => store, observe: false, delayMs: 0 });
    expect(memory.restoring).toBe(true);
    // Its own scrolling is not the person's position.
    s.container.dispatchEvent(lightEvent("scroll"));
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(store.anchor("panel:test")).toEqual(stored);
    // The rest of the content arrives (a catalogue loaded).
    const late = rows(s.item, "cdefghijklmnopqrst");
    s.container.append(...late as never[]);
    memory.contentChanged();
    expect(memory.restoring).toBe(false);
    expect(s.top(late[4]!)).toBe(-14);
    // From now on scrolling is recorded (debounced).
    s.container.scrollTop = 45;
    s.container.dispatchEvent(lightEvent("scroll"));
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(store.anchor("panel:test")).toEqual({ key: "b", offset: 5, near: [{ key: "a", offset: 0 }], top: 45 });
    memory.dispose();
  });

  test("the person scrolling before the content arrives drops the pending restore", async () => {
    const { ScrollMemory } = await anchors();
    const { MemoryViewState } = await viewState();
    const store = new MemoryViewState();
    store.setAnchor("panel:test", { key: "g", offset: 14, top: 254 });
    const s = scroller();
    s.container.append(...rows(s.item, "abcdefghij") as never[]);
    const late = s.item("late", 40);
    const memory = new ScrollMemory(s.container, "panel:test", { store: () => store, observe: false });
    // g is there but the content below it isn't yet: it can't reach the top, so the restore keeps waiting.
    s.container.replaceChildren(...rows(s.item, "abcdefg") as never[]);
    memory.contentChanged();
    expect(memory.restoring).toBe(true);
    s.container.dispatchEvent(lightEvent("wheel"));
    expect(memory.restoring).toBe(false);
    s.container.append(late as never, ...rows(s.item, "hijk") as never[]);
    s.container.scrollTop = 10;
    memory.contentChanged();
    expect(s.container.scrollTop).toBe(10);
    memory.dispose();
  });

  test("tearing down records at once (a layout change re-renders the container)", async () => {
    const { ScrollMemory } = await anchors();
    const { MemoryViewState } = await viewState();
    const store = new MemoryViewState();
    const s = scroller();
    s.container.append(...rows(s.item, "abcdefghijklmnop") as never[]);
    const memory = new ScrollMemory(s.container, "panel:test", { store: () => store, observe: false, delayMs: 10_000 });
    s.container.scrollTop = 130;
    s.container.dispatchEvent(lightEvent("scroll"));
    expect(store.anchor("panel:test")).toBeUndefined();
    memory.dispose();
    expect(store.anchor("panel:test")).toMatchObject({ key: "d", offset: 10, top: 130 });
  });
});

describe("a choice never moves the view", () => {
  test("a hold keeps the top edge through programmatic scrolls and content moving above; the person scrolling ends it", async () => {
    const { ScrollMemory } = await anchors();
    const { MemoryViewState } = await viewState();
    const s = scroller();
    s.container.append(...rows(s.item, "abcdefghijklmnop") as never[]);
    const memory = new ScrollMemory(s.container, "panel:test", { store: () => new MemoryViewState(), observe: false });
    s.container.scrollTop = 214;
    memory.hold(10_000);
    expect(memory.restoring).toBe(true);
    // Something scrolls it (a focus, a reveal): put back at once.
    s.container.scrollTop = 300;
    s.container.dispatchEvent(lightEvent("scroll"));
    expect(s.container.scrollTop).toBe(214);
    // A line appears above: the same rows stay at the top.
    s.container.insertBefore(s.item("status", 30) as never, s.container.childNodes[0] as never);
    memory.contentChanged();
    expect(s.container.scrollTop).toBe(244);
    // The person scrolls: theirs.
    s.container.dispatchEvent(lightEvent("wheel"));
    s.container.scrollTop = 20;
    s.container.dispatchEvent(lightEvent("scroll"));
    expect(memory.restoring).toBe(false);
    expect(s.container.scrollTop).toBe(20);
    memory.dispose();
  });

  test("clicking a picture in Character › Hairstyle leaves the panel's scroll position where it was", async () => {
    const { ScrollMemory } = await anchors();
    const { MemoryViewState } = await viewState();
    const { ChoiceList } = await import("../src/studio-ui/panels/character-choices");
    const s = scroller();
    const chosen: string[] = [];
    const list = new ChoiceList("hair", choice => chosen.push(choice.key));
    const choices = Array.from({ length: 30 }, (_, position) => ({ key: `h${position}`, position, label: `Hairstyle ${position}`, off: false, color: null, mod: -1 }));
    const input = (option: string, selected: number) => ({ option, query: "", label: "Hairstyle", grid: false, choices, selected, mods: [], loading: false, error: null,
      previews: { size: "m" as const, row: null } });
    s.container.append(...rows(s.item, "abcde") as never[], s.item("character:row:head/hairstyle", 0, list.element as unknown as LightElement) as never,
      ...rows(s.item, "fghij") as never[]);
    list.update(input("head/hairstyle", 2));
    const memory = new ScrollMemory(s.container, "panel:character", { store: () => new MemoryViewState(), observe: false });
    // Scrolled well into the pictures.
    s.container.scrollTop = 200 + 12 * 40 + 7;
    const items = (list.element as unknown as LightElement).querySelectorAll("[role=option]");
    items[14]!.click();
    expect(chosen).toEqual(["h14"]);
    // The choice switches the row's option (a rebuild), a status line appears above and the V's choice is revealed: nothing moves.
    list.update(input("head/hairstyle_alt", 14));
    s.container.insertBefore(s.item("status", 30) as never, s.container.childNodes[0] as never);
    memory.contentChanged();
    const tile = (list.element as unknown as LightElement).querySelectorAll("[role=option]")[12]!;
    expect(s.top(tile)).toBe(-7);
    s.container.scrollTop = 0;
    s.container.dispatchEvent(lightEvent("scroll"));
    expect(s.top(tile)).toBe(-7);
    memory.dispose();
  });
});

describe("a virtualised tree", () => {
  test("scrolls to an item by ID, and restores its remembered anchor once its rows arrive", async () => {
    const { TreeView } = await import("../src/studio-ui/components/tree-view");
    const { viewState: store } = await viewState();
    store().setAnchor("tree:Poses", { key: "r:p7", offset: 10, near: [{ key: "r:p6", offset: 0 }, { key: "g:all", offset: 0 }], top: 234 });
    const tree = new TreeView({ label: "Poses", onActivate: () => {}, onToggle: () => {} });
    document.body.append(tree.element);
    const scroll = (tree.element as unknown as LightElement).querySelector(".tree-scroll")! as unknown as { scrollTop: number; clientHeight: number };
    let top = 0;
    Object.defineProperty(scroll, "scrollTop", { get: () => top, set: (value: number) => { top = Math.max(0, value); } });
    Object.defineProperty(scroll, "clientHeight", { get: () => 140 });
    const group = { id: "all", label: "All", rows: Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, label: `Pose ${i}` })) };
    // Folded: the row isn't in the tree yet, so it waits on the group (the nearest known item) at the top edge.
    tree.update({ groups: [group], expanded: new Set() });
    expect(top).toBe(0);
    tree.update({ groups: [group], expanded: new Set(["all"]) });
    // p7 is the eighth item after the group: (1 + 7) rows down, 10 px past.
    expect(top).toBe(8 * 28 + 10);
    expect(tree.scrollToItem("p20", "row", 4)).toBe(true);
    expect(top).toBe(21 * 28 + 4);
    expect(tree.scrollToItem("missing")).toBe(false);
    tree.dispose();
    // Taken down, it records where it is: the row at the top, the rows before it and its group.
    expect(store().anchor("tree:Poses")).toEqual({ key: "r:p20", offset: 4, near: [{ key: "r:p19", offset: 0 }, { key: "r:p18", offset: 0 },
      { key: "r:p17", offset: 0 }, { key: "g:all", offset: 0 }], top: 592 });
  });
});

describe("remembered folds", () => {
  test("a group section's fold survives a reload of the workspace's preferences", async () => {
    const { bindViewState, PreferenceViewState } = await viewState();
    const { GroupSection } = await import("../src/studio-ui/components/group-section");
    const first = new UIPreferenceActions();
    bindViewState(new PreferenceViewState(first));
    const mouth = new GroupSection({ title: "Mouth", key: "expressions.mouth", expanded: false });
    expect((mouth.element as unknown as LightElement).getAttribute("data-view-key")).toBe("expressions.mouth");
    mouth.button.click();
    const brows = new GroupSection({ title: "Brows", key: "expressions.brows", expanded: true });
    brows.button.click();
    // A reload: the stored workspace JSON is parsed back.
    const reloaded = new UIPreferenceActions(parseUIPreferences(JSON.parse(JSON.stringify(first.snapshot()))));
    bindViewState(new PreferenceViewState(reloaded));
    expect(new GroupSection({ title: "Mouth", key: "expressions.mouth", expanded: false }).expanded).toBe(true);
    expect(new GroupSection({ title: "Brows", key: "expressions.brows", expanded: true }).expanded).toBe(false);
    // Nothing stored: the default.
    expect(new GroupSection({ title: "Eyes", key: "expressions.eyes", expanded: true }).expanded).toBe(true);
  });

  test("a remembered set keeps a tree's groups, defaults first; keys not shown yet are kept", async () => {
    const { RememberedSet } = await viewState();
    const groups = new RememberedSet("expressions:start/", id => id === "saved");
    expect(groups.of(["saved", "mods"])).toEqual(new Set(["saved"]));
    groups.set("saved", false); groups.set("later-mod", true);
    expect(groups.of(["saved", "mods"])).toEqual(new Set());
    expect(groups.of(["later-mod"])).toEqual(new Set(["later-mod"]));
  });

  test("scroll anchors are bounded and validated in the preferences", () => {
    const preferences = new UIPreferenceActions();
    expect(preferences.capability({ kind: "scroll.set", key: "panel:character", anchor: { key: "row", offset: 14, top: -1 } }).available).toBe(false);
    for (let i = 0; i < 70; i++) preferences.dispatch({ kind: "scroll.set", key: `panel:p${i}`, anchor: { key: "row", offset: 14, top: 100 } });
    const stored = Object.keys(preferences.snapshot().scroll!);
    expect(stored.length).toBe(64);
    expect(stored[0]).toBe("panel:p6");
    preferences.dispatch({ kind: "scroll.set", key: "panel:p69" });
    expect(preferences.snapshot().scroll!["panel:p69"]).toBeUndefined();
    expect(parseUIPreferences({ schema: "xfs/ui-preferences-1", theme: "system", inputHints: true,
      scroll: { "panel:a": { key: "x", offset: 3.4, near: [{ key: "w", offset: 0 }, { key: 5 }], top: 20 }, "panel:b": { top: "no" }, bad: { top: 1 } } }).scroll)
      .toEqual({ "panel:a": { key: "x", offset: 3, near: [{ key: "w", offset: 0 }], top: 20 } });
  });
});

import { afterEach, beforeEach, expect, test } from "bun:test";
import { installLightDom, uninstallLightDom, lightDocument, lightEvent, type LightElement } from "./light-dom";
import { layoutTabs } from "../src/studio-ui/layout-tabs";
import { closeMenus } from "../src/studio-ui/menu";
import { sessionOfWorkspace } from "../src/app/profiles/profiles-migration-data";
import { TabDefaults, type LayoutTabAction } from "../src/app/profiles/tab-defaults";
import { LayoutDefaults } from "../src/app/profiles/layout-defaults";
import type { LayoutTabsPort } from "../src/app/profiles/tab-presentation";
import type { SubstitutionContext } from "../src/app/profiles/layout-fragment";
import { STUDIO_LAYOUT_DEFAULTS, STUDIO_FRAGMENT_KNOWLEDGE } from "../src/compose/layout-defaults";
import { DocumentOutbox } from "../src/platform/core/document-outbox";
import { storeDocuments, memoryOutboxStorage } from "./fixtures/platform-doubles";
import { openSession, seededRandom } from "./fixtures/profile-sessions";
import { freshWorkspace } from "./fixtures/eye-region";
import { restoreDockPreference } from "../src/studio-ui/dock/persist";
import { viewCatalogue } from "../src/studio-ui/views/contribution";
import { SHELL_VIEW } from "../src/studio-ui/views/shell";
import { recordTime } from "../src/studio-ui/components/record-list";

const V1 = { kind: "character", id: "c-one" }, V2 = { kind: "character", id: "c-two" };
const LOOK = { collection: "11111111-1111-4111-8111-111111111111", look: "22222222-2222-4222-8222-222222222222" };
const EYE = "eye-makeup/default";
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const el = (value: HTMLElement) => value as unknown as LightElement;
const key = (target: HTMLElement, name: string, mods: { altKey?: boolean; shiftKey?: boolean } = {}) => el(target).dispatchEvent(lightEvent("keydown", { key: name, ...mods }));
let previousWindow: unknown;
beforeEach(() => {
  installLightDom(); previousWindow = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).window = { innerWidth: 1400, innerHeight: 1000, addEventListener() {} };
});
afterEach(() => {
  for (const form of lightDocument.body.querySelectorAll(".popover")) form.dispatchEvent(lightEvent("keydown", { key: "Escape" }));
  closeMenus(false); uninstallLightDom();
  if (previousWindow === undefined) delete (globalThis as Record<string, unknown>).window; else (globalThis as Record<string, unknown>).window = previousWindow;
});

async function harness() {
  const outbox = new DocumentOutbox(storeDocuments(), memoryOutboxStorage()); outbox.open();
  const defaults = new LayoutDefaults({ documents: { list: async () => [] }, outbox, contributed: STUDIO_LAYOUT_DEFAULTS, known: STUDIO_FRAGMENT_KNOWLEDGE, random: seededRandom(31) });
  await defaults.load();
  const session = openSession(sessionOfWorkspace(freshWorkspace(), { tab: "Eye makeup", character: V1.id, look: LOOK }, seededRandom(1)));
  const candidates: { subjects: typeof V1[]; looks: typeof LOOK[]; scenes: SubstitutionContext["scenes"] } = { subjects: [V1], looks: [LOOK], scenes: [] };
  const actions = new TabDefaults({ sessions: session, defaults, candidates: () => candidates, known: STUDIO_FRAGMENT_KNOWLEDGE });
  const listeners = new Set<() => void>();
  const port: LayoutTabsPort = { snapshot: () => ({ tabs: session.tabList(), shown: session.tabId(), closed: session.closedTabs(), lastDefault: session.lastDefault() }),
    dock: () => session.dock(), defaults: () => defaults.list(), substitution: (id, choice) => actions.substitution(id, choice),
    subject: ref => ref.id === V1.id ? "ManualSave-12" : "Streetkid", look: ref => ref.look === LOOK.look ? "Look 3" : `Look ${ref.look}`,
    collection: () => "Night market", subscribe: listener => { listeners.add(listener); session.subscribe(listener); defaults.subscribe(listener); return () => { listeners.delete(listener); }; } };
  let readOnly = false;
  const announcements: string[] = [], toasts: { tone: string; message: string; actions?: { label: string; run(): void }[] }[] = [], dispatched: LayoutTabAction[] = [];
  const dock = document.createElement("main"); dock.id = "layout-dock";
  const dockButton = document.createElement("button"); dock.append(dockButton);
  const view = layoutTabs({ tabs: port, capability: action => readOnly && action.kind !== "tabs.show" ? { available: false, reason: "This workspace is open in another window." } : actions.capability(action),
    dispatch: action => { dispatched.push(action); actions.dispatch(action); return { ok: true }; }, dock, changed() {}, moduleIcon: () => "eye",
    feedback: { announce: text => announcements.push(text), toast: (tone, _source, message, actions) => { toasts.push({ tone, message, actions }); return () => {}; } } });
  lightDocument.body.append(el(view.element), el(dock));
  const changed = () => listeners.forEach(listener => listener());
  const row = (label: string) => lightDocument.body.querySelectorAll(".menu-item").find(item => item.querySelector(".menu-label")?.textContent?.startsWith(label))!;
  const action = (label: string) => {
    const item = view.menuItems(session.tabId(), view.strip.tab(session.tabId())!).find(item => item.kind === "action" && item.label.startsWith(label));
    if (!item || item.kind !== "action") throw Error(`No ${label}`);
    item.run();
  };
  return { view, session, candidates, defaults, actions, announcements, toasts, dispatched, dockButton, changed, row, action,
    readOnly: () => { readOnly = true; view.sync(); } };
}

test("U1: the strip selects, names its origin, roves and enters the dock; middle-click does nothing", async () => {
  const h = await harness(), first = h.session.tabId();
  h.actions.dispatch({ kind: "tabs.new", default: EYE });
  const second = h.session.tabId(), tab = h.view.strip.tab(second)!;
  expect([h.view.strip.tablist.getAttribute("aria-label"), tab.getAttribute("aria-controls"), tab.getAttribute("aria-label")])
    .toEqual(["Layout tabs", "layout-dock", "Eye makeup, made from Eye makeup"]);
  el(tab).dispatchEvent(lightEvent("auxclick", { button: 1 })); expect(h.session.tabList()).toHaveLength(2);
  key(tab, "Home"); expect(h.session.tabId()).toBe(first); expect(lightDocument.activeElement).toBe(el(h.view.strip.tab(first)!));
  key(h.view.strip.tab(first)!, "ArrowRight"); expect(h.session.tabId()).toBe(second);
  key(tab, "ArrowLeft", { altKey: true, shiftKey: true }); expect(h.session.tabList()[0]!.id).toBe(second);
  expect(h.announcements.some(text => text.includes("moved"))).toBe(true);
  key(tab, "End"); expect(h.session.tabId()).toBe(first);
  key(h.view.strip.tab(first)!, "Enter"); expect(lightDocument.activeElement).toBe(el(h.dockButton));
});

test("U1: all global bindings select the intended tab; typing and popovers keep their keys", async () => {
  const h = await harness(); for (let n = 0; n < 9; n++) h.actions.dispatch({ kind: "tabs.new", default: EYE });
  const ids = h.session.tabList().map(tab => tab.id);
  for (let n = 1; n <= 9; n++) {
    h.view.globalKey(lightEvent("keydown", { key: String(n), altKey: true }) as unknown as KeyboardEvent);
    expect(h.session.tabId()).toBe(n === 9 ? ids.at(-1)! : ids[n - 1]!);
  }
  h.view.globalKey(lightEvent("keydown", { key: "PageDown", altKey: true }) as unknown as KeyboardEvent); expect(h.session.tabId()).toBe(ids[0]!);
  h.view.globalKey(lightEvent("keydown", { key: "PageUp", altKey: true }) as unknown as KeyboardEvent); expect(h.session.tabId()).toBe(ids.at(-1)!);
  const input = document.createElement("input");
  expect(h.view.globalKey(lightEvent("keydown", { key: "1", altKey: true, target: el(input) }) as unknown as KeyboardEvent)).toBe(false);
});

test("U2/U5: rename validates, Save creates an own origin, Update applies; Close and Reopen restore; Reset records before reset", async () => {
  const h = await harness(), id = h.session.tabId();
  key(h.view.strip.tab(id)!, "F2"); await tick();
  const input = lightDocument.body.querySelector("input")!, form = lightDocument.body.querySelector(".popover")!;
  input.value = ""; input.dispatchEvent(lightEvent("input")); expect(form.querySelector(".primary")!.disabled).toBe(true);
  input.value = "x".repeat(61); input.dispatchEvent(lightEvent("input")); expect(form.querySelector(".primary")!.disabled).toBe(true);
  input.value = "bad\u0001name"; input.dispatchEvent(lightEvent("input")); expect(form.querySelector(".primary")!.disabled).toBe(true);
  input.value = "My tab"; form.dispatchEvent(lightEvent("submit")); expect(h.session.tab(id)!.name).toBe("My tab");
  h.action("Save as default"); await tick(); lightDocument.body.querySelector(".popover")!.dispatchEvent(lightEvent("submit"));
  const own = h.defaults.get(h.session.tab(id)!.origin!)!; expect(own.owner.kind).toBe("user");
  expect(h.view.menuItems(id, h.view.add).some(item => item.kind === "action" && item.label.startsWith("Update"))).toBe(true);
  h.action("Update"); expect(h.dispatched.at(-1)!.kind).toBe("tabs.updateDefault");
  const reset = h.view.menuItems(id, h.view.add).find(item => item.kind === "submenu" && item.label === "Reset to default")!;
  if (reset.kind !== "submenu") throw Error("Reset missing");
  const origin = reset.items()[0]!; expect(origin.kind).toBe("action"); if (origin.kind === "action") origin.run();
  expect(h.session.closedTabs().at(-1)!.reset).toBe(true);
  const reopen = h.view.menuItems(id, h.view.add).find(item => item.kind === "submenu" && item.label === "Reopen closed tab")!;
  if (reopen.kind !== "submenu") throw Error("Reopen missing");
  expect(reopen.items()[0]).toMatchObject({ label: "My tab before reset" });
  h.action("Close tab"); expect(h.session.tabList()).toHaveLength(0); expect(h.view.element.classList.contains("is-empty")).toBe(true);
  expect(h.view.element.classList.contains("empty")).toBe(false); // The generic empty card adds padding and stacks its children.
  expect(h.view.add.textContent).toContain("New tab");
  h.view.commands().find(command => command.id === "tab.reopen")!.run(); expect(h.session.tabList()).toHaveLength(1);
});

test("U3: defaults are grouped, tagged, one click when unique, last used focused; secondary Delete tombstones and Undo restores", async () => {
  const h = await harness(); h.view.newMenu(); await tick();
  expect(lightDocument.body.querySelectorAll(".menu-heading").map(item => item.textContent)).toEqual(["Eye makeup", "Save Explorer", "Expressions", "Poses"]);
  expect(lightDocument.body.querySelectorAll(".stage-tag").length).toBe(3);
  h.row("Eye makeup").click(); expect(h.session.tabList()).toHaveLength(2);
  expect(h.session.lastDefault()).toBe(EYE);
  h.action("Save as default"); await tick(); lightDocument.body.querySelector(".popover")!.dispatchEvent(lightEvent("submit"));
  const own = h.session.tab(h.session.tabId())!.origin!;
  h.view.newMenu(); await tick();
  const remove = lightDocument.body.querySelectorAll(".menu-secondary")[0]!;
  expect(remove.getAttribute("aria-label")).toBe("Delete default Eye makeup");
  expect(remove.title).toBe("Delete default Eye makeup");
  expect(remove.querySelector(".menu-icon")).not.toBeNull(); expect(remove.querySelector(".menu-label")).toBeNull();
  expect(remove.classList.contains("danger")).toBe(false);
  remove.click(); expect(h.defaults.get(own)).toBeUndefined(); expect(h.toasts.at(-1)!.message).toContain("Undo");
  h.toasts.at(-1)!.actions![0]!.run(); expect(h.defaults.get(own)).toBeDefined();
  h.view.newMenu(); await tick(); const ownMain = h.row("Eye makeup");
  // Delete only on an own row (contributed rows have no secondary action).
  expect(ownMain.parentElement!.classList.contains("menu-secondary-row")).toBe(false);
  const main = lightDocument.body.querySelector(".menu-secondary-row")!.children[0]!; key(main as unknown as HTMLElement, "Delete");
  expect(h.defaults.get(own)).toBeUndefined();
});

test("U4: ambiguous slots open visible radio choices; M2 shares the chosen V's scene and its look; New scene reveals searchable looks", async () => {
  const h = await harness(); h.candidates.subjects.push(V2);
  const scene = h.session.graph.node("main", "scene").id;
  h.candidates.scenes = [{ scene, kind: "character", subject: V1, look: LOOK, tab: h.session.tabId() }];
  h.candidates.looks.push(...Array.from({ length: 9 }, (_, n) => ({ collection: LOOK.collection, look: `look-${n}` })));
  h.view.newMenu(); h.row("Eye makeup").click(); await tick();
  const form = lightDocument.body.querySelector(".choice-popover")!;
  expect(h.session.tabList()).toHaveLength(1);
  expect(form.querySelectorAll("[role=radiogroup]").some(group => group.getAttribute("aria-label")!.includes("v1"))).toBe(true);
  form.querySelectorAll("[role=radio]").find(item => item.getAttribute("aria-label") === "ManualSave-12")!.click();
  expect(form.textContent).toContain("lighting and look changes show in both tabs");
  expect(form.textContent).toContain("Share the scene of Eye makeup · ManualSave-12 · Look 3");
  expect(form.textContent).not.toContain("V ·");
  expect(form.querySelector(".popover-note")!.classList.contains("hint")).toBe(true);
  const looks = form.querySelectorAll(".choice-popover-field").find(field => field.dataset.slot === "look:look1"); expect(looks).toBeUndefined();
  form.querySelectorAll("[role=radio]").find(item => item.getAttribute("aria-label") === "New scene")!.click();
  const lookField = form.querySelectorAll(".choice-popover-field").find(field => field.dataset.slot === "look:look1")!;
  expect(lookField.querySelector(".search-field")!.hidden).toBe(false);
  const control = lookField.querySelector(".choice-list")!;
  expect(control.children.indexOf(control.querySelector(".control-line")!)).toBeLessThan(control.children.indexOf(control.querySelector(".search-field")!));
  expect(control.children.indexOf(control.querySelector(".search-field")!)).toBeLessThan(control.children.indexOf(control.querySelector(".choices")!));
  const look = form.querySelectorAll("[role=radio]").find(item => item.getAttribute("aria-label") === "Look 3")!; look.click();
  form.dispatchEvent(lightEvent("keydown", { key: "Enter" })); expect(h.session.tabList()).toHaveLength(2);
  const made = h.session.graph.viewIds().find(view => h.session.viewTab(view) === h.session.tabId())!;
  expect(h.session.graph.node(made, "scene").id).not.toBe(scene);
  expect(h.session.scene(h.session.graph.node(made, "scene").id)).toMatchObject({ subject: V1, look: LOOK });
});

test("U4: a removed candidate falls back with a note; Escape creates nothing and restores focus; arrows select radio choices", async () => {
  const h = await harness(); h.candidates.subjects.push(V2); h.view.newMenu(); h.row("Eye makeup").click(); await tick();
  let form = lightDocument.body.querySelector(".choice-popover")!;
  const v = form.querySelectorAll("[role=radio]").find(item => item.getAttribute("aria-label") === "ManualSave-12")!;
  v.focus(); key(v as unknown as HTMLElement, "ArrowDown");
  expect(form.querySelectorAll("[aria-checked=true]").some(item => item.getAttribute("aria-label") === "Streetkid")).toBe(true);
  h.candidates.subjects.splice(1, 1); h.changed();
  expect(form.textContent).toContain("no longer available");
  expect(form.querySelectorAll("[aria-checked=true]").some(item => item.getAttribute("aria-label") === "Leave empty")).toBe(true);
  form.dispatchEvent(lightEvent("keydown", { key: "Escape" })); expect(h.session.tabList()).toHaveLength(1); expect(lightDocument.activeElement).toBe(el(h.view.add));
});

test("read-only: switching works; New, rename, save, update, reset, close, reorder and deletion refuse with the page's reason", async () => {
  const h = await harness(), first = h.session.tabId(); h.actions.dispatch({ kind: "tabs.new", default: EYE });
  h.action("Save as default"); await tick(); lightDocument.body.querySelector(".popover")!.dispatchEvent(lightEvent("submit"));
  const second = h.session.tabId(); h.readOnly();
  h.view.strip.tab(first)!.click(); expect(h.session.tabId()).toBe(first); h.view.strip.tab(second)!.click();
  const before = JSON.stringify(h.session.session());
  for (const item of h.view.menuItems(second, h.view.add)) if (item.kind === "action" || item.kind === "submenu") {
    expect(item.capability).toMatchObject({ available: false, reason: "This workspace is open in another window." });
  }
  key(h.view.strip.tab(second)!, "F2"); key(h.view.strip.tab(second)!, "Delete"); key(h.view.strip.tab(second)!, "ArrowLeft", { altKey: true, shiftKey: true });
  expect(lightDocument.body.querySelector(".popover")).toBeNull(); expect(JSON.stringify(h.session.session())).toBe(before);
  expect(h.view.add.getAttribute("aria-disabled")).toBe("true");
  h.view.newMenu(); expect(h.row("Eye makeup").getAttribute("aria-disabled")).toBe("true");
  expect(lightDocument.body.querySelector(".menu-secondary")!.getAttribute("aria-disabled")).toBe("true");
});

test("empty tab arrangement remains empty, and a minimal arrangement never opens unrelated factory panels", () => {
  const catalogue = viewCatalogue([SHELL_VIEW]), area = { x: 0, y: 0, w: 1200, h: 800 };
  const empty = restoreDockPreference(null, area, catalogue, [], catalogue.ids, true).state;
  expect(empty.wide.root).toBeNull(); expect(empty.compact.floating).toEqual([]);
  const tree = { root: { kind: "group" as const, id: "g1", panels: ["help"], active: "help" }, floating: [], closed: [] };
  const restored = restoreDockPreference({ format: "xfs/dock", version: 1, state: { wide: tree, compact: tree } }, area, catalogue, [], catalogue.ids, true).state;
  expect(restored.wide.root).toEqual(tree.root); expect(restored.wide.floating).toEqual([]);
});


test("Review A finding 3: choosing the older reset fragment reopens that exact snapshot after reload", async () => {
  const h = await harness(), tab = h.session.tabId();
  h.session.rename(tab, "Original");
  h.actions.dispatch({ kind: "tabs.reset", tab, default: EYE });
  h.session.rename(tab, "Second arrangement");
  h.actions.dispatch({ kind: "tabs.reset", tab, default: EYE });
  const closed = h.session.closedTabs();
  expect(new Set(closed.map(fragment => fragment.id)).size).toBe(2);
  const menu = h.view.menuItems(tab, h.view.add).find(item => item.kind === "submenu" && item.label === "Reopen closed tab");
  if (menu?.kind !== "submenu") throw Error("No reopen menu");
  const original = menu.items().find(item => item.kind === "action" && item.label === "Original before reset");
  if (original?.kind !== "action") throw Error("No original fragment");
  original.run();
  expect(h.session.tab(h.session.tabId())!.name).toBe("Original");
  const restored = openSession(h.session.session());
  restored.reopen(restored.closedTabs()[0]!.id);
  expect(restored.tab(restored.tabId())!.name).toBe("Second arrangement");
});

test("Review A finding 5: Reset stays available when a newer-build origin is unavailable", async () => {
  const h = await harness(), tab = h.session.tabId();
  const base = STUDIO_LAYOUT_DEFAULTS[0]!.fragment;
  // Read a real stored fragment from a newer build, rather than substituting capabilities in the menu.
  const fragment = { ...structuredClone(base), panels: [...base.panels, { key: "future", type: "future.panel" }] };
  h.defaults.importLegacy([{ name: "Newer default", fragment }]);
  const own = h.defaults.list().find(view => view.name === "Newer default")!;
  // A tab can outlive the build that supplied its origin.
  h.session.setOrigin(tab, own.id);
  const reset = h.view.menuItems(tab, h.view.add).find(item => item.kind === "submenu" && item.label === "Reset to default");
  if (reset?.kind !== "submenu") throw Error("No reset menu");
  expect(reset.capability?.available).toBe(true);
  const rows = reset.items().filter(item => item.kind === "action");
  expect(rows[0]!.capability).toMatchObject({ available: false, reason: own.unavailable });
  const eye = rows.find(row => row.label.startsWith("Eye makeup"))!;
  expect(eye.capability?.available).toBe(true);
  eye.run(); expect(h.session.tab(tab)!.origin).toBe(EYE);
});

test("Review A design 2: substitution focuses a visible first field and Escape from it cancels", async () => {
  const h = await harness(); h.candidates.subjects.push(V2);
  h.view.add.focus(); h.view.newMenu(); h.row("Eye makeup").click(); await tick();
  const form = lightDocument.body.querySelector(".choice-popover")!;
  const focused = lightDocument.activeElement!;
  expect(focused.closest("[hidden]")).toBeNull();
  expect(form.contains(focused)).toBe(true);
  expect(focused.getAttribute("role")).toBe("radio");
  focused.dispatchEvent(lightEvent("keydown", { key: "Escape" }));
  expect(form.isConnected).toBe(false);
  expect(h.session.tabList()).toHaveLength(1);
  expect(lightDocument.activeElement).toBe(el(h.view.add));
});

test("Review A finding 4: Enter on Cancel keeps native activation and creates nothing", async () => {
  const h = await harness(); h.candidates.subjects.push(V2);
  h.view.newMenu(); h.row("Eye makeup").click(); await tick();
  const form = lightDocument.body.querySelector(".choice-popover")!;
  const cancel = form.querySelectorAll("button").find(button => button.textContent === "Cancel")!;
  cancel.focus(); const event = lightEvent("keydown", { key: "Enter" }); cancel.dispatchEvent(event);
  expect(event.defaultPrevented).not.toBe(true);
  expect(h.session.tabList()).toHaveLength(1);
  // The light DOM has no native keyboard defaults; emulate the button's resulting click.
  cancel.click(); expect(form.isConnected).toBe(false);
  expect(h.session.tabList()).toHaveLength(1);
  expect(lightDocument.activeElement).toBe(el(h.view.add));
});

test("Review B 5/13: same-named defaults use the Library date and minute, never their IDs", async () => {
  const h = await harness();
  for (let n = 0; n < 2; n++) h.defaults.dispatch({ kind: "create", name: "My lighting", fragment: STUDIO_LAYOUT_DEFAULTS[0]!.fragment });
  const own = h.defaults.list().filter(view => view.name === "My lighting");
  h.view.newMenu();
  const hints = lightDocument.body.querySelectorAll(".menu-hint").map(element => element.textContent);
  expect(hints).toEqual(own.map(view => `Saved ${recordTime(view.owner.kind === "user" ? view.owner.savedAt : 0)}`));
  for (const view of own) expect(lightDocument.body.textContent).not.toContain(view.id);
});

test("Review B 6: Reset submenu rows keep their complete names in tooltips", async () => {
  const h = await harness();
  h.view.menu(h.session.tabId(), h.view.add);
  key(h.row("Reset to default") as unknown as HTMLElement, "ArrowRight");
  const row = lightDocument.body.querySelectorAll(".menu-item").find(item => item.querySelector(".menu-label")?.textContent?.includes("— ManualSave-12 · Look 3"))!;
  expect(row.title).toBe("Eye makeup — ManualSave-12 · Look 3");
});

test("Review B 7: dragging dims only its source and clears on cancellation", async () => {
  const h = await harness(), source = h.session.tabId(); h.actions.dispatch({ kind: "tabs.new", default: EYE });
  const rect = (left: number, width: number) => ({ x: left, y: 0, left, top: 0, right: left + width, bottom: 32, width, height: 32 });
  el(h.view.element).getBoundingClientRect = () => rect(0, 500);
  h.view.strip.tabs.forEach((tab, index) => { el(tab).getBoundingClientRect = () => rect(index * 100, 100); });
  el(h.view.strip.tab(source)!).dispatchEvent(lightEvent("pointerdown", { button: 0, clientX: 20, clientY: 12 }));
  lightDocument.dispatchEvent(lightEvent("pointermove", { clientX: 120, clientY: 12 }));
  expect(h.view.strip.tab(source)!.classList.contains("dragging")).toBe(true);
  expect(h.view.strip.tabs.filter(tab => tab.classList.contains("dragging"))).toHaveLength(1);
  expect(h.view.strip.tabs.some(tab => tab.classList.contains("drop-before"))).toBe(true);
  const before = h.session.tabList().map(tab => tab.id);
  lightDocument.dispatchEvent(lightEvent("pointercancel", { clientX: 120, clientY: 12 }));
  expect(h.session.tabList().map(tab => tab.id)).toEqual(before);
  expect(h.view.strip.tabs.some(tab => tab.classList.contains("dragging") || tab.classList.contains("drop-before"))).toBe(false);
});

test("Review B 8: a single scene separates the label from its value", async () => {
  const h = await harness(); h.candidates.subjects.push(V2);
  h.view.newMenu(); h.row("Eye makeup").click();
  const scene = lightDocument.body.querySelectorAll(".choice-popover-field").find(field => field.dataset.slot === "scene:scene1")!;
  expect(scene.querySelector(".popover-choice-text")!.textContent).toBe("Scene: New scene");
});

test("Review B 15: menu, key and palette closes give an info toast whose Undo restores that exact tab", async () => {
  const h = await harness(), first = h.session.tabId();
  h.session.rename(first, "First tab"); h.actions.dispatch({ kind: "tabs.new", default: EYE });
  const second = h.session.tabId(); h.session.rename(second, "Second tab");
  h.action("Close tab"); const secondNotice = h.toasts.at(-1)!;
  expect(secondNotice).toMatchObject({ tone: "info", message: "Closed “Second tab”." });
  key(h.view.strip.tab(first)!, "Delete");
  expect(h.toasts.at(-1)).toMatchObject({ tone: "info", message: "Closed “First tab”." });
  expect(h.session.tabList()).toHaveLength(0);
  secondNotice.actions![0]!.run();
  expect(h.session.tabList().map(tab => tab.id)).toEqual([second]);
  h.view.commands().find(command => command.id === "tab.close")!.run();
  expect(h.toasts.at(-1)).toMatchObject({ tone: "info", message: "Closed “Second tab”." });
  h.toasts.at(-1)!.actions![0]!.run(); expect(h.session.tabId()).toBe(second);
});

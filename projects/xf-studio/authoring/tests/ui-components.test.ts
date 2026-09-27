// The component library's controls (UI-112): behaviour, states and accessibility of the components features compose, in the light DOM.
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { installLightDom, lightEvent, uninstallLightDom, type LightElement } from "./light-dom";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());
beforeEach(async () => { (await import("../src/studio-ui/components")).resetGroupSections(); document.body.replaceChildren(); });

const lib = () => import("../src/studio-ui/components");
const key = (element: HTMLElement, name: string) => (element as unknown as LightElement).dispatchEvent(lightEvent("keydown", { key: name }));
const fire = (element: HTMLElement, type: string) => (element as unknown as LightElement).dispatchEvent(lightEvent(type));
const log = () => { const calls: string[] = []; return { calls, t: { begin: () => calls.push("begin"), edit: (v: unknown) => calls.push(`edit ${JSON.stringify(v)}`), commit: () => calls.push("commit"), cancel: () => calls.push("cancel") } }; };

test("slider with value: one readout, typed into in place (clamped and snapped, one step); Escape changes nothing; reset shows only when set", async () => {
  const { SliderWithValue } = await lib();
  const { calls, t } = log();
  const control = new SliderWithValue({ label: "Brow raise", min: 0, max: 1, step: .05, format: v => `${Math.round(v * 100)} %`, transaction: t, defaultValue: 0, reset: true, reserveNote: true });
  document.body.append(control.element);
  const readout = control.element.querySelector<HTMLElement>(".readout-value")!, field = control.element.querySelector<HTMLInputElement>(".readout-input")!;
  control.update(.4);
  expect([readout.textContent, field.getAttribute("aria-label"), control.input.getAttribute("aria-valuetext"), control.element.querySelectorAll("input").length])
    .toEqual(["40 %", "Brow raise, exact value", "40 %", 2]);
  expect([control.element.classList.contains("set"), control.resetButton!.classList.contains("idle")]).toEqual([true, false]);
  // Enter on the slider types in the readout's place; the typed value is clamped and snapped, one step; focus returns to the slider.
  key(control.input, "Enter");
  expect([field.hidden, field.value]).toEqual([false, "0.4"]);
  field.value = "1.33"; key(field, "Enter");
  expect([calls, document.activeElement === (control.input as unknown)]).toEqual([["begin", "edit 1", "commit"], true]);
  calls.length = 0;
  readout.click(); field.value = "0.52"; key(field, "Enter");
  expect(calls).toEqual(["begin", "edit 0.5", "commit"]);
  calls.length = 0;
  control.update(.5);
  readout.click(); field.value = "0.9"; key(field, "Escape");
  expect([readout.textContent, calls]).toEqual(["50 %", []]);
  // Delete returns to the default, as the reset does.
  key(control.input, "Delete");
  expect(calls).toEqual(["begin", "edit 0", "commit"]);
  calls.length = 0;
  control.resetButton!.click();
  expect(calls).toEqual(["begin", "edit 0", "commit"]);
  control.update(0);
  expect([control.element.classList.contains("set"), control.resetButton!.classList.contains("idle"), control.resetButton!.getAttribute("aria-label")])
    .toEqual([false, true, "Reset Brow raise"]);
  // The owner's words for the readout (a pair's sides), muted, until the next edit.
  control.update(.1, { text: "10 / 30 %" });
  expect([readout.textContent, control.element.classList.contains("owner-text")]).toEqual(["10 / 30 %", true]);
  // Disabled: the range, the typed field can't open, the reason on the reserved note line.
  control.update(0, { disabled: true, reason: "Choose a face first." });
  readout.click();
  const note = control.element.querySelector<HTMLElement>(".control-note")!;
  expect([control.input.disabled, field.hidden, note.textContent, note.hidden]).toEqual([true, true, "Choose a face first.", false]);
  // Without reserveNote there is no note line to hold empty space.
  const plain = new SliderWithValue({ label: "Lid", min: 0, max: 1, step: .05, format: String, transaction: t });
  expect(plain.element.querySelector<HTMLElement>(".control-note")!.hidden).toBe(true);
});

test("pair control: linked is one slider for both sides, uneven says both values in its one readout, separate is one short line per side", async () => {
  const { PairControl } = await lib();
  const edits: string[] = [];
  const pair = new PairControl({ label: "Brow height", min: 0, max: 100, step: 1, format: v => `${v} %`,
    transaction: { edit: edit => edits.push(`${edit.sides}=${edit.value}`) } });
  document.body.append(pair.element);
  pair.update({ left: 20, right: 20 }, { linked: true });
  const [both, sides] = (pair.element as unknown as LightElement).children as unknown as HTMLElement[];
  const labels = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>("label")).map(label => label.textContent);
  // One visible name: no "both sides" label, no link button on the pair.
  expect([both!.hidden, sides!.hidden, labels(both!), both!.querySelector("input.slider")!.getAttribute("aria-label"), pair.element.querySelectorAll("button.pair-link").length])
    .toEqual([false, true, ["Brow height"], "Brow height, both sides", 0]);
  pair.update({ left: 14, right: 10 }, { linked: true });
  expect([pair.element.classList.contains("uneven"), both!.querySelector<HTMLElement>(".readout-value")!.textContent]).toEqual([true, "14 / 10 %"]);
  const range = both!.querySelector<HTMLElement>("input.slider")! as unknown as HTMLInputElement;
  range.value = "30"; fire(range, "input");
  expect(edits).toEqual(["both=30"]);
  pair.update({ left: 20, right: 60 }, { linked: false });
  expect([both!.hidden, sides!.hidden, labels(sides!), Array.from(sides!.querySelectorAll<HTMLElement>("input.slider")).map(input => input.getAttribute("aria-label"))])
    .toEqual([true, false, ["L", "R"], ["Brow height, left", "Brow height, right"]]);
  expect(sides!.querySelector<HTMLElement>(".pair-label")!.textContent).toBe("Brow height");
});

test("group section: the count hides at 0, reset never folds the group, the open state lasts the session and search can force or hide it", async () => {
  const { GroupSection } = await lib();
  let resets = 0;
  const make = () => new GroupSection({ title: "Brows", key: "expr.brows", onReset: () => resets++ });
  const group = make();
  group.update({ set: 0 });
  const count = group.element.querySelector<HTMLElement>(".group-count")!, reset = group.element.querySelector<HTMLElement>(".group-reset")!;
  expect([count.hidden, reset.classList.contains("idle"), group.expanded, group.body.hidden, count.classList.contains("badge")]).toEqual([true, true, false, true, false]);
  group.update({ set: 2 });
  expect([count.hidden, count.textContent, reset.classList.contains("idle")]).toEqual([false, "2 set", false]);
  reset.click();
  expect([resets, group.expanded]).toEqual([1, false]);
  group.button.click();
  expect([group.expanded, group.button.getAttribute("aria-controls"), group.body.id]).toEqual([true, group.body.id, group.body.id]);
  // Rebuilt, it comes back open (kept for the session).
  const again = make();
  expect(again.expanded).toBe(true);
  again.setOpen(false, true);
  again.update({ forceOpen: true });
  expect(again.expanded).toBe(true);
  again.update({});
  expect(again.expanded).toBe(false);
  again.update({ hidden: true });
  expect(again.element.hidden).toBe(true);
  // Folded by the person during a search, it stays folded while that search updates (UI-124); the next search opens it again.
  again.update({ forceOpen: true });
  again.button.click();
  again.update({ forceOpen: true }); again.update({ forceOpen: true, set: 1 });
  expect(again.expanded).toBe(false);
  again.update({});
  expect(again.expanded).toBe(false);
  again.update({ forceOpen: true });
  expect(again.expanded).toBe(true);
});

test("search field: debounced filtering, Enter at once, Escape and the clear button clear, and a no-matches state with Clear search", async () => {
  const { SearchField } = await lib();
  const queries: string[] = [];
  const search = new SearchField({ label: "Search expressions", onFilter: query => queries.push(query), debounce: 5 });
  const clear = search.element.querySelector<HTMLElement>(".search-clear")!;
  expect([search.element.getAttribute("role"), search.input.getAttribute("aria-label"), clear.classList.contains("empty")]).toEqual(["search", "Search expressions", true]);
  search.input.value = "smi"; fire(search.input, "input");
  search.input.value = "smile "; fire(search.input, "input");
  expect(queries).toEqual([]);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect([queries, clear.classList.contains("empty")]).toEqual([["smile"], false]);
  search.input.value = "frown"; key(search.input, "Enter");
  expect(queries).toEqual(["smile", "frown"]);
  const empty = search.noMatches("expressions");
  expect([empty.getAttribute("role"), empty.querySelector<HTMLElement>(".empty-body")!.textContent]).toEqual(["status", "No expressions match “frown”."]);
  key(search.input, "Escape");
  expect([search.value, queries.at(-1)]).toEqual(["", ""]);
});

test("combobox: typing filters under the group headings, arrows move over unavailable options, Enter chooses, Escape restores", async () => {
  const { Combobox } = await lib();
  const chosen: string[] = [];
  const combo = new Combobox<string>({ label: "Start from", onChange: value => chosen.push(value) });
  combo.update([{ label: "Your saved expressions", options: [{ value: "mine-1", label: "Smirk" }] },
    { label: "Installed: Expressions Pack", options: [{ value: "a", label: "Smile" }, { value: "b", label: "Sneer", disabled: true, reason: "Needs its mod" }, { value: "c", label: "Snarl" }] }], "mine-1");
  expect([combo.input.value, combo.input.getAttribute("role"), combo.input.getAttribute("aria-expanded")]).toEqual(["Smirk", "combobox", "false"]);
  combo.input.value = "sn"; fire(combo.input, "input");
  const list = combo.element.querySelector<HTMLElement>(".combobox-list")!;
  expect([list.hidden, combo.input.getAttribute("aria-expanded"), Array.from(list.querySelectorAll<HTMLElement>(".combobox-heading")).map(h => h.textContent),
    Array.from(list.querySelectorAll<HTMLElement>(".combobox-option")).map(o => o.textContent)]).toEqual([false, "true", ["Installed: Expressions Pack"], ["Sneer", "Snarl"]]);
  // The first available match is active; Down skips nothing more, Enter chooses it.
  expect(combo.input.getAttribute("aria-activedescendant")).toBe(list.querySelectorAll<HTMLElement>(".combobox-option")[1]!.id);
  key(combo.input, "Enter");
  expect([chosen, combo.input.value, list.hidden]).toEqual([["c"], "Snarl", true]);
  combo.update([{ options: [{ value: "a", label: "Smile" }, { value: "c", label: "Snarl" }] }], "c");
  key(combo.input, "ArrowDown");
  expect(list.hidden).toBe(false);
  combo.input.value = "zz"; fire(combo.input, "input");
  expect(list.querySelector<HTMLElement>(".combobox-empty")!.textContent).toBe("Nothing matches.");
  key(combo.input, "Escape");
  expect([combo.input.value, list.hidden]).toEqual(["Snarl", true]);
  // A refused choice, the field still focused: the owner's value shows again at once (UI-124).
  combo.input.focus();
  key(combo.input, "ArrowDown"); key(combo.input, "ArrowUp"); key(combo.input, "Enter");
  expect([chosen.at(-1), combo.input.value, document.activeElement === (combo.input as unknown)]).toEqual(["a", "Smile", true]);
  combo.update([{ options: [{ value: "a", label: "Smile" }, { value: "c", label: "Snarl" }] }], "c");
  expect(combo.input.value).toBe("Snarl");
});

test("layout primitives: the page header's rows, an empty meta line takes no room, property lists and a focusable code block", async () => {
  const { PageHeader, propertyList, codeBlock, blockSection, stack } = await lib();
  let back = 0;
  const header = new PageHeader({ title: "QuickSave-0", back: { label: "All saves", onClick: () => back++ } });
  expect([header.element.tagName, header.meta.hidden, header.back!.textContent]).toEqual(["header", true, "All saves"]);
  header.setMeta("Quick save · game 2.31");
  header.back!.click();
  expect([header.meta.hidden, header.meta.textContent, back]).toEqual([false, "Quick save · game 2.31", 1]);
  const list = propertyList([["Kind", "A layout of its own"], { term: "Size", value: "54 B", mono: true }]);
  expect(Array.from(list.children).map(child => [child.tagName, child.textContent])).toEqual([["dt", "Kind"], ["dd", "A layout of its own"], ["dt", "Size"], ["dd", "54 B"]]);
  const code = codeBlock("000000 cf 59", { label: "Bytes" });
  expect([code.tagName, code.getAttribute("tabindex"), code.getAttribute("role"), code.getAttribute("aria-label")]).toEqual(["pre", "0", "region", "Bytes"]);
  const block = blockSection({ title: "game::SessionConfig", actions: [code] }, list);
  expect([block.querySelector<HTMLElement>(".block-title")!.textContent, block.children.length]).toEqual(["game::SessionConfig", 2]);
  expect(stack({ gap: "loose" }, null, block).className).toBe("stack gap-loose");
});

test("split view: the gutter is a keyboard separator whose share is kept for the session", async () => {
  const { SplitView } = await lib();
  const make = () => new SplitView({ label: "tree and inspector", key: "test.split", start: document.createElement("div"), end: document.createElement("div"), initial: .4 });
  const split = make();
  expect([split.gutter.getAttribute("role"), split.gutter.getAttribute("aria-label"), split.gutter.getAttribute("aria-valuenow")]).toEqual(["separator", "Resize tree and inspector", "40"]);
  key(split.gutter, "ArrowRight");
  expect(split.gutter.getAttribute("aria-valuenow")).toBe("43");
  key(split.gutter, "Enter");
  expect(split.value).toBe(.5);
  expect(make().value).toBe(.5);
});

test("progress bar: a named progressbar, determinate with a value or indeterminate without", async () => {
  const { progressBar } = await lib();
  const bar = progressBar({ label: "Building the package" });
  expect([bar.element.getAttribute("role"), bar.element.getAttribute("aria-label"), bar.element.classList.contains("indeterminate"), bar.element.getAttribute("aria-valuenow")])
    .toEqual(["progressbar", "Building the package", true, null]);
  bar.set(.426);
  expect([bar.element.classList.contains("indeterminate"), bar.element.getAttribute("aria-valuenow")]).toEqual([false, "43"]);
});

test("icon button: named and titled by its label, says when it opens a menu, and an unavailable one runs nothing", async () => {
  const { iconButton } = await lib();
  const { setUnavailable } = await import("../src/studio-ui/dom");
  let runs = 0;
  const more = iconButton({ label: "More actions", icon: "more", menu: true, onClick: () => runs++ });
  expect([more.getAttribute("aria-label"), more.title, more.getAttribute("aria-haspopup")]).toEqual(["More actions", "More actions", "menu"]);
  more.click();
  setUnavailable(more, true, "Nothing to do here.");
  more.click();
  expect(runs).toBe(1);
});

test("tree view: groups toggle, rows activate on one click, disabled rows don't, the WAI keys move and open, and F reaches the owner", async () => {
  const { TreeView, favouriteToggle } = await lib();
  const expanded = new Set(["a"]), activated: string[] = [], toggled: string[] = [], favs = new Set<string>();
  const groups = () => [
    { id: "a", label: "Idle", secondary: "Base game", rows: [{ id: "a1", label: "Stand" }, { id: "a2", label: "Sit", disabled: true, reason: "Needs its pack." },
      { id: "a3", label: "Lean", badges: [{ text: "New" }], trailingState: favs.has("a3") }] },
    { id: "b", label: "Photo", rows: [{ id: "b1", label: "Portrait" }] }, { id: "c", label: "Empty", rows: [] }];
  const tree = new TreeView({ label: "Poses", onActivate: id => activated.push(id), onToggle: (id, open) => { toggled.push(`${id}:${open}`); if (open) expanded.add(id); else expanded.delete(id); paint(); },
    onKey: (event, item) => { if (event.key === "f" && item.kind === "row") { favs.add(item.id); paint(); return true; } },
    trailing: row => favouriteToggle({ on: favs.has(row.id), what: row.label, onToggle: () => {} }) });
  const paint = () => tree.update({ groups: groups(), expanded, current: "a1" });
  document.body.append(tree.element);
  paint();
  const item = (id: string) => tree.element.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
  // The empty group isn't shown; the structure is a flat tree with levels, sizes and positions.
  expect(Array.from(tree.element.querySelectorAll<HTMLElement>(".tree-item")).map(e => [e.dataset.id, e.getAttribute("aria-level"), e.getAttribute("aria-posinset"), e.getAttribute("aria-setsize")]))
    .toEqual([["a", "1", "1", "2"], ["a1", "2", "1", "3"], ["a2", "2", "2", "3"], ["a3", "2", "3", "3"], ["b", "1", "2", "2"]]);
  expect([item("a").getAttribute("aria-expanded"), item("a1").getAttribute("aria-current"), item("a1").tabIndex, item("a").tabIndex]).toEqual(["true", "true", 0, -1]);
  expect([item("a3").getAttribute("aria-label"), item("a2").getAttribute("aria-disabled"), item("a2").title]).toEqual(["Lean, New", "true", "Needs its pack."]);
  item("a2").click(); item("a1").click();
  expect(activated).toEqual(["a1"]);
  const star = item("a3").querySelector<HTMLElement>(".favourite-toggle")!;
  expect([star.getAttribute("aria-label"), star.getAttribute("aria-pressed"), star.tabIndex]).toEqual(["Add Lean to favourites", "false", -1]);
  // Keys, from the focused current row: Down, Down to Lean, F toggles through the owner, Left to the group, Left closes it.
  const press = (name: string) => (tree.element as unknown as LightElement).dispatchEvent(lightEvent("keydown", { key: name }));
  press("ArrowDown"); press("ArrowDown");
  expect(document.activeElement?.getAttribute("data-id")).toBe("a3");
  press("f");
  expect(item("a3").querySelector(".favourite-toggle")!.getAttribute("aria-pressed")).toBe("true");
  press("ArrowLeft");
  expect(document.activeElement?.getAttribute("data-id")).toBe("a");
  press("ArrowLeft");
  expect([toggled, tree.element.querySelectorAll(".tree-row").length]).toEqual([["a:false"], 0]);
  press("p");
  expect(document.activeElement?.getAttribute("data-id")).toBe("b");
  press("ArrowRight");
  expect(toggled.at(-1)).toBe("b:true");
  press("ArrowRight"); press("Enter");
  expect(activated.at(-1)).toBe("b1");
});

test("tree view: a right-click, Shift+F10 or the Menu key on an item asks the owner for its context menu; focus by any route moves the tab stop", async () => {
  const { TreeView } = await lib();
  const menus: string[] = [];
  const tree = new TreeView({ label: "Expressions", onActivate: () => {}, onToggle: () => {},
    onMenu: (item, anchor) => menus.push(`${item.kind}:${item.id}:${"x" in anchor ? "pointer" : "item"}`) });
  document.body.append(tree.element);
  tree.update({ groups: [{ id: "saved", label: "Saved", rows: [{ id: "s1", label: "Smirk" }, { id: "s2", label: "Pout" }] }], expanded: new Set(["saved"]) });
  const item = (id: string) => tree.element.querySelector<HTMLElement>(`[data-id="${id}"]`)! as unknown as LightElement;
  const menu = lightEvent("contextmenu", { clientX: 5, clientY: 6 } as never);
  item("s2").dispatchEvent(menu);
  expect([menus, menu.defaultPrevented, document.activeElement?.getAttribute("data-id")]).toEqual([["row:s2:pointer"], true, "s2"]);
  // Focus that arrives without the tree's keys (a pointer, a script) moves the roving tab stop, so the next key acts on that item.
  item("s1").dispatchEvent(lightEvent("focusin"));
  expect([item("s1").tabIndex, item("s2").tabIndex]).toEqual([0, -1]);
  (tree.element as unknown as LightElement).dispatchEvent(lightEvent("keydown", { key: "F10", shiftKey: true } as never));
  (tree.element as unknown as LightElement).dispatchEvent(lightEvent("keydown", { key: "ContextMenu" }));
  expect(menus.slice(1)).toEqual(["row:s1:item", "row:s1:item"]);
});

test("tree view: only the items in view are in the page, and an update keeps the focused item", async () => {
  const { TreeView } = await lib();
  const groups = Array.from({ length: 90 }, (_, g) => ({ id: `g${g}`, label: `Pack ${g}`, rows: Array.from({ length: 18 }, (_, r) => ({ id: `g${g}r${r}`, label: `Pose ${r}` })) }));
  const expanded = new Set(groups.map(group => group.id));
  const tree = new TreeView({ label: "Many poses", onActivate: () => {}, onToggle: () => {} });
  document.body.append(tree.element);
  tree.update({ groups, expanded });
  const count = tree.element.querySelectorAll(".tree-item").length;
  expect(count).toBeLessThan(60);
  tree.focusItem("g40r3");
  tree.update({ groups, expanded, loading: true });
  expect([document.activeElement?.getAttribute("data-id"), tree.element.querySelector(".tree-status")!.textContent]).toEqual(["g40r3", "Loading…"]);
});

test("tree view: focus stays in the tree when the focused row leaves it, by F, by its star or by a new list (UI-119)", async () => {
  const { TreeView, favouriteToggle } = await lib();
  let favs = ["p1", "p2", "p3"];
  const expanded = new Set(["fav", "pack"]);
  const groups = () => [{ id: "fav", label: "Favourites", rows: favs.map(id => ({ id: `fav:${id}`, label: `Pose ${id}`, trailingState: true })) },
    { id: "pack", label: "Pack", rows: ["p1", "p2", "p3", "p4"].map(id => ({ id: `pack:${id}`, label: `Pose ${id}`, trailingState: favs.includes(id) })) }];
  const unstar = (rowId: string) => { const id = rowId.split(":")[1]!; favs = favs.includes(id) ? favs.filter(f => f !== id) : [...favs, id]; paint(); };
  const tree = new TreeView({ label: "Poses", onActivate: () => {}, onToggle: () => {},
    onKey: (event, item) => { if (event.key === "f" && item.kind === "row") { unstar(item.id); return true; } },
    trailing: row => favouriteToggle({ on: !!row.trailingState, onToggle: () => unstar(row.id) }) });
  const paint = () => tree.update({ groups: groups(), expanded });
  document.body.append(tree.element);
  paint();
  const focused = () => document.activeElement?.getAttribute("data-id");
  const item = (id: string) => tree.element.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
  // F on a Favourites row removes it: the row that took its place is focused.
  tree.focusItem("fav:p2");
  key(tree.element.querySelector<HTMLElement>('[data-id="fav:p2"]')!, "f");
  expect(focused()).toBe("fav:p3");
  // The group's last row leaves: the next item (the next group) takes its place.
  key(item("fav:p3"), "f");
  expect(focused()).toBe("pack");
  // A star clicked (focus on the star inside the row): the row and its emptied group go, focus stays in the tree.
  tree.focusItem("fav:p1");
  const star = item("fav:p1").querySelector<HTMLElement>(".favourite-toggle")!;
  star.focus(); star.click();
  expect([favs, focused()]).toEqual([[], "pack:p1"]);
  // The very last item leaves: the one before takes focus.
  tree.focusItem("pack:p4");
  tree.update({ groups: groups().map(group => ({ ...group, rows: group.rows.filter(row => row.id !== "pack:p4") })), expanded });
  expect(focused()).toBe("pack:p3");
  paint();
  // A star on a row that stays (its trailing slot rebuilds the row): focus moves to the rebuilt row, not to the page.
  tree.focusItem("pack:p4");
  const keep = item("pack:p4").querySelector<HTMLElement>(".favourite-toggle")!;
  keep.focus(); keep.click();
  expect([favs, focused(), item("pack:p4").querySelector(".favourite-toggle")!.getAttribute("aria-pressed")]).toEqual([["p4"], "pack:p4", "true"]);
  // Without focus in the tree, nothing is focused for it.
  (document as unknown as { activeElement: unknown }).activeElement = null;
  favs = [];
  paint();
  expect(document.activeElement).toBeNull();
});

test("tree view: a group and a row may share an ID; the tree holds only its items, the status and empty message sit beside it (UI-123)", async () => {
  const { TreeView } = await lib();
  const activated: string[] = [], toggled: string[] = [];
  const expanded = new Set(["x"]);
  const tree = new TreeView({ label: "Shared", emptyText: "Nothing here.", onActivate: id => activated.push(id), onToggle: (id, open) => toggled.push(`${id}:${open}`) });
  document.body.append(tree.element);
  tree.update({ groups: [{ id: "x", label: "Group X", rows: [{ id: "x", label: "Row X" }, { id: "y", label: "Row Y" }] }], expanded, loading: "Loading Row X…" });
  const el = tree.element as unknown as LightElement;
  const treeEl = el.querySelector('[role="tree"]')!;
  expect(treeEl.getAttribute("aria-label")).toBe("Shared");
  // Two items with the ID "x", both in the page and told apart by their kind.
  expect(treeEl.querySelectorAll(".tree-item").map(item => [item.dataset.id, item.dataset.kind])).toEqual([["x", "group"], ["x", "row"], ["y", "row"]]);
  treeEl.querySelectorAll(".tree-row")[0]!.click();
  treeEl.querySelectorAll(".tree-group")[0]!.click();
  expect([activated, toggled]).toEqual([["x"], ["x:false"]]);
  // Keys move through both, and focusItem prefers the row unless the kind is given.
  tree.focusItem("x");
  expect(document.activeElement?.getAttribute("data-kind")).toBe("row");
  tree.focusItem("x", "group");
  expect(document.activeElement?.getAttribute("data-kind")).toBe("group");
  key(document.activeElement as HTMLElement, "ArrowDown"); key(document.activeElement as HTMLElement, "ArrowDown");
  expect([document.activeElement?.getAttribute("data-id"), document.activeElement?.getAttribute("data-kind")]).toEqual(["y", "row"]);
  // Everything inside role=tree is its items; the status and the empty message are outside it.
  const status = el.querySelector('[role="status"]')!, empty = el.querySelector(".tree-empty")!;
  expect([treeEl.contains(status), treeEl.contains(empty), status.textContent, status.hidden]).toEqual([false, false, "Loading Row X…", false]);
  expect(treeEl.descendants().filter(node => node.getAttribute("role") !== "treeitem" && !node.closest(".tree-item") && !node.classList.contains("tree-spacer"))).toEqual([]);
  tree.update({ groups: [], expanded });
  expect([empty.hidden, empty.textContent, status.hidden]).toEqual([false, "Nothing here.", true]);
});

test("folder setting: says what it uses, a refusal shows inline on the reserved line, the typed box commits on Enter, the picker is used where there is one", async () => {
  const { FolderSetting } = await lib();
  const chosenPaths: string[] = []; let picks = 0;
  const folder = new FolderSetting({ label: "Saves folder", onChoose: async path => path.includes("Saves") ? (chosenPaths.push(path), { ok: true as const }) : { ok: false as const, message: "That folder has no saves in it." },
    onPick: async () => { picks++; return { ok: false as const, message: "", cancelled: true }; }, onUseDetected: async () => ({ ok: true as const }) });
  folder.update({ chosen: null, detected: "%USERPROFILE%\Saves" });
  const el = folder.element as unknown as LightElement;
  const using = el.querySelector(".folder-using")!, note = el.querySelector(".folder-note")!, typed = el.querySelector(".folder-typed")!;
  // The note line takes no room until the text box opens (then it is reserved, so a refusal of what was typed moves nothing).
  expect([using.textContent, note.hidden, note.classList.contains("empty")]).toEqual(["Detected: %USERPROFILE%\Saves", true, true]);
  const choose = Array.from(el.querySelectorAll("button")).find(b => b.textContent === "Choose another folder…")!;
  choose.click(); await Promise.resolve();
  expect([typed.hidden, note.hidden]).toEqual([false, false]);
  folder.input.value = "D:\Elsewhere"; key(folder.input, "Enter");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect([note.textContent, note.classList.contains("empty"), typed.hidden]).toEqual(["That folder has no saves in it.", false, false]);
  folder.input.value = "D:\Saves"; key(folder.input, "Enter");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect([chosenPaths, typed.hidden, note.classList.contains("empty")]).toEqual([["D:\Saves"], true, true]);
  folder.update({ chosen: "D:\Saves", detected: "%USERPROFILE%\Saves", canPick: true });
  const useDetected = Array.from(el.querySelectorAll("button")).find(b => b.textContent === "Use the detected folder")!;
  expect([using.textContent, useDetected.hidden]).toEqual(["Using: D:\Saves", false]);
  choose.click(); await new Promise(resolve => setTimeout(resolve, 0));
  // A cancelled picker says nothing.
  expect([picks, typed.hidden, note.textContent]).toEqual([1, true, ""]);
});

test("folder setting: an action that fails outright is a plain refusal on the note line, and the controls come back (UI-124)", async () => {
  const { FolderSetting } = await lib();
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  process.on("unhandledRejection", onRejection);
  try {
    const folder = new FolderSetting({ label: "Game folder", onChoose: async () => { throw Error("EACCES: internal detail"); } });
    folder.update({ chosen: null });
    const el = folder.element as unknown as LightElement, note = el.querySelector(".folder-note")!;
    const choose = Array.from(el.querySelectorAll("button")).find(b => b.textContent === "Choose another folder…")!;
    choose.click(); await Promise.resolve();
    folder.input.value = "D:\\Games\\Cyberpunk 2077"; key(folder.input, "Enter");
    await new Promise(resolve => setTimeout(resolve, 10));
    const save = Array.from(el.querySelectorAll("button")).find(b => b.textContent === "Save")!;
    expect([note.textContent, note.classList.contains("empty"), el.querySelector(".folder-typed")!.hidden, folder.input.value, save.getAttribute("aria-disabled")])
      .toEqual(["Couldn't change the folder. Try again.", false, false, "D:\\Games\\Cyberpunk 2077", null]);
    expect(rejections).toEqual([]);
  } finally { process.off("unhandledRejection", onRejection); }
});

test("swatch card: shows the true colour after the pointer rests, follows to the next swatch at once, describes its swatch, hides on Escape; the marker keeps its place", async () => {
  const { SwatchCard, contrastMark, setContrastMark, CONTRAST_WORDS } = await lib();
  const card = new SwatchCard({ delay: 5 });
  const list = document.createElement("div");
  const items = [0, 1].map(n => { const item = document.createElement("button"); item.setAttribute("data-position", String(n)); list.append(item); return item; });
  document.body.append(list);
  const samples = [{ colours: ["#3e2117"], label: "Cold white", source: "From a pack", enhanced: true }, { colours: ["#101010", "#e0d0c0"], label: "Ombre", source: null }];
  const detach = card.attach(list, target => { const item = target.closest("[data-position]") as HTMLElement | null;
    return item ? { anchor: item, sample: samples[Number(item.getAttribute("data-position"))]! } : null; });
  const over = (element: HTMLElement) => (element as unknown as LightElement).dispatchEvent(lightEvent("pointerover"));
  over(items[0]!);
  expect(card.element.hidden).toBe(true);
  await new Promise(resolve => setTimeout(resolve, 20));
  const text = (selector: string) => card.element.querySelector(selector) as unknown as HTMLElement;
  expect([card.element.hidden, card.element.getAttribute("role"), items[0]!.getAttribute("aria-describedby")]).toEqual([false, "tooltip", card.element.id]);
  expect([text(".swatch-card-name").textContent, text(".swatch-card-source").textContent, text(".swatch-card-note").textContent]).toEqual(["Cold white", "From a pack", CONTRAST_WORDS.card]);
  expect((text(".swatch-card-sample").style as unknown as Record<string, string>).background).toBe("#3e2117");
  // Already showing: the next swatch follows at once; a gradient shows root to tip, without the true-colour line.
  over(items[1]!);
  expect([items[0]!.getAttribute("aria-describedby"), items[1]!.getAttribute("aria-describedby"), text(".swatch-card-note").hidden, text(".swatch-card-source").hidden]).toEqual([null, card.element.id, true, true]);
  expect((text(".swatch-card-sample").style as unknown as Record<string, string>).background).toBe("linear-gradient(to bottom, #101010, #e0d0c0)");
  key(list, "Escape");
  expect([card.element.hidden, items[1]!.getAttribute("aria-describedby")]).toEqual([true, null]);
  // Keyboard focus shows it at once.
  (items[0] as unknown as LightElement).dispatchEvent(lightEvent("focusin"));
  expect(card.element.hidden).toBe(false);
  detach();
  expect(card.element.hidden).toBe(true);
  const mark = contrastMark();
  // Off: a help tip that keeps its place, invisible and out of the tab order; on: a named button whose description is the tip.
  expect([mark.tagName, mark.classList.contains("empty"), mark.getAttribute("tabindex"), mark.getAttribute("aria-label")]).toEqual(["button", true, "-1", `About ${CONTRAST_WORDS.mark}`]);
  setContrastMark(mark, true);
  expect([mark.classList.contains("empty"), mark.getAttribute("tabindex"), mark.dataset.help]).toEqual([false, "0", CONTRAST_WORDS.markTip]);
});

test("folder setting: several found folders are all shown as choices with where they were found; pressing one saves it; an optional folder can be cleared", async () => {
  const { FolderSetting } = await lib();
  const selected: string[] = []; let cleared = 0;
  const folder = new FolderSetting({ label: "Cyberpunk 2077 folder", onChoose: async () => ({ ok: true as const }),
    onSelect: async path => { selected.push(path); return { ok: true as const }; }, onClear: async () => { cleared++; return { ok: true as const }; } });
  const found = [{ path: "D:\Steam\Cyberpunk 2077", source: "Steam" }, { path: "E:\GOG\Cyberpunk 2077", source: "GOG, Mod Organizer 2" }];
  folder.update({ chosen: "E:\GOG\Cyberpunk 2077", found });
  const el = folder.element as unknown as LightElement;
  const choices = () => Array.from(el.querySelectorAll(".folder-choice"));
  expect(choices().map(choice => [choice.querySelector(".folder-choice-path")!.textContent, choice.querySelector(".folder-choice-source")!.textContent,
    choice.getAttribute("aria-pressed")])).toEqual([["D:\Steam\Cyberpunk 2077", "Steam", "false"], ["E:\GOG\Cyberpunk 2077", "GOG, Mod Organizer 2", "true"]]);
  // The pressed choice says what is in use, so the "Using" line is quiet.
  expect(el.querySelector(".folder-using")!.hidden).toBe(true);
  choices()[1]!.click(); await Promise.resolve();
  expect(selected).toEqual([]);
  choices()[0]!.click(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(selected).toEqual(["D:\Steam\Cyberpunk 2077"]);
  // A chosen folder that isn't among those found is listed first.
  folder.update({ chosen: "F:\Elsewhere", found });
  expect(choices().map(choice => choice.querySelector(".folder-choice-path")!.textContent)).toEqual(["F:\Elsewhere", "D:\Steam\Cyberpunk 2077", "E:\GOG\Cyberpunk 2077"]);
  const clear = Array.from(el.querySelectorAll("button")).find(b => b.textContent === "Don't use a folder")!;
  expect(clear.hidden).toBe(false);
  clear.click(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(cleared).toBe(1);
  folder.update({ chosen: null, found: [] });
  expect([clear.hidden, el.querySelector(".folder-using")!.textContent]).toEqual([true, "Not chosen yet"]);
});

test("choice list: every choice shown in the Character look; arrows move focus without choosing, a click chooses; unavailable choices keep their reason; tiles carry an accessible name", async () => {
  const { ChoiceList } = await lib();
  const chosen: string[] = [];
  const list = new ChoiceList<string>({ label: "Body", reserveNote: true, onSelect: value => chosen.push(value),
    options: [{ value: "still", label: "Still" }, { value: "closeup", label: "Creator close-up" }, { value: "inventory", label: "Inventory" }] });
  const el = list.element as unknown as LightElement;
  const items = () => Array.from(el.querySelectorAll(".choice"));
  expect(el.querySelector(".choices")!.classList.contains("chips")).toBe(true);
  list.update("closeup");
  expect(items().map(item => [item.getAttribute("role"), item.getAttribute("aria-selected"), item.tabIndex])).toEqual([["option", "false", -1], ["option", "true", 0], ["option", "false", -1]]);
  // An unchanged list rebuilds nothing.
  const before = items()[0];
  list.setOptions([{ value: "still", label: "Still" }, { value: "closeup", label: "Creator close-up" }, { value: "inventory", label: "Inventory" }]);
  expect(items()[0]).toBe(before);
  items()[1]!.focus();
  key(el.querySelector(".choices") as unknown as HTMLElement, "ArrowRight");
  expect(chosen).toEqual([]);
  items()[2]!.click();
  expect(chosen).toEqual(["inventory"]);
  list.update("still", value => value === "inventory" ? { available: false, reason: "That idle isn't prepared." } : { available: true });
  expect([items()[2]!.getAttribute("aria-disabled"), items()[2]!.getAttribute("data-reason")]).toEqual(["true", "That idle isn't prepared."]);
  items()[2]!.click();
  expect(chosen).toEqual(["inventory"]);
  list.update("still", undefined, { disabled: true, reason: "Your V's motion appears once the 3D preview is ready." });
  expect(el.querySelector(".control-note")!.textContent).toBe("Your V's motion appears once the 3D preview is ready.");
  const tiles = new ChoiceList<string>({ label: "Eye shape", layout: "tiles", onSelect: () => {}, options: [{ value: "0", label: "1", name: "Eye shape 1" }] });
  const tile = (tiles.element as unknown as LightElement).querySelector(".choice")!;
  expect([tile.getAttribute("aria-label"), tile.textContent]).toEqual(["Eye shape 1", "1"]);
});

test("bipolar slider: the readout names the direction, drags snap to the centre, Enter types an exact value, Delete returns to the centre, mixed until edited", async () => {
  const { BipolarSlider } = await lib();
  const { calls, t } = log();
  const control = new BipolarSlider({ label: "Look sideways", min: -100, max: 100, step: 1, unit: "%", ends: { negative: "Left", positive: "Right" }, transaction: t });
  document.body.append(control.element);
  const readout = control.element.querySelector<HTMLElement>(".readout-value")!, field = control.element.querySelector<HTMLInputElement>(".readout-input")!;
  const track = control.element.querySelector<HTMLElement>(".bipolar-track")! as unknown as LightElement;
  control.update(20);
  expect([readout.textContent, control.input.getAttribute("aria-valuetext"), control.element.classList.contains("set"), control.resetButton!.classList.contains("idle")])
    .toEqual(["20 % right", "20 % right", true, false]);
  expect([track.style.values.get("--zero"), track.style.values.get("--lo"), track.style.values.get("--hi")]).toEqual(["0.5", "0.5", "0.6"]);
  expect(Array.from((control.element.querySelector(".bipolar-ends")! as unknown as LightElement).children).map(e => e.textContent)).toEqual(["Left", "Right"]);
  control.update(-35);
  expect([readout.textContent, track.style.values.get("--lo"), track.style.values.get("--hi")]).toEqual(["35 % left", "0.325", "0.5"]);
  control.update(0);
  expect([readout.textContent, control.element.classList.contains("set"), control.resetButton!.classList.contains("idle")]).toEqual(["0", false, true]);
  // A pointer drag near the centre records exactly 0; a keyboard step stays exact.
  fire(control.input, "pointerdown");
  control.input.value = "2"; fire(control.input, "input");
  expect(calls).toEqual(["begin", "edit 0"]);
  fire(control.input, "pointerup"); fire(control.input, "change");
  calls.length = 0;
  control.input.value = "2"; fire(control.input, "input"); fire(control.input, "blur");
  expect(calls).toEqual(["begin", "edit 2", "commit"]);
  calls.length = 0;
  // Enter types in the readout's place: "30 left" is -30, one step; Escape changes nothing; focus returns to the slider.
  control.update(2);
  key(control.input, "Enter");
  expect([field.hidden, readout.hidden, field.value, document.activeElement === (field as unknown)]).toEqual([false, true, "2", true]);
  field.value = "30 left"; key(field, "Enter");
  expect([calls, field.hidden, document.activeElement === (control.input as unknown)]).toEqual([["begin", "edit -30", "commit"], true, true]);
  calls.length = 0;
  control.update(-30);
  readout.click(); field.value = "90"; key(field, "Escape");
  expect([calls, readout.textContent]).toEqual([[], "30 % left"]);
  field.hidden = true;
  readout.click(); field.value = "250"; key(field, "Enter");
  expect(calls).toEqual(["begin", "edit 100", "commit"]);
  calls.length = 0;
  // Delete (and the reset) return to the centre as one step.
  control.update(100);
  key(control.input, "Delete");
  expect(calls).toEqual(["begin", "edit 0", "commit"]);
  calls.length = 0;
  // Mixed: the readout says so, the value text keeps the net value, nothing is edited until the person moves it.
  control.update(10, { mixed: true });
  expect([readout.textContent, control.input.getAttribute("aria-valuetext"), control.element.classList.contains("mixed"), control.element.classList.contains("set"), calls])
    .toEqual(["Mixed", "Mixed: 10 % right", true, true, []]);
  control.resetButton!.click();
  expect(calls).toEqual(["begin", "edit 0", "commit"]);
  // Disabled: the range is disabled, the readout can't be edited and the reset stays out of sight.
  control.update(40, { disabled: true, reason: "Your V's face isn't read yet." });
  readout.click();
  expect([control.input.disabled, control.input.title, field.hidden, control.resetButton!.classList.contains("idle")]).toEqual([true, "Your V's face isn't read yet.", true, true]);
});

test("icon button: a mode toggle carries its pressed state and the mode class; tree view: maxRows fits the frame to its visible items", async () => {
  const { iconButton, TreeView } = await lib();
  const mirror = iconButton({ label: "Mirror sides: Brows", icon: "mirror", mode: true, pressed: true });
  expect([mirror.classList.contains("mode"), mirror.getAttribute("aria-pressed")]).toEqual([true, "true"]);
  expect(iconButton({ label: "Hide Petal wash", icon: "eye", pressed: true }).classList.contains("mode")).toBe(false);
  const expanded = new Set<string>();
  const groups = [{ id: "a", label: "Saved", rows: [{ id: "a1", label: "Smirk" }, { id: "a2", label: "Calm" }] }, { id: "b", label: "Natural", rows: Array.from({ length: 12 }, (_, i) => ({ id: `b${i}`, label: `Sample ${i}` })) }];
  const tree = new TreeView({ label: "Start from", maxRows: 6, minRows: 3, onActivate: () => {}, onToggle: () => {} });
  const height = () => (tree.element as unknown as { style: { height?: string } }).style.height;
  tree.update({ groups, expanded });
  expect(height()).toBe(`${3 * 28 + 2}px`);
  tree.update({ groups, expanded: new Set(["a"]) });
  expect(height()).toBe(`${4 * 28 + 2}px`);
  tree.update({ groups, expanded: new Set(["a", "b"]) });
  expect(height()).toBe(`${6 * 28 + 2}px`);
  // Empty, the frame fits its message (no fixed height), never under the floor.
  tree.update({ groups: [], expanded });
  expect([height() || "", (tree.element as unknown as { style: { minHeight?: string } }).style.minHeight]).toEqual(["", `${3 * 28 + 2}px`]);
  const free = new TreeView({ label: "Owner sized", onActivate: () => {}, onToggle: () => {} });
  free.update({ groups, expanded });
  expect((free.element as unknown as { style: { height?: string } }).style.height).toBeUndefined();
});

test("direction dial: the dial maps angle and height both ways, keys make one burst, typed values are one step, unavailable says why", async () => {
  const { DirectionDial, dialPoint, dialDirection, azimuthWords } = await lib();
  // Front at the bottom, V's right on the left, straight up at the centre, level on the dashed ring.
  expect(dialPoint({ azimuth: 0, elevation: 0 })).toEqual({ x: 50, y: 72 });
  expect(dialPoint({ azimuth: 90, elevation: 0 }).x).toBeCloseTo(28, 9);
  expect(dialPoint({ azimuth: 45, elevation: 90 })).toEqual({ x: 50, y: 50 });
  for (const direction of [{ azimuth: 329, elevation: 22 }, { azimuth: 90, elevation: -30 }, { azimuth: 180, elevation: 60 }]) {
    const p = dialPoint(direction);
    expect(dialDirection(p.x, p.y, { min: -89, max: 89 })).toEqual(direction);
  }
  expect([azimuthWords(0), azimuthWords(90), azimuthWords(270), azimuthWords(330), azimuthWords(180), azimuthWords(140)])
    .toEqual(["from the front", "from V's right", "from V's left", "from the front, V's left", "from behind", "from behind, V's right"]);
  const { calls, t } = log();
  const dial = new DirectionDial({ label: "Direction", transaction: t, reserveNote: true });
  dial.update({ azimuth: 329, elevation: 22 }, { colour: "#fff2e9", others: [{ azimuth: 30, elevation: 5, colour: "#c6dafa" }] });
  expect([dial.dial.getAttribute("role"), dial.dial.getAttribute("aria-valuenow"), dial.dial.getAttribute("aria-valuetext")])
    .toEqual(["slider", "329", "329°, from the front, V's left, 22° up"]);
  key(dial.dial, "ArrowRight"); key(dial.dial, "ArrowRight"); key(dial.dial, "ArrowUp");
  expect(calls).toEqual(["begin", 'edit {"azimuth":334,"elevation":22}', 'edit {"azimuth":339,"elevation":22}', 'edit {"azimuth":339,"elevation":27}']);
  fire(dial.dial, "blur");
  expect(calls.at(-1)).toBe("commit");
  calls.length = 0;
  key(dial.dial, "PageUp"); fire(dial.dial, "blur");
  expect(calls).toEqual(["begin", 'edit {"azimuth":354,"elevation":27}', "commit"]);
  calls.length = 0;
  key(dial.dial, "Home"); fire(dial.dial, "blur");
  expect(calls[1]).toBe('edit {"azimuth":0,"elevation":27}');
  // The height readout, typed in place, is one step, clamped to the range.
  calls.length = 0;
  const [angle, height] = [...dial.element.querySelectorAll(".readout-field")] as HTMLElement[];
  expect(angle!.querySelector("output")!.textContent).toBe("0°");
  fire(height!.querySelector("output") as HTMLElement, "click");
  const field = height!.querySelector("input") as HTMLInputElement;
  field.value = "120"; key(field, "Enter");
  expect(calls).toEqual(["begin", 'edit {"azimuth":0,"elevation":89}', "commit"]);
  // Unavailable: no input, the reason on the reserved note line.
  calls.length = 0;
  dial.update({ azimuth: 0, elevation: 89 }, { disabled: true, reason: "The preview is still loading." });
  key(dial.dial, "ArrowLeft");
  expect(calls).toEqual([]);
  expect([dial.dial.getAttribute("aria-disabled"), dial.element.querySelector(".control-note")!.textContent]).toEqual(["true", "The preview is still loading."]);
});

test("light list: each row leads with the light's colour chip and kind glyph, and is named with its kind and meta", async () => {
  const { LightList } = await lib();
  const picked: string[] = [];
  const list = new LightList({ label: "Lights", maxLength: 60, onSelect: id => picked.push(id), onMove: () => {}, onRename: () => {}, onMenu: () => {} });
  document.body.append(list.element);
  list.update([{ id: "key", name: "Key", meta: "2.5 · shadows", colour: "#fff2e9", kind: "directional" },
    { id: "neon", name: "Neon sign", meta: "40", colour: "#ff3d9a", kind: "spot" }], "neon");
  const rows = [...list.element.querySelectorAll(".item-row")] as HTMLElement[];
  expect(rows).toHaveLength(2);
  const chip = rows[1]!.querySelector(".light-chip") as unknown as { style: { values: Map<string, string> } };
  expect(chip.style.values.get("--swatch")).toBe("#ff3d9a");
  expect(rows[1]!.querySelector(".light-kind")!.getAttribute("title")).toBe("Spot light");
  expect(rows[1]!.querySelector(".item-main")!.getAttribute("aria-label")).toBe("Neon sign, spot light, 40, selected");
  expect(rows[0]!.querySelector(".item-main")!.getAttribute("aria-label")).toBe("Key, directional light, 2.5 · shadows");
  fire(rows[0]!.querySelector(".item-main") as HTMLElement, "click");
  expect(picked).toEqual(["key"]);
  expect(list.element.classList.contains("light-list")).toBe(true);
});

test("choice list with swatches: the swatch card shows a choice's colour and name, its item has no tooltip, and the contrast marker follows `enhanced`", async () => {
  const { ChoiceList, swatchCard, attachSwatchCard, choiceItem } = await lib();
  const list = new ChoiceList({ label: "Colour", onSelect: () => {}, swatchCard: true, options: [{ value: "a", label: "Auburn", title: "From a pack", swatch: "#3e2117" }, { value: "b", label: "Plain" }] });
  document.body.append(list.element);
  const [auburn, plain] = list.list.querySelectorAll(".choice") as unknown as HTMLElement[];
  expect(auburn!.getAttribute("title")).toBeNull();
  (auburn as unknown as LightElement).dispatchEvent(lightEvent("focusin"));
  const card = swatchCard().element;
  expect([card.hidden, (card.querySelector(".swatch-card-name") as unknown as HTMLElement).textContent]).toEqual([false, "Auburn"]);
  // A choice without a swatch shows no card.
  (plain as unknown as LightElement).dispatchEvent(lightEvent("focusin"));
  expect(card.hidden).toBe(true);
  const mark = list.element.querySelector(".contrast-mark") as unknown as HTMLElement;
  expect(mark.classList.contains("empty")).toBe(true);
  list.update("a", undefined, { enhanced: true });
  expect(mark.classList.contains("empty")).toBe(false);
  // Any list of choice items: a swatch item takes no tooltip; attachSwatchCard asks the owner for the sample.
  const host = document.createElement("div");
  const item = choiceItem({ label: "Cold white", title: "Cold white · From a pack", swatch: true, content: Object.assign(document.createElement("span"), { className: "swatch" }) });
  host.append(item); document.body.append(host);
  expect(item.getAttribute("title")).toBeNull();
  const detach = attachSwatchCard(host, () => ({ colours: ["#8d513e"], label: "Cold white", source: "From a pack", enhanced: true }));
  (item as unknown as LightElement).dispatchEvent(lightEvent("focusin"));
  expect([card.hidden, (card.querySelector(".swatch-card-note") as unknown as HTMLElement).hidden]).toEqual([false, false]);
  detach();
});

test("switch: a mixed state (some of what it covers is on) reads mixed, shows no check, and a press turns it fully on", async () => {
  const { Toggle } = await lib();
  const changes: boolean[] = [];
  const toggle = new Toggle({ label: "Symmetric", onChange: on => changes.push(on) });
  toggle.update(false, { mixed: true });
  expect([toggle.input.indeterminate, toggle.input.checked, toggle.input.getAttribute("role"), toggle.input.getAttribute("aria-checked")]).toEqual([true, false, "checkbox", "mixed"]);
  toggle.update(true);
  expect([toggle.input.indeterminate, toggle.input.checked, toggle.input.getAttribute("role"), toggle.input.getAttribute("aria-checked")]).toEqual([false, true, "switch", null]);
});

test("scrub slider: rests at the middle, previews while moved, applies on release away from it, cancels at the middle, on Escape and in the bleed area", async () => {
  const { ScrubSlider } = await lib();
  const calls: string[] = [];
  const scrub = new ScrubSlider<"linear" | "in">({ label: "Intensity", ends: { negative: "Rest", positive: "Full" },
    onBegin: () => calls.push("begin"), onPreview: p => calls.push(`preview ${p}`), onCommit: () => calls.push("commit"), onCancel: () => calls.push("cancel"),
    curves: [{ value: "linear", label: "Curve: Linear", icon: "easeLinear" }, { value: "in", label: "Curve: Ease in", icon: "easeIn" }], onCurve: c => calls.push(`curve ${c}`) });
  document.body.append(scrub.element);
  scrub.update({ curve: "linear" });
  const readout = scrub.element.querySelector<HTMLElement>(".readout")!;
  expect([scrub.input.value, readout.textContent]).toEqual(["50", "50 %"]);
  const drag = (to: number) => { scrub.input.value = String(to); fire(scrub.input, "input"); };
  const up = () => (globalThis as unknown as { dispatchEvent(e: unknown): void }).dispatchEvent(Object.assign(new Event("pointerup"), {}));
  // A drag: preview live, release away from the middle applies, then it springs back.
  fire(scrub.input, "pointerdown"); drag(70); drag(80); up();
  expect([calls, scrub.input.value]).toEqual([["begin", "preview 70", "preview 80", "commit"], "50"]);
  calls.length = 0;
  // Released back at the middle: nothing applied.
  fire(scrub.input, "pointerdown"); drag(40); drag(50); up();
  expect(calls).toEqual(["begin", "preview 40", "preview 50", "cancel"]);
  calls.length = 0;
  // The bleed area: the pointer strays far from the slider, the preview snaps back to the middle, and a release out there applies nothing.
  const move = (x: number, y: number) => (globalThis as unknown as { dispatchEvent(e: unknown): void }).dispatchEvent(Object.assign(new Event("pointermove"), { clientX: x, clientY: y }));
  fire(scrub.input, "pointerdown"); drag(90); move(0, 200);
  expect([scrub.input.value, scrub.element.classList.contains("bleed")]).toEqual(["50", true]);
  drag(95); up();
  expect([calls, scrub.input.value, scrub.element.classList.contains("bleed")]).toEqual([["begin", "preview 90", "preview 50", "cancel"], "50", false]);
  calls.length = 0;
  // Coming back within the margin resumes the preview.
  fire(scrub.input, "pointerdown"); drag(60); move(0, 200); move(0, 10); drag(65); up();
  expect(calls).toEqual(["begin", "preview 60", "preview 50", "preview 65", "commit"]);
  calls.length = 0;
  // Keyboard: arrows preview, Enter applies; Escape cancels.
  drag(55); key(scrub.input, "Enter");
  drag(45); key(scrub.input, "Escape");
  expect(calls).toEqual(["begin", "preview 55", "commit", "begin", "preview 45", "cancel"]);
  calls.length = 0;
  // The curve buttons are toggles; choosing one tells the owner.
  const [linear, easeIn] = (scrub.element.querySelector(".scrub-curves")! as unknown as LightElement).children as unknown as HTMLElement[];
  expect([linear!.getAttribute("aria-pressed"), easeIn!.getAttribute("aria-pressed")]).toEqual(["true", "false"]);
  easeIn!.click();
  expect(calls).toEqual(["curve in"]);
});

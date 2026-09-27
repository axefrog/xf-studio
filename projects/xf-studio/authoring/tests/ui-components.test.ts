// The component library's controls (UI-110): behaviour, states and accessibility of the components features compose, in the light DOM.
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { installLightDom, lightEvent, uninstallLightDom, type LightElement } from "./light-dom";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());
beforeEach(async () => { (await import("../src/studio-ui/components")).resetGroupSections(); document.body.replaceChildren(); });

const lib = () => import("../src/studio-ui/components");
const key = (element: HTMLElement, name: string) => (element as unknown as LightElement).dispatchEvent(lightEvent("keydown", { key: name }));
const fire = (element: HTMLElement, type: string) => (element as unknown as LightElement).dispatchEvent(lightEvent(type));
const log = () => { const calls: string[] = []; return { calls, t: { begin: () => calls.push("begin"), edit: (v: unknown) => calls.push(`edit ${JSON.stringify(v)}`), commit: () => calls.push("commit"), cancel: () => calls.push("cancel") } }; };

test("slider with value: the number commits clamped and snapped as one step; Escape restores; reset is one step and unavailable at the default", async () => {
  const { SliderWithValue } = await lib();
  const { calls, t } = log();
  const control = new SliderWithValue({ label: "Brow raise", min: 0, max: 1, step: .05, format: v => `${Math.round(v * 100)} %`, transaction: t, defaultValue: 0, reset: true, reserveNote: true });
  control.update(.4);
  expect([control.number.value, control.number.getAttribute("aria-label"), control.input.getAttribute("aria-valuetext")]).toEqual(["0.4", "Brow raise, exact value", "40 %"]);
  expect(control.element.classList.contains("set")).toBe(true);
  control.number.value = "1.33"; fire(control.number, "change");
  expect(calls).toEqual(["begin", "edit 1", "commit"]);
  expect(control.number.value).toBe("1");
  calls.length = 0;
  control.number.value = "0.52"; key(control.number, "Enter");
  expect(calls).toEqual(["begin", "edit 0.5", "commit"]);
  calls.length = 0;
  control.update(.5);
  control.number.value = "0.9"; key(control.number, "Escape");
  expect([control.number.value, calls]).toEqual(["0.5", []]);
  control.resetButton!.click();
  expect(calls).toEqual(["begin", "edit 0", "commit"]);
  control.update(0);
  expect([control.element.classList.contains("set"), control.resetButton!.getAttribute("aria-disabled"), control.resetButton!.getAttribute("aria-label")])
    .toEqual([false, "true", "Reset Brow raise"]);
  // Disabled: both inputs, the reason on the reserved note line.
  control.update(0, { disabled: true, reason: "Choose a face first." });
  const note = control.element.querySelector<HTMLElement>(".control-note")!;
  expect([control.input.disabled, control.number.disabled, note.textContent, note.hidden]).toEqual([true, true, "Choose a face first.", false]);
});

test("pair control: linked is one row for both sides, separate is two, uneven says so and the next edit sets both", async () => {
  const { PairControl } = await lib();
  const edits: string[] = [], links: boolean[] = [];
  const pair = new PairControl({ label: "Brow height", min: 0, max: 1, step: .01, format: String, onLinkChange: linked => links.push(linked),
    transaction: { edit: edit => edits.push(`${edit.sides}=${edit.value}`) } });
  pair.update({ left: .2, right: .2 }, { linked: true });
  const both = pair.element.querySelector<HTMLElement>(".pair-both")!, sides = pair.element.querySelector<HTMLElement>(".pair-sides")!;
  expect([both.hidden, sides.hidden, pair.link.getAttribute("aria-pressed"), pair.link.textContent]).toEqual([false, true, "true", "Linked"]);
  expect(both.querySelector<HTMLElement>("label")!.textContent).toBe("Brow height, both sides");
  pair.update({ left: .2, right: .6 }, { linked: true });
  expect([pair.element.classList.contains("uneven"), both.querySelector<HTMLElement>(".control-note")!.textContent]).toEqual([true, "Sides differ: the next change sets both."]);
  const range = both.querySelector<HTMLElement>("input")! as unknown as HTMLInputElement;
  range.value = "0.3"; fire(range, "input");
  expect(edits).toEqual(["both=0.3"]);
  pair.link.click();
  expect(links).toEqual([false]);
  pair.update({ left: .2, right: .6 }, { linked: false });
  expect([both.hidden, sides.hidden, pair.link.textContent, Array.from(sides.querySelectorAll<HTMLElement>("label")).map(label => label.textContent)])
    .toEqual([true, false, "Separate", ["Brow height, left", "Brow height, right"]]);
});

test("group section: the count hides at 0, reset never folds the group, the open state lasts the session and search can force or hide it", async () => {
  const { GroupSection } = await lib();
  let resets = 0;
  const make = () => new GroupSection({ title: "Brows", key: "expr.brows", onReset: () => resets++ });
  const group = make();
  group.update({ set: 0 });
  const count = group.element.querySelector<HTMLElement>(".group-count")!, reset = group.element.querySelector<HTMLElement>(".group-reset")!;
  expect([count.hidden, reset.getAttribute("aria-disabled"), group.expanded, group.body.hidden]).toEqual([true, "true", false, true]);
  group.update({ set: 2 });
  expect([count.hidden, count.textContent, reset.getAttribute("aria-disabled")]).toEqual([false, "2 set", null]);
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

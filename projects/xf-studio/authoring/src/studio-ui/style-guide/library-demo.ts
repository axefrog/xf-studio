/** Live specimens for the style guide's Component library section: each is the production component, wired to sample state. */
import { badge, blockSection, button, codeBlock, Combobox, EmptyState, expander, expanderLabel, GroupSection, helpTip, iconButton, ItemList, note,
  PageHeader, PairControl, PanelHeader, progressBar, propertyList, SearchField, Segmented, SelectField, Slider, SliderWithValue, SplitView, stack, TabStrip,
  Toggle, ColorField, applyCapability, openMenu, openConfirmPopover, TreeView, favouriteToggle, FolderSetting, BipolarSlider, type TabItem } from "../components";
import { h } from "../dom";

type Mount = () => HTMLElement;
const tabs: TabItem[] = [["Colour & finish", "finish"], ["Shape", "shape"], ["Pigment & edge", "edge"], ["Warp", "warp"], ["Character", "character"], ["Camera & light", "lighting"]]
  .map(([label, icon]) => ({ id: label.toLowerCase().replace(/\W+/g, "-"), label, icon: icon as TabItem["icon"], tooltip: `${label} · drag to move, right-click for layout options`, closable: true }));

/** A header at a fixed width, fitted like the dock fits its groups; a width slider shows the stages. */
function header(width: number) {
  let active = tabs[0]!.id;
  const strip: TabStrip = new TabStrip({ label: "Sample panels", onSelect: id => { active = id; strip.update(tabs.map(t => ({ ...t, closable: t.id === active })), active); fitted.fit(); } });
  strip.update(tabs, active);
  const fitted = new PanelHeader({ strip, actions: [iconButton({ label: "Collapse sample panels", icon: "chevronDown", expanded: true }),
    iconButton({ label: "Layout options for sample panels", icon: "more", menu: true })], drag: { title: "Drag area", onPointerDown: () => {} } });
  const group = h("section", { class: "dock-group", style: `width:${width}px` }, fitted.element, h("div", { class: "dock-body", style: "height:40px" }));
  const readout = h("output", { class: "readout" });
  const range = h("input", { type: "range", class: "slider", min: "150", max: "760", value: String(width), "aria-label": "Sample group width" });
  const refit = () => { group.style.width = `${range.value}px`; fitted.fit(); readout.textContent = `${range.value} px · ${strip.stage}`; };
  range.addEventListener("input", refit);
  requestAnimationFrame(refit);
  return stack({ gap: "normal" }, group, h("label", { class: "control-label" }, h("span", { text: "Group width" }), readout), range);
}

const MOUNTS: Record<string, Mount> = {
  "lib-button": () => { const unavailable = button({ label: "Build mod files", icon: "package", onClick: () => {} });
    applyCapability(unavailable, { available: false, reason: "Choose your Cyberpunk 2077 folder in Game & tools first." });
    return h("div", { class: "row wrap gap-s" }, button({ label: "Save to library", icon: "save", variant: "primary", onClick: () => {} }),
      button({ label: "Check", icon: "check", onClick: () => {} }), button({ label: "Restore removed", icon: "reset", variant: "quiet", onClick: () => {} }),
      button({ label: "More actions", icon: "more", iconOnly: true, variant: "ghost", menu: true, onClick: event => openMenu([{ kind: "action", label: "Duplicate", icon: "duplicate", run: () => {} }], event.currentTarget as Element, { label: "More actions" }) }),
      unavailable); },
  "lib-icon-button": () => h("div", { class: "row gap-s" }, iconButton({ label: "Close", icon: "close" }), iconButton({ label: "Hide Petal wash", icon: "eye", pressed: true, small: true }),
    iconButton({ label: "Layout options", icon: "more", menu: true }), iconButton({ label: "Reset brows", icon: "reset", small: true }),
    iconButton({ label: "Mirror sides: Brows", icon: "mirror", small: true, mode: true, pressed: true })),
  "lib-switch": () => { const t = new Toggle({ label: "Show my V's own makeup", help: "Draws the makeup saved with your V under your layers.", onChange: checked => t.update(checked) }); t.update(true); return t.element; },
  "lib-slider": () => { const s = new Slider({ label: "Opacity", min: 0, max: 1, step: .01, format: v => `${Math.round(v * 100)}%`, transaction: { edit: v => s.update(v) } }); s.update(.85); return s.element; },
  "lib-slider-value": () => { let value = .4; const s: SliderWithValue = new SliderWithValue({ label: "Brow raise", min: 0, max: 1, step: .05, format: v => `${Math.round(v * 100)} %`,
      defaultValue: 0, reset: true, reserveNote: true, transaction: { edit: v => { value = v; s.update(value); } } });
    s.update(value);
    const off = new SliderWithValue({ label: "Lid squint", min: 0, max: 1, step: .05, format: v => `${Math.round(v * 100)} %`, defaultValue: 0, reset: true, reserveNote: true, transaction: { edit: () => {} } });
    off.update(0, { disabled: true, reason: "Choose a face shape first." });
    return stack({ gap: "normal" }, s.element, off.element); },
  "lib-pair": () => { const values = { left: .2, right: .5 }; let linked = true;
    const pair: PairControl = new PairControl({ label: "Brow height", min: 0, max: 1, step: .01, format: v => `${Math.round(v * 100)} %`, defaultValue: 0, reset: true,
      onLinkChange: next => { linked = next; pair.update(values, { linked }); },
      transaction: { edit: edit => { if (edit.sides === "both") { values.left = values.right = edit.value; } else values[edit.sides] = edit.value; pair.update(values, { linked }); } } });
    pair.update(values, { linked }); return pair.element; },
  "lib-bipolar": () => {
    const make = (label: string, ends: { negative: string; positive: string }, start: number, mixed = false) => {
      let value = start, isMixed = mixed;
      const s: BipolarSlider = new BipolarSlider({ label, min: -100, max: 100, step: 1, unit: "%", ends,
        transaction: { edit: v => { value = v; isMixed = false; s.update(value); } } });
      s.update(value, { mixed: isMixed }); return s; };
    const off = new BipolarSlider({ label: "Jaw sideways", min: -100, max: 100, step: 1, unit: "%", ends: { negative: "Left", positive: "Right" }, transaction: { edit: () => {} } });
    off.update(0, { disabled: true, reason: "Your V's face isn't read yet." });
    return h("div", { style: "max-width:300px" }, stack({ gap: "normal" }, make("Look sideways", { negative: "Left", positive: "Right" }, 20).element,
      make("Look up or down", { negative: "Down", positive: "Up" }, 0).element, make("Brow height", { negative: "Lower", positive: "Raise" }, -15, true).element, off.element)); },
  "lib-segmented": () => { const s: Segmented<string> = new Segmented({ label: "Show", options: [{ value: "both", label: "Both eyes" }, { value: "one", label: "Single eye" }], onSelect: v => s.update(v), compact: true });
    s.update("both"); return s.element; },
  "lib-color": () => { const c: ColorField = new ColorField({ label: "Colour", transaction: { edit: v => c.update(v) } }); c.update("#b0587a"); return c.element; },
  "lib-select": () => { const s: SelectField<string> = new SelectField({ label: "Launch route", help: "How you start the game.", onChange: v => s.update(choices, v) });
    const choices = [{ value: "mo2", label: "Mod Organizer 2" }, { value: "direct", label: "Directly" }]; s.update(choices, "mo2"); return s.element; },
  "lib-combobox": () => { const groups = [{ label: "Your saved expressions", options: [{ value: "smirk", label: "Smirk" }, { value: "calm", label: "Calm" }] },
      { label: "Installed: Expressions Pack", options: [{ value: "smile", label: "Smile", detail: "Open, teeth showing" }, { value: "sneer", label: "Sneer", disabled: true, reason: "Needs its mod" }, { value: "snarl", label: "Snarl" }] }];
    const c: Combobox<string> = new Combobox({ label: "Start from", placeholder: "Type to filter", onChange: v => c.update(groups, v) }); c.update(groups, "smirk");
    return h("div", { style: "max-width:320px;min-height:60px" }, c.element); },
  "lib-search": () => { const items = ["Brow raise", "Brow furrow", "Lid squint", "Smile", "Sneer"];
    const list = h("ul", { class: "note" }); const empty = h("div");
    const search: SearchField = new SearchField({ label: "Search expression controls", placeholder: "Search controls", onFilter: q => {
      const hits = items.filter(item => item.toLowerCase().includes(q.toLowerCase()));
      list.replaceChildren(...hits.map(item => h("li", { text: item }))); empty.replaceChildren(...(hits.length ? [] : [search.noMatches("controls")])); } });
    list.replaceChildren(...items.map(item => h("li", { text: item })));
    return stack({ gap: "normal" }, search.element, list, empty); },
  "lib-expander": () => { const b = expander("section", { expanded: true }, expanderLabel("Face")); b.addEventListener("click", () => b.setAttribute("aria-expanded", String(b.getAttribute("aria-expanded") !== "true")));
    return stack({ gap: "tight" }, h("h4", { style: "margin:0" }, b), expander("row", { expanded: false }, expanderLabel("Eyebrows"))); },
  "lib-group-section": () => { const g: GroupSection = new GroupSection({ title: "Brows", key: "guide.brows", expanded: true, help: "The brow region's controls.", onReset: () => g.update({ set: 0 }) });
    const s = new SliderWithValue({ label: "Brow raise", min: 0, max: 1, step: .05, format: v => `${Math.round(v * 100)} %`, defaultValue: 0, reset: true, transaction: { edit: () => {} } }); s.update(.4);
    g.body.append(s.element); g.update({ set: 1 });
    const folded = new GroupSection({ title: "Mouth", key: "guide.mouth", onReset: () => {} }); folded.update({ set: 0 });
    return stack({ gap: "normal" }, g.element, folded.element); },
  "lib-help-tip": () => h("div", { class: "control-line" }, h("span", { class: "control-label", text: "Finish" }), helpTip("Finish", "How the makeup catches the light.")),
  "lib-reason-tip": () => { const b = button({ label: "Build mod files", icon: "package", onClick: () => {} }); applyCapability(b, { available: false, reason: "Choose your game folder first." }); return b; },
  "lib-menu": () => h("div", { class: "row wrap gap-s" }, button({ label: "Open a menu", icon: "more", menu: true, onClick: event => openMenu([{ kind: "heading", label: "Petal wash" },
    { kind: "action", label: "Duplicate", icon: "duplicate", shortcut: "Ctrl+D", run: () => {} }, { kind: "action", label: "Merge down", icon: "layers", capability: { available: false, reason: "The bottom layer has nothing below it." }, run: () => {} },
    { kind: "separator" }, { kind: "action", label: "Remove", icon: "trash", danger: true, run: () => {} }], event.currentTarget as Element, { label: "Layer actions" }) }),
    button({ label: "Delete a saved expression", icon: "trash", onClick: event => openConfirmPopover(event.currentTarget as Element,
      { title: "Delete saved expression", message: "Delete “Smirk” from your library? This can't be undone.", confirm: "Delete", danger: true, onConfirm: () => {} }) })),
  "lib-item-list": () => { let items = [{ id: "a", name: "Petal wash", meta: "Matte" }, { id: "b", name: "Liner", meta: "Glossy" }]; let selected = "a";
    const list: ItemList<{ id: string; name: string; meta: string }> = new ItemList({ label: "Sample layers", noun: "layer", maxLength: 40,
      onSelect: id => { selected = id; list.update(items, selected); }, onMove: (id, index) => { const item = items.find(i => i.id === id)!; items = items.filter(i => i.id !== id); items.splice(index, 0, item); list.update(items, selected); },
      onRename: (id, name) => { items = items.map(i => i.id === id ? { ...i, name } : i); list.update(items, selected); }, onMenu: () => {} });
    list.update(items, selected); return h("div", { style: "max-width:360px" }, list.element); },
  "lib-tab-strip": () => header(560),
  "lib-panel-header": () => header(260),
  "lib-status": () => { const bar = progressBar({ label: "Building the package", fraction: .42 }); const sweep = progressBar({ label: "Working" });
    return stack({ gap: "normal" }, h("div", { class: "row wrap gap-s" }, badge("Can be built", "success"), badge("Preview only", "warning"), badge("Blocked", "error")),
      note("Built and checked; not tested in game."), bar.element, sweep.element,
      new EmptyState({ title: "No layers in this preset", body: "Layers stack like makeup: the top of the list is applied last.", actions: [button({ label: "Add layer", icon: "plus", onClick: () => {} })] }).element); },
  "lib-layout": () => { const head = new PageHeader({ title: "QuickSave-0", back: { label: "All saves", onClick: () => {} }, meta: "Quick save · game 2.31 · save version 269 · 336 nodes · 2.12 MB",
      actions: [new Segmented({ label: "Show", options: [{ value: "n", label: "Nodes" }, { value: "m", label: "Mod data" }], onSelect: () => {}, compact: true, showLabel: false }).element] });
    return stack({ gap: "loose" }, head.element, blockSection({ title: "game::SessionConfig" }, propertyList([["Kind", "A layout of its own"], ["Size", "54 B"], ["Where", "offset 6,181, chunk 1"]]),
      note("This node has a layout of its own that the explorer doesn't read yet."), codeBlock("000000  cf 59 d8 a3 2b 68 19 6b 9c 5e 2a bb b4 01 11 61 8d 30 33 5f 6e 69 67 68 74 5f 63 69 74 79 42 c0", { label: "Bytes, in hexadecimal" }))); },
  "lib-tree-view": () => {
    const favourites = new Set<string>(["p-2"]), expanded = new Set<string>(["pack-a"]);
    let current = "p-1";
    const groups = () => [
      { id: "pack-a", label: "Idle poses", secondary: "Base game", rows: Array.from({ length: 40 }, (_, i) => ({ id: `p-${i}`, label: `Standing ${i + 1}`, secondary: i % 3 ? undefined : "arms folded",
        badges: favourites.has(`p-${i}`) ? [{ text: "Favourite", tone: "accent" as const }] : [], trailingState: favourites.has(`p-${i}`),
        disabled: i === 5, reason: i === 5 ? "Needs its animation pack installed." : undefined })) },
      { id: "pack-b", label: "Photo poses", secondary: "Photo Mode Unlocker", rows: Array.from({ length: 12 }, (_, i) => ({ id: `q-${i}`, label: `Portrait ${i + 1}` })) },
      { id: "pack-c", label: "Empty pack", rows: [] }];
    const toggle = (id: string) => { if (favourites.has(id)) favourites.delete(id); else favourites.add(id); paint(); };
    const tree: TreeView = new TreeView({ label: "Sample poses", maxRows: 8, minRows: 3, onActivate: id => { current = id; paint(); },
      onToggle: (id, open) => { if (open) expanded.add(id); else expanded.delete(id); paint(); },
      onKey: (event, item) => { if (item.kind === "row" && event.key.toLowerCase() === "f" && !event.ctrlKey) { toggle(item.id); return true; } },
      trailing: row => favouriteToggle({ on: favourites.has(row.id), what: row.label, onToggle: () => toggle(row.id) }),
      onMenu: (item, anchor) => { if (item.kind === "row") openMenu([{ kind: "action", label: favourites.has(item.id) ? "Remove from favourites" : "Add to favourites", icon: "star", run: () => toggle(item.id) }], anchor, { label: "Pose actions" }); } });
    const paint = () => tree.update({ groups: groups(), expanded, current });
    paint();
    const search = new SearchField({ label: "Search sample poses", placeholder: "Search poses (Down moves into the list)", onFilter: () => {}, onArrowDown: () => tree.focus() });
    return h("div", { style: "max-width:420px" }, stack({ gap: "normal" }, search.element, tree.element)); },
  "lib-folder-setting": () => {
    let chosen: string | null = null;
    const folder: FolderSetting = new FolderSetting({ label: "Saves folder", help: "Where the game keeps your saves.", placeholder: "e.g. %USERPROFILE%\\Saved Games\\CD Projekt Red\\Cyberpunk 2077",
      guidance: "Give the folder that holds your save folders (ManualSave-0, QuickSave-0 …).",
      onChoose: async path => { if (!/saved games/i.test(path)) return { ok: false, message: "That folder has no saves in it. Give the folder that holds ManualSave-0 and the others." };
        chosen = path; folder.update({ chosen, detected }); return { ok: true }; },
      onUseDetected: async () => { chosen = null; folder.update({ chosen, detected }); return { ok: true }; } });
    const detected = "%USERPROFILE%\\Saved Games\\CD Projekt Red\\Cyberpunk 2077";
    folder.update({ chosen, detected });
    return h("div", { style: "max-width:520px" }, folder.element); },
  "lib-split-view": () => { const tree = h("ul", { class: "save-tree" }, ...["GameSessionDesc", "DynamicEntityIDSystem", "TypeDatabase_v2"].map(name => h("li", { class: "save-tree-row" }, h("span", { class: "save-tree-name", text: name }))));
    return new SplitView({ label: "the sample tree and inspector", key: "guide.split", initial: .45, min: 140, start: tree,
      end: blockSection({ title: "GameSessionDesc" }, propertyList([["Kind", "Holds child nodes"], ["Size", "58 B"]])) }).element; },
};

/** Build every live specimen on the page (again after the side-by-side comparison rebuilds the specimens). */
export function mountLibrary() {
  for (const host of document.querySelectorAll<HTMLElement>(".live-specimen[data-live]")) {
    const mount = MOUNTS[host.dataset.live!];
    if (mount) host.replaceChildren(mount());
  }
}
export const LIBRARY_SPECIMENS = Object.keys(MOUNTS);

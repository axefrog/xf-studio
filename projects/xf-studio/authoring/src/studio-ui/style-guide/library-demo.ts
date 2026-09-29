/** Live specimens for the style guide's Component library section: each is the production component, wired to sample state. */
import { badge, blockSection, button, codeBlock, Combobox, EmptyState, expander, expanderLabel, GroupSection, helpTip, iconButton, ItemList, note,
  PageHeader, PairControl, PanelHeader, progressBar, propertyList, SearchField, Segmented, SelectField, Slider, SliderWithValue, SplitView, Splitter, stack, TabStrip,
  Toggle, ColorField, applyCapability, openMenu, openValuePopover, openConfirmPopover, TreeView, favouriteToggle, FolderSetting, BipolarSlider, ScrubSlider, ChoiceList, choiceItem, attachSwatchCard, contrastMark, setContrastMark,
  sampleBackground, LightList, DirectionDial, SizeBar, previewTile, previewStage, ScrollMemory, VIEW_KEY, stageTag, RecordList, recordTime, modLine, type LightListItem, type TabItem } from "../components";
import { CONTRAST, contrastGain, enhanceSwatchSet, separationWeight } from "../../swatch-contrast";
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
      defaultValue: 0, reset: true, transaction: { edit: v => { value = v; s.update(value); } } });
    s.update(value);
    const rest = new SliderWithValue({ label: "Brow lower", min: 0, max: 1, step: .05, format: v => `${Math.round(v * 100)} %`, defaultValue: 0, reset: true, transaction: { edit: v => rest.update(v) } });
    rest.update(0);
    const off = new SliderWithValue({ label: "Lid squint", min: 0, max: 1, step: .05, format: v => `${Math.round(v * 100)} %`, defaultValue: 0, reset: true, reserveNote: true, transaction: { edit: () => {} } });
    off.update(0, { disabled: true, reason: "Choose a face shape first." });
    const look = new SliderWithValue({ label: "Hair look", min: 0, max: 100, step: 1, format: v => v < .5 ? "Crisp" : v > 99.5 ? "Game-like" : `${Math.round(v)} % game-like`,
      ends: { min: "Crisp", max: "Game-like" }, defaultValue: 0, reset: true, transaction: { edit: v => look.update(v) } });
    look.update(60);
    return h("div", { style: "max-width:300px" }, stack({ gap: "normal" }, s.element, rest.element, off.element, look.element)); },
  "lib-pair": () => {
    const make = (label: string, values: { left: number; right: number }, linked: boolean) => {
      const pair: PairControl = new PairControl({ label, min: 0, max: 100, step: 1, format: v => `${Math.round(v)} %`, defaultValue: 0, reset: true,
        transaction: { edit: edit => { if (edit.sides === "both") { values.left = values.right = edit.value; } else values[edit.sides] = edit.value; pair.update(values, { linked }); } } });
      pair.update(values, { linked }); return pair.element; };
    return h("div", { style: "max-width:300px" }, stack({ gap: "normal" }, make("Inner brow raise", { left: 35, right: 35 }, true), make("Brow lower", { left: 14, right: 10 }, true),
      make("Squint, inner", { left: 30, right: 26 }, false))); },
  "lib-light-list": () => {
    let lights: LightListItem[] = [{ id: "key", name: "Key", meta: "2.5 · shadows", colour: "#fff2e9", kind: "directional" },
      { id: "fill", name: "Fill", meta: "1", colour: "#c6dafa", kind: "directional" },
      { id: "neon", name: "Neon sign", meta: "40", colour: "#ff3d9a", kind: "spot" }];
    let selected = "key";
    const list: LightList = new LightList({ label: "Lights", maxLength: 60, onSelect: id => { selected = id; list.update(lights, selected); },
      onMove: (id, index) => { const light = lights.find(item => item.id === id)!; lights = lights.filter(item => item.id !== id); lights.splice(index, 0, light); list.update(lights, selected); },
      onRename: (id, name) => { lights = lights.map(item => item.id === id ? { ...item, name } : item); list.update(lights, selected); },
      onMenu: () => {} });
    list.update(lights, selected);
    return h("div", { style: "max-width:320px" }, list.element); },
  "lib-direction-dial": () => {
    const dial: DirectionDial = new DirectionDial({ label: "Direction", transaction: { edit: value => dial.update(value, { colour: "#fff2e9", others }) } });
    const others = [{ azimuth: 30, elevation: 5, colour: "#c6dafa" }, { azimuth: 150, elevation: 35, colour: "#e6eeff" }];
    dial.update({ azimuth: 329, elevation: 22 }, { colour: "#fff2e9", others });
    return h("div", { style: "max-width:260px" }, dial.element); },
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
  "lib-scrub": () => {
    type Curve = "linear" | "in" | "out" | "inOut";
    let curve = "linear" as Curve;
    const values = [0.4, 0.2, 0.6], bars = values.map(() => h("span", { class: "readout" }));
    const show = (amount: number) => values.forEach((v, i) => { const w = amount >= 0 ? v + (1 - v) * amount : v * (1 + amount); bars[i]!.textContent = `${Math.round(w * 100)} %`; });
    const scrub: ScrubSlider<Curve> = new ScrubSlider<Curve>({ label: "Intensity", ends: { negative: "Rest", positive: "Full" },
      curves: [{ value: "linear", label: "Curve: Linear", icon: "easeLinear" }, { value: "in", label: "Curve: Ease in", icon: "easeIn" }, { value: "out", label: "Curve: Ease out", icon: "easeOut" }, { value: "inOut", label: "Curve: Ease in-out", icon: "easeInOut" }],
      onCurve: next => { curve = next; scrub.update({ curve }); }, onBegin: () => {}, onPreview: p => show((p - 50) / 50), onCommit: () => {}, onCancel: () => show(0) });
    scrub.update({ curve }); show(0);
    return h("div", { style: "max-width:300px" }, stack({ gap: "normal" }, scrub.element, h("div", { class: "row gap-m" }, ...bars))); },
  "lib-segmented": () => { const s: Segmented<string> = new Segmented({ label: "Show", options: [{ value: "both", label: "Both eyes" }, { value: "one", label: "Single eye" }], onSelect: v => s.update(v), compact: true });
    s.update("both");
    // Labelled, in a panel's column: the strip hugs its choices; arrows move between them.
    const handles: Segmented<string> = new Segmented({ label: "Selected point handles", options: [{ value: "smooth", label: "Smooth" }, { value: "symmetric", label: "Symmetric" },
      { value: "corner", label: "Corner" }], onSelect: v => handles.update(v) });
    handles.update("smooth");
    // Icon only: the Expression drawer's transition curves, each named with how it moves in its tooltip, the chosen one named as the readout;
    // below it the same strip while its switch is off, the reason once on its line.
    const curves = [["easeLinear", "Linear", "steady from start to end"], ["easeIn", "Ease in", "starts slowly and speeds up into the end"],
      ["easeOut", "Ease out", "starts quickly and slows into the end"], ["easeOutStrong", "Strong ease out", "most of the change at once, then a long settle"],
      ["easeInOut", "Ease in-out", "gentle at both ends"], ["easeInOutStrong", "Strong ease in-out", "a slow start and finish around a quick middle"]] as const;
    const strip = () => { const c: Segmented<string> = new Segmented({ label: "Curve", iconOnly: true, reserveNote: true, compact: true,
      readout: v => curves.find(([icon]) => icon === v)![1], readoutGutter: true,
      options: curves.map(([icon, label, hint]) => ({ value: icon, label, icon, title: `${label}: ${hint}.` })), onSelect: v => c.update(v) }); return c; };
    const on = strip(), off = strip();
    on.update("easeInOutStrong");
    off.update("easeLinear", undefined, { disabled: true, reason: "Turn on Animate changes to set these." });
    return stack({ gap: "normal" }, s.element, h("div", { style: "max-width:300px" }, stack({ gap: "normal" }, handles.element, on.element, off.element))); },
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
  "lib-group-section": () => { const g: GroupSection = new GroupSection({ title: "Brows", key: "guide.brows", expanded: true, help: "The brow region's controls.", level: "subsection",
      actions: [iconButton({ label: "Mirror sides: Brows", icon: "mirror", small: true, mode: true, pressed: true })], onReset: () => g.update({ set: 0 }) });
    const s = new SliderWithValue({ label: "Brow raise", min: 0, max: 1, step: .05, format: v => `${Math.round(v * 100)} %`, defaultValue: 0, reset: true, transaction: { edit: () => {} } }); s.update(.4);
    g.body.append(s.element); g.update({ set: 1 });
    const folded = new GroupSection({ title: "Mouth", key: "guide.mouth", level: "subsection", onReset: () => {} }); folded.update({ set: 0 });
    return h("div", { style: "max-width:300px" }, stack({ gap: "normal" }, g.element, folded.element)); },
  "lib-view-state": () => {
    // Scroll the list, then rebuild it: the same row comes back at the top, clip offset included (remembered for this page only here).
    let memory: ScrollMemory | undefined;
    const list = () => {
      memory?.dispose();
      const box = h("div", { style: "max-height:132px;overflow:auto;border:1px solid var(--line);border-radius:var(--radius)" },
        ...Array.from({ length: 16 }, (_, i) => h("div", { [VIEW_KEY]: `row-${i}`, style: "padding:6px 10px;border-bottom:1px solid var(--line-soft)", text: `Row ${i + 1}` })));
      memory = new ScrollMemory(box, "guide.scroll");
      return box;
    };
    const host = h("div", {}, list());
    return h("div", { style: "max-width:300px" }, stack({ gap: "normal" }, host, button({ label: "Rebuild the list", icon: "reset", onClick: () => host.replaceChildren(list()) }))); },
  "lib-help-tip": () => h("div", { class: "control-line" }, h("span", { class: "control-label", text: "Finish" }), helpTip("Finish", "How the makeup catches the light.")),
  "lib-reason-tip": () => { const b = button({ label: "Build mod files", icon: "package", onClick: () => {} }); applyCapability(b, { available: false, reason: "Choose your game folder first." }); return b; },
  "lib-menu": () => h("div", { class: "row wrap gap-s" }, button({ label: "Open a menu", icon: "more", menu: true, onClick: event => openMenu([{ kind: "heading", label: "Petal wash" },
    { kind: "action", label: "Duplicate", icon: "duplicate", shortcut: "Ctrl+D", run: () => {} }, { kind: "action", label: "Merge down", icon: "layers", capability: { available: false, reason: "The bottom layer has nothing below it." }, run: () => {} },
    { kind: "action", label: "Save as new layout…", icon: "plus", run: () => openValuePopover({ kind: "text", label: "Name", value: "Layout 2", maxLength: 48 },
      { x: 120, y: 120 }, { title: "Save layout", apply: "Save", options: [{ label: "Remember shown modules", checked: true }, { label: "Switch to it in wide windows", checked: false }],
        commit: () => {} }) },
    { kind: "separator" }, { kind: "action", label: "Remove", icon: "trash", danger: true, run: () => {} }], event.currentTarget as Element, { label: "Layer actions" }) }),
    button({ label: "Delete a saved expression", icon: "trash", onClick: event => openConfirmPopover(event.currentTarget as Element,
      { title: "Delete saved expression", message: "Delete “Smirk” from your library? This can't be undone.", confirm: "Delete", danger: true, onConfirm: () => {} }) })),
  "lib-stage-tag": () => {
    const physics = new Toggle({ label: "Hair physics", stage: "preview", help: "An early-access setting: how the hair moves hasn't been matched to the game yet.", onChange: checked => physics.update(checked) });
    physics.update(false);
    // The same switch while it can't be used: the tag dims with the label.
    const waiting = new Toggle({ label: "Hair physics", stage: "preview", reserveNote: true, quietReason: true, onChange: () => {} });
    waiting.update(false, { disabled: true, reason: "Available once your V's hair has loaded." });
    const strip: TabStrip = new TabStrip({ label: "Sample preview panels", onSelect: () => {} });
    strip.update([{ id: "expression", label: "Expression", icon: "character", stage: "preview", closable: true }, { id: "sets", label: "Expression sets", icon: "package", stage: "preview" }], "expression");
    const menu = button({ label: "Modules", icon: "category", menu: true, onClick: event => openMenu([{ kind: "heading", label: "Modules" },
      { kind: "action", label: "Eye makeup", icon: "category", checked: true, hint: "Design layered eye makeup for your V.", run: () => {} },
      { kind: "action", label: "Expressions", icon: "character", checked: false, stage: "preview", hint: "Pose V's face with the game's own face controls.", run: () => {} }],
      event.currentTarget as Element, { label: "Modules" }) });
    // Fitted like the dock fits its groups: whole labels (and tags) at this width; narrower, only the active tab keeps "Early" beside a
    // whole label, and every name keeps "Early access".
    const fitted = new PanelHeader({ strip, actions: [], drag: { title: "Drag area", onPointerDown: () => {} } });
    requestAnimationFrame(() => fitted.fit());
    return stack({ gap: "normal" }, h("div", { class: "row wrap gap-s" }, stageTag("preview"), menu),
      h("section", { class: "dock-group", style: "width:600px" }, fitted.element, h("div", { class: "dock-body", style: "height:24px" })),
      h("div", { style: "max-width:320px" }, physics.element, waiting.element));
  },
  "lib-item-list": () => { let items = [{ id: "a", name: "Petal wash", meta: "Matte" }, { id: "b", name: "Liner", meta: "Glossy", secondary: "shows as “Wing”" }]; let selected = "a";
    const list: ItemList<{ id: string; name: string; meta: string; secondary?: string }> = new ItemList({ label: "Sample layers", noun: "layer", maxLength: 40,
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
  "lib-size-bar": () => {
    // The Start from pattern: a tree that fits six rows by default; drag the bar (or focus it and press Down) to show more.
    const expanded = new Set(["saved", "natural"]);
    const groups = [
      { id: "saved", label: "Saved", rows: ["Smirk", "Wince", "Deadpan"].map(label => ({ id: `s-${label}`, label })) },
      { id: "natural", label: "Natural", secondary: "built in", rows: ["Content", "Curious", "Doubtful", "Pleased", "Sad", "Surprised", "Tired", "Wary"].map(label => ({ id: `n-${label}`, label })) },
      { id: "game", label: "Cyberpunk 2077", rows: Array.from({ length: 24 }, (_, i) => ({ id: `g-${i}`, label: `Photo mode ${i + 1}` })) }];
    let current = "n-Content";
    const tree: TreeView = new TreeView({ label: "Start from (sample)", maxRows: 6, minRows: 3, sizeBar: { key: "style-guide:start-from" }, remember: false,
      onActivate: id => { current = id; paint(); }, onToggle: (id, open) => { if (open) expanded.add(id); else expanded.delete(id); paint(); } });
    const paint = () => tree.update({ groups, expanded, current });
    paint();
    // Generic: any scroll region, here a plain list of notes.
    const notes = h("div", { tabindex: "0", role: "region", "aria-label": "Sample notes",
      style: "overflow:auto;border:1px solid var(--line);background:var(--bg-panel);padding:var(--sp-2) var(--sp-4);font-size:var(--fs-sm);line-height:22px" },
      ...Array.from({ length: 16 }, (_, i) => h("div", { text: `Note ${i + 1}: a line of text in a scrolling region.` })));
    const bar = new SizeBar({ label: "Sample notes", target: notes, minHeight: 60, defaultHeight: 120, maxHeight: () => 16 * 22 + 10 });
    return h("div", { style: "max-width:420px" }, stack({ gap: "normal" }, tree.sizeBar!.region, bar.region)); },
  "lib-choice-list": () => {
    const body: ChoiceList<string> = new ChoiceList<string>({ label: "Body", reserveNote: true, onSelect: value => body.update(value, undefined, { note: value === "still" ? "" : "Loading that idle; the previous one plays until it's ready." }),
      options: [["still", "Still"], ["closeup", "Creator close-up"], ["eyes", "Creator close-up eyes section"], ["full", "Creator full body"], ["inventory", "Inventory"],
        ["nails", "Creator nails"], ["gender", "Gender selection"]].map(([value, label]) => ({ value: value!, label: label! })) });
    // One choice unavailable, with its reason (focus or hover it for the reason tip).
    const unprepared = (value: string) => value === "nails" ? { available: false, reason: "That idle isn't prepared on this computer." } : { available: true };
    body.update("closeup", unprepared);
    // The whole list unavailable: one reason, on its reserved line.
    const waiting: ChoiceList<string> = new ChoiceList<string>({ label: "Body (before the 3D preview is ready)", reserveNote: true, quietReason: true, onSelect: () => {},
      options: [{ value: "still", label: "Still" }, { value: "closeup", label: "Creator close-up" }, { value: "full", label: "Creator full body" }] });
    waiting.update("still", undefined, { disabled: true, reason: "Your V's motion appears once the 3D preview is ready." });
    const eyes: ChoiceList<string> = new ChoiceList<string>({ label: "Eye shape in the 3D view", layout: "tiles", onSelect: value => eyes.update(value),
      options: Array.from({ length: 22 }, (_, k) => ({ value: String(k), label: String(k + 1), name: `Eye shape ${k + 1}` })) });
    eyes.update("6");
    const head: ChoiceList<string> = new ChoiceList<string>({ label: "Head used for the eye plate", layout: "rows", onSelect: value => head.update(value),
      options: [{ value: "installed", label: "The head your game loads (recommended)" }, { value: "base-game", label: "The unmodified game head" }] });
    head.update("installed");
    return h("div", { style: "max-width:420px" }, stack({ gap: "loose" }, body.element, waiting.element, eyes.element, head.element)); },
  "lib-mod-line": () => {
    const more = (name: string) => button({ label: `${name} options`, icon: "more", iconOnly: true, variant: "ghost", small: true, menu: true,
      onClick: event => openMenu([{ kind: "action", label: "Rename…", icon: "rename", run: () => {} }], event.currentTarget as Element, { label: `${name} options` }) });
    const narrow = h("ul", { class: "result-list package-mods", "aria-label": "Mods this collection builds (narrow)", style: "width:200px" },
      modLine({ name: "XF Eye Artistry Night Market", kind: "Eye makeup", action: more("XF Eye Artistry Night Market") }));
    return stack({ gap: "normal" }, h("ul", { class: "result-list package-mods", "aria-label": "Mods this collection builds" },
      modLine({ name: "XF Eye Artistry", kind: "Eye makeup", action: more("XF Eye Artistry") })), narrow);
  },
  "lib-record-list": () => {
    const saved = new RecordList({ label: "Saved collections" });
    const at = new Date(2026, 8, 29, 18, 2, 49);
    saved.update([
      { id: "night", name: "Night market set", meta: ["4 presets", "version 5", recordTime(at)], badge: { text: "This draft", tone: "info" }, current: true,
        action: button({ label: "Reopen", small: true, variant: "quiet", onClick: () => {} }) },
      { id: "day", name: "Day looks for the badlands convoy", meta: ["2 presets", "version 1", recordTime(at.getTime() - 86_400_000)],
        action: button({ label: "Open", small: true, onClick: () => {} }) }]);
    const drafts = new RecordList({ label: "Recent drafts" });
    drafts.update([{ id: "d1", name: "Makeup collection", meta: ["Draft", "edited since version 2, not saved", "3 presets"],
      action: button({ label: "Recover", icon: "undo", small: true, onClick: () => {} }) }]);
    return stack({ gap: "normal" }, saved.element, drafts.element);
  },
  "lib-folder-setting": () => {
    let chosen: string | null = null;
    const folder: FolderSetting = new FolderSetting({ label: "Saves folder", help: "Where the game keeps your saves.", placeholder: "e.g. %USERPROFILE%\\Saved Games\\CD Projekt Red\\Cyberpunk 2077",
      guidance: "Give the folder that holds your save folders (ManualSave-0, QuickSave-0 …).",
      onChoose: async path => { if (!/saved games/i.test(path)) return { ok: false, message: "That folder has no saves in it. Give the folder that holds ManualSave-0 and the others." };
        chosen = path; folder.update({ chosen, detected }); return { ok: true }; },
      onUseDetected: async () => { chosen = null; folder.update({ chosen, detected }); return { ok: true }; } });
    const detected = "%USERPROFILE%\\Saved Games\\CD Projekt Red\\Cyberpunk 2077";
    folder.update({ chosen, detected });
    // Several folders found (the game through Steam and GOG): all shown as choices, the one in use pressed.
    const found = [{ path: "D:\Steam\steamapps\common\Cyberpunk 2077", source: "Steam" }, { path: "E:\GOG Games\Cyberpunk 2077", source: "GOG, Mod Organizer 2" }];
    let game: string | null = found[0]!.path;
    const games: FolderSetting = new FolderSetting({ label: "Cyberpunk 2077 folder", help: "The folder the game is installed in.",
      onChoose: async path => { game = path; games.update({ chosen: game, found }); return { ok: true }; },
      onSelect: async path => { game = path; games.update({ chosen: game, found }); return { ok: true }; } });
    games.update({ chosen: game, found });
    return h("div", { style: "max-width:520px" }, stack({ gap: "loose" }, folder.element, games.element)); },
  "lib-swatch-card": () => swatchCardSpecimen(),
  "lib-choice-preview": () => choicePreviewSpecimen(),
  "lib-choice-layouts": () => choiceLayoutsSpecimen(),
  "lib-split-view": () => { const tree = h("ul", { class: "save-tree" }, ...["GameSessionDesc", "DynamicEntityIDSystem", "TypeDatabase_v2"].map(name => h("li", { class: "save-tree-row" }, h("span", { class: "save-tree-name", text: name }))));
    return new SplitView({ label: "the sample tree and inspector", key: "guide.split", initial: .45, min: 140, start: tree,
      end: blockSection({ title: "GameSessionDesc" }, propertyList([["Kind", "Holds child nodes"], ["Size", "58 B"]])) }).element; },
  // The dock's splitter between two sample groups: the arrows step the share, Enter or a double-click evens it.
  "lib-splitter": () => { let share = .5;
    const side = (text: string) => h("div", { class: "dock-cell" }, h("section", { class: "dock-group", style: "flex:1;display:grid;place-items:center" }, h("span", { class: "muted", text })));
    const start = side("Start"), end = side("End");
    const apply = () => { start.style.flex = `${share} 1 0`; end.style.flex = `${1 - share} 1 0`; splitter.setValue(share); };
    const splitter: Splitter = new Splitter({ axis: "row", className: "dock-splitter", label: "Resize the sample columns", title: "Arrow keys adjust · Double-click to equalize",
      onStep: (direction, big) => { share = Math.min(.9, Math.max(.1, share + direction * (big ? .1 : .04))); apply(); }, onEqualize: () => { share = .5; apply(); } });
    apply();
    return h("div", { class: "dock-split", "data-axis": "row", style: "height:96px;max-width:520px" }, start, splitter.element, end); },
};

/**
 * The swatch card and contrast enhancement: a tightly clustered set (a brow pack's colours as they derive over another mod's natural hair
 * tones) shown as derived and as enhanced, an already varied set (hair colours, root to tip) that enhancement leaves alone, the gain curve
 * with each set's spread marked, and the card on every swatch.
 */
/**
 * A synthetic channel image (choice-preview.ts §channels): a lit head as the subject and a hair shape as the feature, drawn here so the
 * specimen needs no game file. `style` picks the shape: 0 a bob, 1 long, 2 short.
 */
function syntheticPreview(style: number, frames = 1): string {
  const size = 128, canvas = document.createElement("canvas");
  canvas.width = size * frames; canvas.height = size;
  const context = canvas.getContext("2d")!, image = context.createImageData(size * frames, size);
  // A turntable strip (frames side by side): the light and a side tail move with the turn, so the specimen visibly turns.
  for (let k = 0; k < frames; k++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const turn = (k / frames) * Math.PI * 2, side = Math.sin(turn), front = Math.cos(turn);
    const dx = (x - 60) / 30, dy = (y - 58) / 38, head = dx * dx + dy * dy <= 1 || (Math.abs(x - 60) < 13 && y > 80 && y < 118);
    const hx = (x - 60) / 36, hy = (y - 52) / 42, inHair = hx * hx + hy * hy <= 1;
    const tail = frames > 1 && Math.abs(x - (60 + 38 * side)) < 7 + 3 * Math.abs(front) && y > 50 && y < 116;
    const face = dx * dx + dy * dy < .7 && y > 44 && (frames === 1 || front > -0.2);
    const hair = inHair && (style === 2 ? y < 44 : style === 0 ? y < 84 && !face : !face) || (style === 1 && Math.abs(x - 60) < 34 && y > 60 && y < 124 && Math.abs(x - 60) > 20) || tail;
    const light = Math.max(.18, Math.min(1, .55 - (dx * front + .4 * side) * .35 - dy * .35 + (hair ? .1 * Math.sin(x * .9 + turn * 3) : 0)));
    const at = (y * size * frames + k * size + x) * 4;
    if (hair) { image.data[at] = 255 * light; image.data[at + 2] = 255; image.data[at + 3] = 255; }
    else if (head) { image.data[at + 1] = 255 * light; image.data[at + 3] = 255; }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}
/** The choice preview tile in each state and grid size (lib-choice-preview), in the Character panel's creator look. */
function choicePreviewSpecimen() {
  const pictures = [syntheticPreview(0), syntheticPreview(1), syntheticPreview(2)];
  const grid = (size: "s" | "m" | "l") => {
    const tiles = ["01", "02", "03", "04", "05"].map((label, n) => {
      const tile = previewTile({ label: `Hairstyle ${label}`, glyph: "head" });
      // Ready, ready, waiting, ready, no picture possible.
      tile.set(n === 2 || n === 4 ? null : pictures[n % 3]!, n === 4);
      const fetch = n === 2 ? "fetching" : "";
      const item = choiceItem({ label: `Hairstyle ${label}`, selected: n === 1, description: `From the game${fetch ? "; being prepared" : ""}`, className: "cc-choice preview-choice", content: tile.element });
      if (fetch) item.dataset.fetch = fetch;
      item.tabIndex = n === 1 ? 0 : -1;
      return item;
    });
    return stack({ gap: "tight" }, h("span", { class: "small muted", text: `Size ${size.toUpperCase()}` }),
      h("div", { class: "choices cc-choices previews", "data-size": size, role: "listbox", "aria-label": `Hairstyle choices, size ${size.toUpperCase()}`, style: "max-width:560px;padding:0" }, ...tiles));
  };
  return h("div", { style: "max-width:600px" }, stack({ gap: "normal" }, grid("m"), grid("s"), turning(pictures),
    h("p", { class: "note", text: "Pictures here are drawn in the page from synthetic channels (a head and a hair shape); in the Character panel they come from the preview worker, drawn from the resolved winner's parts. Switch the guide's theme: one channel image serves both. In size L, rest the pointer on a picture to turn it, or press and drag across it." })));
}
/** Size L with turntables: every ready tile turns on hover and drag (a synthetic 24-frame strip). */
function turning(pictures: string[]) {
  const strip = syntheticPreview(1, 24);
  const tiles = ["01", "02", "03", "04"].map((label, n) => {
    const tile = previewTile({ label: `Hairstyle ${label}`, glyph: "head" });
    tile.set(n === 3 ? null : pictures[n % 3]!, false);
    tile.spinnable(n !== 3);
    tile.setSpin(n === 3 ? null : strip, 24);
    const item = choiceItem({ label: `Hairstyle ${label}`, selected: n === 0, description: "From the game", className: "cc-choice preview-choice", content: tile.element });
    item.tabIndex = n === 0 ? 0 : -1;
    return item;
  });
  return stack({ gap: "tight" }, h("span", { class: "small muted", text: "Size L (every size turns on hover and drag)" }),
    h("div", { class: "choices cc-choices previews", "data-size": "l", "data-layout": "grid", role: "listbox", "aria-label": "Hairstyle choices, size L", style: "max-width:560px;padding:0" }, ...tiles));
}
/** The three layouts of one sample row (lib-choice-layouts): the row's controls, then grid, list and details with its large picture. */
function choiceLayoutsSpecimen() {
  const pictures = [syntheticPreview(0), syntheticPreview(1), syntheticPreview(2)], strip = syntheticPreview(1, 24);
  const names = ["Bob", "Braids", "Bun", "Curly", "Pixie"], sources = ["From the game", "From Sample Hair Pack", "From the game", "From Sample Hair Pack", "From the game"];
  const states = ["", "", "Preparing", "Not prepared yet", ""];
  const host = h("div", { class: "cc-choice-list" });
  let layout: "grid" | "list" | "details" = "details", size: "s" | "m" | "l" = "m", shown = 1;
  const stage = previewStage({ glyph: "head" });
  const sizes = new Segmented<"s" | "m" | "l">({ label: "Picture size", showLabel: false, compact: true, options: [{ value: "s", label: "S" }, { value: "m", label: "M" }, { value: "l", label: "L" }],
    onSelect: value => { size = value; paint(); } });
  const layouts = new Segmented<"grid" | "list" | "details">({ label: "Picture layout", showLabel: false, compact: true,
    options: [{ value: "grid", label: "Grid" }, { value: "list", label: "List" }, { value: "details", label: "Details" }], onSelect: value => { layout = value; paint(); } });
  const tiles = names.map((name, n) => {
    const tile = previewTile({ label: name, glyph: "head" });
    tile.set(n === 3 ? null : pictures[n % 3]!, false);
    tile.setSpin(n === 3 ? null : strip, 24);
    const item = choiceItem({ label: name, selected: n === 1, description: sources[n], className: "cc-choice preview-choice", content: tile.element });
    if (n === 2) item.dataset.fetch = "fetching";
    if (n === 3) item.dataset.fetch = "pending";
    item.tabIndex = n === 1 ? 0 : -1;
    item.addEventListener("pointerenter", () => { shown = n; paint(true); });
    item.addEventListener("pointerleave", () => { shown = 1; paint(); });
    return { tile, item };
  });
  const list = h("div", { class: "choices cc-choices previews", role: "listbox", "aria-label": "Sample hairstyle choices", style: "padding:0" }, ...tiles.map(entry => entry.item));
  const body = h("div", { class: "cc-choice-body" }, list);
  host.append(body);
  function paint(looking = false) {
    sizes.update(size); layouts.update(layout);
    sizes.element.hidden = layout !== "grid";
    list.dataset.layout = layout; host.dataset.layout = layout;
    if (layout === "grid") list.dataset.size = size; else delete list.dataset.size;
    tiles.forEach(({ tile }, n) => { tile.spinnable(layout === "details" || (layout === "grid" && size === "l")); tile.setMeta(layout !== "grid" && n >= 3 ? sources[n]! : "", layout === "details" ? states[n]! : ""); });
    if (layout === "details") { if (stage.element.parentNode !== body) body.insertBefore(stage.element, list); } else stage.element.remove();
    stage.show({ label: names[shown]!, source: sources[shown]!, url: shown === 3 ? null : pictures[shown % 3]!, none: false, spin: shown === 3 ? null : strip, frames: 24, looking });
  }
  paint();
  return h("div", { style: "max-width:640px" }, stack({ gap: "normal" },
    h("div", { class: "cc-choice-tools", style: "padding:0" }, sizes.element, layouts.element), host,
    h("p", { class: "note", text: "Switch the layout above; narrow the guide below 520 px to see the details picture move above the list. Rest the pointer on a row to turn its picture in the large view, or drag the large picture. PageUp, PageDown and typing a name move focus in the list." })));
}

function swatchCardSpecimen() {
  const clustered = [["#030303"], ["#534f46"], ["#210402"], ["#2d1208"], ["#090402"], ["#494339"], ["#3f3628"], ["#2c2420"], ["#2b1c09"], ["#4d4038"],
    ["#2a2725"], ["#540000"], ["#2b211a"], ["#460e18"], ["#3d3735"], ["#3e2117"], ["#13100e"], ["#6c6664"], ["#231610"]];
  const varied = [["#996600", "#e4deae", "#886b49", "#5f330f", "#653300"], ["#e4cca6", "#d8ccbc", "#e8d9c3", "#e9dac4", "#e9dbc5"],
    ["#aa7480", "#6a4d43", "#493828", "#372b1f", "#261f16"], ["#ffffcc", "#810202", "#fc9664", "#9f3900", "#ca6400"], ["#bababa", "#b0b0b0", "#a7a7a7", "#989797", "#706969"],
    ["#000000", "#000000", "#000000", "#000000", "#000000"], ["#623d1f", "#a56c78", "#897aba", "#64afc7", "#72c2ca"], ["#72777a", "#7c8084", "#adadb2", "#7a757c", "#857c86"]];
  const grid = (label: string, shown: readonly (readonly string[])[], truth: readonly (readonly string[])[], enhanced: boolean) => {
    const items = shown.map((colours, n) => { const item = choiceItem({ label: `${label} ${n + 1}`, description: "From a sample pack", swatch: true,
      content: h("span", { class: "swatch", "aria-hidden": "true", style: `background:${sampleBackground(colours)}` }) }); item.dataset.position = String(n); return item; });
    const list = h("div", { class: "choices grid", role: "listbox", "aria-label": label, style: "max-width:340px" }, ...items);
    attachSwatchCard(list, item => ({ colours: truth[Number(item.dataset.position)]!, label: item.getAttribute("aria-label")!, source: "From a sample pack", enhanced }));
    const mark = contrastMark(); setContrastMark(mark, enhanced);
    return stack({ gap: "tight" }, h("div", { class: "row gap-s" }, mark, h("span", { class: "small", text: label })), list);
  };
  const tight = enhanceSwatchSet(clustered), loose = enhanceSwatchSet(varied);
  // The curve: gain against spread for lightness (the axis that moves most), with the separation weight of each set applied.
  const W = 300, H = 120, maxSpread = 0.3, maxGain = CONTRAST.maxGain, x = (v: number) => 30 + v / maxSpread * (W - 40), y = (g: number) => H - 20 - (g - 1) / (maxGain - 1) * (H - 30);
  const points = Array.from({ length: 61 }, (_, i) => { const v = 0.002 + i * (maxSpread / 60); return `${x(v).toFixed(1)},${y(contrastGain(v, CONTRAST.lightnessTarget)).toFixed(1)}`; }).join(" ");
  const dot = (spread: number, gain: number, label: string, end = false) => `<circle cx="${x(spread).toFixed(1)}" cy="${y(gain).toFixed(1)}" r="3.5" fill="var(--signal)"/><text x="${(x(spread) + (end ? 4 : 6)).toFixed(1)}" y="${(y(gain) - (end ? 10 : 6)).toFixed(1)}" font-size="10" fill="currentColor"${end ? ' text-anchor="end"' : ""}>${label}</text>`;
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;height:auto" role="img" aria-label="Lightness gain against the set's lightness spread: ${maxGain} times at most, falling to 1 at a spread of ${CONTRAST.lightnessTarget}">
    <line x1="30" y1="${H - 20}" x2="${W - 10}" y2="${H - 20}" stroke="currentColor" stroke-width="1"/><line x1="30" y1="10" x2="30" y2="${H - 20}" stroke="currentColor" stroke-width="1"/>
    <text x="${W - 10}" y="${H - 6}" font-size="10" text-anchor="end" fill="currentColor">spread of the set (OKLab L, σ)</text><text x="36" y="10" font-size="10" fill="currentColor">gain</text>
    <text x="26" y="${y(maxGain) + 4}" font-size="9" text-anchor="end" fill="currentColor">${maxGain}×</text><text x="26" y="${H - 17}" font-size="9" text-anchor="end" fill="currentColor">1×</text>
    <line x1="${x(CONTRAST.lightnessTarget)}" y1="10" x2="${x(CONTRAST.lightnessTarget)}" y2="${H - 20}" stroke="currentColor" stroke-dasharray="3 3" stroke-width="1"/>
    <polyline points="${points}" fill="none" stroke="var(--text)" stroke-width="1.5"/>
    ${dot(tight.lightness.spread, contrastGain(tight.lightness.spread, CONTRAST.lightnessTarget), `clustered set, σ ${tight.lightness.spread.toFixed(2)}`)}
    ${dot(loose.lightness.spread, 1, `varied set, σ ${loose.lightness.spread.toFixed(2)}`, true)}</svg>`;
  const chart = h("div", { style: "color:var(--text-muted);max-width:100%" });
  chart.innerHTML = svg;
  const caption = h("p", { class: "note", text: `Gain = (${CONTRAST.lightnessTarget} ÷ σ)^${1 - CONTRAST.exponent}, capped at ${maxGain}×, 1 from σ ${CONTRAST.lightnessTarget}; saturation (target ${CONTRAST.saturationTarget}) and chroma-weighted hue (target ${CONTRAST.hueTarget}°, at most ${CONTRAST.maxHueShift}° per colour) follow the same curve, all scaled by the set's overall OKLab separation (fully applied below ${(CONTRAST.separated * 0.6).toFixed(2)}, not at all from ${CONTRAST.separated}: ${separationWeight(CONTRAST.separated * 0.8).toFixed(2)} at ${(CONTRAST.separated * 0.8).toFixed(2)}). Applied here: lightness ${tight.lightness.gain.toFixed(2)}×, hue ${tight.hue.gain.toFixed(2)}× for the clustered set; nothing for the varied one.` });
  return h("div", { style: "max-width:720px" }, stack({ gap: "normal" },
    h("div", { class: "row wrap gap-m", style: "align-items:flex-start" }, grid("Clustered set, as derived", clustered, clustered, false), grid("Clustered set, spread apart", tight.colours, clustered, true)),
    h("div", { class: "row wrap gap-m", style: "align-items:flex-start" }, grid("Varied set: left alone", loose.colours, varied, loose.enhanced), chart), caption));
}

/** Build every live specimen on the page (again after the side-by-side comparison rebuilds the specimens). */
export function mountLibrary() {
  for (const host of document.querySelectorAll<HTMLElement>(".live-specimen[data-live]")) {
    const mount = MOUNTS[host.dataset.live!];
    if (mount) host.replaceChildren(mount());
  }
}
export const LIBRARY_SPECIMENS = Object.keys(MOUNTS);

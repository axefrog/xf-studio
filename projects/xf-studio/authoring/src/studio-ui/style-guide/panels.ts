import { code, group, i, menu, menuHeading, menuItem, menuSep, note, pattern, section } from "./kit";

const lorem = (title: string) => `<div class="panel-content"><h3 class="section-title">${title}</h3><p class="note">Panel content scrolls inside its group.</p></div>`;

export function panelSystem() {
  const guides = `<div class="snap-demo-static">
    <section class="dock-group demo-target"><div class="dock-tabbar"><div class="dock-tabs" role="tablist"><button type="button" class="dock-tab" role="tab" aria-selected="true">${i("head")}<span class="dock-tab-label">Head</span></button></div><div class="dock-tabbar-fill"></div></div>
      <div class="dock-body"></div></section>
    <div class="dock-preview" data-label="Split left" style="left:0;top:0;width:50%;height:100%"></div>
    <div class="dock-guide split top" style="left:calc(50% - 17px);top:calc(50% - 57px);width:34px;height:34px"></div>
    <div class="dock-guide split left active" style="left:calc(50% - 57px);top:calc(50% - 17px);width:34px;height:34px"></div>
    <div class="dock-guide tab" style="left:calc(50% - 17px);top:calc(50% - 17px);width:34px;height:34px"></div>
    <div class="dock-guide split right" style="left:calc(50% + 23px);top:calc(50% - 17px);width:34px;height:34px"></div>
    <div class="dock-guide split bottom" style="left:calc(50% - 17px);top:calc(50% + 23px);width:34px;height:34px"></div>
    <div class="dock-guide edge left" style="left:10px;top:calc(50% - 17px);width:34px;height:34px"></div>
    <div class="dock-cursor-mark" style="left:calc(50% - 40px);top:50%"></div>
    <div class="dock-ghost" style="left:calc(50% - 18px);top:calc(50% + 26px)">${i("grip")}<span>Motion</span></div>
  </div>`;
  return section("panels", "03", "Panel system",
    `Fixed sidebars are gone. Every functional area is a panel that can be docked, floated, grouped as tabs or magnetically joined with other floating panels.
     Snapping is decided by <strong>where the cursor is</strong> — never by the dragged panel's size or position — so a large panel passing over others never snaps by accident.
     The live sandbox and live dock at the end of this section run the production engine.`, [
    pattern({ id: "d-group", title: "Docked tab group", status: "implemented", wide: true,
      specimen: `<div class="demo-dock-row">${group([["Presets", "presets"], ["Library", "library"], ["Mod package", "package"]], 0, lorem("Presets"), { style: "width:300px;height:170px" })}
        ${group([["Colour & finish", "finish"], ["Shape", "shape"], ["Pigment & edge", "edge"], ["Warp", "warp"], ["Character", "character"], ["Camera & light", "lighting"]], 0, lorem("Colour & finish"), { condensed: true, focus: true, style: "width:300px;height:170px" })}</div>`,
      what: "A group shows one panel at a time behind a tab strip. The active tab carries the ink/yellow indicator and a close control; the empty strip to the right is the group's drag handle; ⋯ opens layout options.",
      when: "Put panels in one group when they are used alternately (Presets / Library / Package) and side by side when they are used together (Head and UV map).",
      combine: "Groups sit in splits. When a strip overflows, inactive tabs condense to icons (right) while the active label stays readable; names remain available to screen readers and tooltips.",
      adapt: "Wide and compact workspaces keep separate arrangements. In compact layouts, most panels share two groups.",
      drives: "Pure layout state (DockTree) saved through the workspace preference action layout.set; no application data.",
      a11y: "role=tablist/tab/tabpanel; ←/→/Home/End switch tabs, Alt+Shift+←/→ reorders, Delete closes, Enter or ↓ moves into the panel, Shift+F10 opens layout options. Focus inside a group outlines it in cyan." }),
    pattern({ id: "d-split", title: "Splits and splitters", status: "implemented",
      specimen: `<div class="demo-split"><div class="dock-split" data-axis="row" style="height:120px">
        <div class="dock-cell" style="flex:1 1 0">${group([["Layers", "layers"]], 0, "")}</div>
        <div class="dock-splitter active" role="separator" aria-orientation="vertical"></div>
        <div class="dock-cell" style="flex:1.4 1 0">${group([["Head", "head"]], 0, "")}</div></div></div>`,
      what: "Rows and columns of groups with 4 px splitters. Hover or focus shows the cyan track; dragging resizes the two neighbours only.",
      when: "Any docked arrangement. Minimum group size is 150 × 96 px.",
      a11y: "Splitters are focusable separators: arrow keys move 4 %, Enter or double-click equalises the pair." }),
    pattern({ id: "d-float", title: "Floating panel", status: "implemented",
      specimen: `<div class="demo-float-area"><div class="dock-window" style="left:20px;top:14px;width:250px;height:150px">${group([["Camera & light", "lighting"]], 0, lorem("Camera"), { floating: true })}</div></div>`,
      what: "A panel in its own window above the dock, with resize handles on every edge and corner. Its tab strip is the window's title bar.",
      when: "Temporary tools you want next to the stage without reflowing the docked layout (lighting while judging a finish, Motion while checking closed lids).",
      combine: "Floating windows can attach to each other (composites) or return to any group. They stay above a maximized group.",
      adapt: "Windows are clamped so at least their title bar remains reachable after window resize or restore.",
      a11y: "Panel menu › Move or resize window… enters a keyboard mode: arrows move (Ctrl for fine steps), Shift+arrows resize, Enter or Escape ends and saves." }),
    pattern({ id: "d-composite", title: "Magnetic composite", status: "implemented",
      specimen: `<div class="demo-float-area"><div class="dock-window composite" style="left:16px;top:10px;width:420px;height:160px">
        <div class="dock-window-bar">${i("grip")}<span>2 panels · magnetic composite</span><button type="button" class="icon-btn" aria-label="Composite options">${i("more")}</button></div>
        <div class="dock-window-body"><div class="dock-split" data-axis="row"><div class="dock-cell" style="flex:1 1 0">${group([["Motion", "motion"]], 0, "", { floating: true })}</div><div class="dock-splitter"></div><div class="dock-cell" style="flex:1 1 0">${group([["Camera & light", "lighting"]], 0, "", { floating: true })}</div></div></div></div></div>`,
      what: "Two or more floating groups joined edge to edge into one window. A thin bar moves the whole composite; each member keeps its own tabs and can be dragged out again.",
      when: "When a set of floating tools belongs together (motion + lighting while reviewing on a moving face).",
      combine: "Join by dragging a panel until the cursor enters the magnetic band along a floating window's edge (18 px either side of the edge) or onto its compass arrows. The composite grows to make room instead of squeezing its content.",
      a11y: "Panel menu › Place beside › (floating group) › Attach left/right/above/below. Composite menu › Dock composite to edge or Merge into group as tabs." }),
    pattern({ id: "d-feedback", title: "Drag feedback: cursor targets", status: "implemented", wide: true,
      specimen: `${guides}${note("The cursor (yellow square) is on the compass's left arrow, so the preview fills the left half: “Split left”. The ghost only labels what is moving; its size is irrelevant.")}`,
      what: "While dragging, the group under the cursor shows a five-way compass (centre = add as tab; arrows = split beside). Edge guides at the middle of each workspace edge dock to the full edge. Tab strips accept tabs at the cursor's insertion point. Floating windows add a magnetic edge band. The cyan preview shows exactly where the panel will land and names the result.",
      when: "Drop outside every guide to float the panel where you release it. Hold Ctrl to float freely even over a guide. Escape cancels the drag and restores a moved window.",
      combine: "The preview is the contract: whatever it names is what happens on release, and the result is announced to screen readers.",
      drives: `${code("resolveDrop(cursor, geometry)")} in studio-ui/dock/snap.ts — inputs are the cursor point and the rectangles of target groups/guides; the dragged panel's rectangle is not a parameter. Unit tests assert that a large overlapping panel does not snap until the cursor reaches a target.` }),
    pattern({ id: "d-sandbox", title: "Live snapping sandbox", status: "implemented", wide: true,
      specimen: `<div class="snap-sandbox" id="snap-sandbox" aria-label="Snapping sandbox: drag the large panel"><p class="sandbox-empty">Load this guide in a browser with scripts enabled to try the production snap resolver.</p></div>
        <p class="note" id="snap-readout" role="status">Drag the large “Lighting” panel. It only snaps when the cursor — not the panel — reaches a guide.</p>`,
      what: "The production resolver running on three sample groups. The dragged panel is deliberately large so it overlaps targets while the cursor stays outside them.",
      when: "Use it to reason about new guide placements before changing snap.ts; keep the unit tests in tests/dock-layout.test.ts in step." }),
    pattern({ id: "d-max", title: "Maximized group and empty dock", status: "implemented",
      specimen: `<div class="row gap-m align-end"><div style="width:220px;height:120px;position:relative">${group([["Head", "head"]], 0, `<div class="panel-content"><p class="note">Maximized · Restore button in the tab bar</p></div>`, { style: "height:100%" })}</div>
        <div class="dock-empty" style="width:220px;height:120px"><p>Every panel is floating or closed.</p><button type="button" class="btn small"><span>Reset layout</span></button></div></div>`,
      what: "Double-click a tab bar (or use its menu) to maximize a group over the dock; floating windows stay available. If every panel is floating or closed, the dock shows an explanation and Reset.",
      when: "Maximize for close inspection of the head or UV map; restore the same way." }),
    pattern({ id: "d-keyboard", title: "Keyboard alternatives to docking", status: "implemented",
      specimen: menu(`${menuHeading("Motion", "Docked with Character, Camera & light")}${menuItem("Show tab", { icon: "chevronRight", sub: true })}${menuItem("Float panel", { icon: "float" })}${menuItem("Add as tab to", { icon: "layers", sub: true, focus: true })}${menuItem("Place beside", { icon: "dock", sub: true })}${menuItem("Dock to workspace edge", { icon: "layout", sub: true })}${menuItem("Maximize group", { icon: "maximize" })}${menuSep}${menuItem("Close Motion", { icon: "close", kbd: "Del" })}${menuSep}${menuItem("Reset layout", { icon: "reset" })}`),
      what: "Every pointer operation has a menu equivalent on each tab (right-click, Shift+F10 or ⋯): float, add as tab to any group, place beside any group (split or magnetic attach), dock to an edge, maximize, close, reset.",
      when: "Always available; the command palette also offers Go to/Open and Float for every panel, and the Panels menu toggles each panel.",
      a11y: "Menus use roving focus with arrows, Home/End, type-ahead, → to open submenus, ← or Escape to close; results are announced." }),
    pattern({ id: "d-sizes", title: "Size classes and default layouts", status: "implemented", wide: true,
      specimen: `<div class="layout-maps"><figure><div class="layout-map wide"><span style="grid-area:a">Presets · Library · Package</span><span style="grid-area:b">Layers · History</span><span style="grid-area:c" class="stage">Head</span><span style="grid-area:d" class="stage">UV map</span><span style="grid-area:e">Finish · Shape · Edge · Warp · Character · Light · Motion · Quality</span></div><figcaption>Wide (≥ 1100 px): stack · full-height head · UV map over the inspectors</figcaption></figure>
        <figure><div class="layout-map compact"><span style="grid-area:a" class="stage">Head</span><span style="grid-area:b" class="stage">UV map</span><span style="grid-area:c">Layers · History · Presets · Library · Package</span><span style="grid-area:d">Finish · Shape · Edge · Warp · Character · Light · Motion · Quality</span></div><figcaption>Compact (&lt; 1100 px): head beside the UV map, above two tab groups</figcaption></figure></div>`,
      what: "Two independently remembered arrangements. Crossing 1100 px switches between them without losing either; Reset restores the current size class only. Activity is closed by default and opens from the status bar.",
      when: "Design new panels for both: say which default group they join in each size class. Keep the head's default cell portrait (it is a portrait subject and front framing fits its width) and the UV map's cell wide enough for the 720:310 both-eyes view, with both visible at once.",
      adapt: "The header condenses labels; the dock does not reflow panels automatically within a size class — users own their arrangement." }),
    pattern({ id: "d-persist", title: "Persistence and recovery", status: "implemented",
      what: "Layouts persist as a versioned, bounded workspace preference (format xfs/dock, version 1) beside theme choice — never in recipes, collections, SQLite or exports.",
      when: "Restored at start through the ui-preferences recovery gate: malformed trees are rejected, unknown panels dropped, duplicates removed, missing (new) panels re-added beside their default siblings, and floating windows pulled back on screen. Invalid saved layouts fall back to defaults with a visible notice.",
      drives: `${code("preferences.dispatch({kind:'layout.set', layout})")}, ${code("recoverDockLayout")}, ${code("parseTree")}, ${code("recoverWindows")}.` }),
    pattern({ id: "d-live", title: "Live dock", status: "implemented", wide: true,
      specimen: `<div class="live-dock" id="live-dock"><p class="sandbox-empty">Scripts are required for the live dock.</p></div>`,
      what: "The production DockView with sample panels: drag tabs and tab bars, float, attach, split, resize, close and reopen from the ⋯ menus. Its layout is not saved.",
      when: "Try interactions here before changing dock-view.ts; the Studio uses the same class with real panels." }),
  ]);
}

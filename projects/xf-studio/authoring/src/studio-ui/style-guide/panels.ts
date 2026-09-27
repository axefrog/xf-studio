import type { IconName } from "../icons";
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
        ${group([["Colour & finish", "finish"], ["Shape", "shape"], ["Pigment & edge", "edge"], ["Warp", "warp"], ["Character", "character"], ["Camera & light", "lighting"]], 0, lorem("Colour & finish"), { stage: "icons", focus: true, style: "width:300px;height:170px" })}</div>`,
      what: "A group shows one panel at a time behind a tab strip. The active tab carries the ink/yellow indicator and a close control; the empty strip to the right is the group's drag handle; ⋯ opens layout options.",
      when: "Put panels in one group when they are used alternately (Presets / Library / Package) and side by side when they are used together (Head and UV map).",
      combine: "Groups sit in splits. When a strip runs short its tabs condense in stages (the tab strip component, lib-tab-strip): inactive labels cut short, then inactive tabs icon-only (right) while the active label stays readable, then the active one too, then an overflow menu. Every tab keeps its name as its tooltip and accessible name, and the header's collapse and layout buttons never shrink.",
      adapt: "Wide and compact workspaces keep separate arrangements. In compact layouts, most panels share two groups.",
      drives: "Pure layout state (DockTree) saved through the workspace preference action layout.set; no application data.",
      a11y: "role=tablist/tab/tabpanel; ←/→/Home/End switch tabs, Alt+Shift+←/→ reorders, Delete closes, Enter or ↓ moves into the panel, Shift+F10 opens layout options. Focus inside a group outlines it in cyan." }),
    pattern({ id: "d-summon", title: "Summoning a panel", status: "implemented", wide: true,
      specimen: `<div class="demo-dock-row"><div style="width:300px;display:flex;flex-direction:column;gap:4px">${group([["UV map", "uv"]], 0, lorem("UV map"), { style: "height:120px" })}
        ${group([["Colour & finish", "finish"], ["Shape", "shape"], ["Pigment & edge", "edge"], ["Warp", "warp"], ["Character", "character"]], 0, "", { stage: "icons", collapsed: true })}</div>
        <div class="demo-float-area" style="width:260px"><div class="dock-window" style="left:10px;top:10px;width:230px;height:150px">${group([["Help", "help"]], 0, lorem("Help"), { floating: true })}</div></div></div>`,
      what: "Every way of asking for a panel (the command palette, the Panels menu, the Help button, a tour step, a link from another panel) summons it the same way, so it is always shown and focused. Already in an expanded group: its tab becomes active. In a collapsed group: the group expands with its tab active. Not in the layout: it goes back to an obvious home, which is where it was when it was closed (its group at its tab position, beside its old neighbour, or its floating window) or the group it belongs to in the factory layout; with no obvious home it opens in a floating window over the middle of the workspace. It is never dropped into an arbitrary group, least of all a collapsed one (left: Help summoned while the right column's lower group is folded opens floating, right).",
      when: "Always; features never place panels themselves. A panel closed by default (Help, Activity) has no home, so it floats until the person docks it; after that, closing and summoning it again returns it to where they put it.",
      combine: "Focus moves to the panel's tab, or into the panel when its opener focuses something there (Help focuses its search). The result is announced: “Help opened in a floating window”, “Colour & finish expanded, showing Shape”.",
      adapt: "Where it was closed from is remembered per size class with the layout (lastPlace); a panel opened by any other route forgets it. A floating panel is clamped on screen like any window.",
      drives: `${code("summonPanel(tree, panel, factory, floatRect)")} in studio-ui/dock/layout.ts, through ${code("DockView.reveal")}. Tests: tests/dock-summon.test.ts.`,
      a11y: "The summoned tab (or the control its opener chose) receives focus; the announcement says where the panel went." }),
    pattern({ id: "d-split", title: "Splits and splitters", status: "implemented",
      specimen: `<div class="demo-split"><div class="dock-split" data-axis="row" style="height:120px">
        <div class="dock-cell" style="flex:1 1 0">${group([["Layers", "layers"]], 0, "")}</div>
        <div class="dock-splitter active" role="separator" aria-orientation="vertical"></div>
        <div class="dock-cell" style="flex:1.4 1 0">${group([["3D view", "head"]], 0, "")}</div></div></div>`,
      what: "Rows and columns of groups with 4 px splitters. Hover or focus shows the cyan track; dragging resizes the two neighbours only.",
      when: "Any docked arrangement. Minimum group size is 150 × 96 px.",
      a11y: "Splitters are focusable separators: arrow keys move 4 %, Enter or double-click equalises the pair." }),
    pattern({ id: "d-collapse", title: "Collapsed group: header row or vertical strip", status: "implemented", wide: true,
      specimen: (() => {
        const tabs: [string, IconName][] = [["Pigment & edge", "edge"], ["Warp", "warp"], ["Colour & finish", "finish"], ["Shape", "shape"], ["Layers", "layers"]];
        return `<div class="demo-dock-row" style="align-items:flex-start">
        ${group(tabs, 0, "", { collapsed: true, fold: "row", style: "height:600px" })}
        ${group(tabs, 2, "", { collapsed: true, fold: "row", style: "height:600px" })}
        ${group(tabs, 2, "", { collapsed: true, fold: "row", stage: "icons", style: "height:360px" })}
        ${group(tabs, 2, "", { collapsed: true, fold: "row", stage: "icons", activeIcon: true, focus: true, style: "height:250px" })}
        <div style="width:400px">${group(tabs, 2, "", { collapsed: true, stage: "icons" })}</div></div>`;
      })(),
      what: "A collapsed group keeps only its tab bar. Folded along a column it is a header row spanning the column (right). Folded along a row (a group alone in its row, or a column whose groups all collapsed) it is a full-height vertical strip: the same tab bar turned on its side (left to right: the first tab active, a middle tab active, a shorter strip with the inactive tabs icon-only, and the shortest with every tab icon-only). Each tab has padding at both ends, an upright icon centred across the strip, a gap between icon, label and close mark, and a hairline between tabs; the active tab is raised to the panel surface with the yellow indicator down the strip's outer edge and its close mark as its own 18 px target at its end.",
      when: "Collapse a group to keep its panels one click away while giving its space to the rest of the workspace. Choosing any tab expands the group showing that tab.",
      combine: "The strip condenses in the same stages as a crowded bar (the tab strip component, lib-tab-strip): full labels, inactive labels cut short, inactive tabs icon-only, the active tab icon-only, then an overflow menu at the strip's end. An icon-only tab keeps its name as its tooltip and accessible name, and a label is never cut mid-glyph. The expand and layout buttons sit at the strip's foot and never shrink.",
      adapt: "The strip is 36 px wide (the 32 px bar height plus 4 px), whichever tab is active or hovered, so nothing shifts. Its tabs refit whenever its height changes.",
      drives: `${code("foldAxes")} in studio-ui/dock/layout.ts picks the axis; the dock marks the group ${code("data-fold")} and builds its header with ${code("orientation: \"vertical\"")}. The tab CSS is written in logical properties, so ${code("writing-mode: vertical-rl")} on the strip turns padding, separators and the indicator with it. Tests: tests/dock-collapse-dom.test.ts (folding), tests/dock-strip-geometry.test.ts (laid-out geometry in Chrome: no overlaps, padding, centred icons, one width, icon-only fallback).`,
      a11y: "The tablist is marked aria-orientation=vertical and keeps the bar's keys (←/→/Home/End switch tabs). The focus ring is drawn inside each tab (outline offset −2 px), so the strip's clipping never cuts it." }),
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
      specimen: `<div class="row gap-m align-end"><div style="width:220px;height:120px;position:relative">${group([["3D view", "head"]], 0, `<div class="panel-content"><p class="note">Maximized · Restore button in the tab bar</p></div>`, { style: "height:100%" })}</div>
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
    pattern({ id: "d-layouts", title: "Saved layouts", status: "implemented", wide: true,
      specimen: `<div class="demo-dock-row">${menu(`${menuHeading("Layouts")}${menuItem("Maximised", { icon: "layouts", checked: true, hint: "Changed · In wide windows" })}${menuItem("Laptop", { icon: "layouts", checked: false, hint: "In compact windows" })}${menuItem("Posing", { icon: "layouts", checked: false, hint: "Changed" })}${menuItem("Eye makeup", { icon: "layouts", checked: false })}${menuSep}${menuItem("Save changes", { icon: "save", focus: true })}${menuItem("Revert to saved", { icon: "undo" })}${menuSep}${menuItem("Save as new layout…", { icon: "plus" })}${menuItem("Rename…", { icon: "rename" })}${menuItem("Delete", { icon: "trash", danger: true })}${menuSep}${menuItem("Remember shown modules", { checked: true })}${menuItem("Switch to it automatically", { icon: "monitor", hint: "In wide windows", sub: true })}${menuSep}${menuItem("Reset to factory layout", { icon: "reset", hint: "Revert to saved brings yours back" })}`, "width:300px")}
        <form class="popover static-popover" style="align-self:flex-start"><div class="popover-title">Save layout</div><label class="popover-field"><span>Name</span></label><input class="field" type="text" value="Layout 4" aria-label="Name"><div class="control toggle-row"><div class="control-line"><label class="toggle"><input type="checkbox" role="switch" class="switch" checked><span class="switch-track" aria-hidden="true"></span><span class="toggle-label">Remember shown modules</span></label></div></div><div class="control toggle-row"><div class="control-line"><label class="toggle"><input type="checkbox" role="switch" class="switch"><span class="switch-track" aria-hidden="true"></span><span class="toggle-label">Switch to it in wide windows</span></label></div></div><div class="popover-actions"><button type="button" class="btn"><span>Cancel</span></button><button type="submit" class="btn primary"><span>Save</span></button></div></form></div>`,
      what: "Named panel arrangements (view-graph-design.md §4.5), from the header's Layouts button (its stacked-windows icon and the current layout's name, the icon alone in narrow windows; tooltip Layout: <em>name</em>) and the palette (Layout: <em>name</em>, Save layout…, Save changes, Revert, Rename, Delete, Reset to factory layout). A layout holds both size classes' arrangements, floating windows, collapsed groups, active tabs and parked places, and by default which modules show. Switching is instant and asks nothing: a changed layout keeps its changes when you switch away and shows them again when you come back; Revert to saved brings the saved arrangement back, Save changes keeps the new one. Rows say only what is different (Changed, In compact windows); the check marks the current layout. Commands are grouped: saving, the library, the layout's options, the factory reset. While nothing changed, Save changes and Revert say so in the muted tone (<code>quietReason</code>).",
      when: "One layout per way of working (maximised and laptop windows, eye makeup and posing). A layout can be chosen for wide or compact windows and is switched to when the window crosses into that size; a layout picked by hand stays until the window changes size class again. Delete offers Undo in its notice instead of asking first.",
      adapt: "The header button shows the layout name (cut short when it is long) and only its icon below 1100 px; the menu is the same in every window.",
      combine: "Names are entered in the value popover with its options (c-popover): the name has a default, Remember shown modules is on, Switch to it automatically is off. Module switches only park and unpark panels; work is never affected.",
      drives: `${code("layouts.saveAs | update | revert | switch | rename | duplicate | delete | insert | setModules | setAutoSize | seen")} through ${code("preferences.dispatch")}; ${code("DockView.load")}; ${code("sameDockState")} decides what counts as changed.`,
      a11y: "A menu button named with the layout and its state; the layouts are checkable entries; unavailable commands say why, muted where it is information rather than a problem (No changes since it was saved; This is your only layout)." }),
    pattern({ id: "d-persist", title: "Persistence and recovery", status: "implemented",
      what: "Layouts persist as a versioned, bounded workspace preference (format xfs/dock, version 1) beside theme choice — never in recipes, collections, SQLite or exports. Saved layouts (xfs/layout-library-1) are kept in the same preferences.",
      when: "Restored at start through the ui-preferences recovery gate: malformed trees are rejected, unknown panels (a newer build's) kept parked with their places, duplicates removed, missing (new) panels re-added beside their default siblings, and floating windows pulled back on screen. Invalid saved layouts fall back to defaults with a visible notice.",
      drives: `${code("preferences.dispatch({kind:'layout.set', layout})")}, ${code("recoverDockLayout")}, ${code("parseTree")}, ${code("recoverWindows")}.` }),
    pattern({ id: "d-live", title: "Live dock", status: "implemented", wide: true,
      specimen: `<div class="live-dock" id="live-dock"><p class="sandbox-empty">Scripts are required for the live dock.</p></div>`,
      what: "The production DockView with sample panels: drag tabs and tab bars, float, attach, split, resize, close and reopen from the ⋯ menus. Its layout is not saved.",
      when: "Try interactions here before changing dock-view.ts; the Studio uses the same class with real panels." }),
  ]);
}

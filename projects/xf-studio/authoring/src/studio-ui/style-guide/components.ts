import { cursorFor, targetTip, viewportHints, type CursorKind, type ViewportInputContext } from "../../input-bindings";
import { hintStripMarkup, targetTipMarkup } from "../input-hints";
import { helpMarkup } from "../guidance/render";
import { TOURS } from "../guidance/tours";
import { badge, btn, chip, code, empty, eyebrow, i, menu, menuHeading, menuItem, menuSep, note, pattern, row, section, segmented, slider, toast, toggle } from "./kit";

// Specimens are rendered by the app's own renderer from the input binding catalogue.
const none = { ctrl: false, alt: false, shift: false }, shift = { ctrl: false, alt: false, shift: true };
const strip = (context: ViewportInputContext) => { const hints = viewportHints(context);
  return `<div class="input-hints" data-scope="${context.scope}" data-tone="${hints.tone}">${hintStripMarkup(hints)}</div>`; };
const stageStrip = (context: ViewportInputContext) => `<div class="viewport-panel demo-hints"><div class="viewport-bottom">${strip(context)}</div></div>`;
const tip = (context: ViewportInputContext) => `<div class="target-tip static-tip" role="tooltip">${targetTipMarkup(targetTip(context)!)}</div>`;
const cursorKinds: [CursorKind, string, ViewportInputContext][] = [
  ["grab", "Point or handle", { scope: "head", target: "point", modifiers: none }],
  ["grabbing", "Dragging a handle", { scope: "head", target: "point", modifiers: none, gesture: "handle" }],
  ["move", "Shape", { scope: "head", target: "shape", modifiers: none }],
  ["rotate", "Shift over makeup", { scope: "head", target: "shape", modifiers: shift }],
  ["scale", "Shift-wheel burst", { scope: "head", target: "shape", modifiers: shift, gesture: "scale" }],
  ["pan", "Ctrl held", { scope: "uv", target: "empty", modifiers: { ctrl: true, alt: false, shift: false } }],
];
const cursorSwatches = `<div class="cursor-swatches">${cursorKinds.flatMap(([kind, label, context]) => {
  if (cursorFor(context) !== kind) throw Error(`Cursor specimen ${kind} no longer matches the catalogue.`);
  return [false, true].map(stage => `<div class="cursor-swatch${stage ? " on-stage" : ""}"><div class="viewport-slot" data-cursor="${kind}"><span><code>${kind}</code><br>${label}</span></div></div>`);
}).join("")}</div>`;

const finishGroups: [string, string, [string, string][]][] = [
  ["Exports", "ok", [["matte", "Matte"], ["regular", "Satin"], ["metallic", "Metallic"]]],
  ["Experimental", "warn", [["shimmer", "Shimmer"], ["glossy", "Glossy"], ["iridescent", "Colour-shift"]]],
  ["Preview only", "warn", [["glitter", "Glitter"]]]];

export function components() {
  return section("components", "04", "Components",
    `Components are presentation only. Each one names the application action or read-only state behind it, and shows the application's reason
     when it is unavailable. Nothing here owns validation, Undo, persistence or export decisions.`, [
    pattern({ id: "c-buttons", title: "Buttons", status: "implemented", wide: true,
      specimen: `<div class="row wrap gap-s">${btn("Save to library", { icon: "save", variant: "primary" })}${btn("Check mod export", { icon: "check" })}${btn("Restore removed", { icon: "reset", variant: "quiet" })}${btn("Front view", { icon: "front", variant: "ghost" })}${btn("Surface controls", { icon: "handles", iconOnly: true, variant: "ghost", pressed: true })}${btn("Remove", { icon: "trash", variant: "danger", small: true })}${btn("Build mod files", { icon: "package", disabled: true, title: "Another collection request is in progress." })}</div>`,
      what: "Primary (yellow, one per region: the commitment), default, quiet (secondary in a region), ghost (tool clusters), danger (destructive where Undo is not enough) and small/icon-only variants. Toggle tools use aria-pressed.",
      when: "Primary marks the action that records or produces something (Save to library, Build). Never two primaries side by side.",
      combine: "Icon + verb label. Icon-only buttons are allowed in tool clusters and row trailing actions, always with an accessible name and tooltip.",
      drives: "Enabled state = the action's capability; the tooltip on a disabled button is the application's reason (the command palette shows the same text).",
      a11y: "Disabled buttons cannot take focus, so every disabled command also appears with its reason in the command palette and context menus." }),
    pattern({ id: "c-chips", title: "Chips, badges and status vocabulary", status: "implemented",
      specimen: `<div class="stack-s"><div class="row wrap gap-s">${chip("Saved")}${chip("Not saved yet", "warning")}${chip("Newer version saved", "warning")}${chip("Working…", "info")}</div>
        <div class="row wrap gap-s">${badge("Can be built", "success")}${badge("Preview only", "warning")}${badge("Current", "success")}${badge("Stale — draft changed since", "warning")}${badge("Blocked", "error")}</div></div>`,
      what: "Chips describe document/library state; badges qualify a result or capability. The words are fixed vocabulary: Working, Preview only, Can be built, Current, Stale, Blocked. A finished Build states its limits in one plain sentence (built and checked, not tested in game, nothing installed) rather than in badges.",
      when: "Whenever a result could be mistaken for more than it is. A green badge never implies game rendering.",
      avoid: "Colour-only status dots without words; vague labels like “OK” or “Done”." }),
    pattern({ id: "c-fields", title: "Text, title and select fields", status: "implemented",
      specimen: `<div class="stack-s" style="max-width:300px"><input class="field title-field" value="Night market set" aria-label="Collection name">
        <input class="field" value="Chrome dusk" aria-label="Preset name"><input class="field" value="" placeholder="Invalid hex" aria-invalid="true" aria-label="Invalid example">
        <div class="select-wrap"><select class="field" aria-label="Eye shape"><option>Eye shape 09</option></select>${i("chevronDown")}</div></div>`,
      what: "Sunken inputs with a strong boundary. Names commit on Enter or blur and revert on Escape; the application validates (e.g. 1–120 characters) and a refused rename restores the previous name with a toast.",
      when: "Inline rename in rows (F2 / double-click), the collection title in Presets, value popovers and selects for enumerations with few choices.",
      a11y: "Native text inputs keep the browser's text context menu; Studio suppresses native menus only on non-text surfaces." }),
    pattern({ id: "c-slider", title: "Slider with readout (one Undo per drag)", status: "implemented",
      specimen: `<div class="stack-s" style="max-width:320px">${slider("Opacity", .85, "85%")}${slider("Point blend", .2, "0.050% UV", { disabled: true, note: "Enable smooth point gradients to adjust blending." })}</div>`,
      what: "Range input with a monospaced readout. Pointer down or arrow keys begin a control transaction, every value is an edit, release/blur commits one Undo step, and Escape restores the starting value.",
      when: "Continuous recipe values (opacity, pigment, softness, reach, flake settings) and view preferences (FOV, exposure).",
      drives: `${code("authoring.controlBegin(id, layerId)")} → ${code("controlEdit(id, action)")} → ${code("controlCommit(id)")} / ${code("controlCancel(id)")}. Ranges come from ${code("actionDescriptors()")} limits, not UI constants.`,
      a11y: "The label is the input's label; the note under a disabled slider states why." }),
    pattern({ id: "c-creator", title: "Creator options (generated rows)", status: "implemented", wide: true,
      specimen: `<div class="cc-panel stack-s" style="max-width:420px">
        <div class="cc-status busy"><span class="cc-status-text" role="status">Updating…</span>${btn("Try again", { icon: "refresh", small: true, variant: "quiet" }).replace('class="btn', 'class="cc-unoffered btn')}${btn("Keep my 2 changes", { icon: "check", small: true, variant: "quiet" })}${btn("Details", { small: true, variant: "quiet" }).replace('class="btn', 'class="cc-unoffered btn')}</div>
        <section class="section cc-quick"><div class="row wrap gap-s">${btn("Hide my V's own makeup", { icon: "eye", variant: "primary" })}${btn("Reset all", { icon: "reset", small: true, variant: "quiet" })}</div>${note("Turns every makeup row Off in one step, so only the makeup you're making shows on your V. Undo brings it back.")}</section>
        <input class="field cc-search" type="search" placeholder="Find an option or choice" aria-label="Find a creator option or choice">
        <section class="cc-section"><h4 class="cc-section-title">Eyes</h4><div class="cc-rows">
          <div class="cc-row changed"><div class="cc-row-head"><button class="cc-row-main" type="button" aria-expanded="true">${i("chevronRight")}<span class="cc-row-label">Eye Color</span><span class="cc-row-current"><span class="swatch cc-row-swatch" style="--swatch:#3d6a8c"></span><span class="cc-row-value">Blue</span></span><span class="cc-row-not-shown" aria-hidden="true">${i("eyeOff")}</span></button><span class="cc-row-actions">${btn("Back to your V's own: Gradient brown", { icon: "reset", iconOnly: true, small: true, variant: "quiet" })}</span></div>
            <div class="cc-choice-list"><div class="cc-choices grid" role="listbox" aria-label="Eye Color choices">${["#5a3a22", "#3d6a8c", "#4f7d4a", "#7a6a5a", "#2a2a2a", "#8a5ab0"].map((colour, n) => `<button class="cc-choice swatch-choice" type="button" role="option" aria-selected="${n === 1}" tabindex="${n === 1 ? 0 : -1}" aria-label="Choice ${n + 1}" aria-description="From the game"><span class="swatch" style="--swatch:${colour}"></span></button>`).join("")}</div></div></div>
        </div></section>
        <section class="cc-section"><h4 class="cc-section-title">Makeup</h4><div class="cc-rows">
          <div class="cc-row"><div class="cc-row-head"><button class="cc-row-main" type="button" aria-expanded="false">${i("chevronRight")}<span class="cc-row-label">Eye Makeup</span><span class="cc-row-current"><span class="cc-row-value">04</span></span></button><span class="cc-row-actions"><button class="chip-button cc-off" type="button" aria-pressed="false">Off</button>${btn("This is your V's own choice.", { icon: "reset", iconOnly: true, small: true, variant: "quiet", disabled: true })}</span></div></div>
          <div class="cc-row not-shown"><div class="cc-row-head"><button class="cc-row-main" type="button" aria-expanded="false">${i("chevronRight")}<span class="cc-row-label">Teeth</span><span class="cc-row-current"><span class="cc-row-value">01</span></span><span class="cc-row-not-shown on" aria-hidden="true">${i("eyeOff")}</span></button><span class="cc-row-actions"></span></div><p class="cc-row-detail">Not shown in the 3D view yet.</p></div>
        </div></section></div>`,
      what: "Every creator option of the shown V, generated from the installed game and mods: sections from the game's creator categories, rows of options sharing a creator slot (the active one shows), and the active option's choices opened in place, as a swatch grid for colours and chips otherwise, Off first. A changed row is marked and offers Reset to the V's own; an option with an Off choice offers Off; a row whose choice the 3D view doesn't draw shows a fixed-size marker. The search finds options and choices on the host, over every choice.",
      when: "The Character panel. The prominent action, Hide my V's own makeup, and Reset all sit above the rows; everything else is per row.",
      combine: "One status line of fixed height above (never moves the layout): Updating…, what failed, or the first of the plain lines about what couldn't be used, clamped to one line; Try again, Keep my changes and Details keep their place when not offered. Undo and Redo for creator changes sit beside the V's source; they are separate from the makeup's history.",
      drives: `${code("character.setOption")} (with a switcher choice's activated options), ${code("character.hideOwnMakeup")}, ${code("character.reset")}, ${code("character.resetAll")}, ${code("character.keepChanges")}, ${code("character.retry")}, ${code("character.undo/redo")}; ${code("authoring.characterPanel()")}, ${code("characterView()")}, ${code("characterChoices(option, want, query)")} and ${code("characterSearch(query)")} (frozen, paged), coverage notes from the preview's projection.`,
      adapt: "Single column at every width; row values and the status line truncate, never wrap; the swatch grid fills the row with as many columns as fit.",
      a11y: "Rows are buttons with aria-expanded and an accessible description (where the option comes from, the V's own choice, whether the 3D view draws it). Choices are a listbox: arrow keys, Home and End move focus without choosing (each choice prepares the V anew), Enter or Space chooses; the chosen one is aria-selected by identity, and each choice's origin is its accessible description. Choosing keeps focus on the same item. Ctrl+Z and Ctrl+Y inside the panel step the character's own history." }),
    pattern({ id: "c-switch", title: "Switch", status: "implemented",
      specimen: `<div class="stack-s">${toggle("Mirror across the face", true)}${toggle("Per-point edge softness", false)}${toggle("Saved V hair", false, { disabled: true, note: "Saved hair preview is unavailable." })}</div>`,
      what: "Binary settings that apply immediately. Recipe switches are one Undo step; preview switches are workspace preferences with no Undo.",
      when: "On/off state. Use a button when the effect is an action (Rebuild preview) rather than a state.",
      a11y: "Native checkbox with role=switch; the disabled reason is visible text, not only a tooltip." }),
    pattern({ id: "c-segmented", title: "Segmented control", status: "implemented",
      specimen: `<div class="stack-s">${segmented("Selected point handles", ["Smooth", "Symmetric", "Corner"], 0)}${segmented("Generated texture resolution", ["512", "1K", "2K", "4K"], 1, [3])}</div>`,
      what: "Mutually exclusive choices shown together; the selection carries a cyan underline. Choices the application refuses (e.g. 4K over the hardware budget) are disabled with the reason as a tooltip and in the palette.",
      when: "Two to five short options that benefit from comparison. Longer or data-driven lists use a select or a menu.",
      drives: `${code("choicesFor(target, kind, field)")} or per-value ${code("capability")}.` }),
    pattern({ id: "c-color", title: "Colour field", status: "implemented",
      specimen: `<div class="control" style="max-width:200px"><span class="control-label"><span>Colour</span></span><div class="color-field"><span class="swatch-frame"><input type="color" class="swatch-input" value="#b0587a" aria-label="Colour"></span><input class="field mono hex" value="#b0587a" aria-label="Colour hex value"></div></div>`,
      what: "Native picker plus a hex field. Picker changes are one transaction; hex entry commits on Enter/blur and flags invalid input without applying it.",
      when: "Layer pigment and finish-specific facet colours. A future palette library should feed the same field (see future directions)." }),
    pattern({ id: "c-finish", title: "Finish chooser", status: "implemented", wide: true,
      specimen: `<div style="display:grid;gap:var(--sp-3);max-width:420px"><div class="finish-groups">${finishGroups.map(([status, tone, items]) => `<div class="finish-group"><span class="finish-tag ${tone}">${status}</span><div class="finish-grid">${items.map(([id, label]) => `<button type="button" class="finish-option" data-finish="${id}" aria-pressed="${id === "metallic"}" aria-label="${label}, ${status.toLowerCase()}"><span class="finish-chip"></span><span class="finish-name">${label}</span></button>`).join("")}</div></div>`).join("")}</div>
        <div class="export-line">${badge("Can be built", "success")}<span class="small">Can be built into your mod as a flat colour. How it looks in game hasn't been tested yet.</span></div></div>`,
      what: "The seven finish families as equal one-line tiles with short names, grouped into rows by export status (Exports, Experimental, Preview only) from the application's finish catalogue; the group heading is the status line its tiles share. Synonyms (foil, pearl, wet look, duochrome) and the full name live in the tooltip and the description line. The selected tile's description and export note sit underneath; Glitter reveals its model suite, Shimmer/Glitter reveal flake studies and Colour-shift its shift colour.",
      when: "Colour & finish panel, the layer context menu's Finish submenu and the command palette — all from the same catalogue.",
      combine: "Metallic is its own family; never alias it to Shimmer. Satin is the user-facing name of the internal regular finish.",
      drives: `${code("finishCatalogue()")} (short label, aliases and export status mirroring the route policy) and ${code("choicesFor({kind:'layer',id}, 'layer.setFinish', 'finish')")}.`,
      avoid: "Inferring package eligibility from labels. The tag informs; Check decides." }),
    pattern({ id: "c-rows", title: "Ordered rows: presets and layers", status: "implemented", wide: true,
      specimen: `<div class="row gap-m align-start"><ol class="item-list" style="width:300px">${row("Accent", "Matte · 85%", { swatch: "#3b8f94", hidden: true })}${row("Glitter veil", "Glitter · 60%", { swatch: "#8c6fb0", finish: "glitter", warn: true })}<li class="item-drop"></li>${row("Petal wash", "Matte · 85%", { swatch: "#b0587a", selected: true })}</ol>
        <ol class="item-list" style="width:260px">${row("Chrome dusk", "3 layers", { preset: true, selected: true })}${row("Soft day", "1 layer", { preset: true })}<li class="item-row"><span class="item-grip">${i("grip")}</span><input class="field item-rename" value="Night run" aria-label="Rename preset"></li></ol></div>`,
      what: "Selectable rows with a drag grip, optional lead controls (visibility, swatch), name, monospaced meta and trailing actions. Layers list front-first; hidden layers are faint and italic (still authored); a warning flag marks preview-study finishes. The yellow line is the drop position; a row in rename mode becomes a field.",
      when: "Any ordered collection a user reorders: presets, layers, and later contours or palette entries.",
      combine: "Selection is workspace state (no Undo); reorder, rename, duplicate and remove are actions with their own Undo or recovery.",
      drives: `${code("preset.select / preset.edit {move, rename, copy, remove}")}, ${code("layer.select / layer.edit / layer.setEnabled")}; counts from ${code("library.summary()")} and ${code("editor.recipe()")}.`,
      a11y: "↑/↓ move between rows, Alt+↑/↓ reorder, F2 rename, Ctrl+D duplicate, Delete remove, Shift+F10 context menu. Only the selected row's trailing buttons are in the tab order." }),
    pattern({ id: "c-context", title: "Context menu", status: "implemented",
      specimen: menu(`${menuHeading("Contour point", "Petal wash · mirrored copy")}${menuItem("Select point", { icon: "target", focus: true })}${menuItem("Remove point", { icon: "trash", danger: true, reason: "A shape needs at least three points." })}${menuItem("Smooth handles", { checked: true })}${menuItem("Corner handles", { icon: "shape" })}${menuItem("Set point pigment…", { icon: "edge" })}${menuItem("Set point edge softness…", { icon: "edge", reason: "Enable point edge softness before editing an individual edge." })}${menuSep}${menuHeading("UV view")}${menuItem("Fit shape", { kbd: "F" })}`),
      what: "Target-aware commands for the thing under the cursor: collection, preset, layer, point, tangent, warp or makeup (any visible layer). Actionable, not informational: a section appears only if it holds an action, so bare skin, empty UV space and background show the view section alone. Headings name the target and whose makeup it is; disabled items stay focusable and show the reason in words.",
      when: "Right-click (a right-drag still pans), Shift+F10 or the Menu key; ⋯ buttons open the same menu for rows.",
      combine: "Target actions come first; view commands follow a separator under the view heading. Commands needing a value open a value popover.",
      drives: `${code("viewport.contextAt(kind,x,y)")} → bound ${code("contextQuery")} options; ${code("dispatchContext(context, action)")} rechecks the target so a menu opened before an edit cannot act on a changed shape.`,
      a11y: "role=menu with roving focus, type-ahead, submenus on →, Escape returns focus to the invoker." }),
    pattern({ id: "c-popover", title: "Value popover", status: "implemented",
      specimen: `<form class="popover static-popover"><div class="popover-title">Point 3 pigment</div><label class="popover-field"><span>Pigment strength</span><output class="readout">72%</output></label><input class="slider" type="range" value=".72" min="0" max="1" step=".01" style="--fill:72%" aria-label="Pigment strength"><p class="popover-note"></p><div class="popover-actions">${btn("Cancel")}${btn("Apply", { variant: "primary" })}</div></form>`,
      what: "A small anchored form for a command that needs one value (rename, move to position, point pigment/softness, warp reach). Apply is disabled while the application refuses the value, with its reason beneath.",
      when: "From context menus and palette entries marked with an ellipsis (…).",
      drives: `${code("boundActionCapability(context, action)")} while editing; ${code("dispatchContext")} on Apply.`,
      a11y: "Enter applies, Escape cancels and restores focus." }),
    pattern({ id: "c-confirm", title: "Confirm in place", status: "implemented",
      specimen: menu(`${menuHeading("Build local mod files?", "Uses the current draft, including unsaved edits. Several minutes; cannot be cancelled once started. Nothing is installed.")}${menuItem("Build now", { icon: "package", focus: true })}${menuItem("Check first", { icon: "check" })}`),
      what: "A short anchored choice for a long or irreversible operation, stating its cost and scope. Used instead of a modal so the user can still see the result card and stage.",
      when: "Operations that cannot be cancelled once started (Build). Undoable edits never ask for confirmation; they offer Undo instead." }),
    pattern({ id: "c-toasts", title: "Toasts", status: "implemented", wide: true,
      specimen: `<div class="toast-demo">${toast("success", "Library", "Saved “Night market set” · revision 4. Changes made during saving remain in your draft.")}${toast("info", "Presets", "Removed “Soft day”. The last 20 removals can be restored.", ["Restore"])}${toast("error", "Library", "The library has a newer revision of this collection. Your draft is kept.", ["Refresh library", "Save as copy"])}</div>`,
      what: "Outcome notices with the source, the application's message and at most two recovery actions. Errors stay until dismissed; others fade after 5–9 s. Every toast is also written to the Activity log.",
      when: "Results of async work, removals with Restore/Undo, adapter limits (“This move reaches the layer's limits”) and conflicts.",
      combine: "Undo/Restore actions are guarded: they refuse to act if other edits happened since, rather than undoing something else.",
      a11y: "Errors use role=alert; others role=status. Dismiss buttons are labelled." }),
    pattern({ id: "c-progress", title: "Progress and readiness", status: "implemented",
      specimen: `<div class="stack-s" style="max-width:360px"><div class="progress indeterminate"></div><div class="row wrap gap-s"><span class="ready-badge" data-phase="ready">Preview 2K · ready</span><span class="ready-badge" data-phase="updating">Updating 2K · 3 queued</span><span class="ready-badge" data-phase="blocked">Preview blocked</span></div></div>`,
      what: "Indeterminate bars for requests without measurable progress; readiness badges for preview textures: ready (every enabled layer shows its latest complete texture), updating (last complete textures stay visible while new ones compute), blocked (with the reason).",
      when: "Readiness appears on the Head viewport and status bar; the Quality panel adds queue count and memory estimate.",
      drives: `${code("previewReadiness.snapshot()")} — phase/size/pending/waiting/estimatedBytes/error. A chosen tier alone never means ready.` }),
    pattern({ id: "c-setup", title: "Setup card and head pane states", status: "implemented", wide: true,
      specimen: `<div class="row gap-m align-start wrap"><section class="setup-card" style="position:static;translate:none;width:360px"><h2 class="setup-card-title">3D preview not prepared</h2><p class="setup-card-body">Preparing the 3D preview was cancelled. You can start it again at any time.</p><p class="setup-card-notice">XF Studio lost contact with its 3D preview service. Still trying (attempt 3)…</p><div class="setup-card-links"><button type="button" class="link-button">Read the licence</button></div><div class="setup-card-actions">${btn("Not now", { variant: "quiet" })}${btn("Try again", { variant: "primary" })}</div></section>
        <div class="viewport-panel" style="position:relative;width:260px;height:200px"><div class="viewport-state" data-tone="neutral"><span class="viewport-state-icon">${i("head")}</span><p>The 3D preview needs your Cyberpunk 2077 game folder.</p>${btn("Set up 3D preview", { variant: "primary", small: true })}</div></div></div>`,
      what: "A floating card that offers the one next step to the 3D preview (use the found game folder, set up WolvenKit, prepare, cancel, try again), and the head pane's own state: progress while checking, loading or preparing; neutral while something is still needed; an error only for a failure. Links use the accent text colour.",
      when: "Until the head is interactive. “Not now” hides the card; the head pane then offers the next step, which opens it again. While work runs the card can't be dismissed, so Cancel stays reachable.",
      combine: "The WolvenKit consent is a sheet opened from the card; it starts on its heading, never on Download, and Esc is Not now. The viewport hint strip hides while the head isn't interactive.",
      adapt: "The card is at most 480 px wide and keeps a 16 px gutter; the consent's facts stack below 520 px.",
      drives: `${code("previewSetup.snapshot()")} (card, consent, head with its next step) and ${code("previewSetup.dispatch({kind:'previewSetup.*'})")}; the pane's phase comes from ${code("viewport.snapshot().head")}.` }),
    pattern({ id: "c-empty", title: "Empty states", status: "implemented",
      specimen: `<div class="row gap-m align-start">${empty("No layers in this preset", "Layers stack like makeup: the top of the list is applied last and appears in front.", btn("Add layer", { icon: "plus", variant: "primary" }))}${empty("No check yet", "Run Check to see which presets and layers can become mod files. Check creates no files.")}</div>`,
      what: "A title, one sentence of orientation and at most one primary action.",
      when: "Empty collection, empty preset, no selected layer, no saved collections, no package result, reference head without a saved V." }),
    pattern({ id: "c-result", title: "Result card", status: "implemented", wide: true,
      specimen: `<div class="row gap-m align-start wrap"><div class="result-card ok" style="width:340px"><div class="result-head"><strong>Check result</strong>${badge("Current", "success")}</div><p class="result-summary">3 of 4 presets can become mod files. This check created no files.</p>
        <div class="omissions"><span class="eyebrow">Omitted from the package</span><ul class="result-list"><li>${i("warning")}<span>Layer “Glitter veil” in “Chrome dusk” — Active finish has no supported game-export adapter.</span></li></ul></div></div>
        <div class="result-card stale" style="width:300px"><div class="result-head"><strong>Build result</strong>${badge("Stale — draft changed since", "warning")}</div>${note("Your mod was built and checked. It hasn't been tested in game yet, and nothing was installed.", "info")}${note("This result describes an earlier snapshot of the draft. Run Check again before relying on it.", "warning")}</div>
        <div class="result-card error" style="width:280px">${i("error")}<div><strong>Build failed</strong><p>Verifier rejected the archive.</p><p class="muted small">Code: verify_failed. Your collection is unchanged.</p></div></div></div>`,
      what: "Outcome of a package Check/Build: retained presets, every omitted layer/preset with the reason, hashes, paths and non-claims. The left rule shows current (green), stale (amber) or error (red).",
      when: "Package panel after each request. A stale result stays visible for reference but says so.",
      drives: `${code("files.snapshot().package")} (${code("freshness: current|stale")}), ${code("files.snapshot().last")} for failures.` }),
    pattern({ id: "c-facts", title: "Fact list", status: "implemented",
      specimen: `<div class="fact-list" style="max-width:360px"><div class="fact"><span class="fact-mark">${i("check")}</span><div><strong>12 facial regions applied</strong><p class="muted small">41 appearance references read · game 2.31</p></div></div><div class="fact"><span class="fact-mark">${i("info")}</span><div><strong>Hair unresolved</strong><p class="muted small">Local assets unavailable or no exact match.</p></div></div></div>`,
      what: "Matched versus unresolved facts, each with a mark and an honest qualifier.",
      when: "Saved-V import results and future asset provenance." }),
    pattern({ id: "c-activity", title: "Activity log", status: "implemented",
      specimen: `<ol class="activity" style="max-width:420px"><li class="activity-item success"><time>14:02:11</time><strong>Library</strong><span>Saved “Night market set” · revision 4.</span></li><li class="activity-item warning"><time>14:01:40</time><strong>UV map</strong><span>This move reaches the layer's limits.</span></li><li class="activity-item error"><time>13:58:03</time><strong>Mod package</strong><span>No mod files can be made…</span></li></ol>`,
      what: "Session-only history of outcomes, warnings and errors, newest first.",
      when: "Opened from the status bar message or the Panels menu; closed by default." }),
    pattern({ id: "c-history", title: "History timeline", status: "implemented",
      specimen: `<div style="max-width:360px" class="stack-s"><p class="note info history-trimmed">${i("info")}<span>Older steps were not kept. Only the latest changes are kept for each preset.</span></p>
        <ol class="history-list" aria-label="Changes to this preset, oldest first">${([["start", "Oldest kept version", ""], ["done", "Colour", "14:01"], ["done", "Move point", "14:02"],
          ["current", "Opacity", "14:02"], ["undone", "Rename layer", "14:03"], ["undone", "Mirroring", "14:03"]] as const).map(([kind, label, time]) =>
          `<li class="history-row" data-kind="${kind}"><button type="button" class="history-step"${kind === "current" ? ' aria-current="step" tabindex="0"' : ' tabindex="-1"'}><span class="history-marker" aria-hidden="true"></span><span class="history-label">${label}</span><span class="history-state">${kind === "current" ? "Current" : ""}</span><span class="history-time">${time}</span></button></li>`).join("")}</ol></div>`,
      what: "The current preset's changes on one timeline, oldest first, named with the same labels as Undo and Redo. The current step is highlighted with a yellow marker and “Current”; steps after it are undone and dimmed with hollow markers. The first row is the oldest kept version.",
      when: "Clicking a row goes to the look right after that step (the first row: before every listed step) as one change. Undone steps stay until a new edit discards them, exactly like Redo. When older steps were dropped at the 80-step limit or to fit browser storage, a note says “Older steps were not kept”.",
      a11y: "An ordered list of buttons with roving focus: ↑/↓/Home/End move between rows, Enter or Space jumps. The current row carries aria-current=step; each row's name states its position, label, time and whether it is undone. Jumps are announced." }),
    pattern({ id: "c-strip", title: "Inspector context strip", status: "implemented",
      specimen: `<div class="layer-strip demo-strip"><span class="swatch" style="--swatch:#b0587a"></span><div><strong>Petal wash</strong><span class="muted">4 of 4 from front</span></div></div>`,
      what: "A sticky line naming the layer an inspector edits.",
      when: "Top of every layer inspector (Colour & finish, Shape, Pigment & edge, Warp) so a floating inspector is never ambiguous." }),
    pattern({ id: "c-viewport", title: "Viewport overlays", status: "implemented", wide: true,
      specimen: `<div class="viewport-panel demo-viewport"><div class="viewport-top"><span class="viewport-context">Chrome dusk › Petal wash</span><div class="viewport-tools">${btn("Front view", { icon: "front", iconOnly: true, small: true, variant: "ghost" })}${btn("Surface controls", { icon: "handles", iconOnly: true, small: true, variant: "ghost", pressed: true })}${btn("Plate wireframe", { icon: "wire", iconOnly: true, small: true, variant: "ghost" })}${btn("Play idle", { icon: "play", iconOnly: true, small: true, variant: "ghost" })}</div></div>
        <div class="viewport-bottom">${strip({ scope: "head", target: "empty", modifiers: none })}<span class="ready-badge" data-phase="ready">Preview 1K · ready</span></div></div>
        <div class="viewport-panel uv demo-uv"><div class="uv-toolbar"><div class="segmented" role="group" aria-label="UV view"><button type="button" class="segment" aria-pressed="true"><span>Both eyes</span></button><button type="button" class="segment" aria-pressed="false"><span>Single eye</span></button></div>${btn("Other eye", { small: true, variant: "ghost", disabled: true })}${btn("Fit shape", { icon: "target", small: true, variant: "ghost" })}</div><div class="uv-stage"><div class="uv-well"></div><div class="viewport-bottom">${strip({ scope: "uv", target: "shape", modifiers: none })}</div></div></div>`,
      what: "On the stage: a context chip (preset › layer), a tool cluster (front view, surface controls, wireframe, idle), the input hint strip (see Input hints) and the readiness badge. The UV map has a toolbar for view modes and fit above a canvas that fills the rest of the panel: the atlas sits on the same neutral stage, wheel zoom and pan use the whole area, and Fit fills it with a small margin clear of the hint strip. Loading and error states replace the stage with a message; editing elsewhere keeps working.",
      when: "Head and UV map panels. Overlays never cover the centre of the stage, and they never take layout space, so changing hint text can never resize a canvas.",
      drives: `${code("viewport.attach/rehost/resize")}, ${code("viewport.snapshot()")} (phase, capture, view), ${code("viewport.uvCommand")}, preview actions.`,
      a11y: "Viewports are focusable regions with keys (F front/fit; 1/2/O UV modes; Shift+F10 commands for the selected point); their accessible names are generated from the key bindings." }),
    pattern({ id: "c-input-hints", title: "Input hints, target tooltips and gesture cursors", status: "implemented", wide: true,
      specimen: `<div class="stack">${stageStrip({ scope: "head", target: "point", modifiers: none })}
        ${stageStrip({ scope: "head", target: "shape", modifiers: shift })}
        ${stageStrip({ scope: "head", target: "empty", modifiers: shift })}
        ${stageStrip({ scope: "head", target: "shape", modifiers: shift, gesture: "rotate" })}
        ${stageStrip({ scope: "uv", target: "point", modifiers: none })}
        <div class="row wrap gap-m align-end"><div class="stage-sample demo-tip-stage">${tip({ scope: "head", target: "point", modifiers: none })}</div>
        <div class="stage-sample demo-tip-stage">${tip({ scope: "head", target: "shape", modifiers: shift })}</div></div>
        ${cursorSwatches}</div>`,
      what: `Blender-style help that follows the pointer and the held keys. Each viewport has a fixed corner strip: what drag, wheel, double-click and right-drag do on the target under the pointer, the viewport keys, and "Hold Shift / Ctrl / Alt" discovery. Holding a modifier switches the strip at once (the held key leads, accent-edged); an active drag or wheel burst shows its gesture with Release/Pause and Esc. Resting on makeup shows a tooltip naming the target and its bindings for the held keys. The cursor comes from the same binding: grab on handles, move on a shape, a rotate glyph with Shift over makeup, a scale glyph during a Shift-wheel burst, all-scroll while Ctrl pans, and the plain cursor where Shift does nothing. Hover a swatch to try each cursor on the stage and a light surface.`,
      when: "Head and UV map panels, on by default. View preferences › Show input hints (also in the Keyboard & mouse dialog and the palette) hides the strip and tooltips; cursors stay because they describe the gesture itself.",
      combine: "Never interactive (pointer-events: none) and never covering the stage centre: the strip overlays the bottom-left corner of both stages, beside the readiness badge on the head. The UV map's Fit keeps a band clear for it. Its last item points to the ? Keyboard & mouse dialog.",
      adapt: "The strip wraps within 72% of the head stage (the full width of the UV stage) and is clamped to two rows; items that do not fit are clipped, never pushing the canvas; below 720 px the Hold/? discovery group hides and only what the pointer does now remains. The tooltip flips to stay inside the panel.",
      drives: `Derived only from ${code("src/input-bindings.ts")}: ${code("viewportHints()")}, ${code("targetTip()")} and ${code("cursorFor()")} over the read-only ${code("viewport.input()")} snapshot (held modifiers plus each adapter's hover target and gesture), on its own ${code("viewport.subscribeInput")} channel; ${code("preferences.inputHints")}. The gesture adapters resolve the same bindings, so hint, cursor and behaviour cannot disagree.`,
      a11y: "Not a live region (it changes with every hover); the same bindings are in each viewport's accessible name and the Keyboard & mouse dialog. Both strips use the theme-aware --stage-* tokens. Custom cursors are white glyphs with a dark halo and fall back to grab / nwse-resize keywords; blur or a hidden page clears held modifiers. Reduced motion removes the tooltip fade." }),
    pattern({ id: "c-handles", title: "Selection and editing handles", status: "implemented",
      specimen: `<svg class="handle-legend" viewBox="0 0 440 120" role="img" aria-label="Handle legend"><rect width="440" height="120" fill="#253132"/>
        <path d="M40 80 C 90 20, 170 20, 210 80" stroke="#f1dbee" stroke-width="1.5" fill="none"/>
        <circle cx="40" cy="80" r="3.5" fill="#c49ab8" stroke="#2b2a34"/><circle cx="125" cy="37" r="5" fill="#fff4fb" stroke="#2b2a34"/><circle cx="210" cy="80" r="3.5" fill="#c49ab8" stroke="#2b2a34"/>
        <line x1="125" y1="37" x2="95" y2="37" stroke="#f4ca8a"/><path d="M95 32 l5 5 -5 5 -5 -5z" fill="#f4ca8a"/><line x1="125" y1="37" x2="160" y2="37" stroke="#f4ca8a"/><path d="M160 32 l5 5 -5 5 -5 -5z" fill="#f4ca8a"/>
        <circle cx="290" cy="70" r="4" fill="none" stroke="#b1ebc9"/><line x1="290" y1="70" x2="320" y2="45" stroke="#b1ebc9"/><rect x="316" y="41" width="8" height="8" fill="#c9ffe2" stroke="#2b2a34"/><circle cx="290" cy="70" r="34" fill="none" stroke="#b1ebc966" stroke-dasharray="4 4"/>
        <text x="20" y="108" fill="#c7ccd2" font-size="10" font-family="system-ui">point · selected · Bézier handles (diamonds) · warp origin ○ · pull ▪ · reach ring</text></svg>`,
      what: "Drawn by the UV and on-head editor adapters, not the dock: contour points (selected is larger and white), gold tangent diamonds (guides that may cross the eye opening), warp origin circle, pull square and dashed reach ring. Guides show the contour before warp; the painted makeup shows the result after warp.",
      when: "Drag to edit (one Undo per gesture), Shift-drag to rotate, Shift+wheel to scale, double-click the outline to insert, Escape to cancel. Shift always means a shape tool: off makeup it does nothing. Right-drag (or Ctrl-drag) pans and wheel zooms — view changes are never edits.",
      drives: "Opaque gesture sessions (beginGesture/applyGesture/endGesture) inside the device adapters; the presentation only hosts them." }),
    pattern({ id: "c-callout", title: "Guidance callout", status: "implemented",
      specimen: calloutSpecimen(),
      what: "A non-modal card with an eyebrow (tour and step), a title, a content area rendered from markdown-lite help text (bold, bullets and key chips generated from the binding catalogue), an optional note, progress marks and a row of custom buttons. Command buttons dispatch ordinary typed actions (“Do it for me”); Back, Next and Done move through the tour.",
      when: "Tour steps and the one-time onboarding offer. Never for errors or confirmations: those stay toasts and menus.",
      combine: "Sits beside the spotlighted anchor, or centred when a step has none. The onboarding offer uses the same card in the lower-left corner without a scrim, away from toasts (lower right) and the 3D preview card (centre).",
      adapt: "360 px wide, capped to the window; below 560 px it becomes a sheet above or below the target. Its height follows its content and it scrolls if the window is short.",
      drives: "GuidanceService snapshot (guidance.startTour, next, back, skip, finish) in src/studio-ui/guidance/engine.ts; button capabilities from the same port capabilities as every control.",
      a11y: "role=dialog, aria-modal=false, labelled by its title and described by its body. Focus moves to the title when a person navigates, never when a step advances by itself; every step is announced. Esc skips, → and Enter go on, ← goes back; Enter on a button presses it. An unavailable button's reason is written in the note, not only in a tooltip.",
      avoid: "Anchoring to CSS selectors, text the reader has to decode (IDs, action names), or buttons that change the look without going through validation and Undo." }),
    pattern({ id: "c-spotlight", title: "Spotlight", status: "implemented",
      specimen: `<div class="specimen-spotlight"><div class="mock-row-demo">${btn("Add layer", { icon: "plus", small: true })}${btn("Duplicate", { icon: "duplicate", small: true, variant: "ghost", iconOnly: true })}</div><span class="guidance-spotlight static-spotlight" style="left:10px;top:10px;width:112px;height:36px"></span></div>`,
      what: "One rectangle around the anchor whose outer shadow dims the rest of the UI in the dark theme and lightens it in the light theme (the --guidance-scrim token), with a ring in --guidance-ring. With no anchor the whole window is dimmed and the callout is centred.",
      when: "While a tour step points at something. It is never used to block input: the dimmed UI stays usable, so a step can ask the person to try the control.",
      combine: "Lights an anchor (layers.add, uv.canvas, header.package …); if the control is hidden but its panel is showing, it lights the panel; if the panel is closed or behind a tab, the callout offers to show it through the ordinary panel command instead.",
      adapt: "Follows the anchor's rectangle every frame while a tour runs, cut to what its scrolling panel shows, so window resizing, docking, floating and scrolling keep it aligned. It is a fixed overlay and never takes layout space.",
      drives: "AnchorRegistry (src/studio-ui/guidance/anchors.ts): panels register named anchors as they build their controls; placeCallout() in placement.ts." }),
    pattern({ id: "c-help", title: "Help view", status: "implemented",
      what: "A dock panel with one search over guided tours, questions and answers, and the keyboard and mouse reference, plus links to the public knowledge pages and the issue tracker.",
      when: `F1, the header's Help button or the command palette. ${TOURS.length} tours today: ${TOURS.map(tour => tour.title).join(", ")}.`,
      combine: "Opens beside the inspectors (closed by default). Tours start from here, with their status (Done, Skipped, Not started). The reference is the same catalogue as the Keyboard & mouse sheet.",
      adapt: "A panel like any other: dock, float or tab it. Tour rows drop their status badge below 420 px.",
      drives: "HELP_TOPICS and HELP_LINKS (data), helpReference() over bindingReference(), port.links.open() for named public pages (the host opens them; the view never sends a URL)." }),
  ]);
}

function calloutSpecimen() {
  const step = TOURS[0].steps[0];
  return `<section class="guidance-callout static-callout" role="dialog" aria-modal="false" aria-label="Example tour step">
    <header class="guidance-head"><span class="guidance-eyebrow">${TOURS[0].title} · 1 of ${TOURS[0].steps.length}</span><button type="button" class="icon-btn small guidance-close" aria-label="Skip tour">${i("close")}</button></header>
    <h2 class="guidance-title">${step.content.title}</h2><div class="guidance-body">${helpMarkup(step.content.body)}</div>
    <footer class="guidance-foot"><div class="guidance-dots" aria-hidden="true">${TOURS[0].steps.map((_, index) => `<i class="${index === 0 ? "current" : ""}"></i>`).join("")}</div>
    <div class="guidance-actions">${btn("Add a layer for me", { small: true })}${btn("Next", { small: true, variant: "primary" })}</div></footer></section>`;
}

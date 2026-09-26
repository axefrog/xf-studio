import { badge, btn, chip, code, empty, group, i, menuHeading, menuItem, menuSep, note, pattern, reasonTip, row, section, segmented, slider, toast, toggle } from "./kit";

export function states() {
  return section("states", "05", "Communicating state",
    `Four kinds of state must stay intelligible: the portable recipe/collection (authored work), the browser workspace (draft autosave, selections, view),
     immutable SQLite library revisions, and exported files. These patterns keep them apart in words and placement.`, [
    pattern({ id: "t-saved", title: "Saved versus unsaved", status: "implemented", wide: true,
      specimen: `<div class="stack-s"><div class="row wrap gap-s">${chip("Not saved yet", "warning")}${chip("Saved")}${chip("Unsaved changes", "info")}${chip("Newer version saved", "warning")}${chip("Working…", "info")}<span class="status-item" data-tone="protected">▲ Your latest changes could not be saved.</span></div>
        <p class="state-line warning">Your library has a newer version of this collection (version 5) saved elsewhere; your draft started from version 3. Saving will report a conflict — save a copy or reopen it.</p></div>`,
      what: "One save status (UI-89): the library chip says whether your work is saved in the library (never saved, saved, unsaved changes, or behind a newer version saved elsewhere), and its tooltip says the draft autosaves on this computer. The status bar speaks about the draft's autosave only when it has a problem.",
      when: "Always visible in the header and Presets panel; the Library panel explains the consequence in a sentence.",
      combine: "Save to library records a new immutable revision; edits made while it runs stay in the draft. Export collection/build plan save first and say so.",
      drives: `${code("status.workspace")}, ${code("library.summary().draft.revision")} vs ${code("summaries[].revision")}.`,
      avoid: "Claiming “unsaved changes” — the application does not yet expose a draft-versus-revision diff (audit API gap A-1). Say what is known." }),
    pattern({ id: "t-undo", title: "Undo, recovery and view changes", status: "implemented",
      what: "Three scopes, named consistently: Undo (Ctrl+Z; per look; content edits, one step per gesture or slider drag), recovery (restore removed preset, recover previous collection draft — separate stacks) and view changes (camera, UV pan/zoom, panels, theme — never undoable, never in recipes). The Character panel has one Undo of its own (UI-81): its buttons and Ctrl+Z / Ctrl+Y anywhere in it but a text box step its creator choices and Clothing in order; the header's Undo and History cover the makeup and say so.",
      when: "Toasts offer the matching scope: “Undo” after layer removal or reset, “Restore” after preset removal, “Undo open” after opening a collection.",
      combine: "Menus group view commands under their own view heading, after the target's edits. Removal commands say “Undo with Ctrl+Z” or “Restorable from the Presets panel”." }),
    pattern({ id: "t-async", title: "Async work and cancellation", status: "implemented",
      specimen: `<div class="package-progress" style="max-width:420px"><div class="progress indeterminate"></div><p class="progress-text">Building and verifying Cyberpunk mod files from the current collection. This can take several minutes… A started build can't be cancelled, and closing XF Studio doesn't stop it.</p></div>`,
      what: "Busy states show the application's progress message. Where the server cannot cancel, the UI says so instead of offering a Cancel that lies.",
      when: "Library requests, package Check/Build, imports. Collection edits are paused while a library request runs; layer editing continues during a save.",
      drives: `${code("library.summary().busy/progress")}, request capabilities (${code("cancellable: false")} in request descriptors).` }),
    pattern({ id: "t-disabled", title: "Disabled with a reason", status: "implemented",
      specimen: `<div class="stack-s">${btn("Export layer mask", { icon: "export", small: true, unavailable: "Select a layer before exporting a mask." })}${reasonTip("Select a layer before exporting a mask.")}</div>`,
      what: "Every unavailable command explains itself with the application's reason, in the menu pattern (UI-84): an unavailable button stays focusable (aria-disabled) and shows its reason as a tip on focus, hover or tap; menus, palette entries and note lines show it as text.",
      when: "Always. If the application gives no reason, that is an API gap to report, not a reason to hide the command.",
      drives: `${code("capability(...)")}.reason and ${code("code")} (missing_target, busy, limit, invalid_value, incompatible_mode, asset_unavailable, not_ready, needs_input).` }),
    pattern({ id: "t-errors", title: "Errors and recovery", status: "implemented",
      specimen: toast("warning", "Library", "The library has a newer revision of this collection. Your draft is kept.", ["Refresh library", "Save as copy"]),
      what: "Refusals and errors say what happened, confirm what was kept, and offer the specific recovery: conflicts offer Refresh and Save as copy; invalid imports keep the current draft; failed previews keep the last complete textures and offer Rebuild. A refusal is a warning; only a real failure is an error, with its reference and Report this problem.",
      when: "Any refused dispatch or failed request. Errors never silently retry." }),
    pattern({ id: "t-stale", title: "Stale results", status: "implemented",
      what: "A result computed from an earlier snapshot stays visible but is labelled Stale with a prompt to run again.",
      when: "Package results after the draft changes (freshness), Glitter flake measurements after the layer or tier changes.",
      drives: `${code("files.package.freshness")}, ${code("status.glitter[].current")}.` }),
    pattern({ id: "t-gesture", title: "Gesture transactions", status: "implemented",
      what: "A pointer drag, wheel burst or slider drag is one transaction: one Undo step on completion; Escape, pointer cancel or focus loss restores the start. The status bar says “Gesture in progress · Esc cancels” or “Adjusting · Esc restores”.",
      when: "Every continuous edit on the head, the UV map or a slider. Moving panels and changing the layout cancels an active viewport gesture first.",
      drives: `${code("previewState().gesture / control")}.` }),
  ]);
}

const mockHeader = (crumb: string, chipLabel = "Saved", category = "Eye makeup") => `<header class="shell-header"><div class="brand"><span class="brand-mark">XF</span></div><span class="category">${i("category")}<span>${category}</span></span><nav class="crumbs"><span class="crumb-preset">${crumb}</span>${chip(chipLabel)}</nav><div class="header-actions">${btn("Undo", { icon: "undo", iconOnly: true, variant: "ghost" })}${btn("Save", { icon: "save" })}${btn("Package", { icon: "package", variant: "quiet" })}</div></header>`;
/** Schematic outline only — mock-ups never embed game-derived imagery. */
const headOutline = `<svg viewBox="0 0 80 100" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M40 6c-17 0-27 13-27 31 0 14 6 25 13 32v14h28V69c7-7 13-18 13-32C67 19 57 6 40 6z" opacity=".6"/><path d="M22 40c5-4 11-4 15 0M43 40c4-4 10-4 15 0" stroke="oklch(.62 .14 350)" stroke-width="3" opacity=".9"/><path d="M24 42c4 2 9 2 12 0M44 42c3 2 8 2 12 0" opacity=".7"/><path d="M36 60c2 1 6 1 8 0" opacity=".5"/></svg>`;
const stage = (label: string) => `<div class="viewport-panel mock-stage"><div class="viewport-top"><span class="viewport-context">${label}</span></div><div class="mock-head">${headOutline}</div><div class="viewport-bottom"><span></span><span class="ready-badge" data-phase="ready">Preview 1K · ready</span></div></div>`;

export function compositions() {
  const editing = `<div class="mock-shell">${mockHeader("Chrome dusk")}
    <div class="mock-dock wide-3 portrait-stage">
      <div class="mock-col">${group([["Presets", "presets"], ["Library", "library"], ["Mod package", "package"]], 0, `<div class="panel-content"><ol class="item-list">${row("Chrome dusk", "3 layers", { preset: true, selected: true })}${row("Soft day", "1 layer", { preset: true })}</ol></div>`, { condensed: true })}
        ${group([["Layers", "layers"]], 0, `<div class="panel-content"><ol class="item-list">${row("Glitter veil", "Glitter · 60%", { swatch: "#8c6fb0", finish: "glitter", warn: true })}${row("Petal wash", "Matte · 85%", { swatch: "#b0587a", selected: true })}${row("Base", "Satin · 70%", { swatch: "#6b4450", finish: "regular" })}</ol></div>`)}</div>
      <div class="mock-col">${group([["Head", "head"]], 0, stage("Chrome dusk › Petal wash"))}</div>
      <div class="mock-col" style="grid-template-rows: minmax(0, 2fr) minmax(0, 3fr)">${group([["UV map", "uv"]], 0, `<div class="uv-well"></div>`)}
        ${group([["Colour & finish", "finish"], ["Shape", "shape"], ["Pigment & edge", "edge"], ["Warp", "warp"], ["Character", "character"], ["Camera & light", "lighting"], ["Motion", "motion"], ["Preview quality", "quality"]], 0, `<div class="panel-content"><div class="layer-strip"><span class="swatch" style="--swatch:#b0587a"></span><div><strong>Petal wash</strong><span class="muted">2 of 3 from front</span></div></div>${slider("Opacity", .85, "85%")}</div>`, { condensed: true })}</div>
    </div><footer class="status-bar"><button type="button" class="status-item status-message" data-tone="success">Saved “Chrome dusk” · version 4.</button><span class="grow"></span><span class="status-item ready-badge" data-phase="ready">Preview 1K · ready</span></footer></div>`;
  const library = `<div class="mock-shell">${mockHeader("Night market set", "Newer r5 saved")}<div class="mock-dock wide-2">
    ${group([["Presets", "presets"], ["Library", "library"], ["Mod package", "package"]], 1, `<div class="panel-content"><section class="section"><h3 class="section-title">Local library</h3><p class="state-line warning">Your draft is based on revision 3; the library has revision 5 from elsewhere.</p><div class="row wrap gap-s">${btn("Save to library", { icon: "save", variant: "primary" })}${btn("Save a copy", { icon: "duplicate" })}</div></section>
      <section class="section"><h3 class="section-title">Saved collections</h3><ul class="saved-list"><li class="saved-row current"><div class="saved-main"><strong>Night market set</strong><span class="muted small">4 presets · r5</span>${badge("This draft", "info")}</div>${btn("Reopen", { small: true, variant: "quiet" })}</li><li class="saved-row"><div class="saved-main"><strong>Day looks</strong><span class="muted small">2 presets · r1</span></div>${btn("Open", { small: true })}</li></ul>${btn("Recover previous draft", { icon: "undo", small: true, disabled: true })}</section></div>`)}
    <div class="mock-stack">${toast("error", "Library", "The library has a newer revision of this collection. Your draft is kept.", ["Refresh library", "Save as copy"])}${toast("success", "Library", "Opened “Day looks”. Undo collection open restores the previous draft.", ["Undo open"])}</div></div></div>`;
  const packaging = `<div class="mock-shell">${mockHeader("Chrome dusk")}<div class="mock-dock wide-2">
    ${group([["Mod package", "package"]], 0, `<div class="panel-content"><section class="section"><h3 class="section-title">Mod package</h3><p class="note">Creates private mod files for ONE in-game eye-makeup selector (plus Off) from the current draft, including unsaved edits.</p><div class="row wrap gap-s">${btn("Check mod export", { icon: "check" })}${btn("Build mod files…", { icon: "package", variant: "primary" })}</div></section>
      <div class="result-card ok"><div class="result-head"><strong>Check result</strong>${badge("Current", "success")}</div><p class="result-summary">3 of 4 presets can become mod files. This check created no files.</p><ul class="result-list"><li>${i("check")}<span>Chrome dusk</span></li><li>${i("check")}<span>Soft day</span></li></ul><div class="omissions"><span class="eyebrow">Omitted from the package</span><ul class="result-list"><li>${i("warning")}<span>Whole preset “Glitter night” — No active exportable layers remain.</span></li></ul></div></div></div>`)}
    ${group([["Layers", "layers"]], 0, `<div class="panel-content"><ol class="item-list">${row("Glitter veil", "Glitter · 60%", { swatch: "#8c6fb0", finish: "glitter", warn: true, selected: true })}</ol><div class="export-line">${badge("Preview only", "warning")}<span class="small">Preview only for now. Check and Build leave out layers with this finish and tell you which.</span></div></div>`)}</div></div>`;
  const compact = `<div class="mock-shell compact-mock">${mockHeader("Chrome dusk")}<div class="mock-dock compact-2"><div class="mock-row stage-row">${group([["Head", "head"]], 0, stage("Petal wash"))}${group([["UV map", "uv"]], 0, `<div class="uv-well"></div>`)}</div>
    <div class="mock-row">${group([["Layers", "layers"], ["Presets", "presets"], ["Library", "library"], ["Mod package", "package"]], 0, `<div class="panel-content"><ol class="item-list">${row("Petal wash", "Matte", { swatch: "#b0587a", selected: true })}</ol></div>`, { condensed: true })}
    ${group([["Colour & finish", "finish"], ["Shape", "shape"], ["Pigment & edge", "edge"], ["Warp", "warp"], ["Character", "character"], ["Camera & light", "lighting"]], 0, `<div class="panel-content">${slider("Opacity", .85, "85%")}</div>`, { condensed: true })}</div></div></div>`;
  const future = `<div class="mock-shell future-mock">${mockHeader("Arched brows — draft", "Not saved yet", "Eyebrows (future)")}
    <div class="future-banner">${i("info")}<span>Future direction — illustration only. Eyebrow authoring is not built and needs discussion before any data model is chosen.</span></div>
    <div class="mock-dock wide-3"><div class="mock-col">${group([["Brow sets", "presets"], ["Library", "library"]], 0, `<div class="panel-content"><ol class="item-list">${row("Arched brows", "draft", { preset: true, selected: true })}</ol></div>`)}</div>
    <div class="mock-col">${group([["Head", "head"]], 0, stage("Brows · Arched brows"))}</div>
    <div class="mock-col">${group([["Brow shape", "shape"], ["Brow material", "finish"]], 0, `<div class="panel-content">${segmented("Hair density", ["Sparse", "Natural", "Full"], 1)}${note("Its own concepts — not makeup layers or makeup finish families.")}</div>`)}</div></div></div>`;
  return section("compositions", "06", "Compositions",
    `Representative arrangements built from the patterns above. They are starting points users can rearrange, not fixed screens.`, [
    pattern({ id: "k-editing", title: "Eye-makeup editing (wide)", status: "implemented", wide: true, specimen: editing,
      what: "Stack on the left (presets over layers); the head in a full-height portrait column at the centre; the UV map over the selected layer's inspectors on the right, with the preview context (Character, Camera & light, Motion, Quality) one tab along.",
      when: "Default wide layout. The eye travels left → centre → right: choose, see, adjust. Head and UV map are always visible together, so an edit in either is judged in the other.",
      combine: "Selecting a layer updates every inspector's context strip; gestures on either viewport update the other.",
      adapt: "Columns scale with the window, so the head stays portrait from 1100 px upward. To keep preview context in view while adjusting a layer, float Camera & light or Character, or drag it beside the inspector; maximize the head for judgement." }),
    pattern({ id: "k-library", title: "Library management", status: "implemented", wide: true, specimen: library,
      what: "Library tab with the save state explained, saved collections (the current one marked), recovery and portable files; outcomes arrive as toasts with specific recoveries.",
      when: "Saving, opening another collection, resolving a conflict, recovering a replaced draft.",
      combine: "Opening a collection always offers Undo open; the Library panel keeps Recover previous draft available afterwards." }),
    pattern({ id: "k-package", title: "Package review", status: "implemented", wide: true, specimen: packaging,
      what: "Mod package panel with Check/Build and a result card beside the Layers panel, where preview-study layers carry a warning flag and the finish explains its export status.",
      when: "Before building: Check, read omissions, fix or accept them, then Build (confirmed in place).",
      combine: "Result freshness turns Stale as soon as the draft changes; the finish status and the omission list use the same catalogue wording." }),
    pattern({ id: "k-compact", title: "Compact workspace", status: "implemented", wide: true, specimen: compact,
      what: "Head and UV map side by side above two condensed tab groups; the head keeps a portrait cell; header actions become icons. Condensed tabs shorten their labels but never become bare icons (UI-96).",
      when: "Windows narrower than 1100 px, tablets, or a narrow browser beside the game." }),
    pattern({ id: "k-future", title: "A future category joining", status: "future", wide: true, specimen: future,
      what: "How a later category (eyebrows is only an example) would join: an entry in the category switcher, its own panel registry and default layouts, reuse of the shell, dock, lists, controls, library and package patterns — and its own concepts.",
      when: "Only after the category is discussed and approved, with typed actions and a catalogue entry first.",
      combine: "Library and Mod package panels can be shared across categories; Head and Camera & light are shared preview tools.",
      avoid: "Reusing makeup layers or the seven finish families for a different category, or adding a global control per category in the header." }),
  ]);
}

export function futures() {
  return section("futures", "07", "Plausible future affordances",
    `Clearly labelled directions the information architecture already has room for. None of these is built; each needs its application actions first.
     They are here so today's patterns are chosen with them in mind.`, [
    pattern({ id: "x-history", title: "Revision history browser", status: "future",
      specimen: `<ol class="timeline"><li class="current"><strong>r5</strong> Today 14:02 · 4 presets</li><li><strong>r4</strong> Today 11:40 · renamed “Soft day”</li><li><strong>r3</strong> Yesterday · 3 presets</li></ol>${btn("Open r4 as a draft", { small: true, disabled: true, title: "Needs a revision read API." })}`,
      what: "A timeline of immutable library revisions with compare and “open as draft”.",
      when: "Library panel, below saved collections.",
      drives: "Missing API: list revisions of a collection, read a revision, open revision as recoverable draft." }),
    pattern({ id: "x-gallery", title: "Preset gallery, search and tags", status: "future",
      specimen: `<div class="gallery">${["Chrome dusk", "Soft day", "Glitter night", "Neon lid"].map((name, index) => `<figure class="${index === 0 ? "selected" : ""}"><span class="thumb" style="--hue:${index * 70 + 300}"></span><figcaption>${name}</figcaption></figure>`).join("")}</div>`,
      what: "Thumbnails and filters for large collections; the list view remains the keyboard-first default.",
      when: "When collections exceed ~12 presets.",
      drives: "Missing API: thumbnail render port, tags on presets, search." }),
    pattern({ id: "x-palette", title: "Palette library", status: "future",
      specimen: `<div class="palette-swatches">${Array.from({ length: 24 }, (_, n) => `<span style="background:oklch(${.45 + (n % 4) * .1} .12 ${n * 15})"></span>`).join("")}</div>`,
      what: "Configurable colour sets larger than the legacy 49, feeding the same colour field.",
      when: "Colour & finish panel, as a popover from the swatch.",
      drives: "Missing API: palette collections as portable data." }),
    pattern({ id: "x-contours", title: "Multiple contours and holes", status: "future",
      specimen: `<ol class="item-list" style="max-width:260px">${row("Outer contour", "6 points", { preset: true, selected: true })}${row("Hole · inner corner", "4 points", { preset: true })}</ol>`,
      what: "A contour list inside Shape, reusing ordered rows.",
      when: "If the shape model grows beyond one contour per layer.",
      drives: "Missing API and recipe schema change — needs discussion." }),
    pattern({ id: "x-compare", title: "A/B comparison view", status: "future",
      specimen: `<div class="compare-demo"><div class="viewport-panel"><span class="viewport-context">A · Satin</span></div><div class="viewport-panel"><span class="viewport-context">B · Metallic</span></div></div>`,
      what: "Two synchronized stages comparing finishes, presets or lighting.",
      when: "As a panel that can dock beside the Head panel.",
      drives: "Missing API: a second renderer/viewport port." }),
    pattern({ id: "x-provenance", title: "Asset provenance panel", status: "future",
      specimen: `<div class="fact-list" style="max-width:360px"><div class="fact"><span class="fact-mark">${i("check")}</span><div><strong>Eye diffuse · Kala 16</strong><p class="muted small">Hash-verified local manifest · archive winner unproven</p></div></div></div>`,
      what: "Where each preview asset came from (MO2/Vortex/manual), its hash and what remains unproven.",
      when: "Character panel expansion; required before claiming preview fidelity.",
      drives: "Partly available (status.assets); a provider-neutral resolver port is missing." }),
    pattern({ id: "x-bulk", title: "Multi-select and bulk actions", status: "future",
      what: "Shift/Ctrl selection in ordered rows with batch move, duplicate, finish change and removal as one transaction.",
      when: "Large presets and collections.",
      drives: "Missing API: batch transactions with one Undo step." }),
    pattern({ id: "x-release", title: "Runtime test checklist and release", status: "future",
      what: "A checklist beside a built package for the single batched game session: selector registration, A→B→Off, saved identity, posed clearance — each marked observed/unobserved.",
      when: "After Build, before any release packaging.",
      drives: "Missing API: runtime evidence records; install remains out of scope." }),
  ]);
}

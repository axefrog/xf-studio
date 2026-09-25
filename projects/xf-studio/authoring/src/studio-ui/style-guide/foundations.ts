import { iconNames } from "../icons";
import { contrastTable } from "./contrast";
import { badge, btn, chip, code, i, pattern, section } from "./kit";

const tokens: [string, string, string][] = [
  ["--bg-app", "Application background behind panels", "surface"], ["--bg-panel", "Panel and header surface", "surface"],
  ["--bg-raised", "Buttons, cards, inspector strips", "surface"], ["--bg-sunken", "Inputs, tab bars, wells", "surface"],
  ["--bg-hover", "Hover", "surface"], ["--bg-active", "Pressed, composite bar", "surface"],
  ["--line", "Structural dividers", "line"], ["--line-strong", "Control boundaries (≥3:1)", "line"],
  ["--text", "Primary text (≥15:1)", "text"], ["--text-muted", "Secondary text (≥6:1)", "text"], ["--text-faint", "Tertiary text (≥4.5:1 on panels)", "text"],
  ["--accent", "Signal yellow: commitment (primary action), focus, active tab notch", "accent"], ["--accent-text", "Accent used as text", "text"],
  ["--signal", "Cyan/teal: live selection, data, drop targets", "accent"], ["--success", "Verified, exportable, ready", "state"],
  ["--warning", "Preview only, stale, needs attention", "state"], ["--danger", "Errors, destructive commands", "state"], ["--focus", "Focus ring", "accent"],
];

export function foundations(css: string) {
  const contrast = contrastTable(css);
  return section("foundations", "01", "Foundations",
    `A restrained Cyberpunk: graphite instruments under a single signal yellow, with cyan reserved for live state. The only ornament is the bevel —
     a clipped corner borrowed from industrial labelling. No neon glow, glitch, scanline or fake HUD chrome: atmosphere never costs legibility.
     Tokens are defined once with ${code("light-dark()")}; a container's ${code("color-scheme")} chooses the theme, so every specimen below renders
     in either theme and in the side-by-side comparison.`, [
    pattern({ id: "f-principles", title: "Design principles", status: "rule", wide: true,
      specimen: `<ol class="principles">
        <li><strong>Truth before polish.</strong> Never show stale, partial, unverified or preview-only results as ready, packaged or game-tested. Status words come from the application, not from the control.</li>
        <li><strong>One accent, one meaning.</strong> Yellow marks commitment and focus (primary action, active tab, keyboard focus). Cyan marks what is live or selected. Everything else is graphite.</li>
        <li><strong>The stage is neutral.</strong> The 3D head and UV map sit on a near-achromatic grey surround, light in the light theme and dark in the dark theme, so colour judgement isn't skewed by coloured chrome.</li>
        <li><strong>Every affordance is an action.</strong> Buttons, menus, shortcuts, drags and the command palette call the same typed application action and show the same disabled reason.</li>
        <li><strong>Panels are tools, not places.</strong> Any panel can dock, float, tab or join a magnetic composite; nothing depends on a fixed sidebar.</li>
        <li><strong>Density with air.</strong> Compact 28 px controls and 32 px rows, but generous section spacing and one idea per section.</li>
      </ol>`,
      what: "The rules every new screen, panel or control is reviewed against.",
      when: "Before designing a feature and again at review. A proposal that breaks one of these needs an explicit exception recorded in the architecture boundary.",
      avoid: "Literal franchise tropes (glitch text, chromatic aberration, neon outlines, fake terminals), decorative animation, and colour used only for mood." }),
    pattern({ id: "f-color", title: "Colour tokens", status: "implemented", wide: true,
      specimen: `<div class="token-grid">${tokens.map(([name, use, kind]) => `<div class="token" data-kind="${kind}"><span class="token-swatch" style="--sample:var(${name})"></span><code>${name}</code><small>${use}</small></div>`).join("")}</div>`,
      what: "Semantic surfaces, lines, text and state colours. Contrast was computed for both themes: all text tokens ≥4.5:1 on panels, control boundaries (--line-strong) ≥3:1, focus ≥11:1.",
      when: "Always reference a token, never a literal colour. User-authored makeup colours are content and are shown unmodified inside swatches.",
      combine: "State colours always travel with a word or icon (e.g. a warning badge says “Preview only”), never colour alone.",
      adapt: "Themes switch by color-scheme; forced-colors mode falls back to system colours for selection and borders.",
      drives: `${code("--accent")} is identical in both themes; light theme swaps accent-as-line to ink via ${code("--indicator")} and ${code("--accent-edge")}.` }),
    pattern({ id: "f-contrast", title: "Contrast", status: "implemented", wide: true, specimen: contrast.html,
      what: "WCAG contrast ratios computed from the tokens in studio.css each time this guide is generated. Text needs 4.5:1; control boundaries, selection and focus need 3:1.",
      when: "Check this table after any token change; the guide build fails the style-guide test if a pair drops below its minimum.",
      combine: "State colours are always paired with words or icons, so contrast is never the only carrier of meaning.",
      adapt: "Both themes are listed; stage overlays use the theme-aware --stage-* tokens.",
      drives: "Parsed light-dark(oklch…) token values; the conversion is OKLCH → linear sRGB → relative luminance." }),
    pattern({ id: "f-type", title: "Typography", status: "implemented",
      specimen: `<div class="type-specimen">
        <p class="t-display">XF STUDIO · EYE MAKEUP</p>
        <p class="section-title">Section eyebrow</p>
        <p class="t-title">Petal wash</p>
        <p>Body 13 px Segoe UI Variable — labels, help and values.</p>
        <p class="note">Secondary 12 px — explanations and honest limits.</p>
        <p><output class="readout">0.0125 · 85% · 2048²</output> numeric readouts in Cascadia Mono</p></div>`,
      what: "Three families: Bahnschrift SemiCondensed (display — tabs, eyebrows, badges, brand; uppercase, tracked), Segoe UI Variable (UI text) and Cascadia Mono (numbers, hashes, paths). All are Windows system fonts; nothing is downloaded.",
      when: "Display face only for short labels in capitals; never for sentences. Mono for any value a user compares across rows.",
      adapt: "Fallback stacks keep proportions on other systems (DIN Alternate / Roboto Condensed / system-ui / ui-monospace)." }),
    pattern({ id: "f-space", title: "Spacing, sizing and density", status: "implemented",
      specimen: `<div class="space-scale">${[2, 4, 6, 8, 12, 16, 20, 28].map(size => `<span style="--size:${size}px"><i></i>${size}</span>`).join("")}</div>
        <p class="note">Controls 28 px (24 px small) · rows 32 px · tabs 32 px · header 44 px · status 26 px.</p>`,
      what: "A 2-px based scale. Panels use 12 px padding and 16 px between sections; related controls sit 8 px apart.",
      when: "Keep one scale step between unrelated groups. Do not invent new heights; lists and menus rely on the shared row height for scanning.",
      adapt: "Compact workspaces keep control sizes; they change arrangement (tabs, icon-only header actions), not target size." }),
    pattern({ id: "f-shape", title: "Bevel, borders and elevation", status: "implemented",
      specimen: `<div class="row wrap gap-m">${btn("Bevelled button")}${btn("Primary", { variant: "primary" })}${chip("Chip")}${badge("Badge", "success")}<div class="result-card ok" style="width:180px"><strong>Card</strong><span class="muted small">7 px bevel</span></div></div>`,
      what: "Bevelled corners via CSS corner-shape (top-right and bottom-left on controls; top-right on cards, menus, windows). Borders are 1 px; elevation is reserved for things above the dock: floating windows, menus, toasts and dialogs.",
      when: "Bevel is the only decorative shape. Never combine it with rounded corners or drop shadows on docked panels.",
      adapt: "Browsers without corner-shape show square 2 px radii — the design must read correctly without the bevel." }),
    pattern({ id: "f-icons", title: "Iconography", status: "implemented", wide: true,
      specimen: `<div class="icon-grid">${iconNames.map(name => `<span class="icon-cell">${i(name)}<code>${name}</code></span>`).join("")}</div>`,
      what: "Original 16 px line icons, square caps and mitred joins, drawn for this project. Stroke uses currentColor; filled marks are used only for dots and grips.",
      when: "Pair with a text label except in tool clusters with tooltips and accessible names (icon-only buttons always have aria-label).",
      avoid: "Game or franchise UI assets, emoji, and icons that imply a feature that does not exist." }),
    pattern({ id: "f-motion", title: "Motion", status: "implemented",
      specimen: `<div class="row gap-m"><div class="progress indeterminate" style="width:160px"></div><span class="ready-badge" data-phase="updating">Updating 2K</span>${chip("140 ms ease-out")}</div>`,
      what: "140 ms state transitions, a sweeping bar for indeterminate work and a two-step blink for updating previews. Drop previews ease 80 ms so targets feel magnetic without lag.",
      when: "Motion only communicates state change or work in progress. Nothing loops except genuine ongoing work.",
      a11y: "prefers-reduced-motion collapses all transitions and animations to 1 ms." }),
    pattern({ id: "f-focus", title: "Focus and keyboard", status: "implemented",
      specimen: `<div class="row wrap gap-m"><button type="button" class="btn demo-focus-ring"><span>Focused button</span></button><button type="button" class="dock-tab demo-focus-ring" role="tab" aria-selected="true">${i("layers")}<span class="dock-tab-label">Focused tab</span></button><input class="field demo-focus-ring" value="Focused field" aria-label="Focused field"></div>`,
      what: "A 2 px ring in --focus (signal yellow on dark, ink on light) with 2 px offset; inside tab bars and lists the ring sits inset so it is never clipped.",
      when: "Every interactive element shows focus-visible. Pointer clicks do not leave rings on buttons.",
      a11y: "F6 cycles header → each panel group → status bar. Shift+F10 or the Menu key opens the same context menu a right-click would." }),
    pattern({ id: "f-stage", title: "Stage surround", status: "rule",
      specimen: `<div class="stage-sample"><span class="viewport-context">Stage · both themes</span></div>`,
      what: "Viewports use the same neutral radial surround in light and dark themes. Overlays on the stage use their own fixed colours (stage chip, stage text).",
      when: "Any panel that shows the head, a texture or a material comparison.",
      avoid: "Theme-coloured backgrounds behind colour-critical content." }),
  ]);
}

export function shell() {
  return section("shell", "02", "Shell and navigation",
    `The shell has three bands: a header that names where you are and holds the few global commitments, a dock workspace that owns everything else,
     and a status bar that tells the truth about saving, work in progress and preview readiness.`, [
    pattern({ id: "s-header", title: "Application header", status: "implemented", wide: true,
      specimen: `<header class="shell-header demo-header">
        <div class="brand"><span class="brand-mark">XF</span><span class="brand-name">Studio</span></div>
        <span class="category" title="Authoring category: eye makeup">${i("category")}<span>Eye makeup</span></span>
        <nav class="crumbs"><span class="crumb-collection">Night market set</span>${i("chevronRight")}<span class="crumb-preset">Chrome dusk</span>${chip("Saved")}</nav>
        <span class="verify-flag">Verification workspace</span>
        <div class="header-actions"><span class="history-controls" role="group" aria-label="Undo and Redo">${btn("Undo: Move point", { icon: "undo", iconOnly: true, variant: "ghost", title: "Undo: Move point (Ctrl+Z)" })}${btn("Redo", { icon: "redo", iconOnly: true, variant: "ghost", disabled: true, title: "Redo (Ctrl+Shift+Z) — There is no undone change to redo." })}${btn("History", { icon: "history", iconOnly: true, variant: "ghost" })}</span>${btn("Save", { icon: "save" })}${btn("Package", { icon: "package", variant: "quiet" })}<span class="divider"></span>${btn("Commands", { icon: "command", variant: "ghost" })}${btn("Panels", { icon: "layout", iconOnly: true, variant: "ghost" })}${btn("Theme", { icon: "monitor", iconOnly: true, variant: "ghost" })}</div></header>`,
      what: "Brand, the authoring category (a plain label while there is only one; the switcher later), a breadcrumb of collection › preset with the library state chip, the verification flag when isolated, and global actions: Undo, Redo and History (grouped; their tooltips name the step each would change, such as “Redo: Move point (Ctrl+Shift+Z)”, and keep the shortcut visible while unavailable), Save to library, Package, command palette, panels/layout and theme.",
      when: "Always visible. Only commands that act on the whole document or workspace belong here; anything about a layer or panel stays in that panel.",
      combine: "The library chip repeats the Presets panel chip so saved state is visible when that panel is closed.",
      adapt: "Below 1100 px the brand word, collection crumb and action labels collapse to icons with names; below 720 px the chip and verification flag hide (the status bar still reports them).",
      drives: `${code("library.summary()")}, ${code("authoring.capability({kind:'history.undo'|'history.redo'})")}, ${code("authoring.history()")}, ${code("authoring.requestCapability({kind:'save'})")}, ${code("status.snapshot().verification")}, ${code("preferences")}.` }),
    pattern({ id: "s-category", title: "Category label and growth", status: "implemented",
      specimen: `<div class="shell-header demo-header"><span class="category" title="Authoring category: eye makeup">${i("category")}<span>Eye makeup</span></span></div>`,
      what: "The header names the authoring category. It is the one place new categories will join. With only Eye makeup there is nothing to choose, so it is a plain label, not a menu: menus list only what can be done.",
      when: "It becomes a switcher (a menu with one item per category) only when a second category has its own approved data model, actions and panels.",
      combine: "Selecting a category will swap the panel registry and default layouts (see the future-category composition); shared panels such as Library and Package stay.",
      avoid: "A menu with nothing to choose, sections that only inform, listing unbuilt categories, or turning preview-context toggles (brows, hair) into authoring entries." }),
    pattern({ id: "s-status", title: "Status bar", status: "implemented", wide: true,
      specimen: `<footer class="status-bar demo-status"><span class="status-item">● Draft autosaved</span><button type="button" class="status-item status-message" data-tone="success">Saved “Night market set” · revision 4.</button><span class="grow"></span><span class="status-item muted">Gesture in progress · Esc cancels</span><span class="status-item ready-badge" data-phase="updating">Preview 2K · updating</span></footer>`,
      what: "Draft autosave state, the latest activity or in-flight library message (click opens Activity), gesture/transaction hints and preview readiness.",
      when: "Always visible. It reports; it never hosts commands other than opening the activity log.",
      adapt: "Messages truncate with an ellipsis; the Activity panel keeps the full text.",
      drives: `${code("status.snapshot().workspace")}, ${code("library.summary().progress")}, ${code("previewState().gesture/control")}, ${code("previewReadiness.snapshot()")}.`,
      a11y: "Toasts and the activity log carry the same messages to assistive technology through live regions; the status bar itself is not a live region to avoid double announcements." }),
    pattern({ id: "s-palette", title: "Command palette", status: "implemented",
      specimen: `<div class="palette static-palette"><div class="palette-field">${i("search")}<span class="palette-input">save</span><kbd>Esc</kbd></div>
        <ul class="palette-list"><li class="palette-group">Library</li>
        <li class="palette-item active"><span class="menu-icon">${i("save")}</span><span class="menu-text"><span class="menu-label">Save to library</span></span><kbd>Ctrl+S</kbd></li>
        <li class="palette-item"><span class="menu-icon">${i("duplicate")}</span><span class="menu-text"><span class="menu-label">Save a copy</span></span></li>
        <li class="palette-item" aria-disabled="true"><span class="menu-icon">${i("undo")}</span><span class="menu-text"><span class="menu-label">Recover previous collection draft</span><small class="menu-reason">No previous collection draft.</small></span></li></ul>
        <div class="palette-foot">↑↓ choose · Enter run · disabled commands explain why</div></div>`,
      what: "Every command in one searchable list: edit, shape, finish, library, files, package, view, motion, panels, layout, appearance and help. Unavailable commands stay listed with the application's reason.",
      when: "Ctrl+K (or Ctrl+Shift+P) anywhere, and the Commands header button.",
      combine: "Each entry wraps exactly one typed action, file request or layout operation — the same call its button makes.",
      drives: `${code("authoring.capability(action)")}, ${code("files.capability")}, ${code("authoring.requestCapability")}, ${code("viewport.uvCommandCapability")}.`,
      a11y: "Combobox + listbox with aria-activedescendant; disabled options expose their reason as text." }),
    pattern({ id: "s-sheet", title: "Reference sheet (dialog)", status: "implemented",
      specimen: `<div class="sheet static-sheet"><div class="sheet-head"><h2>Keyboard &amp; mouse</h2>${btn("Close", { icon: "close", iconOnly: true, variant: "ghost" })}</div><section class="reference-section"><h3>Head viewport</h3><dl class="shortcut-list wide"><dt><kbd>Shift-drag</kbd></dt><dd>Rotate shape<span class="reference-where"> · over makeup</span></dd><dt><kbd>Wheel / Ctrl-wheel</kbd></dt><dd>Zoom view</dd></dl></section></div>`,
      what: "A modal dialog for reference content. The Keyboard & mouse dialog lists every binding grouped by context (anywhere, head, UV map, during a gesture, panel tabs, rows), generated from the input binding catalogue, with the viewport-hints switch at the top. Modal dialogs are reserved for reading or a single decision.",
      when: "Press ? outside text fields, View preferences or Panels › Keyboard & mouse, or the palette.",
      a11y: "Native <dialog> with showModal: focus is trapped, Escape closes and focus returns to the invoker." }),
  ]);
}

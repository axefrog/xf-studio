/**
 * The in-game theme: XF Studio's tokens as Dear ImGui colours and metrics, for the XF Runtime Bridge's surfaces (the XF ImGui overlay
 * panel, the CET window and the CET line). This file is the table the style guide's "In-game surfaces" section documents and the
 * bridge's theme generator (projects/xf-runtime-bridge/tools/overlay/theme.ts) reads, so the two cannot drift. It is plain data with
 * no imports, so the generator can import it from the bridge's own bun scripts.
 *
 * Every entry names a token of public/studio.css (:root) and nothing else: no colour is written twice. Dark is the default theme and
 * light is a manual setting, so each token is resolved for both (light-dark() splits it). tests/in-game-theme.test.ts checks that every
 * token resolves, that the generator writes no slot this table lacks, and that a slot both carry has the same token (or names the
 * token it replaces in `from`).
 *
 * `from` marks a slot whose token this table changes: the generator's present token. `added` marks a slot the generator does not write
 * yet. Both are build instructions for the bridge and are tolerated stale: once the generator reads this table they say nothing.
 */

/** Dear ImGui 1.92.9 docking, enum ImGuiCol_ in imgui.h (COUNT and obsolete aliases excluded).
 * Source: https://github.com/ocornut/imgui/blob/v1.92.9-docking/imgui.h#L1688-L1753
 * Names omit the common ImGuiCol_ prefix, as the bridge's table does. Keep this pinned list independent of the mapping below.
 */
export const IMGUI_COLOUR_SLOTS = [
  "Text", "TextDisabled", "WindowBg", "ChildBg", "PopupBg", "Border", "BorderShadow",
  "FrameBg", "FrameBgHovered", "FrameBgActive", "TitleBg", "TitleBgActive", "TitleBgCollapsed", "MenuBarBg",
  "ScrollbarBg", "ScrollbarGrab", "ScrollbarGrabHovered", "ScrollbarGrabActive", "CheckMark", "CheckboxSelectedBg",
  "SliderGrab", "SliderGrabActive", "Button", "ButtonHovered", "ButtonActive", "Header", "HeaderHovered", "HeaderActive",
  "Separator", "SeparatorHovered", "SeparatorActive", "ResizeGrip", "ResizeGripHovered", "ResizeGripActive", "InputTextCursor",
  "TabHovered", "Tab", "TabSelected", "TabSelectedOverline", "TabDimmed", "TabDimmedSelected", "TabDimmedSelectedOverline",
  "DockingPreview", "DockingEmptyBg", "PlotLines", "PlotLinesHovered", "PlotHistogram", "PlotHistogramHovered",
  "TableHeaderBg", "TableBorderStrong", "TableBorderLight", "TableRowBg", "TableRowBgAlt", "TextLink", "TextSelectedBg",
  "TreeLines", "DragDropTarget", "DragDropTargetBg", "UnsavedMarker", "NavCursor", "NavWindowingHighlight", "NavWindowingDimBg", "ModalWindowDimBg",
] as const;

/** Required XF surface colours, alongside the pinned ImGui slots. */
export const XF_COLOUR_SLOTS = [
  "XfAccent", "XfAccentInk", "XfAccentEdge", "XfAccentText", "XfAccentHover", "XfSignal", "XfSignalBg", "XfSignalLine",
  "XfTextMuted", "XfLine", "XfLineStrong", "XfSuccess", "XfSuccessBg", "XfWarning", "XfWarningBg", "XfDanger", "XfDangerBg",
] as const;

export type ColourSlotName = typeof IMGUI_COLOUR_SLOTS[number] | typeof XF_COLOUR_SLOTS[number];

/** A labelled bar keeps body text legible over its fill in both themes. No opaque edge crosses the label. */
export const IN_GAME_LABELLED_BAR_ALPHA = 0.3;

export type ColourSlot = {
  /** The Dear ImGui colour (ImGuiCol_<slot>) or an XF semantic slot (Xf...), which a surface reads by name. */
  slot: ColourSlotName;
  /** A custom property of studio.css :root. */
  token: string;
  /** Multiplies the token's own alpha (a wash given as a colour). */
  alpha?: number;
  /** Where it shows. */
  use: string;
  /** The token the generator maps today, where this table changes it. */
  from?: string;
  /** Not written by the generator yet. */
  added?: true;
  /** Why it is new or changed. */
  why?: string;
};

export const IN_GAME_COLOURS: readonly ColourSlot[] = [
  // Text
  { slot: "Text", token: "--text", use: "Body text, values" },
  { slot: "TextDisabled", token: "--text-faint", use: "Footers, disabled labels, the idle dot" },
  { slot: "TextLink", token: "--accent-text", use: "A link or a key hint that can be clicked", added: true, why: "ImGui's default is a blue the theme never uses; the Studio's links are accent text." },
  { slot: "InputTextCursor", token: "--text", use: "The caret in a text box", added: true, why: "Named so no slot keeps an ImGui default." },
  // Surfaces
  { slot: "WindowBg", token: "--bg-overlay", use: "Every XF window: the plate over the game" },
  { slot: "ChildBg", token: "--bg-panel", use: "A child panel: a card inside a window" },
  { slot: "PopupBg", token: "--bg-overlay", use: "Tooltips and popups" },
  { slot: "MenuBarBg", token: "--bg-panel", use: "A menu bar, if a tool window has one" },
  { slot: "TitleBg", token: "--bg-raised", use: "A window title bar, if shown" },
  { slot: "TitleBgActive", token: "--bg-raised", use: "A focused window title bar" },
  { slot: "TitleBgCollapsed", token: "--bg-raised", use: "A collapsed window title bar" },
  { slot: "ModalWindowDimBg", token: "--bg-app", alpha: 0.6, use: "The dim behind a modal window" },
  { slot: "NavWindowingDimBg", token: "--bg-app", alpha: 0.2, use: "The dim while switching windows with the keyboard", added: true, why: "Named so no slot keeps an ImGui default." },
  // Edges
  { slot: "Border", token: "--line-strong", from: "--line", use: "A window's edge and every control's frame (buttons, fields, keycaps)", why: "The Studio's controls draw --line-strong (.btn, .field, .segmented); ImGui has one border colour for windows and controls, so it takes the control value. A card's soft edge is XfLine." },
  { slot: "BorderShadow", token: "--bg-app", alpha: 0, use: "Nothing: no shadows in game" },
  { slot: "Separator", token: "--line-soft", use: "A rule between groups" },
  { slot: "SeparatorHovered", token: "--line-strong", use: "A draggable rule under the pointer" },
  { slot: "SeparatorActive", token: "--accent", use: "A draggable rule being dragged" },
  // Fields and controls
  { slot: "FrameBg", token: "--bg-sunken", use: "A field's well (text box, keycap, checkbox box)" },
  { slot: "FrameBgHovered", token: "--bg-hover", use: "A field under the pointer" },
  { slot: "FrameBgActive", token: "--bg-active", use: "A field being edited" },
  { slot: "Button", token: "--bg-raised", use: "A button" },
  { slot: "ButtonHovered", token: "--bg-hover", use: "A button under the pointer" },
  { slot: "ButtonActive", token: "--bg-active", use: "A button being pressed" },
  { slot: "CheckMark", token: "--signal", from: "--accent", use: "A checked box or radio", why: "An on state is cyan (the Studio's switch: .switch:checked); yellow is commitment." },
  { slot: "CheckboxSelectedBg", token: "--signal-bg", use: "A selected checkbox's background", added: true, why: "The Studio's cyan on-state wash; named so no slot keeps an ImGui default." },
  { slot: "SliderGrab", token: "--signal", use: "A slider's thumb" },
  { slot: "SliderGrabActive", token: "--accent", use: "A slider's thumb while dragged" },
  { slot: "Header", token: "--signal-bg", use: "A selected row or an open section header" },
  { slot: "HeaderHovered", token: "--bg-hover", use: "A row under the pointer" },
  { slot: "HeaderActive", token: "--bg-active", use: "A row being pressed" },
  { slot: "NavCursor", token: "--focus", use: "The keyboard focus ring" },
  { slot: "DragDropTarget", token: "--accent", use: "A drop target's outline" },
  { slot: "DragDropTargetBg", token: "--signal-bg", use: "A drop target's wash", added: true, why: "Named so no slot keeps an ImGui default." },
  { slot: "UnsavedMarker", token: "--accent", use: "The marker on a window with unsaved changes", added: true, why: "Named so no slot keeps an ImGui default." },
  { slot: "NavWindowingHighlight", token: "--focus", alpha: 0.7, use: "The outline while switching windows with the keyboard", added: true, why: "Named so no slot keeps an ImGui default." },
  // Scrolling and resizing
  { slot: "ScrollbarBg", token: "--bg-sunken", use: "A scrollbar's track" },
  { slot: "ScrollbarGrab", token: "--line-strong", use: "A scrollbar's thumb" },
  { slot: "ScrollbarGrabHovered", token: "--text-faint", use: "A scrollbar's thumb under the pointer" },
  { slot: "ScrollbarGrabActive", token: "--text-muted", use: "A scrollbar's thumb being dragged" },
  { slot: "ResizeGrip", token: "--line", use: "A window's resize corner" },
  { slot: "ResizeGripHovered", token: "--line-strong", use: "The corner under the pointer" },
  { slot: "ResizeGripActive", token: "--accent", use: "The corner being dragged" },
  // Tabs, tables, plots
  { slot: "Tab", token: "--bg-panel", use: "An unselected tab" },
  { slot: "TabHovered", token: "--bg-hover", use: "A tab under the pointer" },
  { slot: "TabSelected", token: "--bg-raised", use: "The selected tab", added: true, why: "Without it a tab bar shows ImGui's blue." },
  { slot: "TabSelectedOverline", token: "--signal", use: "The selected tab's top line (the Studio's selected underline, .segment[aria-pressed])", added: true, why: "As above." },
  { slot: "TabDimmed", token: "--bg-panel", use: "An unselected tab in an unfocused window", added: true, why: "As above." },
  { slot: "TabDimmedSelected", token: "--bg-raised", use: "The selected tab in an unfocused window", added: true, why: "As above." },
  { slot: "TabDimmedSelectedOverline", token: "--line-strong", use: "Its top line", added: true, why: "As above." },
  { slot: "DockingPreview", token: "--signal", alpha: 0.5, use: "Docking is off in the host; named so no slot keeps a default", added: true, why: "As above." },
  { slot: "DockingEmptyBg", token: "--bg-app", use: "As above", added: true, why: "As above." },
  { slot: "TableHeaderBg", token: "--bg-raised", use: "A table's header row" },
  { slot: "TableBorderStrong", token: "--line-strong", use: "A table's outer rules" },
  { slot: "TableBorderLight", token: "--line-soft", use: "A table's inner rules" },
  { slot: "TableRowBg", token: "--bg-app", alpha: 0, use: "A table row: clear", added: true, why: "Named so no slot keeps an ImGui default." },
  { slot: "TableRowBgAlt", token: "--bg-sunken", alpha: 0.6, use: "The alternate row, where a long table needs one", added: true, why: "As above." },
  { slot: "PlotLines", token: "--signal", use: "A line plot" },
  { slot: "PlotLinesHovered", token: "--accent", use: "A line plot's hovered point" },
  { slot: "PlotHistogram", token: "--signal", use: "A bar's fill (progress, meter, histogram)" },
  { slot: "PlotHistogramHovered", token: "--accent", use: "A histogram bar under the pointer" },
  { slot: "TextSelectedBg", token: "--signal-bg", use: "Selected text in a field" },
  { slot: "TreeLines", token: "--line", use: "A tree's guide lines", added: true, why: "Named so no slot keeps an ImGui default." },
  // XF semantic slots: the panels' own colours, read by name (the generator writes them beside ImGui's)
  { slot: "XfAccent", token: "--accent", use: "The primary button's fill: the one thing the player is asked for" },
  { slot: "XfAccentInk", token: "--accent-ink", use: "Text on the primary button" },
  { slot: "XfAccentEdge", token: "--accent-edge", use: "The primary button's border, a waiting question's edge" },
  { slot: "XfAccentText", token: "--accent-text", use: "A heading, a question's label" },
  { slot: "XfSignal", token: "--signal", use: "Live data, an on state, the info chip" },
  { slot: "XfSuccess", token: "--success", use: "Connected, done" },
  { slot: "XfWarning", token: "--warning", use: "Changes allowed or paused, a warning" },
  { slot: "XfDanger", token: "--danger", use: "Stopped, an error, the stop button" },
  { slot: "XfTextMuted", token: "--text-muted", use: "Labels, hints, notes" },
  { slot: "XfLineStrong", token: "--line-strong", use: "A keycap's edge" },
  { slot: "XfLine", token: "--line", use: "A card's edge, a bar's track, a heading's rule", added: true, why: "Border now takes --line-strong for controls; cards and tracks need the Studio's soft --line (.progress, .state-line's neighbours)." },
  { slot: "XfSignalBg", token: "--signal-bg", use: "The info chip's fill, an on toggle's fill", added: true, why: "Chips and toggles read the Studio's tone washes; Header carries the same token for rows, but a slot named for its use survives a change to the row colour." },
  { slot: "XfSignalLine", token: "--signal-line", use: "The info chip's border", added: true, why: "The Studio's .chip.info border." },
  { slot: "XfSuccessBg", token: "--success-bg", use: "The success chip's fill", added: true, why: "The Studio's .chip/.badge success wash." },
  { slot: "XfWarningBg", token: "--warning-bg", use: "The warning chip's fill, a note card's fill", added: true, why: "The Studio's .chip/.badge warning wash." },
  { slot: "XfDangerBg", token: "--danger-bg", use: "The danger chip's fill, the stop button's hover", added: true, why: "The Studio's .badge.error wash." },
];

/**
 * Colours the Studio sets on a component's rule rather than as a token (the generator reads the rule's declaration).
 * The primary button's hover is the one: a lighter yellow that no token names.
 */
export type RuleColour = { slot: ColourSlotName; rule: string; property: string; use: string };
export const IN_GAME_RULE_COLOURS: readonly RuleColour[] = [
  { slot: "XfAccentHover", rule: ".btn.primary:hover", property: "background", use: "The primary button under the pointer (its edge colour would be near-black in light)" },
];

/** ImGui style metrics, from the Studio's spacing, size and radius tokens (the Studio's own pixels at 1x; the host scales them). */
export type Metric = { name: string; token: string; use: string; added?: true; why?: string };
export const IN_GAME_METRICS: readonly Metric[] = [
  { name: "WindowPaddingX", token: "--sp-5", use: "A window's padding (the Studio's panel padding)" },
  { name: "WindowPaddingY", token: "--sp-5", use: "As above" },
  { name: "FramePaddingX", token: "--sp-4", use: "A control's padding (.field)" },
  { name: "FramePaddingY", token: "--sp-3", use: "(control height - text) / 2, about --sp-3 at 13 px text in 28 px controls" },
  { name: "ItemSpacingX", token: "--sp-4", use: "The gap between controls on a row" },
  { name: "ItemSpacingY", token: "--sp-3", use: "The gap between rows" },
  { name: "ItemInnerSpacingX", token: "--sp-3", use: "The gap between a control and its label (.btn gap)" },
  { name: "ItemInnerSpacingY", token: "--sp-2", use: "As above, vertical" },
  { name: "Rounding", token: "--radius", use: "Every widget corner: ImGui has no bevelled corner, so widgets take the Studio's 2 px radius" },
  { name: "BevelSmall", token: "--bevel-sm", use: "The chamfer a chip's top-right and bottom-left corners are drawn with" },
  { name: "BevelLarge", token: "--bevel", use: "The chamfer the brand mark is drawn with", added: true, why: "The mark is the Studio's .brand-mark (a 7 px chamfer); the chip's 4 px is BevelSmall." },
  { name: "FontSizeXs", token: "--fs-xs", use: "Eyebrows and chips (display face, capitals)", added: true, why: "The type scale's smallest role; the host bakes it as its fifth font." },
  { name: "FontSizeSmall", token: "--fs-sm", use: "Labels, hints, footers, numbers" },
  { name: "FontSize", token: "--fs-md", use: "Body text. The XF box's text size: unchanged" },
  { name: "FontSizeLarge", token: "--fs-lg", use: "A window's title" },
  { name: "ControlHeight", token: "--control-h", use: "Buttons and fields" },
  { name: "ControlHeightSmall", token: "--control-h-sm", use: "A compact button on a dense row", added: true, why: "The Studio's .btn.small; the CET window's Change... and Reset row." },
  { name: "SectionGap", token: "--sp-6", use: "The gap between cards and between groups", added: true, why: "ItemSpacingY is a row gap; groups need the Studio's stack gap." },
  { name: "ChildPaddingX", token: "--sp-4", use: "A card's padding (the Studio's .state-line)", added: true, why: "A card is tighter than a window." },
  { name: "ChildPaddingY", token: "--sp-3", use: "As above", added: true, why: "As above." },
  { name: "ChipPaddingX", token: "--sp-4", use: "A chip's side padding (.chip)", added: true, why: "Chips are drawn, not widgets; they need their own padding." },
  { name: "ChipPaddingY", token: "--sp-1", use: "A chip's top and bottom padding: with the 11 px display line it is the Studio's 20 px chip", added: true, why: "As above." },
  { name: "BarThin", token: "--sp-3", use: "A bar without text: 6 px, the existing diagnostics bar", added: true, why: "Bars were a literal 6 in Overlay.cpp." },
  { name: "BarLabelled", token: "--sp-6", use: "A bar with its text inside: 16 px", added: true, why: "As above." },
  { name: "ScrollbarSize", token: "--sp-4", use: "A scrollbar's width: the Studio's scrollbars are thin", added: true, why: "ImGui's default 14 px reads as chrome beside the Studio's thin ones." },
];

/** Numbers the Studio sets on a rule, read from it. */
export type RuleValue = { name: string; rule: string; property: string; use: string };
export const IN_GAME_RULE_VALUES: readonly RuleValue[] = [
  { name: "DisabledAlpha", rule: ".btn:disabled", property: "opacity", use: "ImGui's DisabledAlpha: every disabled control and BeginDisabled block" },
  { name: "SweepSeconds", rule: ".progress.indeterminate::after", property: "animation", use: "An indeterminate bar's sweep (the Studio's 1.1 s)" },
];

/**
 * What the in-game surfaces add that the Studio has no number for. Each is a design constant of this spec, with its reason; none is a
 * colour, and none needs a Studio token.
 */
export const IN_GAME_MOTION = {
  /** The live pulse: one cycle of the dot's breathing. Slow enough to be ambient, fast enough to read as alive. */
  pulsePeriodMs: 2400,
  /** The pulse lowers the dot's alpha by up to this much (1 down to 0.6), never its size or colour. */
  pulseDepth: 0.4,
  /** The one-shot after a state change: a wash that fades out, once. */
  settleMs: 600,
  /** The shortest gap between two settles on one element, so a flapping state never reads as a flash. */
  settleGapMs: 2000,
  /** A chip's border is its tone at this alpha (the Studio's color-mix of 50 %). */
  chipBorderAlpha: 0.5,
} as const;

/** The type hierarchy. Each role takes its size from a Studio scale token; the host bakes one font per role, CET scales its one font. */
export type TypeRole = { role: string; face: "ui" | "display" | "mono"; weight: number; token: string; caps: boolean; use: string };
export const IN_GAME_TYPE: readonly TypeRole[] = [
  { role: "title", face: "display", weight: 600, token: "--fs-lg", caps: false, use: "A window's title" },
  { role: "eyebrow", face: "display", weight: 600, token: "--fs-xs", caps: true, use: "A group's label; a chip's text" },
  { role: "body", face: "ui", weight: 400, token: "--fs-md", caps: false, use: "Status, messages, button labels, answers" },
  { role: "label", face: "ui", weight: 400, token: "--fs-sm", caps: false, use: "Key-value labels, hints, notes, the footer" },
  { role: "value", face: "mono", weight: 400, token: "--fs-sm", caps: false, use: "Numbers, keycaps, the diagnostics' figures" },
];

/** CET has one font, the player's. A role is that font times its token over --fs-md, kept inside this range so a bitmap font stays crisp. */
export const CET_SCALE_RANGE = [0.84, 1.25] as const;

/** The Windows font files each face loads, first found first (the host falls back to ImGui's default font). */
export const IN_GAME_FONTS = {
  ui: ["SegUIVar.ttf", "segoeui.ttf"],
  display: ["bahnschrift.ttf"],
  mono: ["CascadiaMono.ttf", "consola.ttf"],
} as const;

export const IN_GAME_THEME = {
  colours: IN_GAME_COLOURS,
  ruleColours: IN_GAME_RULE_COLOURS,
  metrics: IN_GAME_METRICS,
  ruleValues: IN_GAME_RULE_VALUES,
  motion: IN_GAME_MOTION,
  type: IN_GAME_TYPE,
  fonts: IN_GAME_FONTS,
} as const;

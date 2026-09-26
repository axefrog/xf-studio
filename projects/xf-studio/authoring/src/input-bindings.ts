/**
 * Input binding catalogue: the single typed table of every pointer gesture and keyboard
 * shortcut the Studio responds to, per context and exact modifier set, with the action it
 * performs, a short label and (for viewport gestures) a cursor.
 *
 * The UV and on-head gesture adapters, the shell/viewport/tab/row key handlers and the
 * gesture-cancel policy resolve their input through this module, so behaviour cannot drift
 * from what the viewport hint strips, target tooltips, cursors, menu and palette shortcut
 * labels and the Keyboard & mouse dialog derive from it. Pure data and functions: no DOM,
 * no state, no I/O, and no imports: the scene host's camera input builds on it, so it names the
 * application's action and request kinds as plain strings, which tests/input-bindings.test.ts
 * checks against the action registry (CORE-86). See research/authoring/input-bindings.md.
 */

// ---------- Modifiers ----------
export type Modifier = "ctrl" | "alt" | "shift";
export type ModifierKey = "" | "ctrl" | "alt" | "shift" | "ctrl+alt" | "ctrl+shift" | "alt+shift" | "ctrl+alt+shift";
export const MODIFIER_KEYS: readonly ModifierKey[] = ["", "ctrl", "alt", "shift", "ctrl+alt", "ctrl+shift", "alt+shift", "ctrl+alt+shift"];
/** Held modifiers. Cmd/Meta counts as Ctrl, as in every Studio shortcut. */
export type HeldModifiers = Readonly<{ ctrl: boolean; alt: boolean; shift: boolean }>;
export const NO_MODIFIERS: HeldModifiers = Object.freeze({ ctrl: false, alt: false, shift: false });
export type ModifierEvent = { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean };

export function modifiersOf(event: ModifierEvent): HeldModifiers {
  return { ctrl: !!(event.ctrlKey || event.metaKey), alt: !!event.altKey, shift: !!event.shiftKey };
}
export function modifierKey(held: Partial<HeldModifiers>): ModifierKey {
  return (["ctrl", "alt", "shift"] as const).filter(name => held[name]).join("+") as ModifierKey;
}
const MODIFIER_NAMES: Record<Modifier, string> = { ctrl: "Ctrl", alt: "Alt", shift: "Shift" };
export function modifierLabel(key: ModifierKey): string {
  return key ? key.split("+").map(name => MODIFIER_NAMES[name as Modifier]).join("+") : "";
}
/** Every modifier combination: bindings that ignore modifiers (right-drag, context menu). */
const ANY: readonly ModifierKey[] = MODIFIER_KEYS;

// ---------- Actions a binding performs ----------
export type ShellCommand = "palette" | "shortcuts" | "help" | "regions" | "regions-back" | "context-menu" |
  "tour.next" | "tour.back" | "tour.skip" |
  "gesture.cancel" | "gesture.commit" |
  "tab.switch" | "tab.reorder" | "tab.close" | "tab.content" | "tab.float" |
  "row.focus" | "row.reorder" | "row.rename" | "row.remove" | "row.duplicate";
/** The UV viewport's framing commands (viewport-attachment.ts `uvCommand`). */
export type UVViewCommand = "both" | "single" | "other" | "fit";
export type ViewCommandId = `uv.${UVViewCommand}` | "uv.pan" | "uv.zoom";
/**
 * What a binding does. `action` IDs are `StudioAction` kinds and `request` IDs `CollectionRequest` kinds, checked
 * against the action registry in tests (the catalogue imports neither: CORE-86).
 */
export type BindingAction =
  | { kind: "action"; id: string; variant?: string }
  | { kind: "request"; id: string }
  | { kind: "view"; id: ViewCommandId }
  | { kind: "shell"; id: ShellCommand }
  | { kind: "none" };
const act = (id: string, variant?: string): BindingAction => ({ kind: "action", id, ...(variant ? { variant } : {}) });
const view = (id: ViewCommandId): BindingAction => ({ kind: "view", id });
const shell = (id: ShellCommand): BindingAction => ({ kind: "shell", id });
const NONE: BindingAction = { kind: "none" };

// ---------- Viewport pointer bindings ----------
export type ViewportScope = "head" | "uv";
/** What is under the pointer. `empty` is background/skin on the head and empty space in the UV map. */
export type PointerTarget = "point" | "tangent" | "warp-origin" | "warp-vector" | "shape" | "empty";
export const MAKEUP_TARGETS: readonly PointerTarget[] = ["point", "tangent", "warp-origin", "warp-vector", "shape"];
export const HANDLE_TARGETS: readonly PointerTarget[] = ["point", "tangent", "warp-origin", "warp-vector"];
export const ALL_TARGETS: readonly PointerTarget[] = [...MAKEUP_TARGETS, "empty"];
export type PointerInput = "drag" | "wheel" | "double-click" | "right-drag" | "middle-drag" | "two-finger-drag" | "right-click";
/** Inputs a pointer press starts, as `pointerInputOf()` classifies them. */
export const PRESS_INPUTS: readonly PointerInput[] = ["drag", "middle-drag", "right-drag", "two-finger-drag"];
/**
 * The input a pointer press starts: the left button, a pen or the first finger is `drag`; a
 * further finger while one is down is `two-finger-drag`. Other buttons (back/forward) are no input.
 */
export function pointerInputOf(event: { button: number; pointerType?: string; isPrimary?: boolean }): PointerInput | undefined {
  if (event.pointerType === "touch" && event.isPrimary === false) return "two-finger-drag";
  return event.button === 0 ? "drag" : event.button === 1 ? "middle-drag" : event.button === 2 ? "right-drag" : undefined;
}
export type CursorKind = "default" | "grab" | "grabbing" | "move" | "rotate" | "scale" | "pan";
/**
 * The handler an adapter runs. `camera-*` effects are performed by the head renderer's orbit
 * controls, which head-camera-input.ts configures per press so they do exactly this effect
 * whatever modifiers are held (their own default mapping is never used); `none` is consumed and
 * does nothing, as is every unbound input.
 */
export type PointerEffect = "handle-drag" | "shape-translate" | "shape-rotate" | "shape-scale" |
  "camera-orbit" | "camera-pan" | "camera-zoom" | "camera-zoom-pan" | "view-pan" | "view-zoom" | "insert-point" | "context-menu" | "none";
export type PointerBinding = Readonly<{
  id: string; scope: ViewportScope; input: PointerInput; mods: readonly ModifierKey[];
  targets: readonly PointerTarget[]; effect: PointerEffect; action: BindingAction; label: string;
  /** Hover cursor while this is the drag binding under the pointer. */
  cursor?: CursorKind;
  /** Reference-only bindings appear in the dialog and tooltips, not the compact strip. */
  strip?: false;
  /** Fuller wording for the Keyboard & mouse dialog. */
  reference?: string;
}>;

const handleBindings = (scope: ViewportScope): PointerBinding[] => [
  { id: `${scope}.drag.point`, scope, input: "drag", mods: [""], targets: ["point"], effect: "handle-drag", action: act("point.move"), label: "move point", cursor: "grab" },
  { id: `${scope}.drag.tangent`, scope, input: "drag", mods: [""], targets: ["tangent"], effect: "handle-drag", action: act("point.setTangent"), label: "shape curve", cursor: "grab" },
  { id: `${scope}.drag.warp-origin`, scope, input: "drag", mods: [""], targets: ["warp-origin"], effect: "handle-drag", action: act("field.setOrigin"), label: "move warp", cursor: "grab" },
  { id: `${scope}.drag.warp-vector`, scope, input: "drag", mods: [""], targets: ["warp-vector"], effect: "handle-drag", action: act("field.setVector"), label: "set warp pull", cursor: "grab" },
  { id: `${scope}.drag.shape`, scope, input: "drag", mods: [""], targets: ["shape"], effect: "shape-translate", action: act("shape.transform", "translate"), label: "move shape", cursor: "move" },
  // B-17 option (b): Shift always means a shape gesture. Over makeup it rotates or scales about
  // the selected point; off makeup it is consumed and does nothing (no camera pan or zoom).
  { id: `${scope}.shift-drag.makeup`, scope, input: "drag", mods: ["shift"], targets: MAKEUP_TARGETS, effect: "shape-rotate", action: act("shape.transform", "rotate"), label: "rotate shape", cursor: "rotate" },
  { id: `${scope}.shift-drag.empty`, scope, input: "drag", mods: ["shift"], targets: ["empty"], effect: "none", action: NONE, label: "nothing off makeup", reference: `Nothing: Shift is reserved for shape tools${scope === "head" ? ", so the camera never pans" : ""}` },
  { id: `${scope}.shift-wheel.makeup`, scope, input: "wheel", mods: ["shift"], targets: MAKEUP_TARGETS, effect: "shape-scale", action: act("shape.transform", "scale"), label: "scale shape", cursor: "scale" },
  { id: `${scope}.shift-wheel.empty`, scope, input: "wheel", mods: ["shift"], targets: ["empty"], effect: "none", action: NONE, label: "nothing off makeup", reference: `Nothing: Shift is reserved for shape tools${scope === "head" ? ", so the camera never zooms" : ""}` },
];

export const POINTER_BINDINGS: readonly PointerBinding[] = [
  ...handleBindings("head"),
  { id: "head.drag.empty", scope: "head", input: "drag", mods: [""], targets: ["empty"], effect: "camera-orbit", action: act("camera.navigate", "orbit"), label: "orbit view" },
  { id: "head.ctrl-drag", scope: "head", input: "drag", mods: ["ctrl"], targets: ALL_TARGETS, effect: "camera-pan", action: act("camera.navigate", "pan"), label: "pan view", cursor: "pan" },
  { id: "head.alt-drag", scope: "head", input: "drag", mods: ["alt"], targets: ALL_TARGETS, effect: "camera-orbit", action: act("camera.navigate", "orbit"), label: "orbit view" },
  // Ctrl-wheel is also how trackpad pinch arrives.
  { id: "head.wheel", scope: "head", input: "wheel", mods: ["", "ctrl"], targets: ALL_TARGETS, effect: "camera-zoom", action: act("camera.navigate", "dolly"), label: "zoom view" },
  { id: "head.right-drag", scope: "head", input: "right-drag", mods: ANY, targets: ALL_TARGETS, effect: "camera-pan", action: act("camera.navigate", "pan"), label: "pan view" },
  { id: "head.middle-drag", scope: "head", input: "middle-drag", mods: ANY, targets: ALL_TARGETS, effect: "camera-zoom", action: act("camera.navigate", "dolly"), label: "zoom view", strip: false },
  // Touch screens: one finger is `drag` above; two fingers pinch to zoom and move to pan.
  { id: "head.two-finger-drag", scope: "head", input: "two-finger-drag", mods: ANY, targets: ALL_TARGETS, effect: "camera-zoom-pan", action: act("camera.navigate", "dolly"), label: "zoom and pan view", strip: false },
  { id: "head.right-click", scope: "head", input: "right-click", mods: ANY, targets: ALL_TARGETS, effect: "context-menu", action: shell("context-menu"), label: "commands here", strip: false },
  ...handleBindings("uv"),
  { id: "uv.ctrl-drag", scope: "uv", input: "drag", mods: ["ctrl"], targets: ALL_TARGETS, effect: "view-pan", action: view("uv.pan"), label: "pan view", cursor: "pan" },
  { id: "uv.wheel", scope: "uv", input: "wheel", mods: ["", "ctrl"], targets: ALL_TARGETS, effect: "view-zoom", action: view("uv.zoom"), label: "zoom view" },
  { id: "uv.double-click", scope: "uv", input: "double-click", mods: [""], targets: ALL_TARGETS, effect: "insert-point", action: act("point.insert"), label: "add point on nearest outline" },
  { id: "uv.right-drag", scope: "uv", input: "right-drag", mods: ANY, targets: ALL_TARGETS, effect: "view-pan", action: view("uv.pan"), label: "pan view" },
  { id: "uv.right-click", scope: "uv", input: "right-click", mods: ANY, targets: ALL_TARGETS, effect: "context-menu", action: shell("context-menu"), label: "commands here", strip: false },
];

/**
 * Inputs each viewport's adapters resolve through `pointerBinding()`: presses (classified by
 * `pointerInputOf()`), the wheel, double-click (UV) and right-click (the context-menu gate). Every
 * binding and every hint must use one of these; a test checks both, and that the adapters do.
 */
export const ADAPTER_INPUTS: Readonly<Record<ViewportScope, readonly PointerInput[]>> = {
  head: [...PRESS_INPUTS, "wheel", "right-click"],
  uv: [...PRESS_INPUTS, "wheel", "double-click", "right-click"],
};

/** The binding an adapter runs for this input. Unbound inputs do nothing. */
export function pointerBinding(scope: ViewportScope, input: PointerInput, target: PointerTarget, mods: ModifierKey): PointerBinding | undefined {
  return POINTER_BINDINGS.find(binding => binding.scope === scope && binding.input === input &&
    binding.targets.includes(target) && binding.mods.includes(mods));
}

/** Summaries for the "Hold …" discovery hints: what each modifier unlocks in a viewport. */
export const MODIFIER_SUMMARIES: Readonly<Record<ViewportScope, Partial<Record<ModifierKey, string>>>> = {
  head: { shift: "shape tools", ctrl: "pan", alt: "orbit over makeup" },
  uv: { shift: "shape tools", ctrl: "pan" },
};

/** CSS keyword each cursor falls back to; custom SVG cursors live in studio.css under `[data-cursor]`. */
export const CURSOR_FALLBACK: Readonly<Record<CursorKind, string>> = {
  default: "", grab: "grab", grabbing: "grabbing", move: "move", rotate: "grab", scale: "nwse-resize", pan: "all-scroll",
};

// ---------- Gesture phases ----------
export type GestureKind = "handle" | "translate" | "rotate" | "scale" | "pan";
export const GESTURES: Readonly<Record<GestureKind, { label: string; cursor: CursorKind }>> = {
  handle: { label: "Moving handle", cursor: "grabbing" },
  translate: { label: "Moving shape", cursor: "move" },
  rotate: { label: "Rotating shape", cursor: "rotate" },
  scale: { label: "Scaling shape", cursor: "scale" },
  pan: { label: "Panning view", cursor: "pan" },
};
export type GestureBinding = Readonly<{ id: string; input: string; gestures: readonly GestureKind[]; action: BindingAction; label: string }>;
/** Release applies a drag as one Undo entry; a wheel burst closes 250 ms after its last notch. */
export const GESTURE_BINDINGS: readonly GestureBinding[] = [
  { id: "gesture.release", input: "Release", gestures: ["handle", "translate", "rotate"], action: shell("gesture.commit"), label: "apply (one Undo)" },
  { id: "gesture.release-view", input: "Release", gestures: ["pan"], action: shell("gesture.commit"), label: "finish" },
  { id: "gesture.wheel-pause", input: "Pause", gestures: ["scale"], action: shell("gesture.commit"), label: "apply (one Undo)" },
];

/** What a gesture adapter reports: the target under the pointer (undefined outside), its active
 * gesture and whether the active layer can be edited there. */
export type EditorInputState = Readonly<{ target?: PointerTarget; gesture?: GestureKind; editable: boolean }>;

// ---------- Keyboard bindings ----------
/** `any` ignores modifiers entirely (Escape must work while Shift is still held). */
export type KeyChord = Readonly<{ key: string; ctrl?: boolean; alt?: boolean; shift?: boolean; any?: boolean }>;
export type KeyScope = "global" | "gesture" | "head" | "uv" | "tabs" | "rows" | "tour";
export type KeyBinding = Readonly<{
  id: string; scope: KeyScope; chords: readonly KeyChord[]; action: BindingAction; label: string;
  /** Compact label for hint strips, when the reference label is a sentence. */
  short?: string;
  /** Also fires while typing in a text field (default: no). */
  inText?: boolean;
  /** Suppressed while a modal dialog is open (default: no). */
  notInDialogs?: boolean;
  /** Shown in hint strips (viewport keys and gesture cancel). */
  strip?: boolean;
}>;
const k = (key: string, mods: Partial<Omit<KeyChord, "key">> = {}): KeyChord => ({ key, ...mods });

export const KEY_BINDINGS: readonly KeyBinding[] = [
  { id: "shell.palette", scope: "global", chords: [k("k", { ctrl: true }), k("p", { ctrl: true, shift: true })], action: shell("palette"), label: "Command palette — every command, with reasons when unavailable", inText: true },
  { id: "shell.save", scope: "global", chords: [k("s", { ctrl: true })], action: { kind: "request", id: "save" }, label: "Save the collection to the local library", inText: true },
  { id: "shell.undo", scope: "global", chords: [k("z", { ctrl: true })], action: act("history.undo"), label: "Undo the last change (outside text fields)" },
  { id: "shell.redo", scope: "global", chords: [k("z", { ctrl: true, shift: true }), k("y", { ctrl: true })], action: act("history.redo"), label: "Redo the change you just undid" },
  { id: "shell.regions", scope: "global", chords: [k("F6")], action: shell("regions"), label: "Move focus to the next region (header, panel groups, status bar)", inText: true },
  { id: "shell.regions-back", scope: "global", chords: [k("F6", { shift: true })], action: shell("regions-back"), label: "Move focus to the previous region", inText: true },
  { id: "shell.shortcuts", scope: "global", chords: [k("?")], action: shell("shortcuts"), label: "Keyboard & mouse reference", short: "all shortcuts", notInDialogs: true },
  { id: "shell.help", scope: "global", chords: [k("F1")], action: shell("help"), label: "Help: tours, answers and this reference", short: "help", inText: true, notInDialogs: true },
  { id: "gesture.cancel", scope: "gesture", chords: [k("Escape", { any: true }), k("z", { ctrl: true }), k("z", { ctrl: true, shift: true })], action: shell("gesture.cancel"), label: "Cancel the active drag or wheel gesture (works while Shift is held)", short: "cancel", strip: true },
  { id: "head.front", scope: "head", chords: [k("f")], action: act("camera.front"), label: "Front view", short: "front view", strip: true },
  { id: "head.menu", scope: "head", chords: [k("F10", { shift: true }), k("ContextMenu")], action: shell("context-menu"), label: "Commands for the selected point" },
  { id: "uv.both", scope: "uv", chords: [k("1")], action: view("uv.both"), label: "Both eyes" },
  { id: "uv.single", scope: "uv", chords: [k("2")], action: view("uv.single"), label: "Single eye" },
  { id: "uv.other", scope: "uv", chords: [k("o")], action: view("uv.other"), label: "Other eye" },
  { id: "uv.fit", scope: "uv", chords: [k("f")], action: view("uv.fit"), label: "Fit shape", short: "fit shape", strip: true },
  { id: "uv.menu", scope: "uv", chords: [k("F10", { shift: true }), k("ContextMenu")], action: shell("context-menu"), label: "Commands for the selected point" },
  { id: "tabs.switch", scope: "tabs", chords: [k("ArrowLeft"), k("ArrowRight"), k("Home"), k("End")], action: shell("tab.switch"), label: "Switch tabs in the focused tab strip" },
  { id: "tabs.reorder", scope: "tabs", chords: [k("ArrowLeft", { alt: true, shift: true }), k("ArrowRight", { alt: true, shift: true })], action: shell("tab.reorder"), label: "Reorder the focused tab" },
  { id: "tabs.close", scope: "tabs", chords: [k("Delete")], action: shell("tab.close"), label: "Close the focused tab" },
  { id: "tabs.content", scope: "tabs", chords: [k("Enter"), k("ArrowDown")], action: shell("tab.content"), label: "Move focus into the panel" },
  { id: "tabs.menu", scope: "tabs", chords: [k("F10", { shift: true }), k("ContextMenu")], action: shell("context-menu"), label: "Layout commands for the focused tab" },
  { id: "rows.focus", scope: "rows", chords: [k("ArrowUp"), k("ArrowDown"), k("Home"), k("End")], action: shell("row.focus"), label: "Move between rows in Presets, Layers and History" },
  { id: "rows.reorder", scope: "rows", chords: [k("ArrowUp", { alt: true }), k("ArrowDown", { alt: true })], action: shell("row.reorder"), label: "Reorder the focused row" },
  { id: "rows.rename", scope: "rows", chords: [k("F2")], action: shell("row.rename"), label: "Rename the focused row" },
  { id: "rows.remove", scope: "rows", chords: [k("Delete")], action: shell("row.remove"), label: "Remove the focused row" },
  { id: "rows.duplicate", scope: "rows", chords: [k("d", { ctrl: true })], action: shell("row.duplicate"), label: "Duplicate the focused row" },
  { id: "tour.skip", scope: "tour", chords: [k("Escape")], action: shell("tour.skip"), label: "Stop the tour (it can be replayed from Help)" },
  { id: "tour.next", scope: "tour", chords: [k("ArrowRight"), k("Enter")], action: shell("tour.next"), label: "Next step (Enter on a button presses that button)" },
  { id: "tour.back", scope: "tour", chords: [k("ArrowLeft")], action: shell("tour.back"), label: "Previous step" },
  { id: "rows.menu", scope: "rows", chords: [k("F10", { shift: true }), k("ContextMenu")], action: shell("context-menu"), label: "Commands for the focused row" },
];

/** Pointer bindings of the panel system (not viewports), handled by the dock and row components. */
export type PanelPointerBinding = Readonly<{ id: string; scope: "tabs" | "rows"; input: string; mods: ModifierKey; action: BindingAction; label: string }>;
export const PANEL_POINTER_BINDINGS: readonly PanelPointerBinding[] = [
  { id: "tabs.float", scope: "tabs", input: "drag", mods: "ctrl", action: shell("tab.float"), label: "Float the dragged panel freely, without snapping" },
  { id: "tabs.middle-close", scope: "tabs", input: "middle-click", mods: "", action: shell("tab.close"), label: "Close the tab" },
  { id: "rows.rename-click", scope: "rows", input: "double-click", mods: "", action: shell("row.rename"), label: "Rename the row" },
];
export function panelPointerBinding(id: PanelPointerBinding["id"]) {
  const binding = PANEL_POINTER_BINDINGS.find(item => item.id === id);
  if (!binding) throw Error(`Unknown panel pointer binding ${id}`);
  return binding;
}
/** Whether an event's modifiers are exactly those of a panel pointer binding. */
export function panelModifiersHeld(id: PanelPointerBinding["id"], event: ModifierEvent) {
  return modifierKey(modifiersOf(event)) === panelPointerBinding(id).mods;
}

export type KeyEvent = { key: string } & ModifierEvent;
const printable = (key: string) => key.length === 1;
const letter = (key: string) => /^[a-z0-9]$/i.test(key);
export function chordMatches(chord: KeyChord, event: KeyEvent): boolean {
  const key = printable(event.key) ? event.key.toLowerCase() : event.key;
  if (key !== (printable(chord.key) ? chord.key.toLowerCase() : chord.key)) return false;
  if (chord.any) return true;
  const held = modifiersOf(event);
  // Symbols such as "?" need Shift on most layouts; their Shift state is not part of the chord.
  const shiftMatters = !printable(chord.key) || letter(chord.key);
  return held.ctrl === !!chord.ctrl && held.alt === !!chord.alt && (!shiftMatters || held.shift === !!chord.shift);
}
/** The key binding an event triggers in a scope, honouring text-field and dialog rules. */
export function keyBinding(scope: KeyScope, event: KeyEvent, context: { textInput?: boolean; modalOpen?: boolean } = {}): KeyBinding | undefined {
  return KEY_BINDINGS.find(binding => binding.scope === scope && binding.chords.some(chord => chordMatches(chord, event)) &&
    (!context.textInput || binding.inText) && (!context.modalOpen || !binding.notInDialogs));
}
export function keyBindingById(id: string): KeyBinding {
  const binding = KEY_BINDINGS.find(item => item.id === id);
  if (!binding) throw Error(`Unknown key binding ${id}`);
  return binding;
}

const KEY_NAMES: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc", ContextMenu: "Menu", " ": "Space" };
export function chordLabel(chord: KeyChord): string {
  const key = KEY_NAMES[chord.key] ?? (printable(chord.key) ? chord.key.toUpperCase() : chord.key);
  return [chord.ctrl && "Ctrl", chord.alt && "Alt", chord.shift && "Shift", key].filter(Boolean).join("+");
}
/** Menu/palette shortcut text: the first chord, e.g. "Ctrl+Shift+Z". */
export function shortcutLabel(id: string): string {
  return chordLabel(keyBindingById(id).chords[0]);
}
/** Every chord, e.g. "Ctrl+Shift+Z / Ctrl+Y"; arrow-key families are joined compactly. */
export function chordsLabel(binding: KeyBinding): string {
  const labels = binding.chords.map(chordLabel);
  return labels.every(label => label.length <= 4 && !label.includes("+")) ? labels.join(" ") : labels.join(" / ");
}

/** Cancel an active pointer or wheel transaction instead of undoing an earlier edit. */
export function cancelsGesture(event: KeyEvent) {
  return keyBindingById("gesture.cancel").chords.some(chord => chordMatches(chord, event));
}

// ---------- Derived hints ----------
const INPUT_NAMES: Record<PointerInput, string> = { drag: "drag", wheel: "wheel", "double-click": "double-click",
  "right-drag": "right-drag", "middle-drag": "middle-drag", "two-finger-drag": "two-finger drag", "right-click": "right-click" };
/** "Shift-drag", "Wheel", "Ctrl-wheel". */
export function pointerInputLabel(input: PointerInput, mods: ModifierKey = ""): string {
  const name = INPUT_NAMES[input];
  return mods ? `${modifierLabel(mods)}-${name}` : name[0].toUpperCase() + name.slice(1);
}
export const TARGET_LABELS: Readonly<Record<ViewportScope, Record<PointerTarget, string>>> = {
  head: { point: "Contour point", tangent: "Bézier handle", "warp-origin": "Warp position", "warp-vector": "Warp pull", shape: "Shape", empty: "Off makeup" },
  uv: { point: "Contour point", tangent: "Bézier handle", "warp-origin": "Warp position", "warp-vector": "Warp pull", shape: "Shape", empty: "Empty UV space" },
};
export type BlockReason = "no-layer" | "layer-hidden" | "surface-off" | "look-locked";
const BLOCK_NOTES: Record<BlockReason, string> = {
  "no-layer": "Add a layer to edit a shape",
  "look-locked": "This look needs a newer XF Studio · see Layers",
  "layer-hidden": "The selected layer is hidden · show it to edit",
  "surface-off": "Surface controls are off · turn them on to edit on the head",
};
/** Read-only input context a viewport reports, plus what the presentation knows about the layer. */
export type ViewportInputContext = Readonly<{
  scope: ViewportScope;
  /** Undefined while the pointer is outside this viewport; held modifiers are then ignored. */
  target?: PointerTarget;
  gesture?: GestureKind;
  modifiers: HeldModifiers;
  blocked?: BlockReason;
}>;
export type HintItem = Readonly<{ input: string; label: string; ids: readonly string[] }>;
export type ViewportHints = Readonly<{
  scope: ViewportScope; heading: string; held?: string; items: readonly HintItem[];
  /** "Hold Shift: shape tools" discovery, shown only while no modifier is held. */
  hold: readonly HintItem[];
  /** Trailing key hints ("?: all shortcuts"). */
  more: readonly HintItem[];
  note?: string; tone: "idle" | "held" | "gesture";
}>;
const STRIP_INPUTS: readonly PointerInput[] = ["drag", "wheel", "double-click", "right-drag"];
const EDIT_EFFECTS: readonly PointerEffect[] = ["handle-drag", "shape-translate", "shape-rotate", "shape-scale", "insert-point"];
/** Discovery order: the shape-tool modifier first. */
const HOLD_ORDER: readonly ModifierKey[] = ["shift", "ctrl", "alt", "ctrl+shift", "alt+shift", "ctrl+alt", "ctrl+alt+shift"];
const mergeItems = (items: HintItem[]): HintItem[] => {
  const merged: HintItem[] = [];
  for (const item of items) {
    const same = merged.findIndex(other => other.label === item.label);
    if (same < 0) merged.push(item);
    else merged[same] = { input: `${merged[same].input} / ${item.input}`, label: item.label, ids: [...merged[same].ids, ...item.ids] };
  }
  return merged;
};
const keyItem = (id: string): HintItem => { const binding = keyBindingById(id); return { input: chordLabel(binding.chords[0]), label: binding.short ?? binding.label, ids: [id] }; };

/** Blender-style contextual hints, derived only from the catalogue above. */
export function viewportHints(context: ViewportInputContext): ViewportHints {
  const { scope } = context, inside = context.target !== undefined, target = context.target ?? "empty";
  const note = context.blocked ? BLOCK_NOTES[context.blocked] : undefined;
  if (context.gesture) {
    const gesture = GESTURES[context.gesture];
    const items = [...GESTURE_BINDINGS.filter(binding => binding.gestures.includes(context.gesture!))
      .map(binding => ({ input: binding.input, label: binding.label, ids: [binding.id] })), keyItem("gesture.cancel")];
    return { scope, heading: gesture.label, items, hold: [], more: [], tone: "gesture" };
  }
  const mods = inside ? modifierKey(context.modifiers) : "";
  const items = mergeItems(STRIP_INPUTS.flatMap(input => {
    const binding = pointerBinding(scope, input, target, mods);
    return binding && binding.strip !== false ? [{ input: pointerInputLabel(input), label: binding.label, ids: [binding.id] }] : [];
  }));
  const heading = inside ? TARGET_LABELS[scope][target] : scope === "head" ? "Head" : "UV map";
  if (mods) {
    // Esc is offered once a held modifier arms an edit of the makeup under the pointer.
    const armed = MAKEUP_TARGETS.includes(target) && items.some(item => item.ids.some(id => EDIT_EFFECTS.includes(pointerBindingById(id).effect)));
    return { scope, heading, held: modifierLabel(mods), tone: "held", note,
      items: items.length ? [...items, ...(armed ? [keyItem("gesture.cancel")] : [])] : [{ input: "", label: "no action here", ids: [] }],
      hold: [], more: [] };
  }
  const summaries = MODIFIER_SUMMARIES[scope];
  const hold = HOLD_ORDER.filter(key => summaries[key]).map(key =>
    ({ input: modifierLabel(key), label: summaries[key]!, ids: POINTER_BINDINGS.filter(binding => binding.scope === scope &&
      binding.mods !== ANY && binding.mods.includes(key)).map(binding => binding.id) }));
  const keys = KEY_BINDINGS.filter(binding => binding.scope === scope && binding.strip).map(binding => keyItem(binding.id));
  return { scope, heading, items: [...items, ...keys], hold, more: [keyItem("shell.shortcuts")], tone: "idle", note };
}
export function pointerBindingById(id: string): PointerBinding {
  const binding = POINTER_BINDINGS.find(item => item.id === id);
  if (!binding) throw Error(`Unknown pointer binding ${id}`);
  return binding;
}

/** The cursor for the pointer's context: the active gesture's, else the drag binding's under the pointer. */
export function cursorFor(context: ViewportInputContext): CursorKind {
  if (context.gesture) return GESTURES[context.gesture].cursor;
  if (context.target === undefined) return "default";
  return pointerBinding(context.scope, "drag", context.target, modifierKey(context.modifiers))?.cursor ?? "default";
}

/** Tooltip for a hovered makeup target: its name and what each input does with the held modifiers. */
export function targetTip(context: ViewportInputContext): { title: string; lines: HintItem[] } | undefined {
  if (context.gesture || context.target === undefined || context.target === "empty") return;
  const mods = modifierKey(context.modifiers);
  const inputs: readonly PointerInput[] = mods ? ["drag", "wheel", "double-click"] : ["drag", "wheel", "double-click", "right-click"];
  const lines = inputs.flatMap(input => {
    const binding = pointerBinding(context.scope, input, context.target!, mods);
    return binding && binding.effect !== "none" ? [{ input: pointerInputLabel(input, mods), label: binding.label, ids: [binding.id] }] : [];
  });
  if (!mods) {
    const shift = pointerBinding(context.scope, "drag", context.target, "shift");
    if (shift) lines.splice(1, 0, { input: pointerInputLabel("drag", "shift"), label: shift.label, ids: [shift.id] });
  }
  return { title: TARGET_LABELS[context.scope][context.target], lines: mergeItems(lines) };
}

// ---------- Reference (Keyboard & mouse dialog, style guide) ----------
export type ReferenceRow = Readonly<{ input: string; where?: string; label: string; ids: readonly string[] }>;
export type ReferenceSection = Readonly<{ id: string; title: string; detail?: string; rows: readonly ReferenceRow[] }>;
const targetPhrase = (scope: ViewportScope, targets: readonly PointerTarget[]) => {
  const same = (list: readonly PointerTarget[]) => list.length === targets.length && list.every(item => targets.includes(item));
  if (same(ALL_TARGETS)) return undefined;
  if (same(MAKEUP_TARGETS)) return "over makeup";
  if (same(["empty"])) return scope === "head" ? "off makeup" : "on empty space";
  return `on a ${targets.map(target => TARGET_NOUNS[target]).join(" or ")}`;
};
const TARGET_NOUNS: Record<PointerTarget, string> = { point: "contour point", tangent: "Bézier handle", "warp-origin": "warp position",
  "warp-vector": "warp pull", shape: "shape", empty: "empty space" };
const INPUT_ORDER: readonly PointerInput[] = ["drag", "wheel", "double-click", "right-drag", "middle-drag", "two-finger-drag", "right-click"];
const upper = (text: string) => text[0].toUpperCase() + text.slice(1);
function pointerRows(scope: ViewportScope): ReferenceRow[] {
  const order = (binding: PointerBinding) => INPUT_ORDER.indexOf(binding.input) * 10 + (binding.mods === ANY ? 0 : HOLD_ORDER.indexOf(binding.mods[0]) + 1);
  return POINTER_BINDINGS.filter(item => item.scope === scope).map((binding, index) => ({ binding, index }))
    .sort((a, b) => order(a.binding) - order(b.binding) || a.index - b.index).map(({ binding }) => {
      const inputs = binding.mods === ANY ? [pointerInputLabel(binding.input)] : binding.mods.map(mods => pointerInputLabel(binding.input, mods));
      return { input: inputs.join(" / "), where: targetPhrase(scope, binding.targets), label: binding.reference ?? upper(binding.label), ids: [binding.id] };
    });
}
const keyRows = (scope: KeyScope): ReferenceRow[] => KEY_BINDINGS.filter(binding => binding.scope === scope)
  .map(binding => ({ input: chordsLabel(binding), label: upper(binding.label), ids: [binding.id] }));
/** All bindings grouped by context, for the Keyboard & mouse dialog and the style guide. */
export function bindingReference(): ReferenceSection[] {
  return [
    { id: "global", title: "Anywhere", rows: keyRows("global") },
    { id: "head", title: "Head viewport", detail: "Shift always means a shape tool; editing on the head needs Surface controls on.",
      rows: [...pointerRows("head"), ...keyRows("head").map(row => ({ ...row, where: "viewport focused" }))] },
    { id: "uv", title: "UV map", detail: "View changes (zoom, pan, eye modes) are never edits.",
      rows: [...pointerRows("uv"), ...keyRows("uv").map(row => ({ ...row, where: "UV map focused" }))] },
    { id: "gesture", title: "During a drag or Shift-wheel", detail: "Each gesture is one Undo entry; wheel notches within 250 ms share it.",
      rows: [...GESTURE_BINDINGS.map(binding => ({ input: binding.input, where: binding.gestures.map(g => GESTURES[g].label.toLowerCase()).join(", "), label: upper(binding.label), ids: [binding.id] })),
        ...keyRows("gesture")] },
    { id: "tabs", title: "Panel tabs", rows: [...keyRows("tabs"), ...PANEL_POINTER_BINDINGS.filter(binding => binding.scope === "tabs")
      .map(binding => ({ input: pointerPanelLabel(binding), label: binding.label, ids: [binding.id] }))] },
    { id: "rows", title: "Presets and Layers rows", rows: [...keyRows("rows"), ...PANEL_POINTER_BINDINGS.filter(binding => binding.scope === "rows")
      .map(binding => ({ input: pointerPanelLabel(binding), label: binding.label, ids: [binding.id] }))] },
    { id: "tour", title: "During a guided tour", detail: "Arrows and Enter work while the tour's card has focus; Esc also works elsewhere unless something else uses it.",
      rows: keyRows("tour") },
  ];
}
/** The shape-editing subset (same in both viewports) for the Shape inspector's gesture help. */
export function editingReference(): ReferenceRow[] {
  const editing = pointerRows("uv").filter(row => row.ids.some(id => {
    const effect = pointerBindingById(id).effect;
    return EDIT_EFFECTS.includes(effect) || effect === "none" || effect === "context-menu";
  }));
  return [...editing, ...keyRows("gesture")];
}
const pointerPanelLabel = (binding: PanelPointerBinding) => binding.mods ? `${modifierLabel(binding.mods)}-${binding.input}` : upper(binding.input);

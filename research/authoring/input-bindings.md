# Input bindings, hints and cursors

One typed catalogue, [`input-bindings.ts`](../../projects/xf-studio/authoring/src/input-bindings.ts), defines every pointer gesture and keyboard shortcut the Studio responds to. The behaviour, the viewport hint strips, the target tooltips, the cursors, the menu and palette shortcut labels and the Keyboard & mouse dialog all come from it, so none of them can drift from the others. The module is pure data and functions: no DOM, no state and no I/O.

**The table is authoritative.** Every viewport input goes through it, and nothing else decides what an input does:

- Adapters route every input through `pointerBinding()` for the scope, the target under the pointer and the exact modifier set, and run only the bound effect. An unbound input does nothing.
- No library default may act on an input the table did not bind, or act differently from how it is bound. In particular, three's `OrbitControls` never uses its own mouse or touch mapping (see [Head camera](#head-camera)).
- Conformance tests enforce this over every input, modifier set and target, and check that every hint names a binding the adapters consult.

## Catalogue

| Table | Entry | Resolved by |
|---|---|---|
| `POINTER_BINDINGS` | Viewport (`head`/`uv`), input (`drag`, `wheel`, `double-click`, `right-drag`, `middle-drag`, `two-finger-drag`, `right-click`), exact modifier sets, targets, effect, action, label, hover cursor | `pointerBinding()` in both gesture adapters, the head camera adapter and the viewport context-menu gate. `pointerInputOf()` classifies every press, and `ADAPTER_INPUTS` lists the inputs each viewport's adapters consult |
| `KEY_BINDINGS` | Scope (`global`, `gesture`, `head`, `uv`, `tabs`, `rows`), chords, action, label, short hint label, text-field and dialog rules | `keyBinding()` in the shell, viewport panels, dock tabs and item rows; `cancelsGesture()` in both adapters |
| `GESTURE_BINDINGS` | What ends an active gesture (Release, a wheel pause) | Hints during a gesture |
| `KEY_BINDINGS` scope `tour` | Esc (skip), → and Enter (next; Done on the last step) and ← (back) inside a guided tour's card. Esc also stops a tour elsewhere unless a gesture, menu, dialog or text field uses it | `tourKey()` in the guidance overlay and the shell's tour Esc handler |
| `PANEL_POINTER_BINDINGS` | Dock and row pointer modifiers (Ctrl-drag floats a panel freely) | `panelModifiersHeld()` in the dock |
| `MODIFIER_SUMMARIES` | What each modifier unlocks per viewport ("Hold Shift: shape tools") | Hint discovery |

- **Targets.** `point`, `tangent`, `warp-origin`, `warp-vector`, `shape` (the makeup targets) and `empty` (background or skin on the head, empty space in the UV map). When editing is unavailable (no layer, a hidden layer, or Surface controls off), everything resolves as `empty`.
- **Modifiers.** Matching is exact: Ctrl, Alt and Shift, with Cmd/Meta counted as Ctrl. An unbound input does nothing. Bindings that ignore modifiers (right-drag pan, the context menu) list every combination.
- **Actions.** Each binding names a real action (`StudioAction` kind and variant, a collection request, a UV view command or a shell command), or `none` for a consumed no-op. A test checks every reference against the action registry.
- **Inputs.** `pointerInputOf()` classifies a press the same way in both viewports: the left button, a pen or a first finger is `drag`, the middle button `middle-drag`, the right button `right-drag`, and a further finger while one is down `two-finger-drag`. Other buttons are no input.
- **Effects.** The effect is the handler an adapter runs. On the head, `camera-*` effects (`camera-orbit`, `camera-pan`, `camera-zoom`, and `camera-zoom-pan` for two fingers) are performed by three's orbit controls, configured per press by the head camera adapter.

## Head camera

[`head-camera-input.ts`](../../projects/xf-studio/authoring/src/head-camera-input.ts) makes the table, not `OrbitControls`, decide what every press does to the head camera. It is attached in `scene.ts` right after the controls are created.

- **Why.** In three 0.186, `OrbitControls` swaps rotate and pan while Ctrl, Meta or Shift is held (`onMouseDown`, `examples/jsm/controls/OrbitControls.js` lines 1686 to 1728). Left to its defaults, Ctrl- or Shift-right-drag orbited while the hint strip said right-drag pans.
- **Mechanism.** On every `pointerdown`, in the capture phase before the controls see it, the adapter:
  1. classifies the press with `pointerInputOf()`;
  2. resolves the binding for the target under the pointer (the surface editor supplies its target resolution once mounted) and the exact modifiers;
  3. sets the one public slot the controls will read (`mouseButtons.LEFT/MIDDLE/RIGHT` or `touches.ONE/TWO`) to the value that yields that effect with those modifiers held. `orbitMouseAction()` holds the swap rule in one place.

  A press that is not a camera effect, or is unbound, gets `null`, which the controls treat as no action. Between presses every slot rests at `null` (restored once every pointer is up or cancelled), so no input can reach the library's default mapping.
- **Editing.** The surface editor handles only `drag` presses. It consumes those that edit makeup, and Shift or unbound drags, before the controls see them.
- **Wheel.** The surface editor resolves every wheel and consumes each one whose binding is not `camera-zoom`. The controls' wheel handling has no modifier rule that changes the effect; Ctrl only scales trackpad-pinch deltas.
- **Touch.** One finger follows the `drag` bindings: it orbits off makeup and pans with Ctrl, as the mouse does. A second finger joins a gesture the first finger gave to the camera, and zooms and pans (`head.two-finger-drag`). While the first finger is editing makeup, or its press was consumed (Shift off makeup), a second finger does nothing.
- **Upgrades.** `tests/head-camera-input.test.ts` pins the swap rule to the exact 0.186 source lines, so an upgrade that changes it fails there.

## Shift policy (B-17, option b)

Shift always means a shape gesture:

- Shift-drag over makeup (a shape or any of its handles) rotates the active shape about the selected point.
- Shift-wheel over makeup scales it about that point.
- Off makeup, Shift-drag and Shift-wheel are consumed and do nothing. They never pan or zoom the camera, including while Surface controls are off.

The UV map follows the same rule, and it now also pans with Ctrl-drag, matching the head. The [shape gesture contract](shape-gesture-contract.md) keeps the transform semantics.

## Viewport input context

Each gesture adapter reports `EditorInputState {target?, gesture?, editable}` through an optional `input` hook. It reports on hover changes, on pointer leave, when a gesture starts or ends, and after a release (so the report reflects the geometry that has just moved). The browser viewport device forwards these reports to `ViewportAttachment.reportInput`.

The device also tracks held modifiers. It reads them from `keydown`, `keyup`, `pointermove` and `pointerdown`, which resyncs after a key was released elsewhere. Window `blur`, or a page that becomes hidden, reports no modifiers, so no key can stay stuck.

The presentation reads the combined read-only snapshot through `port.viewport.input()` and `port.viewport.subscribeInput()`. This channel is separate from `subscribe()`, so a hover or modifier change repaints only the hint strips and cursors, never every panel.

## Derived presentation

- **Hint strip.** `viewportHints(context)` returns the strip for each viewport:
  - What drag, wheel, double-click and right-drag do on the target under the pointer.
  - The viewport's keys and a "Hold Shift · Ctrl · Alt" discovery group.
  - `?` for the full reference.
  - While a modifier is held, the bindings for that exact set. Esc is added once the modifier arms an edit of the makeup under the pointer.
  - During a gesture, its name with Release or Pause and Esc.
  - A note when editing is blocked.

  Held modifiers are ignored while the pointer is outside that viewport.

  The strip is an overlay on the viewport stage and never takes layout space; it is clamped to two rows, so a hint change can never resize a canvas (see the [UV viewport](editor-invariants.md#uv-viewport) invariants).
- **Tooltip.** `targetTip(context)` names a hovered makeup target and lists its bindings for the held modifiers. It appears after 450 ms of dwell.
- **Cursor.** `cursorFor(context)` returns the active gesture's cursor, or otherwise the cursor of the drag binding under the pointer. The presentation sets it as `data-cursor` on the viewport slot, and `studio.css` renders it. Rotate and scale are SVG cursors: white glyphs with a dark halo, hotspot at the centre, falling back to the `CURSOR_FALLBACK` keywords (grab and nwse-resize). The scene clears the orbit controls' inline cursor, so the CSS applies.
- **Preference.** `UIPreferences.inputHints` is on by default and persisted with the workspace. `inputHints.set` toggles it from View preferences, the palette or the Keyboard & mouse dialog. It hides the strip and tooltips; cursors stay.
- **Reference and labels.** `bindingReference()` groups every binding by context for the Keyboard & mouse dialog, the Help panel's searchable reference (`helpReference()`; F1 opens it through `shell.help`) and the style guide's keyboard map. `shortcutLabel()` supplies the menu, palette and header-button shortcut text. The viewports' accessible names are generated from their key bindings.

## Fixes found while wiring this

- **Head gestures stopped after one step.** The detached `AuthoringGeometry` view syncs lazily on read, so the head adapter recorded its expected layer before the view caught up. The next validity check then treated the adapter's own edit as a stale context and ended the gesture. The adapter now reads the layer back before recording. The main checkout reproduces this with an isolated CDP drag. A regression test models the lazy view.
- **Shift-wheel scaling ignored real mice.** Chromium (and WebView2) on Windows and Linux delivers Shift+wheel as horizontal scroll, so the notch arrives in `deltaX`. `shiftWheelDelta()` takes the dominant axis.
- **An open wheel burst ended early.** A burst could stop when the shape shrank away from the pointer. It now keeps scaling while Shift stays held.

## Verification

- `tests/input-bindings.test.ts`:
  - Every binding references a real action and has a label.
  - Every global key binding has a shell handler.
  - Pointer resolution is unambiguous.
  - The B-17 policy holds.
  - Across every context, target, modifier set, gesture and block state, every hint and tooltip line names a real binding with the same label, and every binding appears in a hint or the reference.
  - Every cursor has a CSS rule with its fallback.
- `tests/input-adapters.test.ts` drives both adapters: consumed Shift off makeup, pass-through camera modifiers, UV Ctrl-drag pan, Chromium horizontal Shift-wheel, burst continuation, the lazy-geometry regression, input reports and the attachment's deduplicated channel.
- `tests/head-camera-input.test.ts` is the conformance suite:
  - It pins three 0.186's `OrbitControls` swap rule to its source lines.
  - It drives the real `OrbitControls` through the surface editor and the camera adapter for every mouse button, one and two fingers, every modifier set, and empty space, a shape and a contour point. The camera must orbit, pan, zoom or stay still exactly as the table says.
  - It checks that every head camera binding can be expressed in the controls.
  - It checks that the UV editor pans exactly when the table says so, for every press.
  - It checks that every hint the strip or a tooltip can show names a binding whose input the adapters consult, and that the adapter sources resolve those inputs through the catalogue.
- An isolated `?verify=1` session in the desktop app's browser pane drove the live head with synthetic pointer and wheel events. It covered left, middle and right drags with no modifier, Ctrl, Shift, Alt, Meta, Ctrl+Shift and Ctrl+Alt, off makeup and over a shape and a contour point. Every result matched the table. Right-drag panned with every modifier set; left orbited, Ctrl-left panned, Alt-left orbited over makeup, and Shift-left or Ctrl+Alt-left did nothing. The wheel zoomed with no modifier or Ctrl, and did nothing with Shift or Alt off makeup. The Shift and Ctrl hint strips matched. Touch was covered by the automated suite only.
- An isolated `?verify=1` CDP session (headless Chrome, throwaway data) checked the live hints for the default state, Shift over makeup, Shift off makeup and during rotate and scale. It also checked the cursors, the blur reset, the preference and the dialog. It confirmed that a Shift-drag off makeup leaves the camera unchanged. Screenshots stay in the ignored `evidence/screenshots/input-hints/`.

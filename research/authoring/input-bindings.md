# Input bindings, hints and cursors

One typed catalogue, [`input-bindings.ts`](../../projects/xf-studio/authoring/src/input-bindings.ts), defines every pointer gesture and keyboard shortcut the Studio responds to. The behaviour, the viewport hint strips, the target tooltips, the cursors, the menu and palette shortcut labels and the Keyboard & mouse dialog all come from it, so none of them can drift from the others. The module is pure data and functions: no DOM, no state and no I/O.

## Catalogue

| Table | Entry | Resolved by |
|---|---|---|
| `POINTER_BINDINGS` | Viewport (`head`/`uv`), input (`drag`, `wheel`, `double-click`, `right-drag`, `middle-drag`, `right-click`), exact modifier sets, targets, effect, action, label, hover cursor | `pointerBinding()` in both gesture adapters and the viewport context-menu gate |
| `KEY_BINDINGS` | Scope (`global`, `gesture`, `head`, `uv`, `tabs`, `rows`), chords, action, label, short hint label, text-field and dialog rules | `keyBinding()` in the shell, viewport panels, dock tabs and item rows; `cancelsGesture()` in both adapters |
| `GESTURE_BINDINGS` | What ends an active gesture (Release, a wheel pause) | Hints during a gesture |
| `PANEL_POINTER_BINDINGS` | Dock and row pointer modifiers (Ctrl-drag floats a panel freely) | `panelModifiersHeld()` in the dock |
| `MODIFIER_SUMMARIES` | What each modifier unlocks per viewport ("Hold Shift: shape tools") | Hint discovery |

- **Targets.** `point`, `tangent`, `warp-origin`, `warp-vector`, `shape` (the makeup targets) and `empty` (background or skin on the head, empty space in the UV map). When editing is unavailable (no layer, a hidden layer, or Surface controls off), everything resolves as `empty`.
- **Modifiers.** Matching is exact: Ctrl, Alt and Shift, with Cmd/Meta counted as Ctrl. An unbound input does nothing. Bindings that ignore modifiers (right-drag pan, the context menu) list every combination.
- **Actions.** Each binding names a real action (`StudioAction` kind and variant, a collection request, a UV view command or a shell command), or `none` for a consumed no-op. A test checks every reference against the action registry.
- **Effects.** The effect is the handler an adapter runs. On the head, `camera-*` effects are left to Three's orbit controls. Their default mapping is left orbit, Ctrl-left or right pan, and wheel or middle dolly. The adapter lets an event through only when the catalogue says so, so those controls never see a Shift gesture or an unbound combination.

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
- **Tooltip.** `targetTip(context)` names a hovered makeup target and lists its bindings for the held modifiers. It appears after 450 ms of dwell.
- **Cursor.** `cursorFor(context)` returns the active gesture's cursor, or otherwise the cursor of the drag binding under the pointer. The presentation sets it as `data-cursor` on the viewport slot, and `studio.css` renders it. Rotate and scale are SVG cursors: white glyphs with a dark halo, hotspot at the centre, falling back to the `CURSOR_FALLBACK` keywords (grab and nwse-resize). The scene clears the orbit controls' inline cursor, so the CSS applies.
- **Legacy shell.** The legacy shell, which has no `input` hook, sets the fallback keyword itself from the same catalogue.
- **Preference.** `UIPreferences.inputHints` is on by default and persisted with the workspace. `inputHints.set` toggles it from View preferences, the palette or the Keyboard & mouse dialog. It hides the strip and tooltips; cursors stay.
- **Reference and labels.** `bindingReference()` groups every binding by context for the Keyboard & mouse dialog and the style guide's keyboard map. `shortcutLabel()` supplies the menu, palette and header-button shortcut text. The viewports' accessible names are generated from their key bindings.

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
- An isolated `?verify=1` CDP session (headless Chrome, throwaway data) checked the live hints for the default state, Shift over makeup, Shift off makeup and during rotate and scale. It also checked the cursors, the blur reset, the preference and the dialog. It confirmed that a Shift-drag off makeup leaves the camera unchanged. Screenshots stay in the ignored `evidence/screenshots/input-hints/`.

/**
 * Keyboard policy shared by the UV and on-head editors: Escape (with any modifiers still
 * held), or Ctrl/Cmd+Z in either letter case, cancels the active pointer or wheel
 * transaction instead of undoing an earlier edit. The chords live in the input binding
 * catalogue (`gesture.cancel`), so hints and the Keyboard & mouse dialog show the same keys.
 */
export { cancelsGesture } from "./input-bindings";

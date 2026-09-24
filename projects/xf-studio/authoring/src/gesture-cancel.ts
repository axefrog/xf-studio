/**
 * Keyboard policy shared by the UV and on-head editors: Escape, or Ctrl/Cmd+Z in
 * either letter case (Caps Lock, Shift or a layout may report "Z"), cancels the
 * active pointer or wheel transaction instead of undoing an earlier edit.
 */
export function cancelsGesture(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey">) {
  return event.key === "Escape" || (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z";
}

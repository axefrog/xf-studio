/**
 * Global Studio keyboard shortcuts as a pure decision, so the shell's key handler and its
 * tests share one rule. Letter keys are compared case-insensitively (Caps Lock and Shift
 * report "Z"); Undo/Redo never act inside text inputs, where native text editing wins.
 */
export type StudioShortcut = "palette" | "save" | "undo" | "redo" | "regions" | "regions-back" | "help";
export type ShortcutKey = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };

export function studioShortcut(event: ShortcutKey, context: { textInput: boolean; modalOpen: boolean }): StudioShortcut | undefined {
  const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
  if (mod && (key === "k" || event.shiftKey && key === "p")) return "palette";
  if (mod && key === "s") return "save";
  if (mod && !context.textInput && (key === "y" && !event.shiftKey || key === "z" && event.shiftKey)) return "redo";
  if (mod && !context.textInput && key === "z") return "undo";
  if (event.key === "F6") return event.shiftKey ? "regions-back" : "regions";
  if (event.key === "?" && !mod && !context.textInput && !context.modalOpen) return "help";
}

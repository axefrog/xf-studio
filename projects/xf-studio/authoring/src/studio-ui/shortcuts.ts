import { keyBinding, type KeyEvent } from "../input-bindings";

/**
 * Global Studio keyboard shortcuts as a pure decision, so the shell's key handler and its
 * tests share one rule. The chords and their text-field/dialog rules come from the input
 * binding catalogue, which also labels menus, the palette and the Keyboard & mouse dialog.
 * Letter keys are compared case-insensitively (Caps Lock and Shift report "Z"); Undo/Redo
 * never act inside text inputs, where native text editing wins.
 */
export type StudioShortcut = "palette" | "save" | "undo" | "redo" | "regions" | "regions-back" | "help";
export type ShortcutKey = KeyEvent;

const COMMANDS: Record<string, StudioShortcut> = {
  "shell.palette": "palette", "shell.save": "save", "shell.undo": "undo", "shell.redo": "redo",
  "shell.regions": "regions", "shell.regions-back": "regions-back", "shell.shortcuts": "help",
};

export function studioShortcut(event: ShortcutKey, context: { textInput: boolean; modalOpen: boolean }): StudioShortcut | undefined {
  const binding = keyBinding("global", event, context);
  return binding ? COMMANDS[binding.id] : undefined;
}
/** Binding IDs the shell handles; a test checks every global key binding is one of them. */
export const SHELL_KEY_BINDINGS = Object.keys(COMMANDS);

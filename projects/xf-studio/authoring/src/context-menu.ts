const textInputTypes = new Set([
  "text", "search", "email", "url", "tel", "password", "number",
]);

/** Retain native text editing/selection menus, including nested editable content. */
export function allowsNativeTextMenu(event: MouseEvent): boolean {
  // The composed path also identifies the original control inside an open shadow root.
  const target = event.composedPath().find(node => node instanceof HTMLElement);
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const control = target.closest("input, textarea");
  return control instanceof HTMLTextAreaElement ||
    (control instanceof HTMLInputElement && textInputTypes.has(control.type));
}

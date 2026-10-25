import { h, isUnavailable } from "../dom";

/** The documented c-link-buttons pattern for a command inside reading text. */
export function linkButton(options: { label: string; onClick(): void }): HTMLButtonElement {
  const control = h("button", { type: "button", class: "link-button", text: options.label,
    onclick: () => { if (!isUnavailable(control)) options.onClick(); } });
  return control;
}
/** Escaped static counterpart for the self-contained style guide. */
export function linkButtonMarkup(label: string): string {
  const text = label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<button type="button" class="link-button">${text}</button>`;
}

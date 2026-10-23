import { setUnavailable } from "./dom";

/**
 * A read-only page's panels (style guide t-read-only-window): every editing control shows as unavailable, with the lease's refusal as
 * its reason, through the unavailable-command pattern (`setUnavailable`, reason tips). What the port still allows stays available:
 * - controls whose port capability, recorded with `capabilityScope` (controls.ts), says they are available while read-only (Settings'
 *   theme and input preferences, diagnostic mode, Report a problem);
 * - controls that only change this page's own view (`data-read-safe`, and expanders, help tips, tabs, links and search fields).
 * Form fields that edit by themselves are disabled too, so nothing changes on screen that the application would refuse.
 */
const EDITING_CONTROLS = ["button", "input", "select", "textarea", "[role=slider]", "[role=radio]", "[role=option]", "[role=switch]", "[role=checkbox]"];
const READ_SAFE = ".expander, .help-tip, [role=tab], a, [type=search]";
const KEEP = "[data-read-safe], [data-capability=allowed]";

export function markReadOnly(element: HTMLElement, reason: string) {
  const controls = new Set<HTMLElement>();
  for (const selector of EDITING_CONTROLS) for (const control of element.querySelectorAll<HTMLElement>(selector)) controls.add(control);
  for (const control of controls) {
    if (control.matches(READ_SAFE) || control.closest(KEEP)) continue;
    if (/^(input|select|textarea)$/i.test(control.tagName)) {
      const field = control as HTMLInputElement;
      if (!field.disabled) field.disabled = true;
      if (field.getAttribute("title") !== reason) field.setAttribute("title", reason);
    } else setUnavailable(control, true, reason);
  }
}

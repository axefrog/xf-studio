import { clamp, h } from "./dom";

/**
 * The visible reason of an unavailable main action (UI-84, the menu pattern): a control marked by `setUnavailable`
 * (`aria-disabled="true"` with `data-reason`) stays focusable, and this one tip shows its reason when it gets keyboard
 * focus, when the pointer rests on it, or when it is tapped or clicked. A click on such a control runs nothing: the tip is
 * its answer. Screen readers hear the same reason as the control's description. Menu and palette entries show their
 * reasons inline and are left alone.
 */
const SELECTOR = "button[aria-disabled=\"true\"][data-reason], [role=button][aria-disabled=\"true\"][data-reason]";
let installed: Document | undefined;

export function installReasonTips(doc: Document = document) {
  if (installed === doc) return;
  installed = doc;
  const tip = h("div", { class: "reason-tip", role: "tooltip", hidden: true });
  doc.body.append(tip);
  let shownFor: HTMLElement | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const target = (event: Event) => (event.target instanceof Element ? event.target.closest<HTMLElement>(SELECTOR) : null) ?? undefined;
  const hide = () => { clearTimeout(timer); shownFor = undefined; tip.hidden = true; };
  const show = (control: HTMLElement, linger = false) => {
    clearTimeout(timer);
    shownFor = control;
    tip.textContent = control.dataset.reason ?? "";
    // Inside a modal dialog the tip joins it, so it shows above the dialog's backdrop.
    const host = control.closest("dialog") ?? doc.body;
    if (tip.parentElement !== host) host.append(tip);
    tip.hidden = false;
    const box = control.getBoundingClientRect(), own = tip.getBoundingClientRect(), margin = 6;
    const below = box.bottom + margin + own.height <= innerHeight - margin;
    tip.style.left = `${clamp(box.left, margin, Math.max(margin, innerWidth - own.width - margin))}px`;
    tip.style.top = `${below ? box.bottom + margin : Math.max(margin, box.top - own.height - margin)}px`;
    if (linger) timer = setTimeout(hide, 4000);
  };
  // Capture: runs before the control's own handler, so an unavailable action never runs.
  doc.addEventListener("click", event => {
    const control = target(event);
    if (!control) return;
    event.preventDefault(); event.stopImmediatePropagation();
    show(control, true);
  }, true);
  doc.addEventListener("focusin", event => { const control = target(event); if (control) show(control); else if (shownFor) hide(); });
  doc.addEventListener("focusout", event => { if (event.target === shownFor) hide(); });
  doc.addEventListener("pointerover", event => { const control = target(event); if (control && control !== shownFor) show(control); });
  doc.addEventListener("pointerout", event => { if (shownFor && event.target instanceof Node && shownFor.contains(event.target) &&
    !(event.relatedTarget instanceof Node && shownFor.contains(event.relatedTarget)) && doc.activeElement !== shownFor) hide(); });
  doc.addEventListener("keydown", event => { if (event.key === "Escape" && shownFor) hide(); });
  doc.addEventListener("scroll", () => { if (shownFor) hide(); }, true);
}

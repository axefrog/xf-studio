import { h, setAttr } from "../dom";

/**
 * Progress bar (style guide "Progress and readiness"): a thin bar for work that is running. Determinate with a fraction (0–1), or
 * indeterminate (a sweep) when the work can't say how far it is. Always `role="progressbar"`, named by `label` or by the element
 * `labelledBy` points at, with `aria-valuenow` while determinate. Pair it with a plain line saying what is happening; a bar alone
 * never explains itself. Hiding it keeps nothing in place: an owner that must not move the layout reserves the room (UI-90).
 */
export type ProgressBar = { element: HTMLElement; set(fraction: number | null): void };
export function progressBar(options: { label?: string; labelledBy?: string; id?: string; className?: string; fraction?: number | null } = {}): ProgressBar {
  const fill = h("span", { class: "progress-fill" });
  const element = h("div", { class: `progress${options.className ? ` ${options.className}` : ""}`, id: options.id, role: "progressbar",
    "aria-label": options.labelledBy ? undefined : options.label ?? "Working", "aria-labelledby": options.labelledBy,
    "aria-valuemin": "0", "aria-valuemax": "100" }, fill);
  const set = (fraction: number | null) => {
    element.classList.toggle("indeterminate", fraction === null);
    fill.style.width = fraction === null ? "" : `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    setAttr(element, "aria-valuenow", fraction === null ? undefined : String(Math.round(Math.max(0, Math.min(1, fraction)) * 100)));
  };
  set(options.fraction ?? null);
  return { element, set };
}

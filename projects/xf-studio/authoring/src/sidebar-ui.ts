export type SidebarWidths = { sidebarLeft: number; sidebarRight: number };
const defaults: SidebarWidths = { sidebarLeft: 260, sidebarRight: 350 };
const minimum = { sidebarLeft: 220, sidebarRight: 280 };
const viewportMinimum = 320, handles = 16;

/** Presentation-only layout; keep preferred widths when a smaller window temporarily constrains them. */
export function setupSidebars(initial: SidebarWidths, changed: () => void) {
  const main = document.querySelector<HTMLElement>("main")!;
  const preferred = { ...initial };
  let actual = { ...preferred };
  const controls = (["sidebarLeft", "sidebarRight"] as const).map((key, i) => ({
    key, direction: i ? -1 : 1,
    handle: document.getElementById(i ? "resize-properties" : "resize-layers")!,
  }));
  function maxFor(key: keyof SidebarWidths) {
    const other = key === "sidebarLeft" ? "sidebarRight" : "sidebarLeft";
    return Math.max(minimum[key], main.clientWidth - handles - viewportMinimum - minimum[other]);
  }
  function paint() {
    actual = { ...preferred };
    const excess = Math.max(0, actual.sidebarLeft + actual.sidebarRight + viewportMinimum + handles - main.clientWidth);
    const flexible = actual.sidebarLeft - minimum.sidebarLeft + actual.sidebarRight - minimum.sidebarRight;
    if (excess && flexible > 0) for (const { key } of controls)
      actual[key] -= Math.min(1, excess / flexible) * (actual[key] - minimum[key]);
    main.style.setProperty("--sidebar-left", `${actual.sidebarLeft}px`);
    main.style.setProperty("--sidebar-right", `${actual.sidebarRight}px`);
    for (const { key, handle } of controls) {
      handle.setAttribute("aria-valuemin", String(minimum[key]));
      handle.setAttribute("aria-valuemax", String(Math.round(maxFor(key))));
      handle.setAttribute("aria-valuenow", String(Math.round(actual[key])));
      handle.setAttribute("aria-valuetext", `${Math.round(actual[key])} pixels`);
    }
  }
  for (const { key, direction, handle } of controls) {
    let drag: { pointer: number; x: number; width: number; original: SidebarWidths } | undefined;
    function resize(width: number) {
      const other = key === "sidebarLeft" ? "sidebarRight" : "sidebarLeft";
      preferred[key] = Math.round(Math.max(minimum[key], Math.min(maxFor(key), width)));
      // Give the edited panel the requested space, shrinking the opposite panel
      // only when necessary. Window resizing still preserves preferred widths.
      preferred[other] = Math.max(minimum[other], Math.min(actual[other],
        main.clientWidth - handles - viewportMinimum - preferred[key]));
      paint(); changed();
    }
    function stop(cancel = false) {
      if (!drag) return;
      const previous = drag; drag = undefined;
      if (cancel) { Object.assign(preferred, previous.original); paint(); changed(); }
      if (handle.hasPointerCapture(previous.pointer)) handle.releasePointerCapture(previous.pointer);
      document.body.classList.remove("resizing-sidebar");
    }
    handle.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      e.preventDefault(); handle.focus();
      drag = { pointer: e.pointerId, x: e.clientX, width: actual[key], original: { ...preferred } };
      handle.setPointerCapture(e.pointerId); document.body.classList.add("resizing-sidebar");
    });
    handle.addEventListener("pointermove", e => {
      if (drag?.pointer === e.pointerId) resize(drag.width + (e.clientX - drag.x) * direction);
    });
    handle.addEventListener("pointerup", () => stop());
    handle.addEventListener("pointercancel", () => stop(true));
    handle.addEventListener("lostpointercapture", () => stop());
    handle.addEventListener("dblclick", () => resize(defaults[key]));
    handle.addEventListener("keydown", e => {
      if (e.key === "Escape") { stop(true); return; }
      const step = e.shiftKey ? 40 : 10;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault(); resize(actual[key] + (e.key === "ArrowRight" ? step : -step) * direction);
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault(); resize(e.key === "Home" ? minimum[key] : maxFor(key));
      }
    });
  }
  new ResizeObserver(paint).observe(main);
  paint();
  return { snapshot: () => ({ ...preferred }) };
}

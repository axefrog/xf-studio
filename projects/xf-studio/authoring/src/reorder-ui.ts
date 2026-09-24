/** Pointer drag with visible insertion marker, floating label, edge scrolling and Escape cancellation. */
export function reorderHandle(handle: HTMLElement, row: HTMLElement, host: HTMLElement,
  selector: string, label: string | (() => string), moveTo: (target: HTMLElement) => void) {
  let drag: { pointer: number; y: number; x: number; startY: number; target?: HTMLElement; ghost: HTMLElement; frame: number } | undefined;
  function clear() {
    if (!drag) return;
    const old = drag; drag = undefined; cancelAnimationFrame(old.frame); old.ghost.remove();
    old.target?.classList.remove("drop-before", "drop-after"); row.classList.remove("dragging");
    if (handle.hasPointerCapture(old.pointer)) handle.releasePointerCapture(old.pointer);
  }
  function locate() {
    if (!drag) return;
    drag.target?.classList.remove("drop-before", "drop-after"); drag.target = undefined;
    const target = document.elementFromPoint(drag.x, drag.y)?.closest<HTMLElement>(selector);
    if (target && host.contains(target) && target !== row && Math.abs(drag.y - drag.startY) >= 4) {
      const rows = [...host.querySelectorAll<HTMLElement>(selector)];
      drag.target = target; target.classList.add(rows.indexOf(row) < rows.indexOf(target) ? "drop-after" : "drop-before");
    }
    drag.ghost.style.left = `${drag.x + 12}px`; drag.ghost.style.top = `${drag.y + 12}px`;
  }
  function tick() {
    if (!drag) return;
    const pane = host.closest("aside")!, bounds = pane.getBoundingClientRect();
    if (drag.x >= bounds.left && drag.x <= bounds.right) {
      if (drag.y < bounds.top + 32) pane.scrollTop -= 10;
      else if (drag.y > bounds.bottom - 32) pane.scrollTop += 10;
    }
    locate();
    drag.frame = requestAnimationFrame(tick);
  }
  handle.onpointerdown = e => {
    if (e.button !== 0) return;
    e.preventDefault(); handle.focus(); handle.setPointerCapture(e.pointerId);
    const ghost = document.createElement("div"); ghost.className = "reorder-ghost"; ghost.textContent = `Move ${typeof label === "string" ? label : label()}`;
    document.body.append(ghost); row.classList.add("dragging");
    drag = { pointer: e.pointerId, x: e.clientX, y: e.clientY, startY: e.clientY, ghost, frame: 0 }; tick();
  };
  handle.onpointermove = e => { if (drag?.pointer === e.pointerId) { drag.x = e.clientX; drag.y = e.clientY; } };
  handle.onpointerup = e => {
    if (drag?.pointer !== e.pointerId) return;
    drag.x = e.clientX; drag.y = e.clientY; locate();
    const target = drag.target; clear(); if (target) moveTo(target);
  };
  handle.onpointercancel = handle.onlostpointercapture = clear;
  handle.onkeydown = e => { if (e.key === "Escape") { e.preventDefault(); clear(); } };
}

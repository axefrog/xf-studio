/** Live behaviour for the self-contained style guide. Uses the production presentation modules. */
import { openPalette } from "../commands";
import { Slider, Toggle } from "../controls";
import { DockView } from "../dock/dock-view";
import { group, split, type DockTree } from "../dock/layout";
import { previewRect, resolveDrop, type DropGeometry, type TargetGroup } from "../dock/snap";
import { h } from "../dom";
import { Feedback } from "../feedback";
import { icon } from "../icons";
import { openMenu, openValuePopover } from "../menu";

const root = document.documentElement;
const live = document.getElementById("guide-live")!;
const announce = (text: string) => { live.textContent = ""; requestAnimationFrame(() => { live.textContent = text; }); };

// ---- Theme and side-by-side comparison ----
function setTheme(choice: string) {
  if (choice === "system") { delete root.dataset.theme; root.style.colorScheme = ""; }
  else { root.dataset.theme = choice; root.style.colorScheme = choice; }
  for (const button of document.querySelectorAll<HTMLElement>("[data-theme-choice]")) button.setAttribute("aria-pressed", String(button.dataset.themeChoice === choice));
  announce(`Guide theme: ${choice}`);
}
for (const button of document.querySelectorAll<HTMLElement>("[data-theme-choice]")) button.addEventListener("click", () => setTheme(button.dataset.themeChoice!));
const originals = new Map<Element, string>();
document.getElementById("compare-themes")!.addEventListener("change", event => {
  const on = (event.target as HTMLInputElement).checked;
  for (const specimen of document.querySelectorAll<HTMLElement>(".specimen[data-compare]")) {
    if (on) {
      originals.set(specimen, specimen.innerHTML);
      const content = specimen.innerHTML;
      specimen.classList.add("compare");
      specimen.innerHTML = `<div class="pane" data-label="Light" style="color-scheme:light">${content}</div><div class="pane" data-label="Dark" style="color-scheme:dark">${content}</div>`;
    } else if (originals.has(specimen)) { specimen.classList.remove("compare"); specimen.innerHTML = originals.get(specimen)!; }
  }
  bindStaticControls();
  announce(on ? "Specimens show light and dark side by side" : "Specimens follow the guide theme");
});

// ---- Static specimens become lightly interactive (visual state only) ----
function bindStaticControls() {
  for (const slider of document.querySelectorAll<HTMLInputElement>(".specimen input.slider")) slider.oninput = () => {
    const min = Number(slider.min || 0), max = Number(slider.max || 1);
    slider.style.setProperty("--fill", `${(Number(slider.value) - min) / (max - min) * 100}%`);
    const readout = slider.parentElement?.querySelector("output"); if (readout) readout.textContent = `${Math.round(Number(slider.value) * 100)}%`;
  };
  for (const segmented of document.querySelectorAll<HTMLElement>(".specimen .segmented")) for (const segment of segmented.querySelectorAll<HTMLButtonElement>(".segment"))
    segment.onclick = () => { for (const other of segmented.querySelectorAll(".segment")) other.setAttribute("aria-pressed", String(other === segment)); };
  for (const option of document.querySelectorAll<HTMLButtonElement>(".specimen .finish-option")) option.onclick = () => {
    for (const other of option.parentElement!.querySelectorAll(".finish-option")) other.setAttribute("aria-pressed", String(other === option));
  };
}
bindStaticControls();

// ---- Snapping sandbox: the production resolver, a deliberately large dragged panel ----
function sandbox() {
  const host = document.getElementById("snap-sandbox"), readout = document.getElementById("snap-readout");
  if (!host || !readout) return;
  host.replaceChildren();
  const make = (id: string, label: string, x: number, y: number, w: number, hgt: number, floating = false) => {
    const element = h("section", { class: `dock-group sandbox-group${floating ? " floating" : ""}`, "data-group": id },
      h("div", { class: "dock-tabbar" }, h("div", { class: "dock-tabs" }, h("button", { class: "dock-tab", type: "button", role: "tab", "aria-selected": "true" }, icon("layers"), h("span", { class: "dock-tab-label", text: label }))), h("div", { class: "dock-tabbar-fill" })),
      h("div", { class: "dock-body" }, h("p", { class: "note", style: "padding:10px", text: floating ? "Floating: magnetic band on every edge" : "Docked: compass appears under the cursor" })));
    Object.assign(element.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${hgt}px` });
    host.append(element); return element;
  };
  const targets = [make("a", "Layers", 8, 8, 200, 344), make("b", "Head", 216, 8, 330, 344), make("c", "Motion (floating)", 590, 40, 220, 170, true)];
  const panel = make("drag", "Lighting · drag me", 380, 170, 380, 180, true);
  panel.classList.add("sandbox-panel");
  const overlay = h("div", { class: "dock-overlay" }); host.append(overlay);
  const grip = panel.querySelector<HTMLElement>(".dock-tabbar")!;
  grip.style.cursor = "grab";
  const home = { left: panel.style.left, top: panel.style.top };
  grip.addEventListener("pointerdown", event => {
    event.preventDefault(); grip.setPointerCapture(event.pointerId);
    const base = host.getBoundingClientRect(), start = { x: event.clientX, y: event.clientY };
    const origin = { x: panel.offsetLeft, y: panel.offsetTop };
    const rel = (r: DOMRect) => ({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
    const geometry: DropGeometry = { workspace: { x: 0, y: 0, w: base.width, h: base.height }, groups: [...targets].reverse().map(element => ({
      id: element.dataset.group!, floating: element.classList.contains("floating"), rect: rel(element.getBoundingClientRect()),
      tabStrip: rel(element.querySelector(".dock-tabbar")!.getBoundingClientRect()),
      tabs: [...element.querySelectorAll(".dock-tab")].map(tab => rel(tab.getBoundingClientRect())) } satisfies TargetGroup)) };
    const move = (e: PointerEvent) => {
      const cursor = { x: e.clientX - base.left, y: e.clientY - base.top };
      panel.style.left = `${origin.x + e.clientX - start.x}px`; panel.style.top = `${origin.y + e.clientY - start.y}px`;
      const resolution = resolveDrop(cursor, geometry, { suppress: e.ctrlKey });
      overlay.replaceChildren();
      for (const guide of resolution.guides) {
        const t = guide.target, kind = t.kind === "split" || t.kind === "edge" ? t.side : "tab";
        const box = h("div", { class: `dock-guide ${t.kind} ${kind}${resolution.active === guide ? " active" : ""}` });
        Object.assign(box.style, { left: `${guide.rect.x}px`, top: `${guide.rect.y}px`, width: `${guide.rect.w}px`, height: `${guide.rect.h}px` });
        overlay.append(box);
      }
      if (resolution.target.kind !== "float") {
        const r = previewRect(resolution.target, geometry, { w: 380, h: 180 });
        const preview = h("div", { class: "dock-preview", "data-label": resolution.active?.label ?? "" });
        Object.assign(preview.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
        overlay.append(preview);
      }
      const mark = h("div", { class: "dock-cursor-mark" }); Object.assign(mark.style, { left: `${cursor.x}px`, top: `${cursor.y}px` }); overlay.append(mark);
      const panelRect = panel.getBoundingClientRect();
      const overlapped = targets.filter(target => { const r = target.getBoundingClientRect();
        return panelRect.left < r.right && panelRect.right > r.left && panelRect.top < r.bottom && panelRect.bottom > r.top; }).map(target => target.querySelector(".dock-tab-label")!.textContent);
      readout.textContent = `${resolution.target.kind === "float" ? "No snap — the cursor is not on a guide." : `Target: ${resolution.active?.label ?? resolution.target.kind}.`} ` +
        `Panel overlaps: ${overlapped.length ? overlapped.join(", ") : "nothing"} (ignored).${e.ctrlKey ? " Ctrl held: snapping suppressed." : ""}`;
    };
    const up = () => {
      grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up);
      const text = readout.textContent ?? "";
      overlay.replaceChildren();
      if (!text.startsWith("No snap")) { panel.style.left = home.left; panel.style.top = home.top; readout.textContent = `${text} In the Studio this would dock; the sandbox resets.`; }
    };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up);
  });
}
sandbox();

// ---- Live dock with sample panels ----
function liveDock() {
  const host = document.getElementById("live-dock");
  if (!host) return;
  host.replaceChildren();
  const sample = (title: string) => h("div", { class: "panel-content" }, h("h3", { class: "section-title", text: title }),
    h("p", { class: "note", text: "Drag this tab or the empty tab bar. Right-click a tab for keyboard-equivalent layout options." }));
  const panels = ([["one", "Presets", "presets"], ["two", "Layers", "layers"], ["three", "Head", "head"], ["four", "Camera & light", "lighting"], ["five", "Motion", "motion"]] as const)
    .map(([id, title, iconName]) => ({ id, title, icon: iconName, description: `${title} sample`, element: sample(title) }));
  const initial = (): DockTree => ({ closed: [], floating: [], root: split("row", [
    split("column", [group(["one", "two"], "one", "lg-a"), group(["five"], "five", "lg-e")], [.55, .45], "ls-a"),
    group(["three"], "three", "lg-c"), group(["four"], "four", "lg-d")], [.3, .45, .25], "ls-root") });
  let state = { wide: initial(), compact: initial() };
  const dock = new DockView({ panels, state, sizeClass: () => "wide", defaults: () => initial(),
    save: next => { state = next; }, announce });
  host.append(dock.element);
  dock.render();
}
liveDock();

// ---- Live menus, popovers, palette and toasts beside their static specimens ----
function attach(patternId: string, label: string, run: (button: HTMLButtonElement) => void) {
  const pattern = document.getElementById(patternId);
  if (!pattern) return;
  const button = h("button", { class: "btn small", type: "button" }, icon("play"), h("span", { text: label }));
  button.addEventListener("click", () => run(button));
  pattern.querySelector(".pattern-head")!.append(button);
}
const feedback = new Feedback();
document.body.append(feedback.toasts, feedback.live);
attach("c-context", "Open live menu", button => openMenu([
  { kind: "heading", label: "Layer", detail: "Petal wash · 2 of 3 from front" },
  { kind: "action", label: "Duplicate layer", icon: "duplicate", shortcut: "Ctrl+D", run: () => feedback.toast("success", "Layers", "Duplicated (demo).") },
  { kind: "action", label: "Remove layer", icon: "trash", danger: true, hint: "Undo with Ctrl+Z", run: () => feedback.toast("info", "Layers", "Removed “Petal wash” (demo).", [{ label: "Undo", run: () => {} }]) },
  { kind: "action", label: "Bring forward", icon: "arrowUp", capability: { available: false, reason: "This layer is already in front." }, run: () => {} },
  { kind: "submenu", label: "Finish", icon: "finish", items: () => [
    { kind: "action", label: "Matte", checked: true, run: () => {} }, { kind: "action", label: "Glitter", hint: "Preview study · not exported", run: () => {} }] },
  { kind: "action", label: "Set point pigment…", icon: "edge", run: () => openValuePopover({ kind: "range", label: "Pigment strength", value: .72, min: 0, max: 1, step: .01, format: v => `${Math.round(v * 100)}%` },
    button, { title: "Point 3 pigment", apply: "Apply", validate: v => Number(v) >= .1 ? { available: true } : { available: false, reason: "Demo: values below 10% are refused." }, commit: () => feedback.toast("success", "Shape", "Applied (demo).") }) },
], button, { label: "Demo menu", invoker: button }));
attach("c-toasts", "Show live toasts", () => {
  feedback.toast("success", "Library", "Saved “Night market set” · revision 4.");
  feedback.toast("error", "Library", "The library has a newer revision of this collection. Your draft is kept.", [{ label: "Refresh library", run: () => {} }, { label: "Save as copy", run: () => {} }]);
});
attach("s-palette", "Open live palette", () => openPalette(() => [
  { id: "save", title: "Save to library", group: "Library", icon: "save", shortcut: "Ctrl+S", capability: () => ({ available: true }), run: () => feedback.toast("success", "Library", "Saved (demo).") },
  { id: "recover", title: "Recover previous collection draft", group: "Library", icon: "undo", capability: () => ({ available: false, reason: "No previous collection draft." }), run: () => {} },
  { id: "float", title: "Float Camera & light", group: "Layout", icon: "float", capability: () => ({ available: true }), run: () => {} },
  { id: "theme", title: "Theme: dark", group: "Appearance", icon: "moon", capability: () => ({ available: true }), run: () => setTheme("dark") },
]));
attach("c-slider", "Live slider", button => {
  const slider = new Slider({ label: "Opacity (live transaction demo)", min: 0, max: 1, step: .01, format: v => `${Math.round(v * 100)}%`,
    transaction: { begin: () => announce("Transaction begun"), edit: () => {}, commit: () => feedback.toast("info", "Colour & finish", "One Undo step recorded (demo)."), cancel: () => feedback.toast("info", "Colour & finish", "Escape restored the starting value (demo).") } });
  slider.update(.85);
  button.closest(".pattern")!.querySelector(".specimen")!.append(slider.element);
  const toggle = new Toggle({ label: "Mirror across the face (live)", onChange: checked => announce(checked ? "On" : "Off") }); toggle.update(true);
  button.closest(".pattern")!.querySelector(".specimen")!.append(toggle.element);
  button.disabled = true;
});

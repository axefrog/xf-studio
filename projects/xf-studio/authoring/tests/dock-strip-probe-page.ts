/**
 * Browser page for tests/dock-strip-geometry.test.ts (bundled there, run in headless Chrome with the real studio.css inlined). It renders a
 * dock whose right-hand group of five tabs is collapsed along the row (a full-height vertical strip, as a right column folds) and, for
 * comparison, the same group expanded (a horizontal tab bar), at several heights and with different tabs active. For each case it
 * records the laid-out boxes of the header, every shown tab and each tab's icon, label and close mark, as plain data in
 * `window.probe`. The test asserts the geometry; this page only measures. Nothing here reads game files.
 */
import { DockView } from "../src/studio-ui/dock/dock-view";
import type { DockTree } from "../src/studio-ui/dock/layout";
import type { IconName } from "../src/studio-ui/icons";

/** public/studio.css, inlined by the test (runProbePage's `define`). */
declare const STUDIO_CSS: string;

export type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };
export type TabGeometry = { panel: string; selected: boolean; title: string; box: Box; icon: Box | null; label: Box | null;
  labelClipped: boolean; close: Box | null };
export type StripCase = { name: string; height: number; fold: string | null; stage: string; activeIcon: boolean; overflowed: number;
  bar: Box; strip: Box; actions: Box; tabs: TabGeometry[]; focusOutlineOffset: string };
export type StripProbe = { ok: boolean; failure?: string; cases: StripCase[] };

const PANELS: [string, string, IconName][] = [["edge", "Pigment & edge", "edge"], ["warp", "Warp", "warp"], ["finish", "Colour & finish", "finish"],
  ["shape", "Shape", "shape"], ["layers", "Layers", "layers"], ["head", "3D view", "head"]];
const RIGHT = PANELS.slice(0, 5).map(([id]) => id);

// A turn of the event loop, not an animation frame: a headless page that isn't painted may throttle requestAnimationFrame, and every
// measurement below forces a synchronous layout anyway.
const frame = () => new Promise(resolve => setTimeout(resolve, 0));
const box = (element: Element): Box => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
const shown = (element: Element | null) => !!element && getComputedStyle(element).display !== "none" && element.getBoundingClientRect().width > 0;

async function run(): Promise<StripCase[]> {
  const style = document.createElement("style");
  style.textContent = STUDIO_CSS;
  document.head.append(style);
  const host = document.createElement("div");
  host.style.cssText = "position: absolute; left: 0; top: 0; width: 1000px; height: 900px;";
  document.body.append(host);
  const tree = (collapsed: boolean, active: string): DockTree => ({ floating: [], closed: [], root: { kind: "split", id: "s-root", axis: "row", sizes: [.6, .4],
    children: [{ kind: "group", id: "g-head", panels: ["head"], active: "head" }, { kind: "group", id: "g-right", panels: RIGHT, active, ...(collapsed ? { collapsed: true } : {}) }] } });
  const view = new DockView({
    panels: PANELS.map(([id, title, icon]) => ({ id, title, icon, description: title, element: document.createElement("div") })),
    state: { wide: tree(false, "edge"), compact: tree(false, "edge") }, sizeClass: () => "wide", defaults: () => tree(false, "edge"),
    save: () => {}, announce: () => {},
  });
  host.append(view.element);
  view.render();
  const cases: StripCase[] = [];
  const measure = (name: string, height: number): StripCase => {
    const group = view.element.querySelector<HTMLElement>('[data-group="g-right"]')!;
    const bar = group.querySelector<HTMLElement>(".dock-tabbar")!, strip = group.querySelector<HTMLElement>(".tab-strip")!;
    const tabs = [...group.querySelectorAll<HTMLButtonElement>(".dock-tab")].filter(tab => !tab.hidden).map(tab => {
      const icon = tab.querySelector(":scope > .icon"), label = tab.querySelector<HTMLElement>(".dock-tab-label"), close = tab.querySelector(".dock-tab-close");
      const labelShown = shown(label);
      return { panel: tab.dataset.panel ?? "", selected: tab.getAttribute("aria-selected") === "true", title: tab.title, box: box(tab),
        icon: shown(icon) ? box(icon!) : null, label: labelShown ? box(label!) : null,
        labelClipped: labelShown && (label!.scrollWidth > label!.clientWidth + .5 || label!.scrollHeight > label!.clientHeight + .5),
        close: shown(close) ? box(close!) : null };
    });
    // The focus ring's rule, read from the stylesheet (a programmatic focus need not match :focus-visible).
    const rule = [...style.sheet!.cssRules].find((r): r is CSSStyleRule => r instanceof CSSStyleRule && r.selectorText === ".dock-tab:focus-visible");
    const outline = rule?.style;
    return { name, height, fold: group.dataset.fold ?? null, stage: strip.dataset.stage ?? "", activeIcon: strip.classList.contains("active-icon"),
      overflowed: group.querySelectorAll(".dock-tab[hidden]").length, bar: box(bar), strip: box(strip), actions: box(group.querySelector(".panel-header-actions")!), tabs,
      focusOutlineOffset: outline?.outlineOffset ?? "" };
  };
  const show = async (collapsed: boolean, active: string, height: number, name: string) => {
    host.style.height = `${height}px`;
    view.update(tree(collapsed, active), undefined, false);
    await frame();
    view.condenseTabs();
    await frame();
    cases.push(measure(name, height));
  };
  for (const height of [900, 560, 420, 300, 200]) {
    await show(true, "edge", height, `strip-first-${height}`);
    await show(true, "finish", height, `strip-middle-${height}`);
  }
  await show(false, "edge", 900, "bar-expanded");
  await show(false, "finish", 900, "bar-expanded-middle");
  return cases;
}

run().then(cases => { (window as unknown as { probe: StripProbe }).probe = { ok: true, cases }; },
  error => { (window as unknown as { probe: StripProbe }).probe = { ok: false, failure: String(error?.stack ?? error), cases: [] }; });

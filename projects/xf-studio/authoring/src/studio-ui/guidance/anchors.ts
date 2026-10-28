import type { StudioPanelId } from "../layout-defaults";

/**
 * Named guidance anchors. Tours, spotlights and help point at these stable IDs, never at CSS
 * selectors, so docking, tab order and restyling cannot break a tour. Each anchor names the
 * panel that owns it (header anchors have none), so a step whose anchor is missing can offer to
 * open that panel through the ordinary panel commands. Every panel is also an anchor
 * (`panel.<id>`), registered by the shell for its content element.
 */
export const CONTROL_ANCHORS = {
  "header.save": { label: "Save button", order: 1 },
  "header.package": { label: "Package button", order: 2 },
  "header.history": { label: "History button", order: 3 },
  "header.help": { label: "Help button", order: 4 },
  "header.settings": { label: "Settings button", order: 5 },
  "header.palette": { label: "Commands button", order: 6 },
  "tabs.strip": { label: "Layout tabs", order: 7 },
  "head.view": { panel: "head", label: "3D view", order: 12 },
  "history.list": { panel: "history", label: "History list", order: 17 },
  "package.check": { panel: "package", label: "Check", order: 18 },
  "package.build": { panel: "package", label: "Build", order: 19 },
  "package.setup": { panel: "package", label: "Game setup", order: 20 },
  /** The row with Add to my mod manager and Show in folder; it exists once a Build has finished. */
  "package.install": { panel: "package", label: "Add to my mod manager", order: 21 },
} as const satisfies Record<string, { panel?: StudioPanelId; label: string; order: number }>;

export type ControlAnchorId = string;
export type PanelAnchorId = `panel.${StudioPanelId}`;
export type AnchorId = ControlAnchorId | PanelAnchorId;
export type AnchorInfo = Readonly<{ id: AnchorId; label: string; panel?: StudioPanelId }>;

export const panelAnchor = (panel: StudioPanelId): PanelAnchorId => `panel.${panel}`;

const panelAnchorInfo = (panel: StudioPanelId): AnchorInfo => ({ id: panelAnchor(panel), label: `${panel} panel`, panel });
/** Every anchor a tour may name: the control anchors plus one per contributed panel (`panelIds`, from the catalogue). */
export function anchorCatalogue(panelIds: readonly StudioPanelId[], extra: readonly (AnchorInfo & { order: number })[] = []): AnchorInfo[] {
  return [
    ...[...Object.entries(CONTROL_ANCHORS).map(([id, info]) => ({ id, ...info })), ...extra]
      .sort((a, b) => a.order - b.order).map(({ order: _order, ...info }) => info),
    ...panelIds.map(panelAnchorInfo),
  ];
}
const CONTROL_INFO = new Map(anchorCatalogue([]).map(info => [info.id, info]));
/** A panel's anchor is `panel.<panel ID>`; panel IDs are lower-case words, dot-separated for a feature's panels. */
const PANEL_ANCHOR = /^panel\.([a-z][\w-]*(?:\.[a-z][\w-]*)?)$/;
/**
 * A control anchor, or any panel's anchor. Which panels exist is the catalogue's to say (the shell registers
 * one anchor per contributed panel; guidance tests check tours against the composed catalogue).
 */
export const isAnchorId = (id: string): id is AnchorId => CONTROL_INFO.has(id as AnchorId) || PANEL_ANCHOR.test(id);
export const anchorInfo = (id: AnchorId): AnchorInfo | undefined => {
  const panel = PANEL_ANCHOR.exec(id)?.[1];
  return panel ? panelAnchorInfo(panel) : CONTROL_INFO.get(id);
};

/** Anything with a layout box; `HTMLElement` in the app, plain objects in tests. */
export type AnchorTarget = { readonly isConnected: boolean; getBoundingClientRect(): { left: number; top: number; width: number; height: number } };
export type AnchorRect = Readonly<{ x: number; y: number; w: number; h: number }>;
/** `visible`: laid out with a size. `hidden`: registered but not shown (a background tab, a collapsed section). `missing`: never registered or removed. */
export type AnchorState = "visible" | "hidden" | "missing";

/**
 * The runtime registry: panels and the shell register the element behind each anchor when they
 * build it. The registry only reads layout boxes; it never changes the elements.
 */
export class AnchorRegistry<T extends AnchorTarget = HTMLElement> {
  constructor(private readonly catalogue?: () => readonly AnchorInfo[]) {}
  info(id: AnchorId): AnchorInfo | undefined { return this.catalogue ? this.catalogue().find(info => info.id === id) : anchorInfo(id); }
  private withdraw() {
    if (!this.catalogue) return;
    const allowed = new Set(this.catalogue().map(info => info.id));
    for (const id of this.elements.keys()) if (!allowed.has(id)) this.elements.delete(id);
    for (const id of this.instances.keys()) if (!allowed.has(id)) this.instances.delete(id);
  }
  private elements = new Map<AnchorId, T>();
  private instances = new Map<AnchorId, Map<string, T>>();
  /** Instance registrations are independent; a type-level tour chooses the first visible survivor. */
  scoped(instance: string, signal: AbortSignal): AnchorRegistry<T> {
    const releases = new Set<() => void>();
    signal.addEventListener("abort", () => { for (const off of releases) off(); releases.clear(); }, { once: true });
    return new Proxy(this, { get: (target, key) => key === "register" ? (id: AnchorId, element: T) => {
      if (signal.aborted) return () => {};
      if (!this.info(id)) throw Error(`Unknown guidance anchor ${id}`);
      let group = this.instances.get(id); if (!group) this.instances.set(id, group = new Map());
      group.set(instance, element);
      const off = () => { if (group!.get(instance) === element) group!.delete(instance); if (!group!.size && this.instances.get(id) === group) this.instances.delete(id); releases.delete(off); };
      releases.add(off); return off;
    } : typeof Reflect.get(target, key) === "function" ? (Reflect.get(target, key) as Function).bind(target) : Reflect.get(target, key) });
  }
  /** Register (or replace) an anchor's element. Returns an unregister function. */
  register(id: AnchorId, element: T): () => void {
    if (!this.info(id)) throw Error(`Unknown guidance anchor ${id}`);
    this.elements.set(id, element);
    return () => { if (this.elements.get(id) === element) this.elements.delete(id); };
  }
  element(id: AnchorId): T | undefined {
    this.withdraw();
    const choices = [...(this.instances.get(id)?.values() ?? [])];
    return choices.find(element => { const box = element.getBoundingClientRect(); return element.isConnected && box.width > 0 && box.height > 0; })
      ?? choices.find(element => element.isConnected) ?? this.elements.get(id);
  }
  registered(): AnchorId[] { this.withdraw(); return [...new Set([...this.elements.keys(), ...this.instances.keys()])]; }
  /** The anchor's box, cut to what its scrolling panels actually show (a long list lights only its visible part). */
  rect(id: AnchorId): AnchorRect | undefined {
    const element = this.element(id);
    if (!element?.isConnected) return undefined;
    const box = element.getBoundingClientRect();
    let left = box.left, top = box.top, right = box.left + box.width, bottom = box.top + box.height;
    if (typeof Element !== "undefined" && element instanceof Element) {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.overflowX === "visible" && style.overflowY === "visible") continue;
        const clip = parent.getBoundingClientRect();
        left = Math.max(left, clip.left); top = Math.max(top, clip.top);
        right = Math.min(right, clip.right); bottom = Math.min(bottom, clip.bottom);
      }
    }
    return right - left > 0 && bottom - top > 0 ? { x: left, y: top, w: right - left, h: bottom - top } : undefined;
  }
  state(id: AnchorId): AnchorState {
    const element = this.element(id);
    if (!element?.isConnected) return "missing";
    return this.rect(id) ? "visible" : "hidden";
  }
}

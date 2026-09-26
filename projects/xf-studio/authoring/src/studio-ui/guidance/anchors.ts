import type { StudioPanelId } from "../layout-defaults";

/**
 * Named guidance anchors. Tours, spotlights and help point at these stable IDs, never at CSS
 * selectors, so docking, tab order and restyling cannot break a tour. Each anchor names the
 * panel that owns it (header anchors have none), so a step whose anchor is missing can offer to
 * open that panel through the ordinary panel commands. Every panel is also an anchor
 * (`panel.<id>`), registered by the shell for its content element.
 */
export const CONTROL_ANCHORS = {
  "header.save": { label: "Save button" },
  "header.package": { label: "Package button" },
  "header.history": { label: "History button" },
  "header.help": { label: "Help button" },
  "header.palette": { label: "Commands button" },
  "layers.add": { panel: "layers", label: "Add layer" },
  "layers.list": { panel: "layers", label: "Layer list" },
  "uv.canvas": { panel: "uv", label: "UV map" },
  "head.view": { panel: "head", label: "Head preview" },
  "finish.color": { panel: "finish", label: "Colour" },
  "finish.picker": { panel: "finish", label: "Finish picker" },
  "presets.list": { panel: "presets", label: "Preset list" },
  "history.list": { panel: "history", label: "History list" },
  "package.check": { panel: "package", label: "Check mod export" },
} as const satisfies Record<string, { panel?: StudioPanelId; label: string }>;

export type ControlAnchorId = keyof typeof CONTROL_ANCHORS;
export type PanelAnchorId = `panel.${StudioPanelId}`;
export type AnchorId = ControlAnchorId | PanelAnchorId;
export type AnchorInfo = Readonly<{ id: AnchorId; label: string; panel?: StudioPanelId }>;

export const panelAnchor = (panel: StudioPanelId): PanelAnchorId => `panel.${panel}`;

const panelAnchorInfo = (panel: StudioPanelId): AnchorInfo => ({ id: panelAnchor(panel), label: `${panel} panel`, panel });
/** Every anchor a tour may name: the control anchors plus one per contributed panel (`panelIds`, from the catalogue). */
export function anchorCatalogue(panelIds: readonly StudioPanelId[]): AnchorInfo[] {
  return [
    ...Object.entries(CONTROL_ANCHORS).map(([id, info]) => ({ id: id as ControlAnchorId, label: info.label,
      ...("panel" in info ? { panel: info.panel as StudioPanelId } : {}) })),
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
  private elements = new Map<AnchorId, T>();
  /** Register (or replace) an anchor's element. Returns an unregister function. */
  register(id: AnchorId, element: T): () => void {
    if (!isAnchorId(id)) throw Error(`Unknown guidance anchor ${id}`);
    this.elements.set(id, element);
    return () => { if (this.elements.get(id) === element) this.elements.delete(id); };
  }
  element(id: AnchorId): T | undefined { return this.elements.get(id); }
  registered(): AnchorId[] { return [...this.elements.keys()]; }
  /** The anchor's box, cut to what its scrolling panels actually show (a long list lights only its visible part). */
  rect(id: AnchorId): AnchorRect | undefined {
    const element = this.elements.get(id);
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
    const element = this.elements.get(id);
    if (!element?.isConnected) return "missing";
    return this.rect(id) ? "visible" : "hidden";
  }
}

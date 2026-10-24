/**
 * Eye makeup's view contribution (feature module #1): its layer stack, the UV map and its inspectors,
 * and the activity sources of its actions. Its panel IDs are grandfathered (they predate feature views),
 * so saved dock layouts restore unchanged; a new feature's panels use `<feature>.<panel>` IDs.
 * Data only: the composition list (`compose/views.ts`) reads it without loading any panel.
 */
import { panelMeta, type ViewContribution } from "../../../studio-ui/views/contribution";

export const EYE_MAKEUP_VIEW = {
  owner: "eye-makeup",
  panels: [
    { id: "presets", context: { kind: "look" }, title: "Presets", icon: "presets", order: 10, slot: "collection",
      description: "Named looks in the current collection; each is one choice in the game selector." },
    { id: "library", context: { kind: "look" }, title: "Library", icon: "library", order: 40, slot: "collection", heavy: true,
      description: "Saved versions of your collection, recovery and files." },
    { id: "layers", context: { kind: "look" }, title: "Layers", icon: "layers", order: 20, slot: "stack",
      description: "The current preset's layer stack, front first." },
    { id: "uv", context: { kind: "look" }, title: "UV map", icon: "uv", order: 70, slot: "canvas",
      description: "Flat editor for the same contour, handles and warps in texture space." },
    { id: "finish", context: { kind: "look" }, title: "Colour & finish", icon: "finish", order: 80, slot: "inspect",
      description: "Pigment colour, opacity and finish of the selected layer." },
    { id: "shape", context: { kind: "look" }, title: "Shape", icon: "shape", order: 90, slot: "inspect",
      description: "Contour points, Bézier handles and mirroring for the selected layer." },
    { id: "edge", context: { kind: "look" }, title: "Pigment & edge", icon: "edge", order: 100, slot: "inspect",
      description: "Point pigment strength, edge softness and mottle, independent of each other." },
    { id: "warp", context: { kind: "look" }, title: "Warp", icon: "warp", order: 110, slot: "inspect",
      description: "Smooth displacement fields that bend the selected layer's mask." },
  ],
  // Layer-stack kinds first: `layer.setEnabled` is a Layers action, not a colour or finish one.
  activity: [
    { pattern: /^layer\.(edit|setEnabled|select)$/, label: "Layers" },
    // Each source is named as its panel is (UI-92).
    { pattern: /^(point|path|shape)\./, label: "Shape" },
    { pattern: /^(pigment|softness|effect)\./, label: "Pigment & edge" },
    { pattern: /^field\./, label: "Warp" },
    { pattern: /^(layer\.set|layer\.useGameOptics|glitter\.)/, label: "Colour & finish" },
  ],
} as const satisfies ViewContribution;

/** Eye makeup's panel IDs, kept from before view contributions so saved layouts restore. */
export const EYE_MAKEUP_GRANDFATHERED_PANELS: readonly string[] = EYE_MAKEUP_VIEW.panels.map(panel => panel.id);

/** Eye makeup's panel titles, icons and purposes, for its panel modules' specs. */
export const EYE_MAKEUP_PANEL_META = panelMeta(EYE_MAKEUP_VIEW);

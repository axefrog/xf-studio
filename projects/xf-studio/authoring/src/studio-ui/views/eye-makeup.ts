/**
 * Eye makeup's view contribution (feature module #1): its layer stack, the UV map and its inspectors,
 * and the activity sources of its actions. Its panel IDs are grandfathered (they predate feature views),
 * so saved dock layouts restore unchanged; a new feature's panels use `<feature>.<panel>` IDs.
 * Moves to `features/eye-makeup/view/` with the step-5 file moves.
 */
import type { ViewContribution } from "./contribution";

export const EYE_MAKEUP_VIEW = {
  owner: "eye-makeup",
  panels: [
    { id: "layers", title: "Layers", icon: "layers", order: 20, slot: "stack",
      description: "The current preset's layer stack, front first." },
    { id: "uv", title: "UV map", icon: "uv", order: 70, slot: "canvas",
      description: "Flat editor for the same contour, handles and warps in texture space." },
    { id: "finish", title: "Colour & finish", icon: "finish", order: 80, slot: "inspect",
      description: "Pigment colour, opacity and finish of the selected layer." },
    { id: "shape", title: "Shape", icon: "shape", order: 90, slot: "inspect",
      description: "Contour points, Bézier handles and mirroring for the selected layer." },
    { id: "edge", title: "Pigment & edge", icon: "edge", order: 100, slot: "inspect",
      description: "Point pigment strength and edge softness, independent of each other." },
    { id: "warp", title: "Warp", icon: "warp", order: 110, slot: "inspect",
      description: "Smooth displacement fields that bend the selected layer's mask." },
  ],
  // Layer-stack kinds first: `layer.setEnabled` is a Layers action, not a colour or finish one.
  activity: [
    { pattern: /^layer\.(edit|setEnabled|select)$/, label: "Layers" },
    { pattern: /^(point|path|field|pigment|softness|shape)\./, label: "Shape" },
    { pattern: /^(layer\.set|layer\.useGameOptics|glitter\.)/, label: "Colour & finish" },
  ],
} as const satisfies ViewContribution;

/** Eye makeup's panel IDs, kept from before view contributions so saved layouts restore. */
export const EYE_MAKEUP_GRANDFATHERED_PANELS: readonly string[] = EYE_MAKEUP_VIEW.panels.map(panel => panel.id);

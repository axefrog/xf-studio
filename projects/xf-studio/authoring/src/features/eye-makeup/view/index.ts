/**
 * Eye makeup's view (feature-module platform §1 `features/<id>/view/`): its contribution to the shell's
 * catalogue, the factories of its panels and its palette commands, which the composition roots join with
 * the shell's (`compose/views.ts`, `compose/view-panels.ts`). The view obeys the presentation's boundary
 * rules; its factories receive only a context over eye makeup's facade (`actions.ts`, UI-73).
 */
import { featureView } from "../../../studio-ui/views/feature-view";
import { eyeMakeupCommands } from "./commands";
import { EYE_MAKEUP_VIEW } from "./contribution";
import { edgePanel, finishPanel, shapePanel, warpPanel } from "./inspector";
import { layersPanel } from "./layers";
import { uvPanel } from "./uv";

export { EYE_MAKEUP_GRANDFATHERED_PANELS, EYE_MAKEUP_PANEL_META, EYE_MAKEUP_VIEW } from "./contribution";

/** Eye makeup's bound view: its panels by ID and its palette commands. */
export const EYE_MAKEUP_VIEW_BINDING = featureView(EYE_MAKEUP_VIEW, {
  panels: { layers: layersPanel, uv: uvPanel, finish: finishPanel, shape: shapePanel, edge: edgePanel, warp: warpPanel },
  commands: eyeMakeupCommands,
});

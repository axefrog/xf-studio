/**
 * Eye makeup's view (feature-module platform §1 `features/<id>/view/`): its contribution to the shell's
 * catalogue and the factories of its panels, which the composition roots join with the shell's
 * (`compose/views.ts`, `compose/view-panels.ts`). The view obeys the presentation's boundary rules and acts
 * only through eye makeup's facade (`actions.ts`).
 */
import type { PanelFactories } from "../../../studio-ui/views/panels";
import { EYE_MAKEUP_VIEW } from "./contribution";
import { edgePanel, finishPanel, shapePanel, warpPanel } from "./inspector";
import { layersPanel } from "./layers";
import { uvPanel } from "./uv";

export { EYE_MAKEUP_GRANDFATHERED_PANELS, EYE_MAKEUP_PANEL_META, EYE_MAKEUP_VIEW } from "./contribution";

export const EYE_MAKEUP_PANELS: PanelFactories<typeof EYE_MAKEUP_VIEW> = {
  layers: layersPanel, uv: uvPanel, finish: finishPanel, shape: shapePanel, edge: edgePanel, warp: warpPanel,
};

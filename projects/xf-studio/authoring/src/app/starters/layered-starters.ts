import type { LayeredMakeupRegion } from "../../engines/layered-makeup/region";
import { readStarterShape } from "../../engines/layered-makeup/starter-shape";
import { ShapeStarters } from "./shape-starters";
import { StarterActions } from "./starter-actions";
import type { StarterContribution } from "./feature-starters";

/** Compatibility starter adapter owned by the registered layered feature. */
export function layeredStarters(region: LayeredMakeupRegion): StarterContribution {
  return { create: options => {
    const memory = () => options.workspace.featureMemory?.[region.id] as { defaultStarter?: string } | undefined;
    const shapes = new ShapeStarters({ ...options, feature: region.id, label: region.label,
      contributed: region.starters, fallback: region.defaultStarter, read: shape => readStarterShape(shape, region.newLayer(), region.models),
      choice: { get: () => memory()?.defaultStarter, set: id => {
        options.workspace.featureMemory ??= {};
        const own = { ...memory() };
        if (id === undefined) delete own.defaultStarter; else own.defaultStarter = id;
        options.workspace.featureMemory[region.id] = own;
      } } });
    return { shapes, actions: new StarterActions({ starters: shapes, feature: region.id, label: region.label, thumbnail: region.thumbnail }),
      part: () => region.starter(shapes.shapeOf()) };
  } };
}

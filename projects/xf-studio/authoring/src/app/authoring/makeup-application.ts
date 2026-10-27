/** Registered application/facade contribution. Mutation and publication belong to the registered editor. */
import type { FeatureApplication } from "../feature-application";
import type { EyeMakeupAction } from "../../legacy/eye-makeup/eye-makeup-model";
import type { EyeMakeupSpec } from "../../legacy/eye-makeup/authoring-eye-makeup";
import type { FeatureFacade, EyeMakeupFacade } from "../studio-presentation";
import type { StudioApplication } from "../studio-application";
import type { RecipeAction } from "../../engines/layered-makeup/recipe-actions";

export const MAKEUP_APPLICATION: FeatureApplication = {
  bind(read, registry, recorded) {
    if (!read().eyeMakeup)
      throw Error("The makeup application needs its registered editor projection.");
    const resolve = (input: { kind: string }) => {
      const action = input as EyeMakeupAction, shapes = read().starterShapes;
      if (action.kind !== "layer.edit" || (action.command.kind !== "add" && action.command.kind !== "reset")
        || action.command.shape !== undefined || !shapes) return { action };
      const starter = shapes.get(action.command.starter ?? shapes.defaultId());
      if (!starter?.shape) return { action, refused: { available: false as const, code: "missing_target" as const, reason: "That starter isn't available any more." } };
      return { action: { ...action, command: { ...action.command, shape: starter.shape,
        ...(action.command.kind === "add" ? { starterName: starter.name } : {}) } } as EyeMakeupAction };
    };
    const specOf = (action: EyeMakeupAction) => {
      const route = registry().route(action.kind);
      if (!route.ok || route.owner.owner !== "feature") throw Error(`${action.kind} is not a feature action.`);
      return route.spec as EyeMakeupSpec;
    };
    return {
      capability(input) { const { action, refused } = resolve(input); return refused ?? specOf(action).capability(read().eyeMakeup!.state(), action); },
      dispatch(input) {
        const { action } = resolve(input), s = read(), spec = specOf(action);
        s.eyeMakeup!.apply(spec, action, recorded(action));
        return undefined;
      },
    };
  },
  facade(base, host) {
    const a = host.application;
    const eye: EyeMakeupFacade = { ...(base as FeatureFacade<EyeMakeupAction>), view: () => host.editor,
      controlBegin: (id, layerId) => a.controlBegin(id, layerId, host.begin(id).look),
      controlEdit: (id, action) => host.run(id).controlEdit(id, host.name<RecipeAction>(id, action) as Parameters<StudioApplication["controlEdit"]>[1]),
      controlCommit: id => { host.run(id).controlCommit(id); host.end(id); },
      controlCancel: id => { host.run(id).controlCancel(id); host.end(id); },
      layerExport: layerId => a.layerExport(layerId), layerSurfaceEdge: layerId => a.layerSurfaceEdge(layerId),
      finishCatalogue: () => a.finishCatalogue(), glitterModelCatalogue: () => a.glitterModelCatalogue(), mottleCatalogue: () => a.mottleCatalogue() };
    return eye;
  },
};

import type { EyeMakeupAction } from "../../../eye-makeup-model";
import type { StudioTarget } from "../../../studio-application";
import type { DispatchFeedback, StudioRuntime } from "../../../studio-ui/runtime";

/**
 * Eye makeup's view acts only through eye makeup's facade (`port.feature("eye-makeup")`, UI-52): its
 * dispatches, capabilities and per-target capabilities are the facade's, which refuses any other owner's
 * kind. Feedback is the shell's (`rt.report`), exactly as for any other dispatch. A platform action the
 * view offers (adding a preset, Undo) goes through the shell's runtime, never through this.
 */
export type EyeMakeupActions = {
  dispatch(action: EyeMakeupAction, options?: DispatchFeedback): boolean;
  capability(action: EyeMakeupAction): ReturnType<StudioRuntime["eyeMakeup"]["capability"]>;
  contextCapability(target: StudioTarget, action: EyeMakeupAction): ReturnType<StudioRuntime["eyeMakeup"]["contextCapability"]>;
  /** Layer creation; refused (with a reason) while no preset owns the editor. */
  addLayerCapability(): ReturnType<StudioRuntime["eyeMakeup"]["capability"]>;
};

const bound = new WeakMap<StudioRuntime, EyeMakeupActions>();
export function eyeMakeupActions(rt: StudioRuntime): EyeMakeupActions {
  let actions = bound.get(rt);
  if (!actions) {
    const facade = rt.eyeMakeup;
    actions = Object.freeze({
      dispatch: (action, options) => rt.report(action.kind, facade.dispatch(action), options),
      capability: action => facade.capability(action),
      contextCapability: (target, action) => facade.contextCapability(target, action),
      addLayerCapability: () => facade.capability({ kind: "layer.edit", command: { kind: "add" } }),
    } satisfies EyeMakeupActions);
    bound.set(rt, actions);
  }
  return actions;
}

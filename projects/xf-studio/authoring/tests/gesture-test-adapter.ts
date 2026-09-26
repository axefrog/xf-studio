import { applyGestureEdit, type GestureEdit, type RecipeAction } from "../src/engines/layered-makeup/recipe-actions";
import type { EyeMakeupGestures, EyeMakeupPort, EyeMakeupSpec } from "../src/authoring-eye-makeup";
import { STUDIO_REGISTRY } from "../src/compose/studio-registry";
import { EYE_MAKEUP } from "../src/features/eye-makeup";
import type { Layer } from "../src/engines/layered-makeup/recipe";
import type { StudioGestureProposal } from "../src/studio-application";

/** Keeps legacy adapter fixtures focused on input mapping while using the opaque proposal contract. */
export function applyAdapterProposal(layer: Layer, proposal: StudioGestureProposal) {
  const base = { layerId: layer.id, expectedLayer: layer };
  let action: GestureEdit;
  if (proposal.kind === "shape.replace" || proposal.kind === "path.replacePoints")
    action = { ...base, ...proposal };
  else if (proposal.kind === "point.replace") {
    const expectedPoint = layer.points[proposal.index];
    if (!expectedPoint) return false;
    action = { ...base, ...proposal, expectedPoint };
  } else {
    const expectedField = layer.fields.find(field => field.id === proposal.fieldId);
    if (!expectedField) return false;
    action = { ...base, ...proposal, expectedField };
  }
  return applyGestureEdit(action);
}

/**
 * The production wiring of eye makeup's registered gestures and form-control apply over a port
 * (as `createTrustedAuthoringCore` builds it), for fixtures that assemble the core by hand.
 */
export function registeredEditing(port: EyeMakeupPort) {
  const spec = (kind: string) => STUDIO_REGISTRY.route(kind) as unknown as { ok: true; spec: EyeMakeupSpec };
  return {
    gestures: { applyGesture: (edit: GestureEdit) => port.gesture(EYE_MAKEUP.gestures as EyeMakeupGestures, edit) },
    controls: (action: RecipeAction) => port.apply(spec(action.kind).spec, action, false).changed,
  };
}

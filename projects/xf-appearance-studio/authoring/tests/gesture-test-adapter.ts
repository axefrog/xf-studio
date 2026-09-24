import { applyGestureEdit, type GestureEdit } from "../src/recipe-actions";
import type { Layer } from "../src/recipe";
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

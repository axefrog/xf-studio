import { createLayeredMakeupEditor } from "../../engines/layered-makeup/editor";
import { EYE_MAKEUP_REGION } from "./region";
/** Registered per-look editing owner; the platform retains its state and shared history. */
import type { FeatureEditor, FeatureEditorHost, FeatureEditorState } from "../../platform/api";

export function createEyeMakeupEditor(host: FeatureEditorHost): FeatureEditor<FeatureEditorState> {
  const alive = () => { if (host.signal.aborted) throw Error("This makeup editor's context has ended."); };
  // No derived cache yet: reading on demand avoids copying a recipe for every pointer frame.
  alive();
  return { ...(host.editing ? createLayeredMakeupEditor(host, EYE_MAKEUP_REGION.id, EYE_MAKEUP_REGION) : {}), snapshot() { alive(); return host.snapshot(); } };
}

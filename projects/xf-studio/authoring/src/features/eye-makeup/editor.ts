/** Read-only per-look projection. The mutable application bridge remains outside the feature until slices 5–6. */
import type { FeatureEditor, FeatureEditorHost, FeatureEditorState } from "../../platform/api";

export function createEyeMakeupEditor(host: FeatureEditorHost): FeatureEditor<FeatureEditorState> {
  const alive = () => { if (host.signal.aborted) throw Error("This makeup editor's context has ended."); };
  // No derived cache yet: reading on demand avoids copying a recipe for every pointer frame.
  alive();
  return { snapshot() { alive(); return host.snapshot(); } };
}

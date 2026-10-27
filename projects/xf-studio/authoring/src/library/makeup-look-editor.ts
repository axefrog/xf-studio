/** Transitional wiring for callers still constructing the makeup editor (CORE-03 slice 4). */
import type { AuthoringDocument } from "../app/authoring/makeup-document";
import { makeupLookState } from "../app/workspace/makeup-workspace";
import type { DocumentModel } from "../app/workspace/makeup-workspace";
import type { LookWorking } from "./collection-documents";
import { LookEditor as LookWriter, lookContent as readLook, type LookEditorDeps } from "./look-editor";
export * from "./look-editor";
export class LookEditor extends LookWriter {
  constructor(deps: Omit<LookEditorDeps, "document"> & { document: AuthoringDocument }) {
    super({ ...deps, document: deps.document.lookDocument });
  }
}
export function lookContent(working: Pick<LookWorking, "id" | "name" | "parts" | "memory">, model: DocumentModel) {
  const content = readLook(working, model);
  return { ...content, state: makeupLookState(content.state, model) };
}

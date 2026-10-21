/**
 * The host's workspace file (platform/persistence/workspace-file.ts) with the workspace format it stores (workspace-state.ts),
 * composed once for both hosts.
 */
import type { DocumentModel } from "./collection-workspace";
import { isNewerData } from "./platform/api";
import { WorkspaceFile, type WorkspaceCodec } from "./platform/persistence/workspace-file";
import { parseWorkspace, serializeWorkspace, storesLookLevelHistory, WORKSPACE_1, WORKSPACE_2 } from "./workspace-state";

/** The workspace format as the file needs it, written with `model` (the composition root's document model). */
export function workspaceCodec(model: DocumentModel): WorkspaceCodec {
  return {
    schema: WORKSPACE_2,
    legacySchema: WORKSPACE_1,
    inspect(value) {
      // Looks holding a newer build's data are kept verbatim and locked: such a workspace opens, read-only.
      try { parseWorkspace(value, model, [], "keep"); return { newer: false }; }
      catch (error) {
        if (!isNewerData(error)) throw error;
        parseWorkspace(value, model, [], "omit");
        return { newer: true };
      }
    },
    // Histories the page stored in the look-level form (its budget's choice) stay in that form (CORE-39).
    stored: value => serializeWorkspace(parseWorkspace(value, model, undefined, "keep"), model, { lookLevel: storesLookLevelHistory(value) }),
  };
}

/** `<dataRoot>/workspace.json` and `<dataRoot>/verification-workspace.json`. */
export const openWorkspaceFile = (dataRoot: string, model: DocumentModel) => new WorkspaceFile(dataRoot, workspaceCodec(model));

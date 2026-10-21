/**
 * The host's workspace file (platform/persistence/workspace-file.ts) with the workspace format it stores (workspace-state.ts),
 * composed once for both hosts.
 */
import { COLLECTION_RECOVERY_LIMIT, writeCollectionWorkspace, type CollectionDraft, type DocumentModel } from "./collection-workspace";
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
    // The other draft's open collection goes first in the stored draft's recovery queue ("Recover previous draft"), unless it is
    // already there or is the open one. The stored draft's own state, open collection and order are otherwise unchanged.
    recovered(current, other) {
      const host = parseWorkspace(current, model, undefined, "keep"), theirs = parseWorkspace(other, model, undefined, "keep");
      if (!host.collections || !theirs.collections) return null;
      const draft = ({ previous: _previous, older: _older, ...rest }: NonNullable<typeof host.collections>): CollectionDraft => rest;
      const key = (value: CollectionDraft) => JSON.stringify(writeCollectionWorkspace(value, model));
      const incoming = draft(theirs.collections), recovery = [host.collections.previous, ...(host.collections.older ?? [])]
        .filter((entry): entry is CollectionDraft => !!entry);
      if ([draft(host.collections), ...recovery].some(entry => key(entry) === key(incoming))) return "same";
      const queue = [incoming, ...recovery].slice(0, COLLECTION_RECOVERY_LIMIT);
      host.collections = { ...draft(host.collections), previous: queue[0], older: queue.slice(1) };
      return serializeWorkspace(host, model, { lookLevel: storesLookLevelHistory(current) });
    },
  };
}

/** `<dataRoot>/workspace.json` and `<dataRoot>/verification-workspace.json`. */
export const openWorkspaceFile = (dataRoot: string, model: DocumentModel) => new WorkspaceFile(dataRoot, workspaceCodec(model));

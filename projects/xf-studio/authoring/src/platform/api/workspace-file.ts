/**
 * The workspace file's contract: the page's workspace draft lives in a file the host keeps (`platform/persistence/workspace-file.ts`),
 * on localhost and on the desktop alike, and the page reaches it over these routes. Types and names only, so the page never
 * loads host code.
 */

/** `GET` loads the draft, `POST { workspace }` stores one; `?verify=1` is the verification workspace's own file. */
export const WORKSPACE_ENDPOINT = "/api/workspace";
/** `POST`: sets an unreadable draft aside so the page can start with a fresh one. */
export const WORKSPACE_START_FRESH_ENDPOINT = "/api/workspace/start-fresh";
export const HOST_WORKSPACE_SCHEMA = "xfs/host-workspace-1";

/** The answer to a load. */
export type HostWorkspaceLoad = {
  readonly schema: typeof HOST_WORKSPACE_SCHEMA;
  /** The stored draft's text, or null when there is none. */
  readonly workspace: string | null;
  /**
   * The host has never held a draft (no file, and none was ever set aside): the page may hand over the draft an earlier build
   * kept in its browser storage, once.
   */
  readonly adoptBrowserDraft: boolean;
};

/** The answer to a load whose stored draft can't be shown (409): the file it was kept in. */
export type HostWorkspaceUnreadable = { readonly code: "workspace_unreadable"; readonly file: string };

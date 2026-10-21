/**
 * The workspace file's contract: the page's workspace draft lives in a file the host keeps (`platform/persistence/workspace-file.ts`),
 * on localhost and on the desktop alike, and the page reaches it over these routes. Types and names only, so the page never
 * loads host code.
 */

/**
 * `GET` loads the draft; `POST { workspace, writer? }` stores one (204, its revision in `WORKSPACE_REVISION_HEADER`); `?verify=1`
 * is the verification workspace's own file.
 */
export const WORKSPACE_ENDPOINT = "/api/workspace";
/** `POST`: sets an unreadable draft aside so the page can start with a fresh one. */
export const WORKSPACE_START_FRESH_ENDPOINT = "/api/workspace/start-fresh";
/** `POST WorkspaceAdoption`: hands over a draft the page kept (its journal, or an earlier build's browser draft); answers `WorkspaceAdopted`. */
export const WORKSPACE_ADOPT_ENDPOINT = "/api/workspace/adopt";
export const WORKSPACE_REVISION_HEADER = "X-XFS-Workspace-Revision";
export const HOST_WORKSPACE_SCHEMA = "xfs/host-workspace-1";
/**
 * Most UTF-16 code units of a draft the page journals in browser storage as it is (a larger one is journalled in a smaller
 * form): browser storage holds roughly five million per origin, shared by every key.
 */
export const WORKSPACE_JOURNAL_LIMIT = 2_000_000;

/** A page's write: its tab and the write's number in that tab, so the host knows a later draft from the same page. */
export type WorkspaceWriter = { readonly tab: string; readonly seq: number };

/** The answer to a load. */
export type HostWorkspaceLoad = {
  readonly schema: typeof HOST_WORKSPACE_SCHEMA;
  /** The stored draft's text, or null when there is none. */
  readonly workspace: string | null;
  /** The stored draft's revision (null when there is none). */
  readonly revision: string | null;
};

/**
 * A draft handed over. `base` is the revision the page last knew the host to hold (null: none, or an earlier build's browser
 * draft); `writer` the page write the draft came from.
 */
export type WorkspaceAdoption = { readonly workspace: string; readonly base: string | null; readonly writer?: WorkspaceWriter };

/**
 * What the host did with it, and the draft it now holds:
 * - `adopted`: it is the stored draft (the host had none, or nothing was stored since `base` but that page's own writes);
 * - `recovered`: the host kept its newer draft, and this one's collection draft is first in its recovery queue;
 * - `same`: the host already held it (as its draft or in its recovery queue);
 * - `kept`: the host couldn't take it (nothing recoverable in it, or the stored draft holds a newer build's data).
 */
export type WorkspaceAdopted = {
  readonly outcome: "adopted" | "recovered" | "same" | "kept";
  readonly workspace: string | null;
  readonly revision: string | null;
};

/** The answer to a load whose stored draft can't be shown (409): the file it was kept in. */
export type HostWorkspaceUnreadable = { readonly code: "workspace_unreadable"; readonly file: string };

/**
 * Profile sessions as workspace data (profiles design §1.1, §4.1): what a workspace holds per profile, and the profiles migration's mark
 * (§8 step 1). Plain typed data and its validation; no tab UI yet (phase 2) and no owner yet (`ProfileSessions`, phase 2).
 *
 * - **A session** (`xfs/profile-session-1`) holds the profile's layout tabs, its view graph (each view in one tab; each character scene
 *   naming the subject and the look it shows), focus, the closed-tab fragments (the last 5) and a sequence number.
 * - **A tab** holds its dock arrangement, whose panels are **panel instances** (`<type>--<base36>`, never reused), each with its type and
 *   binding. A view's panel is an instance of type `view`, pinned to its view.
 * - **The workspace keeps them under `profiles`**, beside the legacy fields, and the migration's mark under `migration`. An older build
 *   drops both when it saves (§2.4), so the next upgrade migrates again.
 * - **Forward reading:** unknown fields are kept.
 */
import type { DockLayout } from "../ui-preferences";
import type { SubjectRef } from "../../platform/api/subjects";
import type { LookRef } from "../../library/collection-documents";
import type { KeptView, StoredNode, ViewGraphData, ViewRecord } from "../../platform/api/view-graph";

export const PROFILE_SESSION_SCHEMA = "xfs/profile-session-1";
export const WORKSPACE_PROFILES_SCHEMA = "xfs/workspace-profiles-1";
/** The migration this build runs (§8). */
export const PROFILES_MIGRATION = "profiles-1";
/** How many closed-tab fragments a session keeps. */
export const CLOSED_TAB_LIMIT = 5;

export type TabId = string;
export type PanelBinding =
  | { readonly policy: "follow-focus" }
  | { readonly policy: "pinned"; readonly target: { readonly view: string } | { readonly scene: string } | { readonly subject: SubjectRef } | { readonly look: LookRef } };
/** A panel in a tab: its own ID (`<type>--<base36>`), its type (a panel contribution's ID, or `view`) and what it is bound to. */
export type PanelInstance = { readonly id: string; readonly type: string; readonly binding?: PanelBinding; readonly state?: unknown };
/** A layout tab: its arrangement (null: the feature default's), whose panel IDs are its instances' IDs. */
export type LayoutTab = { readonly id: TabId; readonly name: string; readonly origin?: string; readonly dock: DockLayout | null;
  readonly panels: readonly PanelInstance[] };
/** A scene node in a session: which subject and look it shows, and `gen`, raised whenever either changes. */
export type SessionScene = StoredNode & { readonly subject?: SubjectRef; readonly look?: LookRef; readonly gen: number };
export type SessionView = (ViewRecord | KeptView) & { readonly tab: TabId };
export type SessionViews = Omit<ViewGraphData, "views" | "scenes"> & { readonly views: readonly SessionView[]; readonly scenes: readonly SessionScene[] };
/**
 * Focus: each view's focus sequence number (the highest is the most recently focused), the focused panel instance, and the editing
 * context (§3.7): the history scope of the last editing interaction, where Undo goes.
 */
export type SessionFocus = { readonly views: Readonly<Record<string, number>>; readonly panel?: string; readonly editing?: string };
export type ProfileSessionData = {
  readonly schema: typeof PROFILE_SESSION_SCHEMA;
  readonly tabs: readonly LayoutTab[];
  readonly views: SessionViews;
  readonly focus: SessionFocus;
  readonly closed: readonly unknown[];
  readonly seq: number;
};
/** The workspace's sessions, by profile ID. */
export type WorkspaceProfiles = { readonly schema: typeof WORKSPACE_PROFILES_SCHEMA; readonly sessions: Readonly<Record<string, ProfileSessionData>> };
/**
 * The profiles migration's mark in the workspace (§8 step 1): written synchronously before the library transaction (`started`), and
 * `done` in the same write that stores the sessions.
 */
export type MigrationMark = { readonly id: typeof PROFILES_MIGRATION; readonly token: string; readonly state: "started" | "done" };

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
/** A migration token: a UUID. */
export const MIGRATION_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A panel instance ID: a panel ID, `--` and base 36 (dock panel IDs allow letters, digits, dots and dashes, at most 80). */
export const PANEL_INSTANCE_ID = /^[a-z0-9.-]{1,64}--[0-9a-z]{4,12}$/i;

export function migrationMarkOf(value: unknown): MigrationMark | undefined {
  if (!object(value) || value.id !== PROFILES_MIGRATION || typeof value.token !== "string" || !MIGRATION_TOKEN.test(value.token)) return undefined;
  return value.state === "done" || value.state === "started" ? { id: PROFILES_MIGRATION, token: value.token, state: value.state } : undefined;
}

const tabOf = (value: unknown): LayoutTab | null => {
  if (!object(value) || typeof value.id !== "string" || typeof value.name !== "string" || !Array.isArray(value.panels)) return null;
  if (value.dock !== null && !object(value.dock)) return null;
  const panels = value.panels.filter((panel): panel is PanelInstance => object(panel) && typeof panel.id === "string" && typeof panel.type === "string");
  return { ...value, panels } as unknown as LayoutTab;
};
/** A stored session, validated (null when it isn't one); unknown fields are kept. */
export function profileSessionOf(value: unknown): ProfileSessionData | null {
  if (!object(value) || value.schema !== PROFILE_SESSION_SCHEMA || !Array.isArray(value.tabs) || !object(value.views) || !object(value.focus)) return null;
  const views = value.views as Record<string, unknown>;
  if (!Array.isArray(views.views) || !Array.isArray(views.scenes)) return null;
  const tabs = value.tabs.map(tabOf);
  if (tabs.some(tab => !tab)) return null;
  const ids = new Set(tabs.map(tab => tab!.id));
  // Every view is in one of the session's tabs (structural references are always valid, §1.4).
  if ((views.views as unknown[]).some(view => !object(view) || typeof view.tab !== "string" || !ids.has(view.tab))) return null;
  return { ...value, tabs, closed: Array.isArray(value.closed) ? value.closed.slice(-CLOSED_TAB_LIMIT) : [],
    seq: Number.isSafeInteger(value.seq) ? value.seq : 0 } as unknown as ProfileSessionData;
}
/** The workspace's `profiles`, validated: sessions that don't read are left out (a session is rebuilt from the library's result). */
export function workspaceProfilesOf(value: unknown): WorkspaceProfiles | undefined {
  if (!object(value) || value.schema !== WORKSPACE_PROFILES_SCHEMA || !object(value.sessions)) return undefined;
  const sessions: Record<string, ProfileSessionData> = {};
  for (const [id, session] of Object.entries(value.sessions)) { const parsed = profileSessionOf(session); if (parsed) sessions[id] = parsed; }
  return { ...value, schema: WORKSPACE_PROFILES_SCHEMA, sessions } as WorkspaceProfiles;
}

/**
 * Profile sessions as workspace data (profiles design §1.1, §4.1, §5): what a workspace holds per profile, and the profiles migration's
 * mark (§8 step 1). Plain typed data and its validation; the window's `ProfileSessionState` holds one session and stores it back, and
 * `ProfileSessions` (its operations and the tab UI) comes with phase 2.
 *
 * - **Reading validates everything a later phase relies on:** tab IDs are unique; panel instance IDs have the instance grammar and are
 *   unique across the session (a duplicate is dropped: IDs are never reused); a binding is `follow-focus` or pinned to exactly one view,
 *   scene, subject or look (an unreadable one is dropped, so the instance follows its type's default); scenes' subject and look references
 *   are well formed and `gen` is a non-negative integer; focus is the focus service's (positive, unique view numbers no higher than `seq`).
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
import { focusDataOf } from "../../platform/core/focus";

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

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
/** A subject reference as stored (undefined: not one). */
const subjectOf = (value: unknown): SubjectRef | undefined => object(value) && text(value.kind) && text(value.id) ? { kind: value.kind, id: value.id } : undefined;
/** A look reference as stored (undefined: not one). */
const lookOf = (value: unknown): LookRef | undefined => object(value) && text(value.collection) && text(value.look) ? { collection: value.collection, look: value.look } : undefined;

/**
 * A panel binding as stored (§3.2), validated: `follow-focus`, or `pinned` to exactly one view, scene, subject or look. Undefined: none, or
 * one this build can't read; the instance then follows its type's default.
 */
export function panelBindingOf(value: unknown): PanelBinding | undefined {
  if (!object(value)) return undefined;
  if (value.policy === "follow-focus") return { policy: "follow-focus" };
  if (value.policy !== "pinned" || !object(value.target)) return undefined;
  const target = value.target, keys = ["view", "scene", "subject", "look"].filter(key => key in target);
  if (keys.length !== 1) return undefined;
  if (keys[0] === "view") return text(target.view) ? { policy: "pinned", target: { view: target.view } } : undefined;
  if (keys[0] === "scene") return text(target.scene) ? { policy: "pinned", target: { scene: target.scene } } : undefined;
  if (keys[0] === "subject") { const subject = subjectOf(target.subject); return subject ? { policy: "pinned", target: { subject } } : undefined; }
  const look = lookOf(target.look);
  return look ? { policy: "pinned", target: { look } } : undefined;
}
/**
 * A stored panel instance (§1.1), validated: its ID (`<type>--<base36>`) and type, its binding read by `panelBindingOf` (left out when
 * unreadable); unknown fields are kept. Null: not an instance.
 */
function panelInstanceOf(value: unknown): PanelInstance | null {
  if (!object(value) || !text(value.id) || !PANEL_INSTANCE_ID.test(value.id) || !text(value.type)) return null;
  const { binding: stored, ...rest } = value, binding = panelBindingOf(stored);
  return { ...rest, ...(binding ? { binding } : {}) } as unknown as PanelInstance;
}
/** A stored tab, validated; its instances are read one by one, and an instance ID another tab of the session took is dropped (IDs are never reused). */
const tabOf = (value: unknown, taken: Set<string>): LayoutTab | null => {
  if (!object(value) || !text(value.id) || typeof value.name !== "string" || !Array.isArray(value.panels)) return null;
  if (value.dock !== null && !object(value.dock)) return null;
  const panels = value.panels.flatMap(item => {
    const panel = panelInstanceOf(item);
    if (!panel || taken.has(panel.id)) return [];
    taken.add(panel.id);
    return [panel];
  });
  return { ...value, panels } as unknown as LayoutTab;
};
/** A stored scene's subject, look and `gen`, validated (an unreadable reference is left out; `gen` is a non-negative safe integer). */
const sceneOf = (value: unknown): unknown => {
  if (!object(value)) return value;
  const { subject: storedSubject, look: storedLook, gen, ...rest } = value, subject = subjectOf(storedSubject), look = lookOf(storedLook);
  return { ...rest, ...(subject ? { subject } : {}), ...(look ? { look } : {}), gen: Number.isSafeInteger(gen) && (gen as number) >= 0 ? gen : 0 };
};
/** A stored session, validated (null when it isn't one); unknown fields are kept. */
export function profileSessionOf(value: unknown): ProfileSessionData | null {
  if (!object(value) || value.schema !== PROFILE_SESSION_SCHEMA || !Array.isArray(value.tabs) || !object(value.views) || !object(value.focus)) return null;
  const views = value.views as Record<string, unknown>;
  if (!Array.isArray(views.views) || !Array.isArray(views.scenes)) return null;
  const taken = new Set<string>(), tabs = value.tabs.map(tab => tabOf(tab, taken));
  if (tabs.some(tab => !tab)) return null;
  const ids = new Set(tabs.map(tab => tab!.id));
  if (ids.size !== tabs.length) return null;
  // Every view is in one of the session's tabs (structural references are always valid, §1.4).
  if ((views.views as unknown[]).some(view => !object(view) || typeof view.tab !== "string" || !ids.has(view.tab))) return null;
  // Focus as the focus service reads it (platform/core/focus.ts): the sequence is never below a view's number.
  const { seq, ...focus } = focusDataOf(value.focus, value.seq), { views: _views, panel: _panel, editing: _editing, ...unknown } = value.focus;
  return { ...value, tabs, views: { ...views, scenes: (views.scenes as unknown[]).map(sceneOf) }, focus: { ...unknown, ...focus },
    closed: Array.isArray(value.closed) ? value.closed.slice(-CLOSED_TAB_LIMIT) : [], seq } as unknown as ProfileSessionData;
}
/** The workspace's `profiles`, validated: sessions that don't read are left out (a session is rebuilt from the library's result). */
export function workspaceProfilesOf(value: unknown): WorkspaceProfiles | undefined {
  if (!object(value) || value.schema !== WORKSPACE_PROFILES_SCHEMA || !object(value.sessions)) return undefined;
  const sessions: Record<string, ProfileSessionData> = {};
  for (const [id, session] of Object.entries(value.sessions)) { const parsed = profileSessionOf(session); if (parsed) sessions[id] = parsed; }
  return { ...value, schema: WORKSPACE_PROFILES_SCHEMA, sessions } as WorkspaceProfiles;
}

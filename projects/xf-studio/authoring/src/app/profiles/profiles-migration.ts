/**
 * The `profiles-1` migration's workspace side (profiles design §8 steps 1, 3 and 4), run once per workspace (the normal one and a
 * `?verify=1` one apart) by the window holding its lease:
 *
 * 1. **Token.** The workspace records `{ id: "profiles-1", token, state: "started" }` in one synchronous write before anything is sent.
 * 2. **The library transaction** (`/api/profiles/migrate`) gets the workspace's snapshot under that token; its record answers a resend,
 *    so a resumed run duplicates nothing. A failed send is retried (the token makes that safe) until the page ends.
 * 3. **Session.** The result is checked against the snapshot it was made from (its digest) and against the workspace now: a result of an
 *    earlier snapshot (a lost answer, then a resend after edits) or a workspace changed since the capture is migrated again under a new
 *    token, so nothing edited meanwhile is left out. Then the workspace builds the profile's session from the result and records it with
 *    `state: "done"` in one synchronous write.
 * 4. **Resume.** A run that ended after the token resends under it (before the commit, the library runs it; after, it answers the
 *    record); one that ended after the answer builds the session again. A `done` workspace does nothing.
 * 5. **Downgrade.** An older build drops `migration` and `profiles` when it saves, so the next run migrates again under a new token.
 *
 * Until the Studio moves onto the profile services (phase 1d-ii) nothing reads the session; the legacy fields stay the Studio's own, and
 * migrating changes nothing it shows.
 */
import type { DocumentModel } from "../workspace/collection-workspace";
import type { WorkspaceState } from "../workspace/workspace-state";
import { type MigrationMark, PROFILES_MIGRATION, type WorkspaceProfiles } from "./profile-session";
import { buildProfileSession, type MigrationAnswer, type MigrationRequest, type MigrationSnapshot, migrationSnapshot, snapshotDigest, workspaceProfiles } from "./profiles-migration-data";

/** The workspace-side protocol points (the crash harness's kill points). */
export const WORKSPACE_POINTS = ["w-token", "w-sent", "w-response", "w-done"] as const;
export type WorkspacePoint = typeof WORKSPACE_POINTS[number];
export type ProfilesMigrationOutcome = "done" | "already" | "stopped";

export type ProfilesMigrationDeps = {
  /** The first tab's contributed arrangement, used only when there is no legacy arrangement to preserve. */
  readonly initial?: { origin: string; dock: import("../ui-preferences").DockLayout };
  /** The workspace's identity (its lease key). */
  readonly workspace: string;
  readonly model: DocumentModel;
  /** The workspace as it is now (what it would store). */
  state(): WorkspaceState;
  /**
   * Records the mark and sessions in the workspace in one synchronous write; answers whether they are stored (false: this window may not
   * write, or storage refused: the run stops and starts again next time).
   */
  record(marks: { migration: MigrationMark; profiles?: WorkspaceProfiles }): boolean;
  /** The library transaction; throws when the host can't be reached (it is sent again). */
  send(request: MigrationRequest, signal: AbortSignal): Promise<MigrationAnswer>;
  readonly newToken?: () => string;
  readonly random?: () => number;
  /** Waits between sends (tests and harnesses shorten it). */
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly report?: (error: unknown) => void;
  /** Crash harnesses only: runs at each workspace-side point. */
  readonly point?: (at: WorkspacePoint) => void;
};

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  const timer = setTimeout(done, ms);
  function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }
  signal.addEventListener("abort", done, { once: true });
});
/** How many runs one page load makes while the workspace keeps changing under it (it tries again at the next load). */
export const RECONCILE_ROUNDS = 4;
/** The waits between sends: quick at first, then every 30 s. */
export const RETRY_MS = [500, 1_000, 2_000, 5_000, 10_000, 30_000] as const;

/** Whether the workspace already holds its migrated sessions. */
export const migrated = (state: Pick<WorkspaceState, "migration" | "profiles">) =>
  state.migration?.state === "done" && !!state.profiles && Object.keys(state.profiles.sessions).length > 0;

export class ProfilesMigration {
  private running: Promise<ProfilesMigrationOutcome> | null = null;
  constructor(private readonly deps: ProfilesMigrationDeps) {}

  /** Runs the migration once (a second call while it runs joins it). */
  run(signal: AbortSignal): Promise<ProfilesMigrationOutcome> {
    this.running ??= this.steps(signal).finally(() => { this.running = null; });
    return this.running;
  }

  private async steps(signal: AbortSignal): Promise<ProfilesMigrationOutcome> {
    const { deps } = this, point = deps.point ?? (() => {});
    const now = deps.state();
    if (migrated(now)) return "already";
    // 1. The token, stored before anything is sent; a run that was started resumes under its own (a `done` mark without sessions is an
    // older build's leftover, or sessions this build couldn't read: a new run, which only adds its record when nothing changed).
    let mark = now.migration?.state === "started" ? now.migration : undefined;
    for (let round = 0; ; round++) {
      if (!mark) {
        mark = { id: PROFILES_MIGRATION, token: (deps.newToken ?? (() => crypto.randomUUID()))(), state: "started" };
        if (!deps.record({ migration: mark })) return "stopped";
      }
      point("w-token");
      // 2. The library transaction, sent until it answers.
      let answer: MigrationAnswer | undefined, snapshot: MigrationSnapshot | undefined, digest = "";
      for (let attempt = 0; !signal.aborted; attempt++) {
        try {
          snapshot = migrationSnapshot(deps.state(), deps.model, deps.workspace);
          digest = snapshotDigest(snapshot);
          const sent = deps.send({ token: mark.token, digest, snapshot }, signal);
          point("w-sent");
          answer = await sent;
          break;
        } catch (error) {
          if (signal.aborted) break;
          if (attempt === 0) deps.report?.(error);
          await (deps.wait ?? sleep)(RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]!, signal);
        }
      }
      if (!answer || !snapshot || signal.aborted) return "stopped";
      if (!answer.ok) {
        if (answer.reason === "refused") deps.report?.(Error(answer.message ?? "The library refused the profiles migration."));
        return "stopped";
      }
      point("w-response");
      // 3. Reconcile: the result must be this snapshot's (a resend under the token is answered from the first commit's record), and the
      // workspace must not have changed since it was captured. Otherwise what changed is migrated again under a new token (the same
      // rules: unchanged content is reused, changed content forks), so `done` never stands for less than the workspace holds.
      const state = deps.state();
      if (answer.result.digest !== digest || JSON.stringify(migrationSnapshot(state, deps.model, deps.workspace)) !== JSON.stringify(snapshot)) {
        if (round + 1 >= RECONCILE_ROUNDS) return "stopped";
        mark = undefined;
        continue;
      }
      // The session, and `done`, in one write.
      const session = buildProfileSession(state, snapshot, answer.result, deps.random, deps.initial);
      if (!deps.record({ migration: { ...mark, state: "done" }, profiles: workspaceProfiles(answer.result.profile, session) })) return "stopped";
      break;
    }
    point("w-done");
    return "done";
  }
}

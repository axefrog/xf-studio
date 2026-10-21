/**
 * The workspace draft's one home on both hosts: a file in the host's data folder (`workspace.json`, and
 * `verification-workspace.json` for a `?verify` workspace), so the draft survives a restart, a changed loopback port and
 * cleared browser storage. Each write goes to a new file beside it, is flushed to the disk (off the host's thread), and is
 * renamed over the old one, so the file is always one whole draft.
 *
 * **One queue per file.** Loads, writes, hand-overs and Start fresh of one workspace run one at a time in the order they
 * arrived, so a page that reloads while its last write is on its way loads that write, never the file before it.
 *
 * **Revisions and hand-overs.** A stored draft's revision is its text's hash. A page that kept a draft the host may not have
 * (its journal after a reload or a closed tab, or an earlier build's browser draft) hands it over with the revision it last
 * knew (`adopt`). In one step, the draft becomes the stored one when the host has none, or when nothing was stored since that
 * revision but that page's own earlier writes; otherwise the host keeps its own draft and files the other's collection draft
 * first in its recovery queue ("Recover previous draft"), so neither is lost.
 *
 * What a draft means is the workspace format's business, injected as a `WorkspaceCodec`. The file itself guarantees:
 *
 * - a draft whose current state can't be shown is never overwritten; Start fresh renames it aside, never deletes it;
 * - a draft holding a newer build's data is never replaced;
 * - the version-1 file an older build wrote is kept as `workspace.v1.bak` before it is replaced (downgrade protection).
 */
import { copyFileSync, existsSync, mkdirSync, promises, readFileSync, renameSync, rmSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { HOST_WORKSPACE_SCHEMA, WORKSPACE_ADOPT_ENDPOINT, WORKSPACE_REVISION_HEADER, WORKSPACE_START_FRESH_ENDPOINT, type HostWorkspaceLoad,
  type WorkspaceAdopted, type WorkspaceWriter } from "../api/workspace-file";

/** Most bytes of one stored workspace. */
export const WORKSPACE_FILE_BYTES = 16_000_000;

/** The workspace format, as the file needs it (the composition root builds it from `workspace-state.ts`). */
export type WorkspaceCodec = {
  /**
   * Whether a stored draft holds a newer build's data outside its current state (shown read-only, never replaced). Throws
   * when its current state can't be shown at all (damaged, or a newer build's).
   */
  inspect(value: unknown): { newer: boolean };
  /** A draft from the page, in this build's stored form (throws when it isn't a draft this build can store). */
  stored(value: unknown): unknown;
  /**
   * `current` (a stored draft) with `other`'s collection draft first in its recovery queue, in the stored form; `"same"` when
   * `current` already holds that draft (as its own or in its queue); null when `other` holds nothing recoverable.
   */
  recovered(current: unknown, other: unknown): unknown | "same" | null;
  /** The stored schema of drafts this build writes, and the version-1 schema an older build wrote. */
  readonly schema: string;
  readonly legacySchema: string;
};

/** The workspace file's answer to a page's load. */
export type WorkspaceLoad = { readonly text: string | null; readonly revision: string | null };

/** A stored draft's revision: its text's hash. */
export const workspaceRevision = (text: string) => Bun.hash(text).toString(36);

export class WorkspaceFile {
  private readonly root: string;
  /** By file: the text this file last wrote, or loaded and found readable without newer data, so it isn't parsed again (CORE-41). */
  private readonly known = new Map<string, { text: string; schema: unknown }>();
  /** By file: the last operation queued; the next waits for it. */
  private readonly queue = new Map<string, Promise<unknown>>();
  /** By file: the page write that made the stored draft, while this host runs. */
  private readonly writers = new Map<string, WorkspaceWriter & { revision: string }>();

  constructor(dataRoot: string, private readonly codec: WorkspaceCodec) {
    if (!isAbsolute(dataRoot)) throw Error("The workspace folder must be absolute.");
    this.root = resolve(dataRoot);
  }

  /** The file name a workspace is stored in (a Start fresh keeps an unreadable one beside it under another name). */
  fileName(verification: boolean) { return verification ? "verification-workspace.json" : "workspace.json"; }
  /**
   * Where a build that writes this build's schema keeps the version-1 file it replaces, so an older XF Studio (0.1.0-alpha.1
   * reads only version 1) can be given it back. Refreshed whenever a version-1 file is replaced (CORE-30).
   */
  backupName(verification: boolean) { return verification ? "verification-workspace.v1.bak" : "workspace.v1.bak"; }
  private path(verification: boolean) { return resolve(this.root, this.fileName(verification)); }
  private stem(verification: boolean) { return verification ? "verification-workspace" : "workspace"; }

  /** Runs `work` after every earlier operation on that workspace's file. */
  private queued<T>(verification: boolean, work: () => T | Promise<T>): Promise<T> {
    const path = this.path(verification);
    const next = (this.queue.get(path) ?? Promise.resolve()).catch(() => {}).then(work);
    this.queue.set(path, next);
    void next.catch(() => {}).finally(() => { if (this.queue.get(path) === next) this.queue.delete(path); });
    return next;
  }

  /**
   * The stored draft, after every write on its way. It loads whenever its current state is readable, as the page's own restore
   * needs: damaged recovery entries are dropped there, and a draft holding a newer build's data elsewhere opens read-only and
   * is never replaced (CORE-27). Rejects only when the current state itself can't be shown, so Start fresh never sets a good
   * draft aside.
   */
  load(verification: boolean): Promise<WorkspaceLoad> {
    return this.queued(verification, () => {
      const text = this.read(verification);
      if (text !== null) this.inspect(verification, text);
      return { text, revision: text === null ? null : workspaceRevision(text) };
    });
  }

  /** The stored text, unchecked, or null when there is none. */
  private read(verification: boolean): string | null {
    const path = this.path(verification);
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    if (Buffer.byteLength(raw) > WORKSPACE_FILE_BYTES) throw Error("The saved workspace exceeds the size limit.");
    return raw;
  }

  /** Whether stored text holds a newer build's data; throws when its current state is unreadable. Text already checked isn't parsed again. */
  private inspect(verification: boolean, raw: string): { newer: boolean; schema: unknown } {
    const path = this.path(verification), known = this.known.get(path);
    if (known?.text === raw) return { newer: false, schema: known.schema };
    const value = JSON.parse(raw) as unknown, schema = (value as { schema?: unknown } | null)?.schema;
    const { newer } = this.codec.inspect(value);
    if (!newer) this.known.set(path, { text: raw, schema });
    return { newer, schema };
  }

  /** Start fresh after an unreadable draft: rename it aside (never delete it). Answers the name it was kept under, or null when the draft is readable or missing. */
  startFresh(verification: boolean, now = new Date()): Promise<string | null> {
    return this.queued(verification, () => {
      const path = this.path(verification), text = this.read(verification);
      if (text === null) return null;
      try { this.inspect(verification, text); return null; } catch { /* Unreadable: set it aside. */ }
      const kept = `${this.stem(verification)}.broken-${now.toISOString().replace(/[:.]/g, "-")}.json`;
      renameSync(path, resolve(this.root, kept));
      this.known.delete(path);
      this.writers.delete(path);
      return kept;
    });
  }

  /**
   * Replaces the stored draft with `raw`, in this build's stored form, and answers its revision. Refused (the file kept as it is)
   * when the stored draft is unreadable or holds a newer build's data, or `raw` isn't a draft. An unchanged draft isn't rewritten.
   */
  save(verification: boolean, raw: string, writer?: WorkspaceWriter): Promise<string> {
    return this.queued(verification, () => this.write(verification, raw, writer));
  }

  /**
   * Hands over a draft the page kept (`WorkspaceAdopted` in platform/api/workspace-file.ts). `base`: the revision the page last
   * knew the host to hold (null for none); `writer`: the page write it came from. Rejects when the stored draft is unreadable
   * or `raw` isn't a draft.
   */
  adopt(verification: boolean, raw: string, base: string | null, writer?: WorkspaceWriter): Promise<WorkspaceAdopted> {
    return this.queued(verification, async (): Promise<WorkspaceAdopted> => {
      const path = this.path(verification), current = this.read(verification);
      const answer = (outcome: WorkspaceAdopted["outcome"]): WorkspaceAdopted => {
        const text = this.read(verification);
        return { outcome, workspace: text, revision: text === null ? null : workspaceRevision(text) };
      };
      const value = JSON.parse(raw) as unknown;
      if (current === null) { await this.write(verification, raw, writer); return answer("adopted"); }
      const prior = this.inspect(verification, current), revision = workspaceRevision(current);
      if (current === raw) return answer("same");
      if (prior.newer) return answer("kept");
      const last = this.writers.get(path);
      const ownLater = !!writer && last?.revision === revision && last.tab === writer.tab && last.seq < writer.seq;
      if (base === revision || ownLater) { await this.write(verification, raw, writer); return answer("adopted"); }
      const merged = this.codec.recovered(JSON.parse(current), value);
      if (merged === "same") return answer("same");
      if (merged === null) return answer("kept");
      await this.store(verification, JSON.stringify(merged), prior.schema);
      return answer("recovered");
    });
  }

  private async write(verification: boolean, raw: string, writer?: WorkspaceWriter): Promise<string> {
    if (Buffer.byteLength(raw) > WORKSPACE_FILE_BYTES) throw Error("The workspace exceeds the size limit.");
    const path = this.path(verification), previous = this.read(verification);
    // An unchanged copy (the update flush of a read-only workspace) is not a change.
    if (previous !== null && previous === raw) {
      const revision = workspaceRevision(raw);
      if (writer) this.writers.set(path, { ...writer, revision });
      return revision;
    }
    const prior = previous === null ? undefined : this.inspect(verification, previous);
    if (prior?.newer) throw Error("The saved workspace holds data from a newer XF Studio; it was not replaced.");
    const text = JSON.stringify(this.codec.stored(JSON.parse(raw)));
    await this.store(verification, text, prior?.schema);
    const revision = workspaceRevision(text);
    if (writer) this.writers.set(path, { ...writer, revision }); else this.writers.delete(path);
    return revision;
  }

  /** Writes `text` (this build's stored form) over the file: beside it, flushed, renamed into place. */
  private async store(verification: boolean, text: string, priorSchema: unknown): Promise<void> {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const path = this.path(verification), temporary = resolve(this.root, `.workspace-${crypto.randomUUID()}.tmp`);
    // Downgrade protection: a version-1 file an older build wrote is kept beside it before it is replaced.
    if (priorSchema === this.codec.legacySchema) copyFileSync(path, resolve(this.root, this.backupName(verification)));
    try {
      const handle = await promises.open(temporary, "wx", 0o600);
      try { await handle.writeFile(text, "utf8"); await handle.sync(); } finally { await handle.close(); }
      renameSync(temporary, path);
      this.known.set(path, { text, schema: this.codec.schema });
      this.writers.delete(path);
    } finally { rmSync(temporary, { force: true }); }
  }
}

/** The hosts a local Studio page is served from. */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const noStore = { "Cache-Control": "no-store" };
const isWriter = (value: unknown): value is WorkspaceWriter => !!value && typeof value === "object" &&
  typeof (value as WorkspaceWriter).tab === "string" && (value as WorkspaceWriter).tab.length <= 64 && Number.isSafeInteger((value as WorkspaceWriter).seq);

/**
 * The page's workspace routes, on both hosts (platform/api/workspace-file.ts): `GET /api/workspace` answers the stored draft
 * and its revision (409 `{ code: "workspace_unreadable", file }` when it can't be shown), `POST /api/workspace` stores a draft
 * (204, the revision in a header; 422 when refused, the file kept), `POST /api/workspace/adopt` hands one over, and
 * `POST /api/workspace/start-fresh` sets an unreadable draft aside (`{ keptAs }`). `?verify=1` selects the verification
 * workspace's file. Local, same-origin pages only.
 */
export async function workspaceRequest(request: Request, file: WorkspaceFile, url = new URL(request.url)): Promise<Response> {
  const verification = url.searchParams.has("verify"), origin = request.headers.get("Origin");
  if (!LOCAL_HOSTS.has(url.hostname) || (origin && origin !== url.origin)) return Response.json({ error: "Local studio requests only." }, { status: 403 });
  const unreadable = () => Response.json({ code: "workspace_unreadable", file: file.fileName(verification),
    error: "The saved workspace is unreadable; its file was kept." }, { status: 409, headers: noStore });
  if (request.method === "GET" && url.pathname !== WORKSPACE_START_FRESH_ENDPOINT && url.pathname !== WORKSPACE_ADOPT_ENDPOINT) {
    try {
      const { text, revision } = await file.load(verification);
      const answer: HostWorkspaceLoad = { schema: HOST_WORKSPACE_SCHEMA, workspace: text, revision };
      return Response.json(answer, { headers: noStore });
    } catch { return unreadable(); }
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (origin !== url.origin) return Response.json({ error: "Use the local studio." }, { status: 403 });
  if (url.pathname === WORKSPACE_START_FRESH_ENDPOINT) {
    try { return Response.json({ keptAs: await file.startFresh(verification) }); }
    catch { return Response.json({ error: "The old workspace could not be set aside." }, { status: 500 }); }
  }
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") return new Response("Expected JSON", { status: 415 });
  let body: { workspace?: unknown; base?: unknown; writer?: unknown };
  try { body = await request.json() as typeof body; } catch { return new Response("Invalid workspace", { status: 400 }); }
  if (typeof body?.workspace !== "string") return new Response("Invalid workspace", { status: 400 });
  const writer = isWriter(body.writer) ? body.writer : undefined;
  if (url.pathname === WORKSPACE_ADOPT_ENDPOINT) {
    if (body.base !== null && typeof body.base !== "string") return new Response("Invalid workspace", { status: 400 });
    try { return Response.json(await file.adopt(verification, body.workspace, body.base, writer), { headers: noStore }); }
    catch {
      try { await file.load(verification); } catch { return unreadable(); }
      return Response.json({ error: "That draft couldn't be handed over; the saved workspace was kept." }, { status: 422 });
    }
  }
  try {
    const revision = await file.save(verification, body.workspace, writer);
    return new Response(null, { status: 204, headers: { [WORKSPACE_REVISION_HEADER]: revision } });
  } catch {
    return Response.json({ error: "The workspace was not saved; the previous file was kept." }, { status: 422 });
  }
}

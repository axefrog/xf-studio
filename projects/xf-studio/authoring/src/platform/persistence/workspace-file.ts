/**
 * The workspace draft's one home on both hosts: a file in the host's data folder (`workspace.json`, and
 * `verification-workspace.json` for a `?verify` workspace), so the draft survives a restart, a changed loopback port and
 * cleared browser storage. Each write goes to a new file beside it, is flushed to the disk, and is renamed over the old one,
 * so the file is always one whole draft. Writes to a file run one at a time, and the disk's flush runs off the host's
 * thread.
 *
 * What a draft means is the workspace format's business, injected as a `WorkspaceCodec`: whether the stored draft can be
 * shown (a damaged one, or one from a newer build, can't), whether it holds a newer build's data elsewhere (then it is never
 * replaced), and this build's stored form of a draft the page sends. The file itself guarantees:
 *
 * - a draft whose current state can't be shown is never overwritten; Start fresh renames it aside, never deletes it;
 * - a draft holding a newer build's data is never replaced;
 * - the version-1 file an older build wrote is kept as `workspace.v1.bak` before it is replaced (downgrade protection).
 */
import { copyFileSync, existsSync, mkdirSync, promises, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { HOST_WORKSPACE_SCHEMA, WORKSPACE_START_FRESH_ENDPOINT, type HostWorkspaceLoad } from "../api/workspace-file";

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
  /** The stored schema of drafts this build writes, and the version-1 schema an older build wrote. */
  readonly schema: string;
  readonly legacySchema: string;
};

/** The workspace file's answer to a page's load. */
export type WorkspaceLoad = {
  /** The stored draft's text, or null when there is none. */
  readonly text: string | null;
  /**
   * The host has never held a draft (no file, and none was ever set aside): the page may hand over the draft an earlier
   * build kept in its browser storage. False once a draft was stored or set aside, so an old browser copy never comes back.
   */
  readonly adoptBrowserDraft: boolean;
};

export class WorkspaceFile {
  private readonly root: string;
  /** By file: the text this file last wrote, or loaded and found readable without newer data, so it isn't parsed again (CORE-41). */
  private readonly known = new Map<string, { text: string; schema: unknown }>();
  /** By file: the write on its way; the next waits for it. */
  private readonly writing = new Map<string, Promise<void>>();

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

  /**
   * The stored draft. It loads whenever its current state is readable, as the page's own restore needs: damaged recovery
   * entries are dropped there, and a draft holding a newer build's data elsewhere opens read-only and is never replaced
   * (CORE-27). Throws only when the current state itself can't be shown, so Start fresh never sets a good draft aside.
   */
  load(verification: boolean): WorkspaceLoad {
    const text = this.read(verification);
    if (text !== null) this.inspect(verification, text);
    return { text, adoptBrowserDraft: text === null && !this.setAsideBefore(verification) };
  }

  /** Whether a draft was ever set aside here (Start fresh). */
  private setAsideBefore(verification: boolean): boolean {
    if (!existsSync(this.root)) return false;
    const prefix = `${this.stem(verification)}.broken-`;
    return readdirSync(this.root).some(name => name.startsWith(prefix) && name.endsWith(".json"));
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

  /** Start fresh after an unreadable draft: rename it aside (never delete it), so the person or a later version can recover it. */
  setAside(verification: boolean, now = new Date()): string | null {
    const path = this.path(verification);
    if (!existsSync(path)) return null;
    const kept = `${this.stem(verification)}.broken-${now.toISOString().replace(/[:.]/g, "-")}.json`;
    renameSync(path, resolve(this.root, kept));
    this.known.delete(path);
    return kept;
  }

  /**
   * Replaces the stored draft with `raw`, in this build's stored form. Refused (the file kept as it is) when the stored draft is
   * unreadable or holds a newer build's data, or `raw` isn't a draft. An unchanged draft isn't rewritten.
   */
  save(verification: boolean, raw: string): Promise<void> {
    const path = this.path(verification);
    const next = (this.writing.get(path) ?? Promise.resolve()).catch(() => {}).then(() => this.write(verification, raw));
    this.writing.set(path, next);
    void next.finally(() => { if (this.writing.get(path) === next) this.writing.delete(path); }).catch(() => {});
    return next;
  }

  private async write(verification: boolean, raw: string): Promise<void> {
    if (Buffer.byteLength(raw) > WORKSPACE_FILE_BYTES) throw Error("The workspace exceeds the size limit.");
    const previous = this.read(verification);
    // An unchanged copy (the update flush of a read-only workspace) is not a change.
    if (previous !== null && previous === raw) return;
    const prior = previous === null ? undefined : this.inspect(verification, previous);
    if (prior?.newer) throw Error("The saved workspace holds data from a newer XF Studio; it was not replaced.");
    const text = JSON.stringify(this.codec.stored(JSON.parse(raw)));
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const path = this.path(verification), temporary = resolve(this.root, `.workspace-${crypto.randomUUID()}.tmp`);
    // Downgrade protection: a version-1 file an older build wrote is kept beside it before it is replaced.
    if (prior?.schema === this.codec.legacySchema) copyFileSync(path, resolve(this.root, this.backupName(verification)));
    try {
      const handle = await promises.open(temporary, "wx", 0o600);
      try { await handle.writeFile(text, "utf8"); await handle.sync(); } finally { await handle.close(); }
      renameSync(temporary, path);
      this.known.set(path, { text, schema: this.codec.schema });
    } finally { rmSync(temporary, { force: true }); }
  }
}

/** The hosts a local Studio page is served from. */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const noStore = { "Cache-Control": "no-store" };

/**
 * The page's workspace routes, on both hosts: `GET /api/workspace` answers `{ schema, workspace, adoptBrowserDraft }` (409
 * `{ code: "workspace_unreadable", file }` when the stored draft can't be shown), `POST /api/workspace` with `{ workspace }`
 * stores a draft (204; 422 when refused, the file kept), and `POST /api/workspace/start-fresh` sets an unreadable draft aside
 * (`{ keptAs }`). `?verify=1` selects the verification workspace's file. Local, same-origin pages only.
 */
export async function workspaceRequest(request: Request, file: WorkspaceFile, url = new URL(request.url)): Promise<Response> {
  const verification = url.searchParams.has("verify"), origin = request.headers.get("Origin");
  if (!LOCAL_HOSTS.has(url.hostname) || (origin && origin !== url.origin)) return Response.json({ error: "Local studio requests only." }, { status: 403 });
  if (url.pathname === WORKSPACE_START_FRESH_ENDPOINT) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (origin !== url.origin) return Response.json({ error: "Use the local studio." }, { status: 403 });
    try { file.load(verification); return Response.json({ keptAs: null }); }
    catch { /* Unreadable: set it aside below. */ }
    try { return Response.json({ keptAs: file.setAside(verification) }); }
    catch { return Response.json({ error: "The old workspace could not be set aside." }, { status: 500 }); }
  }
  if (request.method === "GET") {
    try {
      const { text, adoptBrowserDraft } = file.load(verification);
      const answer: HostWorkspaceLoad = { schema: HOST_WORKSPACE_SCHEMA, workspace: text, adoptBrowserDraft };
      return Response.json(answer, { headers: noStore });
    } catch {
      return Response.json({ code: "workspace_unreadable", file: file.fileName(verification),
        error: "The saved workspace is unreadable; its file was kept." }, { status: 409, headers: noStore });
    }
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (origin !== url.origin) return Response.json({ error: "Use the local studio." }, { status: 403 });
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") return new Response("Expected JSON", { status: 415 });
  try {
    const value = await request.json() as { workspace?: unknown };
    if (typeof value?.workspace !== "string") return new Response("Invalid workspace", { status: 400 });
    await file.save(verification, value.workspace);
    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: "The workspace was not saved; the previous file was kept." }, { status: 422 });
  }
}

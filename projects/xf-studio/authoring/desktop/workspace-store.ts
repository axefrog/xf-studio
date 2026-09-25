import { randomUUID } from "node:crypto";
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { DocumentModel } from "../src/collection-workspace";
import { isNewerData } from "../src/platform/api";
import { parseWorkspace, serializeWorkspace, storesLookLevelHistory, WORKSPACE_1, WORKSPACE_2 } from "../src/workspace-state";

const maxWorkspaceBytes = 16_000_000;

/** Fixed, host-owned workspace files survive the desktop server's changing loopback port. */
export class DesktopWorkspaceStore {
  private readonly root: string;
  /**
   * By file: the text this store last wrote, or loaded and found readable without newer data. A save
   * over that exact text needs no second parse of it (CORE-41).
   */
  private readonly known = new Map<string, { text: string; schema: unknown }>();
  /** `model` is the document model the workspace is read and written with (injected by the desktop server root). */
  constructor(dataRoot: string, private readonly model: DocumentModel) {
    if (!isAbsolute(dataRoot)) throw Error("Desktop workspace root must be absolute.");
    this.root = resolve(dataRoot);
  }
  private path(verification: boolean) {
    return resolve(this.root, verification ? "verification-workspace.json" : "workspace.json");
  }
  /**
   * The stored workspace text, or null when there is none. It loads whenever its current draft is
   * readable, as the renderer's own restore needs: damaged recovery entries are dropped there, and a
   * workspace holding a newer build's data elsewhere opens read-only and is never replaced (CORE-27).
   * Throws only when the current draft itself cannot be shown (damaged, or from a newer build), so
   * Start fresh never sets a good current draft aside.
   */
  load(verification: boolean): string | null {
    const raw = this.read(verification);
    if (raw !== null) this.inspect(verification, raw);
    return raw;
  }
  /** The stored text, unchecked, or null when there is none. */
  private read(verification: boolean): string | null {
    const path = this.path(verification);
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    if (Buffer.byteLength(raw) > maxWorkspaceBytes) throw Error("Saved desktop workspace exceeds the size limit.");
    return raw;
  }
  /**
   * Whether stored text holds a newer build's data; throws when its current draft is unreadable.
   * Text this store already checked (or wrote) is not parsed again.
   */
  private inspect(verification: boolean, raw: string): { newer: boolean; schema: unknown } {
    const path = this.path(verification), known = this.known.get(path);
    if (known?.text === raw) return { newer: false, schema: known.schema };
    const value = JSON.parse(raw), schema = (value as { schema?: unknown } | null)?.schema;
    // Looks holding a newer build's data are kept verbatim and locked (step 5): such a workspace is writable.
    try { parseWorkspace(value, this.model, [], "keep"); }
    catch (error) {
      if (!isNewerData(error)) throw error;
      parseWorkspace(value, this.model, [], "omit");
      return { newer: true, schema };
    }
    this.known.set(path, { text: raw, schema });
    return { newer: false, schema };
  }
  /**
   * Where a build that writes `xfs/workspace-2` keeps the `xfas/workspace-1` file it replaces, so an
   * older XF Studio (0.1.0-alpha.1 reads only version 1) can be given it back. Refreshed whenever a
   * version-1 file is replaced, so it always holds the latest one an older build wrote (CORE-30).
   */
  backupName(verification: boolean) { return verification ? "verification-workspace.v1.bak" : "workspace.v1.bak"; }
  /** The file name a Start fresh keeps the unreadable workspace under. */
  fileName(verification: boolean) { return verification ? "verification-workspace.json" : "workspace.json"; }
  /**
   * Start fresh after an unreadable (damaged or newer-version) workspace: rename it aside,
   * never delete it, so the user or a later version can still recover it.
   */
  setAside(verification: boolean, now = new Date()): string | null {
    const path = this.path(verification);
    if (!existsSync(path)) return null;
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const kept = `${verification ? "verification-workspace" : "workspace"}.broken-${stamp}.json`;
    renameSync(path, resolve(this.root, kept));
    return kept;
  }
  /**
   * Replace the stored workspace with `raw`, parsed and written in this build's form. The previous
   * file and the new text are each parsed at most once (CORE-41). Histories the renderer stored in the
   * look-level form (its storage budget's choice) stay in that form (CORE-39).
   */
  save(verification: boolean, raw: string): void {
    if (Buffer.byteLength(raw) > maxWorkspaceBytes) throw Error("Desktop workspace exceeds the size limit.");
    const previous = this.read(verification);
    // An unchanged copy (the update flush of a read-only workspace) is not a change.
    if (previous !== null && previous === raw) return;
    // Refuse to replace an unreadable prior draft (the user can recover its file), or one holding a newer build's data.
    const prior = previous === null ? undefined : this.inspect(verification, previous);
    if (prior?.newer) throw Error("The saved desktop workspace holds data from a newer XF Studio; it was not replaced.");
    const value = JSON.parse(raw), parsed = parseWorkspace(value, this.model, undefined, "keep");
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const path = this.path(verification), temporary = resolve(this.root, `.workspace-${randomUUID()}.tmp`);
    // Downgrade protection: a version-1 file an older build wrote is kept beside it before it is replaced.
    const backup = resolve(this.root, this.backupName(verification));
    if (prior?.schema === WORKSPACE_1)
      copyFileSync(path, backup);
    const text = JSON.stringify(serializeWorkspace(parsed, this.model, { lookLevel: storesLookLevelHistory(value) }));
    try {
      writeFileSync(temporary, text, { mode: 0o600, flag: "wx" });
      const handle = openSync(temporary, "r+");
      try { fsyncSync(handle); } finally { closeSync(handle); }
      renameSync(temporary, path);
      this.known.set(path, { text, schema: WORKSPACE_2 });
    } finally { rmSync(temporary, { force: true }); }
  }
}

export async function desktopWorkspaceRequest(request: Request, store: DesktopWorkspaceStore, verification: boolean): Promise<Response> {
  if (request.method === "GET") {
    try { return Response.json({ schema: "xfs/desktop-workspace-1", workspace: store.load(verification) },
      { headers: { "Cache-Control": "no-store" } }); }
    catch { return Response.json({ code: "workspace_unreadable", file: store.fileName(verification),
      error: "Saved desktop workspace is unreadable; its file was preserved." }, { status: 409 }); }
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
    return new Response("Expected JSON", { status: 415 });
  try {
    const value = await request.json() as { workspace?: unknown };
    if (typeof value?.workspace !== "string") return new Response("Invalid workspace", { status: 400 });
    store.save(verification, value.workspace);
    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: "Desktop workspace was not saved; the previous file was preserved." }, { status: 422 });
  }
}

/** POST only: set an unreadable workspace aside so the app can start with a fresh draft. */
export function desktopWorkspaceStartFresh(request: Request, store: DesktopWorkspaceStore, verification: boolean): Response {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try { store.load(verification); return Response.json({ keptAs: null }); }
  catch { /* Unreadable: set it aside below. */ }
  try { return Response.json({ keptAs: store.setAside(verification) }); }
  catch { return Response.json({ error: "The old workspace could not be set aside." }, { status: 500 }); }
}

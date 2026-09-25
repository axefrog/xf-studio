import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parseWorkspace } from "../src/workspace-state";

const maxWorkspaceBytes = 16_000_000;

/** Fixed, host-owned workspace files survive the desktop server's changing loopback port. */
export class DesktopWorkspaceStore {
  private readonly root: string;
  constructor(dataRoot: string) {
    if (!isAbsolute(dataRoot)) throw Error("Desktop workspace root must be absolute.");
    this.root = resolve(dataRoot);
  }
  private path(verification: boolean) {
    return resolve(this.root, verification ? "verification-workspace.json" : "workspace.json");
  }
  load(verification: boolean): string | null {
    const path = this.path(verification);
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    if (Buffer.byteLength(raw) > maxWorkspaceBytes) throw Error("Saved desktop workspace exceeds the size limit.");
    parseWorkspace(JSON.parse(raw));
    return raw;
  }
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
  save(verification: boolean, raw: string): void {
    if (Buffer.byteLength(raw) > maxWorkspaceBytes) throw Error("Desktop workspace exceeds the size limit.");
    const parsed = parseWorkspace(JSON.parse(raw));
    // Refuse to replace an unreadable prior draft. The user can recover its file.
    this.load(verification);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const path = this.path(verification), temporary = resolve(this.root, `.workspace-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, JSON.stringify(parsed), { mode: 0o600, flag: "wx" });
      const handle = openSync(temporary, "r+");
      try { fsyncSync(handle); } finally { closeSync(handle); }
      renameSync(temporary, path);
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

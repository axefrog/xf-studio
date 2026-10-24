/**
 * The desktop workspace's outbox keys (profiles design §2.2): kept beside the workspace file, one file per document key, so a commit
 * rewrites only its own document's entries and the outbox survives the loopback port (and so the WebView's storage origin) changing on
 * every launch. The page writes each key synchronously to its WebView storage and sends it here in the background
 * (`src/app/browser/outbox-storage.ts`); a write is fenced by the workspace lease like the workspace's own.
 */
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/** A document key: `<kind>/<id>`. */
const KEY = /^[a-z][a-z0-9.-]{0,63}\/[^\u0000-\u001f\u007f]{1,200}$/;
/** Most bytes one key's text may take. */
export const OUTBOX_KEY_BYTES = 8_000_000;

export class DesktopOutboxStore {
  private readonly root: string;
  /** This launch's ID: the page keeps its synchronous copy under it, so a later launch on the same port never reads an older one. */
  readonly launch = randomUUID();
  constructor(dataRoot: string) {
    if (!isAbsolute(dataRoot)) throw Error("Desktop workspace root must be absolute.");
    this.root = resolve(dataRoot);
  }
  private folder(verification: boolean) { return resolve(this.root, verification ? "verification-outbox" : "outbox"); }
  private file(verification: boolean, key: string) { return resolve(this.folder(verification), `${Buffer.from(key).toString("base64url")}.json`); }

  /** Every stored key's text. A file that can't be read is left where it is and skipped. */
  load(verification: boolean): Record<string, string> {
    const folder = this.folder(verification), keys: Record<string, string> = {};
    if (!existsSync(folder)) return keys;
    for (const name of readdirSync(folder)) {
      if (!name.endsWith(".json")) continue;
      try {
        const key = Buffer.from(name.slice(0, -5), "base64url").toString();
        if (KEY.test(key)) keys[key] = readFileSync(resolve(folder, name), "utf8");
      } catch { /* Skipped: unreadable. */ }
    }
    return keys;
  }
  /** Stores one key's text (written beside it and renamed into place), or removes it (null). */
  save(verification: boolean, key: string, text: string | null): void {
    if (!KEY.test(key)) throw Error("That isn't an outbox key.");
    const path = this.file(verification, key);
    if (text === null) { rmSync(path, { force: true }); return; }
    if (Buffer.byteLength(text) > OUTBOX_KEY_BYTES) throw Error("That outbox key is too large.");
    JSON.parse(text);
    mkdirSync(this.folder(verification), { recursive: true, mode: 0o700 });
    const temporary = resolve(this.folder(verification), `.outbox-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, text, { mode: 0o600, flag: "wx" });
      const handle = openSync(temporary, "r+");
      try { fsyncSync(handle); } finally { closeSync(handle); }
      renameSync(temporary, path);
    } finally { rmSync(temporary, { force: true }); }
  }
}

/**
 * The route: `GET` answers `{ schema: "xfs/desktop-outbox-1", launch, keys }`; `POST { key, text }` stores one key (`text: null` removes it).
 * `fence` answers a refusal for a write from a page that no longer holds the workspace, asked again right before the save.
 */
export async function desktopOutboxRequest(request: Request, store: DesktopOutboxStore, verification: boolean, fence?: () => Response | null): Promise<Response> {
  if (request.method === "GET") {
    try { return Response.json({ schema: "xfs/desktop-outbox-1", launch: store.launch, keys: store.load(verification) }, { headers: { "Cache-Control": "no-store" } }); }
    catch { return Response.json({ error: "The outbox couldn't be read." }, { status: 500 }); }
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") return new Response("Expected JSON", { status: 415 });
  try {
    const body = await request.json() as { key?: unknown; text?: unknown };
    if (typeof body?.key !== "string" || (body.text !== null && typeof body.text !== "string")) return new Response("Invalid outbox key", { status: 400 });
    const refused = fence?.();
    if (refused) return refused;
    store.save(verification, body.key, body.text);
    return new Response(null, { status: 204 });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    return Response.json({ error: "The outbox key wasn't stored.", ...(code === "ENOSPC" || code === "EDQUOT" ? { code } : {}) }, { status: 422 });
  }
}

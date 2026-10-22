/** The desktop workspace's outbox keys (profiles design §2.2): one file per document beside the workspace, fenced by the workspace lease. */
import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { DesktopOutboxStore, desktopOutboxRequest } from "../outbox-store";
import { tempDir } from "../../tests/temp-dir";

test("keys are stored one file each, read back by key, removed with null, and a refused write changes nothing", async () => {
  const root = tempDir("xfs-outbox-");
  try {
    const store = new DesktopOutboxStore(root);
    const post = (body: unknown, fence?: () => Response | null) => desktopOutboxRequest(new Request("http://127.0.0.1/api/desktop/workspace/outbox", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), store, false, fence);
    expect((await post({ key: "character/c-1234abcd", text: "{\"entries\":[1]}" })).status).toBe(204);
    expect((await post({ key: "look-working/c-1/l 1", text: "{\"entries\":[2]}" })).status).toBe(204);
    expect((await post({ key: "not a key", text: "{}" })).status).toBe(422);
    expect((await post({ key: "character/c-1234abcd", text: "not json" })).status).toBe(422);
    // A page that no longer holds the workspace: refused, nothing written.
    const refused = await post({ key: "character/c-1234abcd", text: null }, () => Response.json({ code: "superseded" }, { status: 409 }));
    expect(refused.status).toBe(409);
    const read = await (await desktopOutboxRequest(new Request("http://127.0.0.1/api/desktop/workspace/outbox"), store, false)).json() as { launch: string; keys: Record<string, string> };
    expect(read.launch).toBe(store.launch);
    expect(read.keys).toEqual({ "character/c-1234abcd": "{\"entries\":[1]}", "look-working/c-1/l 1": "{\"entries\":[2]}" });
    expect((await post({ key: "character/c-1234abcd", text: null })).status).toBe(204);
    expect(Object.keys(store.load(false))).toEqual(["look-working/c-1/l 1"]);
    // The verification workspace keeps its own.
    expect(store.load(true)).toEqual({});
  } finally { rmSync(root, { recursive: true, force: true }); }
});

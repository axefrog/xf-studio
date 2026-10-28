import { expect, test } from "bun:test";
import { startBrowserWorkspaceLease } from "../src/app/browser/workspace-lease-device";
import { startDocumentOutbox } from "../src/app/browser/document-outbox-device";
import { LEASE_MESSAGES } from "../src/app/workspace/workspace-lease";
import { memoryOutboxStorage } from "./fixtures/platform-doubles";

/** Browser surfaces kept local to each test, with every original global restored afterwards. */
async function browserTest(locks: boolean, channel: boolean, run: (browser: {
  requests: string[]; storageWrites: string[]; breakIdentity(): void;
}) => Promise<void>) {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const requests: string[] = [], storageWrites: string[] = [];
  const values = new Map<string, string>();
  const page = new EventTarget();
  let held = false, identityFails = false;
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { storageWrites.push(key); values.set(key, value); }, removeItem: (key: string) => values.delete(key) };
  const manager = { request: async (name: string, options: unknown, callback?: (lock: unknown) => unknown) => {
    requests.push(name);
    if (typeof options === "function") { if (identityFails) throw Error("Identity unavailable"); return options(); }
    const request = options as LockOptions;
    if (request.ifAvailable && request.signal) throw new DOMException("Invalid Web Lock options", "NotSupportedError");
    if (held) return callback!(null);
    held = true;
    try { return await callback!({ name }); } finally { held = false; }
  } };
  class Channel {
    constructor(readonly name: string) {}
    postMessage() {}
    addEventListener() {}
    removeEventListener() {}
    close() {}
  }
  const globals = { navigator: locks ? { locks: manager } : {}, BroadcastChannel: channel ? Channel : undefined,
    localStorage: storage, sessionStorage: storage, addEventListener: page.addEventListener.bind(page) };
  for (const [key, value] of Object.entries(globals)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  try { await run({ requests, storageWrites, breakIdentity: () => { identityFails = true; } }); }
  finally {
    page.dispatchEvent(new Event("pagehide"));
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

for (const [locks, channel, label] of [[false, true, "no Web Locks"], [true, false, "no BroadcastChannel"], [false, false, "neither API"]] as const) {
  test(`localhost startup with ${label} stays read-only and cannot take over or save`, async () => {
    await browserTest(locks, channel, async browser => {
      let sends = 0;
      const send = (async () => { sends++; return Response.json({ generation: 1 }); }) as unknown as typeof fetch;
      for (const verification of [false, true]) {
        const { lease, workspace } = await startBrowserWorkspaceLease({ verification, send });
        expect(workspace).toBe(verification ? "browser-verification" : "browser");
        expect(lease.snapshot()).toMatchObject({ phase: "unsupported", writable: false, canTakeOver: false, canRetry: false,
          canCancel: false, message: LEASE_MESSAGES.unsupported, refusal: LEASE_MESSAGES.unsupported });
        expect(lease.generation()).toBeNull();
        expect(lease.draining()).toBe(false);
        expect(lease.refusal()?.code).toBe("unavailable");
        expect((await lease.dispatch({ kind: "workspace.takeOver" })).ok).toBe(false);
        const outbox = startDocumentOutbox({ prefix: "/documents", send, workspace, lease, storage: memoryOutboxStorage() });
        try {
          expect(await outbox.documents.transact({ id: "blocked", command: "sample.write", writes: [] })).toMatchObject({ ok: false });
          expect(outbox.fence()).toBeNull();
        } finally { outbox.stop(); }
      }
      expect(sends).toBe(0);
      expect(browser.requests).toEqual([]);
      expect(browser.storageWrites).toEqual([]);
    });
  });
}

for (const verification of [false, true]) {
  test(`localhost startup with both APIs preserves the lock, identity and generation (${verification ? "verification" : "normal"})`, async () => {
    await browserTest(true, true, async browser => {
      const sent: { path: string; workspace: string }[] = [];
      const send = (async (path: string, init: RequestInit) => {
        sent.push({ path, ...JSON.parse(init.body as string) });
        return Response.json({ generation: 7 });
      }) as unknown as typeof fetch;
      const first = await startBrowserWorkspaceLease({ verification, send });
      try {
        expect(first.lease.writable()).toBe(true);
        expect(first.lease.generation()).toBe(7);
        expect(first.workspace).toMatch(/^browser-[0-9a-f-]{36}$/);
        expect(sent).toEqual([{ path: `${verification ? "/api/verification" : "/api"}/workspace-lease`, workspace: first.workspace }]);
        const second = await startBrowserWorkspaceLease({ verification, send });
        expect(second.workspace).toBe(first.workspace);
        expect(second.lease.snapshot()).toMatchObject({ phase: "read-only", writable: false, canTakeOver: true });
        expect(sent.length).toBe(1);
      } finally {
        await first.lease.release();
      }
    });
  });
}

test("localhost identity failure retains a disconnected write guard", async () => {
  await browserTest(true, true, async browser => {
    browser.breakIdentity();
    const { lease } = await startBrowserWorkspaceLease({ verification: false });
    expect(lease.snapshot()).toMatchObject({ phase: "disconnected", writable: false, canTakeOver: false, message: LEASE_MESSAGES.disconnected });
    expect(lease.draining()).toBe(false);
  });
});

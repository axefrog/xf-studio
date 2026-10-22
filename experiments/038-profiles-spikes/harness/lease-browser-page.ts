/**
 * A localhost browser window for the lease harness, as a worker: the real page adapter (`browserWorkspaceLease`) with the browser's
 * Web Locks (`web-locks-model.ts`, held by the harness as the browser), a real `BroadcastChannel` between the windows, the host's
 * real `/api/workspace-lease` and `/api/documents` routes, and `localStorage` as the browser's one store (kept by the harness).
 * Terminating the worker ends the window.
 */
import { browserWorkspaceLease } from "../../../projects/xf-studio/authoring/src/app/browser/workspace-lease-device";
import { browserDocuments } from "../../../projects/xf-studio/authoring/src/app/browser/browser-documents-device";
import { latePut, runPage } from "./lease-page";
import { locksProxy, type LockAnswer } from "./web-locks-model";

declare const self: Worker;
type Init = { op: "init"; base: string; name: string; hang: boolean; workspace: string; editMs: number };

let page: Awaited<ReturnType<typeof runPage>> | undefined;
let locks: ReturnType<typeof locksProxy> | undefined;
self.onmessage = async (event: MessageEvent) => {
  const message = event.data as Init | LockAnswer | { op: "command"; name: string };
  if (message.op === "init") {
    const { base, name, workspace } = message;
    const send = (url: string, init: RequestInit = {}) => fetch(base + url, { ...init,
      headers: { Origin: base, ...(init.headers as Record<string, string> | undefined) } });
    const report = (event: Record<string, unknown>) => self.postMessage({ op: "event", event: { window: name, at: performance.timeOrigin + performance.now(), ...event } });
    locks = locksProxy(lock => self.postMessage({ op: "locks", message: lock }));
    page = await runPage({
      name, hang: message.hang, report, editMs: message.editMs,
      adapter: browserWorkspaceLease({ workspace, locks: locks.manager, channel: new BroadcastChannel(`xfs.workspace.${workspace}`), window: name,
        repeatMs: 400, retryDelays: [50, 100], async register(signal) {
          const response = await send("/api/workspace-lease", { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace }) });
          return (await response.json() as { generation: number }).generation;
        } }),
      documents: fence => browserDocuments("/api/documents", send, () => { const generation = fence(); return generation === null ? null : { workspace, generation }; }),
      // localStorage: synchronous and the browser's; a window without the lease writes nothing (the persistence gate).
      writeWorkspace: async (marker, generation) => { if (generation === null) return 0; self.postMessage({ op: "setItem", value: marker }); return 204; },
      // localStorage has no host to fence it: the window's own gate is what stops it (checked by the harness through `setItem`).
      late: async generation => ({ document: await latePut(send, name, { workspace, generation }), workspace: null }),
    });
    return;
  }
  if (message.op === "command") void page?.command(message.name);
  else locks?.deliver(message);
};

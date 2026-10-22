/**
 * A desktop page for the lease harness, as a process of its own: the real page adapter (`desktopWorkspaceLease`) on the real desktop
 * server's lease route, its documents on `/api/documents` and its workspace on `/api/desktop/workspace`, each fenced as the
 * bootstrap fences them. Killing the process ends the page, and with it the open lease stream the host watches.
 *
 * Args: <base URL> <session cookie> <name> <hang: 0|1> <ms between edits>. Commands arrive on stdin, one per line; events leave on stdout as JSON lines.
 */
import { desktopWorkspaceLease } from "../../../projects/xf-studio/authoring/src/app/browser/workspace-lease-device";
import { browserDocuments } from "../../../projects/xf-studio/authoring/src/app/browser/browser-documents-device";
import { formatFence, WORKSPACE_FENCE_HEADER } from "../../../projects/xf-studio/authoring/src/platform/api/document-store";
import { serializeWorkspace } from "../../../projects/xf-studio/authoring/src/app/workspace/workspace-state";
import { STUDIO_DOCUMENTS } from "../../../projects/xf-studio/authoring/src/compose/studio-registry";
import { freshWorkspace } from "../../../projects/xf-studio/authoring/tests/fixtures/eye-region";
import { latePut, runPage } from "./lease-page";

const [base, cookie, name, hang, editMs] = process.argv.slice(2);
let loseRelease = false, delayRelease = false, loseTakeover = false, delayCancel = false;
/** Requests held back in transit, released by the harness: the body arrives at the host only when `open` runs. */
const delayed = new Map<string, { open(): void; answer: Promise<number> }>();
const raw = (url: string, init: RequestInit) => fetch(base + url, { ...init, headers: { Cookie: cookie, Origin: base, ...(init.headers as Record<string, string> | undefined) } });
/** Sends `init` with its body held back until `open`; the page's own call fails at once, as if its answer were lost. */
const holdBack = (key: string, url: string, init: RequestInit) => {
  let open!: () => void;
  const gate = new Promise<void>(resolve => { open = resolve; });
  const text = String(init.body);
  const body = new ReadableStream<Uint8Array>({ async start(controller) { await gate; controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });
  delayed.set(key, { open, answer: raw(url, { ...init, body, duplex: "half" } as RequestInit).then(response => response.status, () => 0) });
  throw Error("The answer was lost.");
};
const send = async (url: string, init: RequestInit = {}) => {
  const body = typeof init.body === "string" ? init.body : "";
  if (delayRelease && body.includes('"action":"release"')) { delayRelease = false; holdBack("release", url, init); }
  if (delayCancel && body.includes('"action":"cancel"')) { delayCancel = false; holdBack("cancel", url, init); }
  const response = await raw(url, init);
  // The host acted on the request; only its answer goes missing.
  if (loseRelease && body.includes('"action":"release"')) { loseRelease = false; throw Error("The answer was lost."); }
  if (loseTakeover && body.includes('"action":"takeover"')) { loseTakeover = false; throw Error("The answer was lost."); }
  return response;
};
const report = (event: Record<string, unknown>) => process.stdout.write(`${JSON.stringify({ window: name, at: performance.timeOrigin + performance.now(), ...event })}\n`);
/** The workspace text with `marker` as its first layer's name. */
const workspace = (marker: string) => {
  const value = freshWorkspace();
  value.recipe.layers[0].name = marker;
  return JSON.stringify(serializeWorkspace(value, STUDIO_DOCUMENTS));
};
let writing: Promise<unknown> = Promise.resolve();
const postWorkspace = (marker: string, generation: number | null) => send("/api/desktop/workspace", { method: "POST",
  headers: { "Content-Type": "application/json", ...(generation === null ? {} : { [WORKSPACE_FENCE_HEADER]: formatFence({ workspace: "desktop", generation }) }) },
  body: JSON.stringify({ workspace: workspace(marker) }) }).then(response => response.status);

const page = await runPage({
  name, hang: hang === "1", report, editMs: Number(editMs) || 15, loseReleaseAnswer: () => { loseRelease = true; },
  async control(command) {
    if (command === "delay-release") delayRelease = true;
    else if (command === "lose-takeover-answer") loseTakeover = true;
    else if (command === "delay-cancel") delayCancel = true;
    else if (command.startsWith("open-")) {
      const held = delayed.get(command.slice(5));
      if (!held) return { arrived: null };
      held.open();
      return { arrived: await held.answer };
    } else return undefined;
    return { armed: command };
  },
  adapter: desktopWorkspaceLease({ endpoint: "/api/desktop/workspace/lease", send, settle: () => writing.then(() => {}) }),
  documents: fence => browserDocuments("/api/documents", send, () => { const generation = fence(); return generation === null ? null : { workspace: "desktop", generation }; }),
  writeWorkspace(marker, generation) {
    // As the bootstrap does: a page without the lease sends nothing; writes go one at a time.
    if (generation === null) return Promise.resolve(0);
    const write = writing.then(() => postWorkspace(marker, generation));
    writing = write.catch(() => {});
    return write;
  },
  slowWrite(marker, generation) {
    // The body arrives only on `finish`: the request reaches the host (and passes its first fence check) long before its body does.
    let open!: () => void;
    const gate = new Promise<void>(resolve => { open = resolve; });
    const text = JSON.stringify({ workspace: workspace(marker) });
    const body = new ReadableStream<Uint8Array>({ async start(controller) {
      controller.enqueue(new TextEncoder().encode(text.slice(0, 16)));
      await gate;
      controller.enqueue(new TextEncoder().encode(text.slice(16)));
      controller.close();
    } });
    const answer = send("/api/desktop/workspace", { method: "POST", body, duplex: "half",
      headers: { "Content-Type": "application/json", [WORKSPACE_FENCE_HEADER]: formatFence({ workspace: "desktop", generation }) } } as RequestInit)
      .then(response => response.status, () => 0);
    return { finish: () => { open(); return answer; } };
  },
  async late(generation) {
    return { document: await latePut(send, name, { workspace: "desktop", generation }), workspace: await postWorkspace(`${name}#late`, generation) };
  },
});
const decoder = new TextDecoder();
let rest = "";
for await (const chunk of Bun.stdin.stream()) {
  rest += decoder.decode(chunk);
  const lines = rest.split("\n"); rest = lines.pop()!;
  for (const line of lines) if (line.trim()) void page.command(line.trim());
}

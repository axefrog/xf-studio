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
const send = (url: string, init: RequestInit = {}) => fetch(base + url, { ...init,
  headers: { Cookie: cookie, Origin: base, ...(init.headers as Record<string, string> | undefined) } });
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
  name, hang: hang === "1", report, editMs: Number(editMs) || 15,
  adapter: desktopWorkspaceLease({ endpoint: "/api/desktop/workspace/lease", send, settle: () => writing.then(() => {}) }),
  documents: fence => browserDocuments("/api/documents", send, () => { const generation = fence(); return generation === null ? null : { workspace: "desktop", generation }; }),
  writeWorkspace(marker, generation) {
    // As the bootstrap does: a page without the lease sends nothing; writes go one at a time.
    if (generation === null) return Promise.resolve(0);
    const write = writing.then(() => postWorkspace(marker, generation));
    writing = write.catch(() => {});
    return write;
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

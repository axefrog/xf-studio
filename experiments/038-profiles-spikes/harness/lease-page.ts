/**
 * One window of the lease harness: the real lease (`WorkspaceLease`), the real document gate (`leasedDocuments`) and holder
 * (`savedDocument`) over a host's real routes, editing as a person would while it holds the workspace. The host-specific parts
 * (the lease adapter, the document transport and the workspace write) come from the entry that runs it: a child process for the
 * desktop host (`lease-desktop-page.ts`), a worker for the localhost browser (`lease-browser-page.ts`).
 *
 * Events go to `report` as objects: `phase` (each lease change), `ack` (a document save the host confirmed), `ws` (a workspace
 * write and its answer), `draining` and `last-write` (the release steps), `probe` and `late` (the checks the harness asks for).
 */
import { WorkspaceLease, type WorkspaceLeaseAdapter } from "../../../projects/xf-studio/authoring/src/app/workspace/workspace-lease";
import { leasedDocuments } from "../../../projects/xf-studio/authoring/src/app/workspace/leased-documents";
import { savedDocument } from "../../../projects/xf-studio/authoring/src/platform/core/saved-document";
import { formatFence, WORKSPACE_FENCE_HEADER, type DocumentStorePort, type WorkspaceFence } from "../../../projects/xf-studio/authoring/src/platform/api/document-store";

export const LEASE_DOC = { kind: "lease-harness", id: "doc" } as const;
export type LeaseDoc = { by: string; seq: number };

export type PageIo = {
  name: string;
  adapter: WorkspaceLeaseAdapter;
  /** The host's document routes; each write carries `fence()` (set by the page to its lease). */
  documents(fence: () => number | null): DocumentStorePort;
  /** Writes the workspace with `marker` in it, fenced with `generation`; the host's answer status (0 when nothing was sent). */
  writeWorkspace(marker: string, generation: number | null): Promise<number>;
  /** A write sent late, with `generation`, past the page's own gate: the host's answers (document, workspace; null where none). */
  late(generation: number): Promise<{ document: string; workspace: number | null }>;
  report(event: Record<string, unknown>): void;
  /** Never answer a release request (a hung holder). */
  hang: boolean;
  editMs?: number;
};

export async function runPage(io: PageIo) {
  const lease = new WorkspaceLease(io.adapter, { clock: { after: (ms, run, signal) => {
    const timer = setTimeout(run, ms); signal?.addEventListener("abort", () => clearTimeout(timer), { once: true }); } },
    graceMs: 500, report: error => io.report({ event: "error", message: String(error) }) });
  const leased = leasedDocuments(io.documents(() => lease.generation()), lease);
  const doc = savedDocument<LeaseDoc>(leased, LEASE_DOC.kind, LEASE_DOC.id, { by: io.name, seq: 0 });
  let seq = 0, held: number | null = null, timer: ReturnType<typeof setInterval> | undefined;
  const edit = () => {
    // Every edit passes the lease's gate first, as every dispatch does in the Studio.
    if (lease.refusal()) return;
    const mine = ++seq;
    doc.save({ by: io.name, seq: mine }).then(() => io.report({ event: "ack", seq: mine }), () => {});
    if (mine % 4 === 0) void io.writeWorkspace(`${io.name}#${mine}`, lease.generation()).then(status => io.report({ event: "ws", seq: mine, status }));
  };
  lease.onRelease(async () => {
    io.report({ event: "draining", pending: leased.pending(), seq });
    if (io.hang) for (;;) { /* A hung holder: its window never answers again. */ }
    await leased.drain();
  });
  lease.onRelease(async () => {
    clearInterval(timer);
    const status = await io.writeWorkspace(`${io.name}#${seq}#last`, lease.generation());
    io.report({ event: "last-write", seq, status });
  });
  lease.subscribe(() => {
    const snapshot = lease.snapshot();
    if (lease.generation() !== null) held = lease.generation();
    io.report({ event: "phase", phase: snapshot.phase, generation: lease.generation(), message: snapshot.message });
  });
  const started = await lease.start();
  if (started.writable) timer = setInterval(edit, io.editMs ?? 15);
  return {
    async command(name: string) {
      if (name === "takeover") { const done = await lease.takeOver(); io.report({ event: "takeover", ...done }); }
      if (name === "probe") {
        // A read-only window: its dispatches are refused, and a save it tries never reaches the host.
        const refusal = lease.refusal();
        const before = seq;
        edit();
        const sent = await leased.put(LEASE_DOC.kind, LEASE_DOC.id, { by: io.name, seq: -1 }, 0);
        io.report({ event: "probe", code: refusal?.code ?? null, edited: seq !== before, put: sent.ok ? "written" : sent.reason });
      }
      if (name === "late" && held !== null) io.report({ event: "late", generation: held, ...await io.late(held) });
    },
  };
}

/**
 * A document write that arrives after its window released the workspace, sent straight to the host over the current revision (so
 * only the fence can refuse it): "superseded" when refused by the fence, otherwise what the host did.
 */
export async function latePut(send: (url: string, init?: RequestInit) => Promise<Response>, name: string, fence: WorkspaceFence): Promise<string> {
  const current = await (await send(`/api/documents?kind=${LEASE_DOC.kind}`)).json() as { documents: { id: string; revision: number }[] };
  const revision = current.documents.find(item => item.id === LEASE_DOC.id)?.revision ?? 0;
  const response = await send(`/api/documents?kind=${LEASE_DOC.kind}&id=${LEASE_DOC.id}`, { method: "PUT", headers: { "Content-Type": "application/json",
    [WORKSPACE_FENCE_HEADER]: formatFence(fence) }, body: JSON.stringify({ revision, value: { by: name, seq: -2 } }) });
  const body = await response.json().catch(() => ({})) as { code?: string };
  return response.ok ? "written" : body.code ?? `status ${response.status}`;
}

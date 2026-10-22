/**
 * One window of the lease harness: the real lease (`WorkspaceLease`), the real document gate (`leasedDocuments`), the real outbox
 * (`DocumentOutbox`, in memory: this harness is about the lease) and holder (`documentOwners`) over a host's real routes, editing as a
 * person would while it holds the workspace. The host-specific parts
 * (the lease adapter, the document transport and the workspace write) come from the entry that runs it: a child process for the
 * desktop host (`lease-desktop-page.ts`), a worker for the localhost browser (`lease-browser-page.ts`).
 *
 * Events go to `report` as objects: `phase` (each lease change), `ack` (a document save the host confirmed), `ws` (a workspace
 * write and its answer), `draining` and `last-write` (the release steps), `probe` and `late` (the checks the harness asks for).
 */
import { WorkspaceLease, type WorkspaceLeaseAdapter } from "../../../projects/xf-studio/authoring/src/app/workspace/workspace-lease";
import { leasedDocuments } from "../../../projects/xf-studio/authoring/src/app/workspace/leased-documents";
import { documentOwners } from "../../../projects/xf-studio/authoring/src/platform/core/saved-document";
import { DocumentOutbox } from "../../../projects/xf-studio/authoring/src/platform/core/document-outbox";
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
  /**
   * A workspace write whose body arrives only when `finish` is called (a write that stalls in transit), fenced with `generation`;
   * `finish` answers the host's status. Desktop only.
   */
  slowWrite?(marker: string, generation: number): { finish(): Promise<number> };
  /** Desktop: the next release request reaches the host, but its answer is lost on the way back. */
  loseReleaseAnswer?(): void;
  /** Host-specific transport controls (the desktop page's held-back and lost requests); answers what to report. */
  control?(command: string): Promise<Record<string, unknown> | undefined>;
  /** Never answer a release request (a hung holder). */
  hang: boolean;
  editMs?: number;
};

export async function runPage(io: PageIo) {
  const lease = new WorkspaceLease(io.adapter, { clock: { after: (ms, run, signal) => {
    const timer = setTimeout(run, ms); signal?.addEventListener("abort", () => clearTimeout(timer), { once: true }); } },
    graceMs: 500, report: error => io.report({ event: "error", message: String(error) }) });
  // `break-docs` makes every document write fail in transit (an unreachable host) until `fix-docs`.
  let docsBroken = false;
  const transport = io.documents(() => lease.generation());
  const leased = leasedDocuments({ ...transport, list: (kind, signal) => transport.list(kind, signal), revisions: (refs, signal) => transport.revisions(refs, signal),
    read: (refs, signal) => transport.read(refs, signal),
    transact: request => docsBroken ? Promise.reject(Error("The host didn't answer.")) : transport.transact(request) }, lease);
  const keys = new Map<string, string>();
  const outbox = new DocumentOutbox(leased, { load: () => keys, write: (key, text, empty) => { if (empty) keys.delete(key); else keys.set(key, text); } },
    { writable: () => lease.writable(), sendable: () => lease.draining(), retryMs: 20 });
  // The document as the library holds it now: the window's baseline, as an owner reads its documents when it starts.
  const current = (await transport.list<LeaseDoc>(LEASE_DOC.kind)).find(item => item.id === LEASE_DOC.id);
  const doc = documentOwners(outbox).open<LeaseDoc>(LEASE_DOC.kind, LEASE_DOC.id, { by: io.name, seq: 0 }, current);
  let seq = 0, held: number | null = null, timer: ReturnType<typeof setInterval> | undefined, broken = false;
  let slow: { finish(): Promise<number> } | null = null;
  // `break-writes` makes every workspace write fail (a full disk, an unreachable host) until `fix-writes`.
  const writeWorkspace = (marker: string, generation: number | null) => broken ? Promise.resolve(503) : io.writeWorkspace(marker, generation);
  const stored = (status: number) => status >= 200 && status < 300;
  const edit = () => {
    // Every edit passes the lease's gate first, as every dispatch does in the Studio.
    if (lease.refusal()) return;
    const mine = ++seq;
    doc.save({ by: io.name, seq: mine }).then(() => io.report({ event: "ack", seq: mine }), () => {});
    if (mine % 4 === 0) void writeWorkspace(`${io.name}#${mine}`, lease.generation()).then(status => io.report({ event: "ws", seq: mine, status }));
  };
  lease.onRelease(async () => {
    io.report({ event: "draining", pending: leased.pending(), seq });
    if (io.hang) for (;;) { /* A hung holder: its window never answers again. */ }
    // The outbox drains: every recorded change acknowledged; one whose command failed is sent again on Try again.
    return await outbox.settle();
  });
  // The last workspace write must be stored, or the release stops and this window keeps the workspace (release-failed).
  lease.onRelease(async () => {
    const status = await writeWorkspace(`${io.name}#${seq}#last`, lease.generation());
    io.report({ event: "last-write", seq, status });
    return stored(status);
  });
  lease.onReleased(() => { clearInterval(timer); outbox.stop(); });
  lease.subscribe(() => {
    const snapshot = lease.snapshot();
    if (lease.generation() !== null) held = lease.generation();
    io.report({ event: "phase", phase: snapshot.phase, generation: lease.generation(), message: snapshot.message });
  });
  const started = await lease.start();
  if (started.writable) { outbox.open(); timer = setInterval(edit, io.editMs ?? 15); }
  return {
    async command(name: string) {
      if (name === "takeover") { const done = await lease.takeOver(); io.report({ event: "takeover", ...done }); }
      if (name === "probe") {
        // A read-only window: its dispatches are refused, and a save it tries never reaches the host.
        const refusal = lease.refusal();
        const before = seq;
        edit();
        const sent = await leased.transact({ id: `probe-${io.name}`, command: "lease.probe", writes: [{ ...LEASE_DOC, base: 0, value: { by: io.name, seq: -1 } }] });
        io.report({ event: "probe", code: refusal?.code ?? null, edited: seq !== before, put: sent.ok ? "written" : sent.reason });
      }
      if (name === "late" && held !== null) io.report({ event: "late", generation: held, ...await io.late(held) });
      if (name === "break-writes") { broken = true; io.report({ event: "writes", broken }); }
      if (name === "fix-writes") { broken = false; io.report({ event: "writes", broken }); }
      if (name === "break-docs") { docsBroken = true; io.report({ event: "docs", broken: true }); }
      if (name === "fix-docs") { docsBroken = false; io.report({ event: "docs", broken: false }); }
      if (name === "lose-release-answer") { io.loseReleaseAnswer?.(); io.report({ event: "losing-release-answer" }); }
      const controlled = await io.control?.(name);
      if (controlled) io.report({ event: "control", command: name, ...controlled });
      if (name === "retry") io.report({ event: "retry", released: await lease.retryRelease() });
      if (name === "slow-write" && io.slowWrite && lease.generation() !== null) {
        slow = io.slowWrite(`${io.name}#slow`, lease.generation()!);
        io.report({ event: "slow-started" });
      }
      if (name === "finish-slow" && slow) io.report({ event: "slow-finished", status: await slow.finish() });
    },
  };
}

/**
 * A command that arrives after its window released the workspace, sent straight to the host over the current revision (so only the
 * fence can refuse it): "superseded" when refused by the fence, otherwise what the host did.
 */
export async function latePut(send: (url: string, init?: RequestInit) => Promise<Response>, name: string, fence: WorkspaceFence): Promise<string> {
  const current = await (await send(`/api/documents?kind=${LEASE_DOC.kind}`)).json() as { documents: { id: string; revision: number }[] };
  const revision = current.documents.find(item => item.id === LEASE_DOC.id)?.revision ?? 0;
  const response = await send("/api/documents/transact", { method: "POST", headers: { "Content-Type": "application/json",
    [WORKSPACE_FENCE_HEADER]: formatFence(fence) }, body: JSON.stringify({ id: `late-${name}-${revision}`, command: "lease.late",
      writes: [{ ...LEASE_DOC, base: revision, value: { by: name, seq: -2 } }] }) });
  const body = await response.json().catch(() => ({})) as { code?: string; ok?: boolean; reason?: string };
  return response.ok ? body.ok ? "written" : body.reason ?? "refused" : body.code ?? `status ${response.status}`;
}

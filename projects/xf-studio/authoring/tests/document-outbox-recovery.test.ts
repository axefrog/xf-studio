import { expect, test } from "bun:test";
import { profileContextStudio } from "./fixtures/profile-context-studio";
import { memoryOutboxStorage } from "./fixtures/platform-doubles";
import { WorkspaceLease } from "../src/app/workspace/workspace-lease";
import { PAUSED_WORKSPACE } from "../src/app/workspace/workspace-access";
import { STUDIO_COMPOSITION } from "../src/compose/studio-registry";
import { emptyPresentationStatus, outboxView } from "../src/app/presentation-status";
import { installLightDom, uninstallLightDom, type LightElement } from "./light-dom";

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function suspendedProfile(activeControl = false) {
  let lost = () => {}, broken = false, sends = 0;
  const lease = new WorkspaceLease({ acquire: async () => ({ generation: 1 }), takeOver: async () => ({ generation: 2 }),
    onReleaseRequested() {}, onLost: listener => { lost = listener; }, release: async () => {} }, { clock: { after() {} } });
  await lease.start();
  const storage = memoryOutboxStorage(), downloads: Blob[] = [];
  const studio = await profileContextStudio({ lease, download: blob => { downloads.push(blob); },
    status: outbox => ({ snapshot: () => ({ ...emptyPresentationStatus(), lease: lease.snapshot(), outbox: outboxView(outbox.status()) }),
      subscribe: listener => outbox.subscribe(() => listener()) }), outbox: { storage: {
    ...storage, write: (...args) => { if (broken) throw Error("Backup unavailable"); storage.write(...args); },
  } } });
  const panel = studio.bind("presets--scene0").context.current(), eye = panel.feature("eye-makeup");
  await studio.settle();
  const transact = studio.transport.transact;
  studio.transport.transact = async () => { sends++; return { ok: false, reason: "superseded" }; };
  broken = true;
  const layer = eye.view().recipe().layers[0]!.id;
  expect(eye.dispatch({ kind: "layer.setOpacity", layerId: layer, opacity: .37 }).ok).toBe(true);
  if (activeControl) expect(eye.controlBegin("paused-opacity", layer)).toBe(true);
  studio.outbox.store(); await tick();
  expect(studio.outbox.status()).toMatchObject({ stopped: false, ...(activeControl ? {} : { pending: 1 }), unprotectedWarning: true });
  return { studio, panel, eye, layer, lease, lost: () => lost(), downloads, sends: () => sends,
    repair: () => { broken = false; studio.transport.transact = transact; },
    dispose: async () => { broken = false; studio.transport.transact = transact; await studio.dispose(); await lease.stop(); } };
}

test("the real presentation status reaches Frame and renders the recovery notice during an active control", async () => {
  installLightDom();
  try {
    const { Frame, StudioRuntime } = await import("../src/studio-ui/runtime");
    const { workspaceNotice } = await import("../src/studio-ui/app");
    const { Feedback } = await import("../src/studio-ui/feedback");
    const w = await suspendedProfile(true);
    try {
      const frame = new Frame(w.panel), notice = workspaceNotice(new StudioRuntime(w.panel, new Feedback()));
      const message = "This window can't save changes, so editing is paused. Try again, or Export this window's copy.";
      expect(w.lease.snapshot()).toMatchObject({ writable: true, message: "" });
      expect(frame.preview.control?.id).toBe("paused-opacity");
      expect(frame.status).toEqual(w.panel.snapshot().status);
      expect(frame.status.lease).toMatchObject({ writable: false, message });
      notice.update(frame);
      const root = notice.element as unknown as LightElement;
      expect(root.hidden).toBe(false);
      expect(root.querySelector(".workspace-notice-text")?.textContent).toBe(message);
      expect(root.querySelectorAll("button").filter(button => !button.hidden).map(button => button.textContent))
        .toEqual(["Try again", "Export this window's copy"]);
      w.repair();
      expect(await w.panel.documents.dispatch({ kind: "documents.retryRecovery" })).toEqual({ ok: true });
      expect(await w.studio.outbox.settle()).toBe(true);
      const normal = { ...emptyPresentationStatus(), lease: w.lease.snapshot(), outbox: outboxView(w.studio.outbox.status()) };
      const resumed = new Frame(w.panel);
      expect(resumed.status).toEqual(normal); expect(w.panel.snapshot().status).toEqual(normal);
      notice.update(resumed); expect(root.hidden).toBe(true);
    } finally { await w.dispose(); }
  } finally { uninstallLightDom(); }
});

test("a suspended real profile refuses edits before mutation and Export copy equals the shown look", async () => {
  const w = await suspendedProfile();
  try {
    expect(w.lease.writable()).toBe(true); // The writer's suspension must gate independently of this still-held lease.
    expect(w.studio.outbox.status()).toMatchObject({ suspended: true });
    expect(w.panel.workspace.snapshot()).toMatchObject({ writable: false, message: PAUSED_WORKSPACE });
    expect(w.panel.snapshot().status.lease).toMatchObject({ writable: false, message: PAUSED_WORKSPACE });
    const shown = structuredClone(w.eye.view().recipe());
    const edit = { kind: "layer.setOpacity" as const, layerId: w.layer, opacity: .81 };
    expect(w.eye.dispatch(edit)).toMatchObject({ ok: false, code: "unavailable", message: PAUSED_WORKSPACE });
    expect(w.eye.controlBegin("recovery-opacity", w.layer)).toBe(false);
    expect(w.studio.bind("presets--shared").context.current().feature("eye-makeup").dispatch(edit).ok).toBe(false);
    expect(w.eye.view().recipe()).toEqual(shown);
    expect(w.panel.files.capability({ kind: "collection.exportWindowCopy" }).available).toBe(true);
    expect(await w.panel.files.execute({ kind: "collection.exportWindowCopy" })).toMatchObject({ ok: true });
    expect(w.downloads).toHaveLength(1);
    const model = STUDIO_COMPOSITION.documents;
    const copy = model.parts.readCollection(JSON.parse(await w.downloads[0]!.text()), true, "keep");
    const look = copy.presets.find(look => look.id === w.studio.looks[0]!.look)!;
    expect(look.parts["eye-makeup"]).toEqual(model.parts.envelope("eye-makeup", shown));
    expect(w.sends()).toBe(1);
    expect(w.studio.failures).toEqual([]);
  } finally { await w.dispose(); }
});

test("presentation Try again refuses failed protection, then explicitly resumes the held workspace", async () => {
  const w = await suspendedProfile();
  try {
    const retry = { kind: "documents.retryRecovery" as const }, port = w.panel;
    expect(port.documents.capability(retry).available).toBe(true);
    expect(await port.documents.dispatch(retry)).toMatchObject({ ok: false, code: "unavailable",
      message: "Your changes still couldn't be backed up. Export this window's copy, or reopen the window." });
    expect(w.sends()).toBe(1); expect(port.workspace.snapshot().writable).toBe(false);
    const id = w.studio.outbox.pendingEntries()[0]!.id;
    w.repair();
    // A backup retry by itself doesn't silently reopen editing; the user's explicit recovery action does.
    expect(await port.documents.dispatch({ kind: "documents.protect" })).toEqual({ ok: true });
    expect(port.workspace.snapshot().writable).toBe(false);
    expect(await port.documents.dispatch(retry)).toEqual({ ok: true });
    expect(w.studio.outbox.pendingEntries()[0]?.id).toBe(id);
    expect(await w.studio.outbox.settle()).toBe(true);
    expect(port.workspace.snapshot()).toMatchObject({ writable: true, message: "" });
    expect(w.studio.outbox.status()).toMatchObject({ suspended: false, pending: 0 });
    expect(w.eye.dispatch({ kind: "layer.setOpacity", layerId: w.layer, opacity: .62 }).ok).toBe(true);
    expect(w.eye.view().recipe().layers[0]!.opacity).toBe(.62);
    expect(await w.studio.settle()).toBe(true);
  } finally { await w.dispose(); }
});

for (const ending of ["lost lease", "shutdown"] as const) test(`presentation Try again refuses ${ending} and retains the copy`, async () => {
  const w = await suspendedProfile();
  try {
    if (ending === "lost lease") w.lost(); else expect(w.studio.outbox.stop()).toBe(false);
    w.repair();
    const retry = { kind: "documents.retryRecovery" as const };
    expect(w.panel.documents.capability(retry)).toMatchObject({ available: false, code: "unavailable" });
    expect(await w.panel.documents.dispatch(retry)).toMatchObject({ ok: false, code: "unavailable" });
    expect(w.panel.documents.capability(retry).reason).toContain("Export this window's copy, or reopen");
    expect(w.sends()).toBe(1); expect(w.eye.view().recipe().layers[0]!.opacity).toBe(.37);
    expect(w.studio.outbox.status()).toMatchObject({ suspended: true, pending: 1 });
    expect(w.panel.files.capability({ kind: "collection.exportWindowCopy" }).available).toBe(true);
  } finally { await w.dispose(); }
});

// The page's diagnostics (code-health DIAG-07, DIAG-12..14): the browser device's bounded queue and refused batches, repeated
// failures kept once under one reference, and the report review over the light DOM harness (the summary files previewed from the
// ticked parts, mod files behind the sharing confirmation, the whole of a long part on request, "Prepare again" after expiry).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createBrowserDiagnostics, PAGE_QUEUE } from "../src/diagnostics/browser-device";
import { DiagnosticsActions, type DiagnosticsDevice } from "../src/diagnostics/actions";
import { diagnosticEntry, type DiagnosticEntry } from "../src/diagnostics/model";
import { PREVIEW_CHARS, type ReportManifest } from "../src/diagnostics/report";
import { installLightDom, lightDocument, lightEvent, LightElement, type LightElement as Element, uninstallLightDom } from "./light-dom";

const settle = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));
const entry = (message: string, level: "error" | "info" = "error") => diagnosticEntry({ level, area: "page", code: "x", message, origin: "page" });

/** A fake window whose fetch answers with `status` and records each forwarded batch. */
function fakeWindow(status: () => number) {
  const batches: DiagnosticEntry[][] = [];
  const win = {
    fetch: async (_url: string, init: { body: string }) => { batches.push(JSON.parse(init.body).entries); return new Response(null, { status: status() }); },
    navigator: { userAgent: "Chrome/140.0" },
    addEventListener() {}, removeEventListener() {},
  };
  return { win: win as unknown as Window & typeof globalThis, batches };
}

describe("the browser device (DIAG-07)", () => {
  test("the waiting queue is bounded, and what it dropped is said first", async () => {
    const { win, batches } = fakeWindow(() => 204);
    const { device } = createBrowserDiagnostics({ window: win, download() {} });
    device.forward(Array.from({ length: PAGE_QUEUE + 200 }, (_, i) => entry(`flood ${i}`)));
    await settle();
    const [first] = batches;
    expect(first![0]).toMatchObject({ code: "entries_dropped", details: { count: 200 } });
    // The newest are the ones kept.
    expect(first![1]!.message).toBe(`flood 200`);
  });
  test("a batch the host refuses is dropped, never resent; one it couldn't take waits in the ring", async () => {
    let status = 400;
    const { win, batches } = fakeWindow(() => status);
    const { device } = createBrowserDiagnostics({ window: win, download() {} });
    device.forward([entry("poison")]);
    await settle();
    expect(device.pending()).toEqual([]);
    status = 503;
    device.forward([entry("host busy")]);
    await settle();
    expect(device.pending().map(item => item.message)).toEqual(["host busy"]);
    status = 204;
    device.forward([entry("next")]);
    await settle();
    expect(batches.at(-1)!.map(item => item.message)).toEqual(["host busy", "next"]);
  });
});

describe("repeated failures (DIAG-07, DIAG-12)", () => {
  test("the same failure within ten seconds is recorded once and shows the recorded reference; a new host failure always records", () => {
    const forwarded: DiagnosticEntry[] = [];
    let hostRef: string | null = null, now = 0;
    const device = { forward: (entries: DiagnosticEntry[]) => { forwarded.push(...entries); }, claimHostRef: () => hostRef } as unknown as DiagnosticsDevice;
    const actions = new DiagnosticsActions(device, () => now);
    const first = actions.notice({ source: "Library", message: "Couldn't save.", code: "storage_failed" });
    now += 1_000;
    expect(actions.notice({ source: "Library", message: "Couldn't save.", code: "storage_failed" })).toBe(first);
    expect(forwarded).toHaveLength(1);
    hostRef = "XF-0001";
    expect(actions.notice({ source: "Library", message: "Couldn't save.", code: "storage_failed" })).toBe("XF-0001");
    expect(forwarded.map(item => item.ref)).toEqual([first!, "XF-0001"]);
    now += 11_000; hostRef = null;
    expect(actions.notice({ source: "Library", message: "Couldn't save.", code: "storage_failed" })).not.toBe(first);
    expect(forwarded).toHaveLength(3);
  });
});

test("while the host prepares, its progress line shows, and it clears when the report is ready (DIAG-11)", async () => {
  let finish!: () => void;
  const ready = new Promise<void>(done => { finish = done; });
  const device = { forward() {}, pending: () => [], claimHostRef: () => null, pageFacts: () => ({ browser: "Chrome", gpu: null, webgl2: true }),
    state: async () => ({ mode: "normal" as const, until: null, minutes: 30, preparing: "Fingerprinting the mod files involved (2 of 5)…" }),
    prepare: async () => { await ready; return { schema: "xfs/problem-report-manifest-1", id: "r", ref: null, made: "2026-09-26T00:00:00.000Z",
      facts: { app: { version: "0.1.0", commit: null, channel: null, host: "localhost" }, os: "", runtime: "", webView2: null, game: { version: null, found: false },
        launchRoute: "", frameworks: null, wolvenKit: { version: null, source: "" } }, problem: [], recent: [], items: [], limits: { total: 1, modFiles: 1 },
      window: { mode: "normal", minutes: 30, until: null } } as ReportManifest; },
  } as unknown as DiagnosticsDevice;
  const actions = new DiagnosticsActions(device);
  const prepared = actions.dispatch({ kind: "diagnostics.prepareReport" });
  await settle(900);
  expect(actions.snapshot().report).toMatchObject({ phase: "preparing", message: "Fingerprinting the mod files involved (2 of 5)…" });
  finish();
  await prepared;
  await settle(700);
  expect(actions.snapshot().report).toMatchObject({ phase: "ready", message: null });
});

describe("the report review (DIAG-01, DIAG-09, DIAG-13, DIAG-14)", () => {
  beforeAll(() => {
    installLightDom();
    const proto = LightElement.prototype as unknown as Record<string, unknown>;
    proto.showModal = function () {}; proto.close = function () {};
  });
  afterAll(() => uninstallLightDom());

  const long = "x".repeat(PREVIEW_CHARS + 100);
  const manifest: ReportManifest = { schema: "xfs/problem-report-manifest-1", id: "r1", ref: "XF-7K3Q", made: "2026-09-26T00:00:00.000Z",
    facts: { app: { version: "0.1.0", commit: null, channel: null, host: "localhost" }, os: "Windows", runtime: "Bun", webView2: null,
      game: { version: null, found: false }, launchRoute: "game folder", frameworks: null, wolvenKit: { version: null, source: "not ready" } },
    problem: [{ t: "2026-09-26T00:00:00.000Z", level: "error", area: "character", code: "details_failed", message: "PROBLEM-LINE", origin: "host", ref: "XF-7K3Q" }],
    recent: [], limits: { total: 10_000_000, modFiles: 5_000_000 }, window: { mode: "normal", minutes: 30, until: null },
    items: [
      { id: "problem", group: "happened", label: "This problem", detail: "", bytes: 100, included: true, preview: "[]" },
      { id: "trace", group: "happened", label: "Recent activity detail", detail: "", bytes: long.length, included: true, preview: long.slice(0, PREVIEW_CHARS) },
      { id: "mod-file:0", group: "optional", label: "Files of “Mine”", detail: "", bytes: 400, included: false, modFiles: true, preview: "a.archive" }] };
  let expire = false;
  const saved: { sharingConfirmed: boolean; include: string[] }[] = [];
  const device: DiagnosticsDevice = {
    forward() {}, pending: () => [], claimHostRef: () => null, pageFacts: () => ({ browser: "Chrome", gpu: null, webgl2: true }),
    state: async () => null, setMode: async mode => ({ mode, until: null, minutes: 30 }), prepare: async () => structuredClone(manifest),
    item: async (_id, item) => item === "trace" ? long : "",
    bundle: async request => {
      if (expire) throw Object.assign(Error("That report was prepared a while ago. Prepare it again, then save."), { code: "report_expired" });
      saved.push({ sharingConfirmed: request.sharingConfirmed, include: request.include });
      return new Uint8Array(4);
    },
    save() {}, copy: async () => {}, openIssue: async () => {},
  };

  async function open() {
    const actions = new DiagnosticsActions(device);
    const listeners = new Set<() => void>();
    actions.subscribe(() => { for (const listener of listeners) listener(); });
    const port = { diagnostics: { snapshot: () => actions.snapshot(), capability: actions.capability.bind(actions), dispatch: actions.dispatch.bind(actions),
      descriptors: () => actions.descriptors(), notice: actions.notice.bind(actions), fullText: actions.fullText.bind(actions) },
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } };
    const { openReportDialog } = await import("../src/studio-ui/diagnostics/report-dialog");
    const handle = openReportDialog({ port, feedback: { log: [] } } as never, "XF-7K3Q");
    await settle();
    const dialog = lightDocument.body.querySelector("dialog")!;
    const find = (text: string) => dialog.descendants().find(element => element.tagName === "button" && element.textContent.includes(text))!;
    const box = (label: string) => dialog.descendants().find(element => element.classList.contains("report-item-head") && element.textContent.includes(label))!
      .children.find(child => child.tagName === "input")!;
    return { actions, handle, dialog, find, box };
  }
  const change = (element: Element, checked: boolean) => { element.checked = checked; element.dispatchEvent(lightEvent("change")); };

  test("the summary files preview follows the ticks; mod files wait for the confirmation, which the save carries", async () => {
    const { actions, handle, dialog, box } = await open();
    const readme = () => actions.snapshot().report!.files!.readme;
    expect(dialog.textContent).toContain("Always in the report");
    expect(readme()).toContain("PROBLEM-LINE");
    change(box("This problem"), false);
    await settle();
    expect(readme()).not.toContain("PROBLEM-LINE");
    expect(dialog.textContent).toContain("its log entries weren't included");
    // Mod files can't be ticked until the confirmation is.
    const files = box("Files of");
    expect(files.disabled).toBe(true);
    const confirm = dialog.descendants().find(element => element.classList.contains("report-confirm"))!.children.find(child => child.tagName === "input")!;
    change(confirm, true);
    await settle();
    change(files, true);
    await settle();
    expect(actions.snapshot().report!.files!.index).toContain("mod-file:0");
    await actions.dispatch({ kind: "diagnostics.saveReport" });
    expect(saved.at(-1)).toMatchObject({ sharingConfirmed: true, include: expect.arrayContaining(["mod-file:0"]) });
    handle.close();
  });

  test("a long part shows all of itself on request, and an expired report offers Prepare again", async () => {
    const { actions, handle, find, dialog } = await open();
    const all = find("Show all of it");
    all.click();
    await settle();
    expect(dialog.descendants().some(element => element.tagName === "pre" && element.textContent === long)).toBe(true);
    expire = true;
    const again = find("Prepare again");
    expect(again.hidden).toBe(true);
    await actions.dispatch({ kind: "diagnostics.saveReport" });
    await settle();
    expect(actions.snapshot().report).toMatchObject({ phase: "failed", expired: true });
    expect(again.hidden).toBe(false);
    expire = false;
    again.click();
    await settle();
    expect(actions.snapshot().report!.phase).toBe("ready");
    handle.close();
  });
});

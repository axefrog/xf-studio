import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { USER_FACING_JARGON } from "../src/alpha-availability";
import { HeadLoadError, headLoadFailureCode } from "../src/head-load-error";
import { PolledHostState } from "../src/host-state-poller";
import type { InstallDetectionActions } from "../src/install-detection-actions";
import { XBOX_UNSUPPORTED_MESSAGE } from "../src/install-detection";
import type { LocalSetupFields, LocalSetupView } from "../src/local-settings-server";
import { LocalSetupActions } from "../src/local-setup-actions";
import { PreviewPreparationActions, type PreviewState } from "../src/preview-preparation";
import { PreviewSetupActions, type PreviewSetupSnapshot } from "../src/preview-setup";
import { PREVIEW_SETUP_DESCRIPTORS } from "../src/studio-action-descriptors";
import { WolvenKitSetupActions, type WolvenKitSetupState } from "../src/wolvenkit-setup";

// Behaviour of the 3D preview first run as the presentation sees it through `port.previewSetup`:
// the card can always be brought back, lost contact is retried and shown, a head that fails to load
// can be retried, and every word shown follows the wording policy.

const settle = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw Error("condition not reached"); await settle(2); }
}
const previewState = (patch: Partial<PreviewState>): PreviewState => ({ schema: "xfs/preview-core-state-1", phase: "idle",
  message: "XF Studio can build the 3D head preview from your own Cyberpunk 2077 files.", code: null, needs: [], progress: null,
  lastDurationSeconds: null, canPrepare: true, canCancel: false, ...patch });
const offer = { version: "9.0.1", downloadBytes: 45_266_234, installedBytes: 93_614_085, downloadSize: "45 MB", installedSize: "94 MB",
  from: "WolvenKit's official release on GitHub", publisher: "the WolvenKit team", releasePage: "https://example.test/release",
  licence: { name: "GNU General Public License v3.0", spdx: "GPL-3.0", url: "https://example.test/licence" } };
const wolvenKitState = (phase: WolvenKitSetupState["phase"], patch: Partial<WolvenKitSetupState> = {}): WolvenKitSetupState => ({
  schema: "xfs/wolvenkit-setup-1", phase, message: "WolvenKit is ready.", code: null, source: "managed", version: "9.0.1", offer,
  runtime: null, progress: null, step: null, detected: null, canInstall: phase === "available", canCancel: false, ...patch });

/** A scripted host: preparation and WolvenKit states, a switch to drop contact, and the settings it saved. */
function harness(options: { preview?: PreviewState; wolvenKit?: WolvenKitSetupState; autostart?: boolean; hostSetup?: boolean;
  games?: string[]; unsupported?: string[]; loadHead?: () => Promise<void> } = {}) {
  const host = { preview: options.preview ?? previewState({}), wolvenKit: options.wolvenKit ?? wolvenKitState("ready"),
    down: false, requests: [] as string[], preparing: 0, head: options.loadHead ?? (async () => {}) };
  const preparation = new PreviewPreparationActions(async action => {
    host.requests.push(action);
    if (host.down) throw Error("offline");
    if (action === "prepare" || action === "rebuild") {
      host.preview = previewState({ phase: "preparing", canPrepare: false, canCancel: true, progress: { index: 1, total: 5, label: "Checking" } });
      host.preparing++;
    }
    if (action === "cancel") host.preview = previewState({ phase: "failed", code: "preview_cancelled", message: "Preparing the 3D preview was cancelled." });
    return { ok: true, data: host.preview };
  }, 5);
  const wolvenKit = new WolvenKitSetupActions(async request => {
    if (host.down) throw Error("offline");
    if (request.action === "install") host.wolvenKit = wolvenKitState("downloading", { canCancel: true, progress: { receivedBytes: 1, totalBytes: 4 } });
    return { ok: true, data: host.wolvenKit };
  }, 5);
  let fields: LocalSetupFields = { gameRoot: null, launchRoute: "direct", mo2Root: null, mo2ProfileId: null, manualModRoot: null,
    wolvenKitCli: null, eyePlateHead: "installed" };
  let revision = 0;
  const saved: Partial<LocalSetupFields>[] = [];
  const view = (): LocalSetupView => ({ revision, source: "primary", fields, overridden: [],
    readiness: { build: { ready: false, issues: [], limits: [] } } as unknown as LocalSetupView["readiness"],
    eyePlateHead: { label: "Head used for the eye plate", options: [] } });
  const localSetup = new LocalSetupActions(async (method, body) => {
    if (method === "PATCH") {
      const next = (body as { fields: LocalSetupFields }).fields;
      saved.push(next); fields = next; revision++;
    }
    return { ok: true, status: 200, data: view() };
  });
  const detection = { dispatch: async () => ({ ok: true as const }),
    snapshot: () => ({ games: { candidates: (options.games ?? []).map(root => ({ root })),
      unsupported: (options.unsupported ?? []).map(message => ({ source: "xbox", root: null, detail: "", message })) } }) } as unknown as Pick<InstallDetectionActions, "dispatch" | "snapshot">;
  let autostart = options.autostart ?? true, hostSetupOpened = 0;
  const links: string[] = [];
  const setup = new PreviewSetupActions({ preparation, wolvenKit, detection, localSetup, setupPlace: "Game & tools",
    openLink: async link => { links.push(link); },
    ...(options.hostSetup ? { openHostSetup: () => { hostSetupOpened++; } } : {}),
    autostart: { get: () => autostart, set: on => { autostart = on; } },
    loadHead: () => host.head() });
  return { host, setup, preparation, localSetup, saved, links, get autostart() { return autostart; }, get hostSetupOpened() { return hostSetupOpened; },
    ready() { host.preview = previewState({ phase: "ready", canPrepare: false, message: "The 3D preview is ready." }); } };
}

function spoken(snapshot: PreviewSetupSnapshot): string[] {
  const card = snapshot.card, consent = snapshot.consent;
  return [card.title, card.body, card.step ?? "", card.notice ?? "", card.primary?.label ?? "", card.secondary?.label ?? "",
    ...card.links.map(link => link.label), snapshot.head.message, snapshot.head.next?.label ?? "",
    ...(consent ? [consent.title, consent.intro, consent.runtimeNote ?? "", consent.confirm.label, consent.own.label,
      ...consent.facts.flatMap(fact => [fact.label, fact.value])] : [])].filter(Boolean);
}

test("first run prepares by itself, and a ready preview loads the head", async () => {
  const h = harness();
  const loads: string[] = [];
  h.host.head = async () => { loads.push("head"); };
  await h.setup.start();
  expect(h.host.requests).toEqual(["refresh", "prepare"]);
  expect(h.setup.snapshot().card).toMatchObject({ open: true, canDismiss: false, primary: { action: { kind: "previewSetup.cancel" } } });
  expect(h.setup.snapshot().head).toMatchObject({ phase: "preparing", next: null });
  h.ready();
  await until(() => h.setup.snapshot().head.phase === "ready");
  expect(loads).toEqual(["head"]);
  expect(h.setup.snapshot().card.open).toBe(false);
});

test("Not now hides the card and the head pane offers the way back", async () => {
  const h = harness({ autostart: false });
  await h.setup.start();
  expect(h.host.requests).toEqual(["refresh"]);
  let snapshot = h.setup.snapshot();
  expect(snapshot.card).toMatchObject({ open: true, canDismiss: true, primary: { label: "Prepare 3D preview", action: { kind: "previewSetup.prepare" } } });
  expect(snapshot.head).toMatchObject({ phase: "unavailable", next: null });
  expect(await h.setup.dispatch({ kind: "previewSetup.dismiss" })).toEqual({ ok: true });
  snapshot = h.setup.snapshot();
  expect(snapshot.card.open).toBe(false);
  expect(snapshot.head.next).toEqual({ label: "Set up 3D preview", action: { kind: "previewSetup.show" } });
  expect(h.setup.capability({ kind: "previewSetup.dismiss" }).available).toBe(false);
  expect(await h.setup.dispatch(snapshot.head.next!.action)).toEqual({ ok: true });
  expect(h.setup.snapshot().card.open).toBe(true);
  expect(h.setup.capability({ kind: "previewSetup.show" })).toMatchObject({ available: false });
  // Starting work brings a dismissed card back so its progress and Cancel stay reachable.
  await h.setup.dispatch({ kind: "previewSetup.dismiss" });
  await h.setup.dispatch({ kind: "previewSetup.prepare" });
  expect(h.setup.snapshot().card).toMatchObject({ open: true, canDismiss: false });
  expect(h.autostart).toBe(true);
  // Cancelling turns the automatic start off (a workspace preference) and a failed run offers Try again from the pane.
  await h.setup.dispatch({ kind: "previewSetup.cancel" });
  expect(h.autostart).toBe(false);
  h.host.preview = previewState({ phase: "failed", code: "preview_tool_failed", message: "WolvenKit could not read your game files. Try again." });
  await h.setup.dispatch({ kind: "previewSetup.refresh" });
  await h.setup.dispatch({ kind: "previewSetup.dismiss" });
  expect(h.setup.snapshot().head).toMatchObject({ phase: "failed", next: { label: "Try again", action: { kind: "previewSetup.prepare" } } });
  h.preparation.dispose();
});

test("a lost poll is retried with backoff, shown on the card, and recovers", async () => {
  const h = harness();
  await h.setup.start();
  expect(h.setup.snapshot().card.notice).toBeNull();
  h.host.down = true;
  await until(() => h.preparation.connection().failures >= 2, 3000);
  const lost = h.setup.snapshot();
  expect(h.preparation.connection()).toMatchObject({ retrying: true });
  expect(lost.card.open).toBe(true);
  expect(lost.card.notice).toMatch(/lost contact with its 3D preview service\. Still trying \(attempt \d+\)/);
  expect(lost.head.phase).toBe("preparing");
  h.host.down = false;
  h.ready();
  await until(() => h.setup.snapshot().head.phase === "ready", 3000);
  expect(h.preparation.connection()).toEqual({ failures: 0, retrying: false, message: null });
});

test("the poller stops after a failure only when no work was running", async () => {
  let fail = true, calls = 0;
  const state = { phase: "idle", message: "Idle." };
  const poller = new PolledHostState<{ phase: string; message: string }, "refresh">({
    transport: async () => { calls++; if (fail) throw Error("offline"); return { ok: true, data: state }; },
    isState: (value): value is { phase: string; message: string } => !!value && typeof (value as { phase?: unknown }).phase === "string",
    working: value => value.phase === "working", refresh: "refresh", pollMs: 5,
    messages: { invalid: "Invalid.", unreachable: "Unreachable." } });
  expect(await poller.request("refresh")).toEqual({ ok: false, message: "Unreachable." });
  await settle(40);
  expect(calls).toBe(1);
  expect(poller.connection()).toEqual({ failures: 1, retrying: false, message: "Unreachable." });
  fail = false;
  expect(await poller.request("refresh")).toEqual({ ok: true });
  expect(poller.connection().failures).toBe(0);
  poller.dispose();
});

test("a head that fails to load says why in plain words and can be retried", async () => {
  let attempts = 0;
  const h = harness({ preview: previewState({ phase: "ready", canPrepare: false }) });
  h.host.head = async () => { attempts++; if (attempts === 1) throw new HeadLoadError("webgl_unavailable", "WebGL 2 is unavailable"); };
  await h.setup.start();
  await until(() => h.setup.snapshot().head.phase === "failed");
  const failed = h.setup.snapshot().head;
  expect(failed).toMatchObject({ code: "webgl_unavailable", next: { label: "Try again", action: { kind: "previewSetup.retryHead" } } });
  expect(failed.message).toMatch(/graphics driver/);
  expect(failed.message).toMatch(/Remote Desktop/);
  expect(failed.message).not.toMatch(/WebGL 2 is unavailable/);
  expect(await h.setup.dispatch({ kind: "previewSetup.retryHead" })).toEqual({ ok: true });
  await until(() => h.setup.snapshot().head.phase === "ready");
  expect(attempts).toBe(2);
});

test("a damaged preview offers Prepare again, which prepares it afresh and then loads the head", async () => {
  let attempts = 0;
  const h = harness({ preview: previewState({ phase: "ready", canPrepare: false }) });
  h.host.head = async () => { attempts++; if (attempts === 1) throw new HeadLoadError("preview_damaged", "head.glb does not match its record."); };
  await h.setup.start();
  await until(() => h.setup.snapshot().head.phase === "failed");
  expect(h.setup.snapshot().head).toMatchObject({ code: "preview_damaged", next: { label: "Prepare again", action: { kind: "previewSetup.prepareAgain" } } });
  expect(await h.setup.dispatch({ kind: "previewSetup.prepareAgain" })).toEqual({ ok: true });
  expect(h.host.requests).toContain("rebuild");
  expect(h.setup.snapshot().head.phase).toBe("preparing");
  h.ready();
  await until(() => h.setup.snapshot().head.phase === "ready");
  expect(attempts).toBe(2);
  expect(h.setup.capability({ kind: "previewSetup.prepareAgain" })).toEqual({ available: false, reason: "The 3D preview is already showing." });
  // An untyped failure is retried once, then preparing again is offered.
  expect(headLoadFailureCode(Error("Error creating WebGL context."))).toBe("webgl_unavailable");
  expect(headLoadFailureCode(Error("geometry nodes are missing"))).toBe("head_load_failed");
  const repeated = harness({ preview: previewState({ phase: "ready", canPrepare: false }), loadHead: async () => { throw Error("geometry nodes are missing"); } });
  await repeated.setup.start();
  await until(() => repeated.setup.snapshot().head.phase === "failed");
  expect(repeated.setup.snapshot().head.next?.label).toBe("Try again");
  expect(repeated.setup.snapshot().head.message).not.toMatch(/geometry/);
  await repeated.setup.dispatch({ kind: "previewSetup.retryHead" });
  await until(() => repeated.setup.snapshot().head.phase === "failed");
  expect(repeated.setup.snapshot().head.next?.label).toBe("Prepare again");
});

test("a detected game folder is saved over the other settings, and setup opens where the host keeps it", async () => {
  const h = harness({ preview: previewState({ phase: "needs-setup", needs: ["game", "wolvenkit"], canPrepare: false, code: "preview_game_missing",
    message: "Choose your Cyberpunk 2077 game folder." }), games: ["D:\\Games\\Cyberpunk 2077"] });
  await h.localSetup.dispatch({ kind: "setup.refresh" });
  await h.localSetup.dispatch({ kind: "setup.update", fields: { manualModRoot: "D:\\Mods" } });
  await h.setup.start();
  await until(() => h.setup.snapshot().card.primary?.action.kind === "previewSetup.useDetectedGame");
  expect(await h.setup.dispatch({ kind: "previewSetup.useDetectedGame" })).toEqual({ ok: true });
  expect(h.saved.at(-1)).toMatchObject({ gameRoot: "D:\\Games\\Cyberpunk 2077", manualModRoot: "D:\\Mods" });
  // Localhost has no setup form of its own: the Studio reveals Game & tools (UI-29).
  expect(h.setup.snapshot().setupRequests).toBe(0);
  await h.setup.dispatch({ kind: "previewSetup.openSetup" });
  expect(h.setup.snapshot().setupRequests).toBe(1);
  const desktop = harness({ hostSetup: true });
  await desktop.setup.dispatch({ kind: "previewSetup.openSetup" });
  expect(desktop.hostSetupOpened).toBe(1);
  expect(desktop.setup.snapshot().setupRequests).toBe(0);
});

test("a recognised but unusable copy (the Xbox app's) explains itself on the game card and still offers the folder choice", async () => {
  const h = harness({ preview: previewState({ phase: "needs-setup", needs: ["game"], canPrepare: false, code: "preview_game_missing",
    message: "Choose your Cyberpunk 2077 game folder." }), unsupported: [XBOX_UNSUPPORTED_MESSAGE] });
  await h.setup.start();
  await until(() => h.setup.snapshot().card.body === XBOX_UNSUPPORTED_MESSAGE);
  expect(h.setup.snapshot().card.primary).toEqual({ label: "Choose game folder", action: { kind: "previewSetup.openSetup" } });
  for (const text of spoken(h.setup.snapshot())) expect(USER_FACING_JARGON.test(text), text).toBe(false);
  // A usable copy wins: the note is only for when nothing else was found.
  const both = harness({ preview: previewState({ phase: "needs-setup", needs: ["game"], canPrepare: false, code: "preview_game_missing",
    message: "Choose your Cyberpunk 2077 game folder." }), games: ["D:\\Games\\Cyberpunk 2077"], unsupported: [XBOX_UNSUPPORTED_MESSAGE] });
  await both.setup.start();
  await until(() => both.setup.snapshot().card.primary?.action.kind === "previewSetup.useDetectedGame");
  expect(both.setup.snapshot().card.body).not.toMatch(/Xbox/);
});

test("the WolvenKit consent is a port state, and closing it downloads nothing", async () => {
  const h = harness({ preview: previewState({ phase: "needs-setup", needs: ["wolvenkit"], canPrepare: false, code: "preview_tool_missing",
    message: "XF Studio needs WolvenKit to read your game files. XF Studio can download it for you." }), wolvenKit: wolvenKitState("available",
    { source: null, version: null, message: "XF Studio can download WolvenKit for you." }) });
  await h.setup.start();
  expect(h.setup.snapshot().card.primary).toEqual({ label: "Set up WolvenKit…", action: { kind: "previewSetup.consent" } });
  expect(h.setup.snapshot().card.secondary).toEqual({ label: "I already have WolvenKit", action: { kind: "previewSetup.openSetup" } });
  await h.setup.dispatch({ kind: "previewSetup.consent" });
  const consent = h.setup.snapshot().consent!;
  expect(consent.confirm).toEqual({ label: "Download (45 MB)", action: { kind: "previewSetup.installWolvenKit", version: "9.0.1" } });
  for (const text of spoken(h.setup.snapshot())) expect(USER_FACING_JARGON.test(text), text).toBe(false);
  await h.setup.dispatch({ kind: "previewSetup.consentClose" });
  expect(h.setup.snapshot().consent).toBeNull();
  expect(h.host.wolvenKit.phase).toBe("available");
  await h.setup.dispatch({ kind: "previewSetup.openLink", link: "wolvenkit-licence" });
  expect(h.links).toEqual(["wolvenkit-licence"]);
  expect(await h.setup.dispatch({ kind: "previewSetup.installWolvenKit", version: "9.0.1" })).toEqual({ ok: true });
  expect(h.setup.snapshot().card).toMatchObject({ open: true, canDismiss: false, primary: { action: { kind: "previewSetup.cancelDownload" } } });
});

test("every setup action is catalogued, and every state speaks plainly", async () => {
  const kinds = Object.keys(PREVIEW_SETUP_DESCRIPTORS).sort();
  expect(kinds).toEqual(["previewSetup.cancel", "previewSetup.cancelDownload", "previewSetup.consent", "previewSetup.consentClose",
    "previewSetup.dismiss", "previewSetup.installWolvenKit", "previewSetup.openLink", "previewSetup.openSetup", "previewSetup.prepare",
    "previewSetup.prepareAgain", "previewSetup.recheckRuntime", "previewSetup.refresh", "previewSetup.retryHead", "previewSetup.show",
    "previewSetup.useDetectedGame", "previewSetup.useDetectedWolvenKit"]);
  for (const [kind, descriptor] of Object.entries(PREVIEW_SETUP_DESCRIPTORS)) expect({ kind, scope: descriptor.scope }).toEqual({ kind, scope: ["host"] });
  const states: PreviewState[] = [previewState({}), previewState({ phase: "preparing", canPrepare: false, canCancel: true }),
    previewState({ phase: "blocked", message: "Your Cyberpunk 2077 has a different female player head." }),
    previewState({ phase: "failed", code: "preview_cancelled", message: "Preparing the 3D preview was cancelled." }),
    previewState({ phase: "needs-setup", needs: ["game"], canPrepare: false, message: "Choose your Cyberpunk 2077 game folder." })];
  for (const preview of states) {
    const h = harness({ preview, autostart: false });
    await h.setup.start();
    for (const text of spoken(h.setup.snapshot())) expect(USER_FACING_JARGON.test(text), text).toBe(false);
    await h.setup.dispatch({ kind: "previewSetup.dismiss" });
    for (const text of spoken(h.setup.snapshot())) expect(USER_FACING_JARGON.test(text), text).toBe(false);
  }
  for (const code of ["webgl_unavailable", "preview_damaged", "preview_unreachable", "head_load_failed"] as const) {
    const h = harness({ preview: previewState({ phase: "ready", canPrepare: false }), loadHead: async () => { throw new HeadLoadError(code, "raw"); } });
    await h.setup.start();
    await until(() => h.setup.snapshot().head.phase === "failed");
    for (const text of spoken(h.setup.snapshot())) expect(USER_FACING_JARGON.test(text), text).toBe(false);
  }
});

test("the jargon list catches the retired developer wording, and no view still shows it", () => {
  for (const text of ["Saved locally · revision 3 · server overrides: XFS_PACKAGE_GAMEPATH", "Bun executable (optional)",
    "Build inputs are available. Tool version and game rendering are checked separately.", "Could not reach local setup."])
    expect(USER_FACING_JARGON.test(text), text).toBe(true);
  const root = resolve(import.meta.dir, "..");
  const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
  const views = [...files(join(root, "src", "studio-ui")).filter(path => !path.includes("style-guide")), join(root, "desktop", "bootstrap.js")];
  for (const path of views) {
    const source = readFileSync(path, "utf8");
    for (const phrase of ["server overrides", "Saved locally · revision", "Bun executable", "checked separately", "Browser autosave",
      "More categories are planned", "bunExecutable"])
      expect({ path, phrase, found: source.includes(phrase) }).toEqual({ path, phrase, found: false });
  }
});

// ---- PREV-21..24, UI-34 ----

type Probe = { phase: string; message: string };
function scriptedPoller() {
  const pending: { request: string; resolve: (reply: { ok: boolean; data: unknown }) => void; reject: (error: Error) => void }[] = [];
  const timers: { run: () => void; ms: number }[] = [];
  const poller = new PolledHostState<Probe, string>({
    transport: request => new Promise((resolve, reject) => pending.push({ request, resolve, reject })),
    isState: (value): value is Probe => !!value && typeof (value as { phase?: unknown }).phase === "string",
    working: value => value.phase === "working", refresh: "refresh", pollMs: 5,
    messages: { invalid: "Invalid.", unreachable: "Unreachable." },
    timers: { set: (run, ms) => { const timer = { run, ms }; timers.push(timer); return timer; },
      clear: handle => { const i = timers.indexOf(handle as typeof timers[number]); if (i >= 0) timers.splice(i, 1); } } });
  return { poller, pending, timers };
}

test("an older idle reply arriving after a newer working one is ignored, so polling continues (PREV-21)", async () => {
  const { poller, pending, timers } = scriptedPoller();
  const poll = poller.request("refresh"), prepare = poller.request("prepare");
  expect(pending.map(item => item.request)).toEqual(["refresh", "prepare"]);
  pending[1]!.resolve({ ok: true, data: { phase: "working", message: "Preparing." } });
  expect(await prepare).toEqual({ ok: true });
  pending[0]!.resolve({ ok: true, data: { phase: "idle", message: "Idle." } });
  expect(await poll).toEqual({ ok: true });
  expect(poller.snapshot()).toEqual({ phase: "working", message: "Preparing." });
  expect(timers).toHaveLength(1);
  // A stale failure doesn't count as lost contact either.
  const late = poller.request("refresh"), newer = poller.request("prepare");
  pending[3]!.resolve({ ok: true, data: { phase: "working", message: "Still preparing." } });
  await newer;
  pending[2]!.reject(Error("offline"));
  expect(await late).toEqual({ ok: false, message: "Unreachable." });
  expect(poller.connection()).toEqual({ failures: 0, retrying: false, message: null });
  poller.dispose();
});

test("overlapping refreshes share one request until something newer is sent (PREV-21)", async () => {
  const { poller, pending } = scriptedPoller();
  const first = poller.request("refresh"), second = poller.request("refresh");
  expect(pending).toHaveLength(1);
  poller.request("prepare");
  const third = poller.request("refresh");
  expect(pending.map(item => item.request)).toEqual(["refresh", "prepare", "refresh"]);
  for (const item of pending) item.resolve({ ok: true, data: { phase: "idle", message: "Idle." } });
  expect(await first).toEqual({ ok: true });
  expect(await second).toEqual({ ok: true });
  expect(await third).toEqual({ ok: true });
  // Once it has answered, the next refresh is a new request.
  poller.request("refresh");
  expect(pending).toHaveLength(4);
  poller.dispose();
});

test("a poll in flight at dispose applies nothing and restarts no timer (PREV-22)", async () => {
  const { poller, pending, timers } = scriptedPoller();
  let notified = 0;
  poller.subscribe(() => { notified++; });
  const poll = poller.request("refresh");
  poller.dispose();
  pending[0]!.resolve({ ok: true, data: { phase: "working", message: "Preparing." } });
  await poll;
  expect(poller.snapshot()).toBeNull();
  expect(timers).toHaveLength(0);
  expect(notified).toBe(0);
  expect(await poller.request("refresh")).toEqual({ ok: false, message: "Unreachable." });
  expect(pending).toHaveLength(1);
});

test("nothing is looked for or prepared before the service starts (PREV-23)", async () => {
  let looked = 0;
  const h = harness({ preview: previewState({ phase: "needs-setup", needs: ["game"], canPrepare: false, message: "Choose your Cyberpunk 2077 game folder." }),
    wolvenKit: wolvenKitState("available") });
  const detection = h.setup["port"].detection;
  const original = detection.dispatch;
  detection.dispatch = async (...args) => { looked++; return original(...args); };
  // Host states arriving before start (another view refreshing the shared ports) change nothing.
  await h.preparation.dispatch({ kind: "preview.refresh" });
  await h.setup["port"].wolvenKit.dispatch({ kind: "wolvenkit.refresh" });
  h.host.wolvenKit = wolvenKitState("ready");
  await h.setup["port"].wolvenKit.dispatch({ kind: "wolvenkit.refresh" });
  await settle(20);
  expect(looked).toBe(0);
  expect(h.host.requests).toEqual(["refresh"]);
  await h.setup.start();
  await until(() => looked === 1);
});

test("a failed head waits for the next ready preview once the host moves on (PREV-24)", async () => {
  let attempts = 0;
  const h = harness({ preview: previewState({ phase: "ready", canPrepare: false }) });
  h.host.head = async () => { attempts++; if (attempts === 1) throw Error("geometry nodes are missing"); };
  await h.setup.start();
  await until(() => h.setup.snapshot().head.phase === "failed");
  await settle(10);
  // The game folder changed: the host needs setup again, and the old failure no longer applies.
  h.host.preview = previewState({ phase: "idle" });
  await h.preparation.dispatch({ kind: "preview.refresh" });
  expect(h.setup.snapshot().head.phase).not.toBe("failed");
  expect(h.setup.capability({ kind: "previewSetup.retryHead" }).available).toBe(false);
  h.ready();
  await h.preparation.dispatch({ kind: "preview.refresh" });
  await until(() => h.setup.snapshot().head.phase === "ready");
  expect(attempts).toBe(2);
});

test("only a request to show the card counts as one; the card opening by itself doesn't (UI-34)", async () => {
  const h = harness({ autostart: false });
  await h.setup.start();
  expect(h.setup.snapshot()).toMatchObject({ showRequests: 0, card: { open: true } });
  await h.setup.dispatch({ kind: "previewSetup.dismiss" });
  // Running work brings the card back without a show request.
  await h.setup.dispatch({ kind: "previewSetup.prepare" });
  expect(h.setup.snapshot()).toMatchObject({ showRequests: 0, card: { open: true } });
  await h.setup.dispatch({ kind: "previewSetup.cancel" });
  await h.setup.dispatch({ kind: "previewSetup.dismiss" });
  expect(await h.setup.dispatch({ kind: "previewSetup.show" })).toEqual({ ok: true });
  expect(h.setup.snapshot()).toMatchObject({ showRequests: 1, card: { open: true } });
});

test("the head pane's next step reports busy while the last step runs (UI-35)", async () => {
  let release: () => void = () => {};
  const h = harness({ autostart: false });
  await h.setup.start();
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = h.preparation.dispatch.bind(h.preparation);
  h.preparation.dispatch = async action => { if (action.kind === "preview.prepare") await gate; return original(action); };
  const running = h.setup.dispatch({ kind: "previewSetup.prepare" });
  expect(h.setup.capability({ kind: "previewSetup.refresh" })).toEqual({ available: false, reason: "XF Studio is still working on the last step." });
  expect(h.setup.capability({ kind: "previewSetup.retryHead" }).available).toBe(false);
  release();
  await running;
  expect(h.setup.capability({ kind: "previewSetup.refresh" }).available).toBe(true);
});

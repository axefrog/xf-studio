import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { USER_FACING_JARGON } from "../src/alpha-availability";
import type { DotNetInstall } from "../src/dotnet-runtime";
import { WolvenKitSetupHost, wolvenKitReadinessIssue, type WolvenKitSetupOptions } from "../src/wolvenkit-setup-host";
import { createWolvenKitSetupHandler } from "../src/wolvenkit-setup-server";
import { isWolvenKitSetupState, wolvenKitCard, wolvenKitConsent, wolvenKitLinkUrl, WolvenKitSetupActions, type WolvenKitSetupState } from "../src/wolvenkit-setup";
import { WOLVENKIT_RELEASE, type ManagedToolRelease } from "../src/wolvenkit-release";
import { WOLVENKIT_DESCRIPTORS } from "../src/studio-action-descriptors";
import { makeZip } from "./zip-fixture";

// A stand-in release: the same shape as WolvenKit's console ZIP, served by a local fixture server.
const RUNTIMECONFIG = JSON.stringify({ runtimeOptions: { tfm: "net10.0", framework: { name: "Microsoft.NETCore.App", version: "10.0.0" } } });
const FILES = { "WolvenKit.CLI.exe": "MZ fixture launcher", "WolvenKit.CLI.dll": "MZ fixture entry", "WolvenKit.CLI.runtimeconfig.json": RUNTIMECONFIG,
  "lib/texconv.dll": "MZ fixture native".repeat(200) } as const;
const ZIP = makeZip(Object.entries(FILES).map(([name, data]) => ({ name, data })));
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const TAMPERED = Buffer.from(ZIP); TAMPERED[40] ^= 0xff;

let requests: Record<string, number> = {};
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  const path = new URL(request.url).pathname;
  requests[path] = (requests[path] ?? 0) + 1;
  const whole = (bytes: Uint8Array) => new Response(new Blob([new Uint8Array(bytes)]), { headers: { "Content-Length": String(bytes.length) } });
  if (path === "/ok.zip") return whole(ZIP);
  if (path === "/tampered.zip") return whole(TAMPERED);
  if (path === "/gone.zip") return new Response("Not found", { status: 404 });
  if (path === "/error.zip") return new Response("Unavailable", { status: 503 });
  if (path === "/flaky.zip" && requests[path] === 1) // The first attempt drops halfway.
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(ZIP.subarray(0, 100)); controller.error(Error("reset")); } }),
      { headers: { "Content-Length": String(ZIP.length) } });
  if (path === "/flaky.zip") return whole(ZIP);
  if (path === "/slow.zip") return new Response(new ReadableStream({ async pull(controller) {
    await Bun.sleep(40); controller.enqueue(ZIP.subarray(0, 64)); } }), { headers: { "Content-Length": String(ZIP.length) } });
  return new Response("?", { status: 400 });
} });
const roots: string[] = [];
afterAll(() => { server.stop(true); for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const temporary = () => { const root = mkdtempSync(join(tmpdir(), "xfs-wolvenkit-")); roots.push(root); return root; };

const release = (asset = "ok.zip"): ManagedToolRelease => ({ ...WOLVENKIT_RELEASE, version: "9.9.9-fixture", asset,
  url: `http://127.0.0.1:${server.port}/${asset}`, archiveBytes: ZIP.length, archiveSha256: sha(ZIP),
  files: Object.keys(FILES).length, installedBytes: Object.values(FILES).reduce((sum, value) => sum + Buffer.byteLength(value), 0),
  executableSha256: sha(FILES["WolvenKit.CLI.exe"]), entryDllSha256: sha(FILES["WolvenKit.CLI.dll"]) });
const WITH_NET10: DotNetInstall = { root: "C:\\Program Files\\dotnet", source: "default", frameworks: { "Microsoft.NETCore.App": ["8.0.31", "10.0.12"] } };
const WITHOUT_NET10: DotNetInstall = { root: "C:\\Program Files\\dotnet", source: "default", frameworks: { "Microsoft.NETCore.App": ["8.0.31"] } };
function host(patch: Partial<WolvenKitSetupOptions> & { asset?: string } = {}) {
  const root = temporary();
  const log: string[] = [];
  let dotnet = WITH_NET10;
  const service = new WolvenKitSetupHost({ root, configured: () => null, release: release(patch.asset), platform: "win32",
    dotnet: () => dotnet, retryDelaysMs: [5, 5], findExisting: () => null, log: message => log.push(message), ...patch });
  return { root, service, log, setDotNet: (value: DotNetInstall) => { dotnet = value; } };
}
const leftovers = (root: string) => [...readdirSync(join(root, "downloads")), ...readdirSync(join(root, "wolvenkit")).filter(name => name.startsWith("."))];
const plain = (state: WolvenKitSetupState) => { expect(USER_FACING_JARGON.test(state.message), state.message).toBe(false); return state; };

test("with nothing set up, the offer says what, why, how big, from where and under which licence", () => {
  const { service } = host();
  const state = plain(service.snapshot());
  expect(state).toMatchObject({ schema: "xfs/wolvenkit-setup-1", phase: "available", canInstall: true, canCancel: false, source: null,
    runtime: { name: ".NET 10 Runtime", installed: true } });
  expect(isWolvenKitSetupState(state)).toBe(true);
  expect(service.usable()).toBeNull();
  const consent = wolvenKitConsent(state);
  const facts = Object.fromEntries(consent.facts.map(fact => [fact.label, fact.value]));
  expect(facts["Size"]).toContain("to download");
  expect(facts["From"]).toContain("official release on GitHub");
  expect(facts["Licence"]).toContain("GPL-3.0");
  expect(facts["Where it goes"]).toContain("Nothing is installed in Windows");
  expect(consent.runtimeNote).toBeNull();
  expect(wolvenKitLinkUrl(state, "wolvenkit-licence")).toBe("https://github.com/WolvenKit/WolvenKit/blob/9.0.1/LICENSE");
  for (const text of [consent.intro, ...consent.facts.map(fact => fact.value)]) expect(USER_FACING_JARGON.test(text), text).toBe(false);
  // The consent binds to the exact version shown; anything else is refused without downloading.
  expect(service.install("1.0.0").phase).toBe("available");
  expect(requests["/ok.zip"] ?? 0).toBe(0);
});

test("a consented download is verified, unpacked, checked and then used automatically", async () => {
  const { root, service } = host();
  const seen: number[] = [];
  const started = service.install("9.9.9-fixture");
  expect(started).toMatchObject({ phase: "downloading", canCancel: true, canInstall: false });
  while (service.snapshot().phase === "downloading" || service.snapshot().phase === "installing") {
    seen.push(service.snapshot().progress?.receivedBytes ?? -1); await Bun.sleep(1);
  }
  await service.settled();
  const ready = plain(service.snapshot());
  expect(ready).toMatchObject({ phase: "ready", source: "managed", version: "9.9.9-fixture", canInstall: false });
  expect(service.usable()).toBe(join(root, "wolvenkit", "9.9.9-fixture", "WolvenKit.CLI.exe"));
  expect(service.managedExecutable()).toBe(service.usable());
  expect(existsSync(join(root, "wolvenkit", "9.9.9-fixture.install.json"))).toBe(true);
  expect(leftovers(root)).toEqual([]);
  expect(wolvenKitReadinessIssue(ready)).toBeNull();
  // A damaged copy is noticed and can be repaired by downloading again.
  writeFileSync(join(root, "wolvenkit", "9.9.9-fixture", "WolvenKit.CLI.exe"), "MZ changed launcher!");
  expect(service.snapshot()).toMatchObject({ phase: "available", code: "wolvenkit_damaged", canInstall: true });
  expect(service.usable()).toBeNull();
  service.install("9.9.9-fixture");
  await service.settled();
  expect(service.snapshot().phase).toBe("ready");
});

test("a missing .NET runtime is explained with Microsoft's installer, and a recheck picks it up", async () => {
  const { service, setDotNet } = host();
  setDotNet(WITHOUT_NET10);
  const offered = service.snapshot();
  expect(offered.runtime).toMatchObject({ installed: false, installerUrl: "https://aka.ms/dotnet/10.0/dotnet-runtime-win-x64.exe" });
  expect(wolvenKitConsent(offered).runtimeNote).toContain(".NET 10 Runtime");
  service.install("9.9.9-fixture");
  await service.settled();
  const waiting = plain(service.snapshot());
  expect(waiting).toMatchObject({ phase: "needs-runtime", source: "managed", code: "wolvenkit_runtime_missing" });
  expect(waiting.message).toContain(".NET 10 Runtime");
  // The preview never runs a CLI that cannot start; Build readiness names the runtime.
  expect(service.usable()).toBeNull();
  expect(service.managedExecutable()).not.toBeNull();
  expect(wolvenKitReadinessIssue(waiting)?.reason).toContain(".NET 10 Runtime");
  const card = wolvenKitCard(waiting);
  expect(card).toMatchObject({ primary: { label: "Get .NET 10 Runtime from Microsoft", action: "runtime-install" }, secondary: { action: "runtime-recheck" } });
  expect(wolvenKitLinkUrl(waiting, "runtime-installer")).toStartWith("https://aka.ms/dotnet/10.0/");
  setDotNet(WITH_NET10);
  expect(service.recheck().phase).toBe("ready");
});

test("a WolvenKit the user chose always wins, and a missing one says so plainly", () => {
  const root = temporary();
  const own = join(root, "own", "WolvenKit.CLI.exe");
  let configured: string | null = own;
  const { service } = host({ configured: () => configured });
  expect(plain(service.snapshot())).toMatchObject({ phase: "custom-missing", source: "custom", canInstall: false });
  require("node:fs").mkdirSync(join(root, "own"), { recursive: true });
  writeFileSync(own, "MZ user copy");
  expect(service.snapshot()).toMatchObject({ phase: "ready", source: "custom" });
  expect(service.usable()).toBe(own);
  configured = null;
  expect(service.snapshot().phase).toBe("available");
});

test("interrupted downloads are retried; damaged, withdrawn and unreachable ones fail plainly and leave nothing behind", async () => {
  requests = {};
  const flaky = host({ asset: "flaky.zip" });
  flaky.service.install("9.9.9-fixture"); await flaky.service.settled();
  expect(flaky.service.snapshot().phase).toBe("ready");
  expect(requests["/flaky.zip"]).toBe(2);

  const tampered = host({ asset: "tampered.zip" });
  tampered.service.install("9.9.9-fixture"); await tampered.service.settled();
  const integrity = plain(tampered.service.snapshot());
  expect(integrity).toMatchObject({ phase: "failed", code: "wolvenkit_integrity", canInstall: true });
  expect(integrity.message).toContain("didn't match its official release");
  expect(leftovers(tampered.root)).toEqual([]);
  expect(existsSync(join(tampered.root, "wolvenkit", "9.9.9-fixture"))).toBe(false);
  expect(requests["/tampered.zip"]).toBe(1);

  const gone = host({ asset: "gone.zip" });
  gone.service.install("9.9.9-fixture"); await gone.service.settled();
  expect(gone.service.snapshot()).toMatchObject({ phase: "failed", code: "wolvenkit_http" });
  expect(requests["/gone.zip"]).toBe(1);

  const busy = host({ asset: "error.zip" });
  busy.service.install("9.9.9-fixture"); await busy.service.settled();
  expect(busy.service.snapshot()).toMatchObject({ phase: "failed", code: "wolvenkit_network" });
  expect(requests["/error.zip"]).toBe(3);

  const offline = host({ release: { ...release(), url: "http://127.0.0.1:1/offline.zip" } });
  offline.service.install("9.9.9-fixture"); await offline.service.settled();
  const unreachable = plain(offline.service.snapshot());
  expect(unreachable).toMatchObject({ phase: "failed", code: "wolvenkit_offline" });
  expect(unreachable.message).toContain("online");
  expect(wolvenKitCard(unreachable).primary?.action).toBe("wolvenkit-retry");
});

test("cancelling stops the download at once and removes the partial file", async () => {
  const { root, service } = host({ asset: "slow.zip" });
  service.install("9.9.9-fixture");
  await Bun.sleep(150);
  expect(service.snapshot().progress?.receivedBytes).toBeGreaterThan(0);
  service.cancel();
  await service.settled();
  expect(plain(service.snapshot())).toMatchObject({ phase: "failed", code: "wolvenkit_cancelled", canInstall: true });
  expect(leftovers(root)).toEqual([]);
  expect(wolvenKitCard(service.snapshot()).title).toBe("WolvenKit wasn't downloaded");
});

test("other platforms are told to use their own WolvenKit", () => {
  expect(host({ platform: "linux" }).service.snapshot()).toMatchObject({ phase: "unsupported", canInstall: false });
});

test("the endpoint takes only install with the offered version, cancel or recheck, from this computer", async () => {
  const { service } = host();
  const handler = createWolvenKitSetupHandler(service);
  const url = "http://127.0.0.1:4317/api/wolvenkit";
  const post = (body: unknown, origin = "http://127.0.0.1:4317") => handler(new Request(url, { method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  expect(await (await handler(new Request(url))).json()).toMatchObject({ phase: "available" });
  expect((await handler(new Request("http://localhost:4317/api/wolvenkit"))).status).toBe(403);
  expect((await post({ action: "install", version: "9.9.9-fixture" }, "https://attacker.example")).status).toBe(403);
  expect((await post({ action: "install", version: "9.9.9-fixture", url: "https://evil.example/x.zip" })).status).toBe(400);
  expect((await post({ action: "install" })).status).toBe(400);
  expect((await post({ action: "install", version: "0.0.1" })).status).toBe(409);
  expect((await post({ action: "install", version: "9.9.9-fixture" })).status).toBe(202);
  await service.settled();
  expect(await (await post({ action: "recheck" })).json()).toMatchObject({ phase: "ready" });
  expect((await post({ action: "cancel" })).status).toBe(200);
});

test("renderer actions poll while working and every card speaks plainly", async () => {
  const { service } = host({ asset: "slow.zip" });
  const handler = createWolvenKitSetupHandler(service);
  const actions = new WolvenKitSetupActions(async request => {
    const response = await handler(request.action === "refresh" ? new Request("http://127.0.0.1:1/api/wolvenkit")
      : new Request("http://127.0.0.1:1/api/wolvenkit", { method: "POST", headers: { Origin: "http://127.0.0.1:1", "Content-Type": "application/json" },
        body: JSON.stringify(request) }));
    return { ok: response.ok, data: await response.json() };
  }, 20);
  expect(actions.capability({ kind: "wolvenkit.install", version: "9.9.9-fixture" }).available).toBe(false);
  await actions.dispatch({ kind: "wolvenkit.refresh" });
  expect(actions.capability({ kind: "wolvenkit.install", version: "1.0" }).available).toBe(false);
  expect(await actions.dispatch({ kind: "wolvenkit.install", version: "9.9.9-fixture" })).toEqual({ ok: true });
  await Bun.sleep(120);
  const downloading = actions.snapshot()!;
  expect(downloading.phase).toBe("downloading");
  const card = wolvenKitCard(downloading);
  expect(card).toMatchObject({ primary: { action: "wolvenkit-cancel" }, visible: true });
  expect(card.progress).toBeGreaterThan(0);
  expect(await actions.dispatch({ kind: "wolvenkit.cancel" })).toEqual({ ok: true });
  await service.settled();
  actions.dispose();
  const phases: WolvenKitSetupState["phase"][] = ["available", "downloading", "installing", "needs-runtime", "failed", "custom-missing", "unsupported", "ready"];
  for (const phase of phases) {
    const view = wolvenKitCard({ ...service.snapshot(), phase, runtime: { name: ".NET 10 Runtime", installed: false, installerUrl: "", pageUrl: "" } });
    for (const text of [view.title, view.body, view.viewport, view.primary?.label ?? "", view.secondary?.label ?? ""])
      expect(USER_FACING_JARGON.test(text), `${phase}: ${text}`).toBe(false);
    expect(view.visible).toBe(phase !== "ready");
  }
  expect(Object.keys(WOLVENKIT_DESCRIPTORS).sort()).toEqual(["wolvenkit.cancel", "wolvenkit.install", "wolvenkit.recheck", "wolvenkit.refresh"]);
  expect(WOLVENKIT_DESCRIPTORS["wolvenkit.install"]).toMatchObject({ scope: ["host"], cancellable: true, payload: { version: { type: "string" } } });
});

// Opt-in: the real pinned release from GitHub (about 45 MB). XFS_TEST_WOLVENKIT_DOWNLOAD=1 bun test tests/wolvenkit-setup.test.ts
test.skipIf(!process.env.XFS_TEST_WOLVENKIT_DOWNLOAD)("the real pinned WolvenKit release downloads, verifies and runs", async () => {
  const root = temporary();
  const service = new WolvenKitSetupHost({ root, configured: () => null, findExisting: () => null });
  expect(service.install(WOLVENKIT_RELEASE.version).phase).toBe("downloading");
  await service.settled();
  const state = service.snapshot();
  expect(["ready", "needs-runtime"]).toContain(state.phase);
  expect(service.managedExecutable()).toBe(join(root, "wolvenkit", WOLVENKIT_RELEASE.version, "WolvenKit.CLI.exe"));
  if (state.phase === "ready") {
    const { probeWolvenKitCli } = await import("../src/wolvenkit-cli");
    expect(probeWolvenKitCli(service.usable()!)).toEqual({ ok: true, version: WOLVENKIT_RELEASE.version });
  }
}, 600_000);

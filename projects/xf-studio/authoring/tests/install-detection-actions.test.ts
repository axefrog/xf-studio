import { expect, test } from "bun:test";
import { InstallDetectionActions, type InstallDetectionTransport } from "../src/install-detection-actions";
import { createInstallDetectionHandler } from "../src/install-detection-server";
import type { DetectionHostPort } from "../src/install-detection";
import { DETECTION_DESCRIPTORS } from "../src/studio-action-descriptors";
import type { FrameworkHostPort, FrameworkVersionCheck } from "../src/framework-versions";

const games = { schema: "xfs/game-install-detection-1", supported: true, candidates: [], rejected: [], issues: [], limitations: [] };

test("detection actions are catalogued read-only host requests", () => {
  expect(Object.keys(DETECTION_DESCRIPTORS).sort()).toEqual(["detect.frameworkVersions", "detect.gameInstalls",
    "detect.mo2Instances"]);
  for (const descriptor of Object.values(DETECTION_DESCRIPTORS))
    expect(descriptor).toEqual({ scope: ["host"], effect: "read", payload: {}, async: true, cancellable: false });
  const actions = new InstallDetectionActions(null);
  expect(actions.descriptors()).toEqual(DETECTION_DESCRIPTORS);
  expect(actions.capability({ kind: "detect.gameInstalls" })).toEqual({ available: false,
    reason: "Install detection is unavailable on this host." });
});

test("dispatch publishes a detached result, refuses overlap and rejects unexpected payloads", async () => {
  let release!: () => void;
  const calls: string[] = [];
  const transport: InstallDetectionTransport = async target => {
    calls.push(target);
    if (target === "games") await new Promise<void>(done => { release = done; });
    return { ok: true, status: 200, data: target === "games" ? games as any : { schema: "wrong" } as any };
  };
  const actions = new InstallDetectionActions(transport);
  let notified = 0; actions.subscribe(() => notified++);
  const pending = actions.dispatch({ kind: "detect.gameInstalls" });
  expect(actions.snapshot().busy).toBe("games");
  expect(await actions.dispatch({ kind: "detect.mo2Instances" })).toMatchObject({ ok: false, code: "unavailable" });
  release();
  expect(await pending).toEqual({ ok: true });
  const snapshot = actions.snapshot();
  (snapshot.games as any).candidates.push("tampered");
  expect(actions.snapshot().games?.candidates).toEqual([]);
  expect(await actions.dispatch({ kind: "detect.mo2Instances" })).toMatchObject({ ok: false, code: "invalid_result" });
  expect(actions.snapshot().mo2).toBeUndefined();
  expect(calls).toEqual(["games", "mo2"]);
  expect(notified).toBeGreaterThanOrEqual(4);
});

test("host endpoint is GET-only, same-origin and accepts only fixed targets", async () => {
  const host: DetectionHostPort = { platform: "linux", env: () => undefined, registry: async () => null,
    readText: () => null, isFile: () => false, directories: () => null, files: () => null };
  const handle = createInstallDetectionHandler(() => host);
  const at = (path: string, init?: RequestInit) => handle(new Request(`http://127.0.0.1:4317${path}`, init));
  expect((await at("/api/install-detection?target=games")).status).toBe(200);
  expect(await (await at("/api/install-detection?target=mo2")).json()).toMatchObject({ schema: "xfs/mo2-instance-detection-1", supported: false });
  expect((await at("/api/install-detection?target=C:\\")).status).toBe(400);
  expect((await at("/api/install-detection?target=games&path=x")).status).toBe(400);
  expect((await at("/api/install-detection?target=games", { method: "POST" })).status).toBe(405);
  expect((await at("/api/install-detection?target=games", { headers: { Origin: "http://evil.example" } })).status).toBe(403);
  expect((await handle(new Request("http://localhost:4317/api/install-detection?target=games"))).status).toBe(403);
  // Without a settings source the host cannot check frameworks, and the browser never supplies paths.
  expect(await (await at("/api/install-detection?target=frameworks")).json()).toMatchObject({ code: "unavailable" });
  expect((await at("/api/install-detection?target=frameworks&gameRoot=C:\\")).status).toBe(400);
});

test("the framework check reads host-owned settings only and publishes a detached report", async () => {
  const port: FrameworkHostPort = { readText: () => null, isFile: path => path.endsWith("Cyberpunk2077.exe"),
    readBytes: () => null };
  const reads: string[] = [];
  const handle = createInstallDetectionHandler(undefined, { port: () => port, settings: () => {
    reads.push("settings");
    return { gameRoot: "C:\\Game", launchRoute: "direct", mo2Root: null, mo2ProfileId: null };
  } });
  const response = await handle(new Request("http://127.0.0.1:4317/api/install-detection?target=frameworks"));
  const report = await response.json() as FrameworkVersionCheck;
  expect(report).toMatchObject({ schema: "xfs/framework-version-check-1", selectedRoute: "direct" });
  expect(report.routes.map(route => route.route)).toEqual(["direct"]);
  expect(report.routes[0]!.verdicts.find(row => row.framework === "archivexl")?.status).toBe("missing");
  expect(JSON.stringify(report)).not.toContain("C:\\\\Game");
  expect(reads).toEqual(["settings"]);

  const actions = new InstallDetectionActions(async target => ({ ok: true, status: 200,
    data: target === "frameworks" ? report : games as any }));
  expect(actions.capability({ kind: "detect.frameworkVersions" })).toEqual({ available: true });
  expect(await actions.dispatch({ kind: "detect.frameworkVersions" })).toEqual({ ok: true });
  const snapshot = actions.snapshot();
  (snapshot.frameworks as any).routes.length = 0;
  expect(actions.snapshot().frameworks?.routes).toHaveLength(1);
});

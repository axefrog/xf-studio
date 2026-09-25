import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PreviewCoreHost, type PreviewCoreState } from "../src/preview-core-host";
import { createPreviewCoreHandler } from "../src/preview-core-server";
import { isPreviewState, PreviewPreparationActions, previewView, shouldAutoStart, type PreviewState } from "../src/preview-preparation";
import { USER_FACING_JARGON } from "../src/alpha-availability";
import { EYE_PLATE_RECIPE } from "../src/eye-plate-recipe";
import { createGameAssetExporter } from "../src/game-asset-export";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const temporary = () => { const root = mkdtempSync(join(tmpdir(), "xfs-preview-host-")); roots.push(root); return root; };
function setup() {
  const root = temporary();
  const game = join(root, "game"), cli = join(root, "WolvenKit.CLI.exe");
  mkdirSync(join(game, "archive", "pc", "content"), { recursive: true });
  writeFileSync(cli, "");
  return { root, game, cli, cacheRoot: join(root, "cache") };
}

test("the host reports what setup the preview still needs, in plain language", () => {
  const { game, cli, cacheRoot } = setup();
  let settings = { gameRoot: null as string | null, wolvenKitCli: null as string | null };
  const host = new PreviewCoreHost({ cacheRoot, settings: () => settings });
  expect(host.snapshot()).toMatchObject({ phase: "needs-setup", needs: ["game", "wolvenkit"], code: "preview_game_missing", canPrepare: false });
  settings = { gameRoot: game, wolvenKitCli: null };
  const noTool = host.snapshot();
  expect(noTool).toMatchObject({ phase: "needs-setup", needs: ["wolvenkit"], code: "preview_tool_missing" });
  expect(noTool.message).toMatch(/WolvenKit CLI/);
  settings = { gameRoot: game, wolvenKitCli: cli };
  expect(host.snapshot()).toMatchObject({ phase: "idle", canPrepare: true, canCancel: false });
  expect(host.assetPath("head.glb")).toBeNull();
  expect(host.assetPath("../settings.json")).toBeNull();
  for (const state of [host.snapshot(), noTool]) expect(USER_FACING_JARGON.test(state.message)).toBe(false);
});

test("the host runs one preparation at a time, reports progress and records failures", async () => {
  const { game, cli, cacheRoot } = setup();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const host = new PreviewCoreHost({ cacheRoot, settings: () => ({ gameRoot: game, wolvenKitCli: cli }),
    exporter: () => createGameAssetExporter(join(cacheRoot, "exports"), async () => { await gate; }, { contains: () => new Set() }) });
  const started = host.prepare();
  expect(started).toMatchObject({ phase: "preparing", canCancel: true, progress: { index: 0, total: 5 } });
  expect(host.prepare().phase).toBe("preparing");
  release();
  await host.settled();
  // The fake export wrote nothing and the stand-in archive index lacks the head, so it is reported missing.
  const failed = host.snapshot();
  expect(failed).toMatchObject({ phase: "blocked", code: "preview_source_missing", canPrepare: true });
});

test("cancelling a running preparation stops it and offers a restart", async () => {
  const { game, cli, cacheRoot } = setup();
  const host = new PreviewCoreHost({ cacheRoot, settings: () => ({ gameRoot: game, wolvenKitCli: cli }),
    exporter: () => createGameAssetExporter(join(cacheRoot, "exports"), ({ signal }) => new Promise((_, reject) => signal!.addEventListener("abort", () =>
      reject(Object.assign(Error("cancelled"), { code: "preview_cancelled" }))))) });
  host.prepare();
  expect(host.cancel().phase).toBe("preparing");
  await host.settled();
  expect(host.snapshot()).toMatchObject({ phase: "failed", code: "preview_cancelled", canPrepare: true });
});

test("the endpoint serves state, accepts only prepare or cancel, and refuses other origins", async () => {
  const { game, cacheRoot } = setup();
  const host = new PreviewCoreHost({ cacheRoot, settings: () => ({ gameRoot: game, wolvenKitCli: null }) });
  const handler = createPreviewCoreHandler(host);
  const url = "http://127.0.0.1:4317/api/preview-core";
  const get = await handler(new Request(url));
  expect(((await get.json()) as PreviewCoreState).phase).toBe("needs-setup");
  const post = (body: unknown, headers: Record<string, string> = { Origin: "http://127.0.0.1:4317", "Content-Type": "application/json" }) =>
    handler(new Request(url, { method: "POST", headers, body: JSON.stringify(body) }));
  expect((await post({ action: "prepare" }, { Origin: "https://evil.example", "Content-Type": "application/json" })).status).toBe(403);
  expect((await post({ action: "prepare" }, { "Content-Type": "application/json" })).status).toBe(403);
  expect((await post({ action: "prepare", gameRoot: "C:\\" })).status).toBe(400);
  expect((await post({ action: "delete" })).status).toBe(400);
  expect((await post({ action: "prepare" })).status).toBe(409);
  expect((await post({ action: "cancel" })).status).toBe(200);
  expect((await handler(new Request("http://localhost:4317/api/preview-core"))).status).toBe(403);
  expect((await handler(new Request(url, { method: "PUT" }))).status).toBe(405);
});

const state = (patch: Partial<PreviewState>): PreviewState => ({ schema: "xfs/preview-core-state-1", phase: "idle", message: "Ready to prepare.",
  code: null, needs: [], progress: null, lastDurationSeconds: null, canPrepare: true, canCancel: false, ...patch });

test("the preparation card offers exactly one next step for each state", () => {
  expect(previewView(state({ phase: "ready" })).visible).toBe(false);
  expect(previewView(state({})).primary?.action).toBe("prepare");
  const preparing = previewView(state({ phase: "preparing", canPrepare: false, canCancel: true, progress: { index: 1, total: 5, label: "Checking" } }));
  expect(preparing).toMatchObject({ title: "Preparing the 3D preview from your Cyberpunk 2077 files…", primary: { action: "cancel" }, step: "Step 2 of 5: Checking" });
  expect(preparing.progress).toBeCloseTo(0.3);
  expect(previewView(state({ phase: "needs-setup", needs: ["game", "wolvenkit"] }), "D:\\Games\\Cyberpunk 2077").primary?.action).toBe("use-game");
  expect(previewView(state({ phase: "needs-setup", needs: ["game"] })).primary?.action).toBe("setup");
  expect(previewView(state({ phase: "needs-setup", needs: ["wolvenkit"] })).title).toMatch(/WolvenKit/);
  expect(previewView(state({ phase: "blocked", message: "newer game patch" })).primary?.action).toBe("retry");
  expect(previewView(state({ phase: "failed", code: "preview_cancelled" })).viewport).toMatch(/wasn't prepared/);
  for (const phase of ["idle", "needs-setup", "preparing", "failed", "blocked"] as const) {
    const view = previewView(state({ phase, needs: phase === "needs-setup" ? ["wolvenkit"] : [] }));
    expect(USER_FACING_JARGON.test(`${view.title} ${view.body} ${view.viewport}`)).toBe(false);
  }
  expect(shouldAutoStart(state({}), false)).toBe(true);
  expect(shouldAutoStart(state({}), true)).toBe(false);
  expect(shouldAutoStart(state({ phase: "failed" }), false)).toBe(false);
  expect(isPreviewState({ schema: "xfs/preview-core-state-1" })).toBe(false);
});

test("renderer actions poll while preparing and stop once the host is ready", async () => {
  const replies = [state({ phase: "preparing", canPrepare: false, canCancel: true }), state({ phase: "ready", canPrepare: false })];
  const calls: string[] = [];
  const actions = new PreviewPreparationActions(async action => { calls.push(action); return { ok: true, data: replies.shift() ?? state({ phase: "ready", canPrepare: false }) }; }, 5);
  expect(actions.capability({ kind: "preview.prepare" }).available).toBe(false);
  await actions.dispatch({ kind: "preview.refresh" });
  expect(actions.snapshot()?.phase).toBe("preparing");
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(actions.snapshot()?.phase).toBe("ready");
  expect(calls).toEqual(["refresh", "refresh"]);
  expect(await actions.dispatch({ kind: "preview.cancel" })).toMatchObject({ ok: false });
  const broken = new PreviewPreparationActions(async () => { throw Error("offline"); });
  expect(await broken.dispatch({ kind: "preview.refresh" })).toMatchObject({ ok: false });
  actions.dispose();
});

test("the preview and the Build plate derive from one audited head recipe", async () => {
  const { PREVIEW_CORE_RECIPE } = await import("../src/preview-core-recipe");
  expect(PREVIEW_CORE_RECIPE.plateRecipeId).toBe(EYE_PLATE_RECIPE.id);
});

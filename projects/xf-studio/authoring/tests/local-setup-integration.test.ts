import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLocalSettings } from "../src/local-settings";
import { LocalSettingsStore } from "../src/local-settings-store";
import { createLocalSettingsHandler } from "../src/local-settings-server";
import { LocalSetupActions } from "../src/local-setup-actions";
import { localPackageTools } from "../src/package-server";

test("local setup edits control package paths without accepting paths in package requests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xfs-setup-integration-"));
  try {
    const store = new LocalSettingsStore(dir);
    const handler = createLocalSettingsHandler(store, {});
    const transport = async (method: "GET" | "PATCH" | "POST", body?: unknown) => {
      const request = new Request("http://127.0.0.1:4317/api/local-settings", { method,
        headers: body ? { Origin: "http://127.0.0.1:4317", "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined });
      const response = await handler(request);
      return { ok: response.ok, status: response.status, data: await response.json() };
    };
    const actions = new LocalSetupActions(transport);
    expect((await actions.dispatch({ kind: "setup.refresh" })).ok).toBe(true);
    expect(actions.snapshot().view?.readiness.check.ready).toBe(true);
    expect(actions.snapshot().view?.readiness.build.ready).toBe(false);
    const game = join(dir, "game"), plate = join(dir, "plate"), cli = join(dir, "WolvenKit.CLI.exe");
    mkdirSync(join(game, "bin", "x64"), { recursive: true });
    mkdirSync(join(game, "archive", "pc"), { recursive: true });
    mkdirSync(plate);
    writeFileSync(join(game, "bin", "x64", "Cyberpunk2077.exe"), "");
    writeFileSync(cli, "");
    const fields = { ...actions.snapshot().view!.fields, gameRoot: game, plateInput: plate, wolvenKitCli: cli };
    expect((await actions.dispatch({ kind: "setup.save", fields })).ok).toBe(true);
    expect(actions.snapshot().view?.readiness.build.ready).toBe(true);
    expect(localPackageTools(store.load().settings, {}).gamepath).toBe(game);
    expect(localPackageTools(store.load().settings, { XFS_PACKAGE_PLATE: join(dir, "override") }).plate).toBe(join(dir, "override"));
    expect(JSON.parse(readFileSync(store.file, "utf8")).gameRoot).toBe(game);
    const stale = await transport("PATCH", { revision: 0, fields });
    expect(stale.status).toBe(409);
    const injected = await transport("PATCH", { revision: 1, fields: { secret: "no" } });
    expect(injected.status).toBe(400);
    const crossSite = await handler(new Request("http://127.0.0.1:4317/api/local-settings", {
      method: "PATCH", headers: { Origin: "https://other.example", "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 1, fields }),
    }));
    expect(crossSite.status).toBe(403);
    expect(store.load().settings.revision).toBe(1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("saved MO2 route reports profile readiness while direct route excludes MO2", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xfs-setup-route-"));
  try {
    const store = new LocalSettingsStore(dir), game = join(dir, "game"), mo2 = join(dir, "mo2");
    mkdirSync(join(game, "bin", "x64"), { recursive: true });
    mkdirSync(join(game, "archive", "pc"), { recursive: true });
    writeFileSync(join(game, "bin", "x64", "Cyberpunk2077.exe"), "");
    mkdirSync(join(mo2, "mods"), { recursive: true });
    mkdirSync(join(mo2, "profiles", "Profile A"), { recursive: true });
    writeFileSync(join(mo2, "profiles", "Profile A", "modlist.txt"), "+Example\n");
    store.save({ ...defaultLocalSettings(), gameRoot: game, launchRoute: "mo2", mo2Root: mo2,
      mo2ProfileId: "Profile A" }, 0);
    const handler = createLocalSettingsHandler(store, {});
    const result = await handler(new Request("http://127.0.0.1:4317/api/local-settings"));
    const view = await result.json();
    expect(view.readiness.sourceDiscovery.ready).toBe(true);
    expect(view.readiness.sourceDiscovery.limits[0]).toContain("not prove a runtime winner");
    expect(JSON.stringify(view.readiness)).not.toContain(dir);
    expect(view.fields.mo2Root).toBe(mo2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Bridge 0.4 through the command API against the self-test host (the real bridge core and pipe with a
// simulated game): the in-game message line and the session runner's echo, V's clothing, manual saves and
// loading, and the write classes that gate them. Proves nothing about the game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { lightParams } from "../api/catalogue.ts";
import { runScript, SCRIPT_SCHEMA, type SessionScript } from "../session.ts";
import { startSelftestHost, tempDir, type Host } from "./helpers.ts";

const apiFor = (host: Host) =>
  new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-b5-cap-"), "captures"), auditDir: tempDir("xfb-b5-audit-"), idleCloseMs: 300 });

async function bridge(api: CommandApi, method: string, params: Record<string, unknown> = {}) {
  const response = await api.callBridge(method, params, `t-${method}`);
  expect(response.ok, JSON.stringify(response)).toBe(true);
  return (response as { result: any }).result;
}

const texts = async (api: CommandApi) => ((await bridge(api, "selftest.messages")).messages as { text: string; level: string }[]).map((m) => `${m.level}:${m.text}`);

describe("ui.message and the session runner's echo", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    // A read-only bridge: a message changes nothing in the game, so it needs no write permission.
    host = await startSelftestHost([], 60);
    api = apiFor(host);
  });
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("a message shows (one clean line), at most four at once, and clear removes them", async () => {
    const shown = await api.run("ui.message", { text: "Open the\ncreator please", level: "ask", seconds: 30 });
    expect(shown.ok, JSON.stringify(shown)).toBe(true);
    if (shown.ok) expect(shown.result).toMatchObject({ shown: true, text: "Open the creator please", undo: { method: "ui.message", params: { clear: true } } });
    for (let i = 1; i <= 4; i++) await api.run("ui.message", { text: `note ${i}` });
    expect(await texts(api)).toEqual(["info:note 1", "info:note 2", "info:note 3", "info:note 4"]);
    const cleared = await api.run("ui.message", { clear: true });
    expect(cleared.ok).toBe(true);
    expect(await texts(api)).toEqual([]);
    const refused = await api.run("ui.message", { text: "x", level: "shout" });
    expect(!refused.ok && refused.error.code).toBe("bad_input");
  });

  test("the session runner shows its notes and asks in the game, and clears an ask once answered", async () => {
    const seen: string[][] = [];
    const script: SessionScript = {
      schema: SCRIPT_SCHEMA,
      name: "echo",
      title: "Echo check",
      steps: [
        { do: "note", label: "n1", text: "Framing the eyes next." },
        { do: "ask", label: "a1", text: "Press Confirm in the creator." },
      ],
    };
    const result = await runScript(script, {
      api,
      outDir: tempDir("xfb-b5-echo-"),
      log: () => {},
      ask: async () => {
        seen.push(await texts(api));
      },
    });
    expect(result.outcome).toBe("complete");
    expect(seen[0]).toContain("info:Framing the eyes next.");
    expect(seen[0]).toContain("ask:Press Confirm in the creator.");
    expect(result.records.find((r) => r.label === "a1")!.echoed).toBe(true);
    // Answered: the ask is gone; the runner's closing line is up.
    const after = await texts(api);
    expect(after.some((t) => t.includes("Press Confirm"))).toBe(false);
    expect(after.some((t) => t.startsWith("done:XF session complete"))).toBe(true);
  });

  test("--no-echo (echo: false) shows nothing", async () => {
    await api.run("ui.message", { clear: true });
    const result = await runScript(
      { schema: SCRIPT_SCHEMA, name: "quiet", steps: [{ do: "note", label: "n", text: "quiet" }] },
      { api, outDir: tempDir("xfb-b5-quiet-"), log: () => {}, echo: false },
    );
    expect(result.outcome).toBe("complete");
    expect(await texts(api)).toEqual([]);
  });
});

describe("inventory, saves and loading (write classes inventory and save)", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", "photo,world,character,inventory,save"], 90);
    api = apiFor(host);
  });
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("inventory.equip adds a missing item only when asked, waits for the slot, and its undo takes it off and out again", async () => {
    await bridge(api, "selftest.phase", { phase: "gameplay" });
    const refused = await api.run("inventory.equip", { item: "Items.Helmet_01_basic_01" });
    expect(!refused.ok && refused.error.code).toBe("not_in_inventory");
    const equipped = await api.run("inventory.equip", { item: "Items.Helmet_01_basic_01", add_if_missing: true });
    expect(equipped.ok, JSON.stringify(equipped)).toBe(true);
    if (!equipped.ok) return;
    const result = equipped.result as { equipped: boolean; added: boolean; slot: string; undo: { method: string; params: Record<string, unknown> } };
    expect(result).toMatchObject({ equipped: true, added: true, slot: "Head" });
    expect((await bridge(api, "selftest.state")).worn).toEqual({ Head: "Items.Helmet_01_basic_01" });
    const undone = await api.run(result.undo.method, result.undo.params);
    expect(undone.ok, JSON.stringify(undone)).toBe(true);
    const state = await bridge(api, "selftest.state");
    expect(state.worn).toEqual({});
    expect(state.inventory).not.toContain("Items.Helmet_01_basic_01");
    // An item the bridge didn't add stays.
    await api.run("inventory.equip", { item: "Items.Jacket_01_basic_01" });
    const kept = await api.run("inventory.unequip", { item: "Items.Jacket_01_basic_01", remove_added: true });
    expect(!kept.ok && kept.error.code).toBe("not_added_by_bridge");
    const wrongSlot = await api.run("inventory.equip", { item: "Items.Helmet_01_basic_01", slot: "Feet", add_if_missing: true });
    expect(!wrongSlot.ok && wrongSlot.error.code).toBe("bad_params");
  });

  test("game.save is refused while the bridge's changes are live, saves with override_lock, and the lock comes back", async () => {
    await bridge(api, "selftest.phase", { phase: "gameplay" });
    // Any bridge change takes the save lock (here: V's clothing above).
    expect((await bridge(api, "selftest.state")).save_lock).toBe(true);
    const refused = await api.run("game.save", { name: "session 4 start" });
    expect(!refused.ok && refused.error.code).toBe("bridge_save_lock");
    expect(!refused.ok && refused.error.message).toContain("override_lock");
    const saved = await api.run("game.save", { name: "session 4 start", override_lock: true });
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    if (saved.ok) expect(saved.result).toMatchObject({ saved: true, lock_overridden: true, undo: null });
    const state = await bridge(api, "selftest.state");
    expect(state.saves[0]).toBe("ManualSave-4");
    expect(state.save_lock).toBe(true);
  }, 20000);

  test("game.load by name loads that save (the lock goes with it); an unknown name lists the game's saves", async () => {
    const missing = await api.run("game.load", { name: "ManualSave-99" });
    expect(!missing.ok && missing.error.code).toBe("save_not_found");
    expect(!missing.ok && missing.error.detail).toContain("AutoSave-1");
    const both = await api.run("game.load", { latest: true, name: "AutoSave-1" });
    expect(!both.ok && both.error.code).toBe("bad_input");
    await bridge(api, "selftest.phase", { phase: "photo_mode" });
    const inPhoto = await api.run("game.load", { latest: true });
    expect(!inPhoto.ok && inPhoto.error.code).toBe("not_in_gameplay");
    await bridge(api, "selftest.phase", { phase: "gameplay" });
    const loaded = await api.run("game.load", { name: "autosave-1" });
    expect(loaded.ok, JSON.stringify(loaded)).toBe(true);
    if (loaded.ok) expect(loaded.result).toMatchObject({ requested: true, route: "name", name: "AutoSave-1" });
    const waited = await api.run("game.wait", { phase: ["gameplay"], timeout_ms: 5000 });
    expect(waited.ok).toBe(true);
    expect((await bridge(api, "selftest.state")).save_lock).toBe(false);
    const latest = await api.run("game.load", { latest: true });
    expect(latest.ok && (latest.result as { route: string }).route).toBe("latest");
    await api.run("game.wait", { phase: ["gameplay"], timeout_ms: 5000 });
  }, 20000);
});

describe("write classes for the new commands", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    // The -writes package's default: inventory stays off until the maintainer approves it.
    host = await startSelftestHost(["--allow-writes", "--write-classes", "photo,world,character,save"], 60);
    api = apiFor(host);
  });
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("inventory commands are refused unless the inventory class is allowed; the plain answer names it", async () => {
    const outcome = await api.run("inventory.equip", { item: "Items.Helmet_01_basic_01", add_if_missing: true });
    expect(!outcome.ok && outcome.error.code).toBe("write_class_disabled");
    expect(!outcome.ok && outcome.error.message).toContain("inventory");
    expect((await bridge(api, "selftest.state")).inventory).not.toContain("Items.Helmet_01_basic_01");
  });

  test("photo.light.set's place takes {camera: true} for the bridge's \"camera\", and one form at a time", () => {
    expect(lightParams({ light: 1, place: { camera: true } })).toEqual({ light: 1, place: "camera" });
    expect(lightParams({ light: 1, place: { azimuth: 30 } })).toEqual({ light: 1, place: { azimuth: 30 } });
    expect(() => lightParams({ light: 1, place: { camera: true, azimuth: 30 } })).toThrow(/alone/);
    expect(() => lightParams({ light: 1, place: { world: [0, 0, 0], distance: 2 } })).toThrow(/alone/);
  });
});

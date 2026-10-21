// Bridge 0.8.3: session 10's bridge findings on the tools' side, offline, with fake transports and against the self-test
// host: the ink panel's mapping and its floors at 16:9, 21:9 and 32:9 (B1, B2), emergency calls typed with underscores from
// a second process (L2c), session.resume on the control route, the staged showroom found through the game's own folder (G1),
// inventory.list, the smooth look's time, and the surfaces' new names. Proves nothing about the game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BridgeResponse } from "../bridge-lib.ts";
import type { CommandContext } from "../api/catalogue.ts";
import { findCommand } from "../api/catalogue.ts";
import { REFUSALS } from "../api/catalogue080.ts";
import { CommandApi, type BridgeTransport, type CommandOutcome } from "../api/command-api.ts";
import { ANCHORS, FLOORS, modelVisible, place, plausible, type Anchor, type Rect } from "../overlay/ink-place.ts";
import { resolveStaged, showroomBuilds, showroomDists } from "../showroom/plan.ts";
import { stagedArchives } from "../showroom/commands.ts";
import { HOOK_TIMEOUT_MS, projectDir, sleep, startSelftestHost, tempDir, type Host } from "./helpers.ts";

type Any = any;
const codeOf = (outcome: CommandOutcome) => (outcome.ok ? "ok" : outcome.error.code);
const answer = (result: unknown): BridgeResponse => ({ v: 1, id: 1, cid: "c", ok: true, result });
const within = <T>(promise: Promise<T>, ms: number) => Promise.race([promise, sleep(ms).then(() => "pending" as const)]);

// --- B1, B2: the ink panel's mapping and floors --------------------------------------------------------------------------

/** The game's own HUD blocks, in the HUD's design units (2160 per screen height), from session 10's capture at 3840 x 1600. */
const HUD_BLOCKS = [
  { name: "minimap and quest tracker", corner: "top_right", w: 800, h: 1250 },
  { name: "status and cyberware icons", corner: "bottom_left", w: 600, h: 460 },
  { name: "prompts and weapon", corner: "bottom_right", w: 700, h: 540 },
  { name: "status bars", corner: "top_left", w: 900, h: 280 },
] as const;

function blockRect(block: (typeof HUD_BLOCKS)[number], visible: Rect): Rect {
  const hud = visible.h / 2160;
  const w = block.w * hud, h = block.h * hud;
  const right = block.corner.endsWith("_right"), bottom = block.corner.startsWith("bottom_");
  return { x: right ? visible.x + visible.w - w : visible.x, y: bottom ? visible.y + visible.h - h : visible.y, w, h };
}
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("0.8.3 B1, B2: where the ink panel goes", () => {
  test("the redscript says what ink-place.ts says (the model, the plausibility check and every floor)", () => {
    const reds = readFileSync(join(projectDir, "redscript", "XFRuntimeBridgeInk.reds"), "utf8");
    expect(reds).toContain("return new Vector4(0.0, 0.0, rootWidth, screen.Y * rootWidth / screen.X);");
    expect(reds).toContain("WidgetUtils.GlobalToLocal(this.m_root, new Vector2(0.0, 0.0))");
    expect(reds).toContain("let hud = v.W / 2160.0;");
    expect(reds).toContain("return start + fraction * length + offset - fraction * size;");
    const floorFn = reds.slice(reds.indexOf("public static func Floor(name: String) -> Vector2 {"), reds.indexOf("public static func AnchorPoint"));
    for (const anchor of ANCHORS) {
      const [x, y] = FLOORS[anchor];
      if (x === 0 && y === 0) continue;
      const pattern = new RegExp(`Equals\\(name, "${anchor}"\\)[^{]*\\{\\s*return new Vector2\\(${x.toFixed(1)}, ${y.toFixed(1)}\\);`);
      expect(pattern.test(floorFn), anchor).toBe(true);
    }
    // 0.8's centred crop is gone.
    expect(reds).not.toContain("(this.m_height - shownHeight) * 0.5");
  });

  test("session 10's screen (3840 x 1600): the visible part is the canvas's top 1600 units, and the reported anchors land where asked", () => {
    const visible = modelVisible(3840, 2160, { x: 3840, y: 1600 });
    expect(visible).toEqual({ x: 0, y: 0, w: 3840, h: 1600 });
    const panel = { x: 1000, y: 300 };
    // The default: top left, 40 in and 360 down (under the status bars), as session 10 expected and 0.8.2 put at 640.
    expect(place("top_left", { x: 40, y: 360 }, panel, visible)).toEqual({ x: 40, y: 360 });
    // top_right with y 60: its top edge at 60 (session 10: about 360), left of the minimap and the quest tracker.
    const topRight = place("top_right", { x: 60, y: 60 }, panel, visible);
    expect(topRight.y).toBe(60);
    expect(3840 - (topRight.x + panel.x)).toBeCloseTo(860 * (1600 / 2160), 6);
    // bottom_left with y 60: whole on screen (session 10: entirely below it), above the status and cyberware icons.
    const bottomLeft = place("bottom_left", { x: 60, y: 60 }, panel, visible);
    expect(bottomLeft.y + panel.y).toBeLessThanOrEqual(1600);
    expect(1600 - (bottomLeft.y + panel.y)).toBeCloseTo(520 * (1600 / 2160), 6);
  });

  for (const [label, screen] of [["16:9", { x: 3840, y: 2160 }], ["21:9", { x: 3840, y: 1600 }], ["32:9", { x: 5120, y: 1440 }], ["16:9 at 1920 x 1080", { x: 1920, y: 1080 }]] as const) {
    test(`${label}: all nine anchors whole on screen and clear of the game's HUD blocks`, () => {
      const visible = modelVisible(3840, 2160, screen);
      const panel = { x: 1000 * (visible.h / 1600), y: 300 * (visible.h / 1600) };
      for (const anchor of ANCHORS) {
        for (const offset of [{ x: 60, y: 60 }, { x: 40, y: 360 }, { x: 0, y: 0 }]) {
          const at = place(anchor as Anchor, offset, panel, visible);
          const rect = { x: at.x, y: at.y, w: panel.x, h: panel.y };
          expect(rect.x >= visible.x && rect.x + rect.w <= visible.x + visible.w, `${anchor} across`).toBe(true);
          expect(rect.y >= visible.y && rect.y + rect.h <= visible.y + visible.h, `${anchor} down`).toBe(true);
          if (anchor === "center" || anchor === "center_left") continue; // the middle of the screen has no HUD block to clear
          for (const block of HUD_BLOCKS) expect(overlaps(rect, blockRect(block, visible)), `${anchor} ${JSON.stringify(offset)} vs ${block.name}`).toBe(false);
        }
      }
    });
  }

  test("a measurement is used only when plausible: the screen's aspect, a finite area near the root", () => {
    const screen = { x: 3840, y: 1600 };
    expect(plausible({ x: 0, y: 0 }, { x: 3840, y: 1600 }, screen, 3840, 2160)).toEqual({ x: 0, y: 0, w: 3840, h: 1600 });
    expect(plausible({ x: 0, y: -280 }, { x: 3840, y: 1320 }, screen, 3840, 2160)).toEqual({ x: 0, y: -280, w: 3840, h: 1600 });
    expect(plausible({ x: 0, y: 0 }, { x: 0, y: 0 }, screen, 3840, 2160)).toBeNull(); // before the first layout
    expect(plausible({ x: 0, y: 0 }, { x: 3840, y: 2160 }, screen, 3840, 2160)).toBeNull(); // another aspect
    expect(plausible({ x: Number.NaN, y: 0 }, { x: 3840, y: 1600 }, screen, 3840, 2160)).toBeNull();
    expect(plausible({ x: 0, y: 0 }, { x: 3840e3, y: 1600e3 }, screen, 3840, 2160)).toBeNull();
  });
});

// --- L2c: emergency calls from any process ---------------------------------------------------------------------------------

function twoPipes(dir: string, mainBusyMs: number) {
  writeFileSync(join(dir, "session.json"), JSON.stringify({ protocol: 1, pid: process.pid, pipe: "p", control_pipe: "p-control", sid: "s", token: "t" }));
  const main: string[] = [];
  const control: string[] = [];
  const mainTransport: BridgeTransport = {
    call: async (method) => {
      main.push(method);
      // Another process's game_wait holds the main pipe: every call there waits (session 10's L2c refused bridge_busy).
      await sleep(mainBusyMs);
      return { v: 1, id: 1, cid: "c", ok: false, error: { code: "bridge_busy", message: "busy" } };
    },
    close: () => undefined,
  };
  const controlTransport: BridgeTransport = {
    call: async (method, params) => {
      control.push(`${method}${method === "bridge.handover" ? `:${String(params.on)}` : ""}`);
      if (method === "bridge.handover") return answer({ was: !params.on, player_released: { released: true, removed: [] } });
      return answer(method === "game.status" ? { phase: "gameplay" } : { stopped: true });
    },
    close: () => undefined,
  };
  const api = new CommandApi({ runtimeDir: dir, auditDir: join(dir, "logs"), captureRoot: join(dir, "captures"), transport: async () => mainTransport, controlTransport: async () => controlTransport, idleCloseMs: 60_000 });
  return { api, main, control };
}

describe("0.8.3 L2c: handover, resume and the stops work from any process, typed either way", () => {
  test("session_handover and session_resume (the MCP names, as the command line takes them) go on the control pipe at once", async () => {
    const { api, main, control } = twoPipes(tempDir("xfb-083-l2c-"), 20_000);
    const started = performance.now();
    const handover = await within(api.run("session_handover", { note: "L2c" }), 3000);
    expect(handover !== "pending" && codeOf(handover)).toBe("ok");
    expect(handover !== "pending" && handover.command).toBe("session.handover");
    const resume = await within(api.run("session_resume", {}), 3000);
    expect(resume !== "pending" && codeOf(resume)).toBe("ok");
    expect(performance.now() - started).toBeLessThan(3000);
    expect(control).toEqual(expect.arrayContaining(["bridge.handover:true", "bridge.handover:false"]));
    expect(control.indexOf("bridge.handover:true")).toBeLessThan(control.indexOf("bridge.handover:false"));
    expect(main).toEqual([]);
    api.close();
  }, 15_000);

  test("player_stop and behave_stop (underscores) go on the control pipe too, beside a busy main pipe", async () => {
    const { api, main, control } = twoPipes(tempDir("xfb-083-stops-"), 20_000);
    const [a, b] = await Promise.all([api.run("player_stop", {}), api.run("behave_stop", { all: true })]);
    expect([codeOf(a), codeOf(b)]).toEqual(["ok", "ok"]);
    expect(control).toEqual(["player.stop", "behave.stop"]);
    expect(main).toEqual([]);
    api.close();
  });

  test("a resume sent while a handover's steps are still going waits for them (the order is kept on the control route)", async () => {
    const dir = tempDir("xfb-083-order-");
    writeFileSync(join(dir, "session.json"), JSON.stringify({ protocol: 1, pid: process.pid, pipe: "p", control_pipe: "p-control", sid: "s", token: "t" }));
    const order: string[] = [];
    const controlTransport: BridgeTransport = {
      call: async (method, params) => {
        if (method === "behave.stop") await sleep(200); // the handover's first step is slow
        if (method === "bridge.handover") order.push(`handover:${String(params.on)}`);
        return answer(method === "bridge.handover" ? { was: !params.on, player_released: { released: true, removed: [] } } : method === "game.status" ? { phase: "gameplay" } : {});
      },
      close: () => undefined,
    };
    const api = new CommandApi({ runtimeDir: dir, auditDir: join(dir, "logs"), transport: async () => controlTransport, controlTransport: async () => controlTransport, idleCloseMs: 60_000 });
    const handover = api.run("session.handover", {});
    const resume = api.run("session.resume", {});
    expect([codeOf(await handover), codeOf(await resume)]).toEqual(["ok", "ok"]);
    expect(order).toEqual(["handover:true", "handover:false"]);
    api.close();
  });
});

// --- G1: the staged showroom, through the game's own folder ------------------------------------------------------------------

function manifestFor(archive: string, names: string[]) {
  const key = archive.slice("xfs_showroom_".length);
  const root = `axefrog/appearance_studio/collections/${key}/showroom/`;
  const light = { name: "Main_Face", position: [0, 0.7, 1.0], axis: [0, -1, 0], lumen: 40, falloff: "linear", radius: 5, outer: 45, inner: 15, softness: 2 };
  return {
    schema: "xfs/showroom-package-1",
    archive,
    entity: `${root}xfs_showroom.ent`,
    rigEntity: `${root}xfs_showroom_rig.ent`,
    headJoint: [0, -0.0403, 1.6397],
    pieces: names.map((name, i) => ({ id: `p${i}`, name, appearance: `xfs_p${String(i).padStart(32, "0")}`, route: "flat" })),
    rigs: Object.fromEntries(["creator", "creator_face", "key"].map((r) => [r, { appearance: `xfs_rig_${r}`, lights: [light] }])),
  };
}

describe("0.8.3 G1: the staged showroom found by itself", () => {
  const a = "xfs_showroom_" + "a".repeat(32), b = "xfs_showroom_" + "b".repeat(32), c = "xfs_showroom_" + "c".repeat(32);

  test("a self-describing build's own manifest; an older build matched to this machine's build with the same bytes; the rest says why", () => {
    const dist = tempDir("xfb-083-dist-");
    const build = (archive: string, folder: string, bytes: string, names: string[]) => {
      const mod = join(dist, folder, "archive", "pc", "mod");
      mkdirSync(mod, { recursive: true });
      writeFileSync(join(mod, `${archive}.archive`), bytes);
      writeFileSync(join(dist, folder, "manifest.json"), JSON.stringify(manifestFor(archive, names)));
    };
    build(b, `${b}-1`, "old bytes", ["Old B"]);
    build(b, `${b}-2`, "staged bytes", ["Gloss B"]);
    build(c, `${c}-1`, "other bytes", ["Glitter C"]);
    const sha = (text: string) => createHash("sha256").update(text).digest("hex");
    const { resolved, unresolved } = resolveStaged(
      [
        { archive: a, sha256: sha("shipped"), manifest: manifestFor(a, ["Gloss A"]) },
        { archive: b, sha256: sha("staged bytes") },
        { archive: c, sha256: sha("staged c bytes") },
        { archive: "xfs_showroom_" + "d".repeat(32), sha256: sha("d") },
      ],
      showroomBuilds(dist),
    );
    expect(resolved.map((r) => [r.archive, r.by, r.showroom.pieces[0]!.name])).toEqual([
      [a, "shipped_manifest", "Gloss A"],
      [b, "matched_build", "Gloss B"],
    ]);
    expect(resolved[1]!.manifest).toContain(`${b}-2`);
    expect(unresolved.map((u) => u.why)).toEqual([expect.stringContaining("matches none"), expect.stringContaining("no build of it")]);
  });

  test("this checkout's dist and the primary checkout's are both searched (session 10 ran the tools from a worktree)", () => {
    const dists = showroomDists();
    expect(dists.every((d) => d.endsWith(join("projects", "xf-studio", "dist")) || process.env.XFS_SHOWROOM_DIST)).toBe(true);
  });

  test("showroom.staged's answer drives the discovery; a bridge without the method falls back (unknown_method is null)", async () => {
    const context = (result: BridgeResponse) => ({ cid: "t", api: { callBridge: async () => (result.ok ? { ok: true, result: result.result } : { ok: false, error: result.error }) } }) as unknown as CommandContext;
    expect(await stagedArchives(context(answer({ archives: [{ archive: a }] })))).toEqual([{ archive: a }]);
    expect(await stagedArchives(context({ v: 1, id: 1, cid: "c", ok: false, error: { code: "unknown_method", message: "x" } }))).toBeNull();
    expect(REFUSALS["showroom.spawn"]).toContain("showroom_not_staged");
  });
});

// --- against the self-test host ------------------------------------------------------------------------------------------

describe("0.8.3 against the self-test host", () => {
  let host: Host;
  let api: CommandApi;
  const mod = tempDir("xfb-083-mod-");
  const a = "xfs_showroom_" + "a".repeat(32);
  beforeAll(async () => {
    writeFileSync(join(mod, `${a}.archive`), "abc");
    writeFileSync(join(mod, `${a}.showroom.json`), JSON.stringify(manifestFor(a, ["Gloss A"])));
    writeFileSync(join(mod, "someone_else.archive"), "x");
    host = await startSelftestHost(["--allow-writes", "--write-classes", "photo,world,character,save,showroom,inventory,player", "--mod-dir", mod], 240);
    api = new CommandApi({ runtimeDir: host.dir, auditDir: join(host.dir, "logs"), captureRoot: join(host.dir, "captures") });
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("showroom.staged lists the showroom archive the game sees, with the manifest its build ships", async () => {
    const out = await api.callBridge("showroom.staged", {}, "t-staged");
    expect(out.ok).toBe(true);
    const archives = (out as Any).result.archives as Any[];
    expect(archives.map((x) => x.archive)).toEqual([a]);
    expect(archives[0].sha256).toBe(createHash("sha256").update("abc").digest("hex"));
    expect(archives[0].manifest.pieces[0].name).toBe("Gloss A");
  });

  test("inventory.list: the clothing V owns, one slot, a limit", async () => {
    const all = await api.run("inventory.list", {});
    expect(codeOf(all)).toBe("ok");
    expect((all as Any).result.count).toBe(3);
    const jackets = await api.run("inventory_list", { slot: "OuterChest", limit: 1 });
    expect((jackets as Any).result.items).toEqual([expect.objectContaining({ item: "Items.Jacket_01_basic_01", id: "1111", worn: true })]);
    expect((jackets as Any).result.count).toBe(2);
    expect(codeOf(await api.run("inventory.list", { slot: "Weapon" }))).toBe("bad_input");
  });

  test("the frame and bridge.info name the surfaces by their 0.8.3 names", async () => {
    const frame = await api.callBridge("selftest.hud", {}, "t-hud");
    expect(frame.ok && (frame as Any).result.surface).toBe("cet_line");
  });
});

// --- the smooth look's time, the catalogue ----------------------------------------------------------------------------------

describe("0.8.3 L2a and the catalogue", () => {
  test("player.look's client timeout covers a five-second smooth look; inventory.list is a read with its refusals", () => {
    const look = findCommand("player.look")!;
    expect(look.bridge!.timeoutMs!({ mode: "smooth", duration_s: 5 })).toBeGreaterThanOrEqual(10_000);
    expect(look.bridge!.timeoutMs!({})).toBeGreaterThanOrEqual(5000);
    expect(look.description).toContain("takes duration_s");
    const list = findCommand("inventory_list")!;
    expect(list.permission).toBe("read");
    expect(REFUSALS["inventory.list"]).toBeDefined();
  });
});

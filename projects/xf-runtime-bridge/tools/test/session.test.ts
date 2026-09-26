// The session runner: script checks, and full runs against the self-test bridge host (simulated
// game) with captures of a synthetic window. No game involved.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { BridgeClient } from "../bridge-lib.ts";
import { planScript, runScript, SCRIPT_SCHEMA, type SessionScript } from "../session.ts";
import { openSyntheticWindow, projectDir, sleep, startSelftestHost, tempDir, type Host, type Synthetic } from "./helpers.ts";

const script = (steps: SessionScript["steps"], extra: Partial<SessionScript> = {}): SessionScript => ({ schema: SCRIPT_SCHEMA, name: "t", steps, ...extra });

describe("planScript", () => {
  test("resolves step kinds to catalogue commands and merges defaults", () => {
    const { plan, problems } = planScript(
      script(
        [
          { do: "set camera", label: "cam", preset: "face" },
          { do: "capture", label: "shot one" },
          { do: "run", label: "status", command: "game.status" },
          { do: "wait", ms: 10 },
          { do: "note", text: "hello" },
          { do: "ask", text: "do something" },
        ],
        { defaults: { capture: { region: "face" } } },
      ),
    );
    expect(problems).toEqual([]);
    expect(plan.map((p) => p.command ?? p.kind)).toEqual(["photo.camera.set", "capture.screenshot", "game.status", "wait", "note", "ask"]);
    expect(plan[1].input).toEqual({ region: "face", name: "shot-one" });
  });

  test("reports every problem in plain words", () => {
    const { problems } = planScript({
      schema: "other",
      name: "bad name!",
      steps: [
        { do: "dance" },
        { do: "run", command: "system.exec" },
        { do: "set camera", label: "x", fov: "wide" },
        { do: "capture", label: "x" },
        { do: "wait", ms: -1 },
        { do: "ask" },
      ],
      restore: [{ do: "ask", text: "no" }],
    } as SessionScript);
    const text = problems.join("\n");
    for (const expected of ["schema must be", "name must be", 'unknown step "dance"', 'no command "system.exec"', "must be a number", 'label "x" is used more than once', "wait needs", 'ask needs "text"', "restore steps can't ask"]) {
      expect(text).toContain(expected);
    }
  });

  test("the committed session scripts are valid and follow their cards", () => {
    const dir = join(projectDir, "tools", "sessions");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.sort()).toEqual(["session-2.json", "session-3.json"]);
    for (const file of files) {
      const s = JSON.parse(readFileSync(join(dir, file), "utf8")) as SessionScript;
      const { plan, problems } = planScript(s);
      expect(problems, file).toEqual([]);
      expect(existsSync(join(projectDir, "..", "..", s.card!)), file).toBe(true);
      // Every photo-mode excursion ends with photo.exit, and restore leaves photo mode too.
      const enters = plan.filter((p) => p.command === "photo.enter").length;
      const exits = plan.filter((p) => p.phase === "steps" && p.command === "photo.exit").length;
      expect(exits, file).toBe(enters);
      expect(plan.some((p) => p.phase === "restore" && p.command === "photo.exit")).toBe(true);
      // The very first thing the player is asked is to make a safety save, before any write.
      const firstWrite = plan.findIndex((p) => p.command && !["bridge.info", "game.status", "game.wait", "player.appearance", "photo.state", "capture.screenshot"].includes(p.command));
      const firstAsk = plan.findIndex((p) => p.kind === "ask");
      expect(firstAsk).toBeLessThan(firstWrite);
      expect(plan[firstAsk].text).toContain("manual save");
    }
    const s2 = planScript(JSON.parse(readFileSync(join(dir, "session-2.json"), "utf8"))).plan;
    const indices = s2.filter((p) => p.command === "cc.apply").map((p) => p.input!.index as number);
    expect(new Set(indices)).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    // Card step 2: the placement pair comes before every other preset.
    expect(indices.slice(0, 3)).toEqual([11, 12, 11]);
  });
});

describe("runScript against the self-test host", () => {
  let host: Host;
  let synthetic: Synthetic;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes"], 120);
    synthetic = await openSyntheticWindow(1920, 1080);
  });
  afterAll(async () => {
    synthetic?.close();
    await host?.stop();
  });
  const api = () => new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-sess-cap-"), "captures"), captureTarget: { hwnd: synthetic.hwnd }, idleCloseMs: 300 });

  test("runs steps, records undo notes and files, pauses at an ask, and continues --from the next step", async () => {
    const out = tempDir("xfb-sess-out-");
    const s = script(
      [
        { do: "run", label: "enter", command: "photo.enter" },
        { do: "set camera", label: "cam", preset: "face" },
        { do: "capture", label: "shot", region: "center-16x9", max_width: 640 },
        { do: "apply cc", label: "cc-refused", option: "XF", index: 1, expect_error: "not_in_character_menu" },
        { do: "ask", label: "ask-1", text: "Look at the screen." },
        { do: "run", label: "after-ask", command: "photo.hud.hide", input: { hidden: true } },
        { do: "run", label: "leave", command: "photo.exit" },
      ],
      { restore: [{ do: "run", label: "restore-exit", command: "photo.exit", continue_on_error: true }] },
    );
    const lines: string[] = [];
    const first = await runScript(s, { api: api(), outDir: out, log: (l) => lines.push(l) });
    expect(first.outcome).toBe("paused");
    expect(first.next).toBe("after-ask");
    const done = first.records.filter((r) => !r.skipped);
    expect(done.map((r) => r.label)).toEqual(["enter", "cam", "shot", "cc-refused"]);
    expect(done.every((r) => r.ok)).toBe(true);
    expect(done[1].undo).toContain("reset");
    const shot = done[2];
    expect(existsSync(join(out, shot.files!.full))).toBe(true);
    expect((shot.result as any).view.width).toBe(640);
    expect(first.records.some((r) => r.label === "restore-exit")).toBe(false); // no restore while paused
    expect(lines.some((l) => l.includes("ASK: Look at the screen."))).toBe(true);

    await sleep(400);
    const second = await runScript(s, { api: api(), outDir: out, from: first.next, log: () => {} });
    expect(second.outcome).toBe("complete");
    expect(second.records.filter((r) => !r.skipped).map((r) => r.label)).toEqual(["after-ask", "leave", "restore-exit"]);
    const manifest = JSON.parse(readFileSync(first.manifestPath, "utf8"));
    expect(manifest.schema).toBe("xfb/session-report-2");
    expect(manifest.runs.map((r: any) => r.outcome)).toEqual(["paused", "complete"]);
    expect(manifest.runs[0].continue_from).toBe("after-ask");
    expect(manifest.runs[1].before.bridge.allow_writes ?? manifest.runs[1].before.bridge).toBeTruthy();
  }, 30000);

  test("an interactive ask waits for the answer instead of pausing", async () => {
    const asked: string[] = [];
    const result = await runScript(script([{ do: "ask", label: "a", text: "Press Enter" }, { do: "run", label: "s", command: "game.status" }]), {
      api: api(),
      outDir: tempDir("xfb-sess-ask-"),
      ask: async (text) => void asked.push(text),
      log: () => {},
    });
    expect(result.outcome).toBe("complete");
    expect(asked).toEqual(["Press Enter"]);
  });

  test("a failed step stops the run and restore still runs; an unexpected success counts as a failure", async () => {
    await sleep(400);
    const result = await runScript(
      script(
        [
          { do: "run", label: "ok", command: "game.status" },
          { do: "set camera", label: "not-in-photo", preset: "face" },
          { do: "run", label: "never", command: "game.status" },
        ],
        { restore: [{ do: "run", label: "restore-status", command: "game.status" }] },
      ),
      { api: api(), outDir: tempDir("xfb-sess-fail-"), log: () => {} },
    );
    expect(result.outcome).toBe("failed");
    const byLabel = Object.fromEntries(result.records.map((r) => [r.label, r]));
    expect((byLabel["not-in-photo"].error as any).code).toBe("not_in_photo_mode");
    expect(byLabel["never"].skipped).toBe(true);
    expect(byLabel["restore-status"].ok).toBe(true);

    await sleep(400);
    const unexpected = await runScript(script([{ do: "run", label: "s", command: "game.status", expect_error: "not_in_gameplay" }]), {
      api: api(),
      outDir: tempDir("xfb-sess-unexp-"),
      log: () => {},
    });
    expect(unexpected.outcome).toBe("failed");
    expect((unexpected.records[0].error as any).code).toBe("unexpected_success");
  }, 20000);

  test("game.wait follows the player: it returns once the phase changes", async () => {
    await sleep(400);
    // A short idle close lets another client in between the runner's twice-a-second polls.
    const running = runScript(script([{ do: "run", label: "w", command: "game.wait", input: { phase: ["character_menu"], timeout_ms: 20000 } }]), {
      api: new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-sess-w-"), "captures"), idleCloseMs: 150 }),
      outDir: tempDir("xfb-sess-wait-"),
      log: () => {},
    });
    await sleep(1200);
    expect(await Promise.race([running.then(() => "done"), sleep(50).then(() => "waiting")])).toBe("waiting");
    let flipped = false;
    for (let attempt = 0; attempt < 50 && !flipped; attempt++) {
      const flip = new BridgeClient(host.session, 3000);
      try {
        await flip.connect();
        flipped = (await flip.call("selftest.phase", { phase: "character_menu" }, `t-flip-${attempt}`)).ok;
      } catch {
        await sleep(100);
      } finally {
        flip.close();
      }
    }
    expect(flipped).toBe(true);
    const done = await running;
    expect(done.outcome).toBe("complete");
    expect((done.records.find((r) => r.label === "w")!.result as any).phase).toBe("character_menu");
    await sleep(400);
    const reset = new BridgeClient(host.session, 3000);
    await reset.connect();
    await reset.call("selftest.phase", { phase: "gameplay" }, "t-reset");
    reset.close();
  }, 40000);
});

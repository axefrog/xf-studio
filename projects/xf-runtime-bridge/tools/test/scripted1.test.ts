// Scripted session 1's fixes (26 October, local/sessions/scripted-1/friction.md): the handover notice, and the
// runner's rules that came out of the session. Fake bridges and hosts; nothing reaches a game.

import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BridgeResponse } from "../bridge-lib.ts";
import { CommandApi, type BridgeTransport } from "../api/command-api.ts";
import { tempDir } from "./helpers.ts";

/** A fake bridge that answers bridge.handover and ui.message (each message gets an id), and records every call. */
function fakeBridge() {
  const dir = tempDir("xfb-s1-");
  writeFileSync(join(dir, "session.json"), JSON.stringify({ protocol: 1, pid: process.pid, pipe: String.raw`\\.\pipe\xfb-none`, sid: "s", token: "t" }));
  const sent: { method: string; params: Record<string, unknown> }[] = [];
  let id = 40;
  const answer = (result: unknown): BridgeResponse => ({ v: 1, id: 1, cid: "c", ok: true, result });
  const transport: BridgeTransport = {
    call: async (method, params) => {
      sent.push({ method, params });
      if (method === "bridge.handover") return answer({ was: !params.on, player_released: { released: true, removed: [] } });
      if (method === "ui.message") return answer(params.withdraw ? { withdrawn: params.withdraw } : { id: ++id });
      return answer({});
    },
    close: () => undefined,
  };
  const api = new CommandApi({ runtimeDir: dir, auditDir: join(dir, "logs"), captureRoot: join(dir, "captures"), transport: async () => transport, controlTransport: async () => transport, idleCloseMs: 60_000 });
  return { api, sent, messages: () => sent.filter((s) => s.method === "ui.message").map((s) => s.params) };
}

describe("6: the handover notice never stacks", () => {
  test("handover, resume, handover: each notice is withdrawn before the next, at info level", async () => {
    const { api, messages } = fakeBridge();
    for (const name of ["session.handover", "session.resume", "session.handover", "session.handover"]) expect((await api.run(name, {})).ok).toBe(true);
    const m = messages();
    const notices = m.filter((p) => String(p.text ?? "").startsWith("Handed over"));
    expect(notices.length).toBe(3);
    expect(notices.every((p) => p.level === "info")).toBe(true);
    // The resume took the first notice down, and the third handover took the second's.
    expect(m.filter((p) => p.withdraw !== undefined).map((p) => p.withdraw)).toEqual([41, 43]);
    api.close();
  });

  test("quiet posts nothing, but still withdraws an open notice", async () => {
    const { api, messages } = fakeBridge();
    await api.run("session.handover", {});
    await api.run("session.resume", { quiet: true });
    await api.run("session.handover", { quiet: true });
    await api.run("session.resume", { quiet: true });
    const m = messages();
    expect(m.filter((p) => p.text !== undefined).length).toBe(1);
    expect(m.filter((p) => p.withdraw !== undefined).map((p) => p.withdraw)).toEqual([41]);
    api.close();
  });
});

describe("7: the host never launches a second game", () => {
  test("launch refuses while Cyberpunk2077.exe runs (adopt it), and starts nothing", async () => {
    const { windowsHost } = await import("../testing/host.ts");
    const host = Object.create(windowsHost) as typeof windowsHost;
    host.gameProcess = async () => ({ pid: 76_000 });
    const result = await host.launch({ exe: "C:/no/such/ModOrganizer.exe", profile: "p", executable: "g" });
    expect(result.started).toBe(false);
    expect(result.error).toContain("already_running");
    expect(result.error).toContain("76000");
  });

  test("the prelude adopts a running game: its launch step answers already_running, which is fine, and nothing is launched", async () => {
    const { FakeClock } = await import("./fake-clock.ts");
    const { fakeApi, fakeHost, go, script, stagedMod } = await import("./batch-fakes.ts");
    const clock = new FakeClock();
    const dir = tempDir("xfb-s1-");
    const host = fakeHost({ running: true });
    const result = await go(script([{ id: "r", title: "r", requires: [{ config: "bridge.allow_writes", equals: "true" }], steps: [{ do: "set", value: 1 }] }]), fakeApi(clock), host, clock, dir, { fixtures: { staged_mod: stagedMod(dir), mo2: { exe: "m", profile: "p", executable: "g" } } });
    expect(result.rows[0].verdict).toBe("PASS");
    expect(host.log).toEqual([]);
  });
});

// Fakes for the schema-3 batch tests: a command API with an event stream, answers and a recorder, and a host
// whose game process comes and goes. Shared by batch.test.ts and batch-halt.test.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandApi } from "../api/command-api.ts";
import { encodePng } from "../capture/image.ts";
import { runBatch, type BatchScript, type Row } from "../testing/batch.ts";
import { stagedConfigPath } from "../testing/config-ini.ts";
import type { Host } from "../testing/host.ts";
import { FakeClock } from "./fake-clock.ts";

export type Handler = (input: Record<string, any>, n: number) => { ok: true; result: unknown } | { ok: false; code: string; message?: string } | Promise<any>;

/** A fake command API: handlers per command, an event stream for cursors, answers and session.wait, and a call log. */
export function fakeApi(clock: FakeClock, handlers: Record<string, Handler> = {}, options: { autoAnswer?: string } = {}) {
  const calls: { name: string; input: Record<string, any> }[] = [];
  const events: { seq: number; kind: string; t_ms: number; data?: Record<string, unknown> }[] = [];
  let messageId = 100;
  let recorderRuns = 0;
  const counts = new Map<string, number>();
  const push = (kind: string, data: Record<string, unknown>) => events.push({ seq: events.length + 1, kind, t_ms: clock.now(), data });
  const builtin: Record<string, Handler> = {
    "bridge.info": () => ({ ok: true, result: { sid: api.sid, plugin_version: "0.8.22" } }),
    "test.record.start": () => ({ ok: true, result: { run: ++recorderRuns } }),
    "game.catchup": (input) => ({ ok: true, result: { cursor: { after: (input.cursor?.after ?? 0) + 1 }, counts: { v: 3 }, gaps: [] } }),
    "bridge.ping": () => ({ ok: true, result: { pong: true } }),
    "session.events": (input) => {
      const after = events.filter((e) => e.seq > (input.since ?? 0)).slice(0, input.limit ?? 500);
      return { ok: true, result: { events: input.limit === 1 && input.since === 0 ? [] : after, next: input.limit === 1 && input.since === 0 ? events.length : (after.at(-1)?.seq ?? input.since ?? 0), latest: events.length, dropped: 0 } };
    },
    "session.wait": async (input) => { await clock.sleep((input.timeout_s ?? 1) * 1000); return { ok: true, result: {} }; },
    "ui.message": (input) => {
      if (input.level === "ask") {
        const id = ++messageId;
        if (options.autoAnswer) push("answer", { message_id: id, label: options.autoAnswer, choice: 0, via: "game" });
        return { ok: true, result: { id } };
      }
      return { ok: true, result: { id: ++messageId } };
    },
    "npc.status": () => ({ ok: true, result: { npcs: [] } }),
    "game.status": () => ({ ok: true, result: { phase: "gameplay" } }),
    "game.wait": (input) => ({ ok: true, result: { phase: Array.isArray(input.phase) ? input.phase[0] : input.phase } }),
    "game.load": () => ({ ok: true, result: { reached: "gameplay" } }),
  };
  const api = {
    sid: "sid-1",
    runtimeDir: "unused",
    calls,
    events,
    push,
    async run(name: string, input: Record<string, any> = {}, opts: { captureRoot?: string } = {}) {
      calls.push({ name, input });
      const n = (counts.get(name) ?? 0) + 1;
      counts.set(name, n);
      if ((name === "capture.screenshot" || name === "capture.burst") && !handlers[name]) {
        const dir = opts.captureRoot ?? "."; mkdirSync(dir, { recursive: true });
        const file = join(dir, `${input.name}.full.png`);
        const shade = (calls.length * 37) % 255;
        writeFileSync(file, encodePng({ width: 8, height: 8, rgb: new Uint8Array(8 * 8 * 3).fill(shade) }));
        return { ok: true, command: name, cid: "c", result: name === "capture.burst" ? { contact_sheet: { path: file }, manifest: file } : { full: { path: file }, view: { path: file } } };
      }
      const handler = handlers[name] ?? builtin[name];
      const answer = handler ? await handler(input, n) : { ok: true, result: {} };
      return answer.ok ? { ok: true, command: name, cid: "c", result: answer.result } : { ok: false, command: name, cid: "c", error: { code: answer.code, message: answer.message ?? answer.code } };
    },
    release() {},
    closed: false,
    close() { api.closed = true; },
  };
  return api;
}

/** A fake host: a game process that comes and goes, key presses that may be refused, free commit. */
export function fakeHost(options: { running?: boolean; foreground?: boolean; freeGb?: number; onLaunch?: () => void; launchBlocked?: string; noProcessAfterLaunch?: boolean; windowsAnimations?: boolean | null } = {}) {
  const log: string[] = [];
  let running = options.running ?? true;
  const host: Host & { log: string[]; free: number; crash: () => void } = {
    log,
    crash: () => { running = false; },
    free: (options.freeGb ?? 40) * 1024 ** 3,
    async gameProcess() { return running ? { pid: 4242 } : null; },
    async launch() { log.push("launch"); running = !options.noProcessAfterLaunch; options.onLaunch?.(); return { started: true, command: "ModOrganizer.exe -p test run -e game" }; },
    async requestClose() { log.push("close"); running = false; return true; },
    async foreground() { return options.foreground === false ? "Explorer" : "Cyberpunk2077"; },
    async pressKeys(vks, label) { log.push(`key ${label}`); return options.foreground === false ? { sent: false, keys: label, refused: "the foreground window is Explorer, not the game" } : { sent: true, keys: label }; },
    // The fake captures are 8 x 8, so the fake window is too (the CET window's area is derived from it).
    async window() { return { pid: 4242, width: 8, height: 8, x: 0, y: 0, foreground: true, covers_monitor: false, minimized: false }; },
    async monitors() { return [{ name: "DISPLAY1", x: 0, y: 0, width: 3840, height: 1600, primary: true }]; },
    async freeCommitBytes() { return host.free; },
    async processStats() { return { private_bytes: 8 * 1024 ** 3, working_set: 6 * 1024 ** 3, handles: 12_000 }; },
    async systemHandles() { return 500_000; },
    async launchBlocked() { return options.launchBlocked ?? null; },
    async windowsAnimations() { return options.windowsAnimations === undefined ? true : options.windowsAnimations; },
  };
  return host;
}

export const STAGED_INI = "; test\r\n[bridge]\r\nenabled = true\r\nallow_writes = true\r\nallow_write_classes = photo, world, save\r\n\r\n[ui]\r\nanswer_keys = IK_F6\r\n\r\n[overlay]\r\nenabled = false\r\ntheme = dark\r\nmotion = auto\r\n";
export function stagedMod(dir: string) {
  const mod = join(dir, "mod");
  mkdirSync(join(mod, "red4ext", "plugins", "XFRuntimeBridge"), { recursive: true });
  writeFileSync(stagedConfigPath(mod), STAGED_INI);
  return mod;
}

export const script = (rows: Row[], extra: Partial<BatchScript> = {}): BatchScript => ({ schema: "xfb/session-script-3", name: "t", rows, ...extra });
export const go = (s: BatchScript, api: ReturnType<typeof fakeApi>, host: Host, clock: FakeClock, dir: string, extra: Record<string, unknown> = {}) =>
  runBatch(s, { api: api as unknown as CommandApi, host, outDir: join(dir, "out"), clock, echo: false, log: () => {}, fixtures: extra.fixtures as Record<string, unknown> | undefined, readCetBindings: () => null, ...extra });

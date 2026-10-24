// The transport-agnostic command API: the single place where commands are validated, run and
// answered. Frontends (the MCP server, the CLI, the session runner, and later the desktop app or
// user scripts) only list the catalogue and call `run`; none of them talks to the pipe itself.
//
//   frontends  ->  CommandApi.run(name, input)  ->  bridge connection (bridge-lib.ts)  ->  game
//                                               ->  local handlers (capture)
//
// Every write command is recorded in an audit log with its reversal note before it is sent.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BridgeClient, PipeConnectError, defaultRuntimeDir, readSession, type BridgeResponse, type BridgeSession } from "../bridge-lib.ts";
import { DEFAULT_CAPTURE_ROOT, type CaptureTarget } from "../capture/capture.ts";
import { CATALOGUE, findCommand, type CommandDef, type CommandResult } from "./catalogue.ts";
import { NO_BRIDGE, connectError, plainBridgeError, type PlainError } from "./errors.ts";
import { validate } from "./schema.ts";
import { sendKeyToWindow, type KeySender } from "../input/photo-key.ts";
import { describeWindow, mainWindowOf } from "../capture/win32.ts";
import { EventCaptures } from "../testing/event-captures.ts";
import { withHandoverLock, type HandoverBusyError } from "../handover-lock.ts";

export type CommandOutcome =
  | { ok: true; command: string; cid: string; result: unknown; images?: ImageRef[]; undo?: string }
  | { ok: false; command: string; cid: string; error: PlainError };

/** Per-call options: a correlation id, the calling frontend (for logs), where captures go, and a signal that ends a long local wait (game.wait). */
export type RunOptions = { cid?: string; source?: string; captureRoot?: string; signal?: AbortSignal; deadlineMs?: number };

export type ImageRef = { path: string; width: number; height: number; mimeType: "image/png"; role: "view" | "full" };

/** What the command API needs from a bridge connection; the pipe client or a test fake. */
export interface BridgeTransport {
  /** timeoutMs: a longer wait than the client's own, for a method known to take longer. */
  call(method: string, params: Record<string, unknown>, cid: string, timeoutMs?: number): Promise<BridgeResponse>;
  close(): void;
}
/**
 * Opens a connection. busyWaitMs (0.8.2): how long a pipe another client holds is tried again, asynchronously (0: once, so a
 * kill falls back to the KILL file at once); the default is the client's timeout.
 */
export type TransportFactory = (session: BridgeSession, options?: { busyWaitMs?: number }) => Promise<BridgeTransport>;

export type CommandApiOptions = {
  /** Runtime folder holding session.json; the default is the one the plugin uses. Tests pass their own. */
  runtimeDir?: string;
  /** Where captures and the audit log go (ignored by git). */
  captureRoot?: string;
  auditDir?: string;
  transport?: TransportFactory;
  /**
   * The control pipe's connection (0.8.1, RB-121; tests pass a fake): the emergency controls go there, beside a request the
   * main pipe is still serving. The default opens session.json's control_pipe for each call, and when the bridge has none
   * (an older build) they go on the main pipe.
   */
  controlTransport?: TransportFactory;
  /** Capture target override (tests); the default is the game process named by session.json. */
  captureTarget?: CaptureTarget;
  /** Close the pipe after this long without a command, so other XF tools can connect. */
  idleCloseMs?: number;
  clientTimeoutMs?: number;
  /** photo.open's key sender (tests pass a fake: the real one presses a key in the game window). */
  keySender?: KeySender;
  /**
   * The client's own pace (0.5.2, RB-77): at most this many bridge requests per second, in bursts of twice as many, kept
   * below the plugin's limit (max_requests_per_second, default 20, in bursts of 40) so framing's reads and writes never
   * meet it. Default 18.
   */
  requestsPerSecond?: number;
  /** How long a request refused rate_limited is retried, with growing waits, before the refusal is passed on (default 4000 ms). */
  rateLimitPatienceMs?: number;
};

/**
 * The client's pace (RB-77): a token bucket shared by every bridge call of one CommandApi. The plugin refuses a request
 * over its limit before doing anything, so waiting here (or retrying after rate_limited) never repeats a change.
 */
export class RequestPacer {
  private tokens: number;
  private last = performance.now();
  constructor(
    readonly perSecond: number,
    readonly burst = perSecond * 2,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.tokens = burst;
    this.last = this.now();
  }
  /** Milliseconds to wait before the next request may go (0: now); takes the token. */
  take(): number {
    const now = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    this.tokens -= 1;
    return this.tokens >= 0 ? 0 : Math.ceil((-this.tokens / this.perSecond) * 1000);
  }
}

/** The waits between retries of a request refused rate_limited: 150 ms doubling to 1 s, until the patience runs out. */
export function rateLimitWaits(patienceMs: number): number[] {
  const waits: number[] = [];
  let total = 0;
  for (let wait = 150; total + wait <= patienceMs; wait = Math.min(1000, wait * 2)) {
    waits.push(wait);
    total += wait;
  }
  return waits;
}

const pipeTransport =
  (timeoutMs: number): TransportFactory =>
  async (session, options = {}) => {
    const client = new BridgeClient(session, timeoutMs);
    await client.connect({ busyWaitMs: options.busyWaitMs });
    return { call: (method, params, cid, timeoutMs) => client.call(method, params, cid, {}, timeoutMs), close: () => client.close() };
  };

/** The control pipe (RB-121): the same client, aimed at session.json's control_pipe. */
const controlPipeTransport =
  (timeoutMs: number): TransportFactory =>
  async (session, options = {}) => {
    if (!session.control_pipe) throw new PipeConnectError("this bridge has no control pipe", "not_found");
    return pipeTransport(timeoutMs)({ ...session, pipe: session.control_pipe }, options);
  };

type BridgeAnswer = { ok: true; result: unknown } | { ok: false; error: PlainError };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let cidCounter = 0;
const nextCid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++cidCounter}`;

/**
 * Emergency controls (0.8.1, RB-121): answered at once on a path of their own, never behind the serial queue, where a
 * game.wait could hold them for up to ten minutes while behaviours went on running in the game. 0.8.3 (session 10's L2c):
 * session.resume too, so taking the game back never waits behind another process's polling on the main pipe; its steps
 * (bridge.handover {on: false}, ui.message) are on the control route.
 */
export const EMERGENCY_COMMANDS: ReadonlySet<string> = new Set(["bridge.kill", "behave.stop", "player.stop", "test.record.stop", "session.handover", "session.resume"]);
/** Of those, the ones that supersede everything sent before them: queued commands are cancelled and running ones aborted. */
export const SUPERSEDING_COMMANDS: ReadonlySet<string> = new Set(["bridge.kill", "session.handover"]);

const SUPERSEDED_BY: Readonly<Record<string, string>> = { "bridge.kill": "bridge_kill", "session.handover": "session_handover" };

export class CommandApi {
  readonly eventCaptures = new EventCaptures(this);
  readonly runtimeDir: string;
  readonly captureRoot: string;
  readonly auditDir: string;
  private readonly transportFactory: TransportFactory;
  private readonly idleCloseMs: number;
  private recordingActive = false;
  private recordingLease?: ReturnType<typeof setTimeout>;
  private recordingHeartbeat?: ReturnType<typeof setTimeout>;
  private recordingEpoch?: AbortController;
  private recordingGeneration = 0;
  private recordingStarts = new AbortController();
  private connection: { transport: BridgeTransport; sid: string } | null = null;
  private connecting: Promise<void> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bridge calls waiting for an answer; the idle timer runs only when this is 0 (RB-62). */
  private inFlight = 0;
  private queue: Promise<unknown> = Promise.resolve();
  /**
   * Aborted by an emergency control that supersedes earlier work (RB-121); every ordinary command runs under the
   * controller current when it was sent, so one abort cancels whatever was queued or running before that control.
   */
  private epoch = new AbortController();
  /**
   * The emergency operations still running (RB-121): an ordinary command sent after one waits until it has finished, so a
   * session.resume sent right after a session.handover can't land first and leave the session handed over.
   */
  private barrier: Promise<void> = Promise.resolve();
  /** 0.8.3: the emergency controls still running, in the order they were sent (the kill doesn't wait for them). */
  private emergencies: Promise<void> = Promise.resolve();
  /**
   * 0.8.2 (the re-check's first finding): this API's control-pipe calls, one after another. The pipe takes one client at a
   * time, so a behave.stop sent right after a player.stop waits here (asynchronously) for the first to close its connection,
   * instead of both racing for the pipe. bridge.kill never waits: it tries the pipe once and falls back to the KILL file.
   */
  private controlChain: Promise<unknown> = Promise.resolve();
  private readonly controlFactory: TransportFactory | null;
  private readonly pacer: RequestPacer;
  private readonly rateLimitPatienceMs: number;
  /** Bridge requests refused rate_limited and retried since this API started (tests and logs). */
  rateLimitRetries = 0;

  constructor(private readonly options: CommandApiOptions = {}) {
    this.runtimeDir = options.runtimeDir ?? defaultRuntimeDir();
    this.captureRoot = resolve(options.captureRoot ?? DEFAULT_CAPTURE_ROOT);
    this.auditDir = resolve(options.auditDir ?? join(this.captureRoot, "..", "logs"));
    this.transportFactory = options.transport ?? pipeTransport(options.clientTimeoutMs ?? 8000);
    // With a fake main transport and no fake control one (tests), everything goes on the main one.
    this.controlFactory = options.controlTransport ?? (options.transport ? null : controlPipeTransport(options.clientTimeoutMs ?? 8000));
    this.idleCloseMs = options.idleCloseMs ?? 3000;
    this.pacer = new RequestPacer(Math.max(1, options.requestsPerSecond ?? 18));
    this.rateLimitPatienceMs = options.rateLimitPatienceMs ?? 4000;
  }

  /** The catalogue every frontend derives its tools or commands from. */
  commands(): readonly CommandDef[] {
    return CATALOGUE;
  }

  /** The bridge session (without the token), or null when the game bridge isn't running. */
  session(): Omit<BridgeSession, "token"> | null {
    const session = readSession(this.runtimeDir);
    if (!session) return null;
    const { token: _token, ...rest } = session;
    return rest;
  }

  keySender(): KeySender {
    return this.options.keySender ?? sendKeyToWindow;
  }

  /**
   * The window photo.open may send its key to: the game's main window (from session.json's pid). The
   * test-only capture override (--capture-hwnd) is honoured only in a process that can't send keys
   * (XFB_NO_INPUT=1, set by the test preload), so it can never aim the key at another window (RB-35);
   * the real sender also checks the process image is the game's.
   */
  keyTarget(): { hwnd: bigint; pid: number } | null {
    const override = this.options.captureTarget;
    if (override && "hwnd" in override && process.env.XFB_NO_INPUT === "1") {
      const info = describeWindow(override.hwnd);
      return info ? { hwnd: info.hwnd, pid: info.pid } : null;
    }
    const session = readSession(this.runtimeDir);
    const window = session ? mainWindowOf(session.pid) : null;
    return window && session ? { hwnd: window.hwnd, pid: session.pid } : null;
  }

  captureTarget(): CaptureTarget {
    if (this.options.captureTarget) return this.options.captureTarget;
    const session = readSession(this.runtimeDir);
    return session ? { pid: session.pid } : { processName: "Cyberpunk2077.exe" };
  }

  /**
   * Runs one command. Never throws: every failure comes back as a plain-language error. name is the catalogue's name or the
   * MCP tool's (session_handover); 0.8.3 (session 10's L2c): either way the command is recognised for what it is, so an
   * emergency control typed with underscores on the command line still goes on the control pipe at once (before, only
   * the dotted name did, and session_handover from a second process waited behind the first one's game_wait).
   */
  run(name: string, input: unknown = {}, options: RunOptions = {}): Promise<CommandOutcome> {
    name = findCommand(name)?.name ?? name;
    // Process-only state: disarm must overtake a queued capture or a long game wait.
    if (name === "capture.disarm" || name === "capture.armed") return this.runNow(name, input ?? {}, options);
    if (name === "test.record.stop") { this.holdRecordingConnection(false); this.eventCaptures.cancel("recorder_stopped"); }
    if (name === "test.record.start") options = { ...options, signal: options.signal ? AbortSignal.any([options.signal, this.recordingStarts.signal]) : this.recordingStarts.signal };
    // Emergency controls go now, beside whatever is running (RB-121); kill and handover first cancel everything sent
    // before them (queued commands never start; a running one sees its signal abort and stops at its next step).
    if (SUPERSEDING_COMMANDS.has(name)) this.eventCaptures.cancel(name);
    if (EMERGENCY_COMMANDS.has(name)) {
      if (SUPERSEDING_COMMANDS.has(name)) {
        this.epoch.abort(SUPERSEDED_BY[name]);
        this.epoch = new AbortController();
      }
      // Through the bridge's control pipe (beside whatever the main pipe serves), and a barrier for what comes after it.
      // 0.8.3: in the order they were sent: an emergency control other than the kill waits for the emergency controls sent
      // before it (short: each is a few control-pipe calls), so a session.resume sent right after a session.handover can't
      // interleave its steps with the handover's. The kill never waits.
      // 0.8.3 (the review): a handover and a resume each run whole under the handover lock, which other processes' XF tools
      // take too, so a resume from another process can't land between a handover's steps; a resume cancelled while it waits
      // sends nothing.
      const earlier = this.emergencies;
      const whole = name === "session.handover" || name === "session.resume";
      const operation =
        name === "bridge.kill"
          ? this.runNow(name, input ?? {}, options, true)
          : earlier.then(() => (whole ? this.runWhole(name, input ?? {}, options) : this.runNow(name, input ?? {}, options, true)));
      this.emergencies = operation.then(
        () => undefined,
        () => undefined,
      );
      const settled = operation.then(
        () => undefined,
        () => undefined,
      );
      const before = this.barrier;
      this.barrier = Promise.all([before, settled]).then(() => undefined);
      return operation;
    }
    // Everything else one at a time: the pipe carries one conversation, and ordering matters for scripts. A command waits
    // for the emergency operations sent before it (the barrier as it is now).
    const epoch = this.epoch.signal;
    const barrier = this.barrier;
    const signal = options.signal ? AbortSignal.any([options.signal, epoch]) : epoch;
    const next = this.queue.then(async (): Promise<CommandOutcome> => {
      await barrier;
      if (epoch.aborted) return this.superseded(name, options.cid, epoch);
      const outcome = await this.runNow(name, input ?? {}, { ...options, signal });
      // A command cut short by the emergency control says so, rather than a bare interruption.
      return !outcome.ok && epoch.aborted ? this.superseded(name, outcome.cid, epoch, outcome.error) : outcome;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** 0.8.3: a handover or resume under the handover lock (in this process and across processes), refused plainly when it can't run. */
  private async runWhole(name: string, input: unknown, options: RunOptions): Promise<CommandOutcome> {
    const cid = options.cid ?? nextCid(options.source ?? "api");
    const interrupted: CommandOutcome = { ok: false, command: name, cid, error: { code: "interrupted", message: "Stopped before it was sent to the game; nothing changed." } };
    if (options.signal?.aborted) return interrupted;
    try {
      return await withHandoverLock(
        this.runtimeDir,
        async () => (options.signal?.aborted ? interrupted : this.runNow(name, input, { ...options, cid }, true)),
        { signal: options.signal },
      );
    } catch (error) {
      const plain = (error as HandoverBusyError).plain ?? { code: "failed", message: (error as Error).message };
      return { ok: false, command: name, cid, error: plain };
    }
  }

  private superseded(name: string, cid: string | undefined, epoch: AbortSignal, cut?: PlainError): CommandOutcome {
    const by = String(epoch.reason ?? "an emergency control");
    const message = cut
      ? `${by} came while this was running, so it stopped at its next step (what it had already done stays done): ${cut.message}`
      : `${by} came first, so this command was cancelled before it started; nothing of it ran.`;
    // RB-121 review: what the command found on its way out (an undo, a restore that failed) stays with the answer.
    const error: PlainError = {
      ...(cut ?? {}),
      code: "superseded",
      message: `${message} Check the game's state, then send it again if it is still wanted.`,
      ...(cut ? { cause: cut.code, ...(cut.detail !== undefined ? { detail: cut.detail } : {}) } : {}),
    };
    return { ok: false, command: name, cid: cid ?? nextCid("api"), error };
  }

  private async runNow(name: string, input: unknown, options: RunOptions, control = false): Promise<CommandOutcome> {
    const cid = options.cid ?? nextCid(options.source ?? "api");
    if (options.signal?.aborted || (options.deadlineMs !== undefined && performance.now() >= options.deadlineMs))
      return { ok: false, command: name, cid, error: { code: "interrupted", message: "Action cancelled or expired before execution; nothing started." } };
    const command = findCommand(name);
    if (!command) {
      return { ok: false, command: name, cid, error: { code: "unknown_command", message: `There is no command called "${name}".` } };
    }
    const problems = validate(command.input, input);
    if (problems.length) {
      return { ok: false, command: name, cid, error: { code: "bad_input", message: problems.join(" ") } };
    }
    const params = { ...input as Record<string, unknown> };
    const when = params.when;
    if (when && !Object.keys(when).length) return { ok: false, command: name, cid, error: { code: "bad_input", message: "when must contain at least one condition" } };
    delete params.when;
    if (name === "capture.arm") {
      const capture = findCommand(`capture.${params.capture}`);
      const args = params.args ?? {};
      const errors = capture ? validate(capture.input, args) : ["Unknown capture command"];
      const match = params.match as Record<string, unknown> | undefined;
      if (match && (Object.keys(match).length > 8 || Object.values(match).some(value => value !== null && !["string", "number", "boolean"].includes(typeof value)))) errors.push("match requires at most eight scalar fields");
      if (errors.length) return { ok: false, command: name, cid, error: { code: "bad_input", message: errors.join(" ") } };
    }
    if (command.permission !== "read") this.audit({ event: "request", command: name, permission: command.permission, cid, input: { ...params, ...(when ? { when } : {}) }, undo: command.undo });
    try {
      let result: CommandResult;
      if (command.local) {
        // An emergency command's own bridge calls (session.handover's steps) go on the control pipe too.
        const base = control ? this.controlView() : this;
        const api = when ? this.whenView(base, when) : base;
        result = await command.local(params, { api, cid, captureRoot: resolve(options.captureRoot ?? this.captureRoot), signal: options.signal });
      } else {
        const bridgeParams = { ...(command.bridge!.params ? command.bridge!.params(params) : params), ...(when ? { when } : {}) };
        let response: BridgeAnswer;
        if (control) {
          // RB-121: the control pipe is read at once, beside a request the main pipe still serves.
          response = await this.callControl(command.bridge!.method, bridgeParams, cid, command.bridge!.timeoutMs?.(params));
        } else {
          response = await this.callBridge(command.bridge!.method, bridgeParams, cid, command.bridge!.timeoutMs?.(params), options.signal);
        }
        if (!response.ok && command.name === "bridge.kill" && response.error.code === "bridge_busy") response = this.killByFile();
        if (!response.ok) {
          const error = "error" in response ? response.error : plainBridgeError("failed");
          if (command.permission !== "read") this.audit({ event: "refused", command: name, cid, code: error.code });
          return { ok: false, command: name, cid, error };
        }
        result = { value: command.bridge!.result ? command.bridge!.result(response.result, params) : response.result };
      }
      if (command.permission !== "read") this.audit({ event: "done", command: name, cid, result: result.value });
      return {
        ok: true,
        command: name,
        cid,
        result: result.value,
        ...(result.images?.length ? { images: result.images } : {}),
        ...(command.undo ? { undo: command.undo } : {}),
      };
    } catch (error) {
      const plain = (error as { plain?: PlainError }).plain ?? {
        code: (error as { code?: string }).code ?? "failed",
        message: (error as Error).message || "Something went wrong.",
      };
      if (command.permission !== "read") this.audit({ event: "failed", command: name, cid, code: plain.code, ...(plain.detail ? { detail: plain.detail } : {}) });
      return { ok: false, command: name, cid, error: plain };
    }
  }

  /**
   * This API with its bridge calls sent on the control pipe (RB-121), for an emergency command's local handler
   * (session.handover's steps). Everything else is the API itself.
   */
  private whenView(base: CommandApi, when: unknown): CommandApi {
    return new Proxy(base, { get(target, prop) {
      if (prop === "keySender") return () => async () => { throw Object.assign(new Error("External keys cannot compare-and-act on a game frame"), { code: "precondition_unavailable" }); };
      if (prop === "callBridge") return (method: string, params: Record<string, unknown>, cid: string, timeoutMs?: number, signal?: AbortSignal) => {
        const write = CATALOGUE.some(c => (c.bridge?.method ?? c.name) === method && c.permission.startsWith("write-")) || method === "player.action";
        const knownRead = CATALOGUE.some(c => (c.bridge?.method ?? c.name) === method && ["read", "notify", "control"].includes(c.permission)) || method === "game.status";
        if (signal && !write && !knownRead) throw Object.assign(new Error(`No execution-frame guard contract for ${method}`), { code: "precondition_unavailable" });
        // Cleanup helpers omit the forward signal and must still be allowed to put things back.
        return target.callBridge(method, write && signal ? { ...params, when } : params, cid, timeoutMs, signal);
      };
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  }

  private controlView(): CommandApi {
    // 0.8.3 (the review): the step's AbortSignal goes along, so a cancelled resume sends nothing.
    const control = (method: string, params: Record<string, unknown>, cid: string, timeoutMs?: number, signal?: AbortSignal) =>
      this.callControl(method, params, cid, timeoutMs, signal);
    return new Proxy(this, {
      get(target, prop) {
        if (prop === "callBridge") return control;
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  /**
   * Sends one method on the bridge's control pipe (RB-121): bridge.kill, behave.stop, player.stop and a handover's steps,
   * read at once beside a request the main pipe is still serving (a five-second look). A connection per call, so it never
   * holds the control pipe. Without a control pipe (an older bridge) the call goes on the main pipe; the kill then uses the
   * KILL file while a request is still waiting there, as it does when the control pipe can't be reached.
   */
  async callControl(method: string, params: Record<string, unknown>, cid: string, timeoutMs?: number, signal?: AbortSignal): Promise<BridgeAnswer> {
    if (signal?.aborted) return { ok: false, error: { code: "interrupted", message: "Stopped before this step was sent to the game." } };
    const session = readSession(this.runtimeDir);
    if (!session) return { ok: false, error: NO_BRIDGE };
    const kill = method === "bridge.kill";
    if (!this.controlFactory || (!session.control_pipe && !this.options.controlTransport)) {
      if (kill && this.inFlight > 0) return this.killByFile("A request was still waiting for the game's answer");
      const answer = await this.callBridge(method, params, cid, timeoutMs, signal);
      return !answer.ok && kill && answer.error.code === "bridge_busy" ? this.killByFile() : answer;
    }
    if (kill) return this.controlOnce(session, method, params, cid, timeoutMs, true);
    const turn = this.controlChain.then(() => this.controlOnce(session, method, params, cid, timeoutMs, false, signal));
    this.controlChain = turn.catch(() => undefined);
    return turn;
  }

  /** One control-pipe call on its own connection (RB-121), closed as soon as it is answered. */
  private async controlOnce(session: BridgeSession, method: string, params: Record<string, unknown>, cid: string, timeoutMs: number | undefined, kill: boolean, signal?: AbortSignal): Promise<BridgeAnswer> {
    if (signal?.aborted) return { ok: false, error: { code: "interrupted", message: "Stopped before this step was sent to the game." } };
    let transport: BridgeTransport;
    try {
      // A kill tries once: while the control pipe is busy (another emergency control, another tool) the KILL file stops the
      // bridge within half a second, sooner than waiting for the pipe.
      transport = await this.controlFactory!(session, kill ? { busyWaitMs: 0 } : {});
    } catch (error) {
      if (kill) return this.killByFile(error instanceof PipeConnectError && error.code === "busy" ? "The bridge's control pipe was busy" : "The bridge's control pipe couldn't be reached");
      const kind = error instanceof PipeConnectError ? error.code : "failed";
      return { ok: false, error: connectError(kind, (error as Error).message) };
    }
    let response: BridgeResponse;
    try {
      const wait = this.pacer.take();
      if (wait > 0) await sleep(wait);
      // Checked again right before sending (the connection or the pace may have taken a moment).
      if (signal?.aborted) {
        response = { v: 1, id: 0, cid, ok: false, error: { code: "interrupted", message: "Stopped before this step was sent to the game." } };
      } else {
        response = await transport.call(method, params, cid, timeoutMs);
      }
    } catch (error) {
      response = { v: 1, id: 0, cid, ok: false, error: { code: "disconnected", message: (error as Error)?.message ?? String(error) } };
    } finally {
      transport.close();
    }
    // A kill's reply can be lost as the bridge drops its clients; the bridge is off either way.
    if (kill && !response.ok && response.error?.code === "disconnected") return this.killByFile("The control pipe closed before the kill's answer came");
    if (response.ok) return { ok: true, result: response.result };
    return { ok: false, error: plainBridgeError(response.error?.code, response.error?.message) };
  }

  /**
   * Sends one bridge method; reconnects when the game restarted (new session id). signal (RB-121): a step of a command that
   * an emergency control (or the session runner's Ctrl+C) has cancelled isn't sent; cleanup steps pass none.
   */
  async callBridge(method: string, params: Record<string, unknown>, cid: string, timeoutMs?: number, signal?: AbortSignal): Promise<BridgeAnswer> {
    const recordingGeneration = this.recordingGeneration;
    if (signal?.aborted) return { ok: false, error: { code: "interrupted", message: "Stopped before this step was sent to the game." } };
    const session = readSession(this.runtimeDir);
    if (!session) {
      this.disconnect();
      return { ok: false, error: NO_BRIDGE };
    }
    if (this.connection && this.connection.sid !== session.sid) this.disconnect();
    if (!this.connection) {
      // One connection attempt at a time: an emergency control (RB-121) may call while a queued command is connecting.
      this.connecting ??= this.transportFactory(session)
        .then((transport) => {
          this.connection = { transport, sid: session.sid };
        })
        .finally(() => {
          this.connecting = null;
        });
      try {
        await this.connecting;
      } catch (error) {
        const kind = error instanceof PipeConnectError ? error.code : "failed";
        return { ok: false, error: connectError(kind, (error as Error).message) };
      }
      if (!this.connection) return { ok: false, error: connectError("failed", "the connection closed while it was opening") };
    }
    // No idle close while any call is in flight (RB-62): a single call can take longer than the idle time
    // (game.save waits up to 20 s for the game), and closing the pipe under it would cut the answer off.
    // The timer restarts only when the last call in flight ends, however it ends (answered or thrown).
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const connection = this.connection;
    this.inFlight++;
    let response!: BridgeResponse;
    try {
      // Paced below the plugin's limit, and a rate_limited refusal (sent before the plugin does anything) is retried
      // with growing waits (RB-77): session 5's back-to-back frames were refused, and so was putting the camera back.
      const waits = rateLimitWaits(this.rateLimitPatienceMs);
      for (let attempt = 0; ; attempt++) {
        const wait = this.pacer.take();
        if (wait > 0) await sleep(wait);
        if (signal?.aborted) {
          response = { v: 1, id: 0, cid, ok: false, error: { code: "interrupted", message: "Stopped before this step was sent to the game." } };
          break;
        }
        try {
          response = await connection.transport.call(method, params, cid, timeoutMs);
        } catch (error) {
          response = { v: 1, id: 0, cid, ok: false, error: { code: "disconnected", message: (error as Error)?.message ?? String(error) } };
        }
        if (response.ok || response.error?.code !== "rate_limited" || attempt >= waits.length) break;
        this.rateLimitRetries++;
        await sleep(waits[attempt]!);
      }
    } finally {
      this.inFlight--;
    }
    if (!response.ok && (response.error?.code === "disconnected" || response.error?.code === "client_timeout") && this.connection === connection) this.disconnect();
    if (response.ok) {
      if (method === "test.record.start" && recordingGeneration === this.recordingGeneration && !signal?.aborted && this.connection === connection)
        this.holdRecordingConnection(true, Number(params.duration_s ?? 60));
      if (method === "test.record.stop" || method === "game.load" ||
          (method === "test.record.read" && (response.result as { active?: boolean })?.active === false)) this.holdRecordingConnection(false);
    }
    if (this.connection && this.inFlight === 0) this.touch();
    if (response.ok) return { ok: true, result: response.result };
    return { ok: false, error: plainBridgeError(response.error?.code, response.error?.message, method) };
  }

  /**
   * The kill switch when another client (a scripted session) holds the pipe: the plugin also
   * watches for a KILL file beside session.json and stops within about half a second.
   */
  private killByFile(why = "Another XF tool held the connection"): { ok: true; result: unknown } | { ok: false; error: PlainError } {
    const file = join(this.runtimeDir, "KILL");
    try {
      writeFileSync(file, `killed by an XF tool at ${new Date().toISOString()}
`);
    } catch (error) {
      return { ok: false, error: { code: "failed", message: `Couldn't switch the bridge off: the KILL file couldn't be written (${(error as Error).message}). Use the CET hotkey instead.` } };
    }
    return { ok: true, result: { killed: true, route: "kill_file", note: `${why}, so the bridge was switched off through its KILL file; it stops within about half a second.`, file } };
  }

  private touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.recordingActive) { this.idleTimer = null; return; }
    this.idleTimer = setTimeout(() => this.disconnect(), this.idleCloseMs);
    // Don't keep a CLI process alive just for the idle timer.
    (this.idleTimer as { unref?: () => void }).unref?.();
  }

  /**
   * 0.8.4: lets the main pipe go while nothing of this API is in flight on it, so a long local wait (game.wait,
   * session.wait) holds it only during each poll and another process's XF tools can call between polls.
   */
  release() {
    if (this.inFlight === 0 && !this.recordingActive) this.disconnect();
  }

  private holdRecordingConnection(active: boolean, durationS = 60) {
    if (!active) { ++this.recordingGeneration; this.recordingStarts.abort(); this.recordingStarts = new AbortController(); }
    if (this.recordingLease) clearTimeout(this.recordingLease);
    if (this.recordingHeartbeat) clearTimeout(this.recordingHeartbeat);
    this.recordingEpoch?.abort();
    this.recordingEpoch = undefined;
    this.recordingLease = undefined;
    this.recordingActive = active;
    if (active) {
      // Native ownership stops at disconnect. Keep the same connection across thinking/long waits,
      // bounded by the source duration even when the coordinator never reads again.
      this.recordingEpoch = new AbortController();
      this.recordingLease = setTimeout(() => { this.holdRecordingConnection(false); this.touch(); }, (Math.min(1800, durationS) + 1) * 1000);
      this.recordingLease.unref?.();
      this.keepRecordingAlive(this.recordingEpoch);
    }
  }

  private keepRecordingAlive(lease: AbortController) {
    this.recordingHeartbeat = setTimeout(async () => {
      if (!this.recordingActive || this.recordingEpoch !== lease) return;
      // The server is already serving traffic. Do not put a short-timeout ping behind a
      // native step that legitimately takes longer; local work has no request in flight.
      if (this.inFlight > 0) { this.keepRecordingAlive(lease); return; }
      // One bounded, paced transport call, independent of a local burst holding the outer queue.
      const answer = await this.callBridge("ping", {}, nextCid("recorder-owner"), 2000, lease.signal);
      if (this.recordingEpoch !== lease) return;
      if (!answer.ok) { this.holdRecordingConnection(false); this.eventCaptures.cancel("owner_connection_lost"); return; }
      if (this.recordingActive) this.keepRecordingAlive(lease);
    }, 2000);
    this.recordingHeartbeat.unref?.();
  }

  disconnect() {
    this.eventCaptures.cancel("owner_connection_lost");
    this.holdRecordingConnection(false);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.connection?.transport.close();
    this.connection = null;
  }

  close() {
    this.eventCaptures.cancel("tools_closed");
    this.disconnect();
  }

  /** Append-only audit trail of write and control commands, beside the plugin's own log. */
  audit(entry: Record<string, unknown>) {
    try {
      mkdirSync(this.auditDir, { recursive: true });
      const day = new Date().toISOString().slice(0, 10);
      appendFileSync(join(this.auditDir, `commands-${day}.jsonl`), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
    } catch {
      // The audit log is best effort; the plugin log is the authoritative record.
    }
  }
}

// The transport-agnostic command API: the single place where commands are validated, run and
// answered. Frontends (the MCP server, the CLI, the session runner, and later the desktop app or
// user scripts) only list the catalogue and call `run`; none of them talks to the pipe itself.
//
//   frontends  ->  CommandApi.run(name, input)  ->  bridge connection (bridge-lib.ts)  ->  game
//                                               ->  local handlers (capture)
//
// Every write command is recorded in an audit log with its reversal note before it is sent.

import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { BridgeClient, PipeConnectError, defaultRuntimeDir, readSession, type BridgeResponse, type BridgeSession } from "../bridge-lib.ts";
import { DEFAULT_CAPTURE_ROOT, type CaptureTarget } from "../capture/capture.ts";
import { CATALOGUE, findCommand, type CommandDef, type CommandResult } from "./catalogue.ts";
import { NO_BRIDGE, connectError, plainBridgeError, type PlainError } from "./errors.ts";
import { validate } from "./schema.ts";

export type CommandOutcome =
  | { ok: true; command: string; cid: string; result: unknown; images?: ImageRef[]; undo?: string }
  | { ok: false; command: string; cid: string; error: PlainError };

/** Per-call options: a correlation id, the calling frontend (for logs), where captures go, and a signal that ends a long local wait (game.wait). */
export type RunOptions = { cid?: string; source?: string; captureRoot?: string; signal?: AbortSignal };

export type ImageRef = { path: string; width: number; height: number; mimeType: "image/png"; role: "view" | "full" };

/** What the command API needs from a bridge connection; the pipe client or a test fake. */
export interface BridgeTransport {
  call(method: string, params: Record<string, unknown>, cid: string): Promise<BridgeResponse>;
  close(): void;
}
export type TransportFactory = (session: BridgeSession) => Promise<BridgeTransport>;

export type CommandApiOptions = {
  /** Runtime folder holding session.json; the default is the one the plugin uses. Tests pass their own. */
  runtimeDir?: string;
  /** Where captures and the audit log go (ignored by git). */
  captureRoot?: string;
  auditDir?: string;
  transport?: TransportFactory;
  /** Capture target override (tests); the default is the game process named by session.json. */
  captureTarget?: CaptureTarget;
  /** Close the pipe after this long without a command, so other XF tools can connect. */
  idleCloseMs?: number;
  clientTimeoutMs?: number;
};

const pipeTransport =
  (timeoutMs: number): TransportFactory =>
  async (session) => {
    const client = new BridgeClient(session, timeoutMs);
    await client.connect();
    return { call: (method, params, cid) => client.call(method, params, cid), close: () => client.close() };
  };

let cidCounter = 0;
const nextCid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++cidCounter}`;

export class CommandApi {
  readonly runtimeDir: string;
  readonly captureRoot: string;
  readonly auditDir: string;
  private readonly transportFactory: TransportFactory;
  private readonly idleCloseMs: number;
  private connection: { transport: BridgeTransport; sid: string } | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: CommandApiOptions = {}) {
    this.runtimeDir = options.runtimeDir ?? defaultRuntimeDir();
    this.captureRoot = resolve(options.captureRoot ?? DEFAULT_CAPTURE_ROOT);
    this.auditDir = resolve(options.auditDir ?? join(this.captureRoot, "..", "logs"));
    this.transportFactory = options.transport ?? pipeTransport(options.clientTimeoutMs ?? 8000);
    this.idleCloseMs = options.idleCloseMs ?? 3000;
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

  captureTarget(): CaptureTarget {
    if (this.options.captureTarget) return this.options.captureTarget;
    const session = readSession(this.runtimeDir);
    return session ? { pid: session.pid } : { processName: "Cyberpunk2077.exe" };
  }

  /** Runs one command. Never throws: every failure comes back as a plain-language error. */
  run(name: string, input: unknown = {}, options: RunOptions = {}): Promise<CommandOutcome> {
    // One command at a time: the pipe carries one conversation, and ordering matters for scripts.
    const next = this.queue.then(() => this.runNow(name, input ?? {}, options));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async runNow(name: string, input: unknown, options: RunOptions): Promise<CommandOutcome> {
    const cid = options.cid ?? nextCid(options.source ?? "api");
    const command = findCommand(name);
    if (!command) {
      return { ok: false, command: name, cid, error: { code: "unknown_command", message: `There is no command called "${name}".` } };
    }
    const problems = validate(command.input, input);
    if (problems.length) {
      return { ok: false, command: name, cid, error: { code: "bad_input", message: problems.join(" ") } };
    }
    const params = input as Record<string, unknown>;
    if (command.permission !== "read") this.audit({ event: "request", command: name, permission: command.permission, cid, input: params, undo: command.undo });
    try {
      let result: CommandResult;
      if (command.local) {
        result = await command.local(params, { api: this, cid, captureRoot: resolve(options.captureRoot ?? this.captureRoot), signal: options.signal });
      } else {
        const bridgeParams = command.bridge!.params ? command.bridge!.params(params) : params;
        const response = await this.callBridge(command.bridge!.method, bridgeParams, cid);
        if (!response.ok) {
          const error = "error" in response ? response.error : plainBridgeError("failed");
          if (command.permission !== "read") this.audit({ event: "refused", command: name, cid, code: error.code });
          return { ok: false, command: name, cid, error };
        }
        result = { value: response.result };
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
      if (command.permission !== "read") this.audit({ event: "failed", command: name, cid, code: plain.code });
      return { ok: false, command: name, cid, error: plain };
    }
  }

  /** Sends one bridge method; reconnects when the game restarted (new session id). */
  async callBridge(method: string, params: Record<string, unknown>, cid: string): Promise<{ ok: true; result: unknown } | { ok: false; error: PlainError }> {
    const session = readSession(this.runtimeDir);
    if (!session) {
      this.disconnect();
      return { ok: false, error: NO_BRIDGE };
    }
    if (this.connection && this.connection.sid !== session.sid) this.disconnect();
    if (!this.connection) {
      try {
        this.connection = { transport: await this.transportFactory(session), sid: session.sid };
      } catch (error) {
        const kind = error instanceof PipeConnectError ? error.code : "failed";
        return { ok: false, error: connectError(kind, (error as Error).message) };
      }
    }
    this.touch();
    const response = await this.connection.transport.call(method, params, cid);
    if (!response.ok && (response.error?.code === "disconnected" || response.error?.code === "client_timeout")) this.disconnect();
    this.touch();
    if (response.ok) return { ok: true, result: response.result };
    return { ok: false, error: plainBridgeError(response.error?.code, response.error?.message) };
  }

  private touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.disconnect(), this.idleCloseMs);
    // Don't keep a CLI process alive just for the idle timer.
    (this.idleTimer as { unref?: () => void }).unref?.();
  }

  disconnect() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.connection?.transport.close();
    this.connection = null;
  }

  close() {
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

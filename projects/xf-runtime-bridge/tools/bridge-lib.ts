// Client for the XF Runtime Bridge named pipe (protocol 1).
// Discovery: <runtime dir>/session.json, written by the plugin while the bridge listens.
// Default runtime dir: %LOCALAPPDATA%\XFStudio\runtime-bridge (override with XFB_RUNTIME_DIR).

import net from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type BridgeSession = {
  protocol: number;
  sid: string;
  pid: number;
  pipe: string;
  token: string;
  started_at: string;
  plugin_version: string;
  allow_writes: boolean;
};

export type BridgeError = { code: string; message: string };
export type BridgeResponse = {
  v: number;
  id: unknown;
  cid: string;
  ok: boolean;
  result?: unknown;
  error?: BridgeError;
};

export function defaultRuntimeDir(): string {
  if (process.env.XFB_RUNTIME_DIR) return process.env.XFB_RUNTIME_DIR;
  const local = process.env.LOCALAPPDATA;
  if (!local) throw new Error("LOCALAPPDATA is not set; pass --runtime-dir");
  return join(local, "XFStudio", "runtime-bridge");
}

export function readSession(runtimeDir = defaultRuntimeDir()): BridgeSession | null {
  const file = join(runtimeDir, "session.json");
  if (!existsSync(file)) return null;
  const session = JSON.parse(readFileSync(file, "utf8")) as BridgeSession;
  if (session.protocol !== 1) throw new Error(`unsupported bridge protocol ${session.protocol}`);
  return session;
}

/** Session details that are safe to print (never the token). */
export function describeSession(session: BridgeSession) {
  const { token: _token, ...rest } = session;
  return rest;
}

export class BridgeClient {
  private socket: net.Socket | null = null;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, (response: BridgeResponse) => void>();
  private closed = false;

  constructor(
    private readonly session: BridgeSession,
    private readonly timeoutMs = 5000,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(this.session.pipe);
      socket.setEncoding("utf8");
      socket.once("connect", () => {
        this.socket = socket;
        resolve();
      });
      socket.once("error", (error) => {
        if (!this.socket) reject(error);
      });
      socket.on("data", (chunk: string) => this.onData(chunk));
      socket.on("close", () => {
        this.closed = true;
        for (const [, settle] of this.pending) {
          settle({ v: 1, id: null, cid: "-", ok: false, error: { code: "disconnected", message: "pipe closed" } });
        }
        this.pending.clear();
      });
    });
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      const response = JSON.parse(line) as BridgeResponse;
      const id = typeof response.id === "number" ? response.id : -1;
      const settle = this.pending.get(id);
      if (settle) {
        this.pending.delete(id);
        settle(response);
      } else if (this.pending.size === 1 && response.id === null) {
        // Transport-level errors (e.g. too_large) carry id null.
        const [firstId, first] = [...this.pending][0];
        this.pending.delete(firstId);
        first(response);
      }
    }
  }

  /** Sends one request. `overrides` lets tests send a wrong token or raw extra fields. */
  call(method: string, params: Record<string, unknown> = {}, cid?: string, overrides: Record<string, unknown> = {}) {
    return this.sendObject({ v: 1, token: this.session.token, method, params, ...(cid ? { cid } : {}), ...overrides });
  }

  sendObject(request: Record<string, unknown>): Promise<BridgeResponse> {
    const id = this.nextId++;
    return this.sendRaw(JSON.stringify({ ...request, id }) + "\n", id);
  }

  sendRaw(text: string, id: number = this.nextId++): Promise<BridgeResponse> {
    if (!this.socket || this.closed) {
      return Promise.resolve({ v: 1, id, cid: "-", ok: false, error: { code: "disconnected", message: "not connected" } });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ v: 1, id, cid: "-", ok: false, error: { code: "client_timeout", message: `${this.timeoutMs} ms` } });
      }, this.timeoutMs);
      this.pending.set(id, (response) => {
        clearTimeout(timer);
        resolve(response);
      });
      this.socket!.write(text);
    });
  }

  close() {
    this.socket?.end();
    this.socket = null;
  }
}

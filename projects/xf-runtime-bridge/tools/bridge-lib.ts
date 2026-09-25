// Client for the XF Runtime Bridge named pipe (protocol 1).
// Discovery: <runtime dir>/session.json, written by the plugin while the bridge listens.
// Runtime dir: %LOCALAPPDATA%\XFStudio\runtime-bridge (the plugin has no override; only the
// self-test passes its own folder explicitly).
//
// Transport: the pipe is opened with kernel32 through bun:ffi rather than node:net, because the
// client must (1) open it at the Identification impersonation level (SECURITY_SQOS_PRESENT |
// SECURITY_IDENTIFICATION), so a process squatting the pipe name cannot impersonate us, and
// (2) check GetNamedPipeServerProcessId against session.json's pid before it sends the token.
// node:net can do neither. Reads are polled (PeekNamedPipe + ReadFile) from the event loop.

import { dlopen, FFIType } from "bun:ffi";
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

// --- kernel32 -------------------------------------------------------------------------------

const GENERIC_READ = 0x80000000;
const GENERIC_WRITE = 0x40000000;
const OPEN_EXISTING = 3;
const SECURITY_SQOS_PRESENT = 0x00100000;
const SECURITY_IDENTIFICATION = 0x00010000; // SecurityIdentification << 16
const INVALID_HANDLE_VALUE = 0xffffffffffffffffn;
const ERROR_FILE_NOT_FOUND = 2;
const ERROR_ACCESS_DENIED = 5;
const ERROR_PIPE_BUSY = 231;

let kernel32: ReturnType<typeof openKernel32> | null = null;
function openKernel32() {
  const { ptr, u32, u64, i32 } = FFIType;
  return dlopen("kernel32.dll", {
    CreateFileW: { args: [ptr, u32, u32, ptr, u32, u32, u64], returns: u64 },
    CloseHandle: { args: [u64], returns: i32 },
    GetLastError: { args: [], returns: u32 },
    WaitNamedPipeW: { args: [ptr, u32], returns: i32 },
    GetNamedPipeServerProcessId: { args: [u64, ptr], returns: i32 },
    WriteFile: { args: [u64, ptr, u32, ptr, ptr], returns: i32 },
    ReadFile: { args: [u64, ptr, u32, ptr, ptr], returns: i32 },
    PeekNamedPipe: { args: [u64, ptr, u32, ptr, ptr, ptr], returns: i32 },
  }).symbols;
}
function k32() {
  kernel32 ??= openKernel32();
  return kernel32;
}

export class PipeConnectError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "busy" | "access_denied" | "wrong_server" | "failed",
  ) {
    super(message);
  }
}

/** One synchronous pipe handle, opened at the Identification impersonation level. */
class PipeHandle {
  private open = true;
  private constructor(private readonly handle: bigint) {}

  static connect(pipe: string, expectedServerPid: number, timeoutMs: number): PipeHandle {
    const api = k32();
    const name = Buffer.from(`${pipe}\0`, "utf16le");
    const flags = SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION;
    let handle = api.CreateFileW(name, GENERIC_READ | GENERIC_WRITE, 0, null, OPEN_EXISTING, flags, 0n) as bigint;
    if (handle === INVALID_HANDLE_VALUE && api.GetLastError() === ERROR_PIPE_BUSY) {
      api.WaitNamedPipeW(name, timeoutMs);
      handle = api.CreateFileW(name, GENERIC_READ | GENERIC_WRITE, 0, null, OPEN_EXISTING, flags, 0n) as bigint;
    }
    if (handle === INVALID_HANDLE_VALUE) {
      const error = api.GetLastError();
      if (error === ERROR_FILE_NOT_FOUND) throw new PipeConnectError("no such pipe (the game closed or crashed?)", "not_found");
      if (error === ERROR_PIPE_BUSY) throw new PipeConnectError("pipe busy (another client is connected)", "busy");
      if (error === ERROR_ACCESS_DENIED) throw new PipeConnectError("access denied", "access_denied");
      throw new PipeConnectError(`CreateFile failed (error ${error})`, "failed");
    }

    // The token is only ever sent to the process session.json names.
    const serverPid = new Uint32Array(1);
    if (!api.GetNamedPipeServerProcessId(handle, serverPid) || serverPid[0] !== expectedServerPid) {
      api.CloseHandle(handle);
      throw new PipeConnectError(
        `refusing to talk: the pipe server is process ${serverPid[0]}, but session.json names ${expectedServerPid}`,
        "wrong_server",
      );
    }
    return new PipeHandle(handle);
  }

  /** Writes everything; false once the pipe is broken. Blocks only while the server's inbound buffer is full. */
  write(data: Uint8Array): boolean {
    if (!this.open) return false;
    const api = k32();
    const written = new Uint32Array(1);
    let offset = 0;
    while (offset < data.length) {
      const chunk = data.subarray(offset);
      if (!api.WriteFile(this.handle, chunk, chunk.length, written, null) || written[0] === 0) return false;
      offset += written[0];
    }
    return true;
  }

  /** Bytes available now (possibly empty), or null once the pipe is closed. Never blocks. */
  poll(): Uint8Array | null {
    if (!this.open) return null;
    const api = k32();
    const available = new Uint32Array(1);
    if (!api.PeekNamedPipe(this.handle, null, 0, null, available, null)) return null;
    if (available[0] === 0) return new Uint8Array(0);
    const buffer = new Uint8Array(Math.min(available[0], 64 * 1024));
    const read = new Uint32Array(1);
    if (!api.ReadFile(this.handle, buffer, buffer.length, read, null)) return null;
    return buffer.subarray(0, read[0]);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    k32().CloseHandle(this.handle);
  }
}

// --- protocol client ------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class BridgeClient {
  private pipe: PipeHandle | null = null;
  private buffer = "";
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();
  private nextId = 1;
  // Keyed by the id sent: normally our counter, or a test's scalar override.
  private pending = new Map<number | string, (response: BridgeResponse) => void>();
  private closed = false;

  constructor(
    private readonly session: BridgeSession,
    private readonly timeoutMs = 5000,
  ) {}

  /**
   * Opens the pipe, checks the server PID, then starts reading replies. `read: false` never
   * reads (for the self-test's non-reading client).
   */
  async connect(options: { read?: boolean } = {}): Promise<void> {
    this.pipe = PipeHandle.connect(this.session.pipe, this.session.pid, this.timeoutMs);
    if (options.read !== false) void this.pump();
  }

  private async pump() {
    while (!this.closed && this.pipe) {
      const chunk = this.pipe.poll();
      if (chunk === null) {
        this.onClosed();
        return;
      }
      if (chunk.length > 0) this.onData(this.decoder.decode(chunk, { stream: true }));
      else await sleep(this.pending.size > 0 ? 1 : 10);
    }
  }

  private onClosed() {
    this.closed = true;
    this.pipe?.close();
    for (const [, settle] of this.pending) {
      settle({ v: 1, id: null, cid: "-", ok: false, error: { code: "disconnected", message: "pipe closed" } });
    }
    this.pending.clear();
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      const response = JSON.parse(line) as BridgeResponse;
      const id = typeof response.id === "number" || typeof response.id === "string" ? response.id : -1;
      const settle = this.pending.get(id);
      if (settle) {
        this.pending.delete(id);
        settle(response);
      } else if (this.pending.size > 0 && response.id === null) {
        // Transport-level errors (too_large) and refusals of requests whose id was not echoable
        // carry id null; they answer the oldest outstanding request.
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
    const counter = this.nextId++;
    // A scalar id override is echoed and matched as is; any other override (array, object)
    // is answered with id null and matched to the oldest outstanding request.
    const override = request.id;
    const key = typeof override === "number" || typeof override === "string" ? override : counter;
    return this.sendRaw(JSON.stringify({ id: counter, ...request }) + "\n", key);
  }

  sendRaw(text: string, id: number | string = this.nextId++): Promise<BridgeResponse> {
    if (!this.pipe || this.closed) {
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
      if (!this.pipe!.write(this.encoder.encode(text))) this.onClosed();
    });
  }

  /** Writes without waiting for any reply (for the non-reading client in the self-test). */
  writeOnly(text: string): boolean {
    return this.pipe?.write(this.encoder.encode(text)) ?? false;
  }

  close() {
    this.onClosed();
    this.pipe = null;
  }
}

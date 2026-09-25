import { createHash } from "node:crypto";
import { closeSync, openSync, rmSync, writeSync } from "node:fs";

/**
 * Network adapter: download one pinned file to a private path, hashing as it streams, with
 * progress, cancellation and a stall limit. The file is kept only when its size and SHA-256
 * match the pin; every failure removes it. Failures are typed so the application service can
 * decide on retries and plain wording.
 */
export type DownloadFailure = "offline" | "network" | "http" | "integrity" | "disk" | "cancelled";
export class DownloadError extends Error {
  constructor(readonly code: DownloadFailure, message: string, readonly detail = "") { super(message); }
}
export type DownloadProgress = { receivedBytes: number; totalBytes: number };
export type DownloadOptions = {
  url: string;
  expectedBytes: number;
  expectedSha256: string;
  /** Private destination file; it must not exist yet. */
  destination: string;
  signal?: AbortSignal;
  /** Give up when no bytes arrive for this long. */
  stallMs?: number;
  onProgress?: (progress: DownloadProgress) => void;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
};

const UNREACHABLE = new Set(["ENOTFOUND", "EAI_AGAIN", "ConnectionRefused", "FailedToOpenSocket", "ECONNREFUSED", "ENETUNREACH",
  "EHOSTUNREACH", "ENETDOWN", "UnableToConnect"]);
const DISK = new Set(["ENOSPC", "EDQUOT", "EACCES", "EPERM", "EROFS", "EIO", "EBUSY"]);

/** Only HTTPS, except plain HTTP to this computer (test fixture servers). */
export function allowedDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost"));
  } catch { return false; }
}

export async function downloadVerified(options: DownloadOptions): Promise<void> {
  if (!allowedDownloadUrl(options.url)) throw new DownloadError("http", "The download address is not allowed.", options.url);
  if (options.signal?.aborted) throw new DownloadError("cancelled", "The download was cancelled.");
  const stall = new AbortController();
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const arm = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { stalled = true; stall.abort(); }, options.stallMs ?? 30_000); };
  const signal = options.signal ? AbortSignal.any([options.signal, stall.signal]) : stall.signal;
  let handle: number | null = null;
  const fail = (error: DownloadError): never => {
    if (handle !== null) { try { closeSync(handle); } catch { /* Already closed. */ } handle = null; }
    try { rmSync(options.destination, { force: true }); } catch { /* Best effort. */ }
    throw error;
  };
  const classify = (error: unknown): DownloadError => {
    if (error instanceof DownloadError) return error;
    if (options.signal?.aborted) return new DownloadError("cancelled", "The download was cancelled.");
    if (stalled) return new DownloadError("network", "The download stopped receiving data.");
    const code = String((error as { code?: unknown })?.code ?? "");
    if (DISK.has(code)) return new DownloadError("disk", "The download could not be saved.", `${code}: ${(error as Error).message}`);
    if (UNREACHABLE.has(code)) return new DownloadError("offline", "The download server could not be reached.", `${code}: ${(error as Error).message}`);
    return new DownloadError("network", "The download was interrupted.", `${code}: ${(error as Error)?.message ?? error}`);
  };
  arm();
  try {
    const response = await (options.fetch ?? fetch)(options.url, { redirect: "follow", signal, headers: { "User-Agent": "XF-Studio" } });
    if (!allowedDownloadUrl(response.url || options.url)) fail(new DownloadError("http", "The download was redirected to an address that is not allowed.", response.url));
    if (!response.ok || !response.body) {
      // Server-side and rate-limit errors are worth retrying; anything else is a wrong or withdrawn file.
      const transient = response.status >= 500 || response.status === 408 || response.status === 429;
      fail(new DownloadError(transient ? "network" : "http", `The download server answered ${response.status}.`, response.url));
    }
    const declared = Number(response.headers.get("Content-Length") ?? NaN);
    if (Number.isFinite(declared) && declared !== options.expectedBytes)
      fail(new DownloadError("integrity", "The file on the server is not the expected size.", `${declared} != ${options.expectedBytes}`));
    handle = openSync(options.destination, "wx", 0o600);
    const digest = createHash("sha256");
    let received = 0;
    const reader = response.body!.getReader();
    options.onProgress?.({ receivedBytes: 0, totalBytes: options.expectedBytes });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm();
      received += value.byteLength;
      if (received > options.expectedBytes) { void reader.cancel(); fail(new DownloadError("integrity", "The file on the server is larger than expected.")); }
      digest.update(value);
      writeSync(handle!, value);
      options.onProgress?.({ receivedBytes: received, totalBytes: options.expectedBytes });
    }
    closeSync(handle!); handle = null;
    if (received !== options.expectedBytes) fail(new DownloadError("network", "The download ended early.", `${received} of ${options.expectedBytes} bytes`));
    const sha256 = digest.digest("hex");
    if (sha256 !== options.expectedSha256) fail(new DownloadError("integrity", "The downloaded file does not match its published fingerprint.", sha256));
  } catch (error) {
    fail(classify(error));
  } finally { if (timer) clearTimeout(timer); }
}

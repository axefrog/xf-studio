import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * A small, bounded diagnostics log in the app's own data folder. The packaged
 * app has no console, so startup facts and failures land here for "Copy
 * diagnostics" and for clean-machine trials. It never records collection
 * content, file bytes, cookies or tokens.
 */
export const HOST_LOG_NAME = "desktop.log";
const LIMIT = 256 * 1024;

export type HostLog = { path: string; write(message: string): void };

export function createHostLog(dataRoot: string): HostLog {
  const path = resolve(dataRoot, HOST_LOG_NAME);
  return {
    path,
    write(message: string) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        try { if (statSync(path).size > LIMIT) renameSync(path, path + ".1"); } catch { /* No log yet. */ }
        appendFileSync(path, `${new Date().toISOString()} ${message.replace(/[\r\n]+/g, " ")}\n`);
      } catch { /* Diagnostics must never stop the app. */ }
    },
  };
}

/** Host adapter for install detection: environment, bounded file reads and `reg query`.
 * Read-only by construction: it runs only `reg.exe query` with fixed keys (no shell), never
 * follows links into files it reads, and never writes to the game, a launcher or MO2.
 */
import { execFile } from "node:child_process";
import { closeSync, lstatSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import { basename, join } from "node:path";
import type { DetectionHostPort } from "./install-detection";
import { describeMo2Instance, type Mo2InstanceDescription } from "./mo2-instance";

const registryKey = /^HK(?:LM|CU)\\[A-Za-z0-9_.\\ -]{1,200}$/;

export function createWindowsDetectionHost(env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform, timeoutMs = 5_000): DetectionHostPort {
  const regular = (path: string) => {
    try { const stat = lstatSync(path); return stat.isFile() && !stat.isSymbolicLink() ? stat : null; }
    catch { return null; }
  };
  const entries = (path: string, kind: "directory" | "file") => {
    try {
      return readdirSync(path, { withFileTypes: true })
        .filter(entry => kind === "directory" ? entry.isDirectory() : entry.isFile()).map(entry => entry.name);
    } catch { return null; }
  };
  return {
    platform,
    env: name => env[name],
    async registry(key, recursive = false) {
      if (platform !== "win32" || !registryKey.test(key)) return null;
      // reg.exe prints in the console code page; paths outside it may not round-trip.
      return new Promise(done => execFile("reg.exe", ["query", key, ...(recursive ? ["/s"] : [])],
        { encoding: "utf8", timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout) => done(error || typeof stdout !== "string" ? null : stdout)));
    },
    readText(path, maxBytes) {
      const stat = regular(path);
      if (!stat || stat.size > maxBytes) return null;
      let fd: number | undefined;
      try {
        fd = openSync(path, "r");
        const buffer = Buffer.alloc(stat.size);
        let read = 0;
        while (read < buffer.length) {
          const bytes = readSync(fd, buffer, read, buffer.length - read, read);
          if (bytes === 0) break;
          read += bytes;
        }
        return buffer.subarray(0, read).toString("utf8");
      } catch { return null; }
      finally { if (fd !== undefined) closeSync(fd); }
    },
    isFile: path => regular(path) !== null,
    directories: path => entries(path, "directory"),
    files: path => entries(path, "file"),
  };
}

/** Describe a configured MO2 instance folder from its ModOrganizer.ini, falling back to MO2's
 * default layout when the folder has none. Throws when the ini exists but is linked or oversized. */
export function readConfiguredMo2Instance(root: string): Mo2InstanceDescription {
  const ini = join(root, "ModOrganizer.ini");
  let stat;
  try { stat = lstatSync(ini); } catch { return describeMo2Instance(null, root, "configured", basename(root)); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024)
    throw Error("MO2 instance settings file is linked, not a file, or too large.");
  return describeMo2Instance(readFileSync(ini, "utf8"), root, "configured", basename(root));
}

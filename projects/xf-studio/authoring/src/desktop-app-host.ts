/**
 * The localhost host side of "Get the desktop app" (src/desktop-app.ts). Detection is read-only: it runs only `reg.exe query` on
 * Windows' per-user list of installed apps with fixed arguments (no shell), looks for the app's program under its pinned install
 * folder (`%LOCALAPPDATA%\dev.axefrog.xf-studio\<channel>\app\bin\launcher.exe`), lists this checkout's desktop `artifacts/`
 * folder for a setup program it built, and reads the site's release status. The one thing it starts, and only on the endpoint's
 * confirmed POST, is that setup program or the installed app; never a path the browser sent. It starts them through the Windows
 * shell (File Explorer), as a double-click would, so they run as ordinary programs even when this server itself runs inside a
 * Microsoft Store app (a development server started from such an app is one): a program started directly from inside one shares
 * its private storage, where an install is invisible to the Start menu and Electrobun's setup refuses to register it.
 */
import { spawn } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, win32 } from "node:path";
import { DESKTOP_APP_IDENTITY, DESKTOP_BUILD_COMMAND, DESKTOP_BUILD_FOLDER, DESKTOP_INSTALLER_FOLDER, type DesktopAppStatus } from "./desktop-app";

/** Windows' per-user list of installed apps, where Electrobun's setup registers its uninstaller. */
export const UNINSTALL_ROOT = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall";
const UNINSTALL_KEY = /^HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\[^"\r\n\\]{1,200}$/i;
/**
 * The setup programs a checkout builds: `build:installer` / `build:canary` (Electrobun's channel name wrapped by
 * `single-installer.ts`) and the release asset `release.ts stage` writes under `artifacts/release/`.
 */
const INSTALLER_NAME = /^(?:canary-win-x64-XFStudio-Setup-canary|XFStudio-\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?-win-x64-setup)\.exe$/;
/** Where the app looks for its channels, stable first. */
const CHANNELS = ["stable", "canary"] as const;

export type DesktopAppHostPort = {
  platform: string;
  env(name: string): string | undefined;
  /** `reg.exe query` with these arguments; its output, or null when it failed or found nothing. */
  regQuery(args: readonly string[]): Promise<string | null>;
  /** A regular file (not a link). */
  isFile(path: string): boolean;
  readText(path: string, maxBytes: number): string | null;
  /** Regular files in a folder (links left out), or null when it can't be read. */
  listFiles(folder: string): { name: string; bytes: number; mtimeMs: number }[] | null;
  /** Where a path really is on disk, or null when unknown. A Microsoft Store app's private storage shows up here. */
  physicalPath?(path: string): string | null;
};

export type DesktopAppDetection = {
  status: DesktopAppStatus;
  /** The installed app's program, for `open`. */
  launcher: string | null;
  /** The setup program `status.installer` names, for `install`. */
  installerPath: string | null;
};

/** `reg query` output: each key's values by name. */
export function parseRegQuery(text: string): Map<string, Map<string, string>> {
  const keys = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^HKEY_/.test(line)) { keys.set(line.trim(), current = new Map()); continue; }
    const value = /^ {4}(.+?) {4}(REG_\w+) {4}(.*)$/.exec(line) ?? /^ {4}(.+?) {4}(REG_\w+)$/.exec(line);
    if (value && current) current.set(value[1], value[3] ?? "");
  }
  return keys;
}

const lower = (path: string) => win32.resolve(path).toLowerCase();
const inside = (root: string, path: string) => lower(path).startsWith(lower(root) + "\\");
/** The program a registry value names: `"C:\x\uninstall.exe" --uninstall` or `C:\x\launcher.exe,0`. */
function programOf(value: string | undefined): string | null {
  if (!value) return null;
  const quoted = /^"([^"]+)"/.exec(value.trim());
  const path = quoted ? quoted[1] : value.trim().replace(/,-?\d+$/, "");
  return win32.isAbsolute(path) ? path : null;
}

async function installed(port: DesktopAppHostPort): Promise<{ info: NonNullable<DesktopAppStatus["installed"]>; launcher: string | null } | null> {
  const localAppData = port.env("LOCALAPPDATA");
  if (!localAppData || !win32.isAbsolute(localAppData)) return null;
  const identityRoot = win32.join(localAppData, DESKTOP_APP_IDENTITY);
  // An install that exists only in a Microsoft Store app's private storage (its setup ran inside that app) isn't installed for Windows.
  const physicalRoot = port.physicalPath?.(localAppData) ?? null;
  const appPrivate = (path: string) => {
    const physical = physicalRoot ? port.physicalPath?.(path) ?? null : null;
    return !!physical && lower(physical) !== lower(win32.join(physicalRoot!, win32.relative(localAppData, path)));
  };
  const channelOf = (path: string) => inside(identityRoot, path) ? win32.relative(identityRoot, win32.resolve(path)).split("\\")[0] || null : null;
  const launcherIn = (paths: (string | null)[]) => paths.find((path): path is string => !!path && inside(identityRoot, path) && port.isFile(path) && !appPrivate(path)) ?? null;
  const versionIn = (channel: string, fallback: string | null) => {
    try {
      const text = port.readText(win32.join(identityRoot, channel, "app", "Resources", "version.json"), 65_536);
      const version = text ? (JSON.parse(text) as { version?: unknown }).version : undefined;
      if (typeof version === "string" && version) return version;
    } catch { /* Unreadable: the registry's version, if any. */ }
    return fallback;
  };
  // The uninstall entry Electrobun's setup registers: found by the install folder its values name (the key's name isn't relied on).
  const found = await port.regQuery([UNINSTALL_ROOT, "/s", "/f", DESKTOP_APP_IDENTITY, "/d"]);
  for (const key of [...parseRegQuery(found ?? "").keys()].filter(key => UNINSTALL_KEY.test(key)).slice(0, 8)) {
    const values = parseRegQuery(await port.regQuery([key]) ?? "").get(key);
    if (!values) continue;
    const location = values.get("InstallLocation")?.trim() || null;
    const programs = [programOf(values.get("DisplayIcon")), programOf(values.get("UninstallString"))];
    const channel = [location, ...programs].map(path => path ? channelOf(path) : null).find(Boolean);
    if (!channel) continue;
    const base = win32.join(identityRoot, channel);
    const launcher = launcherIn([...(location && inside(identityRoot, location) ? [win32.join(location, "bin", "launcher.exe"), win32.join(location, "app", "bin", "launcher.exe")] : []),
      ...programs.filter(path => path && /\\launcher\.exe$/i.test(path)), win32.join(base, "app", "bin", "launcher.exe")]);
    return { info: { version: versionIn(channel, values.get("DisplayVersion")?.trim() || null), channel, registered: true, canOpen: !!launcher }, launcher };
  }
  // No entry: the install folder alone (an entry removed by hand, or a list Windows couldn't read).
  for (const channel of CHANNELS) {
    const launcher = launcherIn([win32.join(identityRoot, channel, "app", "bin", "launcher.exe")]);
    if (launcher) return { info: { version: versionIn(channel, null), channel, registered: false, canOpen: true }, launcher };
  }
  return null;
}

function newestInstaller(port: DesktopAppHostPort, desktopRoot: string) {
  let best: { path: string; name: string; bytes: number; mtimeMs: number } | null = null;
  for (const folder of [join(desktopRoot, "artifacts"), join(desktopRoot, "artifacts", "release")])
    for (const file of port.listFiles(folder) ?? [])
      if (INSTALLER_NAME.test(file.name) && file.bytes > 0 && (!best || file.mtimeMs > best.mtimeMs)) best = { ...file, path: join(folder, file.name) };
  return best;
}

function publishedRelease(port: DesktopAppHostPort, siteConfig: string): DesktopAppStatus["release"] {
  try {
    const config = JSON.parse(port.readText(siteConfig, 262_144) ?? "null") as { releaseStatus?: unknown; release?: { tag?: unknown; title?: unknown } | null } | null;
    const release = config?.release;
    if (!config || config.releaseStatus === "unreleased" || typeof release?.tag !== "string" || typeof release.title !== "string") return null;
    return { tag: release.tag, title: release.title };
  } catch { return null; }
}

/** What the view is told, and the two paths the host may start. */
export async function detectDesktopApp(port: DesktopAppHostPort, input: { desktopRoot: string; siteConfig: string }): Promise<DesktopAppDetection> {
  const windows = port.platform === "win32";
  const app = windows ? await installed(port).catch(() => null) : null;
  const installer = windows ? newestInstaller(port, input.desktopRoot) : null;
  const status: DesktopAppStatus = {
    schema: "xfs/desktop-app-status-1", platform: windows ? "windows" : "other", installed: app?.info ?? null,
    installer: installer ? { id: `${installer.name}:${installer.bytes}:${Math.floor(installer.mtimeMs)}`, name: installer.name, bytes: installer.bytes,
      builtAt: new Date(installer.mtimeMs).toISOString() } : null,
    build: { command: DESKTOP_BUILD_COMMAND, folder: DESKTOP_BUILD_FOLDER, output: DESKTOP_INSTALLER_FOLDER },
    release: publishedRelease(port, input.siteConfig), launch: { allowed: true },
  };
  return { status, launcher: app?.launcher ?? null, installerPath: installer?.path ?? null };
}

/** This computer: `reg.exe query` with fixed arguments (no shell), bounded file reads and folder listings. */
export function createDesktopAppHostPort(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform, timeoutMs = 5_000): DesktopAppHostPort {
  const regular = (path: string) => { try { const stat = lstatSync(path); return stat.isFile() && !stat.isSymbolicLink() ? stat : null; } catch { return null; } };
  return {
    platform,
    env: name => env[name],
    regQuery: args => platform !== "win32" ? Promise.resolve(null) : new Promise(done => {
      const child = spawn("reg.exe", ["query", ...args], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
      let out = "", size = 0;
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { size += chunk.length; if (size > 4 * 1024 * 1024) child.kill(); else out += chunk; });
      child.on("error", () => { clearTimeout(timer); done(null); });
      child.on("close", code => { clearTimeout(timer); done(code === 0 ? out : null); });
    }),
    isFile: path => regular(path) !== null,
    readText(path, maxBytes) {
      const stat = regular(path);
      if (!stat || stat.size > maxBytes) return null;
      try { return readFileSync(path, "utf8"); } catch { return null; }
    },
    physicalPath(path) {
      try { return realpathSync.native(path); } catch { return null; }
    },
    listFiles(folder) {
      try {
        return readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isFile()).flatMap(entry => {
          const stat = regular(join(folder, entry.name));
          return stat ? [{ name: entry.name, bytes: stat.size, mtimeMs: stat.mtimeMs }] : [];
        });
      } catch { return null; }
    },
  };
}

/**
 * How a program is started: on Windows through File Explorer (a new process of the Windows shell, outside any Microsoft Store app
 * this server may run in), except for a path with a comma, which Explorer would split; elsewhere directly.
 */
export function launchCommand(path: string, platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): { command: string; args: string[]; cwd: string } {
  if (platform === "win32" && !path.includes(","))
    return { command: win32.join(env.SystemRoot || env.SYSTEMROOT || "C:\\Windows", "explorer.exe"), args: [path], cwd: win32.dirname(path) };
  return { command: path, args: [], cwd: platform === "win32" ? win32.dirname(path) : dirname(path) };
}

/** Starts a program on its own, in its folder, and lets it outlive this server. False when it couldn't be started. */
export function launchDetached(path: string): boolean {
  try {
    const { command, args, cwd } = launchCommand(path);
    const child = spawn(command, args, { cwd, detached: true, stdio: "ignore", windowsHide: false });
    child.on("error", () => { /* Reported as started; the program's own window says otherwise. */ });
    child.unref();
    return true;
  } catch { return false; }
}

/** Refusals for a Studio that must not start anything: a test workspace (`?verify`) and a copy running with its own test data. */
export const DESKTOP_APP_READ_ONLY_VERIFICATION = "This is a test workspace, so XF Studio doesn't start setups or apps from it. Open XF Studio normally to do this.";
export const DESKTOP_APP_READ_ONLY_TEST_SERVER = "This copy of XF Studio runs with its own test settings, so it doesn't start setups or apps. Open XF Studio normally to do this.";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

/**
 * `/api/desktop-app` on localhost only (and, never starting anything, `/api/verification/desktop-app`): GET the status; POST
 * `{ action: "install", installer }` (the ID of the setup the person was shown and confirmed) or `{ action: "open" }` from the
 * loopback page. The host looks again before starting anything and refuses a setup that is no longer the one shown.
 */
export function createDesktopAppHandler(options: { detect: () => Promise<DesktopAppDetection>; launch?: (path: string) => boolean; readOnly?: string }) {
  const launch = options.launch ?? launchDetached;
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (url.hostname !== "127.0.0.1" || (origin && origin !== url.origin))
      return json({ code: "forbidden", error: "Use XF Studio itself for this." }, 403);
    if (request.method === "GET") {
      if ([...url.searchParams.keys()].length) return json({ code: "invalid_request", error: "That request wasn't understood." }, 400);
      try {
        const { status } = await options.detect();
        return json({ ...status, launch: options.readOnly ? { allowed: false, reason: options.readOnly } : { allowed: true } } satisfies DesktopAppStatus);
      } catch { return json({ code: "detection_failed", error: "XF Studio couldn't check for the desktop app. Try again in a moment." }, 500); }
    }
    if (request.method !== "POST") return json({ code: "method", error: "Method not allowed." }, 405);
    if (origin !== url.origin || request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
      return json({ code: "forbidden", error: "Use XF Studio itself for this." }, 403);
    let input: { action?: unknown; installer?: unknown };
    try {
      const body = await request.text();
      if (body.length > 1024) throw Error("too large");
      input = JSON.parse(body);
    } catch { return json({ code: "invalid_request", error: "That request wasn't understood." }, 400); }
    const keys = input && typeof input === "object" && !Array.isArray(input) ? Object.keys(input) : ["?"];
    const valid = input?.action === "open" ? keys.length === 1
      : input?.action === "install" && typeof input.installer === "string" && keys.length === 2 && keys.includes("installer");
    if (!valid) return json({ code: "invalid_request", error: "That request wasn't understood." }, 400);
    if (options.readOnly) return json({ code: "read_only", error: options.readOnly }, 403);
    let found: DesktopAppDetection;
    try { found = await options.detect(); }
    catch { return json({ code: "detection_failed", error: "XF Studio couldn't check for the desktop app. Try again in a moment." }, 500); }
    if (found.status.platform !== "windows") return json({ code: "unavailable", error: "The XF Studio desktop app is for Windows." }, 409);
    if (input.action === "open") {
      if (!found.launcher) return json({ code: "missing_target", error: "The desktop app isn't installed, or its program is missing. Install it again." }, 404);
      return launch(found.launcher) ? json({ message: "Opening XF Studio. It can take a few seconds to appear." })
        : json({ code: "launch_failed", error: "XF Studio couldn't open the desktop app. Open it from the Start menu instead." }, 500);
    }
    if (!found.status.installer || !found.installerPath) return json({ code: "missing_target", error: `There's no setup built here yet. Run ${DESKTOP_BUILD_COMMAND} in ${DESKTOP_BUILD_FOLDER} first.` }, 404);
    if (found.status.installer.id !== input.installer) return json({ code: "stale", error: "The setup changed since it was shown. Check it again before you run it." }, 409);
    return launch(found.installerPath)
      ? json({ message: "The XF Studio setup is open. Choose Install in its window; XF Studio opens by itself when it's done." })
      : json({ code: "launch_failed", error: `XF Studio couldn't start the setup. Open ${found.status.installer.name} from ${DESKTOP_INSTALLER_FOLDER} yourself.` }, 500);
  };
}

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { fileSha256 } from "./derived-cache";
import { detectDotNet, missingFramework, runtimeGuidance, runtimeRequirementFor, type DotNetInstall, type FrameworkReference } from "./dotnet-runtime";
import { DownloadError, downloadVerified, type DownloadOptions } from "./tool-download";
import { probeWolvenKitCli, wolvenKitIdentity } from "./wolvenkit-cli";
import { extractionIssue, MANAGED_INSTALL_SCHEMA, megabytes, parseInstallManifest, WOLVENKIT_RELEASE,
  type ManagedInstallManifest, type ManagedToolRelease } from "./wolvenkit-release";
import { extractZip, ZipError } from "./zip-extract";

/**
 * Application service for the WolvenKit CLI that XF Studio uses to read game files. It decides
 * which CLI is in effect (a path the user chose wins; otherwise XF Studio's own copy), whether the
 * .NET runtime it needs is present, and runs the consented download of the pinned official release:
 * download → verify → unpack → verify → publish, with progress, cancellation, retries and plain
 * outcomes. It never installs anything outside its own folder and never changes Windows.
 * Localhost and the desktop app share it; the adapters do the network, archive and process work.
 */
export const WOLVENKIT_SETUP_SCHEMA = "xfs/wolvenkit-setup-1" as const;
export type WolvenKitSetupPhase = "ready" | "available" | "downloading" | "installing" | "needs-runtime" | "failed" | "custom-missing" | "unsupported";
export type WolvenKitSetupState = {
  schema: typeof WOLVENKIT_SETUP_SCHEMA;
  phase: WolvenKitSetupPhase;
  /** One plain sentence or two for the person using the app. */
  message: string;
  code: string | null;
  /** Which CLI is in effect: one the user chose, or XF Studio's own copy. */
  source: "custom" | "managed" | null;
  /** Version of the CLI in effect, when known. */
  version: string | null;
  /** What the consented download is, for the consent dialog. */
  offer: { version: string; downloadBytes: number; installedBytes: number; downloadSize: string; installedSize: string;
    from: string; publisher: string; licence: { name: string; spdx: string; url: string }; releasePage: string };
  /** The .NET runtime the CLI in effect (or the offered release) needs, and whether this computer has it. */
  runtime: { name: string; installed: boolean; installerUrl: string; pageUrl: string } | null;
  progress: { receivedBytes: number; totalBytes: number } | null;
  step: string | null;
  /** A compatible WolvenKit CLI already on this computer (on PATH), which the user may choose instead. */
  detected: { path: string; version: string } | null;
  canInstall: boolean;
  canCancel: boolean;
};

export type WolvenKitSetupOptions = {
  /** Host-owned folder for downloaded tools (desktop: user data; localhost: the ignored data folder). */
  root: string;
  /** The CLI path the user chose (settings or a developer override), which always wins. */
  configured: () => string | null;
  release?: ManagedToolRelease;
  platform?: NodeJS.Platform;
  dotnet?: () => DotNetInstall;
  fetch?: DownloadOptions["fetch"];
  /** Waits before the second and third attempts of an interrupted download. */
  retryDelaysMs?: readonly number[];
  stallMs?: number;
  /** Finds a compatible CLI already on this computer; default: WolvenKit.CLI.exe on PATH, probed. */
  findExisting?: () => { path: string; version: string } | null;
  log?: (message: string) => void;
  now?: () => number;
};

const MESSAGES = {
  available: "XF Studio uses WolvenKit, the community's free modding tool, to read your Cyberpunk 2077 files for the 3D preview and your mod files. XF Studio can download it for you.",
  damaged: "XF Studio's copy of WolvenKit is incomplete or damaged. Download it again to repair it.",
  offline: "XF Studio couldn't reach GitHub to download WolvenKit. Check that this computer is online, then try again.",
  network: "The WolvenKit download was interrupted. Check your internet connection, then try again.",
  http: "WolvenKit's download isn't available from GitHub right now. Try again later.",
  integrity: "The downloaded WolvenKit didn't match its official release, so XF Studio deleted it. Downloads are sometimes damaged on the way; try again.",
  disk: "XF Studio couldn't save WolvenKit in its data folder. Check that the drive has about 150 MB free, then try again.",
  cancelled: "The WolvenKit download was cancelled. You can start it again at any time.",
  failed: "WolvenKit couldn't be set up. Try again; if it keeps happening, restart XF Studio.",
  unsupported: "XF Studio can download WolvenKit on Windows only. Enter your own WolvenKit CLI in the setup panel instead.",
  customMissing: "The WolvenKit CLI chosen in Build setup can't be found. Choose it again, or clear that field so XF Studio can download its own copy.",
} as const;
const runtimeMessage = (name: string) =>
  `WolvenKit needs Microsoft's free ${name}, which isn't on this computer yet. Install it from Microsoft, then choose Check again.`;

type Running = { controller: AbortController; promise: Promise<void>; phase: "downloading" | "installing";
  progress: WolvenKitSetupState["progress"]; step: string | null };
type Failure = { code: string; message: string };
const isFile = (path: string | null | undefined): path is string => { try { return !!path && statSync(path).isFile(); } catch { return false; } };
const stamp = (path: string) => { try { const s = statSync(path); return `${s.size}|${s.mtimeMs}`; } catch { return "missing"; } };

/** Default detection of an existing CLI: `WolvenKit.CLI.exe` in a PATH folder that passes the version probe. */
export function findWolvenKitOnPath(env: Record<string, string | undefined> = process.env): { path: string; version: string } | null {
  for (const folder of (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(folder, "WolvenKit.CLI.exe");
    if (!isFile(candidate)) continue;
    const probe = probeWolvenKitCli(candidate);
    if (probe.ok) return { path: candidate, version: probe.version };
  }
  return null;
}

export class WolvenKitSetupHost {
  private readonly release: ManagedToolRelease;
  private running: Running | null = null;
  private lastFailure: Failure | null = null;
  private dotnetMemo: { value: DotNetInstall; at: number } | null = null;
  private installMemo: { key: string; value: { state: "installed"; executable: string } | { state: "damaged" | "none" } } | null = null;
  private existingMemo: { value: { path: string; version: string } | null; at: number } | null = null;
  constructor(private readonly options: WolvenKitSetupOptions) { this.release = options.release ?? WOLVENKIT_RELEASE; }

  private now() { return (this.options.now ?? Date.now)(); }
  private get platform() { return this.options.platform ?? process.platform; }
  private get toolRoot() { return resolve(this.options.root, "wolvenkit"); }
  private get installDirectory() { return join(this.toolRoot, this.release.version); }
  private get manifestFile() { return join(this.toolRoot, `${this.release.version}.install.json`); }

  private dotnet(): DotNetInstall {
    const now = this.now();
    if (!this.dotnetMemo || now - this.dotnetMemo.at > 3_000)
      this.dotnetMemo = { value: (this.options.dotnet ?? (() => detectDotNet()))(), at: now };
    return this.dotnetMemo.value;
  }
  private existing() {
    const now = this.now();
    if (!this.existingMemo || now - this.existingMemo.at > 60_000)
      this.existingMemo = { value: (this.options.findExisting ?? (() => findWolvenKitOnPath()))(), at: now };
    return this.existingMemo.value;
  }
  /** Forget cached runtime and tool detection (the user installed something; check again). */
  recheck(): WolvenKitSetupState {
    this.dotnetMemo = null; this.existingMemo = null; this.installMemo = null;
    return this.snapshot();
  }

  /**
   * XF Studio's own copy when its manifest and files verify: every listed file present with its size,
   * and the launcher and entry DLL re-hashed against the pin. Memoised by the manifest and launcher stamps.
   */
  private installed(): { state: "installed"; executable: string } | { state: "damaged" | "none" } {
    const executable = join(this.installDirectory, this.release.executable);
    const key = `${stamp(this.manifestFile)}|${stamp(executable)}|${stamp(join(this.installDirectory, this.release.entryDll))}`;
    if (this.installMemo?.key === key) return this.installMemo.value;
    let value: { state: "installed"; executable: string } | { state: "damaged" | "none" };
    if (!existsSync(this.manifestFile)) value = { state: "none" };
    else {
      let manifest: ManagedInstallManifest | null = null;
      try { manifest = parseInstallManifest(JSON.parse(readFileSync(this.manifestFile, "utf8")), this.release); } catch { /* Damaged. */ }
      const intact = !!manifest && manifest.files.every(file => {
        try { return statSync(join(this.installDirectory, ...file.name.split("/"))).size === file.bytes; } catch { return false; }
      }) && fileSha256(executable) === this.release.executableSha256 &&
        fileSha256(join(this.installDirectory, this.release.entryDll)) === this.release.entryDllSha256;
      value = intact ? { state: "installed", executable } : { state: "damaged" };
    }
    this.installMemo = { key, value };
    return value;
  }

  private runtimeFor(executable: string | null): { reference: FrameworkReference; installed: boolean } | null {
    if (this.platform !== "win32") return null;
    const requirement = executable ? runtimeRequirementFor(executable) : { frameworks: [this.release.runtime], rollForward: "Minor" as const };
    if (!requirement) return null;
    const missing = missingFramework(requirement, this.dotnet());
    return { reference: missing ?? requirement.frameworks[0]!, installed: !missing };
  }

  private offer(): WolvenKitSetupState["offer"] {
    const release = this.release;
    return { version: release.version, downloadBytes: release.archiveBytes, installedBytes: release.installedBytes,
      downloadSize: megabytes(release.archiveBytes), installedSize: megabytes(release.installedBytes),
      from: "WolvenKit's official release on GitHub", publisher: release.publisher,
      licence: { ...release.licence }, releasePage: release.releasePage };
  }

  snapshot(): WolvenKitSetupState {
    const base = { schema: WOLVENKIT_SETUP_SCHEMA, offer: this.offer(), detected: null, progress: null, step: null } as const;
    const runtimeView = (runtime: ReturnType<WolvenKitSetupHost["runtimeFor"]>) =>
      runtime ? { name: runtimeGuidance(runtime.reference).name, installed: runtime.installed,
        installerUrl: runtimeGuidance(runtime.reference).installerUrl, pageUrl: runtimeGuidance(runtime.reference).pageUrl } : null;
    if (this.running) {
      const runtime = this.runtimeFor(null);
      return { ...base, phase: this.running.phase, code: null, source: null, version: this.release.version,
        message: this.running.phase === "downloading" ? `Downloading WolvenKit ${this.release.version}…` : `Setting up WolvenKit ${this.release.version}…`,
        runtime: runtimeView(runtime), progress: this.running.progress, step: this.running.step, canInstall: false, canCancel: true };
    }
    const custom = this.options.configured();
    if (custom) {
      if (!isFile(custom)) return { ...base, phase: "custom-missing", code: "wolvenkit_custom_missing", message: MESSAGES.customMissing,
        source: "custom", version: null, runtime: null, canInstall: false, canCancel: false };
      const runtime = this.runtimeFor(custom);
      const version = wolvenKitIdentity(custom)?.version ?? null;
      if (runtime && !runtime.installed) return { ...base, phase: "needs-runtime", code: "wolvenkit_runtime_missing",
        message: runtimeMessage(runtimeGuidance(runtime.reference).name), source: "custom", version, runtime: runtimeView(runtime), canInstall: false, canCancel: false };
      return { ...base, phase: "ready", code: null, message: version ? `Your own WolvenKit ${version} is ready.` : "Your own WolvenKit is ready.",
        source: "custom", version, runtime: runtimeView(runtime), canInstall: false, canCancel: false };
    }
    const install = this.installed();
    if (install.state === "installed") {
      const runtime = this.runtimeFor(install.executable);
      if (runtime && !runtime.installed) return { ...base, phase: "needs-runtime", code: "wolvenkit_runtime_missing",
        message: runtimeMessage(runtimeGuidance(runtime.reference).name), source: "managed", version: this.release.version,
        runtime: runtimeView(runtime), canInstall: false, canCancel: false };
      return { ...base, phase: "ready", code: null, message: `WolvenKit ${this.release.version} is ready.`, source: "managed",
        version: this.release.version, runtime: runtimeView(runtime), canInstall: false, canCancel: false };
    }
    if (this.platform !== this.release.platform) return { ...base, phase: "unsupported", code: "wolvenkit_platform", message: MESSAGES.unsupported,
      source: null, version: null, runtime: null, canInstall: false, canCancel: false };
    const runtime = runtimeView(this.runtimeFor(null));
    if (this.lastFailure) return { ...base, phase: "failed", code: this.lastFailure.code, message: this.lastFailure.message,
      source: null, version: null, runtime, detected: this.existing(), canInstall: true, canCancel: false };
    return { ...base, phase: "available", code: install.state === "damaged" ? "wolvenkit_damaged" : null,
      message: install.state === "damaged" ? MESSAGES.damaged : MESSAGES.available,
      source: null, version: null, runtime, detected: this.existing(), canInstall: true, canCancel: false };
  }

  /** The CLI to use for work right now (the user's or XF Studio's), only when it is ready to run; else null. */
  usable(): string | null {
    const state = this.snapshot();
    if (state.phase !== "ready") return null;
    return state.source === "custom" ? this.options.configured() : join(this.installDirectory, this.release.executable);
  }
  /** XF Studio's own verified copy, whether or not its runtime is present (Build readiness explains a missing runtime). */
  managedExecutable(): string | null {
    if (this.running) return null;
    const install = this.installed();
    return install.state === "installed" ? install.executable : null;
  }

  /**
   * Start the consented download of exactly the release the user was shown. Refused (unchanged
   * snapshot) for another version or when nothing can be installed.
   */
  install(version: string): WolvenKitSetupState {
    const state = this.snapshot();
    if (!state.canInstall || version !== this.release.version) return state;
    const controller = new AbortController();
    const running: Running = { controller, phase: "downloading", progress: { receivedBytes: 0, totalBytes: this.release.archiveBytes },
      step: `0 of ${megabytes(this.release.archiveBytes)}`, promise: Promise.resolve() };
    this.lastFailure = null;
    this.running = running;
    running.promise = this.run(running).then(
      () => { this.options.log?.(`WolvenKit ${this.release.version} downloaded, verified and set up.`); },
      (failure: Failure & { detail?: string }) => {
        this.lastFailure = { code: failure.code, message: failure.message };
        this.options.log?.(`WolvenKit setup stopped: ${failure.code}. ${failure.detail ?? ""}`.trim());
      }).finally(() => { this.running = null; this.installMemo = null; });
    return this.snapshot();
  }

  cancel(): WolvenKitSetupState { this.running?.controller.abort(); return this.snapshot(); }
  /** Wait for a running download (tests and shutdown). */
  async settled(): Promise<void> { await this.running?.promise; }

  private async run(running: Running): Promise<void> {
    const release = this.release, signal = running.controller.signal;
    const downloads = join(this.options.root, "downloads");
    const cancelled = () => { if (signal.aborted) throw { code: "wolvenkit_cancelled", message: MESSAGES.cancelled }; };
    let archive: string | null = null, staging: string | null = null;
    try {
      try {
        mkdirSync(downloads, { recursive: true }); mkdirSync(this.toolRoot, { recursive: true });
        // Leftovers of an interrupted attempt are private and safe to remove.
        for (const name of readdirSync(downloads)) if (name.endsWith(".partial")) rmSync(join(downloads, name), { force: true });
        for (const name of readdirSync(this.toolRoot)) if (name.startsWith(".staging-") || name.startsWith(".old-"))
          rmSync(join(this.toolRoot, name), { recursive: true, force: true });
      } catch (error) { throw { code: "wolvenkit_disk", message: MESSAGES.disk, detail: (error as Error).message }; }
      const delays = this.options.retryDelaysMs ?? [1_000, 3_000];
      for (let attempt = 0; ; attempt++) {
        archive = join(downloads, `${release.asset}.${randomUUID()}.partial`);
        try {
          await downloadVerified({ url: release.url, expectedBytes: release.archiveBytes, expectedSha256: release.archiveSha256,
            destination: archive, signal, stallMs: this.options.stallMs, fetch: this.options.fetch,
            onProgress: progress => { running.progress = progress; running.step = `${megabytes(progress.receivedBytes)} of ${megabytes(progress.totalBytes)}`; } });
          break;
        } catch (error) {
          const failure = error instanceof DownloadError ? error : new DownloadError("network", (error as Error).message);
          const retry = (failure.code === "network" || failure.code === "offline") && attempt < delays.length && !signal.aborted;
          this.options.log?.(`WolvenKit download attempt ${attempt + 1} failed: ${failure.code} ${failure.detail}`.trim());
          if (!retry) throw { code: `wolvenkit_${failure.code}`, message: MESSAGES[failure.code], detail: failure.detail };
          running.step = "Retrying the download…";
          await new Promise<void>(done => { const timer = setTimeout(done, delays[attempt]); signal.addEventListener("abort", () => { clearTimeout(timer); done(); }, { once: true }); });
          cancelled();
        }
      }
      cancelled();
      running.phase = "installing"; running.progress = null; running.step = "Unpacking WolvenKit";
      staging = join(this.toolRoot, `.staging-${randomUUID()}`);
      let entries;
      try { entries = extractZip(readFileSync(archive), staging, { maxEntries: 2_000, maxTotalBytes: 512_000_000 }); }
      catch (error) {
        if (error instanceof ZipError) throw { code: "wolvenkit_integrity", message: MESSAGES.integrity, detail: error.message };
        throw { code: "wolvenkit_disk", message: MESSAGES.disk, detail: (error as Error).message };
      }
      running.step = "Checking WolvenKit's files";
      const issue = extractionIssue(entries, release);
      if (issue) throw { code: "wolvenkit_integrity", message: MESSAGES.integrity, detail: issue };
      cancelled();
      try {
        // Publish: move the verified folder into place, then write the manifest last.
        rmSync(this.manifestFile, { force: true });
        if (existsSync(this.installDirectory)) renameSync(this.installDirectory, join(this.toolRoot, `.old-${randomUUID()}`));
        renameSync(staging, this.installDirectory); staging = null;
        const manifest: ManagedInstallManifest = { schema: MANAGED_INSTALL_SCHEMA, tool: release.id, version: release.version,
          archiveSha256: release.archiveSha256, source: release.url, installedAt: new Date(this.now()).toISOString(),
          executable: release.executable, files: entries };
        const temporary = `${this.manifestFile}.${randomUUID()}.tmp`;
        writeFileSync(temporary, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
        renameSync(temporary, this.manifestFile);
        for (const name of readdirSync(this.toolRoot)) if (name.startsWith(".old-")) rmSync(join(this.toolRoot, name), { recursive: true, force: true });
      } catch (error) { throw { code: "wolvenkit_disk", message: MESSAGES.disk, detail: (error as Error).message }; }
    } catch (error) {
      if (signal.aborted) throw { code: "wolvenkit_cancelled", message: MESSAGES.cancelled };
      if (error && typeof error === "object" && "code" in error && "message" in error && String((error as Failure).code).startsWith("wolvenkit_")) throw error;
      throw { code: "wolvenkit_failed", message: MESSAGES.failed, detail: (error as Error)?.message ?? String(error) };
    } finally {
      if (archive) rmSync(archive, { force: true });
      if (staging) rmSync(staging, { recursive: true, force: true });
    }
  }
}

/** Build readiness for a WolvenKit state: null when a CLI is ready, else one plain issue. */
export function wolvenKitReadinessIssue(state: WolvenKitSetupState): { code: string; reason: string } | null {
  switch (state.phase) {
    case "ready": return null;
    case "downloading": case "installing": return { code: "wolvenkit_installing", reason: "WolvenKit is being set up. Build is ready once it finishes." };
    case "needs-runtime": return { code: "wolvenkit_runtime_missing", reason: state.message };
    case "custom-missing": return { code: "wolvenkit_missing", reason: state.message };
    case "unsupported": return { code: "wolvenkit_unset", reason: state.message };
    default: return { code: "wolvenkit_unset", reason: "WolvenKit isn't set up yet. XF Studio can download it for you from the 3D preview card, or you can enter your own WolvenKit CLI here." };
  }
}

import { resolve, sep } from "node:path";
import { mkdirSync } from "node:fs";
import { LookLibrary, libraryRequest } from "./src/library-store";
import { CollectionLibrary, collectionRequest } from "./src/collection-store";
// A composition root: the part registry is built once and injected (CORE-29).
import { STUDIO_PARTS } from "./src/compose/studio-registry";
import { createPackageHandler, localCandidateStore, localEyePlate, localPackageAdapter, localPackageTools, localPlateCache, localToolsRoot, packageRequestSettings } from "./src/package-server";
import { createModInstallHandler, explorerReveal, ModInstallHost, READ_ONLY_TEST_SERVER, READ_ONLY_VERIFICATION, systemAnsiCodePage, windowsRunningApps } from "./src/mod-install-host";
import { localHostState, verificationInstallReceipts, verificationSettingsDirectory } from "./src/host-state";
import { STUDIO_EXPORTERS } from "./src/compose/exporters";
import { EYE_PLATE_PREREQUISITE } from "./src/features/eye-makeup";
import { WolvenKitSetupHost, wolvenKitReadinessIssue } from "./src/wolvenkit-setup-host";
import { createWolvenKitSetupHandler } from "./src/wolvenkit-setup-server";
import { eyePlateReadiness } from "./src/eye-plate-cache";
import { EYE_PLATE_RECIPE } from "./src/eye-plate-recipe";
import { createLocalSettingsHandler } from "./src/local-settings-server";
import { createInstallDetectionHandler, hostFrameworkCheck, profileFrameworkMods } from "./src/install-detection-server";
import { packageToolPaths } from "./src/local-settings-readiness";
import { LocalSettingsStore } from "./src/local-settings-store";
import type { LocalSettings } from "./src/local-settings";
import { buildBrowser } from "./browser-build";
import { PreviewCoreHost } from "./src/preview-core-host";
import { createPreviewCoreHandler } from "./src/preview-core-server";
import { PREVIEW_CORE_FILES } from "./src/preview-core-recipe";
import { CharacterDetailHost } from "./src/character-detail-host";
import { CHARACTER_ASSET_PREFIX, CHARACTER_DETAIL_ENDPOINT, createCharacterDetailHandler, serveCharacterAsset } from "./src/character-detail-server";
import { CREATOR_ENDPOINT, createCreatorHandler } from "./src/cc-catalogue-server";
import { createGradingLutHandler, GRADING_LUT_ASSET_PREFIX, GRADING_LUT_ENDPOINT, GradingLutHost, serveGradingLut } from "./src/grading-lut-host";
import { consoleEcho, hostDiagnosticsAt, hostFailure, logUnhandledRejections, setProcessDiagnostics } from "./src/diagnostics/host-log";
import { createDiagnosticsHandler, DIAGNOSTICS_PREFIX, withRequestDiagnostics } from "./src/diagnostics/host-endpoint";
// Settings and install receipts follow an isolated data folder (XFAS_DATA_DIR, XFS_SETTINGS_DIR); an isolated server never reads or
// writes the person's real settings and doesn't add mods (src/host-state.ts, INSTALL-01).
const state = localHostState(resolve(import.meta.dir, "data"));
const dataRoot = state.dataRoot;
mkdirSync(dataRoot, { recursive: true });
// One structured log and rolling detail window in data/diagnostics/ (docs/diagnostics.md); routine events still print here.
const diagnostics = hostDiagnosticsAt(dataRoot, { echo: consoleEcho });
setProcessDiagnostics(diagnostics);
// A background failure nobody caught is logged; it never ends the dev server (PREV-101).
logUnhandledRejections();
const library = new LookLibrary(resolve(dataRoot, "library.sqlite"));
const verificationLibrary = new LookLibrary(resolve(dataRoot, "verification.sqlite"));
const collections = new CollectionLibrary(resolve(dataRoot, "library.sqlite"), STUDIO_PARTS);
const verificationCollections = new CollectionLibrary(resolve(dataRoot, "verification.sqlite"), STUDIO_PARTS);
const localSettings = new LocalSettingsStore(state.settingsDirectory);
// A verification workspace (?verify) edits its own copy of the settings, starting from these (UI-98).
const verificationSettings = new LocalSettingsStore(verificationSettingsDirectory(dataRoot), { seed: () => localSettings.load().settings });
// WolvenKit: XFS_PACKAGE_WOLVENKIT, then Local setup, then XF Studio's own copy (downloaded only with consent).
const wolvenKit = new WolvenKitSetupHost({ root: localToolsRoot(),
  configured: () => process.env.XFS_PACKAGE_WOLVENKIT || localSettings.load().settings.wolvenKitCli, log: diagnostics.log.logger("wolvenkit") });
const settingsFeatures = (settings: LocalSettings) => ({ updater: false, installer: true,
  wolvenKit: wolvenKitReadinessIssue(wolvenKit.snapshot()),
  eyePlate: eyePlateReadiness(localPlateCache(), settings.gameRoot, EYE_PLATE_RECIPE), frameworks: hostFrameworkCheck(settings) });
const settingsRequest = createLocalSettingsHandler(localSettings, process.env, settingsFeatures, () => wolvenKit.managedExecutable());
const verificationSettingsRequest = createLocalSettingsHandler(verificationSettings, process.env, settingsFeatures, () => wolvenKit.managedExecutable());
const wolvenKitRequest = createWolvenKitSetupHandler(wolvenKit);
const detectionRequest = createInstallDetectionHandler(undefined, { settings: () => {
  const settings = localSettings.load().settings;
  return { ...settings, gameRoot: packageToolPaths(settings).gamepath };
} });
// Mod export: the shared package host service with localhost's adapter; each exporting feature's host prerequisites
// are bound here by ID (eye makeup: the built-in eye plate). Settings are read for every request.
// Unreadable settings: Check plans with the defaults and Build answers a plain JSON refusal, as on desktop (PIPE-94).
const packageRequest = createPackageHandler(action => localPackageAdapter({ exporters: STUDIO_EXPORTERS,
  tools: localPackageTools(packageRequestSettings(() => localSettings.load().settings, action), process.env, wolvenKit.managedExecutable()),
  prerequisites: tools => ({ [EYE_PLATE_PREREQUISITE]: localEyePlate(tools) }) }));
// "Add to my mod manager" (UI-82): a verified build from dist/ into the MO2 profile or game folder Local setup names, only after
// the person accepted its plan. Receipts and the previous mod list stay in the private data folder.
// Receipts are per user on this computer (shared with the desktop app); an isolated server keeps its own and adds nothing.
const installHost = (store: LocalSettingsStore, receiptsRoot: string, readOnly: string | undefined, legacy: string[] = []) =>
  () => new ModInstallHost({ candidateStore: localCandidateStore(), receiptsRoot, legacyReceiptsRoots: legacy, readOnly,
    settings: () => { const settings = store.load().settings; return { ...settings, gameRoot: packageToolPaths(settings).gamepath }; },
    running: () => windowsRunningApps(), ansiCodePage: systemAnsiCodePage, frameworkMods: settings => profileFrameworkMods(settings), reveal: explorerReveal });
const installLog = (code: string, message: string, error: unknown) => { hostFailure("install", code, message, error); };
const modInstallRequest = createModInstallHandler(installHost(localSettings, state.installReceipts, state.installs ? undefined : READ_ONLY_TEST_SERVER,
  state.legacyInstallReceipts), installLog);
// A verification workspace plans against its own settings and never adds anything (INSTALL-01).
const verificationModInstallRequest = createModInstallHandler(installHost(verificationSettings, verificationInstallReceipts(dataRoot),
  READ_ONLY_VERIFICATION), installLog);
// The 3D preview core (head, plate, eyes, maps and their record) is derived from the configured game and
// served only from this cache; `XFS_PREVIEW_CORE_CACHE` relocates it.
const previewCacheRoot = resolve(process.env.XFS_PREVIEW_CORE_CACHE || resolve(import.meta.dir, "data", "preview-cache"));
const previewCore = new PreviewCoreHost({
  cacheRoot: previewCacheRoot,
  settings: () => ({ gameRoot: packageToolPaths(localSettings.load().settings).gamepath, wolvenKitCli: wolvenKit.usable() }),
  log: diagnostics.log.logger("preview"),
});
const previewCoreRequest = createPreviewCoreHandler(previewCore);
// Brows, lashes and hair: resolved from the launch route Build uses and exported from the winning archives.
// The resolver's JSON cache is shared with `tools/resolve-character.ts`; `XFS_RESOLVER_CACHE` relocates it.
const characterDetails = new CharacterDetailHost({ cacheRoot: previewCacheRoot,
  resolverCache: resolve(process.env.XFS_RESOLVER_CACHE || resolve(import.meta.dir, "data", "resolver-cache")),
  settings: () => {
    const settings = localSettings.load().settings;
    return { gameRoot: packageToolPaths(settings).gamepath, launchRoute: settings.launchRoute, mo2Root: settings.mo2Root,
      mo2ProfileId: settings.mo2ProfileId, manualModRoot: settings.manualModRoot, wolvenKitCli: wolvenKit.usable() };
  },
  log: diagnostics.log.logger("character"), trace: diagnostics.trace });
const characterDetailRequest = createCharacterDetailHandler(characterDetails);
const creatorRequest = createCreatorHandler(characterDetails.creator, { refresh: () => characterDetails.refresh(), prepared: characterDetails });
// The creator lighting preset's grading LUT: the winner of the environment's LUT path on the same launch route.
const gradingLut = new GradingLutHost({ cacheRoot: previewCacheRoot,
  resolverCache: resolve(process.env.XFS_RESOLVER_CACHE || resolve(import.meta.dir, "data", "resolver-cache")),
  settings: () => {
    const settings = localSettings.load().settings;
    return { gameRoot: packageToolPaths(settings).gamepath, launchRoute: settings.launchRoute, mo2Root: settings.mo2Root,
      mo2ProfileId: settings.mo2ProfileId, manualModRoot: settings.manualModRoot, wolvenKitCli: wolvenKit.usable() };
  },
  log: diagnostics.log.logger("lut") });
const gradingLutRequest = createGradingLutHandler(gradingLut);
// Diagnostics: the page's failures, diagnostic mode and "Report a problem" (nothing is sent anywhere).
const commit = (() => {
  try { const run = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: import.meta.dir, stdout: "pipe", stderr: "ignore" });
    return run.exitCode === 0 ? run.stdout.toString().trim() || null : null; } catch { return null; }
})();
const diagnosticsRequest = createDiagnosticsHandler(diagnostics, {
  app: () => ({ version: "0.1.0", commit, channel: null, host: "localhost" }),
  settings: () => { const settings = localSettings.load().settings; return { ...settings, gameRoot: packageToolPaths(settings).gamepath }; },
  wolvenKit: () => { const state = wolvenKit.snapshot(); return { version: state.version, source: state.source, phase: state.phase }; },
  roots: () => [{ label: "<data>", path: dataRoot }, { label: "<tools>", path: localToolsRoot() }, { label: "<preview-cache>", path: previewCacheRoot },
    { label: "<studio>", path: import.meta.dir }],
  resolverCache: resolve(process.env.XFS_RESOLVER_CACHE || resolve(import.meta.dir, "data", "resolver-cache")),
  testHook: process.env.XFS_DIAGNOSTICS_TEST_HOOK === "1",
});
const coreFiles = new Set<string>(PREVIEW_CORE_FILES);
const root = resolve(import.meta.dir, "public");
const assetOverlay = process.env.XFS_ASSET_OVERLAY ? resolve(process.env.XFS_ASSET_OVERLAY) : undefined;
/** Retired piercing intake payloads (vanilla and PRC manifests and their files), never served. */
const RETIRED_ASSET_DIRS = /^(?:prc|piercings)(?:[\\/]|$)/i;
const build = await buildBrowser(resolve(root, "build"));
if (!build.success) {
  console.error(build.logs);
  process.exit(1);
}
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 4317),
  maxRequestBodySize: 16_000_000,
  // Each request runs in the diagnostics context: a failure is logged with a reference the page can show.
  fetch: withRequestDiagnostics(diagnostics, async request => {
    const url = new URL(request.url);
    // The API accepts only the 127.0.0.1 origin; send `localhost` visitors there so the library and settings work.
    if (url.hostname === "localhost") { url.hostname = "127.0.0.1"; return Response.redirect(url.toString(), 308); }
    if (url.pathname.startsWith(DIAGNOSTICS_PREFIX)) return diagnosticsRequest(request);
    if (url.pathname === "/api/package") return packageRequest(request);
    if (url.pathname === "/api/mod-install") return modInstallRequest(request);
    if (url.pathname === "/api/verification/mod-install") return verificationModInstallRequest(request);
    if (url.pathname === "/api/local-settings") return settingsRequest(request);
    if (url.pathname === "/api/verification/local-settings") return verificationSettingsRequest(request);
    if (url.pathname === "/api/install-detection") return detectionRequest(request);
    if (url.pathname === "/api/preview-core") return previewCoreRequest(request);
    if (url.pathname === CHARACTER_DETAIL_ENDPOINT) return characterDetailRequest(request);
    if (url.pathname === CREATOR_ENDPOINT) return creatorRequest(request);
    if (url.pathname === GRADING_LUT_ENDPOINT) return gradingLutRequest(request);
    if (url.pathname === "/api/wolvenkit") return wolvenKitRequest(request);
    for (const [prefix, store] of [["/api/collections", collections], ["/api/verification/collections", verificationCollections]] as const)
      if (url.pathname === prefix || url.pathname.startsWith(prefix + "/")) return collectionRequest(request, store, prefix);
    for (const [prefix, store] of [["/api/looks", library], ["/api/verification/looks", verificationLibrary]] as const)
      if (url.pathname === prefix || url.pathname.startsWith(prefix + "/"))
        return libraryRequest(request, store, prefix);
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed", { status: 405 });
    if (url.pathname === "/health")
      return Response.json({ app: "xf-studio", version: "0.1.0" });
    // Resolved character details have one source: the host's content-addressed store.
    if (url.pathname.startsWith(CHARACTER_ASSET_PREFIX)) return serveCharacterAsset(characterDetails, url.pathname, request.method);
    if (url.pathname.startsWith(GRADING_LUT_ASSET_PREFIX)) return serveGradingLut(gradingLut, url.pathname, request.method);
    // Research pages pinned to historical private fixtures read them here, never through /assets.
    const research = url.pathname.startsWith("/research-assets/");
    let path: string;
    try {
      path = resolve(
        root,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/index.html" : research ? "/assets" + url.pathname.slice("/research-assets".length) : url.pathname,
          ),
      );
    } catch {
      return new Response("Bad path", { status: 400 });
    }
    if (!path.startsWith(root + sep))
      return new Response("Not found", { status: 404 });
    let file = Bun.file(path);
    const assetName = path.startsWith(resolve(root, "assets") + sep) ? path.slice(resolve(root, "assets").length + 1) : null;
    // The retired piercing intakes' payloads may still sit in an old checkout's ignored public/assets; piercings come only from the
    // resolver now, so nothing serves them (UI-50).
    if (assetName !== null && RETIRED_ASSET_DIRS.test(assetName)) return new Response("Not found", { status: 404 });
    if (!research && assetName !== null && coreFiles.has(assetName)) {
      // The core preview has one source: the derivation from the player's own game files.
      const derived = previewCore.assetPath(assetName);
      if (!derived) return new Response("Not found", { status: 404 });
      file = Bun.file(derived);
    }
    // Optional private overlay for /assets (e.g. a worktree whose public/assets is a
    // read-only link to another checkout). Files present in the overlay win.
    else if (assetOverlay && assetName !== null) {
      const overlayPath = resolve(assetOverlay, "." + path.slice(resolve(root, "assets").length));
      if (overlayPath.startsWith(assetOverlay + sep) && await Bun.file(overlayPath).exists())
        file = Bun.file(overlayPath);
    }
    if (!(await file.exists()))
      return new Response("Not found", { status: 404 });
    return new Response(request.method === "HEAD" ? null : file, {
      headers: {
        "Content-Type": file.type,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }),
});
diagnostics.log.info("server", "started", `XF Studio: ${server.url}`);

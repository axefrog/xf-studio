import { mkdirSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { LookLibrary, libraryRequest } from "../src/library-store";
import { CollectionLibrary, collectionRequest } from "../src/collection-store";
import { createLocalSettingsHandler } from "../src/local-settings-server";
import { createInstallDetectionHandler, hostFrameworkCheck } from "../src/install-detection-server";
import { LocalSettingsStore } from "../src/local-settings-store";
import { desktopCapabilities, type DesktopVersion } from "./host";
import { desktopPackageRequest } from "./package";
import { cachedBunProbe, cachedWolvenKitProbe, desktopBuildIssue, desktopPlateCache, probeBun, type WolvenKitProbe } from "./build";
import { eyePlateReadiness } from "../src/eye-plate-cache";
import { EYE_PLATE_RECIPE } from "../src/eye-plate-recipe";
import { DesktopUpdateService, type NativeUpdater, type UpdateTrust } from "./update-service";
import { DesktopWorkspaceStore, desktopWorkspaceRequest, desktopWorkspaceStartFresh } from "./workspace-store";
// A composition root: the part registry and document model are built once and injected (CORE-29).
import { STUDIO_DOCUMENTS, STUDIO_PARTS } from "../src/compose/studio-registry";
import { DesktopWorkActivity } from "./work-activity";
import { DesktopUpdateApplyGuard } from "./update-apply-guard";
import { PreviewCoreHost } from "../src/preview-core-host";
import { createPreviewCoreHandler } from "../src/preview-core-server";
import type { GameAssetExporter } from "../src/game-asset-export";
import { PREVIEW_CORE_FILES } from "../src/preview-core-recipe";
import { CharacterDetailHost } from "../src/character-detail-host";
import { CHARACTER_ASSET_PREFIX, CHARACTER_DETAIL_ENDPOINT, createCharacterDetailHandler, serveCharacterAsset } from "../src/character-detail-server";
import { CREATOR_ENDPOINT, createCreatorHandler } from "../src/cc-catalogue-server";
import { createGradingLutHandler, GRADING_LUT_ASSET_PREFIX, GRADING_LUT_ENDPOINT, GradingLutHost, serveGradingLut } from "../src/grading-lut-host";
import { WolvenKitSetupHost, wolvenKitReadinessIssue, type WolvenKitSetupOptions } from "../src/wolvenkit-setup-host";
import { createWolvenKitSetupHandler } from "../src/wolvenkit-setup-server";
import { wolvenKitLinkUrl, type WolvenKitLink } from "../src/wolvenkit-setup";
import { isProjectLink, PROJECT_LINKS } from "../src/project-links";
import type { LocalSettings } from "../src/local-settings";
import { hostDiagnosticsAt, setProcessDiagnostics } from "../src/diagnostics/host-log";
import { createDiagnosticsHandler, DIAGNOSTICS_PREFIX, withRequestDiagnostics } from "../src/diagnostics/host-endpoint";

/** The derived 3D preview cache lives beside the plate cache in the app's private data folder. */
export const desktopPreviewCache = (dataRoot: string) => resolve(dataRoot, "preview-cache");
/** Tools XF Studio downloads with the user's consent (WolvenKit CLI) live in the app's own data folder. */
export const desktopToolsRoot = (dataRoot: string) => resolve(dataRoot, "tools");
const OPEN_LINKS: readonly WolvenKitLink[] = ["wolvenkit-licence", "wolvenkit-release", "runtime-installer", "runtime-page"];

export type DesktopHostOptions = {
  /** Test seams for WolvenKit setup (fixture release, fetch, .NET detection). */
  wolvenKit?: Partial<Omit<WolvenKitSetupOptions, "root" | "configured">>;
  /** Open an official page in the user's browser (Electrobun `Utils.openExternal`). */
  openExternal?: (url: string) => boolean;
  /** The WebView2 Runtime version the host detected, for problem reports. */
  webView2?: string | null;
};

/**
 * The Studio page loads only its own scripts, styles, workers and data from this loopback
 * origin. Inline style attributes are used by the UI; inline scripts are not.
 */
export const DESKTOP_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; font-src 'self'; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function createDesktopServer(staticRoot: string, dataRoot: string, version: DesktopVersion,
  checkWorkerPath = resolve(import.meta.dir, "check-worker.ts"),
  toolsRoot = resolve(import.meta.dir, "build-tools"), wolvenKitProbe?: WolvenKitProbe,
  updateTrial?: { native: NativeUpdater; trust: UpdateTrust;
    requestWorkspaceFlush(nonce: string): void; flushTimeoutMs?: number },
  previewExporter?: (cli: string | null) => GameAssetExporter, hostOptions: DesktopHostOptions = {}) {
  mkdirSync(dataRoot, { recursive: true });
  const library = new LookLibrary(resolve(dataRoot, "library.sqlite"));
  const verificationLibrary = new LookLibrary(resolve(dataRoot, "verification.sqlite"));
  const collections = new CollectionLibrary(resolve(dataRoot, "library.sqlite"), STUDIO_PARTS);
  const verificationCollections = new CollectionLibrary(resolve(dataRoot, "verification.sqlite"), STUDIO_PARTS);
  // Desktop settings follow the Electrobun identity and channel. Never inherit
  // localhost's per-user default or developer XFS_PACKAGE_* environment paths.
  const settingsStore = new LocalSettingsStore(dataRoot);
  const workspaceStore = new DesktopWorkspaceStore(dataRoot, STUDIO_DOCUMENTS);
  let closeAck: ((nonce: string, status: "saved" | "failed") => boolean) | undefined;
  // Renderer progress for the host's blank-window watchdog and close handling.
  const renderer = { pageServed: false, bootstrapped: false, smoke: null as string | null };
  // One structured log and rolling detail window in <data>/diagnostics/ (docs/diagnostics.md). Host events go there by area;
  // `onReport` adds a listener (tests), it doesn't replace the log.
  const diagnostics = hostDiagnosticsAt(dataRoot);
  setProcessDiagnostics(diagnostics);
  let listener: ((message: string) => void) | null = null;
  const logTo = (area: string) => (message: string) => { diagnostics.log.info(area, "event", message); listener?.(message); };
  const report = logTo("desktop");
  const shutdown = new AbortController();
  const activity = new DesktopWorkActivity();
  const updateGuard = updateTrial && new DesktopUpdateApplyGuard(activity,
    updateTrial.requestWorkspaceFlush, updateTrial.flushTimeoutMs);
  const updates = new DesktopUpdateService({ version: version.version, channel: version.channel,
    buildHash: version.buildHash }, updateTrial?.native ?? null,
    updateTrial?.trust ?? { verifiedPrivateFeed: false, signedRelease: false, twoVersionTrialAccepted: false },
    updateGuard || null);
  const savedSettings = () => { try { return settingsStore.load().settings; } catch { return null; } };
  // WolvenKit: a CLI path in Build setup wins; otherwise XF Studio's own copy, downloaded with consent.
  const wolvenKit = new WolvenKitSetupHost({ root: desktopToolsRoot(dataRoot), configured: () => savedSettings()?.wolvenKitCli ?? null,
    log: logTo("wolvenkit"), ...hostOptions.wolvenKit });
  const withWolvenKit = (settings: LocalSettings): LocalSettings =>
    ({ ...settings, wolvenKitCli: settings.wolvenKitCli ?? wolvenKit.managedExecutable() });
  // Readiness requests never run external tools inline: cached answers, background checks.
  const readinessProbes: [WolvenKitProbe, typeof probeBun] = wolvenKitProbe ? [wolvenKitProbe, probeBun] : [cachedWolvenKitProbe, cachedBunProbe];
  const buildReady = () => {
    try { return desktopBuildIssue(withWolvenKit(settingsStore.load().settings), dataRoot, toolsRoot, ...readinessProbes) === null; }
    catch { return false; }
  };
  // The settings view passes effective settings: its own path, or XF Studio's WolvenKit.
  const localSettings = createLocalSettingsHandler(settingsStore, {},
    settings => {
      const buildIssue = desktopBuildIssue(settings, dataRoot, toolsRoot, ...readinessProbes);
      return { updater: false, installer: false, packageCheck: true, packageBuild: buildIssue === null, packageBuildIssue: buildIssue,
        wolvenKit: wolvenKitReadinessIssue(wolvenKit.snapshot()),
        eyePlate: eyePlateReadiness(desktopPlateCache(dataRoot), settings.gameRoot, EYE_PLATE_RECIPE),
        frameworks: hostFrameworkCheck(settings) };
    }, () => wolvenKit.managedExecutable());
  const wolvenKitRequest = createWolvenKitSetupHandler(wolvenKit);
  const installDetection = createInstallDetectionHandler(undefined, { settings: () => settingsStore.load().settings });
  const token = randomBytes(32).toString("hex");
  // The core preview has one source: the derivation from the player's own game files.
  const previewCore = new PreviewCoreHost({ cacheRoot: desktopPreviewCache(dataRoot), exporter: previewExporter,
    // The preview runs WolvenKit only once it is ready to run (present, verified, with its .NET runtime).
    settings: () => ({ gameRoot: savedSettings()?.gameRoot ?? null, wolvenKitCli: wolvenKit.usable() }),
    log: logTo("preview") });
  const previewCoreRequest = createPreviewCoreHandler(previewCore);
  // Brows, lashes and hair: resolved from the launch route Build uses (MO2, manual or game folder) and
  // exported from the winning archives into the same private preview cache.
  const characterDetails = new CharacterDetailHost({ cacheRoot: desktopPreviewCache(dataRoot), exporter: previewExporter,
    settings: () => {
      const settings = savedSettings();
      return { gameRoot: settings?.gameRoot ?? null, launchRoute: settings?.launchRoute ?? "direct", mo2Root: settings?.mo2Root ?? null,
        mo2ProfileId: settings?.mo2ProfileId ?? null, manualModRoot: settings?.manualModRoot ?? null, wolvenKitCli: wolvenKit.usable() };
    },
    log: logTo("character"), trace: diagnostics.trace });
  const characterDetailRequest = createCharacterDetailHandler(characterDetails);
  const creatorRequest = createCreatorHandler(characterDetails.creator, { refresh: () => characterDetails.refresh(), prepared: characterDetails });
  // The creator lighting preset's grading LUT, resolved on the same launch route into the same private cache.
  const gradingLut = new GradingLutHost({ cacheRoot: desktopPreviewCache(dataRoot), resolverCache: resolve(desktopPreviewCache(dataRoot), "resolver"),
    settings: () => {
      const settings = savedSettings();
      return { gameRoot: settings?.gameRoot ?? null, launchRoute: settings?.launchRoute ?? "direct", mo2Root: settings?.mo2Root ?? null,
        mo2ProfileId: settings?.mo2ProfileId ?? null, manualModRoot: settings?.manualModRoot ?? null, wolvenKitCli: wolvenKit.usable() };
    },
    log: logTo("lut") });
  const gradingLutRequest = createGradingLutHandler(gradingLut);
  // Diagnostics: the page's failures, diagnostic mode and "Report a problem" (nothing is sent anywhere).
  const diagnosticsRequest = createDiagnosticsHandler(diagnostics, {
    app: () => ({ version: version.version, commit: version.buildHash === "unavailable" ? null : version.buildHash,
      channel: version.channel === "unavailable" ? null : version.channel, host: "desktop" }),
    settings: () => savedSettings(), webView2: hostOptions.webView2 ?? null,
    wolvenKit: () => { const state = wolvenKit.snapshot(); return { version: state.version, source: state.source, phase: state.phase }; },
    roots: () => [{ label: "<data>", path: dataRoot }, { label: "<build-tools>", path: toolsRoot }],
    resolverCache: resolve(desktopPreviewCache(dataRoot), "resolver"),
    openExternal: hostOptions.openExternal,
  });
  const coreFiles = new Set<string>(PREVIEW_CORE_FILES);
  let server: ReturnType<typeof Bun.serve>;
  server = Bun.serve({
    hostname: "127.0.0.1", port: 0, maxRequestBodySize: 16_000_000,
    // Each request runs in the diagnostics context: a failure is logged with a reference the page can show.
    fetch: withRequestDiagnostics(diagnostics, async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const origin = `http://127.0.0.1:${server.port}`;
      if (url.origin !== origin) return new Response("Forbidden", { status: 403 });
      const firstVisit = url.pathname === "/" && url.searchParams.get("session") === token;
      const cookie = request.headers.get("Cookie") ?? "";
      if (!firstVisit && !cookie.split("; ").includes(`xfs_session=${token}`))
        return new Response("Forbidden", { status: 403 });
      const declaredOrigin = request.headers.get("Origin");
      let sameOriginWebView = false;
      try { sameOriginWebView = !declaredOrigin && request.headers.get("Sec-Fetch-Site") === "same-origin" &&
        new URL(request.headers.get("Referer") ?? "").origin === origin; } catch { /* No valid referrer. */ }
      if (request.method !== "GET" && request.method !== "HEAD" && declaredOrigin !== origin && !sameOriginWebView)
        return new Response("Forbidden", { status: 403 });
      // The existing library handlers require Origin on writes. WebView2 omits it
      // for same-origin fetch, so the authenticated desktop adapter supplies it
      // only after checking browser-controlled Fetch Metadata and referrer.
      const routedRequest = sameOriginWebView ? new Request(request, {
        headers: new Headers([...request.headers, ["Origin", origin]]),
      }) : request;
      if (url.pathname.startsWith("/api/") && request.method === "POST" &&
          request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json")
        return new Response("Expected JSON", { status: 415 });
      if (url.pathname === "/api/desktop/capabilities")
        return Response.json(desktopCapabilities(previewCore.ready() ? "ready" : "missing", version, dataRoot, buildReady()),
          { headers: { "Cache-Control": "no-store" } });
      if (url.pathname.startsWith(DIAGNOSTICS_PREFIX)) return diagnosticsRequest(routedRequest);
      if (url.pathname === "/api/desktop/preview") return previewCoreRequest(routedRequest);
      if (url.pathname === CHARACTER_DETAIL_ENDPOINT) return characterDetailRequest(routedRequest);
      if (url.pathname === CREATOR_ENDPOINT) return creatorRequest(routedRequest);
      if (url.pathname === GRADING_LUT_ENDPOINT) return gradingLutRequest(routedRequest);
      if (url.pathname === "/api/desktop/wolvenkit") return wolvenKitRequest(routedRequest);
      if (url.pathname === "/api/desktop/open-link") {
        // Only named official pages from the host's own state; the view never supplies a URL.
        if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
        let body: any;
        try { body = await routedRequest.json(); } catch { return new Response("Invalid link", { status: 400 }); }
        if (!body || typeof body !== "object" || Object.keys(body).join() !== "link" || !(OPEN_LINKS.includes(body.link) || isProjectLink(body.link)))
          return new Response("Invalid link", { status: 400 });
        // XF Studio's own public pages (Help) are fixed; WolvenKit's come from the pinned release.
        const link: unknown = body.link;
        const target = isProjectLink(link) ? PROJECT_LINKS[link] : wolvenKitLinkUrl(wolvenKit.snapshot(), link as WolvenKitLink);
        if (!target || !hostOptions.openExternal) return new Response("Link unavailable", { status: 409 });
        return new Response(null, { status: hostOptions.openExternal(target) === false ? 502 : 204 });
      }
      if (url.pathname === "/api/desktop/update") {
        if (request.method === "GET") return Response.json(updates.snapshot(),
          { headers: { "Cache-Control": "no-store" } });
        if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
        let body: unknown;
        try { body = await routedRequest.json(); } catch { return new Response("Bad update action", { status: 400 }); }
        if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).sort().join(",") !== "action,schema" ||
          (body as any).schema !== "xfs/desktop-update-action-1" ||
          !["check", "download", "applyAndRestart"].includes((body as any).action))
          return new Response("Bad update action", { status: 400 });
        try { return Response.json(await updates.dispatch((body as any).action),
          { headers: { "Cache-Control": "no-store" } }); }
        catch { return new Response("Update operation is unavailable", { status: 409 }); }
      }
      if (url.pathname === "/api/desktop/workspace/start-fresh") {
        const response = desktopWorkspaceStartFresh(routedRequest, workspaceStore, url.searchParams.has("verify"));
        if (response.ok) report("The user started fresh; an unreadable workspace was set aside.");
        return response;
      }
      if (url.pathname === "/api/desktop/workspace") {
        const response = await desktopWorkspaceRequest(routedRequest, workspaceStore, url.searchParams.has("verify"));
        // Only a successfully loaded workspace makes the close handshake wait for the page.
        if (request.method === "GET" && !renderer.bootstrapped) {
          if (response.ok) { renderer.bootstrapped = true; report("Renderer bootstrap loaded the workspace."); }
          else report("The saved workspace is unreadable; the page offers Start fresh.");
        }
        if (request.method === "POST" && response.status === 204)
          updateGuard?.noteWorkspaceWrite(request.headers.get("X-XFS-Update-Flush"));
        return response;
      }
      if (url.pathname === "/api/desktop/workspace/close-ack" && (closeAck || updateGuard)) {
        if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
        let body: any;
        try { body = await routedRequest.json(); } catch { return new Response("Invalid close acknowledgement", { status: 400 }); }
        if (body?.schema !== "xfs/desktop-close-ack-1" || typeof body.nonce !== "string" ||
          !["saved", "failed"].includes(body.status) || Object.keys(body).sort().join(",") !== "nonce,schema,status")
          return new Response("Invalid close acknowledgement", { status: 400 });
        return new Response(null, { status: (closeAck?.(body.nonce, body.status) ||
          updateGuard?.acknowledge(body.nonce, body.status)) ? 204 : 409 });
      }
      if (url.pathname === "/api/desktop/smoke" && request.method === "POST") {
        let value: any;
        try { value = await routedRequest.json(); } catch { return new Response("Bad report", { status: 400 }); }
        if (value?.schema !== "xfs/desktop-smoke-1" || !["error", "uv-only", "starting", "interactive"].includes(value.state) ||
          typeof value.webgl2 !== "boolean" || typeof value.worker !== "boolean") return new Response("Bad report", { status: 400 });
        renderer.smoke = value.state;
        report(`XF desktop smoke: ${value.state}; WebGL2=${value.webgl2}; Worker=${value.worker}`);
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/api/package") return desktopPackageRequest(routedRequest, checkWorkerPath,
        undefined, { dataRoot, toolsRoot, settings: settingsStore, shutdownSignal: shutdown.signal, wolvenKitProbe, log: logTo("package"),
          managedWolvenKit: () => wolvenKit.managedExecutable() }, activity);
      if (url.pathname === "/api/local-settings") return localSettings(routedRequest);
      if (url.pathname === "/api/install-detection") return installDetection(routedRequest);
      for (const [prefix, store] of [["/api/collections", collections], ["/api/verification/collections", verificationCollections]] as const)
        if (url.pathname === prefix || url.pathname.startsWith(prefix + "/")) return collectionRequest(routedRequest, store, prefix);
      for (const [prefix, store] of [["/api/looks", library], ["/api/verification/looks", verificationLibrary]] as const)
        if (url.pathname === prefix || url.pathname.startsWith(prefix + "/")) return libraryRequest(routedRequest, store, prefix);
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      if (url.pathname === "/health") return Response.json({ app: "xf-studio-desktop" });
      let path: string;
      let servedRoot = staticRoot;
      if (url.pathname.startsWith(CHARACTER_ASSET_PREFIX)) return serveCharacterAsset(characterDetails, url.pathname, request.method);
      if (url.pathname.startsWith(GRADING_LUT_ASSET_PREFIX)) return serveGradingLut(gradingLut, url.pathname, request.method);
      if (url.pathname.startsWith("/assets/")) {
        // Only the derived core preview files are served as assets; the installer carries none.
        let name: string;
        try { name = decodeURIComponent(url.pathname.slice("/assets/".length)); } catch { return new Response("Bad path", { status: 400 }); }
        const derived = coreFiles.has(name) ? previewCore.assetPath(name) : null;
        if (!derived) return new Response("Not found", { status: 404 });
        path = derived; servedRoot = resolve(derived, "..");
      } else {
        try { path = resolve(staticRoot, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)); }
        catch { return new Response("Bad path", { status: 400 }); }
        if (!path.startsWith(staticRoot + sep)) return new Response("Not found", { status: 404 });
      }
      const file = Bun.file(path);
      if (!(await file.exists())) return new Response("Not found", { status: 404 });
      try {
        const resolvedRoot = realpathSync(servedRoot), resolvedFile = realpathSync(path);
        if (!resolvedFile.startsWith(resolvedRoot + sep) || !statSync(resolvedFile).isFile())
          return new Response("Not found", { status: 404 });
      } catch { return new Response("Not found", { status: 404 }); }
      if (firstVisit && !renderer.pageServed) { renderer.pageServed = true; report("WebView requested the Studio page."); }
      return new Response(request.method === "HEAD" ? null : file, { headers: {
        "Content-Type": file.type, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff",
        ...(firstVisit ? { "Set-Cookie": `xfs_session=${token}; HttpOnly; SameSite=Strict; Path=/` } : {}),
        ...(path.endsWith(".html") ? { "Content-Security-Policy": DESKTOP_CSP } : {}),
      } });
    }),
  });
  return {
    url: `${server.url}?session=${token}`,
    port: server.port,
    onWorkspaceCloseAck(handler: (nonce: string, status: "saved" | "failed") => boolean) { closeAck = handler; },
    /** Also hand host events (page served, bootstrap, smoke state) to `handler`; they are always in the diagnostics log. */
    onReport(handler: (message: string) => void) { listener = handler; },
    /** The host's diagnostics log and rolling window. */
    diagnostics,
    renderer(): Readonly<typeof renderer> { return { ...renderer }; },
    beforeQuit(event: { response?: { allow: boolean } }) { updateGuard?.beforeQuit(event); },
    beginInstallTransaction() { return activity.begin("install"); },
    /** The derived 3D preview's host service (tests and shutdown). */
    previewCore,
    /** Resolved skin, face details, eyes, brows, lashes, hair, piercings and body (tests and shutdown). */
    characterDetails,
    /** WolvenKit setup (tests and shutdown). */
    wolvenKit,
    stop() { diagnostics.trace.flush(); shutdown.abort(); previewCore.cancel(); characterDetails.cancel(); wolvenKit.cancel(); server.stop(true); collections.close(); verificationCollections.close(); library.close(); verificationLibrary.close(); },
  };
}

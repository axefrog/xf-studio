import { resolve, sep } from "node:path";
import { mkdirSync } from "node:fs";
import { LookLibrary, libraryRequest } from "./src/library-store";
import { CollectionLibrary, collectionRequest } from "./src/collection-store";
import { createPackageHandler, localPackageTools, localPlateCache } from "./src/package-server";
import { eyePlateReadiness } from "./src/eye-plate-cache";
import { EYE_PLATE_RECIPE } from "./src/eye-plate-recipe";
import { createLocalSettingsHandler } from "./src/local-settings-server";
import { createInstallDetectionHandler, hostFrameworkCheck } from "./src/install-detection-server";
import { packageToolPaths } from "./src/local-settings-readiness";
import { LocalSettingsStore } from "./src/local-settings-store";
import { buildBrowser } from "./browser-build";
import { PreviewCoreHost } from "./src/preview-core-host";
import { createPreviewCoreHandler } from "./src/preview-core-server";
const dataRoot = resolve(process.env.XFAS_DATA_DIR ?? resolve(import.meta.dir, "data"));
mkdirSync(dataRoot, { recursive: true });
const library = new LookLibrary(resolve(dataRoot, "library.sqlite"));
const verificationLibrary = new LookLibrary(resolve(dataRoot, "verification.sqlite"));
const collections = new CollectionLibrary(resolve(dataRoot, "library.sqlite"));
const verificationCollections = new CollectionLibrary(resolve(dataRoot, "verification.sqlite"));
const localSettings = new LocalSettingsStore();
const settingsRequest = createLocalSettingsHandler(localSettings, process.env, settings => ({ updater: false, installer: false,
  eyePlate: eyePlateReadiness(localPlateCache(), settings.gameRoot, EYE_PLATE_RECIPE), frameworks: hostFrameworkCheck(settings) }));
const detectionRequest = createInstallDetectionHandler(undefined, { settings: () => {
  const settings = localSettings.load().settings;
  return { ...settings, gameRoot: packageToolPaths(settings).gamepath };
} });
const packageRequest = createPackageHandler(action => action === "check" ? localPackageTools() :
  localPackageTools(localSettings.load().settings));
// Derived 3D preview (head, plate, eyes, maps) from the configured game; `XFS_PREVIEW_CORE_CACHE` relocates it.
const previewCore = new PreviewCoreHost({
  cacheRoot: resolve(process.env.XFS_PREVIEW_CORE_CACHE || resolve(import.meta.dir, "data", "preview-cache")),
  settings: () => { const tools = packageToolPaths(localSettings.load().settings); return { gameRoot: tools.gamepath, wolvenKitCli: tools.wolvenkit }; },
  log: message => console.log(message),
});
const previewCoreRequest = createPreviewCoreHandler(previewCore);
const root = resolve(import.meta.dir, "public");
const assetOverlay = process.env.XFS_ASSET_OVERLAY ? resolve(process.env.XFS_ASSET_OVERLAY) : undefined;
const build = await buildBrowser(resolve(root, "build"));
if (!build.success) {
  console.error(build.logs);
  process.exit(1);
}
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 4317),
  maxRequestBodySize: 16_000_000,
  async fetch(request) {
    const url = new URL(request.url);
    // The API accepts only the 127.0.0.1 origin; send `localhost` visitors there so the library and settings work.
    if (url.hostname === "localhost") { url.hostname = "127.0.0.1"; return Response.redirect(url.toString(), 308); }
    if (url.pathname === "/api/package") return packageRequest(request);
    if (url.pathname === "/api/local-settings") return settingsRequest(request);
    if (url.pathname === "/api/install-detection") return detectionRequest(request);
    if (url.pathname === "/api/preview-core") return previewCoreRequest(request);
    for (const [prefix, store] of [["/api/collections", collections], ["/api/verification/collections", verificationCollections]] as const)
      if (url.pathname === prefix || url.pathname.startsWith(prefix + "/")) return collectionRequest(request, store, prefix);
    for (const [prefix, store] of [["/api/looks", library], ["/api/verification/looks", verificationLibrary]] as const)
      if (url.pathname === prefix || url.pathname.startsWith(prefix + "/"))
        return libraryRequest(request, store, prefix);
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed", { status: 405 });
    if (url.pathname === "/health")
      return Response.json({ app: "xf-studio", version: "0.1.0" });
    let path: string;
    try {
      path = resolve(
        root,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/index.html" : url.pathname,
          ),
      );
    } catch {
      return new Response("Bad path", { status: 400 });
    }
    if (!path.startsWith(root + sep))
      return new Response("Not found", { status: 404 });
    let file = Bun.file(path);
    // Optional private overlay for /assets (e.g. a worktree whose public/assets is a
    // read-only link to another checkout). Files present in the overlay win.
    if (assetOverlay && path.startsWith(resolve(root, "assets") + sep)) {
      const overlayPath = resolve(assetOverlay, "." + path.slice(resolve(root, "assets").length));
      if (overlayPath.startsWith(assetOverlay + sep) && await Bun.file(overlayPath).exists())
        file = Bun.file(overlayPath);
    }
    // Private prepared assets (public/assets or the overlay) win; otherwise serve the derived core preview.
    if (!(await file.exists()) && path.startsWith(resolve(root, "assets") + sep)) {
      const derived = previewCore.assetPath(path.slice(resolve(root, "assets").length + 1));
      if (derived) file = Bun.file(derived);
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
  },
});
console.log(`XF Studio: ${server.url}`);

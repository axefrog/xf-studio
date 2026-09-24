import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { LookLibrary, libraryRequest } from "../src/library-store";
import { CollectionLibrary, collectionRequest } from "../src/collection-store";
import { createLocalSettingsHandler } from "../src/local-settings-server";
import { LocalSettingsStore } from "../src/local-settings-store";
import { desktopCapabilities, type DesktopVersion } from "./host";
import { desktopPackageRequest } from "./package";
import { desktopBuildIssue, type WolvenKitProbe } from "./build";
import { createCoreAssetReadiness, desktopAssetIntakeRequest } from "./asset-intake";

export function createDesktopServer(staticRoot: string, dataRoot: string, version: DesktopVersion,
  checkWorkerPath = resolve(import.meta.dir, "check-worker.ts"),
  toolsRoot = resolve(import.meta.dir, "build-tools"), wolvenKitProbe?: WolvenKitProbe) {
  mkdirSync(dataRoot, { recursive: true });
  const library = new LookLibrary(resolve(dataRoot, "library.sqlite"));
  const verificationLibrary = new LookLibrary(resolve(dataRoot, "verification.sqlite"));
  const collections = new CollectionLibrary(resolve(dataRoot, "library.sqlite"));
  const verificationCollections = new CollectionLibrary(resolve(dataRoot, "verification.sqlite"));
  // Desktop settings follow the Electrobun identity and channel. Never inherit
  // localhost's per-user default or developer XFS_PACKAGE_* environment paths.
  const settingsStore = new LocalSettingsStore(dataRoot);
  const shutdown = new AbortController();
  const buildReady = () => {
    try { return desktopBuildIssue(settingsStore.load().settings, dataRoot, toolsRoot, wolvenKitProbe) === null; }
    catch { return false; }
  };
  const localSettings = createLocalSettingsHandler(settingsStore, {},
    settings => ({ updater: false, installer: false, packageCheck: true,
      packageBuild: desktopBuildIssue(settings, dataRoot, toolsRoot, wolvenKitProbe) === null }));
  const token = randomBytes(32).toString("hex");
  const assetRoot = resolve(dataRoot, "preview-assets");
  const coreAssetsReady = createCoreAssetReadiness(dataRoot);
  let server: ReturnType<typeof Bun.serve>;
  server = Bun.serve({
    hostname: "127.0.0.1", port: 0, maxRequestBodySize: 16_000_000,
    async fetch(request: Request): Promise<Response> {
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
      if (url.pathname === "/api/desktop/capabilities")
        return Response.json(desktopCapabilities(await coreAssetsReady() ? "ready" :
          existsSync(assetRoot) ? "incomplete" : "missing", version, dataRoot, buildReady()),
          { headers: { "Cache-Control": "no-store" } });
      if (url.pathname === "/api/desktop/assets/intake") return desktopAssetIntakeRequest(routedRequest, dataRoot);
      if (url.pathname === "/api/desktop/smoke" && request.method === "POST") {
        let value: any;
        try { value = await routedRequest.json(); } catch { return new Response("Bad report", { status: 400 }); }
        if (value?.schema !== "xfs/desktop-smoke-1" || !["error", "uv-only", "starting", "interactive"].includes(value.state) ||
          typeof value.webgl2 !== "boolean" || typeof value.worker !== "boolean") return new Response("Bad report", { status: 400 });
        console.log(`XF desktop smoke: ${value.state}; WebGL2=${value.webgl2}; Worker=${value.worker}`);
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/api/package") return desktopPackageRequest(routedRequest, checkWorkerPath,
        undefined, { dataRoot, toolsRoot, settings: settingsStore, shutdownSignal: shutdown.signal, wolvenKitProbe });
      if (url.pathname === "/api/local-settings") return localSettings(routedRequest);
      for (const [prefix, store] of [["/api/collections", collections], ["/api/verification/collections", verificationCollections]] as const)
        if (url.pathname === prefix || url.pathname.startsWith(prefix + "/")) return collectionRequest(routedRequest, store, prefix);
      for (const [prefix, store] of [["/api/looks", library], ["/api/verification/looks", verificationLibrary]] as const)
        if (url.pathname === prefix || url.pathname.startsWith(prefix + "/")) return libraryRequest(routedRequest, store, prefix);
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      if (url.pathname === "/health") return Response.json({ app: "xf-studio-desktop-spike" });
      let path: string;
      const asset = url.pathname.startsWith("/assets/");
      const root = asset ? assetRoot : staticRoot;
      try { path = resolve(root, "." + decodeURIComponent(asset ? url.pathname.slice("/assets".length) : url.pathname === "/" ? "/index.html" : url.pathname)); }
      catch { return new Response("Bad path", { status: 400 }); }
      if (!path.startsWith(root + sep)) return new Response("Not found", { status: 404 });
      const file = Bun.file(path);
      if (!(await file.exists())) return new Response("Not found", { status: 404 });
      try {
        const resolvedRoot = realpathSync(root), resolvedFile = realpathSync(path);
        if (!resolvedFile.startsWith(resolvedRoot + sep) || !statSync(resolvedFile).isFile())
          return new Response("Not found", { status: 404 });
      } catch { return new Response("Not found", { status: 404 }); }
      return new Response(request.method === "HEAD" ? null : file, { headers: {
        "Content-Type": file.type, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff",
        ...(firstVisit ? { "Set-Cookie": `xfs_session=${token}; HttpOnly; SameSite=Strict; Path=/` } : {}),
      } });
    },
  });
  return {
    url: `${server.url}?session=${token}`,
    port: server.port,
    stop() { shutdown.abort(); server.stop(true); collections.close(); verificationCollections.close(); library.close(); verificationLibrary.close(); },
  };
}

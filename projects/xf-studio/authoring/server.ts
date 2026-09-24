import { resolve, sep } from "node:path";
import { mkdirSync } from "node:fs";
import { LookLibrary, libraryRequest } from "./src/library-store";
import { CollectionLibrary, collectionRequest } from "./src/collection-store";
import { createPackageHandler, localPackageTools } from "./src/package-server";
import { createLocalSettingsHandler } from "./src/local-settings-server";
import { createInstallDetectionHandler } from "./src/install-detection-server";
import { LocalSettingsStore } from "./src/local-settings-store";
import { buildBrowser } from "./browser-build";
const dataRoot = resolve(process.env.XFAS_DATA_DIR ?? resolve(import.meta.dir, "data"));
mkdirSync(dataRoot, { recursive: true });
const library = new LookLibrary(resolve(dataRoot, "library.sqlite"));
const verificationLibrary = new LookLibrary(resolve(dataRoot, "verification.sqlite"));
const collections = new CollectionLibrary(resolve(dataRoot, "library.sqlite"));
const verificationCollections = new CollectionLibrary(resolve(dataRoot, "verification.sqlite"));
const localSettings = new LocalSettingsStore();
const settingsRequest = createLocalSettingsHandler(localSettings);
const detectionRequest = createInstallDetectionHandler();
const packageRequest = createPackageHandler(action => action === "check" ? localPackageTools() :
  localPackageTools(localSettings.load().settings));
const root = resolve(import.meta.dir, "public");
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
    if (url.pathname === "/api/package") return packageRequest(request);
    if (url.pathname === "/api/local-settings") return settingsRequest(request);
    if (url.pathname === "/api/install-detection") return detectionRequest(request);
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
    const file = Bun.file(path);
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

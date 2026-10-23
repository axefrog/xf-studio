/** Read-only baseline material/geometry references, isolated from the shown V and its installed route. */
import { resolve } from "node:path";
import { CharacterDetailHost, type CharacterDetailSettings, type CharacterDetailHostOptions } from "./character-detail-host";
import { CHARACTER_ASSET_PREFIX, createCharacterDetailHandler, serveCharacterAsset } from "./character-detail-server";
import { referenceCap, type PreparedFiles } from "../../host/prepared-files";

export const REFERENCE_CHARACTER_ENDPOINT = "/api/reference-character";
export const REFERENCE_CHARACTER_ASSETS = "/assets/reference-character/";
/**
 * The references' files are one capped partition of the host process's prepared files (`prepared`; HAIR-03: they never evict the user's
 * V). Their preparations run on a scheduler of their own, so a reference never queues behind (or ahead of) the user's V.
 */
export function createReferenceCharacterRoutes(options: { cacheRoot: string; settings(): CharacterDetailSettings;
  enabled(request: Request): boolean | Promise<boolean>; prepared?: PreparedFiles;
  log?: (message: string) => void; nativeDecodeWorker?: string; exporter?: CharacterDetailHostOptions["exporter"] }) {
  const host = new CharacterDetailHost({ ...options, cacheRoot: resolve(options.cacheRoot, "reference-characters"),
    resolverCache: resolve(options.cacheRoot, "reference-resolver"), settings: () => ({ ...options.settings(), baseOnly: true,
      launchRoute: "direct", mo2Root: null, mo2ProfileId: null, manualModRoot: null }),
    ...options.prepared ? { prepared: options.prepared, partition: { name: "reference", cap: referenceCap(options.prepared.budget) } } : {} });
  const character = createCharacterDetailHandler(host);
  return { accepts: (path: string) => path === REFERENCE_CHARACTER_ENDPOINT || path.startsWith(REFERENCE_CHARACTER_ASSETS),
    handle: async (request: Request) => { if (!await options.enabled(request)) return Response.json({ code: "reference_not_enabled", message: "Baseline references are available while Hair Lab or verification is enabled." }, { status: 403 });
      const url = new URL(request.url); return url.pathname === REFERENCE_CHARACTER_ENDPOINT ? character(request)
      : serveCharacterAsset(host, url.pathname.replace(REFERENCE_CHARACTER_ASSETS, CHARACTER_ASSET_PREFIX), request.method, true); } };
}

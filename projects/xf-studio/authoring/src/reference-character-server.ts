/** Read-only baseline material/geometry references, isolated from the shown V and its installed route. */
import { resolve } from "node:path";
import { CharacterDetailHost, type CharacterDetailSettings, type CharacterDetailHostOptions } from "./character-detail-host";
import { CHARACTER_ASSET_PREFIX, createCharacterDetailHandler, serveCharacterAsset } from "./character-detail-server";

export const REFERENCE_CHARACTER_ENDPOINT = "/api/reference-character";
export const REFERENCE_CHARACTER_ASSETS = "/assets/reference-character/";
export function createReferenceCharacterRoutes(options: { cacheRoot: string; settings(): CharacterDetailSettings;
  log?: (message: string) => void; nativeDecodeWorker?: string; exporter?: CharacterDetailHostOptions["exporter"] }) {
  const host = new CharacterDetailHost({ ...options, cacheRoot: resolve(options.cacheRoot, "reference-characters"),
    resolverCache: resolve(options.cacheRoot, "reference-resolver"), settings: () => ({ ...options.settings(), baseOnly: true,
      launchRoute: "direct", mo2Root: null, mo2ProfileId: null, manualModRoot: null }) });
  const character = createCharacterDetailHandler(host);
  return { accepts: (path: string) => path === REFERENCE_CHARACTER_ENDPOINT || path.startsWith(REFERENCE_CHARACTER_ASSETS),
    handle: (request: Request) => { const url = new URL(request.url); return url.pathname === REFERENCE_CHARACTER_ENDPOINT ? character(request)
      : serveCharacterAsset(host, url.pathname.replace(REFERENCE_CHARACTER_ASSETS, CHARACTER_ASSET_PREFIX), request.method, true); } };
}

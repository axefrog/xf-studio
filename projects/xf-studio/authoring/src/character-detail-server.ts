import type { CharacterDetailHost } from "./character-detail-host";
import { CHARACTER_REQUEST_SCHEMA, CharacterRequestVersionError, parseCharacterRequest } from "./character-detail-request";
import { CREATOR_LIMITS } from "./creator-names";
import { CHARACTER_DETAIL_SCHEMA } from "./render-detail";
import { BodyTooLargeError, readBodyText } from "./request-body";

/**
 * Host endpoint for the preview's resolved character details, shared by localhost and the desktop.
 * POST takes one character request (`xfs/character-request-4`, or an earlier one without a tried choice) and returns the preparation state;
 * a request of a version this host doesn't read is refused with `unsupported_version` and the versions it does read, so a page built
 * apart from the host (the app updated while it ran) can say so instead of failing silently;
 * GET `?key=` polls it. The launch route and tools come from the host's own settings, never the
 * browser. Callers mount it behind their own session checks (the desktop adds a token cookie). The body is read within the shared
 * request limit (creator-names.ts), its declared length checked first (PIPE-79, PIPE-83).
 * `serveCharacterAsset` answers `/assets/character/<content-addressed name>`.
 */
export const CHARACTER_DETAIL_ENDPOINT = "/api/preview-character";
export const CHARACTER_ASSET_PREFIX = "/assets/character/";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export function createCharacterDetailHandler(host: CharacterDetailHost, options: { trustedOrigin?: (request: Request) => boolean } = {}) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (url.hostname !== "127.0.0.1" || (origin && origin !== url.origin))
      return json({ code: "forbidden", error: "Use the local studio to prepare the preview." }, 403);
    if (request.method === "GET") {
      const key = url.searchParams.get("key") ?? "";
      if (!/^[a-f0-9]{32}$/.test(key)) return json({ code: "invalid", error: "Unknown request." }, 400);
      return json(host.state(key));
    }
    if (request.method !== "POST") return json({ code: "method", error: "Method not allowed." }, 405);
    const trusted = options.trustedOrigin?.(request) ?? origin === url.origin;
    if (!trusted || request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
      return json({ code: "forbidden", error: "Use the local studio to prepare the preview." }, 403);
    let body: unknown;
    try {
      body = parseCharacterRequest(JSON.parse(await readBodyText(request, CREATOR_LIMITS.requestBytes)));
    } catch (error) {
      if (error instanceof BodyTooLargeError) return json({ code: "too_large", error: "Request is too large." }, 413);
      if (error instanceof CharacterRequestVersionError) return json({ code: "unsupported_version", error: "This page and the preview host are different versions.",
        request: CHARACTER_REQUEST_SCHEMA, record: CHARACTER_DETAIL_SCHEMA }, 409);
      return json({ code: "invalid", error: "Invalid character request." }, 400);
    }
    // An answer prepared earlier is reused only while the mod setup it came from is unchanged.
    await host.refresh();
    return json(host.request(body as ReturnType<typeof parseCharacterRequest>));
  };
}

/** A content-addressed record or file for `/assets/character/<name>`, or a 404. */
export async function serveCharacterAsset(host: CharacterDetailHost, pathname: string, method: string): Promise<Response> {
  let name: string;
  try { name = decodeURIComponent(pathname.slice(CHARACTER_ASSET_PREFIX.length)); } catch { return new Response("Bad path", { status: 400 }); }
  const path = host.filePath(name);
  if (!path) return new Response("Not found", { status: 404 });
  const file = Bun.file(path);
  return new Response(method === "HEAD" ? null : file, { headers: {
    "Content-Type": name.endsWith(".json") ? "application/json" : name.endsWith(".png") ? "image/png" : "model/gltf-binary",
    // Content-addressed: the bytes behind a name never change.
    "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}

import { PREVIEW_STYLES, type PreviewKind } from "./choice-preview";
import { PREVIEW_IMAGE_MAX_BYTES } from "./choice-preview-host";
import type { PreviewSourceItem, PreviewSourcesInput } from "./character-detail-host";
import { CHARACTER_REQUEST_SCHEMA, CharacterRequestVersionError, parseCharacterRequest } from "./character-detail-request";
import { CREATOR_LIMITS, isOptionId } from "./creator-names";
import { BodyTooLargeError, readBodyBytes, readBodyText } from "./request-body";

/**
 * Host endpoint for choice previews (choice-previews-design.md §9), local-only like the other creator reads, shared by localhost and the
 * desktop:
 * - `POST /api/preview-character/creator/previews` `{request, option, kind, positions, derive?}` → each position's preview source
 *   (`xfs/choice-preview-sources-1`: ready with its source, none, or unprepared, `busy` when the derivation didn't get the background
 *   lane within a few seconds), deriving at most the one `derive` names (a choice prepared ahead and ready) in the host's background
 *   lane; a request the page abandons stops waiting for the lane;
 * - `GET …/previews/<key>` → a stored channel image (WebP, content-addressed, cached by the browser);
 * - `POST …/previews/<key>` (`image/webp`, from the page's own origin) → keep an image the page's preview worker rendered.
 */
export const CHOICE_PREVIEW_ENDPOINT = "/api/preview-character/creator/previews";
export const CHOICE_PREVIEW_SOURCES_SCHEMA = "xfs/choice-preview-sources-1" as const;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
/** Most positions one question names (the positions in view and near it). */
const MAX_POSITIONS = 512;
const position = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 && (value as number) < 100_000;

export type PreviewHost = {
  previewSources(input: PreviewSourcesInput): Promise<PreviewSourceItem[]>;
  previews: { imagePath(key: string): string | null; putImage(key: string, bytes: Uint8Array): boolean };
};

export function createChoicePreviewHandler(host: PreviewHost, options: { trustedOrigin?: (request: Request) => boolean } = {}) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (url.hostname !== "127.0.0.1" || (origin && origin !== url.origin)) return json({ code: "forbidden", error: "Use the local studio for previews." }, 403);
    const rest = url.pathname.slice(CHOICE_PREVIEW_ENDPOINT.length);
    const key = /^\/([a-f0-9]{64})$/.exec(rest)?.[1] ?? null;
    if (rest && !key) return json({ code: "invalid", error: "Unknown preview." }, 400);
    try {
      if (request.method === "GET" || request.method === "HEAD") {
        const path = key ? host.previews.imagePath(key) : null;
        if (!path) return json({ code: "missing_target", error: "No such preview yet." }, 404);
        return new Response(request.method === "HEAD" ? null : Bun.file(path), { headers: { "Content-Type": "image/webp",
          "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
      }
      if (request.method !== "POST") return json({ code: "method", error: "Method not allowed." }, 405);
      const trusted = options.trustedOrigin?.(request) ?? origin === url.origin;
      const type = request.headers.get("Content-Type")?.split(";")[0];
      if (!trusted) return json({ code: "forbidden", error: "Use the local studio for previews." }, 403);
      if (key) {
        if (type !== "image/webp") return json({ code: "invalid", error: "Not a preview image." }, 400);
        const ok = host.previews.putImage(key, await readBodyBytes(request, PREVIEW_IMAGE_MAX_BYTES));
        return ok ? json({ stored: true }) : json({ code: "invalid", error: "Not a preview image." }, 400);
      }
      if (type !== "application/json") return json({ code: "forbidden", error: "Use the local studio for previews." }, 403);
      const body = JSON.parse(await readBodyText(request, CREATOR_LIMITS.requestBytes)) as { request?: unknown; option?: unknown; kind?: unknown;
        positions?: unknown; derive?: unknown };
      if (!isOptionId(body?.option) || typeof body.kind !== "string" || !(body.kind in PREVIEW_STYLES) || !Array.isArray(body.positions)
        || body.positions.length > MAX_POSITIONS || !body.positions.every(position) || (body.derive !== undefined && body.derive !== null && !position(body.derive)))
        return json({ code: "invalid", error: "Unknown request." }, 400);
      const items = await host.previewSources({ base: parseCharacterRequest(body.request), option: body.option, kind: body.kind as PreviewKind,
        positions: body.positions as number[], derive: (body.derive as number | null | undefined) ?? null, signal: request.signal });
      return json({ schema: CHOICE_PREVIEW_SOURCES_SCHEMA, items });
    } catch (error) {
      if (error instanceof BodyTooLargeError) return json({ code: "too_large", error: "Request is too large." }, 413);
      if (error instanceof CharacterRequestVersionError) return json({ code: "unsupported_version", error: "This page and the preview host are different versions.",
        request: CHARACTER_REQUEST_SCHEMA }, 409);
      if (error instanceof SyntaxError || (error as Error)?.message?.startsWith("Character request:")) return json({ code: "invalid", error: (error as Error).message }, 400);
      return json({ code: "failed", error: "XF Studio couldn't read its choice previews." }, 500);
    }
  };
}

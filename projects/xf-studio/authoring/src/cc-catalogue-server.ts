import type { BodyGender } from "./cc-catalogue";
import { type CreatorCatalogueHost, CreatorSetupError } from "./cc-catalogue-service";
import { parseCcPreset } from "./cc-preset";
import { CHARACTER_REQUEST_SCHEMA, CharacterRequestVersionError, parseCharacterRequest } from "./character-detail-request";

/**
 * Host endpoint for the Character panel's creator options (cc-catalogue-service.ts), shared by localhost and the desktop, mounted
 * behind the caller's own session checks like the character endpoint:
 * - `GET ?gender=female` → the catalogue's state and, once ready, the panel's first-paint projection (`xfs/cc-panel-1`);
 * - `GET ?gender=female&option=<part/name>&offset=<n>` → one page of that option's choices;
 * - `POST {kind:"view", request}` → the character context's view of a request (`xfs/character-request-4`);
 * - `POST {kind:"preset", request, name?, kept?}` → a portable `xfs/cc-preset-1` of the request's choices.
 * The launch route comes from the host's own settings, never the page. A request of a version this host doesn't read is refused with
 * `unsupported_version`, as on the character endpoint.
 */
export const CREATOR_ENDPOINT = "/api/preview-character/creator";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const MAX_BODY = 2 * 1024 * 1024;
const gender = (value: string | null): BodyGender | null => value === "female" || value === "male" ? value : null;

export function createCreatorHandler(host: CreatorCatalogueHost, options: { trustedOrigin?: (request: Request) => boolean; refresh?: () => Promise<void> } = {}) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (url.hostname !== "127.0.0.1" || (origin && origin !== url.origin))
      return json({ code: "forbidden", error: "Use the local studio to read the creator options." }, 403);
    try {
      if (request.method === "GET") {
        const body = gender(url.searchParams.get("gender"));
        if (!body) return json({ code: "invalid", error: "Unknown body type." }, 400);
        const option = url.searchParams.get("option");
        if (option === null) {
          await options.refresh?.();
          return json(host.state(body));
        }
        const offset = Number(url.searchParams.get("offset") ?? 0);
        if (!/^(head|body|arms)\/[^\u0000-\u001f\\<>"]{1,127}$/.test(option) || !Number.isInteger(offset) || offset < 0)
          return json({ code: "invalid", error: "Unknown option." }, 400);
        const page = await host.page(body, option, offset);
        return page ? json(page) : json({ code: "missing_target", error: "That creator option isn't offered by the installed game and mods." }, 404);
      }
      if (request.method !== "POST") return json({ code: "method", error: "Method not allowed." }, 405);
      const trusted = options.trustedOrigin?.(request) ?? origin === url.origin;
      if (!trusted || request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
        return json({ code: "forbidden", error: "Use the local studio to read the creator options." }, 403);
      const text = await request.text();
      if (text.length > MAX_BODY) return json({ code: "too_large", error: "Request is too large." }, 413);
      const body = JSON.parse(text) as { kind?: unknown; request?: unknown; name?: unknown; kept?: unknown };
      const parsed = parseCharacterRequest(body?.request);
      if (body.kind === "view") return json(await host.view(parsed));
      if (body.kind === "preset") {
        const name = typeof body.name === "string" && body.name.length <= 120 && !/[\u0000-\u001f]/.test(body.name) ? body.name : null;
        // Kept entries and fields travel as a preset of their own, read with the codec's rules.
        const kept = body.kept === undefined ? undefined : parseCcPreset(body.kept);
        return json(await host.preset(parsed, name, kept ? { entries: [...kept.values], unknownEntries: kept.unknownEntries, extra: kept.extra } : {}));
      }
      return json({ code: "invalid", error: "Unknown request." }, 400);
    } catch (error) {
      if (error instanceof CharacterRequestVersionError) return json({ code: "unsupported_version", error: "This page and the preview host are different versions.",
        request: CHARACTER_REQUEST_SCHEMA }, 409);
      if (error instanceof CreatorSetupError) return json({ code: "not_ready", error: error.message }, 409);
      if (error instanceof SyntaxError || (error as Error)?.message?.startsWith("Character request:") || (error as Error)?.message?.startsWith("This character preset"))
        return json({ code: "invalid", error: (error as Error).message }, 400);
      return json({ code: "failed", error: "XF Studio couldn't read your game's character-creator options." }, 500);
    }
  };
}

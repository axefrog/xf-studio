import type { BodyGender } from "./cc-catalogue";
import { type CreatorCatalogueHost, CreatorFailedError, CreatorSetupError } from "./cc-catalogue-service";
import { parseCcPreset } from "./cc-preset";
import { CHARACTER_REQUEST_SCHEMA, CharacterRequestVersionError, parseCharacterRequest } from "./character-detail-request";
import type { PrefetchAnswer, PrefetchInput } from "./choice-prefetch";
import { CREATOR_LIMITS, isCreatorName, isOptionId, isPresetName } from "./creator-names";
import { hostFailure } from "./diagnostics/host-log";
import { BodyTooLargeError, readBodyText } from "./request-body";

/**
 * Host endpoint for the Character panel's creator options (cc-catalogue-service.ts), shared by localhost and the desktop, mounted
 * behind the caller's own session checks like the character endpoint:
 * - `GET ?gender=female` → the catalogue's state and, once ready, the panel's first-paint projection (`xfs/cc-panel-3`);
 * - `GET ?gender=female&option=<part/name>&offset=<n>[&search=<text>]` → one page of that option's choices (the matching ones);
 * - `GET ?gender=female&search=<text>` → the options with a choice matching a search;
 * - `POST {kind:"view", request}` → the character context's view of a request (`xfs/character-request-4`);
 * - `POST {kind:"preset", request, name?, kept?}` → a portable `xfs/cc-preset-1` of the request's choices;
 * - `POST {kind:"retry", bodyGender}` → Try again after a failed build, answered as the state;
 * - `POST {kind:"legacy", bodyGender, style, definition}` → the creator choices an earlier build's tried piercing style stands for;
 * - `POST {kind:"prefetch", request, option, positions, focus?}` → prepare an open row's choices ahead and answer their states
 *   (`xfs/choice-prefetch-1`: one character per position; choice-prefetch.ts); `{kind:"prefetchStop"}` stops it (the row closed);
 * - `POST {kind:"prepared"}` → the prepared game files' size; `{kind:"clearPrepared"}` removes them (prepared-files.ts).
 * The launch route comes from the host's own settings, never the page. A request of a version this host doesn't read is refused with
 * `unsupported_version`, as on the character endpoint. A body is read within the shared byte limit, its declared length checked first
 * (PIPE-83). Every refusal has a code the page words for itself (UI-69).
 */
export const CREATOR_ENDPOINT = "/api/preview-character/creator";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const gender = (value: unknown): BodyGender | null => value === "female" || value === "male" ? value : null;

/** The host side of preparing choices ahead and of the prepared game files (character-detail-host.ts). */
export type PreparedHost = {
  prefetchRow(input: PrefetchInput): PrefetchAnswer;
  stopPrefetch(): void;
  preparedFiles(): Promise<{ bytes: number }>;
  clearPreparedFiles(): Promise<{ freed: number }>;
};
/** Most positions one prefetch question names (a page of choices). */
const MAX_PREFETCH_POSITIONS = 512;
const position = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 && (value as number) < 100_000;

export function createCreatorHandler(host: CreatorCatalogueHost, options: { trustedOrigin?: (request: Request) => boolean; refresh?: () => Promise<void>;
  prepared?: PreparedHost } = {}) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (url.hostname !== "127.0.0.1" || (origin && origin !== url.origin))
      return json({ code: "forbidden", error: "Use the local studio to read the creator options." }, 403);
    try {
      if (request.method === "GET") {
        const body = gender(url.searchParams.get("gender"));
        if (!body) return json({ code: "invalid", error: "Unknown body type." }, 400);
        const option = url.searchParams.get("option"), search = url.searchParams.get("search") ?? "";
        if (search.length > 200) return json({ code: "invalid", error: "The search is too long." }, 400);
        if (option === null) {
          if (search) return json(await host.search(body, search));
          await options.refresh?.();
          return json(host.state(body));
        }
        const offset = Number(url.searchParams.get("offset") ?? 0);
        if (!isOptionId(option) || !Number.isInteger(offset) || offset < 0) return json({ code: "invalid", error: "Unknown option." }, 400);
        const page = await host.page(body, option, offset, search);
        return page ? json(page) : json({ code: "missing_target", error: "That creator option isn't offered by the installed game and mods." }, 404);
      }
      if (request.method !== "POST") return json({ code: "method", error: "Method not allowed." }, 405);
      const trusted = options.trustedOrigin?.(request) ?? origin === url.origin;
      if (!trusted || request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
        return json({ code: "forbidden", error: "Use the local studio to read the creator options." }, 403);
      const body = JSON.parse(await readBodyText(request, CREATOR_LIMITS.requestBytes)) as
        { kind?: unknown; request?: unknown; name?: unknown; kept?: unknown; bodyGender?: unknown; style?: unknown; definition?: unknown;
          option?: unknown; positions?: unknown; focus?: unknown };
      const prepared = options.prepared;
      if (body?.kind === "prefetchStop" || body?.kind === "prepared" || body?.kind === "clearPrepared") {
        if (!prepared) return json({ code: "invalid", error: "Unknown request." }, 400);
        if (body.kind === "prefetchStop") { prepared.stopPrefetch(); return json({ stopped: true }); }
        if (body.kind === "prepared") return json({ bytes: (await prepared.preparedFiles()).bytes });
        try { return json(await prepared.clearPreparedFiles()); }
        catch (error) {
          hostFailure("character", "clear_prepared_failed", "The prepared game files couldn't be cleared.", error);
          return json({ code: "failed", error: "XF Studio couldn't clear its prepared game files. Close anything using them and try again." }, 500);
        }
      }
      if (body?.kind === "prefetch") {
        if (!prepared || !isOptionId(body.option) || !Array.isArray(body.positions) || body.positions.length > MAX_PREFETCH_POSITIONS ||
          !body.positions.every(position) || (body.focus !== undefined && body.focus !== null && !position(body.focus)))
          return json({ code: "invalid", error: "Unknown request." }, 400);
        return json(prepared.prefetchRow({ base: parseCharacterRequest(body.request), option: body.option, positions: body.positions as number[],
          focus: (body.focus as number | null | undefined) ?? null }));
      }
      if (body?.kind === "retry") {
        const which = gender(body.bodyGender);
        return which ? json(host.retry(which)) : json({ code: "invalid", error: "Unknown body type." }, 400);
      }
      if (body?.kind === "legacy") {
        const which = gender(body.bodyGender);
        if (!which || !isCreatorName(body.style) || !isCreatorName(body.definition)) return json({ code: "invalid", error: "Unknown request." }, 400);
        return json({ choices: await host.legacyChoices(which, body.style, body.definition) });
      }
      const parsed = parseCharacterRequest(body?.request);
      if (body.kind === "view") return json(await host.view(parsed));
      if (body.kind === "preset") {
        const name = isPresetName(body.name) ? body.name : null;
        // Kept entries and fields travel as a preset of their own, read with the codec's rules.
        const kept = body.kept === undefined ? undefined : parseCcPreset(body.kept);
        return json(await host.preset(parsed, name, kept ? { entries: [...kept.values], unknownEntries: kept.unknownEntries, extra: kept.extra } : {}));
      }
      return json({ code: "invalid", error: "Unknown request." }, 400);
    } catch (error) {
      if (error instanceof BodyTooLargeError) return json({ code: "too_large", error: "Request is too large." }, 413);
      if (error instanceof CharacterRequestVersionError) return json({ code: "unsupported_version", error: "This page and the preview host are different versions.",
        request: CHARACTER_REQUEST_SCHEMA }, 409);
      if (error instanceof CreatorSetupError) return json({ code: "not_ready", error: error.message }, 409);
      if (error instanceof CreatorFailedError) return json({ code: "failed", error: error.message }, 503);
      if (error instanceof SyntaxError || (error as Error)?.message?.startsWith("Character request:") || (error as Error)?.message?.startsWith("This character preset"))
        return json({ code: "invalid", error: (error as Error).message }, 400);
      return json({ code: "failed", error: "XF Studio couldn't read your game's character-creator options." }, 500);
    }
  };
}

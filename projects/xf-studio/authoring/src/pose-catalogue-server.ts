import type { PoseBodyGender } from "./pose-catalogue";
import { hostFailure } from "./diagnostics/host-log";
import { type PoseCatalogueHost, PoseSetupError } from "./pose-catalogue-host";
import { BodyTooLargeError, readBodyText } from "./request-body";

/**
 * Host endpoint for the photo-mode pose catalogue (pose-catalogue-host.ts), shared by localhost and the desktop, mounted behind the caller's
 * own session checks like the creator endpoint:
 * - `GET ?gender=female` → the catalogue's state and, once ready, the catalogue (`xfs/pose-catalogue-state-1`);
 * - `GET ?gender=female&pose=<record>` → that pose's clip sampled at its time on its rig (`xfs/pose-sample-1`), decoded on demand;
 * - `POST {kind:"retry", bodyGender}` → Try again after a failed build, answered as the state.
 * The launch route comes from the host's own settings, never the page. Every refusal has a code the page words for itself.
 */
export { POSES_ENDPOINT } from "./pose-endpoint";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const gender = (value: unknown): PoseBodyGender | null => value === "female" || value === "male" ? value : null;
/** A TweakDB record name as packs write them (letters, digits and `._-`; at most 512 characters, TweakXL's limit). */
export const isPoseId = (value: unknown): value is string => typeof value === "string" && value.length <= 512 && /^[A-Za-z0-9_.\-$#]+$/.test(value);
const REQUEST_BYTES = 4096;

export function createPoseHandler(host: Pick<PoseCatalogueHost, "state" | "sample" | "retry">, options: { trustedOrigin?: (request: Request) => boolean } = {}) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (url.hostname !== "127.0.0.1" || (origin && origin !== url.origin))
      return json({ code: "forbidden", error: "Use the local studio to read the poses." }, 403);
    try {
      if (request.method === "GET") {
        const body = gender(url.searchParams.get("gender"));
        if (!body) return json({ code: "invalid", error: "Unknown body type." }, 400);
        const pose = url.searchParams.get("pose");
        if (pose === null) return json(host.state(body));
        if (!isPoseId(pose)) return json({ code: "invalid", error: "Unknown pose." }, 400);
        const sample = await host.sample(body, pose);
        return sample ? json(sample) : json({ code: "missing_target", error: "That pose's animation isn't installed or can't be read." }, 404);
      }
      if (request.method !== "POST") return json({ code: "method", error: "Method not allowed." }, 405);
      const trusted = options.trustedOrigin?.(request) ?? origin === url.origin;
      if (!trusted || request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
        return json({ code: "forbidden", error: "Use the local studio to read the poses." }, 403);
      const body = JSON.parse(await readBodyText(request, REQUEST_BYTES)) as { kind?: unknown; bodyGender?: unknown };
      const which = gender(body?.bodyGender);
      if (body?.kind !== "retry" || !which) return json({ code: "invalid", error: "Unknown request." }, 400);
      return json(host.retry(which));
    } catch (error) {
      if (error instanceof SyntaxError) return json({ code: "invalid", error: "The request isn't valid JSON." }, 400);
      if (error instanceof BodyTooLargeError) return json({ code: "too_large", error: "The request is too large." }, 413);
      if (error instanceof PoseSetupError) return json({ code: "not_ready", error: error.message }, 409);
      hostFailure("poses", "pose_failed", "A photo-mode pose couldn't be read.", error, "warn");
      return json({ code: "failed", error: "XF Studio couldn't read your game's poses just now. Try again." }, 503);
    }
  };
}

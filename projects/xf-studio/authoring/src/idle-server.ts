import { hostFailure } from "./diagnostics/host-log";
import { type IdleHost, IdleSetupError } from "./idle-host";

/**
 * Host endpoint for the game's preview idles (idle-host.ts), shared by localhost and the desktop, mounted behind the caller's own session
 * checks like the pose endpoint:
 * - `GET` → the idles' state (`xfs/idle-state-1`), waiting until they are read from the game;
 * - `GET ?body=<idle id>` → that idle's body clip at every frame on its rig (`xfs/pose-sample-1`), decoded on demand;
 * - `GET ?face=<idle id>` → that idle's face motion (`xfs/face-motion-1`), solved on demand by XF Studio's own facial solver.
 * The launch route comes from the host's own settings, never the page. Every refusal has a code the page words for itself.
 */
export { IDLES_ENDPOINT } from "./idle-endpoint";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
/** An idle id as the catalogue writes them (idle-catalogue.ts). */
const isIdleId = (value: string) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(value);

export function createIdleHandler(host: Pick<IdleHost, "state" | "body" | "face">) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (url.hostname !== "127.0.0.1" || (origin && origin !== url.origin)) return json({ code: "forbidden", error: "Use the local studio to read the idles." }, 403);
    if (request.method !== "GET") return json({ code: "method", error: "Method not allowed." }, 405);
    try {
      const face = url.searchParams.get("face");
      if (face !== null) {
        if (!isIdleId(face)) return json({ code: "invalid", error: "Unknown idle." }, 400);
        const record = await host.face(face);
        return record ? json(record) : json({ code: "missing_target", error: "That idle's face couldn't be read from your game files." }, 404);
      }
      const body = url.searchParams.get("body");
      if (body === null) return json(await host.state());
      if (!isIdleId(body)) return json({ code: "invalid", error: "Unknown idle." }, 400);
      const sample = await host.body(body);
      return sample ? json(sample) : json({ code: "missing_target", error: "That idle's animation isn't in your game files." }, 404);
    } catch (error) {
      if (error instanceof IdleSetupError) return json({ code: "not_ready", error: error.message }, 409);
      hostFailure("preview", "idle_failed", "The character creator's idle couldn't be read from the game.", error, "warn");
      return json({ code: "failed", error: "XF Studio couldn't read that idle just now. Try again." }, 503);
    }
  };
}

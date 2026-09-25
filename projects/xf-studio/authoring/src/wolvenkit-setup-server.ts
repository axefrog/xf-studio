import type { WolvenKitSetupHost } from "./wolvenkit-setup-host";

/**
 * Host endpoint for WolvenKit setup. GET returns the read-only state; POST takes only
 * `{ action: "install", version }` (the user's consent to download exactly that release),
 * `{ action: "cancel" }` or `{ action: "recheck" }`. The browser never supplies a path or URL.
 * Callers mount it behind their own session checks (the desktop adds a token cookie).
 */
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const refuse = () => json({ code: "forbidden", error: "Use XF Studio on this computer to set up WolvenKit." }, 403);

export function createWolvenKitSetupHandler(host: WolvenKitSetupHost, options: { trustedOrigin?: (request: Request) => boolean } = {}) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (url.hostname !== "127.0.0.1" || (origin && origin !== url.origin)) return refuse();
    if (request.method === "GET") return json(host.snapshot());
    if (request.method !== "POST") return json({ code: "method", error: "Method not allowed." }, 405);
    const trusted = options.trustedOrigin?.(request) ?? origin === url.origin;
    if (!trusted || request.headers.get("Content-Type")?.split(";")[0] !== "application/json") return refuse();
    let body: Record<string, unknown>;
    try {
      const text = await request.text();
      if (text.length > 256) return json({ code: "too_large", error: "Request is too large." }, 413);
      body = JSON.parse(text);
    } catch { return json({ code: "invalid", error: "Invalid request." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ code: "invalid", error: "Invalid request." }, 400);
    const keys = Object.keys(body).sort().join(",");
    if (body.action === "install" && keys === "action,version" && typeof body.version === "string") {
      const state = host.install(body.version);
      return json(state, state.canCancel ? 202 : 409);
    }
    if (body.action === "cancel" && keys === "action") return json(host.cancel());
    if (body.action === "recheck" && keys === "action") return json(host.recheck());
    return json({ code: "invalid", error: "Choose install, cancel or recheck." }, 400);
  };
}

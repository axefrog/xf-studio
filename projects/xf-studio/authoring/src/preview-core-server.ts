import type { PreviewCoreHost } from "./preview-core-host";

/**
 * Host endpoint for the 3D preview preparation. GET returns the read-only state; POST takes
 * only `{ action: "prepare" | "cancel" | "rebuild" }` (rebuild prepares a damaged preview again). Paths come from the host's own settings, never the
 * browser. Callers mount it behind their own session checks (the desktop adds a token cookie).
 */
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export function createPreviewCoreHandler(host: PreviewCoreHost, options: { trustedOrigin?: (request: Request) => boolean } = {}) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (url.hostname !== "127.0.0.1" || (origin && origin !== url.origin))
      return json({ code: "forbidden", error: "Use the local studio to prepare the 3D preview." }, 403);
    if (request.method === "GET") return json(host.snapshot());
    if (request.method !== "POST") return json({ code: "method", error: "Method not allowed." }, 405);
    const trusted = options.trustedOrigin?.(request) ?? origin === url.origin;
    if (!trusted || request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
      return json({ code: "forbidden", error: "Use the local studio to prepare the 3D preview." }, 403);
    let body: unknown;
    try {
      const text = await request.text();
      if (text.length > 256) return json({ code: "too_large", error: "Request is too large." }, 413);
      body = JSON.parse(text);
    } catch { return json({ code: "invalid", error: "Invalid request." }, 400); }
    const action = (body as { action?: unknown })?.action;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).join() !== "action" ||
        (action !== "prepare" && action !== "cancel" && action !== "rebuild"))
      return json({ code: "invalid", error: "Choose prepare, rebuild or cancel." }, 400);
    const state = action === "prepare" ? host.prepare() : action === "rebuild" ? host.rebuild() : host.cancel();
    return json(state, action !== "cancel" && !state.canCancel && state.phase !== "ready" ? 409 : 200);
  };
}

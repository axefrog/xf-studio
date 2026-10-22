import type { PreviewCoreHost } from "./preview-core-host";
import { CORE_BODIES, type CoreBody } from "../preview-core-recipe";

/**
 * Host endpoint for the 3D preview preparation. GET returns the read-only state (`?body=male` for the masculine V's core);
 * POST takes only `{ action: "prepare" | "cancel" | "rebuild", body?: "female" | "male", lease?: string }` or
 * `{ action: "withdraw", body?, lease }` (rebuild prepares a damaged preview again; the body defaults to the feminine core). A `lease` names
 * one requester asking on demand: a preparation held by leases stops when the last one withdraws (`PreviewCoreHost.withdraw`). Paths come from the host's own settings, never the browser.
 * Callers mount it behind their own session checks (the desktop adds a token cookie).
 */
const isBody = (value: unknown): value is CoreBody => (CORE_BODIES as readonly unknown[]).includes(value);
/** A requester's lease: a random ID the page makes per request (`crypto.randomUUID`). */
const isLease = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9-]{8,64}$/.test(value);
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export function createPreviewCoreHandler(host: PreviewCoreHost, options: { trustedOrigin?: (request: Request) => boolean } = {}) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (url.hostname !== "127.0.0.1" || (origin && origin !== url.origin))
      return json({ code: "forbidden", error: "Use the local studio to prepare the 3D view." }, 403);
    if (request.method === "GET") {
      const body = url.searchParams.get("body") ?? "female";
      if (!isBody(body)) return json({ code: "invalid", error: "Choose the female or male head." }, 400);
      return json(host.snapshot(body));
    }
    if (request.method !== "POST") return json({ code: "method", error: "Method not allowed." }, 405);
    const trusted = options.trustedOrigin?.(request) ?? origin === url.origin;
    if (!trusted || request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
      return json({ code: "forbidden", error: "Use the local studio to prepare the 3D view." }, 403);
    let body: unknown;
    try {
      const text = await request.text();
      if (text.length > 256) return json({ code: "too_large", error: "Request is too large." }, 413);
      body = JSON.parse(text);
    } catch { return json({ code: "invalid", error: "Invalid request." }, 400); }
    const action = (body as { action?: unknown })?.action, which = (body as { body?: unknown })?.body ?? "female";
    const lease = (body as { lease?: unknown })?.lease;
    const keys = body && typeof body === "object" ? Object.keys(body) : [];
    if (!body || typeof body !== "object" || Array.isArray(body) || !keys.includes("action") || keys.some(key => key !== "action" && key !== "body" && key !== "lease") ||
        !isBody(which) || (lease !== undefined && !isLease(lease)) || (action === "withdraw" ? lease === undefined
          : (action !== "prepare" && action !== "cancel" && action !== "rebuild") || (lease !== undefined && action !== "prepare")))
      return json({ code: "invalid", error: "Choose prepare, rebuild or cancel." }, 400);
    const state = action === "prepare" ? host.prepare(which, lease as string | undefined) : action === "rebuild" ? host.rebuild(which)
      : action === "withdraw" ? host.withdraw(which, lease as string) : host.cancel(which);
    return json(state, action !== "cancel" && action !== "withdraw" && !state.canCancel && state.phase !== "ready" ? 409 : 200);
  };
}

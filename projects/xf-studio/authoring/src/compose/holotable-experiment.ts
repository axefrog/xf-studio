/**
 * The Holotable experiment's loader: the only entry point the generic experiment loader imports, and only while opted in. It builds the
 * browser device (the host's `/api/holotable`, or its verification twin) and registers the module, its facade and its view. The view is
 * an SVG panel for now, so the renderer on the character scene draws nothing (research/live-world-view/proposal.md §4).
 */
import { featureId } from "../platform/api";
import type { ExperimentContext } from "../platform/api/experiment-context";
import { createHolotable, holotableFacade, HOLOTABLE_MODULE, type HoloTransport } from "../features/holotable";
import { HOLOTABLE_VIEW, HOLOTABLE_VIEW_BINDING } from "../features/holotable/view";

export function holotableTransport(verification: boolean, send: typeof fetch = fetch): HoloTransport {
  const url = `${verification ? "/api/verification" : "/api"}/holotable`;
  return async (method, params, signal) => {
    const response = await send(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, params }), signal });
    let data: unknown = null; try { data = await response.json(); } catch { /* an empty or non-JSON answer: the status says it */ }
    return { ok: response.ok, status: response.status, data };
  };
}

export async function create(context: ExperimentContext, options: { verification: boolean }) {
  const service = createHolotable({ transport: holotableTransport(options.verification) }, context.signal);
  return {
    module: HOLOTABLE_MODULE, service: holotableFacade(service),
    renderer: { feature: featureId("holotable"), create: () => ({ dispose() {} }) },
    visibility(shown: boolean) { if (shown) service.shown(); else service.withdraw(); },
    contribution: HOLOTABLE_VIEW, binding: HOLOTABLE_VIEW_BINDING,
  };
}

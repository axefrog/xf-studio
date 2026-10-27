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
  const stored = (await context.loadDocuments<{ schema: string; playback: { recording: number; game: number } }>("holotable-view-state", context.signal)).find(d => d.id === "playback");
  const document = stored ?? context.document("holotable-view-state", "playback", { schema: "xfh/view-state-1", playback: { recording: 4, game: 600 } });
  const service = createHolotable({ transport: holotableTransport(options.verification), playback: document.value?.playback,
    rememberPlayback: playback => { void document.save({ schema: "xfh/view-state-1", playback }).catch(() => {}); } }, context.signal);
  return {
    module: HOLOTABLE_MODULE, service: holotableFacade(service),
    renderer: { feature: featureId("holotable"), create: () => ({ dispose() {} }) },
    visibility(shown: boolean) { if (shown) service.shown(); else service.withdraw(); },
    contribution: HOLOTABLE_VIEW, binding: HOLOTABLE_VIEW_BINDING,
  };
}

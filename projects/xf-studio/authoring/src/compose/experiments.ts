import { startExperiments, experimentOverrides } from "../platform/core/experiments";
import { hostClock, hostRandom } from "../platform/graph-adapters/host-sources";
import { HostGraphStore } from "../platform/graph-adapters/browser-graph-store";
/** Browser composition/source adapter: no feature import until its experiment is enabled. */
export function browserExperiments(query: string, send: typeof fetch, signal: AbortSignal, verification: boolean) {
  const params = new URLSearchParams(query);
  const definitions = [{ id: "hair-lab", label: "Hair Lab", description: "Try a generated hairstyle on V. Early preview; saved looks stay separate.",
    load: async () => { const feature = await import("./hair-lab-experiment"); return { create: (context: import("../platform/api/graph").ExperimentContext) => feature.create(context, { shape: verification ? params.get("hairShape") ?? "face-frame" : "face-frame" }) }; } }];
  return startExperiments({ definitions, overrides: experimentOverrides(query, definitions.map(info => info.id), verification), signal,
    store: new HostGraphStore(`${verification ? "/api/verification" : "/api"}/graph/store`, send), sources: { clock: hostClock(), random: hostRandom() } });
}

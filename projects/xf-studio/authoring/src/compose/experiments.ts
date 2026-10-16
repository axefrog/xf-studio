import { createExperiments, experimentOverrides } from "../platform/core/experiments";
import { hostClock, hostRandom } from "../platform/graph-adapters/host-sources";
import { HostGraphStore } from "../platform/graph-adapters/browser-graph-store";
/** Browser composition/source adapter: no feature import until its experiment is enabled. */
export function browserExperiments(query: string, send: typeof fetch, signal: AbortSignal) {
  const definitions = [{ id: "hair-lab", label: "Hair Lab", description: "Try a generated hairstyle on V. Early preview; saved looks stay separate.",
    load: async () => import("./hair-lab-experiment") }];
  const verification = new URLSearchParams(query).get("verify") === "1";
  return createExperiments({ definitions, overrides: experimentOverrides(query, definitions.map(info => info.id)), signal,
    store: new HostGraphStore(`${verification ? "/api/verification" : "/api"}/graph/store`, send), sources: { clock: hostClock(), random: hostRandom() } });
}

import { startExperiments, experimentOverrides } from "../platform/core/experiments";
import type { ExperimentContext } from "../platform/api/experiments";
import { hostRandom } from "../platform/core/random";
import { browserDocuments } from "../browser-documents-device";
/** Browser composition: no feature import until its experiment is enabled. */
export function browserExperiments(query: string, send: typeof fetch, signal: AbortSignal, verification: boolean) {
  const params = new URLSearchParams(query);
  const definitions = [{ id: "hair-lab", label: "Hair Lab", description: "Try a generated hairstyle on V. Early preview; saved looks stay separate.",
    load: async () => { const feature = await import("./hair-lab-experiment"); return { create: (context: ExperimentContext) => feature.create(context, { shape: verification ? params.get("hairShape") ?? "face-frame" : "face-frame" }) }; } }];
  return startExperiments({ definitions, overrides: experimentOverrides(query, definitions.map(info => info.id), verification), signal,
    documents: browserDocuments(`${verification ? "/api/verification" : "/api"}/documents`, (url, init) => send(url, init)),
    random: hostRandom() });
}

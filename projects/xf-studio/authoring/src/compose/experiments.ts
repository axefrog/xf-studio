import { startExperiments, experimentOverrides, type ExperimentDefinition } from "../platform/core/experiments";
import { hostRandom } from "../platform/core/random";
import { pageFailure } from "../diagnostics/page-sink";
import type { StartedOutbox } from "../app/browser/document-outbox-device";
import type { ExperimentRegistration } from "../platform/api/experiments";
import type { ViewContribution } from "../studio-ui/views/contribution";
import type { ModuleViewBinding } from "../studio-ui/views/feature-view";
/** Browser composition: no feature import until its experiment is enabled. */
export function browserExperiments(query: string, signal: AbortSignal, verification: boolean,
  /** The page's outbox and the library's documents behind it (`app/browser/document-outbox-device.ts`). */
  documents: StartedOutbox) {
  const definitions: ExperimentDefinition<ExperimentRegistration & { contribution: ViewContribution; binding: ModuleViewBinding }>[] = [
    { id: "holotable", label: "Holotable", description: "Replay a recorded game session over a wireframe of Night City. Early access.",
      load: async () => { const feature = await import("./holotable-experiment"); return { create: context => feature.create(context, { verification }) }; } },
  ];
  return startExperiments({ definitions, overrides: experimentOverrides(query, definitions.map(info => info.id), verification), signal,
    documents: documents.documents, outbox: documents.outbox, random: hostRandom(),
    report: error => pageFailure("experiments", "experiment_listener_failed", "An experimental feature couldn't update.", error, { level: "warn" }) });
}

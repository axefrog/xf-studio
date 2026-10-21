import { startExperiments, experimentOverrides, type ExperimentDefinition } from "../platform/core/experiments";
import { hostRandom } from "../platform/core/random";
import type { StartedOutbox } from "../app/browser/document-outbox-device";
import type { ExperimentRegistration } from "../platform/api/experiments";
import type { ViewContribution } from "../studio-ui/views/contribution";
import type { ModuleViewBinding } from "../studio-ui/views/feature-view";
/** Browser composition: no feature import until its experiment is enabled. No experiment is offered at the moment. */
export function browserExperiments(query: string, signal: AbortSignal, verification: boolean,
  /** The page's outbox and the library's documents behind it (`app/browser/document-outbox-device.ts`). */
  documents: StartedOutbox) {
  const definitions: ExperimentDefinition<ExperimentRegistration & { contribution: ViewContribution; binding: ModuleViewBinding }>[] = [];
  return startExperiments({ definitions, overrides: experimentOverrides(query, definitions.map(info => info.id), verification), signal,
    documents: documents.documents, outbox: documents.outbox, random: hostRandom() });
}

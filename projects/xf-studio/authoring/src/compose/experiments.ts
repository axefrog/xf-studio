import { startExperiments, experimentOverrides, type ExperimentDefinition } from "../platform/core/experiments";
import { hostRandom } from "../platform/core/random";
import { browserDocuments } from "../browser-documents-device";
import type { ExperimentRegistration } from "../platform/api/experiments";
import type { ViewContribution } from "../studio-ui/views/contribution";
import type { ModuleViewBinding } from "../studio-ui/views/feature-view";
/** Browser composition: no feature import until its experiment is enabled. No experiment is offered at the moment. */
export function browserExperiments(query: string, send: typeof fetch, signal: AbortSignal, verification: boolean) {
  const definitions: ExperimentDefinition<ExperimentRegistration & { contribution: ViewContribution; binding: ModuleViewBinding }>[] = [];
  return startExperiments({ definitions, overrides: experimentOverrides(query, definitions.map(info => info.id), verification), signal,
    documents: browserDocuments(`${verification ? "/api/verification" : "/api"}/documents`, (url, init) => send(url, init)),
    random: hostRandom() });
}

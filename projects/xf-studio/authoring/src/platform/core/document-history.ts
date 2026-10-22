import type { DocumentHistory } from "../api/history";
import { createHistoryService } from "./history-service";

/**
 * A document history on its own (`DocumentHistory`): the `doc:*` scopes of a history service of its own. The session's is the
 * shared history service's `documents`, which the experiments platform hands its experiments.
 */
export function createDocumentHistory(): DocumentHistory { return createHistoryService().documents; }

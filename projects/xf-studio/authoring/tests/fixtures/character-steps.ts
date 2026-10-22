/**
 * A V's history home in a history service of its own, stepped as `history.undo` and `history.redo` naming its scope (`character:<id>`)
 * step it: the Character panel's Undo and Redo (profiles design §3.7).
 */
import type { Capability } from "../../src/platform/api/capability";
import { characterScope, type CharacterHistoryHome } from "../../src/character/character-history";
import { createHistoryService, type HistoryService } from "../../src/platform/core/history-service";

export function vHistory(id = "v", service: HistoryService = createHistoryService()) {
  const home: CharacterHistoryHome = { service, id };
  const capability = (kind: "history.undo" | "history.redo"): Capability =>
    service.acting([characterScope(id)])?.capability({ kind }) ?? { available: false, code: "unavailable", reason: "No history." };
  const move = (kind: "history.undo" | "history.redo") => capability(kind).available && !!service.acting([characterScope(id)])?.command({ kind });
  return { home, scope: characterScope(id), capability, undo: () => move("history.undo"), redo: () => move("history.redo") };
}

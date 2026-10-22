import type { ModuleService, StudioModule } from "./module";
import type { FeatureRendererFactory } from "./scene";
import type { DocumentHistory, HistoryParticipant } from "./history";
export type { ExperimentContext } from "./experiment-context";

/** A session override is never written to the stored preference. */
export type ExperimentInfo = { id: string; label: string; description: string };
export type ExperimentState = ExperimentInfo & { enabled: boolean; overridden: boolean; phase: "off" | "loading" | "ready" | "failed"; message: string };
export type ExperimentRegistration = { module: StudioModule; service: ModuleService; renderer: FeatureRendererFactory; visibility?(shown: boolean): void; histories?(): readonly HistoryParticipant[]; actionHints?(): Readonly<Record<string, string>> };
export type ExperimentPort = {
  readonly history?: DocumentHistory;
  snapshot(): readonly ExperimentState[];
  set(id: string, enabled: boolean): Promise<{ ok: boolean; message?: string }>;
  registrations(): readonly ExperimentRegistration[];
  subscribe(listener: () => void): () => void;
};

/** The experimental-features preference: one document in the document store. */
export const EXPERIMENT_FLAGS = Object.freeze({ kind: "experiment-flags", id: "preferences", schema: "xfs/experiment-flags-1" });
export type ExperimentFlagsDocument = { schema: typeof EXPERIMENT_FLAGS.schema; flags: Record<string, boolean> };

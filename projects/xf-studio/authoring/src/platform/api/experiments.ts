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
  /** Any change: settings, loading phases, the experiments' services and history. */
  subscribe(listener: () => void): () => void;
  /**
   * Moves exactly when the set of enabled registrations changes (an experiment finished loading, or was switched off), at the point the
   * change is made, and never for anything else. What is built from the registrations (default layouts, their knowledge) keys on it.
   */
  registrationGeneration(): number;
  /** Called once per registration-set change, after the generation has moved and before `subscribe`'s listeners hear of it. */
  onRegistrationsChanged(listener: () => void): () => void;
  /** True once every experiment document this page holds is stored, unsaved ones written again first (a workspace handover waits on it). */
  settle?(): Promise<boolean>;
};

/** The experimental-features preference: one document in the document store. */
export const EXPERIMENT_FLAGS = Object.freeze({ kind: "experiment-flags", id: "preferences", schema: "xfs/experiment-flags-1" });
export type ExperimentFlagsDocument = { schema: typeof EXPERIMENT_FLAGS.schema; flags: Record<string, boolean> };

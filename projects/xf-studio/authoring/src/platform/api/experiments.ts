import type { ModuleService, StudioModule } from "./module";
import type { FeatureRendererFactory } from "./scene";
/** A session override is never written to the preference stream. */
export type ExperimentInfo = { id: string; label: string; description: string };
export type ExperimentState = ExperimentInfo & { enabled: boolean; overridden: boolean; phase: "off" | "loading" | "ready" | "failed"; message: string };
export type ExperimentRegistration = { module: StudioModule; service: ModuleService; renderer: FeatureRendererFactory; visibility?(shown: boolean): void };
export type ExperimentPort = {
  snapshot(): readonly ExperimentState[];
  set(id: string, enabled: boolean): Promise<{ ok: boolean; message?: string }>;
  registrations(): readonly ExperimentRegistration[];
  subscribe(listener: () => void): () => void;
};

import type { Registry, AnyOwner } from "../../platform/core/registry";
import type { WorkspaceState } from "../workspace/workspace-state";
import type { DocumentStorePort } from "../../platform/api/document-store";
import type { DocumentOutbox } from "../../platform/core/document-outbox";
import type { ShapeStarters } from "./shape-starters";
import type { StarterActions } from "./starter-actions";
import type { DocumentModel } from "../workspace/collection-workspace";

export type FeatureStarters = { shapes: ShapeStarters; actions: StarterActions; part(): unknown };
export type StarterContribution = { create(options: { workspace: WorkspaceState; documents: DocumentStorePort; outbox: DocumentOutbox;
  writable(): boolean; note(text: string): void; report(error: unknown): void }): FeatureStarters };

/** The primary feature may contribute starters. The existing registry remains the only catalogue. */
export function registeredStarters(registry: Registry<AnyOwner>, model: DocumentModel): StarterContribution | undefined {
  const feature = model.live;
  return feature ? (registry.owner(feature) as (AnyOwner & { starters?: StarterContribution }) | undefined)?.starters : undefined;
}

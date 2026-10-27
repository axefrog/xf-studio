/** Application adapters contributed on the existing feature registration, never in a second catalogue. */
import type { ActionHandler, FeatureModule } from "../platform/api";
import type { Registry, AnyOwner } from "../platform/core/registry";
import type { StudioApplication, StudioApplicationServices } from "./studio-application";
import type { FeatureFacade, EyeMakeupView } from "./studio-presentation";
import type { LookRef } from "../library/collection-documents";

/** Captured input stays owned by the presentation port; a contributed facade cannot retarget a run. */
export type FeatureFacadeHost = {
  readonly application: StudioApplication;
  /** Transitional concrete projection; its remaining users migrate with the editor/control slices. */
  readonly editor: EyeMakeupView;
  begin(id: string): { look?: LookRef };
  run(id: string): StudioApplication;
  name<A extends { kind: string }>(id: string, action: A): A;
  end(id: string): void;
};
export type FeatureApplication = {
  bind?(services: () => StudioApplicationServices, registry: () => Registry<AnyOwner>, recorded: (action: { kind: string }) => boolean): ActionHandler<{ kind: string }>;
  facade?(base: FeatureFacade, host: FeatureFacadeHost): FeatureFacade & { view(): unknown };
};
export type ApplicationFeature = FeatureModule & { readonly application?: FeatureApplication };
/** Composition supplies trusted typed contributions on its feature owners. */
export function featureApplication(owner: AnyOwner | undefined): FeatureApplication | undefined {
  return owner?.owner === "feature" ? (owner as ApplicationFeature).application : undefined;
}

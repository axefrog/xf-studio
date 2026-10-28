/** File projections are contributed on the existing action owner. The core carries their values opaquely. */
import type { AuthoringDocument } from "./authoring/authoring-document";
import type { StudioApplication } from "./studio-application";
import type { AnyOwner, Registry } from "../platform/core/registry";

export type FeatureFileOperations = {
  portable?: {
    readonly name: string;
    readonly invalidMessage: string;
    readonly message: string;
    parse(value: unknown): unknown | undefined;
    serialize(): unknown;
    load(value: unknown, name: string, collection: string): void;
  };
  mask?: {
    /** Captured before awaiting the baker; no live layer or document escapes the operation. */
    capture(): { value: unknown; name: string } | undefined;
    readonly message: string;
    readonly unavailable: string;
  };
};
export type FeatureFilesHost = { readonly document: Pick<AuthoringDocument, "features">;
  readonly application: Pick<StudioApplication, "dispatch">; readonly signal: AbortSignal; imported(): void };
export type FeatureFiles = { create(host: FeatureFilesHost): FeatureFileOperations };
export function registeredFeatureFiles(registry: Registry<AnyOwner>, feature: string | undefined, host: FeatureFilesHost): FeatureFileOperations | undefined {
  const owner = feature === undefined ? undefined : registry.owner(feature);
  return owner?.owner === "feature" ? (owner as typeof owner & { files?: FeatureFiles }).files?.create(host) : undefined;
}

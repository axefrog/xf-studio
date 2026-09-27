/**
 * What the Poses module reads, in its own terms (the feature rule: a module's core imports only its folder and `platform/api`). These are
 * structural subsets of the host's records (src/pose-catalogue.ts `PoseCatalogue`, `PoseCatalogueState`; src/pose-sample.ts), which the
 * host answers as JSON and the composition root hands over; a sampled pose passes through this module unread, to the motion service.
 */
export type PoseBodyGender = "female" | "male";
export type PoseBadge = "holds" | "vehicle" | "moves";
export type PoseSource = { readonly declaredBy: string | null };
export interface PoseItem {
  /** The TweakDB record name: the stable key (favourites, recent, workspace). */
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly clip: { readonly name: string; readonly decodable: boolean } | null;
  readonly placement: { readonly offset: readonly [number, number, number]; readonly rotation: readonly [number, number, number] };
  readonly badges: readonly PoseBadge[];
  readonly hiddenForGarmentTags: readonly string[];
  readonly source: PoseSource;
}
export interface PoseCategoryItem { readonly id: string; readonly label: string; readonly source: PoseSource }
export interface PoseListing {
  readonly categories: readonly PoseCategoryItem[];
  readonly entries: readonly PoseItem[];
  readonly counts: { readonly listed: number; readonly categories: number };
}
export type PoseListingState =
  | { readonly schema: "xfs/pose-catalogue-state-1"; readonly phase: "needs-setup" | "preparing" | "failed"; readonly message: string }
  | { readonly schema: "xfs/pose-catalogue-state-1"; readonly phase: "ready"; readonly message: string; readonly catalogue: PoseListing };
/** A sampled pose as the host answers it (`xfs/pose-sample-1`): opaque here. */
export type PoseSampleData = { readonly schema: "xfs/pose-sample-1"; readonly id: string };
/** The host's pose endpoint (`/api/poses`, the same transport `PoseActions` uses). */
export type PoseCatalogueTransport = (request: { method: "GET"; query: Record<string, string> } | { method: "POST"; body: { kind: "retry"; bodyGender: PoseBodyGender } }) =>
  Promise<{ ok: boolean; status: number; data: unknown }>;
/** The pose V holds, as the motion service shows it. */
export type HeldPose = { readonly id: string; readonly label: string; readonly moves: boolean };
export type PosePlacementData = { readonly offset: readonly [number, number, number]; readonly rotation: readonly [number, number, number] };

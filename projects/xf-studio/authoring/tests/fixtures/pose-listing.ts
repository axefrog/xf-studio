/** A small pose catalogue for the Poses module tests: a vanilla category and a pack category with a moving pose and one without its clip. */
import type { PoseListing } from "../../src/features/poses/types";

const entry = (id: string, label: string, category: string, extra: Record<string, unknown> = {}) => ({ id, label, category,
  clip: { name: `${id.split(".").pop()}_clip`, decodable: true }, placement: { offset: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] },
  badges: [], hiddenForGarmentTags: [], source: { declaredBy: null }, ...extra });
export const CATALOGUE: PoseListing = {
  categories: [{ id: "idleCategory", label: "Idle", source: { declaredBy: null } }, { id: "PhotoModePoseCategories.sera", label: "bv_serene_f", source: { declaredBy: "Serene Poses" } }],
  entries: [
    entry("PhotoModePoses.idle_stand_01", "Standing", "idleCategory", { hiddenForGarmentTags: ["Coat"] }),
    entry("PhotoModePoses.idle_lean", "Léaning", "idleCategory", { badges: ["holds"] }),
    entry("PhotoModePoses.sera_01", "01", "PhotoModePoseCategories.sera", { source: { declaredBy: "Serene Poses" }, badges: ["moves"] }),
    entry("PhotoModePoses.sera_02", "02", "PhotoModePoseCategories.sera", { source: { declaredBy: "Serene Poses" }, clip: null }),
  ],
  counts: { listed: 4, categories: 2 },
};

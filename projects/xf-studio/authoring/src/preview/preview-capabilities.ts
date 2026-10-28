/** Preview preparation is contributed by the same feature owner as its actions and editors. */
import type { Registry, AnyOwner } from "../platform/core/registry";
import type { CoreBody } from "../character/render-detail";
import type { EyePlateRecipe } from "../legacy/eye-makeup/plate/eye-plate-recipe";

export type PreviewPreparation = { readonly plate: Readonly<Record<CoreBody, EyePlateRecipe>> };
export function registeredPreviewPreparation(registry: Pick<Registry<AnyOwner>, "owners"> | undefined, body: CoreBody): EyePlateRecipe | undefined {
  const contributions = registry?.owners().flatMap(owner => owner.owner === "feature"
    ? (owner as typeof owner & { previewPreparation?: PreviewPreparation }).previewPreparation ?? [] : []) ?? [];
  if (contributions.length > 1) throw Error("Only one feature can prepare the core head's plate.");
  return contributions[0]?.plate[body];
}

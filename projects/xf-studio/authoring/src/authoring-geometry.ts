import type { AuthoringDocument } from "./authoring-document";
import type { ReadonlyDeep } from "./read-only";
import type { Layer, Point, Recipe, WarpField } from "./engines/layered-makeup/recipe";

/**
 * Detached geometry for presentation hit testing and drawing. A recipe replacement
 * creates a new context; an in-place gesture updates only its changed layer while
 * retaining point, field and array identities used by captured pointer gestures.
 * Reads on animation frames neither clone nor touch the mutable document recipe.
 */
export class AuthoringGeometry {
  private source?: Recipe;
  private detached?: Recipe;
  private revision = -1;
  constructor(private readonly document: AuthoringDocument) {}

  private refresh() {
    const source = this.document.recipe, version = this.document.geometryVersion;
    if (source !== this.source || !this.detached) {
      this.source = source;
      this.detached = structuredClone(source);
      this.revision = version.revision;
    } else if (version.revision !== this.revision) {
      const index = version.layerIndex;
      if (index === undefined || version.revision !== this.revision + 1 ||
        !source.layers[index] || source.layers.length !== this.detached.layers.length ||
        source.layers.some((layer, i) => layer.id !== this.detached!.layers[i].id)) {
        // This is a structural in-place change outside the normal recipe action
        // path. Invalidate the captured gesture context conservatively.
        this.detached = structuredClone(source);
      } else {
        syncLayer(this.detached.layers[index], source.layers[index], version.gestureKind === "path.replacePoints");
      }
      this.revision = version.revision;
    }
    return this.detached;
  }

  recipe(): Recipe { return this.refresh(); }
  layer(): Layer | undefined { return this.refresh().layers[this.document.active]; }
  /** UI-facing aliases expose only read operations at the TypeScript boundary. */
  readonlyRecipe(): ReadonlyDeep<Recipe> { return this.refresh(); }
  readonlyLayer(): ReadonlyDeep<Layer> | undefined { return this.refresh().layers[this.document.active]; }
}

function syncLayer(target: Layer, source: Layer, replacePoints: boolean) {
  const next = structuredClone(source), points = target.points, fields = target.fields;
  const oldPoints = [...points], oldFields = new Map(fields.map(field => [field.id, field]));
  Object.assign(target, next);
  if (!replacePoints && points.length === next.points.length) points.splice(0, points.length, ...next.points.map((point, index) =>
    syncItem(oldPoints[index], point)));
  fields.splice(0, fields.length, ...next.fields.map(field =>
    syncItem(oldFields.get(field.id), field)));
  target.points = !replacePoints && points.length === next.points.length ? points : next.points;
  target.fields = fields;
}

function syncItem<T extends Point | WarpField>(prior: T | undefined, next: T): T {
  if (!prior) return next;
  // A point may gain/lose optional handles or feather while a gesture is active.
  for (const key of Object.keys(prior) as (keyof T)[]) if (!(key in next)) delete prior[key];
  Object.assign(prior, next);
  return prior;
}

import type { AuthoringDocument, DocumentChange } from "./authoring-document";
import type { AuthoringGeometry } from "./authoring-geometry";
import type { Layer, Recipe, WarpField } from "./engines/layered-makeup/recipe";
import type { ReadonlyDeep } from "./read-only";

/**
 * Narrow read port for controls and composition views. It never returns the
 * document's live recipe or selection map. Coordinate adapters may use the
 * underlying detached geometry view to preserve captured gesture identity.
 */
export class AuthoringPresentation {
  constructor(private readonly document: AuthoringDocument,
    private readonly geometry: AuthoringGeometry) {}
  recipe(): ReadonlyDeep<Recipe> { return this.geometry.readonlyRecipe(); }
  layer(): ReadonlyDeep<Layer> | undefined { return this.geometry.readonlyLayer(); }
  get active() { return this.document.active; }
  get selected() { return this.document.selected; }
  /** Increments with every published geometry change, including in-place gesture updates. */
  get revision() { return this.document.geometryVersion.revision; }
  get canUndo() { return this.document.canUndo; }
  selectedField(): ReadonlyDeep<WarpField> | undefined {
    const layer = this.layer();
    if (!layer) return;
    const id = this.document.fieldSelection[layer.id];
    return layer.fields.find(field => field.id === id) ?? layer.fields[0];
  }
  subscribe(listener: (change: DocumentChange) => void) { return this.document.subscribe(listener); }
}

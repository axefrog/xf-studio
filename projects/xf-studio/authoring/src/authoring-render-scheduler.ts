import type { AuthoringDocument, DocumentEffect } from "./authoring-document";
import { layerRenderQueue } from "./layer-render-queue";
import type { Layer } from "./recipe";

export type AuthoringRenderPort = {
  frame(run: () => void): void;
  render(layerIndex: number): void;
  refreshSelection(): void;
};

/** Maps document change intent to layer-specific rendering without owning DOM or raster resources. */
export class AuthoringRenderScheduler {
  private queue: (layer: Layer | undefined) => void;
  private unsubscribe: () => void;
  constructor(private document: AuthoringDocument, private port: AuthoringRenderPort) {
    this.queue = layerRenderQueue(() => document.recipe.layers, port.frame, port.render);
    this.unsubscribe = document.subscribeEffects(effect => this.handle(effect));
  }
  private handle(effect: DocumentEffect) {
    if (effect.kind === "selection") { this.port.refreshSelection(); return; }
    if (effect.kind === "gesture") { this.queue(this.document.recipe.layers[effect.layerIndex]); return; }
    if (effect.kind === "immediate" || effect.layerIndex !== this.document.active) {
      this.port.render(effect.layerIndex); return;
    }
    this.queue(this.document.recipe.layers[effect.layerIndex]);
    this.port.refreshSelection();
  }
  renderAll(order: "stack" | "active-first" = "active-first") {
    const indices = this.document.recipe.layers.map((_, index) => index);
    if (order === "active-first" && indices.includes(this.document.active)) {
      indices.splice(this.document.active, 1);
      indices.unshift(this.document.active);
    }
    for (const index of indices) this.port.render(index);
  }
  dispose() { this.unsubscribe(); }
}

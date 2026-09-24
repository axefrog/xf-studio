import type { AuthoringDocument } from "./authoring-document";
import { planLayerPreview } from "./authoring-preview-policy";
import { assessPreviewQuality, type PreviewTextureSize } from "./preview-quality";
import { PreviewQualityActions } from "./preview-quality-actions";
import type { Layer } from "./recipe";
import type { RasterResponse } from "./raster-processor";

export type CompleteRaster = Extract<RasterResponse, { data: unknown }>;

/** Device resources stay behind this port; it has no DOM, Three or worker types. */
export type PreviewRenderPort = {
  maxTextureSize(): number;
  resourceSize(index: number): number;
  needsOptics(index: number, layer: Layer, size: PreviewTextureSize): boolean;
  needsPresentationMaps(index: number, layer: Layer, size: PreviewTextureSize): boolean;
  queue(): { queued: number; running: unknown };
  reset(): void;
  replaceResources(): void;
  releaseDisabled(index: number, layer: Layer): void;
  request(index: number, layer: Layer, priority: boolean, size: number, needsOptics: boolean): void;
  updateLayer(index: number, layer: Layer): void;
  publish(result: CompleteRaster, layer: Layer): void;
  renderAll(order?: "stack" | "active-first"): void;
  refresh(): void;
  refreshQuality(): void;
  report(message: string): void;
};

/** Owns preview decisions while the adapter owns actual resource lifetimes. */
export class AuthoringPreviewCoordinator {
  readonly quality: PreviewQualityActions;
  private lastRaster = 0;
  constructor(private document: AuthoringDocument, initialSize: PreviewTextureSize,
    private port: PreviewRenderPort) {
    this.quality = new PreviewQualityActions(initialSize, {
      assess: size => this.assess(size),
      replace: () => {
        this.port.reset();
        this.port.replaceResources();
        this.port.renderAll();
      },
    });
  }
  get size() { return this.quality.snapshot().size; }
  get lastRasterMs() { return this.lastRaster; }
  assess(size: PreviewTextureSize = this.size) {
    return assessPreviewQuality(this.document.recipe, size, this.port.maxTextureSize());
  }
  describeQuality() {
    const error = this.quality.snapshot().error;
    if (error) return error;
    const assessment = this.assess();
    if (!assessment.accepted) return assessment.error!;
    const queue = this.port.queue();
    const pending = queue.queued + (queue.running ? 1 : 0);
    const waiting = this.document.recipe.layers.some((layer, index) => layer.enabled &&
      (this.port.resourceSize(index) !== this.size ||
        this.port.needsPresentationMaps(index, layer, this.size)));
    return `${pending || waiting ? "Updating" : "Ready"} · ${this.size} × ${this.size} · estimated generated-texture peak ${Math.ceil(assessment.estimatedBytes / 1048576)} MiB. Native assets and browser overhead are additional.`;
  }
  render(index = this.document.active) {
    const plan = planLayerPreview({ recipe: this.document.recipe, index, active: this.document.active,
      size: this.size, assessment: this.assess(), blocked: this.quality.snapshot().blocked,
      opticsMissing: (layer, size) => this.port.needsOptics(index, layer, size) });
    if (plan.kind === "missing") return;
    const layer = plan.layer;
    if (plan.releaseDisabled) this.port.releaseDisabled(index, layer);
    if (plan.kind === "unavailable") {
      this.port.reset(); this.quality.fail(plan.reason);
      this.port.report(this.quality.snapshot().error);
      this.port.refreshQuality(); this.port.refresh(); return;
    }
    if (plan.kind === "recover") {
      this.quality.recover(); this.port.reset(); this.port.renderAll(); return;
    }
    this.quality.recover();
    this.port.request(index, layer, plan.priority, plan.size, plan.needsOptics);
    this.port.updateLayer(index, layer);
    this.port.refresh();
  }
  /** RasterClient validates a complete bundle and its version first; this guards replacement tiers/slots. */
  publish(result: CompleteRaster) {
    const layer = this.document.recipe.layers[result.i];
    if (!layer || result.size !== (layer.enabled ? this.size : 1)) return false;
    this.port.publish(result, layer);
    this.lastRaster = result.ms;
    this.port.refreshQuality();
    this.port.report(`Live makeup · ${result.size}² · ${Math.round(result.ms)} ms · layer ${result.i + 1}`);
    return true;
  }
  fail(reason?: string) {
    this.quality.fail(reason);
    this.port.report(this.quality.snapshot().error);
    this.port.refreshQuality();
  }
  resetStack() {
    this.port.reset(); this.port.replaceResources(); this.port.renderAll("stack"); this.port.refresh();
  }
  rejectInitialCapacity() {
    const assessment = this.assess();
    if (assessment.accepted) return false;
    this.port.reset(); this.quality.fail(assessment.error); this.port.refreshQuality();
    return true;
  }
}

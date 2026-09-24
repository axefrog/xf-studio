import type { AuthoringDocument } from "./authoring-document";
import { planLayerPreview } from "./authoring-preview-policy";
import { assessPreviewQuality, type PreviewTextureSize } from "./preview-quality";
import { PreviewQualityActions } from "./preview-quality-actions";
import { samePreviewInputs } from "./preview-layer-change";
import type { Layer, Recipe } from "./recipe";
import type { RasterResponse } from "./raster-processor";

export type CompleteRaster = Extract<RasterResponse, { data: unknown }>;
/**
 * Per-layer preview state (audit A-12), from the same sources as the aggregate phase.
 * `updating` includes queued or running work for that slot and a published texture that is
 * not the current tier or lacks its maps; when the queue cannot say which slot is pending,
 * every enabled layer is reported as updating rather than guessed ready.
 */
export type LayerReadiness = { layerId: string; state: "ready" | "updating" | "blocked" | "disabled"; size: number };
export type PreviewReadiness = { phase: "ready" | "updating" | "blocked";
  size: PreviewTextureSize; pending: number; waiting: boolean;
  estimatedBytes: number; error?: string; layers: LayerReadiness[] };

/** Device resources stay behind this port; it has no DOM, Three or worker types. */
export type PreviewRenderPort = {
  maxTextureSize(): number;
  resourceSize(index: number): number;
  needsOptics(index: number, layer: Layer, size: PreviewTextureSize): boolean;
  needsPresentationMaps(index: number, layer: Layer, size: PreviewTextureSize): boolean;
  /** `queuedIndices` and `running.i` identify pending slots when the adapter knows them. */
  queue(): { queued: number; running: unknown; queuedIndices?: readonly number[] };
  reset(): void;
  replaceResources(): void;
  reconcileResources(previous: Layer[], current: Layer[]): ReadonlySet<string>;
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
  private listeners = new Set<() => void>();
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
    this.quality.subscribe(() => this.notify());
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  private notify() { for (const listener of this.listeners) listener(); }
  get size() { return this.quality.snapshot().size; }
  get lastRasterMs() { return this.lastRaster; }
  assess(size: PreviewTextureSize = this.size) {
    return assessPreviewQuality(this.document.recipe, size, this.port.maxTextureSize());
  }
  readiness(): PreviewReadiness {
    const quality = this.quality.snapshot(), assessment = this.assess();
    const queue = this.port.queue();
    const pending = queue.queued + (queue.running ? 1 : 0);
    const waiting = this.document.recipe.layers.some((layer, index) => layer.enabled &&
      (this.port.resourceSize(index) !== this.size ||
        this.port.needsPresentationMaps(index, layer, this.size)));
    const error = quality.error || (!assessment.accepted ? assessment.error : undefined);
    const runningIndex = (queue.running as { i?: unknown } | null | undefined)?.i;
    const known = Array.isArray(queue.queuedIndices) && (!queue.running || typeof runningIndex === "number");
    const busy = new Set<number>(known ? [...queue.queuedIndices!, ...(typeof runningIndex === "number" ? [runningIndex] : [])] : []);
    const layers = this.document.recipe.layers.map((layer, index): LayerReadiness => ({ layerId: layer.id,
      size: this.port.resourceSize(index),
      state: !layer.enabled ? "disabled" : error ? "blocked" :
        (known ? busy.has(index) : pending > 0) || this.port.resourceSize(index) !== this.size ||
          this.port.needsPresentationMaps(index, layer, this.size) ? "updating" : "ready" }));
    return { phase: error ? "blocked" : pending || waiting ? "updating" : "ready",
      size: this.size, pending, waiting, estimatedBytes: assessment.estimatedBytes,
      ...(error ? { error } : {}), layers };
  }
  describeQuality() {
    const state = this.readiness();
    if (state.error) return state.error;
    return `${state.phase === "ready" ? "Ready" : "Updating"} · ${state.size} × ${state.size} · estimated generated-texture peak ${Math.ceil(state.estimatedBytes / 1048576)} MiB. Native assets and browser overhead are additional.`;
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
    this.notify();
    this.port.refresh();
  }
  /** RasterClient validates a complete bundle and its version first; this guards replacement tiers/slots. */
  publish(result: CompleteRaster) {
    const layer = this.document.recipe.layers[result.i];
    if (!layer || result.size !== (layer.enabled ? this.size : 1)) return false;
    this.port.publish(result, layer);
    this.lastRaster = result.ms;
    this.notify();
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
    this.notify();
  }
  /** Keep complete resources by stable layer ID; only changed inputs require new work. */
  syncStack(previous: Recipe) {
    const current = this.document.recipe.layers, old = previous.layers;
    const oldById = new Map(old.map(layer => [layer.id, layer]));
    const orderChanged = old.length !== current.length || old.some((layer, i) => layer.id !== current[i]?.id);
    const interrupted = orderChanged ? this.port.reconcileResources(old, current) : new Set<string>();
    for (let i = 0; i < current.length; i++) {
      const prior = oldById.get(current[i].id);
      if (!prior || !samePreviewInputs(prior, current[i]) || interrupted.has(current[i].id) ||
          orderChanged && current[i].enabled &&
            (this.port.resourceSize(i) !== this.size || this.port.needsPresentationMaps(i, current[i], this.size)))
        this.render(i);
    }
    this.port.refresh(); this.notify();
  }
  rejectInitialCapacity() {
    const assessment = this.assess();
    if (assessment.accepted) return false;
    this.port.reset(); this.quality.fail(assessment.error); this.port.refreshQuality();
    return true;
  }
}

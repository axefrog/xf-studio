import type { ProfileSessions } from "../../app/profiles/profile-sessions";
/** One CPU canvas/input adapter per bound UV instance; no renderer or raster scheduler is acquired here. */
import { createUVEditor } from "../../legacy/eye-makeup/browser/uv-editor";
import { parseUVView, type UVView } from "../../legacy/eye-makeup/uv-view";
import { modifiersOf, NO_MODIFIERS } from "../../app/input-bindings";
import { ViewportAttachment } from "../../app/viewport-attachment";
import type { createTrustedAuthoringCore } from "../../app/trusted-authoring-core";
import type { NamedTargets } from "../../app/action-targets";
import type { Capability } from "../../platform/api";
import type { LayeredMakeupRegion } from "../../engines/layered-makeup/region";

type Core = ReturnType<typeof createTrustedAuthoringCore>;
export function createPanelUV(input: { core: Core; named: NamedTargets; instance: string; signal: AbortSignal; check(): Capability },
  options: { region: Pick<LayeredMakeupRegion, "models" | "mirror">; initial?: unknown;
    remember?(view: UVView): void;
    canvases(): HTMLCanvasElement[]; albedo(): HTMLImageElement | undefined; changed?(): void;
    factory?: typeof createUVEditor }) {
  const canvas = document.createElement("canvas"); canvas.className = "uv-canvas";
  canvas.style.width = "100%"; canvas.style.height = "100%";
  const { core, named, signal } = input, source = `uv:${input.instance}`;
  let editor: ReturnType<typeof createUVEditor> | undefined;
  const attachment = new ViewportAttachment<HTMLElement>({
    moveHost: (kind, slot) => { if (kind === "uv" && !signal.aborted) slot.append(canvas); },
    measure: () => ({ width: canvas.clientWidth, height: canvas.clientHeight }),
    resize: () => { if (!signal.aborted) editor?.resize(); }, cancelInput: () => editor?.cancelInput(), inputCapture: () => editor?.inputCapture() ?? false,
    headView: () => undefined, uvView: () => editor?.snapshot(), uvSelection: () => editor?.selection(),
    uvCommand: command => !signal.aborted && (editor?.viewCommand(command) ?? false),
    uvNavigate: command => !signal.aborted && (editor?.navigate(command) ?? false),
    hitAt: (kind, x, y) => kind === "uv" ? editor?.hitAt(x, y) : undefined, queryContext: hit => core.app.contextQuery(hit),
  });
  const selected = () => core.presentation.layer();
  editor = (options.factory ?? createUVEditor)(canvas, undefined, {
    region: options.region, recipe: () => core.geometry.recipe(), layer: () => core.geometry.layer(), selected: () => core.presentation.selected,
    selectedField: () => core.presentation.selectedField()?.id,
    select: index => { const layer = selected(); if (layer && named.look) core.app.dispatch({ kind: "point.select", layerId: layer.id, index, look: named.look }); },
    selectField: fieldId => { const layer = selected(); if (layer && named.look) core.app.dispatch({ kind: "field.select", layerId: layer.id, fieldId, look: named.look }); },
    begin: () => { const layer = selected(); if (layer && input.check().available) core.app.beginGesture(source, layer.id, named.look); },
    apply: proposal => input.check().available && core.app.applyGesture(source, proposal), cancel: () => core.app.endGesture(source, true), finish: () => core.app.endGesture(source),
    canvases: options.canvases, albedo: options.albedo, surfaceEdge: () => core.app.surfaceEdge(selected()?.id),
    persist: () => { if (signal.aborted || !input.check().available) return; if (editor) options.remember?.(editor.snapshot()); attachment.viewChanged(); options.changed?.(); }, message: () => {}, input: state => attachment.reportInput("uv", state),
  }, parseUVView(options.initial));
  attachment.setReady("uv");
  const off = core.app.subscribe(() => { if (!signal.aborted) editor?.draw(); });
  for (const kind of ["keydown", "keyup", "pointermove", "pointerdown"]) canvas.addEventListener(kind, event => attachment.reportModifiers(modifiersOf(event as KeyboardEvent)), { signal, passive: true });
  const clear = () => attachment.reportModifiers(NO_MODIFIERS);
  if (typeof window !== "undefined") window.addEventListener("blur", clear, { signal });
  signal.addEventListener("abort", () => { off(); editor?.dispose(); canvas.remove(); }, { once: true });
  if (signal.aborted) { off(); editor.dispose(); canvas.remove(); }
  return Object.assign(attachment, { draw: () => { if (!signal.aborted) editor?.draw(); } });
}

/** Composition binds the instance's serializable navigation memory; all adapters share the existing completed-raster owner. */
export function createPanelUVFactory(options: {
  session: ProfileSessions; fallback: ViewportAttachment<HTMLElement>;
  region: Pick<LayeredMakeupRegion, "models" | "mirror">; initial?: unknown;
  canvases(named: NamedTargets): HTMLCanvasElement[]; albedo(named: NamedTargets): HTMLImageElement | undefined;
}) {
  const adapters = new Set<ReturnType<typeof createPanelUV>>();
  return {
    acquire(input: Parameters<typeof createPanelUV>[0]): ViewportAttachment<HTMLElement> {
      const instance = options.session.panel(input.instance);
      if (instance?.type !== "uv") return options.fallback;
      const destination = options.session.panelTarget(instance.id), state = instance.state && typeof instance.state === "object" ? instance.state as Record<string, unknown> : {};
      const adapter = createPanelUV(input, { region: options.region, initial: state.uvView ?? options.initial,
        remember: uvView => options.session.rememberPanelState(destination, { ...state, uvView }),
        canvases: () => options.canvases(input.named), albedo: () => options.albedo(input.named) });
      if (!input.signal.aborted) {
        adapters.add(adapter);
        input.signal.addEventListener("abort", () => adapters.delete(adapter), { once: true });
      }
      return adapter;
    },
    draw() { for (const adapter of adapters) adapter.draw(); },
  };
}

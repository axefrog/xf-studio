import type { ProfileSessions } from "../../app/profiles/profile-sessions";
/** One CPU canvas/input adapter per bound UV instance; no renderer or raster scheduler is acquired here. */
import type { UVView } from "../../legacy/eye-makeup/uv-view";
import { modifiersOf, NO_MODIFIERS } from "../../app/input-bindings";
import { ViewportAttachment } from "../../app/viewport-attachment";
import type { createTrustedAuthoringCore } from "../../app/trusted-authoring-core";
import type { NamedTargets } from "../../app/action-targets";
import type { Capability } from "../../platform/api";
import { registeredEditorAdapters, type BrowserEditorAdapters, type FlatEditor } from "./editor-adapters";

type Core = ReturnType<typeof createTrustedAuthoringCore>;
export function createPanelUV(input: { core: Core; named: NamedTargets; instance: string; signal: AbortSignal; check(): Capability },
  options: { adapters?: BrowserEditorAdapters; initial?: unknown;
    remember?(view: UVView): void;
    canvases(): HTMLCanvasElement[]; albedo(): HTMLImageElement | undefined; changed?(): void;
  }) {
  const flat = (options.adapters ?? registeredEditorAdapters(input.core))?.flat;
  const canvas = flat ? document.createElement("canvas") : undefined; if (canvas) canvas.className = "uv-canvas";
  if (canvas) { canvas.style.width = "100%"; canvas.style.height = "100%"; }
  const { core, named, signal } = input, source = `uv:${input.instance}`;
  let editor: FlatEditor | undefined;
  const attachment = new ViewportAttachment<HTMLElement>({
    moveHost: (kind, slot) => { if (kind === "uv" && !signal.aborted) canvas && slot.append(canvas); },
    measure: () => canvas ? { width: canvas.clientWidth, height: canvas.clientHeight } : { width: 0, height: 0 },
    resize: () => { if (!signal.aborted) editor?.resize(); }, cancelInput: () => editor?.cancelInput(), inputCapture: () => editor?.inputCapture() ?? false,
    headView: () => undefined, uvView: () => editor?.snapshot(), uvSelection: () => editor?.selection?.(),
    uvCommand: command => !signal.aborted && (editor?.viewCommand(command) ?? false),
    uvNavigate: command => !signal.aborted && (editor?.navigate?.(command) ?? false),
    hitAt: (kind, x, y) => kind === "uv" ? editor?.hitAt(x, y) : undefined, queryContext: hit => core.app.contextQuery(hit),
  }, flat ? ["uv"] : []);
  if (flat && canvas && !signal.aborted) editor = flat.create(canvas, {
    state: core, source, signal, look: () => named.look, check: input.check,
    complete: action => ({ ...action, ...(named.look ? { look: named.look } : {}) }) as import("../../app/studio-application").StudioAction,
    message: () => {}, input: state => attachment.reportInput("uv", state),
  }, { initial: options.initial, canvases: options.canvases, albedo: options.albedo,
    persist: view => { options.remember?.(view); attachment.viewChanged(); options.changed?.(); } });
  if (editor) attachment.setReady("uv");
  const off = core.app.subscribe(() => { if (!signal.aborted) editor?.draw(); });
  for (const kind of ["keydown", "keyup", "pointermove", "pointerdown"]) canvas?.addEventListener(kind, event => attachment.reportModifiers(modifiersOf(event as KeyboardEvent)), { signal, passive: true });
  const clear = () => attachment.reportModifiers(NO_MODIFIERS);
  if (typeof window !== "undefined") window.addEventListener("blur", clear, { signal });
  signal.addEventListener("abort", () => { off(); editor?.dispose(); canvas?.remove(); }, { once: true });
  if (signal.aborted) { off(); editor?.dispose(); canvas?.remove(); }
  return Object.assign(attachment, { draw: () => { if (!signal.aborted) editor?.draw(); } });
}

/** Composition binds the instance's serializable navigation memory; all adapters share the existing completed-raster owner. */
export function createPanelUVFactory(options: {
  session: ProfileSessions; fallback: ViewportAttachment<HTMLElement>;
  initial?: unknown;
  canvases(named: NamedTargets): HTMLCanvasElement[]; albedo(named: NamedTargets): HTMLImageElement | undefined;
}) {
  const adapters = new Set<ReturnType<typeof createPanelUV>>();
  return {
    acquire(input: Parameters<typeof createPanelUV>[0]): ViewportAttachment<HTMLElement> {
      const instance = options.session.panel(input.instance);
      if (instance?.type !== "uv") return options.fallback;
      const destination = options.session.panelTarget(instance.id), state = instance.state && typeof instance.state === "object" ? instance.state as Record<string, unknown> : {};
      const adapter = createPanelUV(input, { initial: state.uvView ?? options.initial,
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

/** Eye makeup's transitional browser contribution over the released layered editors.
 * Registered beside its application contribution; core hosts never construct these adapters or their hooks.
 */
import { createUVEditor } from "../../legacy/eye-makeup/browser/uv-editor";
import { createSurfaceEditor, surfaceEditorParts, surfaceGuideStandIns } from "../../legacy/eye-makeup/browser/surface-editor";
import { parseUVView } from "../../legacy/eye-makeup/uv-view";
import { surfaceOutline } from "../../engines/layered-makeup/surface-edge";
import type { LayeredMakeupRegion } from "../../engines/layered-makeup/region";
import type { createTrustedAuthoringCore } from "../../app/trusted-authoring-core";
import type { BrowserEditorAdapters, EditorBinding } from "./editor-adapters";
import { makeupProjection } from "../../app/authoring/makeup-view";
type Core = ReturnType<typeof createTrustedAuthoringCore>;

export function createLayeredEditorAdapters(region: Pick<LayeredMakeupRegion, "models" | "mirror">,
  factories: { flat?: typeof createUVEditor; surface?: typeof createSurfaceEditor } = {}): BrowserEditorAdapters {
  const hooks = (binding: EditorBinding, namedSelection = false) => {
    const core = binding.state as Core, projection = makeupProjection(core);
    if (!projection) throw Error("The layered editor needs its registered authoring projection.");
    const selected = () => projection.presentation.layer(), allowed = () => !binding.signal.aborted && binding.check().available;
    return { layer: () => projection.geometry.layer(), selected: () => projection.presentation.selected,
      selectedField: () => projection.presentation.selectedField()?.id,
      select: (index: number) => { if (!allowed() || namedSelection && !binding.look()) return; const layer = selected(); if (layer) core.app.dispatch(binding.complete({ kind: "point.select", layerId: layer.id, index })); },
      selectField: (fieldId: string) => { if (!allowed() || namedSelection && !binding.look()) return; const layer = selected(); if (layer) core.app.dispatch(binding.complete({ kind: "field.select", layerId: layer.id, fieldId })); },
      begin: () => { if (!allowed()) return; const layer = selected(); if (layer) core.app.beginGesture(binding.source, layer.id, binding.look()); },
      apply: (proposal: Parameters<Core["app"]["applyGesture"]>[1]) => allowed() && core.app.applyGesture(binding.source, proposal),
      cancel: () => core.app.endGesture(binding.source, true), finish: () => core.app.endGesture(binding.source),
      message: binding.message, input: binding.input, region };
  };
  return {
    flat: { create(canvas, binding, options) {
      const core = binding.state as Core;
      const projection = makeupProjection(core);
      if (!projection) throw Error("The layered editor needs its registered authoring projection.");
      let editor: ReturnType<typeof createUVEditor>;
      editor = (factories.flat ?? createUVEditor)(canvas, undefined, { ...hooks(binding, true),
        recipe: () => projection.geometry.recipe(), canvases: options.canvases, albedo: options.albedo,
        surfaceEdge: () => core.app.surfaceEdge(projection.presentation.layer()?.id),
        persist: () => { if (!binding.signal.aborted && binding.check().available && editor) options.persist(editor.snapshot()); },
      }, parseUVView(options.initial));
      return editor;
    } },
    surface: { create(scene) {
      const guides = surfaceGuideStandIns();
      let made: { surface: Parameters<typeof surfaceEditorParts>[2]; parts: ReturnType<typeof surfaceEditorParts> } | undefined;
      const partsFor = (surface: Parameters<typeof surfaceEditorParts>[2]) => {
        if (!made || made.surface !== surface) made = { surface, parts: surfaceEditorParts(scene.head, scene.eyes, surface) };
        return made.parts;
      };
      return { guides: guides.objects, steps: surface => partsFor(surface).steps,
        mount(surface, binding) {
          const core = binding.state as Core;
          const projection = makeupProjection(core);
          if (!projection) throw Error("The layered editor needs its registered authoring projection.");
          const { renderer, camera, head, eyes, controls, cameraInput, onFrame, requestRender } = scene;
          return (factories.surface ?? createSurfaceEditor)({ renderer, scene: scene.scene, camera, head, eyes, controls, cameraInput, onFrame, requestRender, plate: surface },
            { ...hooks(binding), layers: () => projection.geometry.recipe().layers }, partsFor(surface), guides.materials);
        },
        outline(surface) {
          const geometry = surface.geometry, uv = geometry?.getAttribute("uv"), position = geometry?.getAttribute("position");
          if (!uv || !position) return;
          const uvs = new Float64Array(uv.count * 2), positions = new Float64Array(position.count * 3);
          for (let i = 0; i < uv.count; i++) { uvs[2 * i] = uv.getX(i); uvs[2 * i + 1] = uv.getY(i); }
          for (let i = 0; i < position.count; i++) { positions[3 * i] = position.getX(i); positions[3 * i + 1] = position.getY(i); positions[3 * i + 2] = position.getZ(i); }
          return surfaceOutline({ positions, uvs, index: geometry!.index?.array ?? null });
        }, dispose() { made = undefined; guides.dispose(); } };
    } },
  };
}

import type { Layer } from "./engines/layered-makeup/recipe";

/** Keep the edited identity through a deferred frame, even if selection changes. */
export function layerRenderQueue(layers: () => readonly Layer[], frame: (run: () => void) => void, render: (index: number) => void) {
  const dirty = new Set<Layer>();
  let pending = false;
  return (layer: Layer | undefined) => {
    if (!layer) return;
    dirty.add(layer);
    if (pending) return;
    pending = true;
    frame(() => {
      pending = false;
      const changed = [...dirty]; dirty.clear();
      for (const layer of changed) {
        const index = layers().indexOf(layer);
        // Structural replacement already queues all fresh layers itself.
        if (index >= 0) render(index);
      }
    });
  };
}

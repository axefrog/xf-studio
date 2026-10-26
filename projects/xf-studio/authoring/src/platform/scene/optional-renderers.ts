import type { ExperimentPort } from "../api/experiments";
import type { FeatureRendererFactory } from "../api/scene";

/**
 * Keeps the scene's optional renderers in step with the experiments that are on: each wanted renderer is registered
 * once and withdrawn when it is no longer wanted. Registration is recorded before the renderer is created, because
 * creating one can notify the experiments, which syncs again. Returns the release.
 */
export function followOptionalRenderers(source: Pick<ExperimentPort, "registrations" | "subscribe">,
  register: (factory: FeatureRendererFactory, signal: AbortSignal) => void): () => void {
  const registered = new Map<FeatureRendererFactory, AbortController>();
  const sync = () => {
    const wanted = source.registrations().map(item => item.renderer);
    for (const [factory, token] of registered) if (!wanted.includes(factory)) { registered.delete(factory); token.abort(); }
    for (const factory of wanted) if (!registered.has(factory)) {
      const token = new AbortController(); registered.set(factory, token);
      try { register(factory, token.signal); } catch (error) { registered.delete(factory); token.abort(); throw error; }
    }
  };
  const unsubscribe = source.subscribe(sync);
  const release = () => { unsubscribe(); for (const token of registered.values()) token.abort(); registered.clear(); };
  try { sync(); } catch (error) { release(); throw error; }
  return release;
}

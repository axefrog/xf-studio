/**
 * The scene host's registry of feature renderers (feature-module platform §5): it makes each composed feature's `SceneHostPort`,
 * creates the renderers once the head is ready, and fans the host's per-frame preparation, display toggles and context restores
 * out to them. It owns what a renderer attaches to the head rig, so disposal leaves nothing behind even when a renderer forgets.
 * Three objects only; no DOM, no knowledge of any feature.
 */
import * as THREE from "three";
import type { FeatureId } from "../api/feature";
import type { CharacterSlot, CharacterView, FeatureRenderer, FeatureRendererFactory, LightingView, SceneHostPort,
  SkinUnderlayPort } from "../api/scene";

/** What the host lends the ports it makes. */
export type FeatureRendererContext = {
  renderer: THREE.WebGLRenderer;
  head: THREE.SkinnedMesh;
  /** The core record's surfaces by node key (`plate`). */
  surfaces: ReadonlyMap<string, THREE.SkinnedMesh>;
  skin: SkinUnderlayPort;
  character(): CharacterView;
  subscribeCharacter(listener: () => void): () => void;
  lighting(): LightingView;
  subscribeLighting(listener: () => void): () => void;
  requestFrame(): void;
  onFrame(listener: (dt: number) => void): () => void;
};

type Attached = { object: THREE.Object3D; followers: THREE.Mesh[] };
type Entry = { feature: FeatureId; renderer: FeatureRenderer; attached: Set<Attached>; restored: Set<() => void>; frames: Set<() => void> };

export type FeatureRenderers = ReturnType<typeof createFeatureRenderers>;

/**
 * Create every composed renderer, in list order. A renderer that fails to create releases the ones made before it and the error
 * reaches the host (whose load then fails and releases everything, as any failed load does).
 */
export function createFeatureRenderers(context: FeatureRendererContext, factories: readonly FeatureRendererFactory[]) {
  const entries: Entry[] = [];
  const { head } = context;
  /** The head's current weight of a facial target, by name (an attached mesh takes the V's shape as it joins). */
  const weight = (name: string) => head.morphTargetInfluences?.[head.morphTargetDictionary?.[name] ?? -1] ?? 0;
  function port(entry: Entry): SceneHostPort {
    return Object.freeze({
      feature: entry.feature,
      renderer: context.renderer,
      anchors: () => ({ head, surface: (id: string) => context.surfaces.get(id) }),
      attach(object: THREE.Object3D, options: { beside?: THREE.Object3D; morphs?: boolean } = {}) {
        const parent = (options.beside ?? head).parent;
        if (!parent) throw Error("That anchor is not on the head rig.");
        parent.add(object);
        const followers: THREE.Mesh[] = [];
        if (options.morphs) object.traverse(child => {
          if (!(child instanceof THREE.Mesh) || !child.morphTargetInfluences || !child.morphTargetDictionary) return;
          for (const [name, index] of Object.entries(child.morphTargetDictionary)) child.morphTargetInfluences[index] = weight(name);
          followers.push(child);
        });
        const item: Attached = { object, followers };
        entry.attached.add(item);
        context.requestFrame();
        return () => {
          if (!entry.attached.delete(item)) return;
          object.removeFromParent();
          context.requestFrame();
        };
      },
      skin: context.skin,
      character: context.character,
      subscribeCharacter: context.subscribeCharacter,
      lighting: context.lighting,
      subscribeLighting: context.subscribeLighting,
      requestFrame: context.requestFrame,
      onFrame: (listener: (dt: number) => void) => {
        const off = context.onFrame(listener);
        const release = () => { entry.frames.delete(release); off(); };
        entry.frames.add(release);
        return release;
      },
      onContextRestored: (listener: () => void) => {
        entry.restored.add(listener);
        return () => { entry.restored.delete(listener); };
      },
    });
  }
  function disposeEntry(entry: Entry) {
    try { entry.renderer.dispose(); }
    finally {
      for (const release of [...entry.frames]) release();
      for (const item of entry.attached) item.object.removeFromParent();
      entry.attached.clear(); entry.restored.clear();
    }
  }
  function dispose() {
    for (const entry of entries.splice(0).reverse()) {
      try { disposeEntry(entry); } catch (error) { console.error(error); }
    }
  }
  try {
    for (const factory of factories) {
      if (entries.some(entry => entry.feature === factory.feature)) throw Error(`The feature ${factory.feature} has two renderers.`);
      const entry = { feature: factory.feature, attached: new Set<Attached>(), restored: new Set<() => void>(), frames: new Set<() => void>() } as Entry;
      entry.renderer = factory.create(port(entry));
      entries.push(entry);
    }
  } catch (error) { dispose(); throw error; }
  return {
    /** A feature's renderer (the composition root reads its own features' devices; the host never does). */
    get: (feature: string) => entries.find(entry => entry.feature === feature)?.renderer,
    features: () => entries.map(entry => entry.feature),
    /** Before a drawn frame, after the rig moved and the frame listeners ran. */
    beforeDraw() { for (const { renderer } of entries) renderer.beforeDraw?.(); },
    setNormals(enabled: boolean) { for (const { renderer } of entries) renderer.setNormals?.(enabled); },
    setWireframe(enabled: boolean) { for (const { renderer } of entries) renderer.setWireframe?.(enabled); },
    contextRestored() { for (const entry of entries) for (const listener of entry.restored) listener(); },
    /** Meshes the renderers attached with `morphs`: they follow the V's facial shapes with the head's own surfaces. */
    followers: () => entries.flatMap(entry => [...entry.attached].flatMap(item => item.followers)),
    /** Character slots an active renderer replaces (the host hides them). */
    superseded: () => new Set<CharacterSlot>(entries.flatMap(entry => entry.renderer.supersedes ?? [])),
    evidence: () => Object.fromEntries(entries.map(entry => [entry.feature, entry.renderer.evidence?.() ?? null])),
    dispose,
  };
}

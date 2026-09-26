/**
 * The scene host's registry of feature renderers (feature-module platform §5): it makes each composed feature's `SceneHostPort`,
 * creates the renderers once the head is ready, and fans the host's per-frame preparation, display toggles and context restores
 * out to them. It owns what a renderer attaches to the head rig, joins to the rig motion, subscribes to and supersedes, so disposal
 * (or a creation that fails part-way) leaves nothing behind even when a renderer forgets (PREV-92). One renderer that throws is
 * reported and skipped; the others and the host draw on (PREV-94). Three objects only; no DOM, no knowledge of any feature.
 */
import * as THREE from "three";
import type { FeatureId } from "../api/feature";
import { renderBand, RENDER_ORDER, type CharacterSlot, type CharacterView, type FeatureRenderer, type FeatureRendererFactory, type LightingView,
  type RenderBand, type SceneHostPort, type SkinUnderlayPort, type SupersededPart } from "../api/scene";

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
  /** The rig motion (idle and blink): bones join and leave it by name, as the V's details do. */
  rig: { attach(bones: readonly THREE.Object3D[]): void; detach(bones: readonly THREE.Object3D[]): void };
  /** The resolved parts the renderers supersede changed: show and hide the V's parts again. */
  supersededChanged(): void;
  /** A renderer's method threw (default: the console). Reported once until that method succeeds again. */
  report?(feature: FeatureId, method: string, error: unknown): void;
};

type Attached = { object: THREE.Object3D; morphs: boolean; rig: boolean; followers: Set<THREE.Mesh>; bones: THREE.Bone[] };
type Entry = {
  feature: FeatureId; factory: FeatureRendererFactory; renderer?: FeatureRenderer; band: RenderBand;
  attached: Set<Attached>; restored: Set<() => void>; releases: Set<() => void>;
  supersedes: readonly SupersededPart[]; failing: Set<string>;
};

export type FeatureRenderers = ReturnType<typeof createFeatureRenderers>;

const SLOTS: readonly CharacterSlot[] = ["skin", "face", "brows", "lashes", "hair", "eyes", "piercings", "body"];

/** A renderer's supersede list, checked and frozen (plain data the host keeps). */
function supersedeList(parts: readonly SupersededPart[]): readonly SupersededPart[] {
  return Object.freeze(parts.map(part => {
    if (!SLOTS.includes(part.slot)) throw Error(`${String(part.slot)} is not a character slot.`);
    if (part.options && !part.options.every(option => typeof option === "string" && option)) throw Error("Superseded options are option names.");
    return Object.freeze(part.options ? { slot: part.slot, options: Object.freeze([...part.options]) } : { slot: part.slot });
  }));
}

/**
 * Create every composed renderer, in list order, each with the next free run of draw-order slots it asked for. A renderer that fails
 * to create releases what it had made through its port and the renderers made before it, and the error reaches the host (whose load
 * then fails and releases everything, as any failed load does).
 */
export function createFeatureRenderers(context: FeatureRendererContext, factories: readonly FeatureRendererFactory[]) {
  const entries: Entry[] = [];
  const { head } = context;
  const report = context.report ?? ((feature, method, error) => console.error(`The ${feature} renderer's ${method} failed.`, error));
  /** The head's current weight of a facial target, by name (an attached mesh takes the V's shape as it joins). */
  const weight = (name: string) => head.morphTargetInfluences?.[head.morphTargetDictionary?.[name] ?? -1] ?? 0;
  const follows = (child: THREE.Object3D): child is THREE.Mesh =>
    child instanceof THREE.Mesh && !!child.morphTargetInfluences && !!child.morphTargetDictionary;
  /** Bring an attachment's followers up to date with what is under it now: new meshes take the V's shape, removed ones leave (PREV-93). */
  function syncFollowers(item: Attached) {
    if (!item.morphs) return;
    const present = new Set<THREE.Mesh>();
    item.object.traverse(child => { if (follows(child)) present.add(child); });
    for (const mesh of present) if (!item.followers.has(mesh)) {
      for (const [name, index] of Object.entries(mesh.morphTargetDictionary!)) mesh.morphTargetInfluences![index] = weight(name);
      item.followers.add(mesh);
    }
    for (const mesh of [...item.followers]) if (!present.has(mesh)) item.followers.delete(mesh);
  }
  /**
   * Bring an attachment's rig bones up to date with what is under it now (PREV-99): bones added after `attach` (a GLB that finished
   * loading later) join the idle and blink, taking their neutral pose as they join; bones removed since leave them.
   */
  function syncBones(item: Attached) {
    if (!item.rig) return;
    const present: THREE.Bone[] = [];
    item.object.traverse(child => { if (child instanceof THREE.Bone) present.push(child); });
    const known = new Set(item.bones), kept = new Set(present);
    const added = present.filter(bone => !known.has(bone)), removed = item.bones.filter(bone => !kept.has(bone));
    if (!added.length && !removed.length) return;
    if (removed.length) context.rig.detach(removed);
    if (added.length) {
      item.object.updateWorldMatrix(true, true);
      context.rig.attach(added);
    }
    item.bones = present;
  }
  /** Keep a subscription so disposal ends it; the returned unsubscribe ends it early. */
  function tracked(entry: Entry, off: () => void) {
    const release = () => { if (entry.releases.delete(release)) off(); };
    entry.releases.add(release);
    return release;
  }
  function port(entry: Entry): SceneHostPort {
    const skin: SkinUnderlayPort = Object.freeze({ light: () => context.skin.light(), underlay: (surface: THREE.Mesh) => context.skin.underlay(surface),
      subscribe: (listener: () => void) => tracked(entry, context.skin.subscribe(listener)) });
    return Object.freeze({
      feature: entry.feature,
      renderer: context.renderer,
      anchors: () => ({ head, surface: (id: string) => context.surfaces.get(id) }),
      attach(object: THREE.Object3D, options: { beside?: THREE.Object3D; morphs?: boolean; rig?: boolean } = {}) {
        const parent = (options.beside ?? head).parent;
        if (!parent) throw Error("That anchor is not on the head rig.");
        parent.add(object);
        const item: Attached = { object, morphs: !!options.morphs, rig: !!options.rig, followers: new Set(), bones: [] };
        syncFollowers(item);
        if (options.rig) {
          object.traverse(child => { if (child instanceof THREE.Bone) item.bones.push(child); });
          // The blink binds first: it takes the bones' neutral pose before a playing idle poses them (as the V's details do).
          object.updateWorldMatrix(true, true);
          context.rig.attach(item.bones);
        }
        entry.attached.add(item);
        context.requestFrame();
        return () => {
          if (!entry.attached.delete(item)) return;
          detach(item);
          context.requestFrame();
        };
      },
      renderBand: entry.band,
      supersede(parts: readonly SupersededPart[]) {
        const next = supersedeList(parts);
        if (JSON.stringify(next) === JSON.stringify(entry.supersedes)) return;
        entry.supersedes = next;
        // A composed renderer changes what the V shows at once; one still being created counts once it is (the host looks after
        // creating them all).
        if (entries.includes(entry)) context.supersededChanged();
      },
      skin,
      character: context.character,
      subscribeCharacter: (listener: () => void) => tracked(entry, context.subscribeCharacter(listener)),
      lighting: context.lighting,
      subscribeLighting: (listener: () => void) => tracked(entry, context.subscribeLighting(listener)),
      requestFrame: context.requestFrame,
      onFrame: (listener: (dt: number) => void) => tracked(entry, context.onFrame(listener)),
      onContextRestored: (listener: () => void) => {
        entry.restored.add(listener);
        return () => { entry.restored.delete(listener); };
      },
    });
  }
  function detach(item: Attached) {
    if (item.bones.length) context.rig.detach(item.bones);
    item.object.removeFromParent();
  }
  /** Release what the entry made through its port: attachments, rig bones, subscriptions, frame listeners and its supersede list. */
  function releasePort(entry: Entry) {
    for (const release of [...entry.releases]) { try { release(); } catch (error) { console.error(error); } }
    for (const item of entry.attached) detach(item);
    entry.attached.clear(); entry.restored.clear();
    const superseded = entry.supersedes.length > 0;
    entry.supersedes = [];
    return superseded;
  }
  function disposeEntry(entry: Entry) {
    try { entry.renderer?.dispose(); }
    finally { if (releasePort(entry)) context.supersededChanged(); }
  }
  function dispose() {
    for (const entry of entries.splice(0).reverse()) {
      try { disposeEntry(entry); } catch (error) { console.error(error); }
    }
  }
  /** Run one renderer's method; a throw is reported (once per failing streak) and the next renderer still runs (PREV-94). */
  function guarded(entry: Entry, method: string, run: (renderer: FeatureRenderer) => void) {
    try {
      run(entry.renderer!);
      entry.failing.delete(method);
    } catch (error) {
      if (!entry.failing.has(method)) { entry.failing.add(method); report(entry.feature, method, error); }
    }
  }
  let nextSlot: number = RENDER_ORDER.featurePlates;
  try {
    for (const factory of factories) {
      if (entries.some(entry => entry.feature === factory.feature)) throw Error(`The feature ${factory.feature} has two renderers.`);
      const slots = factory.renderSlots ?? 0;
      if (!Number.isInteger(slots) || slots < 0) throw Error(`The ${factory.feature} renderer asks for ${slots} draw-order slots.`);
      if (nextSlot + slots > RENDER_ORDER.eyeShell)
        throw Error(`The feature plates' draw order is full: ${factory.feature} needs ${slots} slots after ${nextSlot - RENDER_ORDER.featurePlates}.`);
      const entry: Entry = { feature: factory.feature, factory, band: renderBand(nextSlot, slots), attached: new Set(), restored: new Set(),
        releases: new Set(), supersedes: [], failing: new Set() };
      nextSlot += slots;
      try { entry.renderer = factory.create(port(entry)); }
      catch (error) {
        // What it made before failing is released too (PREV-92); it never counted towards what the V shows.
        releasePort(entry);
        throw error;
      }
      entries.push(entry);
    }
  } catch (error) { dispose(); throw error; }
  return {
    /** A composed feature's renderer, typed by the factory that made it (the composition root reads its own features'; the host never does). */
    get<R extends FeatureRenderer>(factory: FeatureRendererFactory<R>): R | undefined {
      return entries.find(entry => entry.factory === factory)?.renderer as R | undefined;
    },
    features: () => entries.map(entry => entry.feature),
    /**
     * Before a drawn frame, after the rig moved and the frame listeners ran: new morph followers take the V's shape first, and bones
     * added under a rig attachment since the last frame join the rig motion, which poses them at once (PREV-99).
     */
    beforeDraw() {
      for (const entry of entries) {
        for (const item of entry.attached) { syncFollowers(item); syncBones(item); }
        guarded(entry, "beforeDraw", renderer => renderer.beforeDraw?.());
      }
    },
    setNormals(enabled: boolean) { for (const entry of entries) guarded(entry, "setNormals", renderer => renderer.setNormals?.(enabled)); },
    setWireframe(enabled: boolean) { for (const entry of entries) guarded(entry, "setWireframe", renderer => renderer.setWireframe?.(enabled)); },
    contextRestored() {
      for (const entry of entries) for (const listener of [...entry.restored]) guarded(entry, "onContextRestored", () => listener());
    },
    /** Meshes the renderers attached with `morphs`, as they are now: they follow the V's facial shapes with the head's own surfaces. */
    followers: () => entries.flatMap(entry => [...entry.attached].flatMap(item => { syncFollowers(item); return [...item.followers]; })),
    /** The resolved parts the active renderers replace now (the host hides them). */
    superseded: (): readonly SupersededPart[] => entries.flatMap(entry => entry.supersedes),
    /** Each renderer's draw-order band, by feature (developer evidence). */
    bands: () => Object.fromEntries(entries.map(entry => [entry.feature, { first: entry.band.first, slots: entry.band.slots }])),
    evidence: () => Object.fromEntries(entries.map(entry => {
      try { return [entry.feature, entry.renderer!.evidence?.() ?? null]; }
      catch (error) { return [entry.feature, { error: (error as Error)?.message ?? String(error) }]; }
    })),
    dispose,
  };
}

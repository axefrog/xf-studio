import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * The game's own blink on the preview head (knowledge/facial-animation.md). An offline bake
 * (tools/bake_game_blink.py) runs the player head's facial setup through the external IO Suite solver, as the idle bake
 * does, and stores two animations on the facial rig in one local asset made from the player's game files:
 *
 * - the game's `additive__blink_normal__01` clip (generic facial additives), solved at its own timing, for Play blink;
 * - `eye_blink_closure`: that clip's closing half (to the frame where `eye_l_blink` and `eye_r_blink` reach 1), with the
 *   squint, gaze and brow controls the clip moves alongside and every corrective the setup adds. Its time axis is the
 *   closure, so the slider scrubs the game's own blink shape. Closure 0 shows the editing pose (the clip's first frame
 *   looks about 1° down).
 *
 * Like the idle, the solved rig drives the preview's bones by name in world bind space: every bone with a rig driver of
 * its name (the core head's, and each loaded detail's own skeleton copy: brows, lashes, the eye) gets the driver's world
 * delta applied to its own world bind pose, parent first, so bones that inherit motion in the rig (the lashes under
 * the lid rows) follow even when the preview's skeletons are flat.
 *
 * Eye shapes: each eye-shape morph target carries its own joint binds (`boneRigMatrices`), which move the eye region's
 * joints with the shape (the eye joint up to about 3.8 mm). `setShape` re-seats the rig on that shape's binds, so the
 * solved local poses turn the lids about the moved eye centre instead of the base one [hypothesis; see the knowledge page].
 */
export const GAME_BLINK_ASSET = "/assets/game-blink.glb";
export const GAME_BLINK_SCHEMA = "xfs/game-blink-1";
/**
 * Play blink repeats the game's clip every this many seconds. The clip has no repeat of its own; this is the average
 * spacing of the nine blinks in the character-creator close-up idle (onsets from 0.70 s to 20.30 s), a Studio choice
 * grounded in that clip rather than a game timing.
 */
export const BLINK_REPEAT_SECONDS = 2.45;
/** What the user reads when the blink could not be made ready (the idle guide explains the one-time preparation). */
export const GAME_BLINK_MISSING = "The game's blink hasn't been prepared on this computer yet.";

/** A joint's world bind for one eye shape, glTF axes: position then rotation quaternion (x, y, z, w). */
export type ShapeBind = [number, number, number, number, number, number, number];
export type GameBlinkDescription = {
  schema: typeof GAME_BLINK_SCHEMA;
  /** The clip's closing half: time 0 is its first frame, 1 its closed frame (`closedTime` seconds into the clip). */
  closure: { animation: string; tracks: string[]; steps: number; clip?: string; closedTime?: number };
  clip: { animation: string; source: string; duration: number; sampleRate: number };
  /** Per eye-shape target (`h091`), the eye-region joints that shape moves. Absent in a bake without morph intake. */
  shapes?: Record<string, Record<string, ShapeBind>>;
};
export type GameBlinkClips = { description: GameBlinkDescription; closure: THREE.AnimationClip; clip: THREE.AnimationClip };

const finiteTracks = (clip: THREE.AnimationClip) => clip.tracks.every(track =>
  track.times.every(Number.isFinite) && track.values.every(Number.isFinite));
const isShapeBind = (value: unknown): value is ShapeBind => Array.isArray(value) && value.length === 7 && value.every(Number.isFinite)
  && Math.abs(Math.hypot(value[3], value[4], value[5], value[6]) - 1) < 1e-4;

/** Check the bake's description (glTF `asset.extras`) and find its two animations; throws a plain error when they don't fit. */
export function parseGameBlink(extras: unknown, animations: readonly THREE.AnimationClip[]): GameBlinkClips {
  const record = extras as Partial<GameBlinkDescription> | undefined;
  if (!record || record.schema !== GAME_BLINK_SCHEMA) throw Error("The prepared blink is from another version; prepare it again.");
  const { closure: closureInfo, clip: clipInfo, shapes } = record;
  if (!closureInfo || typeof closureInfo.animation !== "string" || !Array.isArray(closureInfo.tracks) || !Number.isInteger(closureInfo.steps) || closureInfo.steps < 1)
    throw Error("The prepared blink has no closure description.");
  if (!clipInfo || typeof clipInfo.animation !== "string" || !Number.isFinite(clipInfo.duration) || clipInfo.duration <= 0)
    throw Error("The prepared blink has no clip description.");
  if (shapes !== undefined && (typeof shapes !== "object" || shapes === null || Object.values(shapes).some(joints =>
    typeof joints !== "object" || joints === null || !Object.values(joints).every(isShapeBind))))
    throw Error("The prepared blink's eye shapes are damaged.");
  const closure = animations.find(entry => entry.name === closureInfo.animation);
  const clip = animations.find(entry => entry.name === clipInfo.animation);
  if (!closure || !closure.tracks.length) throw Error("The prepared blink is missing its closure.");
  if (!clip || !clip.tracks.length) throw Error("The prepared blink is missing its clip.");
  // The closure's time axis is the closure weight: it must run from open (0) to closed (1).
  if (closure.tracks.some(track => track.times[0] !== 0 || Math.abs(track.times.at(-1)! - 1) > 1e-6))
    throw Error("The prepared blink's closure doesn't run from open to closed.");
  if (!finiteTracks(closure) || !finiteTracks(clip)) throw Error("The prepared blink contains invalid numbers.");
  return { description: record as GameBlinkDescription, closure, clip };
}

/** The eye-shape target a mesh shows now (`h091`), from its `<target>_eyes` morph influences; null for the base shape. */
export function activeEyeShape(mesh: { morphTargetDictionary?: Record<string, number>; morphTargetInfluences?: number[] }): string | null {
  for (const [name, index] of Object.entries(mesh.morphTargetDictionary ?? {})) {
    const match = /^([A-Za-z0-9]+)_eyes$/.exec(name);
    if (match && (mesh.morphTargetInfluences?.[index] ?? 0) > .5) return match[1]!;
  }
  return null;
}

/** One rig node: its exported rest, the rest it has for the current eye shape, and the channels the two animations drive. */
type Driver = {
  node: THREE.Object3D; inverseBind: THREE.Matrix4;
  baseLocal: THREE.Matrix4; baseWorld: THREE.Matrix4; restLocal: THREE.Matrix4;
  /** restLocal × baseLocal⁻¹ for a re-seated animated node (the bake composed its local poses on baseLocal); null when unchanged. */
  fix: THREE.Matrix4 | null;
  basePosition: THREE.Vector3; baseQuaternion: THREE.Quaternion;
};
type Channel = { driver: Driver; position?: THREE.Interpolant; quaternion?: THREE.Interpolant };
type Binding = { bone: THREE.Object3D; driver: Driver; worldBind: THREE.Matrix4;
  position: THREE.Vector3; rotation: THREE.Quaternion; scale: THREE.Vector3 };

export class GameBlink {
  readonly bindings: Binding[] = [];
  /** Target bones with no rig driver of their name (a detail's rigid-part bone, say); they are left alone. */
  readonly unmapped: string[] = [];
  /** Called after anything but playback changes the pose or playing state, so a render-on-demand viewport draws it. */
  onChange?: () => void;
  private closureValue = 0;
  private playback = false;
  private elapsed = 0;
  private shapeName: string | null = null;
  private readonly drivers = new Map<string, Driver>();
  /** Every rig node, parents first. */
  private readonly order: Driver[] = [];
  private readonly closureChannels: Channel[];
  private readonly clipChannels: Channel[];
  private readonly delta = new THREE.Matrix4();
  private readonly local = new THREE.Matrix4();
  private readonly sampled = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), unit: new THREE.Vector3(1, 1, 1) };
  readonly description: GameBlinkDescription;
  readonly clipDuration: number;

  constructor(readonly source: THREE.Object3D, clips: GameBlinkClips, targets: readonly THREE.Object3D[],
    readonly repeatSeconds = BLINK_REPEAT_SECONDS) {
    this.description = clips.description;
    this.clipDuration = clips.clip.duration;
    source.updateMatrixWorld(true);
    source.traverse(node => {
      node.updateMatrix();
      const driver: Driver = { node, inverseBind: node.matrixWorld.clone().invert(), baseLocal: node.matrix.clone(),
        baseWorld: node.matrixWorld.clone(), restLocal: node.matrix.clone(),
        fix: null, basePosition: node.position.clone(), baseQuaternion: node.quaternion.clone() };
      this.drivers.set(node.name, driver); this.order.push(driver);
    });
    this.closureChannels = this.channels(clips.closure);
    this.clipChannels = this.channels(clips.clip);
    this.bind(targets);
  }
  private channels(clip: THREE.AnimationClip): Channel[] {
    const out = new Map<Driver, Channel>();
    for (const track of clip.tracks) {
      const parsed = THREE.PropertyBinding.parseTrackName(track.name);
      const driver = this.drivers.get(parsed.nodeName), property = parsed.propertyName;
      if (!driver || (property !== "position" && property !== "quaternion")) continue;
      const channel = out.get(driver) ?? { driver };
      // Linear keys, as the bake writes them; rotations interpolate as quaternions.
      if (property === "quaternion") channel.quaternion = new THREE.QuaternionLinearInterpolant(track.times, track.values, 4);
      else channel.position = new THREE.LinearInterpolant(track.times, track.values, 3);
      out.set(driver, channel);
    }
    return [...out.values()];
  }
  private bind(targets: readonly THREE.Object3D[]) {
    for (const bone of targets) {
      const driver = this.drivers.get(bone.name);
      if (!driver) { this.unmapped.push(bone.name); continue; }
      this.bindings.push({ bone, driver, worldBind: bone.matrixWorld.clone(),
        position: bone.position.clone(), rotation: bone.quaternion.clone(), scale: bone.scale.clone() });
    }
    const depth = (o: THREE.Object3D): number => o.parent ? 1 + depth(o.parent) : 0;
    this.bindings.sort((a, b) => depth(a.bone) - depth(b.bone));
  }
  /** The closure the slider holds, 0 (open) to 1 (closed). */
  get closure() { return this.closureValue; }
  get playing() { return this.playback; }
  /** The eye-shape target the rig is seated on (null: the base shape, or a shape the bake has no binds for). */
  get shape() { return this.shapeName; }
  /** Seconds into the current Play blink cycle (0 while not playing). */
  get time() { return this.playback ? this.elapsed % this.repeatSeconds : 0; }
  /** Hold the solved closure at `value` (clamped to 0–1); stops Play blink. Zero restores the captured pose exactly. */
  setClosure(value: number) {
    this.closureValue = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    this.playback = false; this.elapsed = 0;
    this.applyHeld();
    this.onChange?.();
  }
  /** Start or stop playing the game's blink clip; stopping returns to the held closure. */
  setPlaying(playing: boolean) {
    this.playback = playing; this.elapsed = 0;
    if (playing) this.update(0); else this.applyHeld();
    this.onChange?.();
  }
  /** Open, not playing, exact captured pose (the idle is taking over). */
  reset() { this.closureValue = 0; this.playback = false; this.elapsed = 0; this.restore(); this.onChange?.(); }
  /**
   * Seat the rig on an eye shape's joint binds (`h091`), or the base shape (null). A shape the bake has no binds for
   * (a modded eye shape, say) keeps the base seat. The current pose is applied again at once.
   */
  setShape(target: string | null) {
    const binds = (target && this.description.shapes?.[target]) || null;
    const next = binds ? target : null;
    if (next === this.shapeName) return;
    this.shapeName = next;
    const worlds = new Map<THREE.Object3D, THREE.Matrix4>(), unit = new THREE.Vector3(1, 1, 1);
    for (const driver of this.order) {
      const parent = driver.node.parent ? worlds.get(driver.node.parent) : undefined, bind = binds?.[driver.node.name];
      if (!bind && !parent) {
        // Neither this joint nor any above it moves with the shape: its exported rest, exactly.
        driver.restLocal.copy(driver.baseLocal); driver.inverseBind.copy(driver.baseWorld).invert(); driver.fix = null;
        continue;
      }
      // A joint the shape lists sits at its bind; one below a re-seated joint keeps its exported rest relative to it.
      const world = bind ? new THREE.Matrix4().compose(new THREE.Vector3().fromArray(bind, 0), new THREE.Quaternion().fromArray(bind, 3), unit)
        : parent!.clone().multiply(driver.baseLocal);
      worlds.set(driver.node, world);
      const parentWorld = parent ?? (driver.node.parent ? this.drivers.get(driver.node.parent.name)?.baseWorld : undefined) ?? new THREE.Matrix4();
      driver.restLocal.copy(parentWorld).invert().multiply(world);
      driver.inverseBind.copy(world).invert();
      driver.fix = driver.restLocal.clone().multiply(driver.baseLocal.clone().invert());
    }
    if (this.playback) this.update(0); else this.applyHeld();
    this.onChange?.();
  }
  /** Advance Play blink; the held closure needs no per-frame work. */
  update(seconds: number) {
    if (!this.playback) return;
    if (Number.isFinite(seconds)) this.elapsed += Math.max(0, Math.min(seconds, .1));
    // Between blinks the clip's last frame holds (its gaze-down track ends slightly above zero), so each repeat is continuous.
    this.apply(this.clipChannels, Math.min(this.elapsed % this.repeatSeconds, this.clipDuration));
  }
  /** Bind bones loaded later (a resolved detail's own skeleton copy) in their neutral pose; the current blink applies at once. */
  attach(targets: readonly THREE.Object3D[]) {
    if (!targets.length) return;
    this.bind(targets);
    if (this.playback) this.update(0); else this.applyHeld();
    this.onChange?.();
  }
  /** Forget bones that leave the scene, restoring their captured pose first. */
  detach(targets: readonly THREE.Object3D[]) {
    if (!targets.length) return;
    const leaving = new Set(targets);
    for (let i = this.bindings.length - 1; i >= 0; i--) {
      const binding = this.bindings[i]!;
      if (!leaving.has(binding.bone)) continue;
      binding.bone.position.copy(binding.position); binding.bone.quaternion.copy(binding.rotation); binding.bone.scale.copy(binding.scale);
      binding.bone.updateWorldMatrix(false, false);
      this.bindings.splice(i, 1);
    }
    for (let i = this.unmapped.length - 1; i >= 0; i--) if (targets.some(bone => bone.name === this.unmapped[i])) this.unmapped.splice(i, 1);
    this.onChange?.();
  }
  restore() {
    for (const b of this.bindings) {
      b.bone.position.copy(b.position); b.bone.quaternion.copy(b.rotation); b.bone.scale.copy(b.scale);
      b.bone.updateWorldMatrix(false, false);
    }
  }
  private applyHeld() {
    if (this.closureValue === 0) this.restore();
    else this.apply(this.closureChannels, this.closureValue);
  }
  private apply(channels: readonly Channel[], time: number) {
    for (const driver of this.order) driver.restLocal.decompose(driver.node.position, driver.node.quaternion, driver.node.scale);
    const { position, quaternion, unit } = this.sampled;
    for (const { driver, position: p, quaternion: q } of channels) {
      position.copy(driver.basePosition); quaternion.copy(driver.baseQuaternion);
      if (p) position.fromArray(p.evaluate(time));
      if (q) quaternion.fromArray(q.evaluate(time)).normalize();
      if (!driver.fix) { driver.node.position.copy(position); driver.node.quaternion.copy(quaternion); driver.node.scale.copy(unit); continue; }
      this.local.compose(position, quaternion, unit).premultiply(driver.fix);
      this.local.decompose(driver.node.position, driver.node.quaternion, driver.node.scale);
    }
    this.source.updateMatrixWorld(true);
    for (const b of this.bindings) {
      this.delta.multiplyMatrices(b.driver.node.matrixWorld, b.driver.inverseBind).multiply(b.worldBind);
      this.local.copy(b.bone.parent!.matrixWorld).invert().multiply(this.delta);
      this.local.decompose(b.bone.position, b.bone.quaternion, b.bone.scale);
      b.bone.updateWorldMatrix(false, false);
    }
  }
}

/** Load the local blink asset and bind it to `targets`; throws plain errors (GAME_BLINK_MISSING when it was never prepared). */
export async function loadGameBlink(targets: readonly THREE.Object3D[], fetcher: (url: string) => Promise<Response> = fetch): Promise<GameBlink> {
  let response: Response;
  try { response = await fetcher(GAME_BLINK_ASSET); }
  catch { throw Error(GAME_BLINK_MISSING); }
  if (!response.ok) throw Error(GAME_BLINK_MISSING);
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), "");
  const clips = parseGameBlink(gltf.asset?.extras, gltf.animations);
  return new GameBlink(gltf.scene, clips, targets);
}

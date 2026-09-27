import { expect, test } from "bun:test";
import * as THREE from "three";
import { BUILT_IN_CATALOGUE, DEFAULT_IDLE, IDLE_CATALOGUE_SCHEMA, parseIdleCatalogue, type IdleEntry } from "../src/idle-catalogue";
import { IdleAnimation } from "../src/idle-animation";
import { MotionActions, type MotionPort } from "../src/motion-actions";
import { bodyStateFor, creatorPuppetFeet } from "../src/character-detail-plan";
import { WorkspaceComposer } from "../src/workspace-composer";
import { parseWorkspace, serializeWorkspace } from "../src/workspace-state";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { freshWorkspace } from "./fixtures/eye-region";
import type { CcoResource } from "../src/cco-model";

const entry = (id: string, extra: Partial<IdleEntry> = {}): IdleEntry => ({ id, label: id, clip: `ui_${id}`, body: `cc-idle-body-${id}.glb`, duration: 10,
  screen: "creator", state: id, flags: [], face: null, puppet: "creator", evidence: "[resource] test", ...extra });
const catalogue = (idles: IdleEntry[]) => ({ schema: IDLE_CATALOGUE_SCHEMA, source: { graph: "g", set: "s", rig: "r" }, idles, left: [] });

test("the catalogue reads only well-formed entries; the built-in one stands for the close-up idle alone", () => {
  const parsed = parseIdleCatalogue(catalogue([entry(DEFAULT_IDLE), entry("inventory", { screen: "inventory", puppet: null, face: { clip: "ui_closeup_shot", file: "cc-idle-face.glb" } })]));
  expect(parsed.idles.map(item => [item.id, item.puppet])).toEqual([["closeup", "creator"], ["inventory", null]]);
  expect(() => parseIdleCatalogue(catalogue([entry("../x")]))).toThrow("an id");
  expect(() => parseIdleCatalogue(catalogue([entry("a", { body: "../../secret.glb" })]))).toThrow("a body file");
  expect(() => parseIdleCatalogue(catalogue([entry("a"), entry("a")]))).toThrow("repeated id");
  expect(() => parseIdleCatalogue({ ...catalogue([entry("a")]), schema: "other" })).toThrow("not a catalogue");
  expect(parseIdleCatalogue(BUILT_IN_CATALOGUE)).toEqual(BUILT_IN_CATALOGUE);
  // A face with a one-shot showcase before its loop (the eyes section) keeps where its loop starts; a nonsense start is refused.
  const eyes = { clip: "ui_closeup_shot_eyes_section", file: "cc-idle-face-eyes-section.glb", loopFrom: 4.5 };
  expect(parseIdleCatalogue(catalogue([entry("closeup-eyes", { clip: "ui_closeup_shot", face: eyes })])).idles[0]!.face).toEqual(eyes);
  expect(() => parseIdleCatalogue(catalogue([entry("closeup-eyes", { clip: "ui_closeup_shot", face: { ...eyes, loopFrom: -1 } })]))).toThrow("a face loop start");
});

/** A motion port with a catalogue; `selectIdle` resolves or rejects as told, and records what it was asked. */
function motionPort(idles: IdleEntry[], outcome: "ok" | "fail" = "ok", asked: string[] = []): MotionPort {
  const noop = () => {};
  return { available: true, blink: { available: false }, idles, setIdle: noop, setIdlePaused: noop, setIdleContributions: noop, setBlink: noop, animateBlink: noop,
    selectIdle: async id => { asked.push(id); if (outcome === "fail") throw Error("missing file"); } };
}

test("choosing an idle shows it at once, loads it behind, and a failed load puts the previous one back", async () => {
  const idles = [entry("closeup"), entry("fullbody"), entry("inventory", { puppet: null, screen: "inventory" })];
  const asked: string[] = [];
  const motion = new MotionActions(freshWorkspace().preview, motionPort(idles, "ok", asked));
  expect(motion.snapshot()).toMatchObject({ idleClip: "closeup", idleLoading: false });
  expect(motion.snapshot().idles.map(item => item.id)).toEqual(["closeup", "fullbody", "inventory"]);
  expect(motion.capability({ kind: "motion.setIdleClip", clip: "nope" })).toMatchObject({ available: false });
  motion.dispatch({ kind: "motion.setIdleClip", clip: "inventory" });
  expect(motion.snapshot()).toMatchObject({ idleClip: "inventory", idleLoading: true });
  await Bun.sleep(0);
  expect(motion.snapshot()).toMatchObject({ idleClip: "inventory", idleLoading: false });
  expect(asked).toEqual(["inventory"]);
  const failing = new MotionActions(freshWorkspace().preview, motionPort(idles, "fail"));
  failing.dispatch({ kind: "motion.setIdleClip", clip: "fullbody" });
  expect(failing.snapshot().idleClip).toBe("fullbody");
  await Bun.sleep(0);
  expect(failing.snapshot()).toMatchObject({ idleClip: "closeup", idleLoading: false });
});

test("the chosen idle is stored only when it isn't the default, and a stored one is played again on restore", async () => {
  const idles = [entry("closeup"), entry("inventory", { puppet: null })];
  const workspace = freshWorkspace();
  const port = motionPort(idles);
  const motion = new MotionActions(workspace.preview, port);
  const compose = () => new WorkspaceComposer(workspace, { editor: () => ({}) as never, uvView: () => workspace.uvView, savedV: () => workspace.savedV,
    collections: () => workspace.collections, quality: () => 512, preview: () => ({ ...workspace.preview, camera: { position: [0, 0, 1], target: [0, 0, 0], fov: 30 } }),
    motion: () => motion.snapshot() });
  const composer = compose(); composer.setPreviewReady();
  expect("idleClip" in composer.capture().preview).toBe(false);
  motion.dispatch({ kind: "motion.setIdleClip", clip: "inventory" });
  const stored = composer.capture();
  expect(stored.preview.idleClip).toBe("inventory");
  // Read back through the workspace reader and restored: the stored idle is asked for again.
  const reread = { state: parseWorkspace(JSON.parse(JSON.stringify(serializeWorkspace(stored, STUDIO_DOCUMENTS))), STUDIO_DOCUMENTS) };
  expect(reread.state.preview.idleClip).toBe("inventory");
  const asked: string[] = [];
  const restored = new MotionActions(reread.state.preview, motionPort(idles, "ok", asked));
  restored.restore();
  expect(restored.snapshot().idleClip).toBe("inventory");
  expect(asked).toEqual(["inventory"]);
});

test("another idle plays on the same rigs with its phase carried over", () => {
  const source = new THREE.Group(), hips = new THREE.Bone(); hips.name = "Hips"; source.add(hips);
  const up = (y: number, name: string) => new THREE.AnimationClip(name, 2, [new THREE.VectorKeyframeTrack("Hips.position", [0, 2], [0, y, 0, 0, y, 0])]);
  const target = new THREE.Bone(); target.name = "Hips"; new THREE.Group().add(target);
  const idle = new IdleAnimation(source, up(1, "a"), [target], {});
  idle.setEnabled(true); idle.update(0.05);
  expect(target.position.y).toBeCloseTo(1, 6);
  idle.setClips(up(2, "b"));
  expect(idle.clip.name).toBe("b");
  expect(target.position.y).toBeCloseTo(2, 6);
  expect(idle.time).toBeCloseTo(0.05, 6);
});

test("the creator's idles stand V on the creator puppet's feet; footwear and the inventory's idle keep their own", () => {
  const cco = { parts: { head: { options: [], groups: [] }, arms: { options: [], groups: [] },
    body: { options: [], groups: [{ name: "character_creation", options: ["body_color", "lifted_feet"] }, { name: "flat_feet", options: ["flat_feet"] }] } } } as unknown as CcoResource;
  expect(creatorPuppetFeet(cco)).toBe("lifted");
  expect(bodyStateFor("flat", "creator", cco)).toEqual({ feet: "lifted" });
  expect(bodyStateFor("flat", undefined, cco)).toEqual({ feet: "flat" });
  expect(bodyStateFor("lifted", undefined, cco)).toEqual({ feet: "lifted" });
  // A resource whose creator group lists no feet (the masculine one) keeps the footwear's.
  const none = { parts: { ...cco.parts, body: { options: [], groups: [] } } } as unknown as CcoResource;
  expect(bodyStateFor(undefined, "creator", none)).toEqual({ feet: "flat" });
});

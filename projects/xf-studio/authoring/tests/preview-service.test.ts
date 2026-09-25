import { expect, test } from "bun:test";
import { MotionActions, type MotionPort } from "../src/motion-actions";
import { PreviewQualityActions } from "../src/preview-quality-actions";
import { SavedAppearanceActions } from "../src/saved-appearance-actions";
import { freshWorkspace } from "../src/workspace-state";
import type { SavedV } from "../src/save-reader";

test("motion service restores composition before clock, preserves pause phase and explains disabled actions", () => {
  const calls: string[] = [], preview = freshWorkspace().preview;
  preview.idle = true; preview.idlePaused = true; preview.idleTime = 2.5;
  preview.idleBody = false; preview.idleFace = true;
  const idle = { enabled: false, time: 0, paused: false, bodyEnabled: true, faceEnabled: true,
    seek(time: number) { this.time = time; calls.push(`seek:${time}`); } };
  const port: MotionPort = { available: true, idle,
    setIdle: enabled => { idle.enabled = enabled; calls.push(`idle:${enabled}`); },
    setIdlePaused: paused => { idle.paused = paused; calls.push(`pause:${paused}`); },
    setIdleContributions: (body, face) => { idle.bodyEnabled = body; idle.faceEnabled = face; calls.push(`parts:${body}:${face}`); },
    setBlink: value => calls.push(`blink:${value}`), animateBlink: playing => calls.push(`play:${playing}`) };
  const actions = new MotionActions(preview, port);
  actions.restore();
  expect(calls).toEqual(["parts:false:true", "idle:true", "seek:2.5", "pause:true"]);
  expect(actions.snapshot()).toMatchObject({ idle: true, idlePaused: true, idleTime: 2.5, idleBody: false, blink: 0 });
  expect(actions.capability({ kind: "motion.playBlink", playing: true }).available).toBe(false);
  actions.dispatch({ kind: "motion.setPaused", paused: false });
  expect(actions.snapshot().idleTime).toBe(2.5);
  actions.dispatch({ kind: "motion.setIdle", enabled: false });
  actions.dispatch({ kind: "motion.setBlink", value: .4 });
  expect(actions.snapshot()).toMatchObject({ idle: false, blink: .4, blinkPlaying: false });
  expect(actions.capability({ kind: "motion.setBlink", value: 2 }).available).toBe(false);
});

test("quality service validates tiers before replacing resources and tracks recoverable failures", () => {
  const replaced: number[] = [];
  const actions = new PreviewQualityActions(1024, { assess: size => size === 4096
    ? { accepted: false, error: "Texture budget exceeded." } : { accepted: true },
    replace: size => replaced.push(size) });
  let notices = 0; actions.subscribe(() => notices++);
  expect(actions.dispatch({ kind: "quality.set", size: 4096 })).toBe(false);
  expect(actions.snapshot()).toMatchObject({ size: 1024, error: "Texture budget exceeded." });
  expect(replaced).toEqual([]);
  expect(actions.dispatch({ kind: "quality.set", size: 512 })).toBe(true);
  expect(replaced).toEqual([512]);
  actions.fail("Worker stopped.");
  expect(actions.snapshot()).toMatchObject({ size: 512, blocked: true, error: "Worker stopped." });
  expect(actions.recover()).toBe(true);
  expect(actions.snapshot()).toMatchObject({ blocked: false, error: "" });
  expect(notices).toBe(4);
});

test("saved appearance service applies validated V atomically and exposes eye selection as data", () => {
  const saved: SavedV = { schema: "eye-artistry/saved-v-1", saveVersion: 1, gameVersion: 2310,
    presetVersion: 1, isMale: false, brainIsMale: false,
    groups: { head: [{ name: "character_customization", appearances: [], morphs: [
      { region: "eyes", target: "h091", censorFlag: 0, censorAction: 0 }] }], arms: [], body: [] },
    perspectives: [], tags: [], evidence: { nodeName: "appearance", nodeBytes: 1, bytesRead: 1,
      trailingBytes: 0, chunks: 1, decompressedBytes: 1 } };
  let applied = 0;
  const actions = new SavedAppearanceActions({ apply: () => { applied++;
    return { applied: ["h091_eyes"], appearanceReferences: 0, matchedDetails: [], matchedHair: false,
      matchedPiercing: false, eyeAppearance: { message: "Reference eye" }, eyeShape: 9 }; } });
  const state = actions.dispatch({ kind: "savedV.restore", value: saved });
  expect(state.suggestedEyeShape).toBe(9);
  expect(state.result?.applied).toEqual(["h091_eyes"]);
  (state.savedV!.groups.head[0].morphs[0] as any).target = "h999";
  expect(actions.snapshot().savedV!.groups.head[0].morphs[0].target).toBe("h091");
  expect(() => actions.dispatch({ kind: "savedV.load", bytes: new Uint8Array(40) })).toThrow();
  expect(applied).toBe(1);
  expect(actions.snapshot().savedV!.gameVersion).toBe(2310);
});

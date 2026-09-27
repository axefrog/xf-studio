// The lighting mirror's offline mapping (tools/lighting/mirror-map.ts): frames, units, the directional stand-in,
// budgets, world placement and the read-back round trip. No game is involved.

import { describe, expect, test } from "bun:test";
import {
  coneAt, falloffAt, illuminanceAt, length, linearFromSrgb8, localToStudio, normalise, placeInWorld, planMirror, quatFromYAxis,
  readingToStudio, rotate, srgb8FromLinear, studioToLocal, type Anchor, type GameLightReading, type MirrorSourceLight,
  type MirrorSourceSetup, type Vec3,
} from "../lighting/mirror-map.ts";

const close = (a: readonly number[], b: readonly number[], digits = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));
const RAD = Math.PI / 180;

// Main_Face of the female creator rig (knowledge/creator-lighting.md section 2, resource values), in the Studio frame.
const MAIN_FACE_POS: Vec3 = [-0.30, 1.00, -0.79];
const MAIN_FACE_AXIS: Vec3 = [0.36, 0.71, 0.61];
const HEAD: Vec3 = [-0.03, 1.62, 0];

const spot = (over: Partial<MirrorSourceLight> = {}): MirrorSourceLight => ({
  id: "key", name: "Key", type: "spot", position: [0.5, 1.9, -1.2], target: HEAD, colour: [1, 1, 1], intensity: 10, shadows: false,
  angle: 20 * RAD, penumbra: 0.5, decay: 2, distance: 6, ...over,
});
const setup = (lights: MirrorSourceLight[], over: Partial<MirrorSourceSetup> = {}): MirrorSourceSetup =>
  ({ lights, focus: HEAD, environment: 0, backdrop: "black", display: "game", exposure: 0.53, ...over });

describe("frames", () => {
  test("Studio and V's local game frame are inverse maps", () => {
    const v: Vec3 = [0.1, 1.7, -0.4];
    close(localToStudio(studioToLocal(v)), v);
  });
  test("a light in front of V at V's left stays in front at V's left", () => {
    const local = studioToLocal(MAIN_FACE_POS);
    expect(local[0]).toBeLessThan(0); // V's left
    expect(local[1]).toBeGreaterThan(0); // in front
    expect(local[2]).toBeCloseTo(1.0, 12); // height kept
  });
  test("both frames are right-handed: right x forward = up", () => {
    // Studio: right +X, forward -Z, up +Y; mapped to local they must be x, y, z.
    close(studioToLocal([1, 0, 0]), [1, 0, 0]);
    close(studioToLocal([0, 0, -1]), [0, 1, 0]);
    close(studioToLocal([0, 1, 0]), [0, 0, 1]);
  });
});

describe("colour", () => {
  test("the sRGB encode inverts the Studio's decode on 8-bit values", () => {
    for (const c of [[165, 228, 255], [255, 25, 128], [191, 254, 255], [0, 0, 0]] as const) close(srgb8FromLinear(linearFromSrgb8(c)), c, 12);
  });
  test("unset colour is white", () => close(linearFromSrgb8(null), [1, 1, 1]));
});

describe("planning", () => {
  test("a spot converts with the inverse of the Studio's isotropic reading", () => {
    const plan = planMirror(setup([spot()]));
    const l = plan.lights[0]!;
    expect(l.intensity).toBeCloseTo(4 * Math.PI * 10, 9);
    expect(l.attenuation).toBe("inverse-square");
    expect(l.radius).toBe(6);
    expect(l.outerAngle).toBeCloseTo(40, 9);
    expect(l.innerAngle).toBeCloseTo(20, 9);
    expect(l.origin).toBe("converted");
    // The illuminance at the focus is the Studio's I / d^2 times the windowed falloff and the engine cone (1 on axis).
    const d = length([0.53, 0.28, 1.2]);
    const window = Math.pow(1 - Math.pow(d / 6, 4), 2);
    expect(illuminanceAt(l, plan.focusLocal)).toBeCloseTo(10 * window / (d * d), 9);
  });

  test("native values are carried untouched, and a later Studio edit scales them", () => {
    const game = { lumen: 40, falloff: "linear" as const, radius: 5, softness: 2, outer: 45, inner: 15, colour: null, localShadows: false,
      contactShadows: "character" as const, sourceRadius: 0.1, studioIntensity: 7 };
    const target: Vec3 = [MAIN_FACE_POS[0] + MAIN_FACE_AXIS[0], MAIN_FACE_POS[1] + MAIN_FACE_AXIS[1], MAIN_FACE_POS[2] + MAIN_FACE_AXIS[2]];
    const light = spot({ id: "Main_Face", position: MAIN_FACE_POS, target, intensity: 7, decay: 0, distance: 0, game });
    const kept = planMirror(setup([light])).lights[0]!;
    expect(kept.intensity).toBe(40);
    expect(kept.attenuation).toBe("linear");
    expect(kept.outerAngle).toBe(45);
    expect(kept.innerAngle).toBe(15);
    expect(kept.colour).toEqual([255, 255, 255]);
    expect(kept.contactShadows).toBe("character");
    expect(kept.origin).toBe("native");
    close(kept.localAxis, normalise(studioToLocal(MAIN_FACE_AXIS)));
    expect(planMirror(setup([{ ...light, intensity: 14 }])).lights[0]!.intensity).toBeCloseTo(80, 9);
  });

  test("a Studio light without falloff becomes a flat linear light with the same illuminance at the focus", () => {
    const plan = planMirror(setup([spot({ decay: 0, distance: 0 })]));
    const l = plan.lights[0]!;
    expect(l.attenuation).toBe("linear");
    expect(illuminanceAt(l, plan.focusLocal)).toBeCloseTo(10, 9);
    // Nearly flat across the head: 10 cm nearer or further changes it by well under 1 %.
    const toward = normalise([plan.focusLocal[0] - l.localPosition[0], plan.focusLocal[1] - l.localPosition[1], plan.focusLocal[2] - l.localPosition[2]]);
    const nearer: Vec3 = [plan.focusLocal[0] - toward[0] * 0.1, plan.focusLocal[1] - toward[1] * 0.1, plan.focusLocal[2] - toward[2] * 0.1];
    expect(Math.abs(illuminanceAt(l, nearer) / 10 - 1)).toBeLessThan(0.01);
  });

  test("a directional light becomes a spot 2 m out along its direction with the same illuminance at the focus", () => {
    const sun = spot({ id: "sun", type: "directional", position: [1, 3, -2], target: [0, 1.6, 0], intensity: 3, shadows: true });
    const plan = planMirror(setup([sun]));
    const l = plan.lights[0]!;
    expect(l.origin).toBe("directional");
    const offset: Vec3 = [l.localPosition[0] - plan.focusLocal[0], l.localPosition[1] - plan.focusLocal[1], l.localPosition[2] - plan.focusLocal[2]];
    expect(length(offset)).toBeCloseTo(2, 9);
    close(normalise(offset), normalise(studioToLocal([1, 1.4, -2])));
    expect(illuminanceAt(l, plan.focusLocal)).toBeCloseTo(3, 9);
    expect(l.contactShadows).toBe("character");
  });

  test("budgets keep the strongest lights and shadow casters, and say what they dropped", () => {
    const lights = Array.from({ length: 5 }, (_, i) => spot({ id: `l${i}`, intensity: i + 1, shadows: true }));
    const plan = planMirror(setup(lights), { maxLights: 3, maxShadowCasters: 2 });
    expect(plan.lights.map(l => l.id)).toEqual(["l2", "l3", "l4"]); // the setup's own order
    expect(plan.lights.filter(l => l.enableLocalShadows).map(l => l.id)).toEqual(["l3", "l4"]);
    expect(plan.dropped.map(d => d.id).sort()).toEqual(["l0", "l1", "l2"]);
  });

  test("switched-off lights are left out, and what can't carry over is said in plain words", () => {
    const plan = planMirror(setup([spot({ intensity: 0 })], { environment: 1, backdrop: "studio", display: "aces" }));
    expect(plan.lights).toHaveLength(0);
    expect(plan.dropped[0]!.reason).toContain("switched off");
    expect(plan.notCarried.some(t => t.startsWith("The room light"))).toBe(true);
    expect(plan.notCarried.some(t => t.startsWith("The backdrop"))).toBe(true);
  });

  test("strength scale multiplies every light", () => {
    const a = planMirror(setup([spot()])).lights[0]!.intensity, b = planMirror(setup([spot()]), { strengthScale: 2.5 }).lights[0]!.intensity;
    expect(b / a).toBeCloseTo(2.5, 12);
  });
});

describe("placement", () => {
  const anchor: Anchor = { feet: [100, 200, 10], head: [100.1, 200.05, 11.55], forward: [Math.SQRT1_2, Math.SQRT1_2, 0] };

  test("the entity's +Y lands on the light's axis", () => {
    for (const d of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [0.3, -0.2, 0.9]] as Vec3[]) close(rotate(quatFromYAxis(d), [0, 1, 0]), normalise(d));
  });

  test("feet mode places the rig about V's feet in V's facing, whatever V's yaw", () => {
    const plan = planMirror(setup([spot()]));
    const p = placeInWorld(plan.lights[0]!, plan.focusLocal, anchor, "feet");
    // Local (x right, y forward, z up) with forward = (1,1)/sqrt2 and right = forward x up = (1,-1)/sqrt2.
    const local = plan.lights[0]!.localPosition, s = Math.SQRT1_2;
    close(p.position, [100 + (local[0] + local[1]) * s, 200 + (local[1] - local[0]) * s, 10 + local[2]]);
  });

  test("head mode puts the setup's focus on the live head slot", () => {
    const plan = planMirror(setup([spot({ position: HEAD, target: [HEAD[0], HEAD[1], HEAD[2] - 1] })]));
    // A light placed at the focus itself must land exactly on the live head.
    close(placeInWorld(plan.lights[0]!, plan.focusLocal, anchor, "head").position, anchor.head!);
  });

  test("reading a placed light back gives the Studio light it came from", () => {
    const source = spot({ colour: linearFromSrgb8([191, 254, 255]) });
    const plan = planMirror(setup([source]));
    const spec = plan.lights[0]!, placed = placeInWorld(spec, plan.focusLocal, anchor);
    const reading: GameLightReading = { id: spec.id, name: spec.name, position: placed.position, orientation: placed.orientation, type: "spot",
      unit: "lumen", intensity: spec.intensity, EV: 0, colour: spec.colour, outerAngle: spec.outerAngle, innerAngle: spec.innerAngle,
      softness: spec.softness, attenuation: spec.attenuation, radius: spec.radius, enableLocalShadows: spec.enableLocalShadows,
      contactShadows: spec.contactShadows, sourceRadius: spec.sourceRadius };
    const back = readingToStudio(reading, anchor, HEAD);
    if ("refused" in back) throw new Error(back.refused);
    close(back.position, source.position);
    close(normalise([back.target[0] - back.position[0], back.target[1] - back.position[1], back.target[2] - back.position[2]]),
      normalise([HEAD[0] - source.position[0], HEAD[1] - source.position[1], HEAD[2] - source.position[2]]));
    expect(back.intensity).toBeCloseTo(source.intensity, 9);
    expect(back.angle).toBeCloseTo(source.angle, 9);
    expect(back.penumbra).toBeCloseTo(source.penumbra, 9);
    close(back.colour, source.colour, 12);
    // Mirroring the read again reproduces the same game light exactly.
    const again = planMirror(setup([back])).lights[0]!;
    expect(again.intensity).toBeCloseTo(spec.intensity, 9);
    close(again.localPosition, spec.localPosition);
  });

  test("a light in another unit is refused with a reason", () => {
    const r = readingToStudio({ id: "x", name: "x", position: [0, 0, 0], orientation: { i: 0, j: 0, k: 0, r: 1 }, type: "point", unit: "ev100",
      intensity: 8, EV: 0, colour: [255, 255, 255], outerAngle: 0, innerAngle: 0, softness: 1, attenuation: "inverse-square", radius: 5,
      enableLocalShadows: false, contactShadows: "none", sourceRadius: 0.1 }, anchor, HEAD);
    expect("refused" in r && r.refused).toContain("ev100");
  });
});

describe("engine forms", () => {
  test("falloffs match the decoded shader forms", () => {
    expect(falloffAt("linear", 5, 1)).toBeCloseTo(0.8, 12);
    expect(falloffAt("linear", 5, 6)).toBe(0);
    expect(falloffAt("inverse-square", 5, 1)).toBeCloseTo(Math.pow(1 - Math.pow(0.2, 4), 2), 12);
    expect(falloffAt("inverse-square", 5, 5)).toBe(0);
  });
  test("the cone is full inside the inner angle and zero outside the outer", () => {
    expect(coneAt(45, 15, 2, Math.cos(5 * RAD))).toBe(1);
    expect(coneAt(45, 15, 2, Math.cos(30 * RAD))).toBe(0);
  });
});

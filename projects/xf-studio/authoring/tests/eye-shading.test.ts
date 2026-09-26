import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { corneaNormal, EYE_AXIS_TURN, EYE_TEMPLATE_DEFAULTS, eyeAxes, eyeColourCoordinate, eyeDirectLight, eyeFresnel, eyeIrisWeight,
  eyeLightsBeginChunk, eyeOpticalAxis, eyeParameters, eyeTurnUniform, eyeVisibility, ensureEyeTangents, ggxDistribution, IRIS_PLANE_ORIENTATION, irisPlaneCoordinate,
  patchEyeShader, prepareEyeballGeometry, refract, unpackNormalRG, type Vec3 } from "../src/eye-material";

/**
 * Eye plan ranks 4–5 (knowledge/eye-rendering.md §6.5): the refracted iris coordinate, the two normals and the Eye-class light,
 * against the decompiled 2.31 programs as the eye reference (research/materials/shader-eye.md) writes them. Two kinds of check:
 * - an oracle: the reference's §5.3, §5.5 and §6.1 pseudo-code transcribed line by line here, independently of the adapter's
 *   structured twins, and compared with them on many inputs;
 * - the magnitudes the reference computed from the vanilla scalars (limbus at 0.151, 1.0 mm of parallax at 30°, 1.04 mm without
 *   refraction, the 25° bulge, visibility 0.125 at normal incidence).
 */
const V = EYE_TEMPLATE_DEFAULTS;
const optics = eyeParameters({ scalars: {} }).optics;
const deg = Math.PI / 180;
const n3 = (a: number[]): Vec3 => { const l = Math.hypot(...a); return [a[0]! / l, a[1]! / l, a[2]! / l]; };
const d3 = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/** §5.3 transcribed: `a`, `A`, `T2`, `S`, `I`, `R = refract(I in frame, N in frame, RefractionIndex)`, `h`, `t`, `X`, `Y`, `uvC`. */
function oracleUvC(uv: [number, number], N: Vec3, T: Vec3, P: Vec3, camera: Vec3, mod: { fwd: Vec3; lat: Vec3 }) {
  const [u, v] = uv;
  const fu = u + (u > 0 ? -1 : 1);
  const r = Math.sqrt((fu - 0.5) ** 2 + (0.5 - v) ** 2);
  const iris = Math.min(1, Math.max(0, 1 - (r - (V.IrisCoordFactor - V.IrisCoordMargin)) / (2 * V.IrisCoordMargin)));
  const angle = u > 0 ? V.EyeHorizAngleRight : V.EyeHorizAngleLeft;
  const a = -angle * Math.PI / 180;
  const A = [0, 1, 2].map(k => Math.cos(a) * mod.fwd[k]! + Math.sin(a) * mod.lat[k]!);
  const tA = d3(T, A);
  const T2 = n3([0, 1, 2].map(k => T[k]! - tA * A[k]!));
  const S = [T2[1] * A[2]! - T2[2] * A[1]!, T2[2] * A[0]! - T2[0] * A[2]!, T2[0] * A[1]! - T2[1] * A[0]!];
  const I = n3([0, 1, 2].map(k => P[k]! - camera[k]!));
  const Il = [d3(I, T2), d3(I, A), d3(I, S)], Nl = [d3(N, T2), d3(N, A), d3(N, S)];
  // HLSL refract(i, n, eta): k = 1 − eta²(1 − (n·i)²); 0 when k < 0, else eta·i − (eta·(n·i) + √k)·n.
  const eta = V.RefractionIndex, ni = d3(Nl, Il), kk = 1 - eta * eta * (1 - ni * ni);
  const R = kk < 0 ? [0, 0, 0] : [0, 1, 2].map(k => eta * Il[k]! - (eta * ni + Math.sqrt(kk)) * Nl[k]!);
  const h = Math.max(0, V.EyeRadius * d3(N, A) - V.EyeParallaxPlane);
  const t = V.RefractionAmount * h / Math.max(1e-4, Math.abs(R[1]!));
  const X = R[0]! * t + V.EyeRadius * d3(N, T2), Y = R[2]! * t + V.EyeRadius * d3(N, S);
  const irisUv = [0.5 + X * V.IrisSize / (2 * V.EyeRadius), 0.5 + Y * V.IrisSize / (2 * V.EyeRadius)];
  return [fu + (irisUv[0]! - fu) * iris, (1 - v) + (irisUv[1]! - (1 - v)) * iris];
}

/** §5.5 transcribed (tangent space, before the TBN): `s`, `q`, `e` (z + 0.5 after normalising), the margin, the lerp to the bubble. */
function oracleCornea(fu: number, v: number, bubble: [number, number], iris: number): Vec3 {
  const s = V.EggFullRadius * V.EggSubFactor, q = [fu - 0.5, 0.5 - v, s], lq = Math.hypot(...q), r = Math.hypot(fu - 0.5, 0.5 - v);
  let e: number[];
  if (lq < V.EggFullRadius) { const k = n3(q.map(c => c * (V.EggFullRadius / lq) - c)); e = [k[0], k[1], k[2] + 0.5]; }
  else e = [0, 0, 1.5];
  const m = Math.max(0, Math.min(1, 1 - V.EggMarginFactor * r / Math.sqrt(V.EggFullRadius ** 2 - s * s))) ** V.EggMarginExponent;
  const en = n3([e[0]! * m, e[1]! * m, e[2]!]);
  const b = [bubble[0], bubble[1], Math.sqrt(Math.max(0, 1 - bubble[0] ** 2 - bubble[1] ** 2))];
  return n3([0, 1, 2].map(k => en[k]! + (b[k]! - en[k]!) * (1 - iris)));
}

/** §6.1 transcribed for one light and one channel. */
function oracleLight(N1: Vec3, N2: Vec3, L: Vec3, Vv: Vec3, rough: number, albedo: number, m: number) {
  const r = Math.min(1, Math.max(0.04, rough)), alpha = r * r;
  const H = n3([L[0] + Vv[0], L[1] + Vv[1], L[2] + Vv[2]]);
  const nh = Math.max(0, Math.min(1, d3(N1, H))), vh = Math.max(0, Math.min(1, d3(Vv, H)));
  const D = alpha ** 2 / (Math.PI * (nh * nh * (alpha ** 2 - 1) + 1) ** 2);
  const n1v = Math.min(1, Math.max(1e-5, d3(N1, Vv))), n2l = Math.max(0, Math.min(1, d3(N2, L)));
  const Vis = 0.25 / ((n1v + n2l) * (1 - alpha / 2) + alpha);
  const F0 = 0.04 + (albedo - 0.04) * m;
  const F = F0 + (1 - F0) * 2 ** ((-5.55473 * vh - 6.98316) * vh);
  return { diffuse: albedo * (1 - m) / Math.PI * n2l, specular: D * Vis * F };
}

/** A small deterministic generator (the checks must not depend on a seed from the clock). */
function random(seed: number) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }
const turned = (axis: Vec3, lateral: Vec3, degrees: number): Vec3 => n3([0, 1, 2].map(k => Math.cos(degrees * deg) * axis[k]! + Math.sin(degrees * deg) * lateral[k]!));

describe("§5.2–5.3 the refracted iris coordinate", () => {
  test("the analytic iris weight: 1 inside radius 0.145, 0 beyond 0.185, ½ at the limbus", () => {
    expect(eyeIrisWeight(0.1)).toBe(1);
    expect(eyeIrisWeight(0.1447)).toBe(1);
    expect(eyeIrisWeight(0.165)).toBeCloseTo(0.5, 2);
    expect(eyeIrisWeight(0.186)).toBe(0);
  });

  test("HLSL refract: Snell's law at the index ratio, zero on total internal reflection", () => {
    const i: Vec3 = [Math.sin(30 * deg), -Math.cos(30 * deg), 0], n: Vec3 = [0, 1, 0];
    const r = refract(i, n, 0.97);
    expect(Math.asin(Math.abs(r[0])) / deg).toBeCloseTo(Math.asin(0.97 * 0.5) / deg, 6);
    // 29.0° inside for a 30° view (eye reference §5.3).
    expect(Math.asin(Math.abs(r[0])) / deg).toBeCloseTo(29.0, 1);
    expect(refract([0.99, -0.14, 0], [0, 1, 0], 1.5)).toEqual([0, 0, 0]);
  });

  // A frame like the game's at the pupil: the eye looks along +z, U increases along +x, V increases along −y (down).
  const forward: Vec3 = [0, 0, 1], lateral: Vec3 = [1, 0, 0];
  const straight = { forward, lateral: [0, 0, 0] as Vec3, optics };

  test("a straight view at the pupil samples the iris centre; the limbus (a normal 24.2° off axis) lands at 0.151", () => {
    const at = (theta: number, view: Vec3) => irisPlaneCoordinate(view, [Math.sin(theta), 0, Math.cos(theta)], [1, 0, 0], forward, optics);
    expect(at(0, [0, 0, -1]).uv).toEqual([0.5, 0.5]);
    // The iris plane lies 1.8 mm under the virtual apex.
    expect(at(0, [0, 0, -1]).height).toBeCloseTo(0.0018, 6);
    // Where the normal is 24.2° off the axis the mesh UV radius is 0.165 on the vanilla eyeball; the iris texture is read at 0.151,
    // a 9 % magnification that the IrisSize/(2·EyeRadius) scale makes, not the bending (eye reference §5.3).
    const theta = Math.asin(0.151 / (V.IrisSize / 2));
    expect(theta / deg).toBeCloseTo(24.2, 1);
    const limbus = at(theta, [0, 0, -1]);
    expect(limbus.uv[0] - 0.5).toBeCloseTo(0.151, 3);
    // The refraction alone moves that point by micrometres.
    const bent = (limbus.uv[0] - 0.5) / (V.IrisSize / (2 * V.EyeRadius)) - V.EyeRadius * Math.sin(theta);
    expect(Math.abs(bent)).toBeLessThan(10e-6);
  });

  test("a 30° view shifts the iris under the pupil by 1.0 mm (0.024 iris UV); 1.04 mm with no refraction", () => {
    const view: Vec3 = [-Math.sin(30 * deg), 0, -Math.cos(30 * deg)];
    const shifted = irisPlaneCoordinate(view, forward, [1, 0, 0], forward, optics);
    const mm = (shifted.uv[0] - 0.5) / (V.IrisSize / (2 * V.EyeRadius)) * 1000;
    expect(mm).toBeCloseTo(-0.998, 2);
    expect(shifted.uv[0] - 0.5).toBeCloseTo(-0.0242, 3);
    const unbent = irisPlaneCoordinate(view, forward, [1, 0, 0], forward, { ...optics, RefractionIndex: 1 });
    expect((unbent.uv[0] - 0.5) / (V.IrisSize / (2 * V.EyeRadius)) * 1000).toBeCloseTo(-1.039, 2);
    // Parallax, not a mirror: the ray continues away from the camera, so the point read lies on the far side of the pupil.
    expect(Math.sign(shifted.uv[0] - 0.5)).toBe(Math.sign(view[0]));
  });

  test("the colour coordinate: the mesh coordinate (V-flipped) outside the iris, the iris plane inside it, blended across the limbus", () => {
    // Outside the disc nothing moves, whatever the view.
    const outside = eyeColourCoordinate({ uv: [1.5 + 0.25, 0.5], normal: turned(forward, lateral, 40), tangent: [1, 0, 0], view: n3([-0.5, 0.2, -1]), ...straight });
    expect(outside.iris).toBe(0);
    expect(outside.uv).toEqual([0.75, 0.5]);
    expect(outside.side).toBe("right");
    // At the pupil, straight on: the centre, on either eye.
    for (const u of [1.5, -0.5]) {
      const pupil = eyeColourCoordinate({ uv: [u, 0.5], normal: forward, tangent: [1, 0, 0], view: [0, 0, -1], ...straight });
      expect(pupil.iris).toBe(1);
      expect(pupil.uv[0]).toBeCloseTo(0.5, 12);
      expect(pupil.uv[1]).toBeCloseTo(0.5, 12);
    }
  });

  test("matches the reference's §5.3 line for line on random frames, views and both eyes", () => {
    const next = random(7);
    let worst = 0;
    for (let n = 0; n < 2000; n++) {
      const right = next() < 0.5;
      const fu = 0.5 + (next() - 0.5) * 0.5, v = 0.5 + (next() - 0.5) * 0.5;
      const uv: [number, number] = [fu + (right ? 1 : -1), v];
      // The surface normal tilts with the UV offset like a sphere seen from the front; the tangent is along +U, off by a little.
      const N = n3([(fu - 0.5) * 2.4 + (next() - 0.5) * 0.1, (0.5 - v) * 2.4, 1]);
      const T = n3([1, (next() - 0.5) * 0.2, -N[0]]);
      const P: Vec3 = [N[0] * 0.0137, N[1] * 0.0137, N[2] * 0.0137];
      const camera: Vec3 = [(next() - 0.5) * 0.4, (next() - 0.5) * 0.4, 0.3 + next() * 0.3];
      const mod = { fwd: n3([(next() - 0.5) * 0.2, (next() - 0.5) * 0.2, 1]), lat: n3([1, 0, (next() - 0.5) * 0.1]) };
      const lat = n3([0, 1, 2].map(k => mod.lat[k]! - d3(mod.lat, mod.fwd) * mod.fwd[k]!));
      const view = n3([0, 1, 2].map(k => P[k]! - camera[k]!));
      const ours = eyeColourCoordinate({ uv, normal: N, tangent: T, view, forward: mod.fwd, lateral: lat, optics });
      const theirs = oracleUvC(uv, N, T, P, camera, { fwd: mod.fwd, lat });
      worst = Math.max(worst, Math.abs(ours.uv[0] - theirs[0]!), Math.abs(ours.uv[1] - theirs[1]!));
    }
    expect(worst).toBeLessThan(1e-12);
  });

  test("orientation: literally the iris plane's V runs against the mesh's; as-mesh it follows the bitangent (CCXL guide's in-game image)", () => {
    // A game-like frame at the pupil: U along +x (T), B = cross(N, T) along +y, i.e. towards decreasing V (up the eye), A out along +z.
    const up = 20 * deg, normal: Vec3 = [0, Math.sin(up), Math.cos(up)], tangent: Vec3 = [1, 0, 0], bitangent: Vec3 = [0, Math.cos(up), -Math.sin(up)];
    // The point is above the pupil: the mesh coordinate there is (0.5, 1 − v) with 1 − v > 0.5.
    expect(irisPlaneCoordinate([0, 0, -1], normal, tangent, forward, optics).uv[1]).toBeLessThan(0.5);
    expect(irisPlaneCoordinate([0, 0, -1], normal, tangent, forward, optics, bitangent).uv[1]).toBeGreaterThan(0.5);
    // X is the same either way.
    expect(irisPlaneCoordinate([0, 0, -1], turned(forward, lateral, 20), tangent, forward, optics, bitangent).uv[0])
      .toBeCloseTo(irisPlaneCoordinate([0, 0, -1], turned(forward, lateral, 20), tangent, forward, optics).uv[0], 12);
    expect(IRIS_PLANE_ORIENTATION).toBe("as-mesh");
    // Across the limbus blend the literal reading sweeps the coordinate through the pupil (the dark arcs); as-mesh it stays outside it.
    const limbus = (b?: Vec3) => {
      const theta = Math.asin(0.165 / 0.4);
      return eyeColourCoordinate({ uv: [1.5, 0.5 - 0.165], normal: [0, Math.sin(theta), Math.cos(theta)], tangent, view: [0, 0, -1], forward,
        lateral: [0, 0, 0], optics, ...(b ? { bitangent: [0, Math.cos(theta), -Math.sin(theta)] as Vec3 } : {}) });
    };
    expect(Math.abs(limbus().uv[1] - 0.5)).toBeLessThan(0.02);
    expect(limbus(bitangent).uv[1] - 0.5).toBeGreaterThan(0.15);
  });

  test("the optical axis turns by −EyeHorizAngle about the lateral vector; the uniform carries cos and sin per side", () => {
    const axis = eyeOpticalAxis(forward, lateral, 5);
    expect(Math.atan2(axis[0], axis[2]) / deg).toBeCloseTo(-5, 9);
    expect(eyeTurnUniform(optics).map(x => +x.toFixed(6))).toEqual([Math.cos(-5 * deg), Math.sin(-5 * deg), Math.cos(5 * deg), Math.sin(5 * deg)].map(x => +x.toFixed(6)));
  });
});

describe("§5.4–5.5 the two normals", () => {
  test("normal texels unpack as RG with z reconstructed and no Y flip", () => {
    expect(unpackNormalRG(0.5, 0.5)).toEqual([0, 0, 1]);
    const tilted = unpackNormalRG(1, 0.5);
    expect(tilted[0]).toBe(1);
    expect(tilted[2]).toBe(0);
  });

  test("the cornea bulge: flat at the pupil, about 25° at the limbus before the blend, the bubble outside the iris", () => {
    const flat: Vec3 = [0, 0, 1];
    expect(corneaNormal([0, 0], flat, 1, optics).map(x => +x.toFixed(9))).toEqual([0, 0, 1]);
    const limbus = corneaNormal([0.165, 0], flat, 1, optics);
    expect(Math.atan2(limbus[0], limbus[2]) / deg).toBeCloseTo(25.0, 1);
    // Tilted outward, along the offset: above the pupil (V < 0.5) it leans towards +B.
    expect(corneaNormal([0, 0.12], flat, 1, optics)[1]).toBeGreaterThan(0);
    const ripple = unpackNormalRG(0.52, 0.49);
    expect(corneaNormal([0.3, 0.1], ripple, 0, optics).map(x => +x.toFixed(9))).toEqual(n3([...ripple]).map(x => +x.toFixed(9)));
  });

  test("matches the reference's §5.5 line for line", () => {
    const next = random(11);
    let worst = 0;
    for (let n = 0; n < 2000; n++) {
      const fu = next() * 1.2 - 0.1, v = next() * 1.2 - 0.1, bubble: [number, number] = [(next() - 0.5) * 0.06, (next() - 0.5) * 0.06];
      const iris = eyeIrisWeight(Math.hypot(fu - 0.5, 0.5 - v));
      const ours = corneaNormal([fu - 0.5, 0.5 - v], unpackNormalRG(bubble[0] / 2 + 0.5, bubble[1] / 2 + 0.5), iris, optics);
      const theirs = oracleCornea(fu, v, bubble, iris);
      worst = Math.max(worst, ...ours.map((c, k) => Math.abs(c - theirs[k]!)));
    }
    expect(worst).toBeLessThan(1e-12);
  });
});

describe("§6.1–6.2 the Eye-class light", () => {
  const up: Vec3 = [0, 0, 1];
  test("at normal incidence the visibility is 0.125, half a Standard lobe, and the highlight carries no N·L", () => {
    expect(eyeVisibility(1, 1, 0.05 ** 2)).toBeCloseTo(0.125, 3);
    // The Standard class's height-correlated Smith at normal incidence is 0.5/(2) = 0.25.
    expect(eyeVisibility(1, 1, 0)).toBe(0.125);
    const lit = eyeDirectLight({ n1: up, n2: up, light: up, view: up, roughness: 0.05, albedo: [0.8, 0.8, 0.8], metalness: 0 });
    const a = 0.05 ** 2;
    expect(lit.specular[0]).toBeCloseTo(ggxDistribution(1, a) * eyeVisibility(1, 1, a) * eyeFresnel(0.04, 1), 6);
    expect(lit.diffuse[0]).toBeCloseTo(0.8 / Math.PI, 12);
    // The iris relief turned away from the light: no diffuse, and the cornea highlight grows (the visibility's N2·L shrinks).
    const away = eyeDirectLight({ n1: up, n2: n3([-1, 0, -0.01]), light: up, view: up, roughness: 0.05, albedo: [0.8, 0.8, 0.8], metalness: 0 });
    expect(away.diffuse[0]).toBe(0);
    expect(away.specular[0]).toBeGreaterThan(lit.specular[0]);
    // The sun's cut on N2 removes both.
    expect(eyeDirectLight({ n1: up, n2: n3([-1, 0, -0.01]), light: up, view: up, roughness: 0.05, albedo: [0.8, 0.8, 0.8], metalness: 0, sun: true }))
      .toEqual({ diffuse: [0, 0, 0], specular: [0, 0, 0] });
  });

  test("roughness is clamped to [0.04, 1]; the flat 0.18 lobe is 13 times wider in α than the sclera's 0.05 and carries more energy", () => {
    const peak = (r: number) => eyeDirectLight({ n1: up, n2: up, light: up, view: up, roughness: r, albedo: [1, 1, 1], metalness: 0 }).specular[0];
    expect(peak(0.01)).toBe(peak(0.04));
    expect(0.18 ** 2 / 0.05 ** 2).toBeCloseTo(12.96, 2);
    expect(peak(0.05)).toBeGreaterThan(peak(0.18) * 100);
  });

  test("matches the reference's §6.1 line for line", () => {
    const next = random(3);
    let worst = 0;
    for (let n = 0; n < 2000; n++) {
      const n1 = n3([next() - 0.5, next() - 0.5, 1]), n2 = n3([(next() - 0.5) * 3, (next() - 0.5) * 3, 1]);
      const l = n3([next() - 0.5, next() - 0.5, next()]), v = n3([next() - 0.5, next() - 0.5, 0.3 + next()]);
      const r = next() * 0.6, albedo = next(), m = next() < 0.8 ? 0 : next();
      const ours = eyeDirectLight({ n1, n2, light: l, view: v, roughness: r, albedo: [albedo, albedo, albedo], metalness: m });
      const theirs = oracleLight(n1, n2, l, v, r, albedo, m);
      worst = Math.max(worst, Math.abs(ours.diffuse[0] - theirs.diffuse), Math.abs(ours.specular[0] - theirs.specular) / Math.max(1, theirs.specular));
    }
    expect(worst).toBeLessThan(1e-9);
  });

  test("the shader: the eye light replaces the direct light, the sun cut is on for sun and directional lights only, ambient × 1.1", () => {
    const fragment = patchEyeShader({ fragmentShader: THREE.ShaderLib.standard.fragmentShader }).fragmentShader;
    expect(fragment).toContain("#define RE_Direct RE_Direct_XfsEye");
    expect(fragment).toContain("normal = xfsEyeN1;");
    expect(fragment).toContain("reflectedLight.indirectDiffuse *= xfsEyeAmbient;");
    const begin = eyeLightsBeginChunk();
    const cut = begin.indexOf("xfsEyeSunCut = 1.0;");
    expect(cut).toBeGreaterThan(begin.indexOf("#if ( NUM_SPOT_LIGHTS > 0 )"));
    expect(cut).toBeGreaterThan(begin.indexOf("#if ( NUM_POINT_LIGHTS > 0 )"));
    expect(cut).toBeLessThan(begin.indexOf("#if ( NUM_DIR_LIGHTS > 0 )"));
    expect(() => eyeLightsBeginChunk({ lights_fragment_begin: "void main() {}" })).toThrow("expects");
  });
});

describe("the per-eye vectors from the eyeball geometry", () => {
  /** Two eyeballs like the vanilla mesh: pupils at U 1.5 and −0.5, each pupil turned `turn` degrees outward of straight ahead (+z). */
  function pair(turn: number) {
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
    for (const [centreX, u0, outward] of [[-0.03, 1.5, -1], [0.03, -0.5, 1]] as const) {
      const pupil = n3([Math.sin(turn * deg) * outward, 0, Math.cos(turn * deg)]);
      for (const [du, dv] of [[0, 0], [0.1, 0], [0, 0.1], [-0.1, 0.05], [0.3, 0.3]]) {
        // A rough sphere around the pupil: enough for the pupil search, which only needs the vertex at (0.5, 0.5).
        const n = n3([pupil[0] + du * 2, pupil[1] - dv * 2, pupil[2]]);
        normals.push(...n);
        positions.push(centreX + n[0] * 0.0137, 1.69 + n[1] * 0.0137, n[2] * 0.0137);
        uvs.push(u0 + du, 0.5 + dv);
      }
    }
    return { position: positions, normal: normals, uv: uvs };
  }

  test("forward is the pupils' mean, lateral runs from the \"Right\" eye towards the other, and each pupil's outward turn is measured", () => {
    const { attributes, evidence } = eyeAxes([pair(3.6)]);
    expect(evidence).toMatchObject({ eyes: 2, lateral: true, turn: EYE_AXIS_TURN });
    expect(evidence.pupilTurn.right).toBeCloseTo(3.6, 6);
    expect(evidence.pupilTurn.left).toBeCloseTo(3.6, 6);
    const axis = [...attributes[0]!.axis.subarray(0, 3)], lateral = [...attributes[0]!.lateral.subarray(0, 3)];
    expect(axis.map(x => +x.toFixed(6))).toEqual([0, 0, 1]);
    expect(lateral.map(x => +x.toFixed(6))).toEqual([1, 0, 0]);
    // Every vertex carries the same vectors (each eye's copy is then skinned with that eye).
    expect(attributes[0]!.axis.length).toBe(10 * 3);
  });

  test("with the circle designs' ±3.6° the optical axis is the vanilla pupil itself; the default ±5° turns it 1.4° further out", () => {
    const { attributes } = eyeAxes([pair(3.6)]);
    const forward = [...attributes[0]!.axis.subarray(0, 3)] as unknown as Vec3, lateral = [...attributes[0]!.lateral.subarray(0, 3)] as unknown as Vec3;
    // "Right" parameters drive the eye at raw U > 0 (x −0.03 here, whose outward is −x).
    const right = eyeOpticalAxis(forward, lateral, 3.6), left = eyeOpticalAxis(forward, lateral, -3.6);
    expect(Math.atan2(right[0], right[2]) / deg).toBeCloseTo(-3.6, 6);
    expect(Math.atan2(left[0], left[2]) / deg).toBeCloseTo(3.6, 6);
    expect(Math.atan2(eyeOpticalAxis(forward, lateral, 5)[0], 1) / deg).toBeLessThan(-4.9);
    // "inward" reverses the lateral vector.
    const inward = eyeAxes([pair(3.6)], "inward").attributes[0]!.lateral;
    expect(inward[0]).toBeCloseTo(-1, 6);
  });

  test("one eyeball gives its pupil as the axis and no lateral; none gives zero vectors (drawn unrefracted)", () => {
    const one = pair(3.6);
    const half = { position: one.position.slice(0, 15), normal: one.normal.slice(0, 15), uv: one.uv.slice(0, 10) };
    const single = eyeAxes([half]);
    expect(single.evidence).toMatchObject({ eyes: 1, lateral: false, pupilTurn: {} });
    expect(single.attributes[0]!.axis[2]).toBeCloseTo(Math.cos(3.6 * deg), 6);
    expect([...single.attributes[0]!.lateral.subarray(0, 3)]).toEqual([0, 0, 0]);
    const none = eyeAxes([{ position: [0, 0, 0], normal: [0, 0, 1], uv: [0.1, 0.1] }]);
    expect(none.evidence.eyes).toBe(0);
    expect([...none.attributes[0]!.axis]).toEqual([0, 0, 0]);
  });

  test("tangents: exported ones are kept; computed ones take the game's sign (B = cross(N, T)·w points towards decreasing V)", () => {
    const sphere = new THREE.SphereGeometry(0.0137, 16, 12);
    expect(ensureEyeTangents(sphere)).toBe("computed");
    const tangent = sphere.getAttribute("tangent"), normal = sphere.getAttribute("normal"), uv = sphere.getAttribute("uv"), index = sphere.index!;
    // Check on one triangle: dP/dv from its positions and UVs, against B.
    const [a, b, c] = [index.getX(60), index.getX(61), index.getX(62)];
    const p = (i: number) => new THREE.Vector3().fromBufferAttribute(sphere.getAttribute("position"), i);
    const e1 = p(b).sub(p(a)), e2 = p(c).sub(p(a));
    const du1 = uv.getX(b) - uv.getX(a), dv1 = uv.getY(b) - uv.getY(a), du2 = uv.getX(c) - uv.getX(a), dv2 = uv.getY(c) - uv.getY(a);
    const dPdv = e2.clone().multiplyScalar(du1).sub(e1.clone().multiplyScalar(du2)).divideScalar(du1 * dv2 - du2 * dv1);
    const n = new THREE.Vector3().fromBufferAttribute(normal, a), t = new THREE.Vector3(tangent.getX(a), tangent.getY(a), tangent.getZ(a));
    const bitangent = n.clone().cross(t).multiplyScalar(tangent.getW(a));
    expect(bitangent.dot(dPdv)).toBeLessThan(0);
    expect(ensureEyeTangents(sphere)).toBe("exported");
    const evidence = prepareEyeballGeometry([sphere]);
    expect(sphere.getAttribute("xfsEyeAxis").count).toBe(sphere.getAttribute("position").count);
    expect(sphere.userData.xfsEyeAxes).toMatchObject({ tangents: "exported" });
    expect(evidence.tangents).toEqual(["exported"]);
  });
});

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { materialAdapter } from "../src/character-material-adapters";
import { attachInteriorOcclusion, interiorDepths, interiorLight, interiorOcclusion, MOUTH_OCCLUSION, mouthInteriorUniforms, partingVisibility,
  patchOcclusionShader } from "../src/mouth-occlusion";

/** A square of head surface across the mouth, at depth `z`, facing −Z (the preview's V faces −Z). */
const lipSheet = (z: number, half = 0.05) => ({ positions: new Float32Array([-half, 1.58, z, half, 1.58, z, half, 1.68, z, -half, 1.68, z]),
  index: new Uint16Array([0, 1, 2, 0, 2, 3]) });

describe("the mouth interior's occlusion (mouth-occlusion.ts)", () => {
  test("a point behind a lip parting keeps the share of the outside it sees through it, above a floor; nothing in front keeps all", () => {
    expect(partingVisibility(0)).toBe(1);
    expect(partingVisibility(0.013, 0.010)).toBeCloseTo(0.005 / Math.hypot(0.005, 0.013), 9);
    // Front teeth 13 mm behind the lips, molars 30 mm, and a point beside the face (no head surface in front of it).
    const inside = new Float32Array([0, 1.63, -0.066, 0.02, 1.62, -0.049, 0.2, 1.63, -0.06]);
    const depths = interiorDepths(inside, [lipSheet(-0.079, 0.1)]);
    expect(depths[0]).toBeCloseTo(0.013, 6);
    expect(depths[1]).toBeCloseTo(0.030, 6);
    expect(depths[2]).toBe(0);
    const factors = interiorOcclusion(inside, [lipSheet(-0.079, 0.1)]);
    expect(factors[0]).toBeCloseTo(partingVisibility(0.013, MOUTH_OCCLUSION.unknownParting), 5);
    expect(factors[1]).toBeCloseTo(partingVisibility(0.030, MOUTH_OCCLUSION.unknownParting), 5);
    expect(factors[0]!).toBeGreaterThan(factors[1]!);
    expect(factors[2]).toBe(1);
  });

  test("the lip-gap to darkening mapping: closed keeps the floor, the idle's breaths about 0.11, the teeth page about 0.5 (PREV-147 step A)", () => {
    const front = 0.013;
    // Lips closed: only the floor, which is lower than the earlier stand-in's 0.3.
    expect(MOUTH_OCCLUSION.floor).toBe(0.05);
    expect(interiorLight(front, 0)).toBe(MOUTH_OCCLUSION.floor);
    // The creator idle's two breaths under the male player setup (experiment 034): 2.75 and 2.91 mm.
    expect(interiorLight(front, 0.00275)).toBeCloseTo(0.105, 3);
    expect(interiorLight(front, 0.00291)).toBeCloseTo(0.111, 3);
    // About three times darker than the earlier stand-in's fixed 10 mm gave the front teeth (0.36).
    expect(interiorLight(front, MOUTH_OCCLUSION.unknownParting) / interiorLight(front, 0.00283)).toBeGreaterThan(3);
    // The teeth page's 15 mm parting, and a wide smile brighter still.
    expect(interiorLight(front, 0.015)).toBeCloseTo(0.5, 2);
    expect(interiorLight(front, 0.03)).toBeGreaterThan(0.7);
    // Monotonic in the parting; outside the head always 1.
    let last = 0;
    for (let mm = 0; mm <= 40; mm += 0.5) { const v = interiorLight(front, mm / 1000); expect(v).toBeGreaterThanOrEqual(last); last = v; }
    expect(interiorLight(0, 0)).toBe(1);
    // A negative parting (never measured, but never trusted) is a closed mouth.
    expect(interiorLight(front, -0.002)).toBe(MOUTH_OCCLUSION.floor);
  });

  test("the frontmost head surface in reach sets the depth; a surface behind the point or out of reach does not", () => {
    const inside = new Float32Array([0, 1.63, -0.066]);
    // The inner lip 3 mm in front and the outer lip 13 mm in front: the parting is at the lip's front, so the outer surface counts.
    expect(interiorDepths(inside, [lipSheet(-0.069), lipSheet(-0.079)])[0]).toBeCloseTo(0.013, 6);
    expect(interiorDepths(inside, [lipSheet(-0.05)])[0]).toBe(0);
    expect(interiorDepths(inside, [lipSheet(-0.3)])[0]).toBe(0);
    // The forward axis can be flipped for a V facing +Z.
    expect(interiorDepths(new Float32Array([0, 1.63, 0.066]), [lipSheet(0.079)], { forward: 1 })[0]).toBeCloseTo(0.013, 6);
  });

  test("the patch computes the factor from the depth attribute and the scene's uniforms, and scales every light term by it", () => {
    for (const lib of [THREE.ShaderLib.standard, THREE.ShaderLib.physical]) {
      const uniforms = mouthInteriorUniforms();
      const shader = patchOcclusionShader({ vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} }, uniforms);
      expect(shader.vertexShader).toContain("attribute float xfsInteriorDepth;");
      expect(shader.vertexShader).toContain("uniform float xfsMouthParting;");
      expect(shader.vertexShader).toContain("vXfsOcclusion = xfsInteriorDepth <= 0.0 ? 1.0 : max(xfsMouthFloor,");
      for (const term of ["directDiffuse", "directSpecular", "indirectDiffuse", "indirectSpecular"])
        expect(shader.fragmentShader).toContain(`reflectedLight.${term} *= vXfsOcclusion;`);
      // The program reads the scene's own uniform objects, so a written parting reaches every interior part without a rebuild.
      expect(shader.uniforms.xfsMouthParting).toBe(uniforms.parting);
      expect(shader.uniforms.xfsMouthFloor).toBe(uniforms.floor);
    }
  });

  test("a teeth chunk takes the depths against the drawn head and the scene's parting; without a head it is drawn lit and says so", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 1.63, -0.066, 0.01, 1.63, -0.066, 0, 1.64, -0.066]), 3));
    const teeth = new THREE.Mesh(geometry);
    const sheet = lipSheet(-0.079), head = new THREE.BufferGeometry();
    head.setAttribute("position", new THREE.BufferAttribute(sheet.positions, 3)); head.setIndex(new THREE.BufferAttribute(sheet.index, 1));
    const material = new THREE.MeshStandardMaterial(), uniforms = mouthInteriorUniforms();
    uniforms.parting.value = 0.00283;
    const range = attachInteriorOcclusion(teeth, material, [new THREE.Mesh(head)], uniforms);
    expect(teeth.geometry.getAttribute("xfsInteriorDepth").count).toBe(3);
    expect(range.depth.min).toBeCloseTo(0.013, 5);
    expect(range.min).toBeCloseTo(interiorLight(0.013, 0.00283), 5);
    expect(material.customProgramCacheKey()).toContain("xfs-occlusion-2");
    // The teeth slot wraps whatever adapter its template picks; other slots keep the plain adapter.
    const wrapped = materialAdapter("engine\\materials\\metal_base.remt", "metal_base", "teeth")!, plain = materialAdapter("engine\\materials\\metal_base.remt", "metal_base", "hair")!;
    expect(wrapped).not.toBe(plain);
    expect(wrapped.id).toBe(plain.id);
    const chunk = { chunk: 0, name: "default", template: "engine\\materials\\metal_base.remt", templateName: "metal_base", materialPriority: null, scalars: {},
      colours: {}, textures: {}, profiles: {}, skinProfiles: {}, gradients: {} };
    const lit = wrapped.create(chunk, () => undefined, new THREE.Mesh(geometry.clone()), { slot: "teeth", overMakeup: false, profileEncoding: "srgb-decoded" });
    expect(lit.notes.some(note => note.includes("without the mouth's occlusion"))).toBe(true);
  });
});

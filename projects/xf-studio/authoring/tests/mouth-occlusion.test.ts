import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { materialAdapter } from "../src/character-material-adapters";
import { attachInteriorOcclusion, interiorOcclusion, MOUTH_OCCLUSION, partingVisibility, patchOcclusionShader } from "../src/mouth-occlusion";

/** A square of head surface across the mouth, at depth `z`, facing −Z (the preview's V faces −Z). */
const lipSheet = (z: number, half = 0.05) => ({ positions: new Float32Array([-half, 1.58, z, half, 1.58, z, half, 1.68, z, -half, 1.68, z]),
  index: new Uint16Array([0, 1, 2, 0, 2, 3]) });

describe("the mouth interior's occlusion (mouth-occlusion.ts)", () => {
  test("a point behind a lip parting keeps the share of the outside it sees through it, above a floor; nothing in front keeps all", () => {
    expect(partingVisibility(0)).toBe(1);
    expect(partingVisibility(0.013, 0.010)).toBeCloseTo(0.005 / Math.hypot(0.005, 0.013), 9);
    // Front teeth 13 mm behind the lips, molars 30 mm, and a point beside the face (no head surface in front of it).
    const inside = new Float32Array([0, 1.63, -0.066, 0.02, 1.62, -0.049, 0.2, 1.63, -0.06]);
    const factors = interiorOcclusion(inside, [lipSheet(-0.079, 0.1)]);
    expect(factors[0]).toBeCloseTo(Math.max(MOUTH_OCCLUSION.floor, partingVisibility(0.013)), 5);
    expect(factors[1]).toBeCloseTo(MOUTH_OCCLUSION.floor, 5);
    expect(factors[0]!).toBeGreaterThan(factors[1]!);
    expect(factors[2]).toBe(1);
  });

  test("the frontmost head surface in reach sets the depth; a surface behind the point or out of reach does not", () => {
    const inside = new Float32Array([0, 1.63, -0.066]);
    // The inner lip 3 mm in front and the outer lip 13 mm in front: the parting is at the lip's front, so the outer surface counts.
    const both = interiorOcclusion(inside, [lipSheet(-0.069), lipSheet(-0.079)], { floor: 0 });
    expect(both[0]).toBeCloseTo(partingVisibility(0.013), 5);
    expect(interiorOcclusion(inside, [lipSheet(-0.05)])[0]).toBe(1);
    expect(interiorOcclusion(inside, [lipSheet(-0.3)])[0]).toBe(1);
    // The forward axis can be flipped for a V facing +Z.
    expect(interiorOcclusion(new Float32Array([0, 1.63, 0.066]), [lipSheet(0.079)], { forward: 1, floor: 0 })[0]).toBeCloseTo(partingVisibility(0.013), 5);
  });

  test("the patch scales every light term by the vertex factor, in the standard and physical programs", () => {
    for (const lib of [THREE.ShaderLib.standard, THREE.ShaderLib.physical]) {
      const shader = patchOcclusionShader({ vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader });
      expect(shader.vertexShader).toContain("attribute float xfsOcclusion;");
      expect(shader.vertexShader).toContain("vXfsOcclusion = xfsOcclusion;");
      for (const term of ["directDiffuse", "directSpecular", "indirectDiffuse", "indirectSpecular"])
        expect(shader.fragmentShader).toContain(`reflectedLight.${term} *= vXfsOcclusion;`);
    }
  });

  test("a teeth chunk takes the occlusion against the drawn head; without a head it is drawn lit and says so", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 1.63, -0.066, 0.01, 1.63, -0.066, 0, 1.64, -0.066]), 3));
    const teeth = new THREE.Mesh(geometry);
    const sheet = lipSheet(-0.079), head = new THREE.BufferGeometry();
    head.setAttribute("position", new THREE.BufferAttribute(sheet.positions, 3)); head.setIndex(new THREE.BufferAttribute(sheet.index, 1));
    const material = new THREE.MeshStandardMaterial();
    const range = attachInteriorOcclusion(teeth, material, [new THREE.Mesh(head)]);
    expect(teeth.geometry.getAttribute("xfsOcclusion").count).toBe(3);
    expect(range.min).toBeCloseTo(Math.max(MOUTH_OCCLUSION.floor, partingVisibility(0.013)), 5);
    expect(material.customProgramCacheKey()).toContain("xfs-occlusion-1");
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

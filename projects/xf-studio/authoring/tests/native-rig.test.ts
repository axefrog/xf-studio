import { expect, test } from "bun:test";
import { NativeUnsupportedError } from "../src/native/red-model";
import { readResourceJson } from "../src/native/resource-document";
import { fakeDecompress } from "./fixtures/native-archive";
import { Cr2wBuilder, prop, v, type Bytes } from "./fixtures/native-cr2w";

type Transform = { t: [number, number, number]; q: [number, number, number, number] };
/** A rig: its bone names as a property, then the appendix (i16 parents, one QsTransform per bone). */
function rig(names: string[], parents: number[], transforms: Transform[], extra = 0): Uint8Array {
  const file = new Cr2wBuilder();
  file.export("animRig", [prop("boneNames", "array:CName", v.array(names.map(name => v.cname(name))))], (w: Bytes) => {
    for (const parent of parents) w.i16(parent);
    for (const { t, q } of transforms) {
      for (const x of [...t, 0]) w.f32(x);
      for (const x of q) w.f32(x);
      for (let i = 0; i < 4; i++) w.f32(1);
    }
    for (let i = 0; i < extra; i++) w.u8(0);
  });
  return file.build();
}

test("a rig's appendix reads as its parent indexes and reference transforms", () => {
  const document = readResourceJson(rig(["Root", "Hips"], [-1, 0], [{ t: [0, 0, 0], q: [0, 0, 0, 1] }, { t: [0, -0.04, 1.01], q: [0.5, -0.5, 0.5, 0.5] }]),
    fakeDecompress) as unknown as { Data: { RootChunk: Record<string, any> } };
  const root = document.Data.RootChunk;
  expect(root.boneParentIndexes).toEqual([-1, 0]);
  expect(root.boneTransforms[1].$type).toBe("QsTransform");
  expect(root.boneTransforms[1].Rotation).toEqual({ $type: "Quaternion", i: 0.5, j: -0.5, k: 0.5, r: 0.5 });
  expect(root.boneTransforms[1].Translation.Z).toBeCloseTo(1.01, 6);
  expect(root.boneTransforms[1].Scale).toEqual({ $type: "Vector4", W: 1, X: 1, Y: 1, Z: 1 });
});

test("a rig whose appendix doesn't fit its bones is refused, never misread", () => {
  expect(() => readResourceJson(rig(["Root"], [-1], [{ t: [0, 0, 0], q: [0, 0, 0, 1] }], 2), fakeDecompress)).toThrow(NativeUnsupportedError);
});

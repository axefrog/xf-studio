/** Private, opt-in native-eye input. Staging this asset does not select it for rendering. */
export const NATIVE_EYE_SOURCE = {
  meshSha256: "4d5dfa91efdf54485c5637ad34d64c32ae2f02cad7c52915062f3a0ec0f7aa19",
  morphSha256: "42a19b6a4d2f4060f6785de525d8c55f663fb2a13db804cd84e929e5110d1323",
  glbSha256: "90ec2ee3396c598da5061d7d51f5945c34f7ccbff95246393e11c433e3fc3fdf",
} as const;

export type NativeEyeManifest = {
  schema: "xfs/local-native-eye-1";
  status: "staged-research-only";
  source: typeof NATIVE_EYE_SOURCE;
  asset: { url: "/assets/native-eye/eye-h091.glb"; sha256: typeof NATIVE_EYE_SOURCE.glbSha256; bytes: number };
  limitation: "morph-bind-and-material-policy-unproven";
};

const EXPECTED_PARTS = new Map([
  ["submesh_00_LOD_1_doubled", 12393],
  ["submesh_01_LOD_1", 668],
  ["submesh_02_LOD_1", 152],
]);
const EXPECTED_MORPHS = Array.from({ length: 21 }, (_, i) =>
  `h${String(i * 10 + 11).padStart(3, "0")}_eyes`);
export type NativeEyePart = { name: string; vertices: number; morphs: readonly string[]; bones: readonly string[] };

/** The exact source hash is necessary but insufficient: reject a wrong export layout too. */
export function validateNativeEyeParts(parts: readonly NativeEyePart[]): void {
  if (parts.length !== EXPECTED_PARTS.size) throw Error("Native eye must contain exactly three source chunks");
  const names = new Set<string>();
  for (const part of parts) {
    const expectedVertices = EXPECTED_PARTS.get(part.name);
    if (names.has(part.name) || expectedVertices === undefined || part.vertices !== expectedVertices)
      throw Error(`Unexpected native eye chunk ${part.name}`);
    names.add(part.name);
    if (part.bones.length !== 57 || new Set(part.bones).size !== 57 ||
        !part.bones.includes("l_J_eye_JNT") || !part.bones.includes("r_J_eye_JNT"))
      throw Error(`Native eye chunk ${part.name} has an unexpected facial rig`);
    if (part.morphs.length !== 21 || new Set(part.morphs).size !== 21 ||
        EXPECTED_MORPHS.some(name => !part.morphs.includes(name)))
      throw Error(`Native eye chunk ${part.name} lacks the expected eye morphs`);
  }
}

export function parseNativeEyeManifest(value: unknown): NativeEyeManifest {
  const v = value as Partial<NativeEyeManifest> | null;
  if (!v || v.schema !== "xfs/local-native-eye-1" || v.status !== "staged-research-only" ||
      v.limitation !== "morph-bind-and-material-policy-unproven" || !v.source || !v.asset ||
      v.source.meshSha256 !== NATIVE_EYE_SOURCE.meshSha256 ||
      v.source.morphSha256 !== NATIVE_EYE_SOURCE.morphSha256 ||
      v.source.glbSha256 !== NATIVE_EYE_SOURCE.glbSha256 ||
      v.asset.url !== "/assets/native-eye/eye-h091.glb" ||
      v.asset.sha256 !== NATIVE_EYE_SOURCE.glbSha256 ||
      !Number.isSafeInteger(v.asset.bytes) || v.asset.bytes! < 1024 || v.asset.bytes! > 32 * 1024 * 1024)
    throw Error("Unsupported native eye research manifest");
  return {
    schema: v.schema, status: v.status, limitation: v.limitation,
    source: { ...NATIVE_EYE_SOURCE }, asset: { ...v.asset },
  } as NativeEyeManifest;
}

export async function verifyNativeEyeBytes(bytes: Uint8Array, manifest: NativeEyeManifest): Promise<void> {
  if (bytes.byteLength !== manifest.asset.bytes) throw Error("Native eye byte length differs from manifest");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength)
    throw Error("Native eye asset is not a complete GLB v2");
  const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  const actual = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
  if (actual !== manifest.asset.sha256) throw Error("Native eye asset does not match its recorded source SHA-256");
}

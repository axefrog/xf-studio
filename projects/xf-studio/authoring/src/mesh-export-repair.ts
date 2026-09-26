/**
 * Pure: prepare a copy of a mesh that the exporting tool can write as a GLB when the original can't be, without changing what the
 * preview draws. Two repairs exist, each for one proven tool failure; a mesh gets every one that fits:
 *
 * **Short `bonePositions`.** WolvenKit's mesh exporter builds the GLB skin from `renderResourceBlob.header.bonePositions` (one joint
 * per entry; WolvenKit `MeshTools.GetOrphanRig`), while the render chunks' skin indices address the mesh's `boneNames` and
 * `boneRigMatrices` [source: WolvenKit commit 11720772]. A mesh whose header lists fewer positions than it has bones makes every
 * vertex weighted to a later bone point past the skin, and SharpGLTF's validation refuses to write the file ("Accessor[n] JOINTS_0[i]:
 * Is out of bounds") [observed: a CCXL hairstyle's 141-bone ponytail with 45 positions, WolvenKit 9.0.1]. The copy gets the missing
 * positions exactly as WolvenKit's own importer computes them (the translation of each bone's inverted rig matrix), so the exported
 * joints are the ones WolvenKit derives from the rig matrices anyway. Geometry, skin indices and weights, bones and materials are
 * untouched. How the engine itself uses `bonePositions` is unread; it draws such meshes [hypothesis: the mod works in game].
 *
 * **Short garment flags.** WolvenKit reads four bytes per vertex of each render chunk from the matching chunk of the mesh's
 * `garmentMeshParamGarment` parameter (`garmentFlags`: support weight, cap and two unused) to write the `_GARMENTSUPPORTWEIGHT` and
 * `_GARMENTSUPPORTCAP` attributes, and stops with "Unable to read beyond the end of the stream" when a chunk's buffer is shorter
 * [source: WolvenKit commit 11720772, `MeshTools.WriteGarmentParametersToMesh`]. The KS UV texture framework's left arm
 * (`a0_000_pwa_base_hq__l.mesh`, UV Framework 4.1) stores two bytes per vertex in all four chunks [resource]. Exported with the game
 * folder, WolvenKit then silently exports the base game's arm instead (PIPE-106, game-asset-export.ts). The copy empties each short
 * buffer, which WolvenKit skips (a chunk without garment flags); geometry, UVs, skin, bones and materials are untouched, and the
 * preview reads no garment support yet (knowledge/body-rendering.md §5). What the engine reads from a short buffer is unread; it draws
 * the arm [hypothesis: the framework works in game].
 */
import { asArray, isObject, type JsonObject } from "./red-json";

export type MeshExportRepair = { document: JsonObject; detail: string };
/**
 * Identity of the repairs this module makes. Change it whenever a repair is added or changes: the exporter's lasting outcomes (a mesh
 * settled as exporting nothing, a lasting partial export) are recorded under it, so a changed repair tries those meshes again.
 */
export const MESH_EXPORT_REPAIR_VERSION = "mesh-export-repair-2";

type Row = [number, number, number, number];
const row = (value: unknown): Row => {
  const v = isObject(value) ? value : {};
  return [Number(v.X) || 0, Number(v.Y) || 0, Number(v.Z) || 0, Number(v.W) || 0];
};

/**
 * The translation of an inverted rig matrix (System.Numerics row-vector layout: rows X, Y, Z are the linear part, row W the
 * translation), which is the bone's position in mesh space; null when the matrix can't be inverted.
 */
export function bonePositionFromRigMatrix(matrix: unknown): [number, number, number] | null {
  if (!isObject(matrix)) return null;
  const [a, b, c] = [row(matrix.X), row(matrix.Y), row(matrix.Z)], t = row(matrix.W);
  // Inverse of the 3x3 linear part (rows a, b, c) by cofactors.
  const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const inv = [
    [(b[1] * c[2] - b[2] * c[1]) / det, (a[2] * c[1] - a[1] * c[2]) / det, (a[1] * b[2] - a[2] * b[1]) / det],
    [(b[2] * c[0] - b[0] * c[2]) / det, (a[0] * c[2] - a[2] * c[0]) / det, (a[2] * b[0] - a[0] * b[2]) / det],
    [(b[0] * c[1] - b[1] * c[0]) / det, (a[1] * c[0] - a[0] * c[1]) / det, (a[0] * b[1] - a[1] * b[0]) / det],
  ];
  // Row vector: p' = p·M, so M⁻¹ has translation −t·L⁻¹.
  const position = [0, 1, 2].map(j => -(t[0] * inv[0]![j]! + t[1] * inv[1]![j]! + t[2] * inv[2]![j]!)) as [number, number, number];
  return position.every(Number.isFinite) ? position : null;
}

/** WolvenKit's garment flags per vertex (support weight, cap, two unused bytes). */
export const GARMENT_FLAG_BYTES = 4;
/** Decoded length of a base64 string without decoding it. */
const base64Length = (text: string) => { const clean = text.replace(/\s+/g, ""); return Math.floor(clean.length * 3 / 4) - (clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0); };

/** Fill in missing bone positions from the bones' rig matrices (on `copy`); the plain line, or null when the positions are complete. */
function fillBonePositions(root: JsonObject, copyRoot: JsonObject): string | null {
  const blob = isObject(root.renderResourceBlob) && isObject(root.renderResourceBlob.Data) ? root.renderResourceBlob.Data : null;
  const header = blob && isObject(blob.header) ? blob.header : null;
  if (!header || !Array.isArray(header.bonePositions)) return null;
  const bones = asArray(root.boneNames).length, positions = header.bonePositions.length;
  if (!bones || positions >= bones) return null;
  const copyHeader = ((copyRoot.renderResourceBlob as JsonObject).Data as JsonObject).header as JsonObject;
  const matrices = asArray(copyRoot.boneRigMatrices);
  const filled = copyHeader.bonePositions as unknown[];
  let fromMatrices = 0;
  for (let index = positions; index < bones; index++) {
    const position = bonePositionFromRigMatrix(matrices[index]);
    if (position) fromMatrices++;
    const [X, Y, Z] = position ?? [0, 0, 0];
    filled.push({ $type: "Vector4", X, Y, Z, W: 1 });
  }
  const added = bones - positions, atOrigin = added - fromMatrices;
  return `its render data lists ${positions} bone position${positions === 1 ? "" : "s"} for ${bones} bones, so the ` +
    `exported copy fills in the other ${added} from the bones' own rig matrices${atOrigin ? ` (${atOrigin} at the origin, their matrices can't be inverted)` : ""}`;
}

/** Empty each garment chunk's flags buffer that is shorter than WolvenKit reads (on `copyRoot`); the plain line, or null when none is. */
function emptyShortGarmentFlags(copyRoot: JsonObject): string | null {
  const blob = isObject(copyRoot.renderResourceBlob) && isObject(copyRoot.renderResourceBlob.Data) ? copyRoot.renderResourceBlob.Data : null;
  const infos = blob && isObject(blob.header) ? asArray(blob.header.renderChunkInfos) : [];
  const short: number[] = [];
  for (const parameter of asArray(copyRoot.parameters)) {
    const data = isObject(parameter) && isObject(parameter.Data) ? parameter.Data : null;
    if (!data || data.$type !== "garmentMeshParamGarment") continue;
    asArray(data.chunks).forEach((chunk, index) => {
      const info = infos[index];
      const flags = isObject(chunk) && isObject(chunk.garmentFlags) ? chunk.garmentFlags : null;
      const vertices = isObject(info) ? Number(info.numVertices) : NaN;
      if (!flags || typeof flags.Bytes !== "string" || !Number.isInteger(vertices) || vertices <= 0) return;
      const bytes = base64Length(flags.Bytes);
      if (bytes > 0 && bytes < vertices * GARMENT_FLAG_BYTES) { flags.Bytes = ""; short.push(index); }
    });
  }
  if (!short.length) return null;
  return `its garment support data is shorter than its vertices in chunk${short.length === 1 ? "" : "s"} ${short.join(", ")}, so the exported copy ` +
    "leaves that data out (the preview doesn't read it)";
}

/**
 * The repaired copy of a serialized mesh (WolvenKit JSON: `{ Header, Data: { RootChunk } }`), or null when no known repair applies.
 * The input is not changed.
 */
export function repairMeshForExport(document: JsonObject): MeshExportRepair | null {
  const root = isObject(document.Data) && isObject(document.Data.RootChunk) ? document.Data.RootChunk : null;
  if (!root || root.$type !== "CMesh") return null;
  const copy = structuredClone(document);
  const copyRoot = (copy.Data as JsonObject).RootChunk as JsonObject;
  const details = [fillBonePositions(root, copyRoot), emptyShortGarmentFlags(copyRoot)].filter((line): line is string => !!line);
  return details.length ? { document: copy, detail: details.join("; ") } : null;
}

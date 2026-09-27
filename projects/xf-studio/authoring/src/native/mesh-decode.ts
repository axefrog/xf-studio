/**
 * Host adapter: one `.mesh` or `.morphtarget` read from an archive and turned into the GLB the preview is served (mesh-glb.ts), reported
 * as data, never thrown, so the same code runs in-process and in the decode worker (native-decode-serve.ts). A morph target's joints
 * come from its base mesh, read from the same archive (as WolvenKit finds it when it exports from that archive alone); without it the
 * GLB has no skin, as WolvenKit's has none then.
 *
 * Budgets: the reader's caps (limits.ts) with room for a large render buffer (a head's morph target decompresses to about 13 MB of
 * buffers; decompressed bytes count against `maxDecodedBytes`), and the mesh caps (mesh-blob.ts `MeshLimits`). A decode holds the
 * resource, its decompressed buffers, the decoded chunks and the GLB (morph deltas sparse): for the player head's morph target about
 * 60 MB at its peak.
 */
import { createHash } from "node:crypto";
import { depotHash } from "../depot-path";
import type { NativeArchivePool } from "./archive-reader";
import { readCr2w } from "./cr2w-reader";
import type { Decompress } from "./kark";
import { DecodeSession, DEFAULT_LIMITS, type NativeLimits } from "./limits";
import { DEFAULT_MESH_LIMITS, type MeshLimits } from "./mesh-blob";
import { meshGeometry, morphGeometry, type NativeGeometry } from "./mesh-glb";
import { referencePath } from "./morph-blob";
import { classifyNativeFailure, NativeUnsupportedError, type NativeFailureKind } from "./native-errors";
import type { RedDocument } from "./red-model";

/**
 * Version of the mesh output rules; part of the mesh reader's identity in cache keys. Bump it whenever what a mesh decodes to changes
 * (attributes, conventions, joints, targets).
 */
export const NATIVE_MESH_VERSION = 1;

/** The reader's caps with room for a large mesh's buffers (decompressed bytes count against `maxDecodedBytes`). */
export const MESH_READ_LIMITS: NativeLimits = Object.freeze({ ...DEFAULT_LIMITS, maxDecodedBytes: 160 * 2 ** 20 });

export interface NativeGeometryRequest {
  readonly archivePath: string;
  /** Depot hash, decimal. */
  readonly hash: string;
  /** This request's time budget in a worker. */
  readonly timeoutMs?: number;
}

export interface NativeGeometryResult {
  readonly glb: Uint8Array;
  /** The extracted resource (as WolvenKit's `unbundle` writes it) and its SHA-256: the export's `raw` file. */
  readonly raw: Uint8Array;
  readonly extractedSha256: string;
  readonly root: "CMesh" | "MorphTargetMesh";
  readonly meshes: number;
  readonly vertices: number;
  readonly targets: number;
  readonly joints: number;
  /** Where a morph target's joints came from: its base mesh in the same archive, or none (not found there). Absent for a mesh. */
  readonly baseMesh?: "read" | "absent";
  readonly notes: readonly string[];
}

export type NativeGeometryOutcome =
  | { readonly ok: true; readonly geometry: NativeGeometryResult }
  | { readonly ok: false; readonly kind: NativeFailureKind; readonly message: string; readonly errorName?: string; readonly stack?: string; readonly lasting?: boolean };

/** Read, check and decode one mesh or morph target to its GLB; every failure is returned with its kind. */
export function decodeGeometryFromPool(pool: NativeArchivePool, decompress: Decompress, request: NativeGeometryRequest,
  limits: NativeLimits = MESH_READ_LIMITS, meshLimits: MeshLimits = DEFAULT_MESH_LIMITS): NativeGeometryOutcome {
  try {
    const raw = pool.read(request.archivePath, request.hash);
    if (!raw) return { ok: false, kind: "not-indexed", message: "The archive does not list the resource." };
    const document = readCr2w(raw, decompress, new DecodeSession(limits));
    let geometry: NativeGeometry, baseMesh: NativeGeometryResult["baseMesh"];
    const root = document.root.type;
    if (root === "CMesh") geometry = meshGeometry(document, meshLimits);
    else if (root === "MorphTargetMesh") {
      const path = referencePath(document.root.fields.baseMesh);
      const hash = path ? (path.startsWith("#") ? path.slice(1) : depotHash(path)) : null;
      let base: RedDocument | null = null;
      if (hash) {
        const bytes = pool.read(request.archivePath, hash);
        // The base mesh is its own resource, with its own budgets.
        if (bytes) base = readCr2w(bytes, decompress, new DecodeSession(limits));
      }
      baseMesh = base ? "read" : "absent";
      geometry = morphGeometry(document, base, meshLimits);
    } else throw new NativeUnsupportedError(`A ${root} is not a mesh or morph target.`);
    return { ok: true, geometry: { glb: geometry.glb, raw, extractedSha256: createHash("sha256").update(raw).digest("hex"), root: root as NativeGeometryResult["root"],
      meshes: geometry.meshes, vertices: geometry.vertices, targets: geometry.targets, joints: geometry.joints, notes: geometry.notes, ...(baseMesh ? { baseMesh } : {}) } };
  } catch (error) {
    const kind = classifyNativeFailure(error);
    const failure = error as { name?: unknown; message?: unknown; stack?: unknown } | null;
    return { ok: false, kind, message: String(failure?.message ?? error), errorName: typeof failure?.name === "string" ? failure.name : undefined,
      stack: kind === "internal" && typeof failure?.stack === "string" ? failure.stack : undefined };
  }
}

/**
 * The save's `ScriptableSystemsContainer` package, as the loadout reads it: a thin view over the one package reader
 * (engines/red-object/package.ts), kept so existing callers and their tests keep their shape. The frame, bounds and generic decoder live
 * there; this module only maps its errors to `SavePackageError` and fixes the `save` variant (a u32 CRUID list).
 */
import { decodeChunk, MAX_CHUNKS, MAX_NAMES, PackageFrameError, readPackageFrame, type PackageObject, type PackageTypes } from "./engines/red-object/package";

export { field, type PackageHandle, type PackageObject, type PackageValue } from "./engines/red-object/package";
export { MAX_CHUNKS, MAX_NAMES };

export type PackageChunk = { readonly type: string; readonly index: number };
export type SavePackage = {
  readonly version: number;
  readonly chunks: readonly PackageChunk[];
  /** Decode one chunk; `types` names the enum types among its fields (a set of names, or a type oracle). */
  decode(index: number, types: PackageTypes): { object: PackageObject; skipped: string[] };
};

export class SavePackageError extends Error { override name = "SavePackageError"; }

const mapped = <T>(read: () => T): T => {
  try { return read(); }
  catch (error) { throw error instanceof PackageFrameError ? new SavePackageError(error.message) : error; }
};

/** Open a save's object package (the bytes after the node's u32 size). Throws `SavePackageError` when the frame is not one. */
export function readSavePackage(bytes: Uint8Array): SavePackage {
  const frame = mapped(() => readPackageFrame(bytes, "save"));
  return { version: frame.version, chunks: frame.chunks.map((chunk, index) => ({ type: chunk.type, index })),
    decode: (index, types) => mapped(() => decodeChunk(frame, index, types)) };
}

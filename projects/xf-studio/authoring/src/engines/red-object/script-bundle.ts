/**
 * Names from the game's compiled script bundle, `r6/cache/final.redscripts` (research/save/save-editor-design.md §6, decision 6): every
 * script class, field, enum and member name, vanilla and modded, as candidate names for the hashes a save stores. Read-only labels,
 * never types. Pure and bounded.
 *
 * Layout [source: redscript `crates/io/src/bundle.rs` at 3ca666c, MIT, read only]: a 104-byte header: `REDS`, u32 version (14), u32
 * flags, u64 timestamp, u32 build, u32 CRC, u32 segments, then six tables of (u32 offset, u32 count, u32 hash): string data, CNames,
 * TweakDB IDs, resources, definitions, strings. A CName entry is a u32 offset into the string data; the text there ends at a NUL.
 */

export class ScriptBundleError extends Error { override name = "ScriptBundleError"; }

const HEADER = 104, VERSION = 14, MAX_NAMES = 2_000_000, MAX_NAME = 1024;

/** The CNames of a script bundle. Throws `ScriptBundleError` when the bytes are not a bundle this reader knows. */
export function readScriptBundleNames(bytes: Uint8Array): string[] {
  if (bytes.length < HEADER) throw new ScriptBundleError("The script bundle is truncated.");
  if (String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) !== "REDS") throw new ScriptBundleError("This is not a compiled script bundle.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if (version !== VERSION) throw new ScriptBundleError(`Script bundle version ${version} is not read.`);
  const table = (index: number) => ({ offset: view.getUint32(32 + index * 12, true), count: view.getUint32(36 + index * 12, true) });
  const strings = table(0), cnames = table(1);
  if (cnames.count > MAX_NAMES || cnames.offset + cnames.count * 4 > bytes.length || strings.offset > bytes.length)
    throw new ScriptBundleError("The script bundle's name table lies outside the file.");
  const decoder = new TextDecoder("utf-8", { fatal: false }), out: string[] = [];
  for (let i = 0; i < cnames.count; i++) {
    const start = strings.offset + view.getUint32(cnames.offset + i * 4, true);
    if (start >= bytes.length) continue;
    let end = start;
    while (end < bytes.length && end - start < MAX_NAME && bytes[end] !== 0) end++;
    if (end > start) out.push(decoder.decode(bytes.subarray(start, end)));
  }
  return out;
}

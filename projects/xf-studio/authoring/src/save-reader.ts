/**
 * The saved V from a save: the creator node (`CharacetrCustomization_Appearances`), read byte for byte, and what V wears (save-loadout.ts).
 * Read-only and bounded; format references: README.md, research/eye-artistry/save-import.md. The container (header, chunks, LZ4, node
 * tree) is the save container codec's (engines/save/container.ts); this module is the character view over it. A save whose script data
 * can't be read still loads its appearance, with `loadout: null`. Nothing here writes, touches files or deploys.
 */
import { openSave, readSaveHeader } from "./engines/save/container";
import { readTypeDatabase } from "./engines/red-object/type-database";
import { createTypeOracle } from "./engines/red-object/type-oracle";
import { Reader } from "./engines/save/reader";
import { readSavedLoadout, type SavedLoadout } from "./save-loadout";
import type { CustomizationGroup, SavedV } from "./saved-v";

export { Reader } from "./engines/save/reader";
export { decodeLz4 } from "./engines/save/lz4";
export { parseSavedV, type Appearance, type CustomizationGroup, type Morph, type SavedV } from "./saved-v";

/** The creator node's name, as the game spells it. */
const APPEARANCE_NODE = "CharacetrCustomization_Appearances";

export function readSavedV(bytes: Uint8Array): SavedV {
  const { saveVersion, gameVersion } = readSaveHeader(bytes);
  if (gameVersion < 2000 || gameVersion > 2310)
    throw Error(`Save game version ${gameVersion} is outside the researched 2.0–2.31 range`);
  const save = openSave(bytes);
  const targets = save.find(APPEARANCE_NODE);
  if (targets.length > 1) throw Error("Ambiguous appearance nodes");
  const target = targets[0];
  if (!target || target.offset < save.dataStart || target.offset + target.size > save.expanded.length)
    throw Error("Appearance node missing or out of bounds");
  const n = new Reader(save.expanded.subarray(target.offset, target.offset + target.size));
  n.u32();
  const exists = n.bool();
  n.u32();
  if (!exists) throw Error("Save contains no player appearance");
  const presetVersion = n.u32(),
    isMale = n.bool(),
    brainIsMale = n.bool();
  const array = <T>(fn: () => T) => Array.from({ length: n.count() }, fn);
  const groups = (): CustomizationGroup[] =>
    array(() => ({
      name: n.text(),
      appearances: array(() => ({
        resourceHash: n.u64(),
        definition: n.text(),
        name: n.text(),
        censorFlag: n.u32(),
        censorAction: n.u32(),
      })),
      morphs: array(() => ({
        region: n.text(),
        target: n.text(),
        censorFlag: n.u32(),
        censorAction: n.u32(),
      })),
    }));
  const head = groups(),
    arms = groups(),
    body = groups(),
    perspectives = array(() => ({
      name: n.text(),
      fpp: n.text(),
      tpp: n.text(),
    }));
  const tagCount = n.vlq();
  if (tagCount < 0 || tagCount > 4096) throw Error("Invalid tag count");
  const tags = Array.from({ length: tagCount }, () => n.text());
  const trailingBytes = n.bytes.length - n.pos;
  if (trailingBytes)
    throw Error(
      `Appearance node has ${trailingBytes} unparsed bytes; refusing an incomplete preset`,
    );
  // What V wears: optional, so a save whose script data this reader can't follow still loads the V. A node listed twice is ambiguous and
  // isn't read. Which named types are enums comes from the save's own type database.
  const only = (name: string) => { const found = save.find(name); return found.length === 1 ? found[0]! : null; };
  const node = (name: string) => { const found = only(name); return found && found.size >= 4 ? save.data(found.id).subarray(4) : null; };
  let loadout: SavedLoadout | null = null;
  try {
    const systems = node("ScriptableSystemsContainer");
    if (systems) {
      const schema = only("TypeDatabase_v2");
      let database = null;
      try { database = schema ? readTypeDatabase(save.data(schema.id)) : null; } catch { database = null; }
      loadout = database ? readSavedLoadout(systems, node("WardrobeSystem_ClothingSets"), createTypeOracle({ database }))
        : readSavedLoadout(systems, node("WardrobeSystem_ClothingSets"));
    }
  } catch { loadout = null; }
  return {
    schema: "eye-artistry/saved-v-1",
    saveVersion,
    gameVersion,
    presetVersion,
    isMale,
    brainIsMale,
    groups: { head, arms, body },
    perspectives,
    tags,
    loadout,
    evidence: {
      nodeName: target.name,
      nodeBytes: target.size,
      bytesRead: n.pos,
      trailingBytes,
      chunks: save.chunks.length,
      decompressedBytes: save.expanded.length,
    },
  };
}

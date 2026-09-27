/**
 * The expression mod's files, written from a plan and the player's own game documents (research/animation/expression-editor-design.md
 * §6.2): each gender's animation set, the face rig patch, the expression table and the TweakXL records. Pure: WolvenKit JSON in, JSON
 * or text out; the exporter hands the JSON to WolvenKit's `deserialize`.
 */
import { encodeStaticFace, staticFaceCounts, staticFaceTracks, STATIC_FACE } from "../../../engines/facial-rig/clip";
import { GENDERS, TABLE_HEADERS, type Gender, type GameRig } from "./game";

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const cname = (value: string) => ({ $type: "CName", $storage: "string", $value: value });
const depot = (path: string) => path.replaceAll("/", "\\");
const resource = (path: string, flags = "Default") => ({ DepotPath: { $type: "ResourcePath", $storage: "string", $value: depot(path) }, Flags: flags });
/** A WolvenKit JSON document's header without the temporary path WolvenKit recorded (a private path). */
function header(document: unknown): Json {
  const found = isRecord(document) && isRecord(document.Header) ? document.Header : {};
  const { ArchiveFileName: _private, ExportedDateTime: _time, ...rest } = found;
  return rest;
}
const root = (document: unknown): Json => {
  const data = isRecord(document) && isRecord(document.Data) ? document.Data : undefined;
  if (!data || !isRecord(data.RootChunk)) throw Error("A game document XF Studio read has no root.");
  return data.RootChunk;
};
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, "base64"));

/** One planned expression, as the files need it. */
export type PlannedClip = { readonly clip: string; readonly controls: readonly (readonly [string, number])[] };

/** The template set's `facial_neutral` clip: its joint-key block (the bytes every static face of the set shares) and its entry. */
export function templateNeutral(set: unknown): { entry: Json; jointBlock: Uint8Array; joints: number } {
  const r = root(set);
  const chunks = Array.isArray(r.animationDataChunks) ? r.animationDataChunks : [];
  for (const item of Array.isArray(r.animations) ? r.animations : []) {
    const entry = isRecord(item) && isRecord(item.Data) ? item.Data : undefined;
    const animation = entry && isRecord(entry.animation) && isRecord(entry.animation.Data) ? entry.animation.Data : undefined;
    const name = animation && isRecord(animation.name) ? animation.name.$value : undefined;
    if (name !== "facial_neutral" || !animation) continue;
    const buffer = isRecord(animation.animBuffer) && isRecord(animation.animBuffer.Data) ? animation.animBuffer.Data : undefined;
    const address = buffer && isRecord(buffer.dataAddress) ? buffer.dataAddress : undefined;
    if (!buffer || !address || buffer.numAnimKeys !== 0 || buffer.numAnimKeysRaw !== 0 || !Number.isInteger(buffer.numConstAnimKeys))
      throw Error("The game's neutral face isn't the static face XF Studio expects.");
    const chunk = chunks[Number(address.unkIndex)] as Json | undefined;
    const bytes = chunk && isRecord(chunk.buffer) && typeof chunk.buffer.Bytes === "string" ? fromBase64(chunk.buffer.Bytes) : undefined;
    const offset = Number(address.fsetInBytes), size = (buffer.numConstAnimKeys as number) * 16;
    if (!bytes || bytes.byteLength < offset + size) throw Error("The game's neutral face couldn't be read.");
    return { entry: entry!, jointBlock: bytes.slice(offset, offset + size), joints: Number(buffer.numJoints) };
  }
  throw Error("The game's photo-mode face set has no neutral face.");
}

/**
 * A gender's animation set: the template set's structure (its rig and settings), one entry per expression cloned from its neutral face
 * with the XF clip's name and buffer, all clips in one data chunk. Handles and buffers are numbered afresh in document order.
 */
export function animationSet(template: unknown, rig: GameRig, clips: readonly PlannedClip[]): { document: Json; buffers: Uint8Array[] } {
  const neutral = templateNeutral(template), r = root(template);
  const buffers = clips.map(clip => encodeStaticFace(neutral.jointBlock, staticFaceTracks(Object.fromEntries(clip.controls), rig.tracks, rig.main)));
  const counts = staticFaceCounts(neutral.jointBlock, rig.tracks.length);
  const data = new Uint8Array(buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0));
  let offset = 0;
  const animations = clips.map((clip, index) => {
    const entry = structuredClone(neutral.entry);
    const animation = (entry.animation as Json).Data as Json, buffer = (animation.animBuffer as Json).Data as Json;
    animation.name = cname(clip.clip);
    animation.duration = STATIC_FACE.duration; animation.animationType = STATIC_FACE.type;
    const { bytes, ...declared } = counts;
    Object.assign(buffer, declared, { duration: STATIC_FACE.duration, numJoints: neutral.joints, animKeys: null, animKeysRaw: null, constAnimKeys: null,
      constTrackKeys: null, trackKeys: null, tempBuffer: null, defferedBuffer: null, inplaceCompressedBuffer: null,
      dataAddress: { $type: "animAnimDataAddress", fsetInBytes: offset, unkIndex: 0, zeInBytes: bytes } });
    data.set(buffers[index]!, offset); offset += bytes;
    const handle = 3 * index;
    return { HandleId: String(handle), Data: { ...entry, animation: { HandleId: String(handle + 1), Data: { ...animation,
      animBuffer: { HandleId: String(handle + 2), Data: buffer } } } } };
  });
  const document = { Header: header(template), Data: { ...(isRecord(template) && isRecord(template.Data) ? template.Data : {}),
    RootChunk: { ...r, animations, animationDataChunks: [{ $type: "animAnimDataChunk", buffer: { BufferId: "0", Flags: 0, Bytes: base64(data) } }] } } };
  return { document, buffers };
}

/** A component ID (CRUID) from a name: the first 8 bytes of its SHA-256, as WolvenKit writes a CRUID (a decimal string). */
export function componentId(sha256Hex: string): string { return BigInt(`0x${sha256Hex.slice(0, 16)}`).toString(); }

/**
 * The patch of V's photo-mode face rig: each gender's appearance with one new animation-setup component (`name`, bound to `face_rig`)
 * listing that gender's XF set. Root settings are left at their defaults so ArchiveXL merges only the component. The compiled package's
 * buffer type comes from the player's own face rig document (the WolvenKit that reads it writes it back).
 */
export function faceRigPatch(faceRig: unknown, component: { name: string; id: string; hash: string }, sets: Readonly<Record<Gender, string>>): Json {
  const r = root(faceRig);
  const first = (Array.isArray(r.appearances) ? r.appearances : []).map(item => isRecord(item) && isRecord(item.Data) ? item.Data : undefined).find(Boolean);
  const compiled = first && isRecord(first.compiledData) ? first.compiledData : undefined;
  const packageData = compiled && isRecord(compiled.Data) ? compiled.Data : undefined;
  if (!compiled || !packageData || typeof compiled.Type !== "string") throw Error("V's photo-mode face rig couldn't be read.");
  const none = (value = "None") => cname(value);
  const soft = { DepotPath: { $type: "ResourcePath", $storage: "uint64", $value: "0" }, Flags: "Soft" };
  const appearances = (Object.keys(GENDERS) as Gender[]).map((gender, index) => {
    const handle = 2 * index;
    const binding = { $type: "entAnimationControlBinding", bindName: cname("face_rig"), enabled: 1,
      enableMask: { $type: "entTagMask", excludedTags: { $type: "redTagList", tags: [cname("NoBinding")] }, hardTags: { $type: "redTagList", tags: [] },
        softTags: { $type: "redTagList", tags: [] } } };
    const animations = { $type: "animAnimSetup", cinematics: [], gameplay: [{ $type: "animAnimSetupEntry", animSet: resource(sets[gender]), priority: 128,
      variableNames: [] }], hash: component.hash };
    const fields = { $type: "entAnimationSetupExtensionComponent", id: component.id, isOverrideContainer: 0, isReplicable: 0, name: cname(component.name) };
    return { HandleId: String(handle), Data: {
      $type: "appearanceAppearanceDefinition", censorFlags: 0,
      compiledData: { BufferId: String(index), Flags: 0, Type: compiled.Type, Data: { Version: packageData.Version, Sections: packageData.Sections,
        CruidIndex: -1, CruidDict: { 0: component.id }, Chunks: [{ ...fields, animations, controlBinding: { HandleId: String(handle + 1), Data: binding } }] } },
      components: [{ ...fields, animations, controlBinding: { HandleRefId: String(handle + 1) } }],
      cookedDataPathOverride: soft, forcedLodDistance: 0, hitRepresentationOverrides: [], inheritedVisualTags: { $type: "redTagList", tags: [] },
      looseDependencies: [], name: cname(GENDERS[gender].appearance), parametersBuffer: { $type: "entEntityParametersBuffer", parameterBuffers: [] },
      parentAppearance: none(), partsMasks: [], partsOverrides: [], partsValues: [], proxyMesh: soft, proxyMeshAppearance: none(),
      resolvedDependencies: [resource(sets[gender], "Soft")], visualTags: { $type: "redTagList", tags: [] } } };
  });
  return { Header: header(faceRig), Data: { Version: (faceRig as { Data?: Json }).Data?.Version ?? 195, BuildVersion: 0, RootChunk: {
    $type: "appearanceAppearanceResource", alternateAppearanceMapping: [], alternateAppearanceSettingName: none(), alternateAppearanceSuffixes: [],
    appearances, baseEntity: soft, baseEntityType: none(), baseType: none(), censorshipMapping: [], commonCookData: soft, cookingPlatform: "PLATFORM_PC",
    DismEffects: [], DismWoundConfig: { $type: "entdismembermentWoundsConfigSet", Configs: [] }, forceCompileProxy: 0,
    generatePlayerBlockingCollisionForProxy: 0, partType: none(), preset: none(), proxyPolyCount: 1400, Wounds: [] }, EmbeddedFiles: [] } };
}

/** The expression table as a WolvenKit `C2dArray` document, with the header of the player's own table document. */
export function expressionTable(template: unknown, rows: readonly (readonly string[])[]): Json {
  const data = rows.map(row => [...row]);
  return { Header: header(template), Data: { Version: (template as { Data?: Json }).Data?.Version ?? 195, BuildVersion: 0, RootChunk: {
    $type: "C2dArray", compiledData: data, compiledHeaders: [...TABLE_HEADERS], cookingPlatform: "PLATFORM_PC", data: structuredClone(data),
    headers: [...TABLE_HEADERS] }, EmbeddedFiles: [] } };
}

/** One row of an XF expression: its index, clip, the photo-mode context, and the neutral face as its fallback. */
export const expressionRow = (index: number, clip: string): string[] => [String(index), clip, "photomode", "facial_neutral"];
/** A filler row: an index kept to the table's position, showing the neutral face. */
export const fillerRow = (index: number): string[] => [String(index), "facial_neutral", "photomode", "facial_neutral"];

/** A YAML double-quoted string. */
const quoted = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/[\u0000-\u001f\u007f]/g, char => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`)}"`;
/** The TweakXL file: one photo-mode face record per expression, appended once to V's expression list. LF line endings, UTF-8. */
export function tweakRecords(items: readonly { readonly clip: string; readonly label: string; readonly index: number }[], modName: string): string {
  const lines = [`# ${modName}: photo-mode expressions made with XF Studio.`, "photo_mode.character.faceAnimations:",
    ...items.map(item => `  - !append-once PhotoModeFaces.${item.clip}`), ""];
  for (const item of items) lines.push(`PhotoModeFaces.${item.clip}:`, "  $base: PhotoModeFaces.facial_neutral", `  displayName: ${quoted(item.label)}`,
    `  faceId: ${item.index}`, "");
  return lines.join("\n");
}

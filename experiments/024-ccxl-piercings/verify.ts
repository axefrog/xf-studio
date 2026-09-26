// Experiment 024: independent structural checks of the packed probe (see README.md). Pure: the host (build.ts) unbundles the
// archive, serializes every member with WolvenKit and passes the documents here, together with the head resources and the
// installation's creator data. Nothing here imports the piece generator's encoders; it re-reads the bytes itself and compares
// them with the head's. Offline checks prove structure and additivity only, never game rendering.
import { isDeepStrictEqual } from "node:util";
import { type CcoOption, type CcoResource, mergeCustomizations, readCco } from "../../projects/xf-studio/authoring/src/cco-model";
import type { XlFix } from "../../projects/xf-studio/authoring/src/archivexl-config";
import {
  CUSTOMIZATION, DEPOT, FINISHES, GROUPS, MATERIALS, MORPHS, NEUTRAL_DELTA_WORD, ROWS,
  meshPath, morphPath, plannedPaths, xlText, type SolvedPiece,
} from "./fixture";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Check { readonly id: string; readonly ok: boolean; readonly detail: string }
const value = (name: Json) => typeof name === "string" ? name : name?.$value;
const path = (ref: Json) => String(ref?.DepotPath?.$value ?? "").replaceAll("\\", "/").toLowerCase();
const backslash = (p: string) => p.replaceAll("/", "\\");

// ---------------------------------------------------------------------------------------------------------------
// Byte readers (independent of fixture.ts's encoders)

const SIZES: Record<string, number> = { PT_Short4N: 8, PT_UByte4: 4, PT_UByte4N: 4, PT_Float16_4: 8, PT_Float16_2: 4, PT_Dec4: 4, PT_Color: 4, PT_Float1: 4 };
type Layout = { usage: string; usageIndex: number; type: string; stream: number; offset: number };
function layoutOf(chunk: Json): Layout[] {
  const cursor = new Map<number, number>(), out: Layout[] = [];
  for (const e of chunk.chunkVertices.vertexLayout.elements.Elements) {
    if (e.streamType !== "ST_PerVertex") continue;
    const offset = cursor.get(e.streamIndex) ?? 0;
    if (!SIZES[e.type]) throw Error(`Unexpected vertex element type ${e.type}.`);
    out.push({ usage: e.usage, usageIndex: e.usageIndex, type: e.type, stream: e.streamIndex, offset });
    cursor.set(e.streamIndex, offset + SIZES[e.type]);
  }
  return out;
}
/** Every vertex's bytes for one element of chunk 0. */
function column(blob: Json, usage: string, usageIndex = 0): Buffer[] {
  const chunk = blob.header.renderChunkInfos[0], raw = Buffer.from(blob.renderBuffer.Bytes, "base64");
  const element = layoutOf(chunk).find(e => e.usage === usage && e.usageIndex === usageIndex);
  if (!element) throw Error(`No ${usage}/${usageIndex} in the blob.`);
  const stride = chunk.chunkVertices.vertexLayout.slotStrides.Elements[element.stream], start = chunk.chunkVertices.byteOffsets.Elements[element.stream];
  return Array.from({ length: chunk.numVertices }, (_, v) => raw.subarray(start + v * stride + element.offset, start + v * stride + element.offset + SIZES[element.type]));
}
const skinOf = (blob: Json, vertex?: number) => {
  const parts = [["PS_SkinIndices", 0], ["PS_SkinIndices", 1], ["PS_SkinWeights", 0], ["PS_SkinWeights", 1]] as const;
  const columns = parts.map(([usage, index]) => column(blob, usage, index));
  const rows = columns[0].map((_, v) => Buffer.concat(columns.map(c => c[v])));
  return vertex === undefined ? rows : [rows[vertex]];
};
/** Head morph: the anchor's 12-byte row per target index (absent when the target does not move it). */
function headRows(morph: Json, vertex: number): Map<number, Buffer> {
  const blob = morph.Data.RootChunk.blob.Data, header = blob.header;
  const diffs = Buffer.from(blob.diffsBuffer.Bytes, "base64"), mapping = Buffer.from(blob.mappingBuffer.Bytes, "base64");
  const rows = new Map<number, Buffer>();
  for (let t = 0; t < header.numTargets; t++) {
    const n = header.numVertexDiffsInEachChunk[t][0], d0 = header.targetStartsInVertexDiffs[t], m0 = header.targetStartsInVertexDiffsMapping[t] * 4;
    for (let i = 0; i < n; i++) if (mapping.readUInt16LE(m0 + i * 2) === vertex) { rows.set(t, diffs.subarray((d0 + i) * 12, (d0 + i + 1) * 12)); break; }
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------
// Resource checks

export interface VerifyInput {
  /** Unbundled members, forward-slash depot path → WolvenKit JSON document. */
  readonly members: ReadonlyMap<string, Json>;
  readonly xl: string;
  readonly headMesh: Json;
  readonly headMorph: Json;
  readonly pieces: readonly SolvedPiece[];
}

export function verifyResources(input: VerifyInput): Check[] {
  const checks: Check[] = [];
  const check = (id: string, ok: boolean, detail: string) => { checks.push({ id, ok, detail }); };
  const members = [...input.members.keys()].sort();

  check("members", isDeepStrictEqual(members, plannedPaths()), `${members.length} members: ${members.join(", ")}`);
  const foreign = members.filter(p => !p.startsWith(DEPOT + "/"));
  check("own-paths-only", foreign.length === 0, foreign.length ? `outside ${DEPOT}: ${foreign.join(", ")}` : `every member is below ${DEPOT}/ (no vanilla or third-party path)`);
  const xlKeys = input.xl.split(/\r?\n/).filter(line => /^\S/.test(line)).map(line => line.replace(/:.*$/, ""));
  check("xl", input.xl === xlText() && isDeepStrictEqual(xlKeys, ["customizations"]),
    `.archive.xl declares only customizations.female = ${backslash(CUSTOMIZATION)} (no scope, fix, patch, copy or link)`);

  // Creator resource.
  const cco = input.members.get(CUSTOMIZATION)?.Data.RootChunk;
  const parsed = cco ? readCco(cco, "probe") : null;
  const head = parsed?.parts.head.options ?? [];
  const rowsOk = !!parsed && parsed.parts.body.options.length === 0 && parsed.parts.arms.options.length === 0 && head.length === ROWS.length &&
    ROWS.every((row, i) => {
      const o = head[i];
      return o.type === "appearance" && o.name === row.option && o.uiSlot === row.option && o.index === row.index && o.localizedName === row.label &&
        o.enabled && !o.hidden && !o.link && o.resource?.path?.replaceAll("\\", "/").toLowerCase() === row.app &&
        isDeepStrictEqual(o.definitions.map(d => d.name), [row.off, ...row.looks.map(l => l.name)]) &&
        isDeepStrictEqual(o.definitions.map(d => d.localizedName), ["Common-Off", ...row.looks.map(l => l.label)]);
    });
  check("creator-rows", rowsOk, ROWS.map(r => `${r.option} "${r.label}" index ${r.index}: Off + ${r.looks.length} looks`).join("; "));
  const groups = parsed?.parts.head.groups ?? [];
  check("creator-groups", isDeepStrictEqual(groups.map(g => g.name), [...GROUPS]) && groups.every(g => isDeepStrictEqual(g.options, ROWS.map(r => r.option))),
    `both rows in ${GROUPS.join(" and ")}`);

  // Appearance resources.
  for (const row of ROWS) {
    const root = input.members.get(row.app)?.Data.RootChunk;
    const defs = (root?.appearances ?? []).map((h: Json) => h.Data);
    const names = defs.map((d: Json) => value(d.name));
    const off = defs[0];
    const offOk = !!off && value(off.name) === row.off && !(off.components?.length) && !(off.compiledData?.Data?.Chunks?.length);
    const looksOk = row.looks.every((look, i) => {
      const d = defs[i + 1], chunks = d?.compiledData?.Data?.Chunks ?? [];
      return value(d?.name) === look.name && chunks.length === look.parts.length && look.parts.every((part, k) => {
        const c = chunks[k];
        return c.$type === "entMorphTargetSkinnedMeshComponent" && path(c.morphResource) === morphPath(part.morph) && value(c.meshAppearance) === part.finish;
      }) && (d.visualTags?.tags ?? []).map(value).join() === "Female";
    });
    check(`app:${row.option}`, isDeepStrictEqual(names, [row.off, ...row.looks.map(l => l.name)]) && offOk && looksOk,
      `${names.length} appearances; Off draws nothing; ${row.looks.map(l => `${l.name} = ${l.parts.map(p => `${p.morph}/${p.finish}`).join(" + ")}`).join("; ")}`);
  }

  // Meshes and morph targets against the head.
  const headRoot = input.headMesh.Data.RootChunk, headBlob = headRoot.renderResourceBlob.Data;
  const headMorphRoot = input.headMorph.Data.RootChunk, headMorphBlob = headMorphRoot.blob.Data;
  const headBones = headRoot.boneNames.map(value);
  for (const piece of input.pieces) {
    const mesh = input.members.get(meshPath(piece.spec.id))?.Data.RootChunk;
    const blob = mesh?.renderResourceBlob?.Data;
    const chunk = blob?.header?.renderChunkInfos?.[0];
    const materials = (mesh?.localMaterialBuffer?.materials ?? []).map((m: Json) => path(m.baseMaterial));
    const appearances = (mesh?.appearances ?? []).map((h: Json) => [value(h.Data.name), (h.Data.chunkMaterials ?? []).map(value).join()]);
    const meshOk = !!chunk && blob.header.renderChunkInfos.length === 1 && isDeepStrictEqual(mesh.boneNames.map(value), headBones) &&
      isDeepStrictEqual(appearances, FINISHES.map(f => [f, f])) && isDeepStrictEqual(materials, FINISHES.map(f => MATERIALS[f].replaceAll("\\", "/").toLowerCase())) &&
      (mesh.externalMaterials ?? []).length === 0 && mesh.geometryHash !== headRoot.geometryHash && chunk.vertexFactory === 4 &&
      isDeepStrictEqual(blob.header.quantizationScale, headBlob.header.quantizationScale) && isDeepStrictEqual(blob.header.quantizationOffset, headBlob.header.quantizationOffset);
    const skins = meshOk ? skinOf(blob) : [];
    const anchorSkin = skinOf(headBlob, piece.anchor.vertex)[0], anchorMorphSkin = skinOf(headMorphBlob.baseBlob.Data, piece.anchor.vertex)[0];
    const skinOk = skins.length > 0 && anchorSkin.equals(anchorMorphSkin) && skins.every(s => s.equals(anchorSkin));
    check(`mesh:${piece.spec.id}`, meshOk && skinOk,
      `${chunk?.numVertices} vertices, ${chunk ? chunk.numIndices / 3 : 0} triangles; head bone list (${headBones.length}); head quantization; ` +
      `every vertex's skin bytes = head vertex ${piece.anchor.vertex} (${anchorSkin.toString("hex")}) in mesh and morph base; finishes ${FINISHES.join("/")} → vanilla .mi by path`);
  }
  for (const spec of MORPHS) {
    const piece = input.pieces.find(p => p.spec.id === spec.piece)!;
    const mesh = input.members.get(meshPath(spec.piece))?.Data.RootChunk;
    const morph = input.members.get(morphPath(spec.stem))?.Data.RootChunk;
    const blob = morph?.blob?.Data, header = blob?.header;
    const keep = headMorphRoot.targets.map((t: Json, i: number) => ({ t, i })).filter(({ t }: Json) => spec.regions === "all" || spec.regions.includes(value(t.regionName)));
    const targetsOk = !!morph && morph.targets.length === keep.length && keep.every(({ t }: Json, k: number) => isDeepStrictEqual(morph.targets[k], t));
    const baseOk = !!blob && path(morph.baseMesh) === meshPath(spec.piece) && blob.baseBlob.Data.renderBuffer.Bytes === mesh?.renderResourceBlob.Data.renderBuffer.Bytes;
    const anchor = headRows(input.headMorph, piece.anchor.vertex);
    const diffs = Buffer.from(blob?.diffsBuffer?.Bytes ?? "", "base64"), mapping = Buffer.from(blob?.mappingBuffer?.Bytes ?? "", "base64");
    const count = mesh?.renderResourceBlob.Data.header.renderChunkInfos[0].numVertices ?? 0;
    let rowsOk = targetsOk && baseOk && header.numTargets === keep.length, moving = 0;
    const regions = new Set<string>();
    keep.forEach(({ i }: Json, k: number) => {
      if (!rowsOk) return;
      const n = header.numVertexDiffsInEachChunk[k][0], row = anchor.get(i);
      if (!row) { rowsOk = n === 0; return; }
      moving++; regions.add(value(headMorphRoot.targets[i].regionName));
      const same = isDeepStrictEqual(header.targetPositionDiffOffset[k], headMorphBlob.header.targetPositionDiffOffset[i]) &&
        isDeepStrictEqual(header.targetPositionDiffScale[k], headMorphBlob.header.targetPositionDiffScale[i]);
      const d0 = header.targetStartsInVertexDiffs[k], m0 = header.targetStartsInVertexDiffsMapping[k] * 4;
      rowsOk = same && n === count && Array.from({ length: n }, (_, r) => r).every(r =>
        diffs.readUInt32LE((d0 + r) * 12) === row.readUInt32LE(0) && diffs.readUInt32LE((d0 + r) * 12 + 4) === NEUTRAL_DELTA_WORD &&
        diffs.readUInt32LE((d0 + r) * 12 + 8) === NEUTRAL_DELTA_WORD && mapping.readUInt16LE(m0 + r * 2) === r);
    });
    check(`morph:${spec.stem}`, rowsOk,
      `${keep.length} head targets (${spec.regions === "all" ? "all regions" : spec.regions.join(", ")}, rig matrices kept); ${moving} move the anchor ` +
      `(${[...regions].sort().join(", ") || "none"}); each carries the anchor's exact position delta on all ${count} vertices, neutral normal/tangent; base blob = the mesh's`);
  }
  return checks;
}

// ---------------------------------------------------------------------------------------------------------------
// Additivity against the installation

export interface InstalledCreator {
  readonly base: CcoResource;
  readonly fix: XlFix | undefined;
  /** Installed CCXL resources in ArchiveXL load order (the probe itself excluded). */
  readonly customs: readonly CcoResource[];
  /** Labels the installed catalogue shows (option and choice texts after localisation). */
  readonly labels: ReadonlySet<string>;
  /** Depot paths any mounted archive provides, among the probe's own paths. */
  readonly takenPaths: readonly string[];
}

const topLevel = (o: CcoOption) => !o.hidden;
export function verifyAdditive(installed: InstalledCreator, probe: CcoResource): Check[] {
  const checks: Check[] = [];
  const check = (id: string, ok: boolean, detail: string) => { checks.push({ id, ok, detail }); };
  const before = mergeCustomizations(installed.base, installed.fix, installed.customs).cco;
  const after = mergeCustomizations(installed.base, installed.fix, [...installed.customs, probe]).cco;
  for (const part of ["head", "body", "arms"] as const) {
    const old = before.parts[part].options, now = after.parts[part].options;
    const unchanged = old.every((o, i) => isDeepStrictEqual(o, now[i]));
    const added = now.slice(old.length).map(o => o.name);
    const expected = part === "head" ? ROWS.map(r => r.option) : [];
    check(`additive:${part}`, unchanged && isDeepStrictEqual(added, expected),
      `${old.length} installed ${part} options unchanged after merging the probe; appended: ${added.join(", ") || "none"}`);
    const groupsOk = before.parts[part].groups.every((g, i) => {
      const n = after.parts[part].groups[i];
      const extra = n.options.slice(g.options.length);
      return n.name === g.name && isDeepStrictEqual(n.options.slice(0, g.options.length), g.options) &&
        isDeepStrictEqual(extra, part === "head" && (GROUPS as readonly string[]).includes(g.name) ? ROWS.map(r => r.option) : []);
    });
    check(`additive-groups:${part}`, groupsOk, part === "head" ? `only ${GROUPS.join(" and ")} gained the probe's two rows` : "no group changed");
  }
  const all = (["head", "body", "arms"] as const).flatMap(part => before.parts[part].options);
  const names = new Set(all.map(o => o.name)), slots = new Set(all.flatMap(o => [o.uiSlot, ...(o.type === "switcher" ? o.uiSlots : [])]));
  const definitionNames = new Set(all.flatMap(o => o.type === "appearance" ? o.definitions.map(d => d.name) : []));
  const probeDefinitions = ROWS.flatMap(r => [r.off, ...r.looks.map(l => l.name)]);
  check("unique-names", ROWS.every(r => !names.has(r.option) && !slots.has(r.option)) && probeDefinitions.every(n => !definitionNames.has(n)),
    `no installed option, slot or definition uses ${ROWS.map(r => r.option).join(", ")} or the ${probeDefinitions.length} probe definition names`);
  const headIndices = new Map<number, string[]>();
  for (const o of before.parts.head.options.filter(topLevel)) headIndices.set(o.index, [...(headIndices.get(o.index) ?? []), o.name]);
  const clashes = ROWS.filter(r => headIndices.has(r.index)).map(r => `${r.index}: ${headIndices.get(r.index)!.join(", ")}`);
  const lower = [...headIndices.keys()].filter(i => i < ROWS[0].index).sort((a, b) => b - a)[0];
  const upper = [...headIndices.keys()].filter(i => i > ROWS[ROWS.length - 1].index).sort((a, b) => a - b)[0];
  check("free-indices", clashes.length === 0,
    clashes.length ? `taken: ${clashes.join("; ")}` : `indices ${ROWS.map(r => r.index).join(", ")} are free; neighbours ${lower} (${headIndices.get(lower)!.join(", ")}) and ${upper} (${headIndices.get(upper)!.join(", ")})`);
  const labels = ROWS.flatMap(r => [r.label, ...r.looks.map(l => l.label)]);
  const taken = labels.filter(l => installed.labels.has(l.toLowerCase()));
  check("unique-labels", taken.length === 0, taken.length ? `already shown: ${taken.join(", ")}` : `none of ${labels.length} probe labels is shown by an installed option or choice; no numeric labels`);
  check("unique-paths", installed.takenPaths.length === 0,
    installed.takenPaths.length ? `already provided: ${installed.takenPaths.join(", ")}` : "no mounted archive provides any of the probe's depot paths");
  return checks;
}


/**
 * The rolling window's record of one V's resolution (docs/diagnostics.md §Rolling window): every decision the resolver made, as
 * references only. Which app, mesh, morph target and material each creator option led to; which archive won each (and which it
 * beat, and by what rule); ArchiveXL overrides, patches, fixes and copies; dynamic-material expansions; and the gaps and
 * ambiguities. Material values that aren't resources are left out (they are what the resources say, and the report can extract
 * those tables on demand). Pure.
 */
import type { ResolvedCharacter, ResolvedChunkMaterial, ResolvedComponent } from "../character-resolver";
import type { Provenance } from "../resource-graph";

type Compact = Record<string, unknown>;
const provenance = (item: Provenance | null | undefined): Compact | null => item ? {
  ref: { hash: item.ref.hash, path: item.ref.path ?? null }, status: item.status, archive: item.archive, provider: item.provider, group: item.group,
  ...(item.alternatives.length ? { alternatives: item.alternatives } : {}), rule: item.rule.rule,
  ...(item.via.length ? { via: item.via.map(hop => ({ kind: hop.kind, to: hop.to.path ?? hop.to.hash })) } : {}),
  ...(item.ambiguities.length ? { ambiguities: item.ambiguities } : {}),
  ...(item.extractedSha256 ? { sha256: item.extractedSha256 } : {}),
} : null;

const material = (item: ResolvedChunkMaterial): Compact => ({
  chunk: item.chunk, name: item.name, route: item.route, entry: item.entry, dynamic: item.dynamic,
  chain: item.chain.map(link => ({ label: link.label, base: link.baseMaterial, resource: provenance(link.provenance) })),
  template: provenance(item.template),
  // Only the parameters that name a resource or were expanded: the decisions, not the values.
  params: item.params.filter(param => param.resource || param.dynamic).map(param => ({ name: param.name, setBy: param.setBy,
    ...(param.resource ? { resource: provenance(param.resource) } : {}), ...(param.dynamic ? { dynamic: param.dynamic } : {}) })),
  ...(item.gaps.length ? { gaps: item.gaps } : {}),
});

const component = (item: ResolvedComponent): Compact => ({
  name: item.name, type: item.type, origin: item.origin, meshAppearance: item.meshAppearance, chunkMask: item.chunkMask,
  ...(item.overriddenBy.length ? { overriddenBy: item.overriddenBy } : {}),
  geometry: item.geometry ? { mesh: provenance(item.geometry.mesh), morphTarget: provenance(item.geometry.morphTarget),
    drawnFrom: provenance(item.geometry.drawnFrom), patchedFrom: item.geometry.patchedFrom, renderChunks: item.geometry.renderChunks,
    visibleChunks: item.geometry.visibleChunks, drawsNothing: item.geometry.drawsNothing,
    morphTexture: item.geometry.morphTexture ? { texture: provenance(item.geometry.morphTexture.texture), parameter: item.geometry.morphTexture.parameter } : null } : null,
  meshAppearanceResolved: item.meshAppearanceResolved,
  materials: item.materials.map(material),
  ...(item.notes.length ? { notes: item.notes.map(note => note.rule) } : {}),
});

/** A V's resolution as the rolling window records it. */
export function resolutionTrace(resolved: ResolvedCharacter): Compact {
  return {
    bodyGender: resolved.bodyGender, origin: resolved.origin,
    cco: { base: provenance(resolved.cco.base), customResources: resolved.cco.customResources.map(item => ({ path: item.path, declaredBy: item.declaredBy,
      resource: provenance(item.provenance) })), hairColorTags: resolved.cco.hairColorTags },
    appearances: resolved.appearances.map(item => ({
      part: item.part, option: item.option, groups: item.groups, definition: item.definition,
      requestedApp: item.requestedApp.path ?? item.requestedApp.hash, app: provenance(item.app),
      appOverride: item.appOverride ? { to: item.appOverride.to.path ?? item.appOverride.to.hash, registeredBy: item.appOverride.registeredBy } : null,
      choice: item.choice, appearance: item.appearance, components: item.components.map(component),
      ...(item.notes.length ? { notes: item.notes.map(note => note.rule) } : {}),
    })),
    morphs: resolved.morphs, ambiguities: resolved.ambiguities, gaps: resolved.gaps, rules: resolved.rules.map(note => note.rule),
  };
}

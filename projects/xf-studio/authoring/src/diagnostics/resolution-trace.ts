/**
 * The rolling window's record of one V's resolution (docs/diagnostics.md §Rolling window): every decision the resolver made, as
 * references only. Which app, mesh, morph target and material each creator option led to; which archive won each (and which it
 * beat, and by what rule); ArchiveXL overrides, patches, fixes and copies; dynamic-material expansions; and the gaps and
 * ambiguities. Material values that aren't resources are left out (they are what the resources say, and the report can extract
 * those tables on demand). Pure.
 *
 * **One table of resources.** A V's parts share most of their resources (the same material templates, textures and apps appear under
 * every component), so each distinct resource decision is written once in `resources`, and every place that used it holds its
 * index there. That keeps a heavily modded V's record to a fraction of its inline size (DIAG-04).
 */
import type { ResolvedCharacter, ResolvedChunkMaterial, ResolvedComponent } from "../character-resolver";
import type { Provenance } from "../resource-graph";

type Compact = Record<string, unknown>;
/** The event's size bound and what it keeps when a record is still too large (`TraceWindow.event`). */
export const RESOLUTION_TRACE_OPTIONS = Object.freeze({ bytes: 2 * 1024 * 1024, items: 20_000,
  keep: Object.freeze(["resources", "bodyGender", "origin", "ambiguities", "gaps", "rules"]) });

class ResourceTable {
  readonly rows: Compact[] = [];
  private readonly index = new Map<string, number>();
  /** The resource's index in the table, adding it the first time; null for no resource. */
  add(item: Provenance | null | undefined): number | null {
    if (!item) return null;
    const row: Compact = {
      ref: { hash: item.ref.hash, path: item.ref.path ?? null }, status: item.status, archive: item.archive, provider: item.provider, group: item.group,
      ...(item.alternatives.length ? { alternatives: item.alternatives } : {}), rule: item.rule.rule,
      ...(item.via.length ? { via: item.via.map(hop => ({ kind: hop.kind, to: hop.to.path ?? hop.to.hash })) } : {}),
      ...(item.ambiguities.length ? { ambiguities: item.ambiguities } : {}),
      ...(item.extractedSha256 ? { sha256: item.extractedSha256 } : {}),
    };
    const key = JSON.stringify(row);
    let found = this.index.get(key);
    if (found === undefined) { found = this.rows.length; this.rows.push(row); this.index.set(key, found); }
    return found;
  }
}

const material = (table: ResourceTable, item: ResolvedChunkMaterial): Compact => ({
  chunk: item.chunk, name: item.name, route: item.route, entry: item.entry, dynamic: item.dynamic,
  chain: item.chain.map(link => ({ label: link.label, base: link.baseMaterial, resource: table.add(link.provenance) })),
  template: table.add(item.template),
  // Only the parameters that name a resource or were expanded: the decisions, not the values.
  params: item.params.filter(param => param.resource || param.dynamic).map(param => ({ name: param.name, setBy: param.setBy,
    ...(param.resource ? { resource: table.add(param.resource) } : {}), ...(param.dynamic ? { dynamic: param.dynamic } : {}) })),
  ...(item.gaps.length ? { gaps: item.gaps } : {}),
});

const component = (table: ResourceTable, item: ResolvedComponent): Compact => ({
  name: item.name, type: item.type, origin: item.origin, meshAppearance: item.meshAppearance, chunkMask: item.chunkMask,
  ...(item.overriddenBy.length ? { overriddenBy: item.overriddenBy } : {}),
  geometry: item.geometry ? { mesh: table.add(item.geometry.mesh), morphTarget: table.add(item.geometry.morphTarget),
    drawnFrom: table.add(item.geometry.drawnFrom), patchedFrom: item.geometry.patchedFrom, renderChunks: item.geometry.renderChunks,
    visibleChunks: item.geometry.visibleChunks, drawsNothing: item.geometry.drawsNothing,
    morphTexture: item.geometry.morphTexture ? { texture: table.add(item.geometry.morphTexture.texture), parameter: item.geometry.morphTexture.parameter } : null } : null,
  meshAppearanceResolved: item.meshAppearanceResolved,
  materials: item.materials.map(entry => material(table, entry)),
  ...(item.notes.length ? { notes: item.notes.map(note => note.rule) } : {}),
});

/**
 * A V's resolution as the rolling window records it. Every field that names a resource (`app`, `mesh`, `template`, `resource`…)
 * holds that resource's index in `resources`, or null.
 */
export function resolutionTrace(resolved: ResolvedCharacter): Compact {
  const table = new ResourceTable();
  const body = {
    bodyGender: resolved.bodyGender, origin: resolved.origin,
    cco: { base: table.add(resolved.cco.base), customResources: resolved.cco.customResources.map(item => ({ path: item.path, declaredBy: item.declaredBy,
      resource: table.add(item.provenance) })), hairColorTags: resolved.cco.hairColorTags },
    appearances: resolved.appearances.map(item => ({
      part: item.part, option: item.option, groups: item.groups, definition: item.definition,
      requestedApp: item.requestedApp.path ?? item.requestedApp.hash, app: table.add(item.app),
      appOverride: item.appOverride ? { to: item.appOverride.to.path ?? item.appOverride.to.hash, registeredBy: item.appOverride.registeredBy } : null,
      choice: item.choice, appearance: item.appearance, components: item.components.map(entry => component(table, entry)),
      ...(item.notes.length ? { notes: item.notes.map(note => note.rule) } : {}),
    })),
    morphs: resolved.morphs, ambiguities: resolved.ambiguities, gaps: resolved.gaps, rules: resolved.rules.map(note => note.rule),
  };
  return { ...body, resources: table.rows };
}

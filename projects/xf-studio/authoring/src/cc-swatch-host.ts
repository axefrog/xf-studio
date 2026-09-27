/**
 * Host service: the Character panel's colour swatches (cc-swatch.ts), computed from the resolver's answers on the installation the
 * catalogue was built from, in the background, and kept on disk.
 *
 * - **Work.** One swatch per key of the plan: a family's first candidates are resolved together (one `resolveCharacter` over their
 *   descriptors, so a family's `.app`, entity and mesh are read once), then each chunk's template is identified, its profile, gradient
 *   and small texture mips read, and the colour derived. A key whose candidate yields nothing tries the next candidate in a later round.
 *   Families go in catalogue order, the families of rows the panel asks about first; the work yields between families, so a preview
 *   preparation on the same resolver is never held up for long.
 * - **Textures** are read at a small mip (cc-swatch.ts `swatchTextureSide`: 64 px, 512 for a decal's diffuse) by the route's native decoder only; without one, a swatch that
 *   needs a texture falls back as the module says.
 * - **Cache.** Per body gender, route, reader identity and swatch rules (`SWATCH_VERSION`), in `<resolver cache>/swatches/`. Each family
 *   records the resources it read and the archive each came from; on load a family is kept only when every one of those resources still
 *   comes from the same archive, unchanged (size and time), so a mod installed or updated recomputes only the families it touches.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BodyGender, CcCatalogue } from "./cc-catalogue";
import { appearanceChunks, encodeSwatch, pickSwatchChunk, SWATCH_TEXTURE_SIDE, SWATCH_VERSION, swatchColours, swatchNeeds, swatchPlan, type SwatchPlan, type SwatchReads,
  type SwatchTexture } from "./cc-swatch";
import { planChunk } from "./character-detail-plan";
import { gradientStops, hairProfileStops, loadTemplates } from "./character-detail-service";
import { loadMergedCco, resolveCharacter, type ResolvedParam } from "./character-resolver";
import { depotHash, refLabel } from "./depot-path";
import { decodePng } from "./png";
import { renderTemplate } from "./render-templates";
import type { Installation } from "./resolver-host";
import type { Provenance } from "./resource-graph";

const CACHE_SCHEMA = "xfs/cc-swatches-1";

type FamilyRecord = { swatches: Record<string, string>; reads: [string, string][] };
type CacheFile = { schema: typeof CACHE_SCHEMA; version: number; families: Record<string, FamilyRecord>; archives: Record<string, string> };

export interface SwatchAnswer {
  /** Each position's compact swatch (cc-swatch.ts `encodeSwatch`), "" when it has none (yet). */
  readonly swatches: readonly string[];
  /** Some of the option's swatches are still being worked out. */
  readonly pending: boolean;
}
export interface SwatchStats {
  readonly keys: number; readonly done: number; readonly derived: number; readonly fromCache: number; readonly families: number;
  readonly ms: number; readonly resolveMs: number; readonly readMs: number; readonly textures: number; readonly textureMs: number;
}

export class CreatorSwatches {
  private readonly plan: SwatchPlan;
  /** key → encoded swatch ("" = worked out, none). Absent: not yet. */
  private readonly done = new Map<string, string>();
  private readonly familyOf = new Map<string, string>();
  private readonly queue: string[];
  private readonly finished = new Set<string>();
  private readonly records = new Map<string, FamilyRecord>();
  private readonly templates = { identities: new Map<string, { name: string | null; priority: string | null }>(), defaults: new Map<string, ResolvedParam[]>() };
  /** Decoded texture mips by resource, with the side each was asked for (a larger ask reads again). */
  private readonly textures = new Map<string, { side: number; texture: SwatchTexture | null }>();
  private readonly stamps = new Map<string, string>();
  private running: Promise<void> | null = null;
  private stopped = false;
  private stats = { derived: 0, fromCache: 0, families: 0, ms: 0, resolveMs: 0, readMs: 0, textures: 0, textureMs: 0 };
  private readonly file: string;

  constructor(private readonly installation: Installation, catalogue: CcCatalogue, private readonly options: { cacheDir: string; gender: BodyGender;
    routeKey: string; log?: (message: string) => void }) {
    this.plan = swatchPlan(catalogue);
    for (const [family, keys] of this.plan.families) for (const key of keys) this.familyOf.set(key, family);
    this.queue = [...this.plan.families.keys()];
    const reader = installation.summary.nativeReader?.state === "on" ? installation.summary.nativeReader.identity : "wolvenkit";
    const name = createHash("sha256").update(`${options.routeKey}\n${options.gender}\n${reader}\n${SWATCH_VERSION}`).digest("hex").slice(0, 24);
    this.file = join(options.cacheDir, "swatches", `${name}.json`);
    this.loadCache();
  }

  /** How far the work is, for logs and measurements. */
  get progress(): SwatchStats {
    return { keys: this.plan.targets.size, done: this.done.size, ...this.stats };
  }

  /** An option's swatches by position; asking puts its family first in the queue and starts the work. */
  answer(optionId: string): SwatchAnswer | null {
    const keys = this.plan.options.get(optionId);
    if (!keys) return null;
    const families = new Set(keys.flatMap(key => key ? [this.familyOf.get(key)!] : []));
    for (const family of families) if (!this.finished.has(family)) { const at = this.queue.indexOf(family); if (at > 0) { this.queue.splice(at, 1); this.queue.unshift(family); } }
    const swatches = keys.map(key => key ? this.done.get(key) ?? "" : "");
    const pending = keys.some(key => key !== null && !this.done.has(key));
    if (pending) this.start();
    return { swatches, pending };
  }
  /** The swatch of one choice (the view's current choices), or null. */
  swatchOf(optionId: string, position: number): string | null {
    const key = this.plan.options.get(optionId)?.[position];
    return key ? this.done.get(key) || null : null;
  }
  /** Work out every swatch in the background (the host warms them once the catalogue is ready). */
  start(): Promise<void> {
    if (!this.running && !this.stopped && this.queue.length) this.running = this.work().finally(() => { this.running = null; });
    return this.running ?? Promise.resolve();
  }
  stop() { this.stopped = true; }

  private async work() {
    const began = performance.now();
    while (this.queue.length && !this.stopped) {
      const family = this.queue.shift()!;
      if (this.finished.has(family)) continue;
      try { await this.family(family); }
      catch (error) { this.options.log?.(`Swatches of ${family.slice(0, 60)} couldn't be worked out: ${(error as Error)?.message ?? error}`); }
      this.finished.add(family);
      for (const key of this.plan.families.get(family) ?? []) if (!this.done.has(key)) this.done.set(key, "");
      this.stats.families++;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    this.stats.ms += performance.now() - began;
    this.saveCache();
    // Every family is worked out: the decoded texture mips and template reads served only the work (14 MB on the reference
    // installation's 450 mips), so they go now instead of staying for the session (DESK-08).
    if (!this.queue.length) { this.textures.clear(); this.templates.identities.clear(); this.templates.defaults.clear(); }
    this.options.log?.(`Creator swatches (${this.options.gender}): ${this.done.size} of ${this.plan.targets.size} in ${(this.stats.ms / 1000).toFixed(1)} s ` +
      `(${this.stats.fromCache} from the cache, ${this.stats.derived} derived; resolving ${(this.stats.resolveMs / 1000).toFixed(1)} s, reading ` +
      `${(this.stats.readMs / 1000).toFixed(1)} s, ${this.stats.textures} texture mips in ${(this.stats.textureMs / 1000).toFixed(1)} s).`);
  }

  private async family(family: string) {
    const graph = this.installation.graph;
    const keys = (this.plan.families.get(family) ?? []).filter(key => !this.done.has(key));
    if (!keys.length) return;
    const merged = await loadMergedCco(graph, this.options.gender);
    const recording = graph.beginReads();
    const textureReads = new Map<string, string>();
    const swatches: Record<string, string> = {};
    try {
      let open = keys;
      for (let round = 0; round < 3 && open.length; round++) {
        const tried = open.flatMap(key => { const candidate = this.plan.targets.get(key)?.[round]; return candidate ? [{ key, candidate }] : []; });
        if (!tried.length) break;
        const t0 = performance.now();
        const resolved = await resolveCharacter(graph, { bodyGender: this.options.gender, origin: "descriptors", morphs: [],
          appearances: tried.map(({ candidate }) => ({ part: candidate.part, group: candidate.group, option: candidate.option, app: candidate.app, definition: candidate.definition })) }, merged);
        this.stats.resolveMs += performance.now() - t0;
        const t1 = performance.now();
        const byChoice = new Map(resolved.appearances.map(appearance => [`${appearance.part}|${appearance.option}|${appearance.definition}`, appearance]));
        await loadTemplates(graph, resolved.appearances.flatMap(appearance => appearanceChunks(appearance).flatMap(material => material.template ? [material.template] : [])), this.templates);
        // Each tried choice's colour chunk and what it needs read.
        const picked = tried.map(({ key, candidate }) => {
          const appearance = byChoice.get(`${candidate.part}|${candidate.option}|${candidate.definition}`);
          const chunks = (appearance ? appearanceChunks(appearance) : []).map(material => {
            const template = material.template ? refLabel(material.template.ref) : null;
            const identity = template ? this.templates.identities.get(template.toLowerCase()) : undefined;
            const adapter = renderTemplate(template, identity?.name)?.adapter ?? null;
            return { material, adapter };
          });
          const best = pickSwatchChunk(chunks);
          if (!best?.adapter) return { key, candidate, best: null };
          const decal = best.adapter === "double-diffuse-decal" || best.adapter === "mesh-decal";
          const chunk = planChunk(best.material, this.templates.defaults, null, this.templates.identities, decal ? "face" : "hair");
          return { key, candidate, best: { adapter: best.adapter, chunk, material: best.material } };
        });
        const profiles = new Map<string, ReturnType<SwatchReads["profile"]>>(), gradients = new Map<string, ReturnType<SwatchReads["gradient"]>>();
        await Promise.all(picked.flatMap(({ best }) => {
          if (!best) return [];
          const needs = swatchNeeds(best.adapter, best.chunk);
          return [...needs.profiles.map(async ref => {
            const id = refLabel(ref.ref).toLowerCase();
            if (profiles.has(id)) return;
            profiles.set(id, null);
            const loaded = await graph.load(ref.ref, "hp");
            const stops = loaded ? hairProfileStops(loaded.root) : null;
            profiles.set(id, stops ? { sampleCount: stops.sampleCount, rootToTip: stops.rootToTip } : null);
          }), ...needs.gradients.map(async ref => {
            const id = refLabel(ref.ref).toLowerCase();
            if (gradients.has(id)) return;
            gradients.set(id, null);
            const loaded = await graph.load(ref.ref, "gradient");
            gradients.set(id, loaded ? gradientStops(loaded.root) : null);
          }), ...needs.textures.map((ref, at) => this.texture(ref, needs.sides[at] ?? SWATCH_TEXTURE_SIDE, textureReads))];
        }));
        this.stats.readMs += performance.now() - t1;
        const reads: SwatchReads = {
          profile: ref => profiles.get(refLabel(ref.ref).toLowerCase()) ?? null,
          gradient: ref => gradients.get(refLabel(ref.ref).toLowerCase()) ?? null,
          texture: ref => this.textures.get(refLabel(ref.ref).toLowerCase())?.texture ?? null,
        };
        const next: string[] = [];
        for (const { key, candidate, best } of picked) {
          const colors = best ? swatchColours(best.adapter, best.chunk, reads) : null;
          if (!colors || !best) { next.push(key); continue; }
          // Replaced: a resource the colour is read from (its profile, gradient or colour textures, or the material instance that sets its colour)
          // comes from a mod archive other than the choice's own supplier. What else the chunk draws with (strand textures, a mesh's base
          // material) doesn't change the colour.
          const needs = swatchNeeds(best.adapter, best.chunk);
          const colourParams = best.material.params.filter(param => param.name === "DiffuseColor" || param.name === "TintColor");
          const sources: (Provenance | null)[] = [...needs.profiles, ...needs.gradients, ...needs.textures,
            ...colourParams.map(param => best.material.chain.find(link => link.label === param.setBy)?.provenance ?? null)];
          const replaced = sources.some(source => source?.group === "mod" && (candidate.vanilla || source.provider !== candidate.mod));
          const encoded = encodeSwatch({ colors, replaced });
          this.done.set(key, encoded);
          swatches[key] = encoded;
          this.stats.derived++;
        }
        open = next;
      }
    } finally { recording.end(); }
    const readsOf: [string, string][] = [];
    for (const hash of recording.reads) { const winner = graph.lookup(hash).winner; if (winner) readsOf.push([hash, winner.id]); }
    for (const [hash, archive] of textureReads) readsOf.push([hash, archive]);
    this.records.set(family, { swatches, reads: readsOf });
  }

  /** A texture's small mip, decoded natively once per resource (null when there is no native decoder or it can't be read). */
  private async texture(ref: Provenance, side: number, reads: Map<string, string>): Promise<void> {
    const id = refLabel(ref.ref).toLowerCase();
    const graph = this.installation.graph;
    const { entry, lookup } = graph.locate(ref.ref);
    if (lookup.winner) reads.set(lookup.hash, lookup.winner.id);
    const known = this.textures.get(id);
    if (known && known.side >= side) return;
    this.textures.set(id, { side, texture: known?.texture ?? null });
    const decoder = this.installation.native?.decoder;
    const path = entry.path ?? graph.named(entry).path;
    if (!decoder?.decodeTexture || !lookup.winner || !path) return;
    const began = performance.now();
    try {
      const outcome = await decoder.decodeTexture({ archivePath: lookup.winner.id, hash: depotHash(path), maxSide: side });
      if (outcome.ok) {
        const image = decodePng(outcome.texture.png);
        this.textures.set(id, { side, texture: { width: image.width, height: image.height, data: image.data, isGamma: outcome.texture.isGamma } });
      }
    } catch { /* The swatch falls back without it. */ }
    this.stats.textures++;
    this.stats.textureMs += performance.now() - began;
  }

  private stamp(archive: string): string {
    let known = this.stamps.get(archive);
    if (known === undefined) {
      try { const stat = statSync(archive); known = `${stat.size}|${Math.trunc(stat.mtimeMs)}`; } catch { known = "missing"; }
      this.stamps.set(archive, known);
    }
    return known;
  }
  private loadCache() {
    let file: CacheFile;
    try { file = JSON.parse(readFileSync(this.file, "utf8")) as CacheFile; } catch { return; }
    if (file?.schema !== CACHE_SCHEMA || file.version !== SWATCH_VERSION || !file.families) return;
    const graph = this.installation.graph;
    for (const [family, record] of Object.entries(file.families)) {
      if (!this.plan.families.has(family) || !record || !Array.isArray(record.reads)) continue;
      // Kept only while every resource it read comes from the same, unchanged archive.
      const same = record.reads.every(([hash, archive]) => graph.lookup(hash).winner?.id === archive && file.archives?.[archive] === this.stamp(archive));
      if (!same) continue;
      for (const key of this.plan.families.get(family)!) this.done.set(key, typeof record.swatches?.[key] === "string" ? record.swatches[key]! : "");
      this.records.set(family, record);
      this.finished.add(family);
      this.stats.fromCache += this.plan.families.get(family)!.length;
    }
  }
  private saveCache() {
    const archives: Record<string, string> = {};
    for (const record of this.records.values()) for (const [, archive] of record.reads) archives[archive] = this.stamp(archive);
    const file: CacheFile = { schema: CACHE_SCHEMA, version: SWATCH_VERSION, families: Object.fromEntries(this.records), archives };
    try {
      mkdirSync(join(this.file, ".."), { recursive: true });
      writeFileSync(`${this.file}.tmp`, JSON.stringify(file));
      renameSync(`${this.file}.tmp`, this.file);
    } catch (error) { this.options.log?.(`Creator swatches weren't kept on disk: ${(error as Error)?.message ?? error}`); }
  }
}

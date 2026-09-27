/**
 * Host service: the creator's choice icons as compact sheets (cc-icons.ts), and the Character panel's swatch source that serves them with
 * the colour swatches (cc-swatch-host.ts).
 *
 * - **Which icons**: every colour row's choices whose icon record resolved to an atlas part (the compiled TweakDB, overlaid with the
 *   TweakXL records the installed mods declare: tweakxl-overlay.ts), grouped by atlas. One sheet per atlas, holding only the parts in
 *   use.
 * - **How**: the atlas through the resolver (the winning archive, as any resource; WolvenKit reads it while the native reader doesn't
 *   verify `inkTextureAtlas`), its texture's largest mip at or under `ICON_TEXTURE_SIDE` through the native texture reader, then the
 *   parts cut and packed. Sheets are kept in `<resolver cache>/icons/`, named by a key over the atlas's and texture's winning archives
 *   (path, size and time), the parts and the sheet rules, so a mod replacing the atlas makes a new sheet.
 * - **Never an error in the panel**: an atlas, texture or part that can't be read leaves those choices without an icon; the swatch or
 *   the colour shows instead (design §4.2). What was left out is logged once.
 * Game and mod pictures stay in the ignored local cache and are served only to the local Studio page.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BodyGender, CcCatalogue } from "./cc-catalogue";
import type { CcIconSheet } from "./cc-panel";
import type { SwatchSource } from "./cc-catalogue-service";
import { buildSheet, ICON_CELL, ICON_SHEET_COLUMNS, ICON_SHEET_VERSION, iconTarget, readAtlas, type AtlasPart } from "./cc-icons";
import { isColourRow } from "./cc-swatch";
import { CreatorSwatches } from "./cc-swatch-host";
import { depotHash, refLabel } from "./depot-path";
import { decodePng, encodePng } from "./png";
import type { Installation } from "./resolver-host";

/** Largest side of an atlas texture mip the sheets are cut from (a 2.31 creator icon is about 160 px at 2048). */
export const ICON_TEXTURE_SIDE = 2048;

type Sheet = { id: number; atlas: string; parts: string[]; cells: Map<string, number>; key: string | null; png: Uint8Array | null; failed: boolean };

export class CreatorIcons {
  /** Option ID → per position [sheet id, part] or null. */
  private readonly positions = new Map<string, readonly ([number, string] | null)[]>();
  private readonly sheets: Sheet[] = [];
  private running: Promise<void> | null = null;
  private stopped = false;
  readonly stats = { atlases: 0, parts: 0, ms: 0, built: 0, fromCache: 0, missing: 0 };

  constructor(private readonly installation: Installation, catalogue: CcCatalogue, private readonly options: { cacheDir: string; log?: (message: string) => void }) {
    const byAtlas = new Map<string, Sheet>();
    for (const option of catalogue.options) {
      if (!isColourRow(option)) continue;
      this.positions.set(option.id, option.choices.map(choice => {
        const target = iconTarget(choice.swatch?.icon);
        if (!target) return null;
        let sheet = byAtlas.get(target.atlas.hash);
        if (!sheet) {
          sheet = { id: this.sheets.length, atlas: target.atlas.hash, parts: [], cells: new Map(), key: null, png: null, failed: false };
          if (sheet.id > 255) return null;
          byAtlas.set(target.atlas.hash, sheet);
          this.sheets.push(sheet);
          if (target.atlas.path) installation.graph.paths.set(target.atlas.hash, target.atlas.path);
        }
        if (!sheet.cells.has(target.part)) { sheet.cells.set(target.part, sheet.parts.length); sheet.parts.push(target.part); }
        return [sheet.id, target.part];
      }));
    }
    this.stats.atlases = this.sheets.length;
    this.stats.parts = this.sheets.reduce((n, sheet) => n + sheet.parts.length, 0);
  }

  /** A row's icons by position (`<sheet>:<cell>`, "" for none) and the sheets they use; pending while sheets are being made. */
  answer(option: string): { icons: string[]; sheets: CcIconSheet[]; pending: boolean } {
    const positions = this.positions.get(option) ?? [];
    const used = new Set<number>(), icons = positions.map(entry => {
      if (!entry) return "";
      const sheet = this.sheets[entry[0]]!, cell = sheet.cells.get(entry[1]);
      if (!sheet.key || cell === undefined || sheet.failed) return "";
      used.add(sheet.id);
      return `${sheet.id}:${cell}`;
    });
    const pending = positions.some(entry => entry && !this.sheets[entry[0]]!.key && !this.sheets[entry[0]]!.failed);
    if (pending) this.start();
    return { icons, pending, sheets: [...used].map(id => { const sheet = this.sheets[id]!;
      return { id, key: sheet.key!, columns: Math.min(ICON_SHEET_COLUMNS, sheet.parts.length), rows: Math.ceil(sheet.parts.length / ICON_SHEET_COLUMNS), cell: ICON_CELL }; }) };
  }
  /** A sheet's PNG by its ID and key. */
  sheet(id: number, key: string): Uint8Array | null {
    const sheet = this.sheets[id];
    return sheet?.key === key ? sheet.png : null;
  }
  start(): Promise<void> {
    if (!this.running && !this.stopped && this.sheets.some(sheet => !sheet.key && !sheet.failed)) this.running = this.work().finally(() => { this.running = null; });
    return this.running ?? Promise.resolve();
  }
  stop() { this.stopped = true; }

  private async work() {
    const began = performance.now();
    // Every atlas read together, so the ones WolvenKit reads share one launch.
    const graph = this.installation.graph;
    await Promise.all(this.sheets.filter(sheet => !sheet.key && !sheet.failed).map(sheet =>
      graph.load(graph.named({ hash: sheet.atlas, path: graph.paths.get(sheet.atlas) ?? null }), "inkatlas").catch(() => null)));
    for (const sheet of this.sheets) {
      if (this.stopped) break;
      if (sheet.key || sheet.failed) continue;
      try { await this.make(sheet); }
      catch (error) { sheet.failed = true; this.options.log?.(`Creator icons of one atlas couldn't be made: ${(error as Error)?.message ?? error}`); }
    }
    this.stats.ms += performance.now() - began;
    const failed = this.sheets.filter(sheet => sheet.failed);
    this.options.log?.(`Creator icons: ${this.sheets.length - failed.length} of ${this.sheets.length} sheets (${this.stats.parts} icons; ${this.stats.fromCache} from the cache, ` +
      `${this.stats.built} made) in ${(this.stats.ms / 1000).toFixed(1)} s${failed.length ? `; left out: ${failed.map(sheet => this.installation.graph.paths.get(sheet.atlas) ?? sheet.atlas).join(", ")}` : ""}.`);
  }

  private stamp(path: string) { try { const stat = statSync(path); return `${stat.size}|${Math.trunc(stat.mtimeMs)}`; } catch { return "missing"; } }
  private async make(sheet: Sheet) {
    const graph = this.installation.graph;
    const atlasRef = graph.named({ hash: sheet.atlas, path: graph.paths.get(sheet.atlas) ?? null });
    const atlasAt = graph.locate(atlasRef).lookup.winner;
    if (!atlasAt) { sheet.failed = true; this.stats.missing++; return; }
    const loaded = await graph.load(atlasRef, "inkatlas");
    const atlas = readAtlas(loaded?.root);
    if (!atlas.texture) { sheet.failed = true; this.stats.missing++; return; }
    const located = graph.locate(atlas.texture), textureAt = located.lookup.winner;
    const texturePath = located.entry.path ?? graph.named(located.entry).path;
    if (!textureAt || !texturePath) { sheet.failed = true; this.stats.missing++; return; }
    const parts = sheet.parts.map(name => atlas.parts.get(name) ?? null);
    const key = createHash("sha256").update(JSON.stringify([ICON_SHEET_VERSION, ICON_TEXTURE_SIDE, ICON_CELL, sheet.atlas, atlasAt.id, this.stamp(atlasAt.id),
      texturePath.toLowerCase(), textureAt.id, this.stamp(textureAt.id), sheet.parts, parts])).digest("hex").slice(0, 32);
    const file = join(this.options.cacheDir, "icons", `${key}.png`);
    if (existsSync(file)) {
      try { sheet.png = readFileSync(file); sheet.key = key; this.stats.fromCache++; return; } catch { /* Made again below. */ }
    }
    const decoder = this.installation.native?.decoder;
    if (!decoder?.decodeTexture) { sheet.failed = true; return; }
    const outcome = await decoder.decodeTexture({ archivePath: textureAt.id, hash: depotHash(texturePath), maxSide: ICON_TEXTURE_SIDE });
    if (!outcome.ok) { sheet.failed = true; this.options.log?.(`The icon texture ${refLabel(atlas.texture)} couldn't be read (${outcome.kind}).`); return; }
    const image = decodePng(outcome.texture.png);
    // A part the atlas lacks shows nothing in the creator: its cell stays empty (transparent).
    const cells: AtlasPart[] = parts.map(part => part ?? { left: 0, top: 0, right: 0, bottom: 0 });
    const png = encodePng(buildSheet(image, cells.map(part => part.right > part.left ? part : { left: 0, top: 0, right: 1e-6, bottom: 1e-6 })), { alpha: true });
    mkdirSync(join(this.options.cacheDir, "icons"), { recursive: true });
    writeFileSync(`${file}.tmp`, png);
    renameSync(`${file}.tmp`, file);
    sheet.png = png; sheet.key = key; this.stats.built++;
  }
}

/** The Character panel's swatch source: the colour swatches and the icons of a built catalogue, together. */
export function creatorSwatchSource(installation: Installation, catalogue: CcCatalogue,
  options: { cacheDir: string; gender: BodyGender; routeKey: string; log?: (message: string) => void }): SwatchSource {
  const swatches = new CreatorSwatches(installation, catalogue, options);
  const icons = new CreatorIcons(installation, catalogue, options);
  return {
    answer(option) {
      const colours = swatches.answer(option);
      if (!colours) return null;
      const pictures = icons.answer(option);
      return { swatches: colours.swatches, icons: pictures.icons, sheets: pictures.sheets, pending: colours.pending || pictures.pending };
    },
    swatchOf: (option, position) => swatches.swatchOf(option, position),
    sheet: (id, key) => icons.sheet(id, key),
    start() { void icons.start().then(() => swatches.start()); },
    stop() { swatches.stop(); icons.stop(); },
  };
}

/**
 * Worn items → the garments the game draws, the areas they hide and what they change on V's body (knowledge/clothing.md §3–§4). Pure apart
 * from the resource graph and two small ports the host implements: item records (the compiled TweakDB) and the game's cooked
 * appearance-name visual-tag preset. Every rule is the game's or a core framework's, read from their data; no item, mod or framework is
 * named here.
 *
 * The chain per worn item [resource] [source]:
 * 1. **Record** (TweakDB): `entityName`, `appearanceName`, `appearanceSuffixes`, `visualTags`, `garmentOffset`.
 * 2. **Factory**: `entityName` → the root entity, from the game's item factories and every factory an `.xl` adds (FactoryIndex; a later
 *    factory's row for the same name wins [hypothesis]). The engine's own factory list is native; its item factories are the `.csv`s it
 *    ships at `…\gameplay\factories\items\` (`FACTORIES`) [resource: present in the 2.31 archives].
 * 3. **Root appearance**: the item's suffixes evaluated for this V (`Gender` from the body, `Camera` = third person, `Partial` from the
 *    outer torso item's `hide_T1part`, `HairType` from the creator's hair tags, ArchiveXL's `BodyType`, `ArmsState`, `FeetState` and
 *    `LegsState`), then the most specific root appearance whose `&` suffixes are all among them (`&Female&TPP` over `&Female` over the
 *    bare name) [wiki: ArchiveXL suffixes, "Suffix load order"]. A root tagged `EmptyAppearance:<suffix>` for a suffix the V has draws
 *    nothing (ArchiveXL `OnResolveAppearance`). Items resolved through ArchiveXL dynamic appearances (a `!` name or the root's
 *    `DynamicAppearance` tag) are reported, not guessed (clothing render phase 5).
 * 4. **Visual tags**: the record's, the cooked preset's for (root entity, root appearance), the root entity's `visualTagsSchema` and the
 *    `.app` definition's own `visualTags` (ArchiveXL `OnGetVisualTags` adds the resource tags to the preset's).
 * 5. **Hiding** (`equipmentSystem.script`, 2.31): an area is hidden by an item in another shown area whose tags include the area's slot tag
 *    (`SLOT_TAGS`), by its saved `isHidden` when no saved item's tag explains it (a wardrobe set's empty area), by the viewer's dressing
 *    (`shown`), and, for underwear, by the underwear rules (the bottom under anything on the legs or `hide_L1`; the top under anything on
 *    the inner chest or `hide_T1`, the game's censored rule, which the Studio's "underwear on" policy follows).
 * 6. **Overrides onto V**: each drawn item's `.app` definition `visualTags` through every `.xl`'s `overrides.tags` rules, and its
 *    entity-wide `partsOverrides` (ArchiveXL `RegisterComponentOverrides`); the body resolves with them (character-resolver.ts).
 * 7. **Layer score** per garment component: its prefix's base (`LAYER_BASE`) plus its part entity's size tag (`LAYER_TAGS`) [wiki: garment
 *    support]; with no outfit framework active ArchiveXL clears item garment offsets, so the prefix and tag decide.
 */
import type { ArchiveXlConfig } from "./archivexl-config";
import { type BodyGender, type ComponentOverrides, componentPrefix, NO_OVERRIDES, resolveAppDefinition, type ResolvedCharacter,
  type ResolvedComponent } from "./character-resolver";
import { depotHash, refFromPath, refLabel, type DepotRef } from "./depot-path";
import { asArray, cname, depotRef, isObject, type JsonObject } from "./red-json";
import type { Ambiguity } from "./resolution-evidence";
import { entityVisualTags, type Provenance, type ResourceGraph } from "./resource-graph";
import type { ClothingArea, WornArea } from "./save-loadout";

import type { HairType } from "./clothing-dressing";
export { HAIR_TYPES, hairTypeOf, type HairType } from "./clothing-dressing";

/** What to dress V in: the saved areas (all of them, for the saved-hide rule) and the areas the viewer's dressing shows. */
export type ClothingInput = {
  readonly bodyGender: BodyGender;
  readonly hairType: HairType;
  readonly worn: readonly WornArea[];
  readonly shown: readonly ClothingArea[];
};

/** The fields of a TweakDB item record the chain reads. */
export type ItemRecord = {
  readonly entityName: string;
  readonly appearanceName: string;
  /** The suffix records by name where the host could name them (`Gender`, `Camera`, …), else their IDs. */
  readonly suffixes: readonly string[];
  readonly visualTags: readonly string[];
  readonly garmentOffset: number;
};
export interface ClothingPorts {
  /** Item records by the save's decimal TweakDBID; null for an ID the compiled TweakDB doesn't define (a TweakXL item). */
  records(items: readonly string[]): Promise<ReadonlyMap<string, ItemRecord | null>> | ReadonlyMap<string, ItemRecord | null>;
  /** The cooked preset's tags for a root entity (depot hash) and root appearance name; null when the preset couldn't be read. */
  presetTags(entityHash: string, appearance: string): readonly string[] | null;
}

/** The vanilla slot table (`InitializeClothingSlotsInfo`): each area and the visual tag that hides it. */
export const SLOT_TAGS: Readonly<Partial<Record<ClothingArea, string>>> = Object.freeze({ OuterChest: "hide_T2", InnerChest: "hide_T1", Legs: "hide_L1",
  Feet: "hide_S1", Head: "hide_H1", Face: "hide_F1", UnderwearBottom: "hide_Genitals" });
/** The game's item factories [resource: the `.csv`s under the item factory folders of the 2.31 archives]. */
export const FACTORIES: readonly string[] = ["base\\gameplay\\factories\\items\\clothing.csv", "base\\gameplay\\factories\\items\\items.csv",
  "base\\gameplay\\factories\\items\\cyberware.csv", "base\\gameplay\\factories\\items\\consumables.csv", "ep1\\gameplay\\factories\\items\\clothing.csv",
  "ep1\\gameplay\\factories\\items\\cyberware.csv"];
/** Garment layer base scores by component prefix, and size-tag modifiers [wiki: "Garment support: how does it work?"]. */
export const LAYER_BASE: Readonly<Record<string, number>> = Object.freeze({ s0: 0, l0: 10, a0: 20, t0: 30, h0: 40, s1: 50, l1: 60, t1: 70, i1: 80, hh: 90,
  h1: 100, h2: 110, t2: 120 });
export const LAYER_TAGS: Readonly<Record<string, number>> = Object.freeze({ PlayerBodyPart: -2000, Tight: -1000, Normal: 0, Large: 1000, XLarge: 2000 });
/** A garment component's layer score: its prefix's base, plus its part entity's size tag (null when its prefix has no base). */
export function layerScore(component: string, tags: readonly string[]): number | null {
  const base = LAYER_BASE[component.slice(0, 2).toLowerCase()];
  if (base === undefined || component[2] !== "_") return null;
  return base + (tags.map(tag => LAYER_TAGS[tag]).find(value => value !== undefined) ?? 0);
}

export type GarmentStatus = "drawn" | "hidden" | "unresolved";
export type GarmentHiddenBy = { readonly kind: "dressing" | "saved" | "tag" | "underwear" | "empty"; readonly tag?: string; readonly area?: ClothingArea };
export type ResolvedGarment = {
  readonly area: ClothingArea;
  readonly item: string;
  readonly status: GarmentStatus;
  readonly hiddenBy: GarmentHiddenBy | null;
  /** Why an item couldn't be followed to its meshes, as a code and one plain line. */
  readonly gap: { readonly code: string; readonly detail: string } | null;
  /** Plain words for the item (from its appearance name), for labels only. */
  readonly label: string;
  readonly record: ItemRecord | null;
  readonly rootEntity: Provenance | null;
  readonly rootAppearance: string | null;
  readonly app: Provenance | null;
  readonly definition: string | null;
  readonly tags: readonly string[];
  /** Drawn items: their resolved components and each component's layer score (by component name). */
  readonly components: readonly ResolvedComponent[];
  readonly layers: Readonly<Record<string, number>>;
};
export type ResolvedClothing = {
  readonly garments: readonly ResolvedGarment[];
  /** What the drawn items change on every component of the player (ArchiveXL tag rules and entity-wide `partsOverrides`). */
  readonly overrides: ComponentOverrides;
  /** The feet group the body uses: lifted in footwear, flat without (female V; `ResolveFeetState`, the creator's feet groups). */
  readonly feet: "flat" | "lifted";
  /** ArchiveXL's feet state for `{feet}` and the feet suffixes. */
  readonly feetState: "Flat" | "Lifted" | "HighHeels" | "FlatShoes" | "None";
  readonly gaps: ResolvedCharacter["gaps"];
  readonly ambiguities: readonly Ambiguity[];
};

const UNDERWEAR: readonly ClothingArea[] = ["UnderwearTop", "UnderwearBottom"];
const ALL = (1n << 64n) - 1n;

/** Plain words for an item from its appearance name (`t1_tshirt_01_q000_nomad_` → `tshirt nomad`). */
export function itemWords(appearanceName: string): string {
  const words = appearanceName.replace(/^[a-z][a-z0-9]_/i, "").split(/[_!&+]+/).filter(word => word && !/^[0-9]+$/.test(word) && !/^q[0-9]{3}$/i.test(word) &&
    !/^(basic|old|rich|poor|default)$/i.test(word));
  return words.join(" ").trim().slice(0, 60) || "item";
}

type RootAppearance = { name: string; app: DepotRef | null; definition: string };
/** A root entity's appearances (`entTemplateAppearance {name, appearanceResource, appearanceName}`) and its own visual tags. */
function readRootEntity(root: JsonObject): { appearances: RootAppearance[]; tags: string[] } {
  const appearances = asArray(root.appearances).filter(isObject).map(entry => ({ name: cname(entry.name), app: depotRef(entry.appearanceResource),
    definition: cname(entry.appearanceName) })).filter(entry => entry.name);
  return { appearances, tags: entityVisualTags(root) };
}

/**
 * The most specific root appearance for an item: its appearance name followed by `&`-separated suffix values, every one of which the V has
 * (`values`); more suffixes win, then list order. Null when none matches.
 */
export function pickRootAppearance(appearances: readonly RootAppearance[], base: string, values: ReadonlySet<string>): RootAppearance | null {
  let best: RootAppearance | null = null, bestCount = -1;
  for (const entry of appearances) {
    if (!entry.name.startsWith(base)) continue;
    const rest = entry.name.slice(base.length);
    if (rest && !rest.startsWith("&")) continue;
    const tokens = rest ? rest.slice(1).split("&") : [];
    if (!tokens.every(token => values.has(token))) continue;
    if (tokens.length > bestCount) { best = entry; bestCount = tokens.length; }
  }
  return best;
}

/** The entity-name → root-entity table of every item factory, read once per graph. */
const factoryTables = new WeakMap<ResourceGraph, Promise<{ table: Map<string, { path: string; factory: string }>; read: string[] }>>();
export function factoryTable(graph: ResourceGraph, xl: ArchiveXlConfig): Promise<{ table: Map<string, { path: string; factory: string }>; read: string[] }> {
  let pending = factoryTables.get(graph);
  if (!pending) {
    pending = (async () => {
      const paths = [...FACTORIES, ...xl.factories.map(entry => entry.path)];
      const loaded = await Promise.all(paths.map(path => { const ref = refFromPath(path); return graph.exists(ref.hash) ? graph.load(ref, "csv") : Promise.resolve(null); }));
      const table = new Map<string, { path: string; factory: string }>(), read: string[] = [];
      loaded.forEach((resource, index) => {
        if (!resource) return;
        read.push(paths[index]!);
        // A `C2dArray`'s rows: [name, path, preload] [resource: clothing.csv].
        for (const row of asArray(resource.root.compiledData)) {
          if (!Array.isArray(row) || typeof row[0] !== "string" || typeof row[1] !== "string" || !row[0] || !row[1]) continue;
          table.set(row[0], { path: row[1], factory: paths[index]! });
        }
      });
      return { table, read };
    })();
    factoryTables.set(graph, pending);
    pending.catch(() => factoryTables.delete(graph));
  }
  return pending;
}

/** ArchiveXL tag rules of `tags`, folded into per-key masks (showing masks ORed, hiding masks ANDed), with who added each. */
function addTagRules(masks: Map<string, { show: bigint; hide: bigint; by: string[] }>, xl: ArchiveXlConfig, tags: readonly string[], by: string) {
  for (const tag of tags) for (const rule of xl.tagRules.get(tag) ?? []) {
    const entry = masks.get(rule.component) ?? { show: 0n, hide: ALL, by: [] };
    if (rule.show !== null) entry.show |= rule.show;
    if (rule.hide !== null) entry.hide &= rule.hide;
    if (!entry.by.includes(`${by}: ${tag}`)) entry.by.push(`${by}: ${tag}`);
    masks.set(rule.component, entry);
  }
}

/** Resolve what V wears (see the module comment). */
export async function resolveClothing(graph: ResourceGraph, input: ClothingInput, ports: ClothingPorts): Promise<ResolvedClothing> {
  const gaps: ResolvedCharacter["gaps"][number][] = [], ambiguities: Ambiguity[] = [];
  const records = await ports.records(input.worn.map(entry => entry.item));
  const factories = await factoryTable(graph, graph.xl);
  type Working = { worn: WornArea; record: ItemRecord | null; root: { ref: DepotRef; appearances: RootAppearance[]; tags: string[]; provenance: Provenance } | null;
    picked: RootAppearance | null; tags: string[]; definitionTags: string[]; gap: { code: string; detail: string } | null; empty: boolean };
  const working: Working[] = await Promise.all(input.worn.map(async (worn): Promise<Working> => {
    const record = records.get(worn.item) ?? null;
    const out: Working = { worn, record, root: null, picked: null, tags: [], definitionTags: [], gap: null, empty: false };
    if (!record) { out.gap = { code: "item-unknown", detail: "The game's compiled item records don't define it (an item a mod adds with TweakXL isn't read yet)." }; return out; }
    out.tags = [...record.visualTags];
    if (record.appearanceName.includes("!")) { out.gap = { code: "item-dynamic", detail: "It uses an ArchiveXL dynamic appearance, which the preview doesn't read yet." }; return out; }
    const factory = factories.table.get(record.entityName);
    if (!factory) { out.gap = { code: "item-factory-missing", detail: `No item factory lists its entity (${record.entityName}).` }; return out; }
    const ref = refFromPath(factory.path);
    const loaded = await graph.load(ref, "ent");
    if (!loaded) { out.gap = { code: "item-entity-missing", detail: `Its root entity (${factory.path}) couldn't be read from the game files.` }; return out; }
    const { appearances, tags } = readRootEntity(loaded.root);
    out.root = { ref: loaded.ref, appearances, tags, provenance: loaded.provenance };
    out.tags.push(...tags);
    if (tags.includes("DynamicAppearance")) out.gap = { code: "item-dynamic", detail: "It uses an ArchiveXL dynamic appearance, which the preview doesn't read yet." };
    return out;
  }));
  const gender = input.bodyGender === "male" ? "Male" : "Female";
  const shownArea = (area: ClothingArea) => input.shown.includes(area);
  const pick = async (entry: Working, partial: "Part" | "Full") => {
    if (!entry.root || !entry.record || entry.gap) return;
    const values = new Set([gender, "TPP", partial, input.hairType, "base_body", "BaseArms"]);
    const picked = pickRootAppearance(entry.root.appearances, entry.record.appearanceName, values);
    entry.picked = picked;
    entry.empty = false;
    if (!picked) { entry.gap = { code: "item-appearance-missing", detail: `Its entity has no appearance for ${entry.record.appearanceName} on this V.` }; return; }
    // ArchiveXL: `EmptyAppearance:<suffix>` on the root makes the item draw nothing for a V with that suffix.
    if (entry.root.tags.some(tag => tag.startsWith("EmptyAppearance:") && values.has(tag.slice("EmptyAppearance:".length)))) entry.empty = true;
    const preset = ports.presetTags(entry.root.ref.hash, picked.name);
    const app = picked.app ? await graph.app(picked.app) : null;
    const definition = app?.appearances.find(item => item.name === picked.definition);
    entry.definitionTags = definition?.visualTags ?? [];
    entry.tags = [...new Set([...entry.record.visualTags, ...entry.root.tags, ...preset ?? [], ...entry.definitionTags])];
  };
  // The outer torso first: its `hide_T1part` makes the inner torso take its partial look while the outer chest shows.
  const outer = working.find(entry => entry.worn.area === "OuterChest");
  if (outer) await pick(outer, "Full");
  const partial = outer && shownArea("OuterChest") && !outer.worn.hidden && outer.tags.includes("hide_T1part") ? "Part" : "Full";
  await Promise.all(working.filter(entry => entry !== outer).map(entry => pick(entry, partial)));

  // Hiding.
  const hiddenBy = new Map<ClothingArea, GarmentHiddenBy>();
  const tagOwner = (tag: string, among: readonly Working[], except: ClothingArea) => among.find(entry => entry.worn.area !== except && entry.tags.includes(tag));
  const savedVisible = working.filter(entry => !entry.worn.hidden);
  for (const entry of working) {
    const area = entry.worn.area;
    if (!shownArea(area)) { hiddenBy.set(area, { kind: "dressing" }); continue; }
    if (entry.empty) { hiddenBy.set(area, { kind: "empty" }); continue; }
    // A saved hide no saved item's tag explains is the player's own (a wardrobe set's empty area); one a tag explains is decided again below.
    const slotTag = SLOT_TAGS[area];
    if (entry.worn.hidden && !UNDERWEAR.includes(area) && !(slotTag && tagOwner(slotTag, savedVisible, area))) hiddenBy.set(area, { kind: "saved" });
  }
  const candidates = working.filter(entry => !hiddenBy.has(entry.worn.area) && !entry.gap);
  for (const entry of candidates) {
    const slotTag = SLOT_TAGS[entry.worn.area];
    const owner = slotTag ? tagOwner(slotTag, candidates, entry.worn.area) : undefined;
    if (slotTag && owner) hiddenBy.set(entry.worn.area, { kind: "tag", tag: slotTag, area: owner.worn.area });
  }
  const visible = candidates.filter(entry => !hiddenBy.has(entry.worn.area));
  const active = (tag: string) => visible.some(entry => entry.tags.includes(tag));
  const covers = (area: ClothingArea) => visible.some(entry => entry.worn.area === area);
  for (const entry of visible) {
    if (entry.worn.area === "UnderwearBottom" && (covers("Legs") || active("hide_L1")))
      hiddenBy.set("UnderwearBottom", covers("Legs") ? { kind: "underwear", area: "Legs" } : { kind: "underwear", tag: "hide_L1" });
    if (entry.worn.area === "UnderwearTop" && (covers("InnerChest") || active("hide_T1")))
      hiddenBy.set("UnderwearTop", covers("InnerChest") ? { kind: "underwear", area: "InnerChest" } : { kind: "underwear", tag: "hide_T1" });
  }
  const drawn = working.filter(entry => !entry.gap && entry.picked && !hiddenBy.has(entry.worn.area));

  // What the drawn items change on V (ArchiveXL RegisterComponentOverrides): their definitions' tags through the `.xl` rules, and their
  // entity-wide parts overrides.
  const masks = new Map<string, { show: bigint; hide: bigint; by: string[] }>();
  const appearances = new Map<string, { appearance: string; by: string }>();
  for (const entry of drawn) {
    const label = itemWords(entry.record!.appearanceName);
    addTagRules(masks, graph.xl, entry.definitionTags, label);
    const app = entry.picked!.app ? await graph.app(entry.picked!.app) : null;
    const definition = app?.appearances.find(item => item.name === entry.picked!.definition);
    for (const part of definition?.partsOverrides ?? []) if (!part.partResource) for (const override of part.componentsOverrides) {
      if (!override.componentName) continue;
      const maskEntry = masks.get(override.componentName) ?? { show: 0n, hide: ALL, by: [] };
      let value: bigint; try { value = BigInt(override.chunkMask) & ALL; } catch { value = ALL; }
      maskEntry.hide &= value;
      if (!maskEntry.by.includes(label)) maskEntry.by.push(label);
      masks.set(override.componentName, maskEntry);
      if (override.meshAppearance && override.meshAppearance !== "default") appearances.set(override.componentName, { appearance: override.meshAppearance, by: label });
    }
  }
  const overrides: ComponentOverrides = masks.size || appearances.size ? { masks, appearances } : NO_OVERRIDES;

  // The drawn items' meshes, with every drawn item's overrides.
  const garments: ResolvedGarment[] = [];
  for (const entry of working) {
    const hidden = hiddenBy.get(entry.worn.area) ?? null;
    const base = { area: entry.worn.area, item: entry.worn.item, record: entry.record, label: entry.record ? itemWords(entry.record.appearanceName) : "item",
      rootEntity: entry.root?.provenance ?? null, rootAppearance: entry.picked?.name ?? null, app: null as Provenance | null,
      definition: entry.picked?.definition ?? null, tags: entry.tags, components: [] as ResolvedComponent[], layers: {} as Record<string, number> };
    if (entry.gap) { gaps.push({ code: entry.gap.code, subject: `${entry.worn.area} ${entry.worn.item}`, detail: entry.gap.detail });
      garments.push({ ...base, status: "unresolved", hiddenBy: hidden, gap: entry.gap }); continue; }
    if (hidden || !entry.picked) { garments.push({ ...base, status: "hidden", hiddenBy: hidden, gap: null }); continue; }
    if (!entry.picked.app) {
      const gap = { code: "item-app-missing", detail: `Its root appearance ${entry.picked.name} names no appearance resource.` };
      garments.push({ ...base, status: "unresolved", hiddenBy: null, gap }); continue;
    }
    const resolved = await resolveAppDefinition(graph, entry.picked.app, entry.picked.definition, { overrides });
    gaps.push(...resolved.gaps);
    ambiguities.push(...resolved.ambiguities);
    const layers: Record<string, number> = {};
    for (const component of resolved.components) {
      const partTags = component.origin.kind === "part" ? resolved.partTags.get(component.origin.source) ?? [] : [];
      const score = layerScore(component.name, partTags);
      if (score !== null) layers[component.name] = score;
    }
    const drawsSomething = resolved.components.some(component => component.geometry && !component.geometry.drawsNothing);
    garments.push({ ...base, app: resolved.app, components: resolved.components, layers,
      status: resolved.appearance.status === "missing" || resolved.appearance.status === "unreadable" ? "unresolved" : drawsSomething ? "drawn" : "hidden",
      hiddenBy: drawsSomething ? null : { kind: "empty" },
      gap: resolved.appearance.status === "missing" || resolved.appearance.status === "unreadable"
        ? { code: `item-appearance-${resolved.appearance.status}`, detail: `Its appearance ${entry.picked.definition} in ${refLabel(entry.picked.app)} couldn't be read.` } : null });
  }
  const feetItem = drawn.find(entry => entry.worn.area === "Feet");
  const feetState = input.bodyGender === "male" ? "None" : !feetItem ? "Flat" : feetItem.tags.includes("HighHeels") ? "HighHeels"
    : feetItem.tags.includes("FlatShoes") || feetItem.tags.includes("force_FlatFeet") ? "FlatShoes" : "Lifted";
  return { garments, overrides, feet: feetItem ? "lifted" : "flat", feetState, gaps, ambiguities };
}

/** The depot hash of a root entity path, as the cooked preset keys it (`entityPathHash`). */
export const presetKey = (path: string) => depotHash(path);
/** Whether a component name carries a prefix ArchiveXL would match (re-exported for the planner's labels). */
export { componentPrefix };

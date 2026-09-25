/**
 * The character context: who the makeup is shown on. A DOM-free domain service holding one creator choice per option
 * (portable identities: part, option name, choice key), initialised from the creator's default V, a decoded save or a
 * portable CC preset (`xfs/cc-preset-1`), changed through typed actions with capabilities, and validated against the
 * installed creator catalogue. From the values it derives the resolver's descriptors through the shared rule R5
 * (`descriptorsFromUiState`), which the preview host resolves. It never writes a save and never enters a makeup recipe,
 * collection or package (feature-module platform §2: a CC preset is preview context, not a part).
 *
 * Rules beyond R5, each from the game's data:
 * - **Links** [resource-inferred, knowledge/cc-file-chain.md "Links"]: choosing on a link controller gives every option
 *   with the same link key, in any part, the same choice position when it has one (skin tone → skin types, body, arms;
 *   one hair colour → every hairstyle's colour). A follower with fewer choices keeps its own.
 * - **From a save**: the save stores resolved appearances and morphs, not switcher or controller state
 *   (knowledge/cc-file-chain.md §7). Appearance and morph options take the saved choice; a switcher takes the choice whose
 *   activated options the save lists (its Off choice when it lists none); a colour-only controller takes the position of
 *   a saved member of its link. The result is checked by deriving the descriptors again and comparing with the save.
 */
import { CCO_PARTS, type AppearanceDescriptor, type CcoPart, type CcoResource, descriptorsFromUiState, type MorphDescriptor } from "./cco-model";
import { type BodyGender, CatalogueIndex, type CcCatalogue, type CcChoice, type CcOption, followsLink, userFacing } from "./cc-catalogue";
import { CC_PRESET_SCHEMA, type CcPreset, type CcPresetEntry, parseCcPreset } from "./cc-preset";
import { CHARACTER_REQUEST_SCHEMA, type CharacterRequest, DEFAULT_CHARACTER } from "./character-detail-request";
import { depotHash } from "./depot-path";
import type { Ambiguity } from "./resolution-evidence";
import { actionTable, type ActionDescriptor, type Capability, familyId, refusal, type SystemFamily, type ValueSchema } from "./platform/api";
import type { SavedV } from "./save-reader";

/** One body gender's creator: the catalogue and the merged resource R5 derives descriptors from. */
export interface CharacterSource { readonly catalogue: CcCatalogue; readonly cco: CcoResource }

export type CharacterContextAction =
  | { kind: "character.setOption"; part: CcoPart; option: string; choice: string }
  | { kind: "character.reset"; part?: CcoPart; option?: string }
  | { kind: "character.useDefault"; bodyGender: BodyGender }
  | { kind: "character.loadSave"; value: SavedV }
  | { kind: "character.loadPreset"; value: unknown };

export interface MissingChoice {
  readonly part: CcoPart;
  readonly option: string;
  /** The choice as the save or preset names it. */
  readonly choice: string;
  /** The mod the preset says supplies it; null for vanilla or when a save doesn't say. */
  readonly mod: string | null;
  readonly reason: "option-missing" | "choice-missing";
}
export interface MissingReport {
  readonly entries: readonly MissingChoice[];
  /** One plain line per mod (null: not named by the source). */
  readonly summary: readonly { readonly mod: string | null; readonly count: number; readonly message: string }[];
}
export interface SaveCheck {
  /** Saved appearance and morph choices the derived V reproduces, of all saved ones (deduplicated across groups). */
  readonly matched: number;
  readonly saved: number;
  /** Saved `option = choice` pairs the derived V lacks, and derived ones the save lacks (first 32 each). */
  readonly savedOnly: readonly string[];
  readonly derivedOnly: readonly string[];
}
export type ContextOrigin = { readonly kind: "default" } | { readonly kind: "save" } | { readonly kind: "preset"; readonly name: string | null };
export interface CharacterValue {
  readonly choice: string;
  /** Set by the user, a save or a preset (otherwise the creator default). */
  readonly explicit: boolean;
  /** The option takes part in the V now (rule R5 activation); inactive options keep their value for later. */
  readonly active: boolean;
}
export interface CharacterContextSnapshot {
  readonly bodyGender: BodyGender;
  readonly ready: boolean;
  readonly origin: ContextOrigin;
  /** Every user-facing option's value, by option ID. */
  readonly values: Readonly<Record<string, CharacterValue>>;
  readonly missing: MissingReport;
  readonly saveCheck: SaveCheck | null;
  /** Bumps on every change, for cheap change detection. */
  readonly revision: number;
}
/** What the preview host needs to draw the context: the resolver's descriptors (rule R5). */
export interface CharacterContextRequest {
  readonly bodyGender: BodyGender;
  readonly appearances: readonly AppearanceDescriptor[];
  readonly morphs: readonly MorphDescriptor[];
  readonly ambiguities: readonly Ambiguity[];
  /** True when nothing departs from the creator's default V. */
  readonly isDefault: boolean;
}

const EMPTY_MISSING: MissingReport = Object.freeze({ entries: [], summary: [] });
const NOT_READY = (gender: BodyGender) => `The ${gender === "male" ? "masculine" : "feminine"} creator options aren't loaded yet. Prepare the preview with the game folder set, then try again.`;

function summarise(entries: readonly MissingChoice[], from: "save" | "preset"): MissingReport {
  const byMod = new Map<string | null, number>();
  for (const entry of entries) byMod.set(entry.mod, (byMod.get(entry.mod) ?? 0) + 1);
  const plural = (n: number) => n === 1 ? "1 choice uses" : `${n} choices use`;
  return { entries, summary: [...byMod].map(([mod, count]) => ({ mod, count, message: mod
    ? `“${mod}” isn't installed or enabled here, so ${plural(count)} the creator default instead.`
    : from === "save"
      ? `This V has ${count === 1 ? "a choice" : `${count} choices`} the installed game and mods don't offer (a mod it used may be missing), so ${count === 1 ? "it uses" : "they use"} the creator default.`
      : `${plural(count)} the creator default because the installed game doesn't offer ${count === 1 ? "it" : "them"}.` })) };
}

/**
 * The activation half of rule R5 (cco-model.ts `descriptorsFromUiState`): which options take part in the V, so the
 * presentation shows their rows. Kept identical to that rule; a test checks that every option R5 emits is active.
 */
export function activeOptions(cco: CcoResource, state: Readonly<Record<string, string>>): Set<string> {
  const active = new Set<string>();
  for (const part of CCO_PARTS) {
    const { options } = cco.parts[part];
    const byName = new Map(options.filter(o => o.name).map(option => [option.name, option]));
    const targets = new Set<string>();
    for (const option of options) if (option.type === "switcher") for (const choice of option.options) for (const name of choice.names) targets.add(name);
    const activate = (name: string, depth = 0) => {
      const option = byName.get(name);
      if (!option || depth > 16 || active.has(`${part}/${name}`)) return;
      active.add(`${part}/${name}`);
      if (option.type !== "switcher") return;
      const choice = option.options.find(item => item.localizedName === state[name]) ?? option.options[option.defaultIndex] ?? option.options[0];
      for (const target of choice?.names ?? []) activate(target, depth + 1);
    };
    for (const option of options) if (option.name && option.enabled && !targets.has(option.name)) activate(option.name);
  }
  return active;
}

export class CharacterContext {
  private sources = new Map<BodyGender, { source: CharacterSource; index: CatalogueIndex }>();
  private gender: BodyGender = "female";
  private origin: ContextOrigin = { kind: "default" };
  private values = new Map<string, string>();
  private missing: MissingReport = EMPTY_MISSING;
  private saveCheck: SaveCheck | null = null;
  /** A loaded preset's entries this installation can't honour, its unknown entries and fields: written back on export. */
  private kept: { entries: CcPresetEntry[]; unknown: CcPreset["unknownEntries"]; extra: CcPreset["extra"] } = { entries: [], unknown: [], extra: {} };
  private revision = 0;
  private listeners = new Set<() => void>();

  /** Provide (or replace) one body gender's creator. Values that no longer exist are dropped and reported. */
  setSource(source: CharacterSource): void {
    this.sources.set(source.catalogue.bodyGender, { source, index: new CatalogueIndex(source.catalogue) });
    if (source.catalogue.bodyGender === this.gender) {
      const lost: MissingChoice[] = [];
      const index = this.sources.get(this.gender)!.index;
      for (const [id, choice] of [...this.values]) {
        const option = index.byOptionId(id);
        if (option && index.choice(option, choice)) continue;
        this.values.delete(id);
        const [part, name] = id.split("/") as [CcoPart, string];
        lost.push({ part, option: name, choice, mod: null, reason: option ? "choice-missing" : "option-missing" });
      }
      if (lost.length) this.missing = summarise([...this.missing.entries, ...lost], "preset");
    }
    this.publish();
  }
  source(gender: BodyGender = this.gender): CharacterSource | null { return this.sources.get(gender)?.source ?? null; }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish() { this.revision++; for (const listener of this.listeners) listener(); }

  /** The value of every user-facing option (explicit or default), with whether it takes part now. */
  snapshot(): CharacterContextSnapshot {
    const loaded = this.sources.get(this.gender);
    const values: Record<string, CharacterValue> = {};
    if (loaded) {
      const active = activeOptions(loaded.source.cco, this.flatState());
      for (const option of loaded.source.catalogue.options) {
        if (!userFacing(option)) continue;
        const explicit = this.values.get(option.id);
        const choice = explicit ?? option.defaultChoice;
        if (choice === null) continue;
        values[option.id] = { choice, explicit: explicit !== undefined, active: active.has(option.id) };
      }
    }
    return structuredClone({ bodyGender: this.gender, ready: !!loaded, origin: this.origin, values, missing: this.missing,
      saveCheck: this.saveCheck, revision: this.revision });
  }

  capability(action: CharacterContextAction): Capability {
    switch (action.kind) {
      case "character.setOption": {
        const loaded = this.sources.get(this.gender);
        if (!loaded) return refusal("asset_unavailable", NOT_READY(this.gender));
        const option = loaded.index.option(action.part, action.option);
        if (!option) return refusal("missing_target", "That creator option isn't offered by the installed game and mods.");
        if (option.hidden || followsLink(option)) return refusal("invalid_value", "That option follows another one, so it can't be set on its own.");
        if (!loaded.index.choice(option, action.choice)) return refusal("invalid_value", `“${action.choice || "None"}” isn't one of ${option.label.text}'s choices.`);
        return { available: true };
      }
      case "character.reset": {
        if (action.option === undefined) return { available: true };
        const loaded = this.sources.get(this.gender);
        if (!loaded) return refusal("asset_unavailable", NOT_READY(this.gender));
        return loaded.index.option(action.part ?? "head", action.option) ? { available: true }
          : refusal("missing_target", "That creator option isn't offered by the installed game and mods.");
      }
      case "character.useDefault":
        return this.sources.has(action.bodyGender) ? { available: true } : refusal("asset_unavailable", NOT_READY(action.bodyGender));
      case "character.loadSave": {
        const gender: BodyGender = action.value?.isMale ? "male" : "female";
        if (!action.value?.groups) return refusal("invalid_value", "That isn't a decoded save.");
        return this.sources.has(gender) ? { available: true } : refusal("asset_unavailable", NOT_READY(gender));
      }
      case "character.loadPreset": {
        let preset: CcPreset;
        try { preset = parseCcPreset(action.value); } catch (error) { return refusal("invalid_value", (error as Error).message); }
        return this.sources.has(preset.bodyGender) ? { available: true } : refusal("asset_unavailable", NOT_READY(preset.bodyGender));
      }
    }
  }

  /** Apply an action; throws the refusal's reason when the capability refuses. Returns the new snapshot. */
  dispatch(action: CharacterContextAction): CharacterContextSnapshot {
    const allowed = this.capability(action);
    if (!allowed.available) throw Error(allowed.reason);
    switch (action.kind) {
      case "character.setOption": this.setOption(action.part, action.option, action.choice); break;
      case "character.reset":
        if (action.option === undefined) this.start(this.gender, { kind: "default" });
        else this.values.delete(`${action.part ?? "head"}/${action.option}`);
        break;
      case "character.useDefault": this.start(action.bodyGender, { kind: "default" }); break;
      case "character.loadSave": this.loadSave(action.value); break;
      case "character.loadPreset": this.loadPreset(parseCcPreset(action.value)); break;
    }
    this.publish();
    return this.snapshot();
  }

  private start(gender: BodyGender, origin: ContextOrigin) {
    this.gender = gender;
    this.origin = origin;
    this.values = new Map();
    this.missing = EMPTY_MISSING;
    this.saveCheck = null;
    this.kept = { entries: [], unknown: [], extra: {} };
  }

  private setOption(part: CcoPart, name: string, choice: string) {
    const { index, source } = this.sources.get(this.gender)!;
    const option = index.option(part, name)!;
    this.values.set(option.id, choice);
    if (!option.link?.controller) return;
    const position = index.choice(option, choice)!.position;
    for (const member of source.catalogue.options) {
      if (member === option || member.link?.key !== option.link.key) continue;
      const same = member.choices[position];
      if (same) this.values.set(member.id, same.key);
    }
  }

  /** Members of a link family without a value take the position of one that has one (a controller first). */
  private fillLinkFamilies() {
    const { index, source } = this.sources.get(this.gender)!;
    const families = new Map<string, CcOption[]>();
    for (const option of source.catalogue.options) if (option.link) families.set(option.link.key, [...(families.get(option.link.key) ?? []), option]);
    for (const members of families.values()) {
      const known = members.find(member => member.link!.controller && this.values.has(member.id)) ?? members.find(member => this.values.has(member.id));
      if (!known) continue;
      const position = index.choice(known, this.values.get(known.id)!)!.position;
      for (const member of members) {
        if (this.values.has(member.id)) continue;
        const same = member.choices[position];
        if (same) this.values.set(member.id, same.key);
      }
    }
  }

  /** R5's state: option name → choice key (switcher choice name, definition or morph target). */
  private flatState(): Record<string, string> {
    const state: Record<string, string> = {};
    for (const [id, choice] of this.values) state[id.slice(id.indexOf("/") + 1)] = choice;
    return state;
  }

  private loadSave(saved: SavedV) {
    const gender: BodyGender = saved.isMale ? "male" : "female";
    this.start(gender, { kind: "save" });
    const { index, source } = this.sources.get(gender)!;
    const missing: MissingChoice[] = [];
    const present = new Map<CcoPart, Set<string>>(CCO_PARTS.map(part => [part, new Set<string>()]));
    const savedPairs = new Set<string>();
    for (const part of CCO_PARTS) for (const group of saved.groups[part] ?? []) {
      for (const item of group.appearances) {
        savedPairs.add(`${part}/${item.name} = ${item.definition}`);
        present.get(part)!.add(item.name);
        const option = index.option(part, item.name);
        if (option?.type === "appearance" && index.choice(option, item.definition)) this.values.set(option.id, item.definition);
        // A hidden option follows another one; its mismatch shows in the save check, not as a missing choice.
        else if (!option?.hidden && !missing.some(entry => entry.part === part && entry.option === item.name))
          missing.push({ part, option: item.name, choice: item.definition, mod: null, reason: option ? "choice-missing" : "option-missing" });
      }
      for (const morph of group.morphs) {
        savedPairs.add(`${part}/${morph.region} = ${morph.target}`);
        const option = index.option(part, morph.region);
        if (option?.type === "morph" && index.choice(option, morph.target)) this.values.set(option.id, morph.target);
        else if (!missing.some(entry => entry.part === part && entry.option === morph.region))
          missing.push({ part, option: morph.region, choice: morph.target, mod: null, reason: option ? "choice-missing" : "option-missing" });
      }
    }
    // Switchers, innermost first: the choice whose activated options the save lists (nested switchers count once chosen).
    const switchers = source.catalogue.options.filter(option => option.type === "switcher");
    for (let pass = 0, changed = true; changed && pass < 8; pass++) {
      changed = false;
      for (const option of switchers) {
        if (this.values.has(option.id)) continue;
        const names = present.get(option.part)!;
        let best: CcChoice | null = null, score = 0;
        for (const choice of option.choices) {
          const hits = choice.activates.filter(name => names.has(name)).length;
          if (hits > score) { best = choice; score = hits; }
        }
        if (best) { this.values.set(option.id, best.key); names.add(option.name); changed = true; }
      }
    }
    for (const option of switchers) if (!this.values.has(option.id)) {
      const off = option.choices.find(choice => choice.off);
      if (off) this.values.set(option.id, off.key);
    }
    // Link families: members the save doesn't list take the position of one it does (colour-only controllers, other styles' colours).
    this.fillLinkFamilies();
    this.missing = missing.length ? summarise(missing, "save") : EMPTY_MISSING;
    const derived = this.request();
    const derivedPairs = new Set([...derived.appearances.map(a => `${a.part}/${a.option} = ${a.definition}`),
      ...derived.morphs.map(m => `${m.part}/${m.region} = ${m.target}`)]);
    this.saveCheck = { matched: [...savedPairs].filter(pair => derivedPairs.has(pair)).length, saved: savedPairs.size,
      savedOnly: [...savedPairs].filter(pair => !derivedPairs.has(pair)).slice(0, 32),
      derivedOnly: [...derivedPairs].filter(pair => !savedPairs.has(pair)).slice(0, 32) };
  }

  private loadPreset(preset: CcPreset) {
    this.start(preset.bodyGender, { kind: "preset", name: preset.name });
    const { index } = this.sources.get(preset.bodyGender)!;
    const missing: MissingChoice[] = [], kept: CcPresetEntry[] = [];
    for (const entry of preset.values) {
      const option = index.option(entry.part, entry.option);
      const value = entry.value;
      const described = value.kind === "appearance" ? value.definition : value.kind === "morph" ? value.morph : value.choice;
      let choice: CcChoice | undefined;
      if (option && value.kind === "appearance" && option.type === "appearance") choice = index.choice(option, value.definition);
      else if (option && value.kind === "morph" && option.type === "morph") choice = index.choice(option, value.morph);
      else if (option && value.kind === "switcher" && option.type === "switcher") {
        // The activated options identify a switcher choice across installations; its name is the fallback.
        const wanted = [...value.activates].sort().join("|");
        choice = (wanted ? option.choices.find(item => [...item.activates].sort().join("|") === wanted) : undefined) ?? index.choice(option, value.choice);
      }
      if (option && choice && !option.hidden && !followsLink(option)) { this.values.set(option.id, choice.key); continue; }
      kept.push(entry);
      missing.push({ part: entry.part, option: entry.option, choice: described, mod: entry.mod, reason: option ? "choice-missing" : "option-missing" });
    }
    // A preset stores the options people choose; the options that follow them take the same position.
    this.fillLinkFamilies();
    this.missing = missing.length ? summarise(missing, "preset") : EMPTY_MISSING;
    this.kept = { entries: kept, unknown: preset.unknownEntries, extra: preset.extra };
  }

  /** The context as a portable preset: explicit values of user-facing options, plus what a loaded preset carried that this installation couldn't use. */
  toPreset(name: string | null = null): CcPreset {
    const loaded = this.sources.get(this.gender);
    const values: CcPresetEntry[] = [];
    if (loaded) for (const option of loaded.source.catalogue.options) {
      const key = this.values.get(option.id);
      if (key === undefined || option.hidden || followsLink(option)) continue;
      const choice = loaded.index.choice(option, key)!;
      const value = option.type === "appearance" ? { kind: "appearance" as const, definition: key, app: option.app?.hash ?? null }
        : option.type === "morph" ? { kind: "morph" as const, morph: key } : { kind: "switcher" as const, choice: key, activates: choice.activates };
      const mod = choice.provenance.kind === "mod" ? choice.provenance : null;
      values.push({ part: option.part, option: option.name, value, mod: mod?.mod ?? null,
        resource: mod?.resource ? depotHash(mod.resource) : null, extra: {} });
    }
    const taken = new Set(values.map(entry => `${entry.part}/${entry.option}`));
    for (const entry of this.kept.entries) if (!taken.has(`${entry.part}/${entry.option}`)) values.push(entry);
    return { schema: CC_PRESET_SCHEMA, bodyGender: this.gender, name: name ?? (this.origin.kind === "preset" ? this.origin.name : null),
      values, unknownEntries: this.kept.unknown, extra: this.kept.extra };
  }

  /** The resolver's descriptors for the current values (rule R5 over the merged creator resource). */
  request(): CharacterContextRequest {
    const loaded = this.sources.get(this.gender);
    if (!loaded) return { bodyGender: this.gender, appearances: [], morphs: [], ambiguities: [], isDefault: this.values.size === 0 };
    const derived = descriptorsFromUiState(loaded.source.cco, this.flatState());
    return { bodyGender: this.gender, appearances: derived.appearances, morphs: derived.morphs, ambiguities: derived.ambiguities,
      isDefault: this.values.size === 0 };
  }
}

/**
 * Today's preview request (character-detail-request.ts) for a context request, until the host takes a whole creator
 * state: the default V as `source: "default"`, anything else as the head descriptors in the saved-V shape (the host
 * resolves those exactly as it resolves a save's). Returns null when the request would exceed that shape's limits.
 */
export function previewRequestFor(request: CharacterContextRequest): CharacterRequest | null {
  if (request.isDefault && request.bodyGender === "female") return DEFAULT_CHARACTER;
  const appearances = request.appearances.filter(item => item.part === "head")
    .map(item => ({ group: item.group, option: item.option, app: item.app.hash, definition: item.definition }));
  const morphs = request.morphs.filter(item => item.part === "head").map(item => ({ group: item.group, region: item.region, target: item.target }));
  if (appearances.length > 512 || morphs.length > 128) return null;
  return { schema: CHARACTER_REQUEST_SCHEMA, source: "save", bodyGender: request.bodyGender, appearances, morphs };
}

// ---------------------------------------------------------------------------------------------------------------
// Action descriptors: the family's catalogue entry. Registration beside the Studio's other families (and a handler in
// StudioApplication) comes with the panel.

const input = (type: ValueSchema["type"], extra: Partial<ValueSchema> = {}): ValueSchema => ({ type, required: true, from: "input", ...extra });
const optional = (type: ValueSchema["type"], extra: Partial<ValueSchema> = {}): ValueSchema => ({ type, required: false, from: "input", ...extra });
type Scope = "viewport" | "file";
const desc = (scope: Scope, effect: ActionDescriptor["effect"], payload: ActionDescriptor["payload"]): ActionDescriptor<Scope> =>
  ({ scope: [scope], effect, undo: "none", payload });
export const CHARACTER_CONTEXT_DESCRIPTORS = {
  "character.setOption": desc("viewport", "workspace", { part: input("enum", { values: CCO_PARTS }), option: input("string", { minLength: 1, maxLength: 256 }),
    choice: input("string", { maxLength: 256 }) }),
  "character.reset": desc("viewport", "workspace", { part: optional("enum", { values: CCO_PARTS }), option: optional("string", { maxLength: 256 }) }),
  "character.useDefault": desc("viewport", "workspace", { bodyGender: input("enum", { values: ["female", "male"] }) }),
  "character.loadSave": desc("file", "workspace", { value: input("object") }),
  "character.loadPreset": desc("file", "workspace", { value: input("object") }),
} satisfies Record<CharacterContextAction["kind"], ActionDescriptor<Scope>>;

const CHARACTER_ID = familyId("characterContext");
export const CHARACTER_CONTEXT_FAMILY: SystemFamily<CharacterContextAction, Scope, typeof CHARACTER_ID> = Object.freeze({
  owner: "system", id: CHARACTER_ID, label: "Character",
  actions: actionTable<CharacterContextAction, Scope>(CHARACTER_CONTEXT_DESCRIPTORS, {
    "character.setOption": true, "character.reset": true, "character.useDefault": true, "character.loadSave": true, "character.loadPreset": true }),
});

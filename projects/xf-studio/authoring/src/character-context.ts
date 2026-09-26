/**
 * The character context: who the makeup is shown on. It owns every creator choice for the shown V (CORE-58): the V it starts
 * from (the creator's default V, a decoded save, or a portable `xfs/cc-preset-1` preset over the default V) and the choices a person
 * set on top of it, as portable identities (part, option name, choice key). It never writes a save and never enters a makeup recipe,
 * collection or package (feature-module platform §2: a CC preset is preview context, not a part).
 *
 * This module is pure and shared. The browser's application service (character-context-actions.ts) holds the state, its own Undo
 * history and the typed actions (`CHARACTER_CONTEXT_FAMILY`); the preview host, which has the whole installed catalogue, interprets
 * the state with `deriveCharacter` into the resolver's descriptors (rule R5) and a read-only view of every row's current choice.
 *
 * **Only what the person set is stored** (CORE-50, CORE-51). Everything else is derived each time from the base and the rules:
 * - **Links** [resource-inferred, knowledge/cc-file-chain.md "Links"]: a choice on a link member gives every option with the same link
 *   key, in any part, the same choice. Appearance and morph members take the same position (a follower with fewer choices keeps its
 *   own, and R5 records `link-index-out-of-range`). **Switcher** members take the choice that activates the same options
 *   [hypothesis, CORE-61: `hairstyle` and `hairstyle_cyberware` list their styles in different orders, so a position would pick another
 *   style; the in-game check is test ask 11 of the knowledge page]. Resetting a member resets its family to the base.
 * - **From a save**: the save stores resolved appearances and morphs, not switcher or controller state (knowledge/cc-file-chain.md §7).
 *   Appearance and morph options take the saved choice; a switcher takes the choice whose activated options the save lists (its Off
 *   choice when it lists none); a colour-only controller takes the position of a saved member of its link. With choices set on top,
 *   the save's own descriptors are kept for every option the choices don't change, so a choice changes only what it changes (a saved
 *   option this installation no longer offers still draws as saved).
 * - **From a preset**: its entries are choices over the default V. A switcher choice is matched by the options it activates first
 *   (mods renumber choices), then by name.
 */
import { activeOptionNames, CCO_PARTS, type AppearanceDescriptor, type CcoPart, type CcoResource, descriptorsFromUiState, type MorphDescriptor,
  type SwitcherPicks } from "./cco-model";
import { type BodyGender, CatalogueIndex, type CcCatalogue, type CcChoice, type CcOption, followsLink, userFacing } from "./cc-catalogue";
import { CC_PRESET_SCHEMA, type CcPreset, type CcPresetEntry, type CcPresetValue, presetEntryWritable } from "./cc-preset";
import { CREATOR_LIMITS, isCreatorName, isModName } from "./creator-names";
import { depotHash, refFromHash } from "./depot-path";
import type { Ambiguity } from "./resolution-evidence";
import { actionTable, type ActionDescriptor, familyId, type SystemFamily, type ValueSchema } from "./platform/api";

/** One body gender's creator: the catalogue and the merged resource R5 derives descriptors from. */
export interface CharacterSource { readonly catalogue: CcCatalogue; readonly cco: CcoResource; readonly index?: CatalogueIndex }

/** A choice a person set, by portable identity. */
export interface CharacterChoice {
  readonly part: CcoPart;
  readonly option: string;
  /** The choice key: definition name, morph target or switcher choice name ("" is `None`). */
  readonly choice: string;
  /** A switcher choice from a preset: the options it activates, which identify it across installations. */
  readonly activates?: readonly string[];
  /** The mod a preset says supplies it (for the missing-choice report). */
  readonly mod?: string | null;
}
/** A saved V's descriptors (every part), as the request carries them. */
export interface SavedDescriptors {
  readonly appearances: readonly { readonly part: CcoPart; readonly group: string; readonly option: string; readonly app: string; readonly definition: string }[];
  readonly morphs: readonly { readonly part: CcoPart; readonly group: string; readonly region: string; readonly target: string }[];
}
export type CharacterBase = { readonly kind: "default" } | { readonly kind: "save"; readonly saved: SavedDescriptors };

export interface MissingChoice {
  readonly part: CcoPart;
  readonly option: string;
  /** The choice as the save or preset names it. */
  readonly choice: string;
  /** The mod the preset says supplies it; null for vanilla or when a save doesn't say. */
  readonly mod: string | null;
  readonly reason: "option-missing" | "choice-missing" | "not-carried";
  /**
   * Where it came from: the V's save, a choice (a preset's, or one made in another installation) the installation doesn't offer, or a
   * preset entry the page couldn't carry to the host at all (`not-carried`: over the name or count limit; PIPE-79).
   */
  readonly from: "save" | "choice" | "preset";
}
export interface MissingReport {
  readonly entries: readonly MissingChoice[];
  /** One plain line per mod (null: not named by the source). */
  readonly summary: readonly { readonly mod: string | null; readonly count: number; readonly message: string }[];
}
export interface SaveCheck {
  /** Saved appearance and morph choices the recovered creator state reproduces, of all saved ones (deduplicated across groups). */
  readonly matched: number;
  readonly saved: number;
  /** Saved `option = choice` pairs the recovered state lacks, and derived ones the save lacks (first 32 each). */
  readonly savedOnly: readonly string[];
  readonly derivedOnly: readonly string[];
}
/**
 * One option's value in the view: the current choice, the V's own (the base's), and whether a person set it. `position` is the current
 * choice's place among the option's choices, which tells same-named choices apart (CORE-70).
 */
export interface CharacterValue { readonly choice: string; readonly own: string; readonly set: boolean; readonly position: number }
export interface CharacterView {
  readonly bodyGender: BodyGender;
  /** Every user-facing option that takes part in the V now (a row shows its active option), or that a person set. */
  readonly values: Readonly<Record<string, CharacterValue & { readonly active: boolean }>>;
  readonly missing: MissingReport;
  readonly saveCheck: SaveCheck | null;
}
/** What the preview host resolves: the resolver's descriptors (rule R5, with the save's own where nothing changed). */
export interface CharacterContextRequest {
  readonly bodyGender: BodyGender;
  readonly appearances: readonly AppearanceDescriptor[];
  readonly morphs: readonly MorphDescriptor[];
  readonly ambiguities: readonly Ambiguity[];
}
export interface CharacterDerivation { readonly view: CharacterView; readonly request: CharacterContextRequest }

const EMPTY_MISSING: MissingReport = Object.freeze({ entries: Object.freeze([]) as readonly MissingChoice[], summary: Object.freeze([]) as MissingReport["summary"] });

export function summariseMissing(entries: readonly MissingChoice[]): MissingReport {
  if (!entries.length) return EMPTY_MISSING;
  const plural = (n: number) => n === 1 ? "1 choice uses" : `${n} choices use`;
  const summary: { mod: string | null; count: number; message: string }[] = [];
  // What actually happens (UI-69): a save's own choice is still drawn as saved where its files are installed, but the creator options
  // can't show or change it; a preset's choice leaves the option at the V's own choice.
  const saved = entries.filter(entry => entry.from === "save");
  if (saved.length) summary.push({ mod: null, count: saved.length, message: `Your V uses ${saved.length === 1 ? "a choice" : `${saved.length} choices`} the installed game and mods don't offer (a mod it used may be missing), so ${saved.length === 1 ? "it can't" : "they can't"} be changed here.` });
  const byMod = new Map<string | null, number>();
  for (const entry of entries) if (entry.from === "choice") byMod.set(entry.mod, (byMod.get(entry.mod) ?? 0) + 1);
  for (const [mod, count] of byMod) summary.push({ mod, count, message: mod
    ? `“${mod}” isn't installed or enabled here, so ${count === 1 ? "1 choice keeps" : `${count} choices keep`} the V's own look instead.`
    : `The installed game and mods don't offer ${count === 1 ? "1 choice" : `${count} choices`}, so ${count === 1 ? "it keeps" : "they keep"} the V's own look.` });
  const carried = entries.filter(entry => entry.from === "preset");
  if (carried.length) summary.push({ mod: null, count: carried.length, message: `${carried.length === 1 ? "1 choice" : `${carried.length} choices`} in the preset can't be used by this XF Studio (a name is too long, or there are more than ${CREATOR_LIMITS.choices.toLocaleString("en")}), so ${carried.length === 1 ? "it's" : "they're"} left out. Saving the preset keeps ${carried.length === 1 ? "it" : "them"}.` });
  return { entries, summary };
}

const indexOf = (source: CharacterSource) => source.index ?? new CatalogueIndex(source.catalogue);
/** A creator state: each option's chosen catalogue choice, by option ID (the choice object, so same-named choices stay apart). */
type ChoiceState = Map<string, CcChoice>;
/** R5's input for a state: names by option name, and a position for a switcher choice its name alone wouldn't pick (CORE-70). */
function uiState(index: CatalogueIndex, state: ReadonlyMap<string, CcChoice>): { values: Record<string, string>; picks: SwitcherPicks } {
  const values: Record<string, string> = {}, picks: Record<string, number> = {};
  for (const [id, choice] of state) {
    const name = id.slice(id.indexOf("/") + 1);
    values[name] = choice.key;
    const option = index.byOptionId(id);
    if (option?.type === "switcher" && index.choice(option, choice.key) !== choice) picks[name] = choice.position;
  }
  return { values, picks };
}

/** The options that take part in the V for a state (R5's activation, cco-model.ts `activeOptionNames`), as option IDs. */
export function activeOptions(cco: CcoResource, state: Readonly<Record<string, string>>, picks?: SwitcherPicks): Set<string> {
  const active = new Set<string>();
  for (const part of CCO_PARTS) for (const name of activeOptionNames(cco, part, state, undefined, picks)) active.add(`${part}/${name}`);
  return active;
}

/**
 * The catalogue's choice a person's choice names: by key, or for a switcher choice that carries the options it activates, the choice
 * activating exactly those (then by key; indexed, PIPE-83). Undefined when the option doesn't offer it.
 */
export function matchChoice(index: CatalogueIndex, option: CcOption, choice: Pick<CharacterChoice, "choice" | "activates">): CcChoice | undefined {
  if (option.type === "switcher" && choice.activates?.length) {
    const byActivation = index.activating(option, choice.activates);
    if (byActivation.length) return byActivation.find(item => item.key === choice.choice) ?? byActivation[0];
  }
  return index.choice(option, choice.choice);
}

/**
 * The choice a link member takes when another member is set to `chosen` (CORE-61): a switcher member the one activating the same
 * options, anything else the same position. Undefined when it has none (it then keeps its own, as R5 does).
 */
export function linkedChoice(chosen: CcChoice, member: CcOption, from: CcOption, index?: CatalogueIndex): CcChoice | undefined {
  if (member.type === "switcher" && from.type === "switcher") return (index ?? new CatalogueIndex({ options: [member] } as unknown as CcCatalogue))
    .activating(member, chosen.activates)[0];
  return member.choices[chosen.position];
}

/** A person's choices with one per option, the last one set in its place (a later choice wins; PIPE-83). */
export function lastChoices(choices: readonly CharacterChoice[]): CharacterChoice[] {
  const last = new Map<string, number>();
  choices.forEach((choice, at) => last.set(`${choice.part}/${choice.option}`, at));
  return choices.filter((choice, at) => last.get(`${choice.part}/${choice.option}`) === at);
}

/**
 * The creator state a save stands for: saved appearances and morphs, recovered switcher choices and link families; with the
 * missing-choice report and the check of what the state reproduces. Validated input only (`savedDescriptorsOf`).
 */
export function recoverSave(source: CharacterSource, saved: SavedDescriptors): { state: ChoiceState; missing: MissingChoice[]; saveCheck: SaveCheck } {
  const index = indexOf(source), { catalogue, cco } = source;
  const state: ChoiceState = new Map(), missing: MissingChoice[] = [];
  const present = new Map<CcoPart, Set<string>>(CCO_PARTS.map(part => [part, new Set<string>()]));
  const savedPairs = new Set<string>();
  const report = (part: CcoPart, option: string, choice: string, found: boolean) => {
    if (!missing.some(entry => entry.part === part && entry.option === option))
      missing.push({ part, option, choice, mod: null, reason: found ? "choice-missing" : "option-missing", from: "save" });
  };
  for (const item of saved.appearances) {
    savedPairs.add(`${item.part}/${item.option} = ${item.definition}`);
    present.get(item.part)!.add(item.option);
    const option = index.option(item.part, item.option);
    const choice = option?.type === "appearance" ? index.choice(option, item.definition) : undefined;
    if (option && choice) state.set(option.id, choice);
    // A hidden option follows another one; its mismatch shows in the save check, not as a missing choice.
    else if (!option?.hidden) report(item.part, item.option, item.definition, !!option);
  }
  for (const morph of saved.morphs) {
    savedPairs.add(`${morph.part}/${morph.region} = ${morph.target}`);
    const option = index.option(morph.part, morph.region);
    const choice = option?.type === "morph" ? index.choice(option, morph.target) : undefined;
    if (option && choice) state.set(option.id, choice);
    else report(morph.part, morph.region, morph.target, !!option);
  }
  // Switchers, innermost first: the choice whose activated options the save lists (nested switchers count once chosen).
  const switchers = catalogue.options.filter(option => option.type === "switcher");
  for (let pass = 0, changed = true; changed && pass < 8; pass++) {
    changed = false;
    for (const option of switchers) {
      if (state.has(option.id)) continue;
      const names = present.get(option.part)!;
      let best: CcChoice | null = null, score = 0;
      for (const choice of option.choices) {
        const hits = choice.activates.filter(name => names.has(name)).length;
        if (hits > score) { best = choice; score = hits; }
      }
      if (best) { state.set(option.id, best); names.add(option.name); changed = true; }
    }
  }
  for (const option of switchers) if (!state.has(option.id)) {
    const off = option.choices.find(choice => choice.off);
    if (off) state.set(option.id, off);
  }
  // Link families: members the save doesn't list take the choice of one it does: a controller first, then a member with a row of its
  // own (a skin type), and only then a hidden one (a proxy the game may leave at its default).
  const families = new Set(catalogue.options.flatMap(option => option.link ? [option.link.key] : []));
  for (const key of families) {
    const members = index.family(key);
    const known = members.find(member => member.link!.controller && state.has(member.id)) ??
      members.find(member => !member.hidden && state.has(member.id)) ?? members.find(member => state.has(member.id));
    if (!known) continue;
    const chosen = state.get(known.id)!;
    for (const member of members) {
      if (state.has(member.id)) continue;
      const same = linkedChoice(chosen, member, known, index);
      if (same) state.set(member.id, same);
    }
  }
  const { values, picks } = uiState(index, state);
  const derived = descriptorsFromUiState(cco, values, picks);
  const derivedPairs = new Set([...derived.appearances.map(a => `${a.part}/${a.option} = ${a.definition}`),
    ...derived.morphs.map(m => `${m.part}/${m.region} = ${m.target}`)]);
  const saveCheck: SaveCheck = { matched: [...savedPairs].filter(pair => derivedPairs.has(pair)).length, saved: savedPairs.size,
    savedOnly: [...savedPairs].filter(pair => !derivedPairs.has(pair)).slice(0, 32),
    derivedOnly: [...derivedPairs].filter(pair => !savedPairs.has(pair)).slice(0, 32) };
  return { state, missing, saveCheck };
}

/**
 * Interpret a context: the base's state, the person's choices in the order they were set (a later one wins, and a link member carries
 * to its family), then R5. With a save base, the save's own descriptors are kept for every option whose derived descriptors the
 * choices leave unchanged. `recovered` passes a memoised `recoverSave` of the same save. A switcher choice carrying the options it
 * activates is that choice, even when another choice of the option has the same name (CORE-70).
 */
export function deriveCharacter(source: CharacterSource, base: CharacterBase, choices: readonly CharacterChoice[],
  recovered?: ReturnType<typeof recoverSave>): CharacterDerivation {
  const index = indexOf(source), { catalogue, cco } = source;
  const fromSave = base.kind === "save" ? recovered ?? recoverSave(source, base.saved) : null;
  const baseState: ReadonlyMap<string, CcChoice> = fromSave?.state ?? new Map<string, CcChoice>();
  const missing: MissingChoice[] = [...fromSave?.missing ?? []];
  const state: ChoiceState = new Map(baseState), set = new Set<string>();
  const effective = lastChoices(choices);
  /** Options a choice reaches: itself, its link family and what a switcher's choice turns on (they take the derived descriptors). */
  const reached = new Set<string>();
  const reach = (option: CcOption, depth = 0) => {
    if (depth > 16 || reached.has(option.id) && depth) return;
    reached.add(option.id);
    if (option.type !== "switcher") return;
    const current = state.get(option.id) ?? index.choice(option, option.defaultChoice ?? "");
    for (const name of current?.activates ?? []) { const target = index.option(option.part, name); if (target) reach(target, depth + 1); }
  };
  for (const choice of effective) {
    const option = index.option(choice.part, choice.option);
    const matched = option && !option.hidden && !followsLink(option) ? matchChoice(index, option, choice) : undefined;
    if (!option || !matched) {
      missing.push({ part: choice.part, option: choice.option, choice: choice.choice, mod: choice.mod ?? null,
        reason: option ? "choice-missing" : "option-missing", from: "choice" });
      continue;
    }
    state.set(option.id, matched);
    set.add(option.id);
    if (option.link) for (const member of index.family(option.link.key)) {
      if (member === option) continue;
      set.delete(member.id);
      const same = linkedChoice(matched, member, option, index);
      if (same) state.set(member.id, same); else state.delete(member.id);
    }
  }
  // Reached once every choice is applied, so a switcher's targets are those of its final choice.
  for (const choice of effective) {
    const option = index.option(choice.part, choice.option);
    if (!option || !set.has(option.id) && !option.link) continue;
    reach(option);
    if (option.link) for (const member of index.family(option.link.key)) reach(member);
  }
  const { values, picks } = uiState(index, state);
  const derived = descriptorsFromUiState(cco, values, picks);
  let appearances: AppearanceDescriptor[] = derived.appearances, morphs: MorphDescriptor[] = derived.morphs;
  if (base.kind === "save") {
    // Keep the save's own descriptors for every option the choices don't change.
    const own = uiState(index, baseState);
    const ownDerived = descriptorsFromUiState(cco, own.values, own.picks);
    const signature = (list: readonly { part: string; group: string }[], key: (item: never) => string, value: (item: never) => string) => {
      const out = new Map<string, string[]>();
      for (const item of list) { const k = key(item as never); out.set(k, [...out.get(k) ?? [], `${item.group}|${value(item as never)}`]); }
      for (const [k, items] of out) out.set(k, items.sort());
      return out;
    };
    const aKey = (a: AppearanceDescriptor) => `${a.part}/${a.option}`, aValue = (a: AppearanceDescriptor) => `${a.app.hash}|${a.definition}`;
    const mKey = (m: MorphDescriptor) => `${m.part}/${m.region}`, mValue = (m: MorphDescriptor) => m.target;
    const changed = (before: Map<string, string[]>, after: Map<string, string[]>) =>
      new Set([...before.keys(), ...after.keys()].filter(k => (before.get(k) ?? []).join() !== (after.get(k) ?? []).join()));
    const changedA = changed(signature(ownDerived.appearances, aKey, aValue), signature(derived.appearances, aKey, aValue));
    const changedM = changed(signature(ownDerived.morphs, mKey, mValue), signature(derived.morphs, mKey, mValue));
    for (const id of reached) { changedA.add(id); changedM.add(id); }
    appearances = [...base.saved.appearances.filter(a => !changedA.has(`${a.part}/${a.option}`))
      .map(a => ({ part: a.part, group: a.group, option: a.option, app: refFromHash(a.app), definition: a.definition })),
      ...derived.appearances.filter(a => changedA.has(aKey(a)))];
    morphs = [...base.saved.morphs.filter(m => !changedM.has(`${m.part}/${m.region}`)).map(m => ({ ...m })),
      ...derived.morphs.filter(m => changedM.has(mKey(m)))];
  }
  const active = activeOptions(cco, values, picks);
  const view: Record<string, CharacterValue & { active: boolean }> = {};
  for (const option of catalogue.options) {
    if (!userFacing(option) || (!active.has(option.id) && !set.has(option.id))) continue;
    const fallback = option.defaultChoice === null ? undefined : index.choice(option, option.defaultChoice);
    const choice = state.get(option.id) ?? fallback, own = baseState.get(option.id) ?? fallback;
    if (!choice || !own) continue;
    view[option.id] = { choice: choice.key, own: own.key, position: choice.position, set: set.has(option.id), active: active.has(option.id) };
  }
  return {
    view: { bodyGender: catalogue.bodyGender, values: view, missing: summariseMissing(missing), saveCheck: fromSave?.saveCheck ?? null },
    request: { bodyGender: catalogue.bodyGender, appearances, morphs, ambiguities: derived.ambiguities },
  };
}

/** A preset entry as a person's choice (matched against an installation only when interpreted). */
const choiceOfEntry = (entry: CcPresetEntry): CharacterChoice => ({ part: entry.part, option: entry.option,
  choice: entry.value.kind === "appearance" ? entry.value.definition : entry.value.kind === "morph" ? entry.value.morph : entry.value.choice,
  ...(entry.value.kind === "switcher" && entry.value.activates.length ? { activates: [...entry.value.activates] } : {}),
  ...(entry.mod ? { mod: entry.mod } : {}) });

/** A preset's entries as choices over the default V (every entry the reader accepted; see `carryPreset` for the limits). */
export function choicesOfPreset(preset: CcPreset): CharacterChoice[] {
  return preset.values.map(choiceOfEntry);
}

/**
 * What a preset's V carries to the host (PIPE-79): its entries as choices, as many as one V holds (`CREATOR_LIMITS.choices`), each by
 * the shared name rule. Everything else is reported (`not-carried`) and never sent: the entries past the limit, and entries the reader
 * kept verbatim because a name is too long. `carried` lists the entries it did carry, for the kept-entry bookkeeping.
 */
export function carryPreset(preset: CcPreset): { choices: CharacterChoice[]; carried: CcPresetEntry[]; notCarried: MissingChoice[] } {
  const choices: CharacterChoice[] = [], carried: CcPresetEntry[] = [], notCarried: MissingChoice[] = [];
  const report = (part: unknown, option: unknown, choice: unknown, mod: unknown) => notCarried.push({
    part: CCO_PARTS.includes(part as CcoPart) ? part as CcoPart : "head", option: typeof option === "string" ? option.slice(0, 64) : "",
    choice: typeof choice === "string" ? choice.slice(0, 64) : "", mod: typeof mod === "string" ? mod.slice(0, 64) : null, reason: "not-carried", from: "preset" });
  for (const entry of preset.values) {
    const choice = characterChoiceOf(choiceOfEntry(entry));
    if (choice && choices.length < CREATOR_LIMITS.choices) { choices.push(choice); carried.push(entry); }
    else report(entry.part, entry.option, choiceOfEntry(entry).choice, entry.mod);
  }
  for (const unusable of preset.unknownEntries) if (unusable.unusable) {
    const entry = unusable.entry as Record<string, unknown>;
    report(entry?.part, entry?.option, entry?.definition ?? entry?.morph ?? entry?.choice, entry?.mod);
  }
  return { choices, carried, notCarried };
}

/**
 * The context as a portable preset (CORE-50, CORE-53): only the choices a person set, each as this installation names it (with its
 * `.app` hash, activated options and supplying mod); a choice this installation doesn't offer is written back as the preset that
 * brought it named it. Entries the reader would refuse are left out and counted. `kept` carries a loaded preset's unknown entries and
 * fields.
 */
export function presetOfChoices(source: CharacterSource, choices: readonly CharacterChoice[], options: { name?: string | null;
  kept?: { entries?: readonly CcPresetEntry[]; unknownEntries?: CcPreset["unknownEntries"]; extra?: CcPreset["extra"] } } = {}): { preset: CcPreset; leftOut: number } {
  const index = indexOf(source);
  const values: CcPresetEntry[] = [];
  let leftOut = 0;
  const kept = new Map((options.kept?.entries ?? []).map(entry => [`${entry.part}/${entry.option}`, entry]));
  const last = new Map<string, CharacterChoice>();
  for (const choice of choices) last.set(`${choice.part}/${choice.option}`, choice);
  for (const choice of last.values()) {
    const option = index.option(choice.part, choice.option);
    const matched = option && !option.hidden && !followsLink(option) ? matchChoice(index, option, choice) : undefined;
    let entry: CcPresetEntry;
    if (option && matched) {
      const value: CcPresetValue = option.type === "appearance" ? { kind: "appearance", definition: matched.key, app: option.app?.hash ?? null }
        : option.type === "morph" ? { kind: "morph", morph: matched.key } : { kind: "switcher", choice: matched.key, activates: [...matched.activates] };
      const mod = matched.provenance.kind === "mod" ? matched.provenance : null;
      entry = { part: option.part, option: option.name, value, mod: mod?.mod ?? null, resource: mod?.resource ? depotHash(mod.resource) : null, extra: {} };
    } else {
      const from = kept.get(`${choice.part}/${choice.option}`);
      entry = from ?? { part: choice.part, option: choice.option, value: choice.activates?.length
        ? { kind: "switcher", choice: choice.choice, activates: [...choice.activates] } : { kind: "appearance", definition: choice.choice, app: null },
        mod: choice.mod ?? null, resource: null, extra: {} };
    }
    if (presetEntryWritable(entry)) values.push(entry); else leftOut++;
  }
  return { leftOut, preset: { schema: CC_PRESET_SCHEMA, bodyGender: source.catalogue.bodyGender, name: options.name ?? null, values,
    unknownEntries: options.kept?.unknownEntries ?? [], extra: options.kept?.extra ?? {} } };
}

// ---------------------------------------------------------------------------------------------------------------
// Validation of what crosses into the context (CORE-52): a save's descriptors are checked whole before anything changes.

const PART_SET = new Set<string>(CCO_PARTS);
const CHOICE_KEYS = new Set(["part", "option", "choice", "activates", "mod"]);
/** A save's names (a group, option, definition, region or target) follow the shared creator rule; empty is `None`. */
const savedName = (value: unknown): value is string => isCreatorName(value, true);
const fail = (message: string): never => { throw Error(`That isn't a save XF Studio can read: ${message}`); };

/** A decoded save's descriptors (every part), validated whole; throws a plain reason. */
export function savedDescriptorsOf(value: unknown): SavedDescriptors {
  const saved = value as { groups?: unknown };
  if (!saved || typeof saved !== "object" || !saved.groups || typeof saved.groups !== "object") fail("it has no appearance groups.");
  const appearances: SavedDescriptors["appearances"][number][] = [], morphs: SavedDescriptors["morphs"][number][] = [];
  for (const part of CCO_PARTS) {
    const groups = (saved.groups as Record<string, unknown>)[part] ?? [];
    if (!Array.isArray(groups)) fail(`its ${part} groups are invalid.`);
    for (const group of groups as unknown[]) {
      const g = group as { name?: unknown; appearances?: unknown; morphs?: unknown };
      if (!g || !savedName(g.name) || !Array.isArray(g.appearances) || !Array.isArray(g.morphs)) fail("a group is invalid.");
      for (const item of g.appearances as unknown[]) {
        const a = item as { name?: unknown; definition?: unknown; resourceHash?: unknown };
        if (!a || !savedName(a.name) || !savedName(a.definition) || typeof a.resourceHash !== "string" || !/^\d{1,20}$/.test(a.resourceHash))
          fail("an appearance is invalid.");
        appearances.push({ part, group: g.name as string, option: a.name as string, app: BigInt(a.resourceHash as string).toString(), definition: a.definition as string });
      }
      for (const item of g.morphs as unknown[]) {
        const m = item as { region?: unknown; target?: unknown };
        if (!m || !savedName(m.region) || !savedName(m.target)) fail("a morph is invalid.");
        morphs.push({ part, group: g.name as string, region: m.region as string, target: m.target as string });
      }
    }
  }
  if (appearances.length > CREATOR_LIMITS.appearances || morphs.length > CREATOR_LIMITS.morphs) fail("it holds more choices than a V has.");
  return { appearances, morphs };
}

/** A person's choice, validated by the shared rule (creator-names.ts; the preset, the workspace and the request all read choices with it). */
export function characterChoiceOf(value: unknown): CharacterChoice | null {
  const c = value as Record<string, unknown>;
  if (!c || typeof c !== "object" || Array.isArray(c) || !PART_SET.has(c.part as string) || !isCreatorName(c.option) || !isCreatorName(c.choice, true)) return null;
  if (Object.keys(c).some(key => !CHOICE_KEYS.has(key))) return null;
  if (c.activates !== undefined && (!Array.isArray(c.activates) || c.activates.length > CREATOR_LIMITS.activates ||
    !c.activates.every(name => isCreatorName(name)))) return null;
  if (c.mod !== undefined && c.mod !== null && !isModName(c.mod)) return null;
  return { part: c.part as CcoPart, option: c.option, choice: c.choice,
    ...(Array.isArray(c.activates) && c.activates.length ? { activates: [...c.activates as string[]] } : {}),
    ...(typeof c.mod === "string" ? { mod: c.mod } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------
// The family: its actions, descriptors and catalogue entry. Owned by the browser's `CharacterContextActions`.

/** One option set to a choice: the choice's key, and for a switcher choice the options it activates (its identity, CORE-70). */
export type CharacterChange = { part: CcoPart; option: string; choice: string; activates?: readonly string[] };
export type CharacterContextAction =
  /** Set one option to a choice (a key from the catalogue, with a switcher choice's activated options); its link family follows. */
  | ({ kind: "character.setOption" } & CharacterChange)
  /** Set several options in one step. */
  | { kind: "character.setOptions"; changes: CharacterChange[]; label?: string }
  /** Turn every makeup row of the shown V Off in one step (the host's projection marks the makeup section). */
  | { kind: "character.hideOwnMakeup" }
  /** One option (and its link family) back to the V's own. */
  | { kind: "character.reset"; part: CcoPart; option: string }
  /** Every change back to the V's own; the V stays. */
  | { kind: "character.resetAll" }
  /** Show the creator's default V (Undo shows the previous V again). */
  | { kind: "character.useDefault"; bodyGender: BodyGender }
  /** Show a decoded save's V; the choices made on the previous V are cleared (one step; `keepChanges` brings them back). */
  | { kind: "character.loadSave"; value: unknown }
  /** Show a decoded `xfs/cc-preset-1` preset's V. */
  | { kind: "character.loadPreset"; value: unknown }
  /** Put back the choices the last V change cleared, on the new V. */
  | { kind: "character.keepChanges" }
  /** Try again after the creator options or the shown V couldn't be prepared (never automatic; PIPE-78, PREV-86). */
  | { kind: "character.retry" }
  | { kind: "character.undo" }
  | { kind: "character.redo" };

const input = (type: ValueSchema["type"], extra: Partial<ValueSchema> = {}): ValueSchema => ({ type, required: true, from: "input", ...extra });
const optional = (type: ValueSchema["type"], extra: Partial<ValueSchema> = {}): ValueSchema => ({ type, required: false, from: "input", ...extra });
type Scope = "viewport" | "file";
/** Every creator change records a step in the character's own history, never in a look's (CORE-59): the look history policy is `none`. */
const desc = (scope: Scope, effect: ActionDescriptor["effect"], payload: ActionDescriptor["payload"]): ActionDescriptor<Scope> =>
  ({ scope: [scope], effect, undo: "none", payload });
const target = { part: input("enum", { values: CCO_PARTS }), option: input("string", { minLength: 1, maxLength: CREATOR_LIMITS.name }) };
export const CHARACTER_CONTEXT_DESCRIPTORS = {
  "character.setOption": desc("viewport", "workspace", { ...target, choice: input("string", { maxLength: CREATOR_LIMITS.name }), activates: optional("object") }),
  "character.setOptions": desc("viewport", "workspace", { changes: input("object"), label: optional("string", { maxLength: 80 }) }),
  "character.hideOwnMakeup": desc("viewport", "workspace", {}),
  "character.reset": desc("viewport", "workspace", target),
  "character.resetAll": desc("viewport", "workspace", {}),
  "character.useDefault": desc("viewport", "workspace", { bodyGender: input("enum", { values: ["female", "male"] }) }),
  "character.loadSave": desc("file", "workspace", { value: input("object") }),
  "character.loadPreset": desc("file", "workspace", { value: input("object") }),
  "character.keepChanges": desc("viewport", "workspace", {}),
  "character.retry": desc("viewport", "workspace", {}),
  "character.undo": desc("viewport", "workspace", {}),
  "character.redo": desc("viewport", "workspace", {}),
} satisfies Record<CharacterContextAction["kind"], ActionDescriptor<Scope>>;

const CHARACTER_ID = familyId("characterContext");
export const CHARACTER_CONTEXT_FAMILY: SystemFamily<CharacterContextAction, Scope, typeof CHARACTER_ID> = Object.freeze({
  owner: "system", id: CHARACTER_ID, label: "Character",
  actions: actionTable<CharacterContextAction, Scope>(CHARACTER_CONTEXT_DESCRIPTORS, {
    "character.setOption": true, "character.setOptions": true, "character.hideOwnMakeup": true, "character.reset": true, "character.resetAll": true,
    "character.useDefault": true, "character.loadSave": true, "character.loadPreset": true, "character.keepChanges": true, "character.retry": true,
    "character.undo": true, "character.redo": true }),
});

// Player settings that change what is offered or remembered (spec 14.2, `SettingsSet`; v4, V4-12, V4-16,
// V4-21, V4-34). A setting is a lens: changing one never changes an event, a pin or a record. The log is
// append-only; replays and the harness read the settings in force at each operation's time.

import type { GameTime, Id } from './types.ts';

export type Tempo = 'calm' | 'steady' | 'restless' | 'off';
export type NoticingMode = 'off' | 'acts' | 'full';
export type Ceiling = 0 | 1 | 2 | 3;
export type StoryExclusion = { kind: 'verb' | 'class' | 'tag' | 'npc'; value: string };

/** The typed, sensitive content settings (v4.4, V4-21): marked sensitive and dropped from exports by default. */
export interface ContentSettings {
  preset: string;
  /** Per class, 0 to 3. A class that is not listed has no player ceiling (3). 0 is a line. */
  ceiling: Record<string, Ceiling>;
  /** Classes the player asked to be warned about before a scene. */
  notice: Record<string, boolean>;
  /** Classes and levels the player skipped (S2 section 2.19); the sower reads them as a filter. */
  softExclusions: Array<{ class: string; level: 1 | 2 | 3 }>;
}

export interface SettingsEntry {
  /** S3's explicit verb/class/tag/NPC filters. Optional so pre-S3 settings replay unchanged. */
  storyExclusions?: StoryExclusion[];
  memoryScale: number;
  resetScale: number;
  noticing: NoticingMode;
  /** Compatibility view/wire field, derived from storyExclusions; never stored independently. */
  exclusions: Id[];
  /** "Start fresh" moves the floor: the model folds only events after it. */
  modelFloor: GameTime | null;
  cityScale: number;
  /** Content classes the player excluded outright (a line for the production gate, S0 9.2). */
  classExclusions: string[];
  content: ContentSettings;
  tempo: Tempo;
  /** In force from this game time. */
  at: GameTime;
}

export type SettingsPatch = Partial<Omit<SettingsEntry, 'at' | 'content'>> & { content?: Partial<ContentSettings> };

/** The initial settings: the lineage root records these (spec 14.2). The `as-the-game` preset is the default. */
export const DEFAULT_SETTINGS: Omit<SettingsEntry, 'at'> = {
  memoryScale: 1,
  resetScale: 1,
  noticing: 'acts',
  exclusions: [],
  modelFloor: null,
  cityScale: 1,
  classExclusions: [],
  content: { preset: 'as-the-game', ceiling: {}, notice: {}, softExclusions: [] },
  tempo: 'steady',
};

import type { Kernel } from './kernel.ts';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
type SettingsState = Omit<SettingsEntry, 'exclusions'>;

/** Old SettingsSet records encode NPCs in exclusions. Internally there is only the typed list. */
function fromWire(entry: SettingsEntry): SettingsState {
  const { exclusions, ...state } = clone(entry);
  const typed = state.storyExclusions ?? [];
  const npcs = new Set([...typed.filter((e) => e.kind === 'npc').map((e) => e.value), ...exclusions]);
  const list: StoryExclusion[] = [...typed.filter((e) => e.kind !== 'npc'), ...[...npcs].map((value) => ({ kind: 'npc' as const, value }))];
  if (list.length || state.storyExclusions) state.storyExclusions = list;
  return state;
}
function view(state: SettingsState): SettingsEntry {
  return { ...clone(state), exclusions: (state.storyExclusions ?? []).filter((e) => e.kind === 'npc').map((e) => e.value) };
}
function toWire(state: SettingsState): SettingsEntry {
  const entry = view(state);
  const other = entry.storyExclusions?.filter((e) => e.kind !== 'npc');
  if (other?.length) entry.storyExclusions = other;
  else delete entry.storyExclusions;
  return entry;
}

export class Settings {
  private entries: SettingsState[] = [];

  constructor(private readonly k: Kernel) {}

  /** The settings in force at game time `t`: the latest entry that began at or before `t`, else the initial ones. */
  at(t: GameTime): SettingsEntry {
    let best: SettingsState | undefined;
    for (const e of this.entries) if (e.at <= t) best = e;
    return best ? view(best) : clone({ ...DEFAULT_SETTINGS, at: Number.MIN_SAFE_INTEGER });
  }

  /** The settings in force now. */
  current(): SettingsEntry {
    return this.at(this.k.now);
  }

  /** Record a change, in force from `at` (default: now). Unmentioned settings keep the values in force. */
  set(patch: SettingsPatch, at: GameTime = this.k.now): SettingsEntry {
    this.k.assertWritable();
    this.k.persistence.recoverIfSaved(patch);
    const base = this.at(at);
    const { content, exclusions, ...rest } = clone(patch);
    const next = fromWire(base);
    Object.assign(next, rest, { at });
    if (exclusions !== undefined) {
      if (patch.storyExclusions !== undefined &&
        JSON.stringify([...new Set(exclusions)].sort()) !== JSON.stringify([...new Set(patch.storyExclusions.filter((e) => e.kind === 'npc').map((e) => e.value))].sort()))
        throw new Error('exclusions is a derived alias of storyExclusions; conflicting NPC lists');
      next.storyExclusions = [...(next.storyExclusions ?? []).filter((e) => e.kind !== 'npc'),
        ...[...new Set(exclusions)].map((value) => ({ kind: 'npc' as const, value }))];
    }
    if (content) next.content = { ...base.content, ...clone(content) };
    this.entries.push(next);
    this.k.bump();
    return view(next);
  }

  /** The number of entries in the log: it changes whenever a setting is set. */
  get length(): number {
    return this.entries.length;
  }

  all(): SettingsEntry[] {
    return this.entries.map(toWire);
  }

  restore(entries: SettingsEntry[]): void {
    this.entries = entries.map(fromWire);
  }

  /** A copy of the log, for a staged batch's discard (spec 14.2a). */
  capture(): unknown {
    return clone(this.entries);
  }

  restoreFrom(cap: unknown): void {
    this.entries = clone(cap as SettingsState[]);
  }

  clear(): void {
    this.entries = [];
  }
}

/** A player's ceiling for a content class at time `t`: 0 to 3; a class with none listed has no ceiling (3). */
export function ceilingOf(s: SettingsEntry, cls: string): Ceiling {
  if (s.classExclusions.includes(cls)) return 0;
  return s.content.ceiling[cls] ?? 3;
}

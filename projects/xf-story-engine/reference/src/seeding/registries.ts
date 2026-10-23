// The registries layer 2 reads (S4 owns their final contents): content classes, channels, and the registered
// predicate functions. The starter sets here are provisional, as S2 section 2.3 says of S4's vocabularies.

import type { ChannelId, ClassId, FactRead, Verdict } from './types.ts';

export interface ContentClassDef {
  id: ClassId;
  /** Source material for this class comes only from human-written packs (S2 section 2.19, D-23). */
  authoredSource?: boolean;
  /** A sexual class: its beats bind only adults and are reached only through an accepted action. */
  sexual?: boolean;
  /** An exploitation class: the minors floor applies (L-95). */
  exploit?: boolean;
  /** The player's ceiling when the settings say nothing (0 to 3). */
  default?: 0 | 1 | 2 | 3;
}

export interface ChannelDef {
  id: ChannelId;
  /** 0 ambient, 1 map pin or journal line, 2 message, 3 call, 4 approach (S2 section 8.1). */
  class: 0 | 1 | 2 | 3 | 4;
  /** A transient channel is decided within the item's own life; a persistent one waits for the player. */
  kind: 'transient' | 'persistent';
  /** Heard in passing rather than addressed to V (L-63). */
  overheard?: boolean;
}

export const STARTER_CLASSES: ContentClassDef[] = [
  { id: 'violence.gore' },
  { id: 'violence.torture' },
  { id: 'harm.bystander' },
  { id: 'harm.minor', default: 0 },
  { id: 'harm.asked' },
  { id: 'betray.inform' },
  { id: 'dread' },
  { id: 'drugs' },
  { id: 'sex.work', exploit: true },
  { id: 'sex.exploit', exploit: true },
  { id: 'exploit.body', exploit: true },
  { id: 'exploit.labour', exploit: true },
  { id: 'sex.explicit', authoredSource: true, sexual: true },
  { id: 'romance-intimate', authoredSource: true, sexual: true },
];

export const STARTER_CHANNELS: ChannelDef[] = [
  { id: 'trace', class: 0, kind: 'transient' },
  { id: 'bark', class: 0, kind: 'transient', overheard: true },
  { id: 'journal', class: 1, kind: 'persistent' },
  { id: 'pin', class: 1, kind: 'persistent' },
  { id: 'message', class: 2, kind: 'persistent' },
  { id: 'toast', class: 2, kind: 'transient' },
  { id: 'call', class: 3, kind: 'transient' },
  { id: 'approach', class: 4, kind: 'transient' },
];

/** A registered predicate (S2 section 2.6 `fn`): a pure read that declares what it reads. */
export interface PredFn {
  name: string;
  version: number;
  /** Its read-set as declared; a function that reads a `director -> v` belief is refused (L-57). */
  readsDirectorBeliefs?: boolean;
  /** Names a forbidden mechanic (guilt, streak, countdown): refused (L-22). */
  forbidden?: boolean;
  eval(args: unknown[], ctx: { now: number }): Verdict;
}

/**
 * What layer 2 asks of the simulation layer's registered reads (S2 2.16, 2.17, 4.1). Layer 2 holds none of that layer's code: the
 * simulation layer implements this and is attached to the registry. A read it does not build is refused at compile as not supported yet.
 */
export interface SimReadPort {
  /** Whether the simulation layer builds the read. */
  builds(read: string): boolean;
  /** The answer of a read at a time: one of the read's registered strings, or `maybe`. */
  eval(read: string, args: unknown[], t: number): string;
  /**
   * The value at `from` (an entry with `t = from`), then every change in `(from, to]` in time order, the changes at one time in the order they
   * were made (S1 9.1, S2-4). `eval` at a time gives only the last of the values a time passed through; a closing condition is evaluated at each.
   * `ord` places a change among the changes of other reads made at the same time: the lower was made first. A condition on several reads is
   * evaluated after each change in that order, with every read at the value it had then; a change with no `ord` is placed after those that have one.
   */
  transitions(read: string, args: unknown[], from: number, to: number): Array<{ t: number; value: string; ord?: number }>;
  /** The kernel values a read depends on, and whether it must be looked at again at every boundary (beliefs emit no Changes). */
  deps(read: string): { interests: Array<{ kind?: string; slot: string }>; boundary: boolean };
}

export class L2Registry {
  /** The simulation layer's reads, once it is attached (S1 9.1). Without it every `city` and `social` atom is a later capability. */
  sim?: SimReadPort;
  readonly classes = new Map<ClassId, ContentClassDef>();
  readonly channels = new Map<ChannelId, ChannelDef>();
  private fns = new Map<string, PredFn>();

  constructor() {
    for (const c of STARTER_CLASSES) this.classes.set(c.id, c);
    for (const c of STARTER_CHANNELS) this.channels.set(c.id, c);
  }

  registerPred(fn: PredFn): this {
    const k = `${fn.name}@${fn.version}`;
    if (this.fns.has(k)) throw new Error(`predicate already registered: ${k}`);
    this.fns.set(k, fn);
    return this;
  }

  pred(name: string, version: number): PredFn | undefined {
    return this.fns.get(`${name}@${version}`);
  }

  isSexual(cls: ClassId): boolean {
    const c = this.classes.get(cls);
    return !!c && (c.sexual === true || cls.startsWith('sex.'));
  }
  isExploit(cls: ClassId): boolean {
    const c = this.classes.get(cls);
    return !!c && (c.exploit === true || cls.startsWith('exploit.'));
  }
  isAuthoredSource(cls: ClassId): boolean {
    return this.classes.get(cls)?.authoredSource === true;
  }
}

/** What the game port reports as available (L-28). */
export interface PortReport {
  channels: ReadonlySet<ChannelId>;
  capabilities: ReadonlySet<string>;
}

export const readsOf = (reads: FactRead[]): string[] => reads.map((r) => r.fact ?? r.node ?? r.role ?? '');

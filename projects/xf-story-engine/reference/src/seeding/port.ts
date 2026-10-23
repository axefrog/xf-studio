// The game port layer 2 reads (S5 owns the real one): a play clock, attention aspects, vanilla UI states,
// channel availability, capability reads and write requests, and the load's class and age. `ScriptPort` is the
// stub the fixtures drive: its state is set by a script, and nothing in it reads a real game.

import type { AttentionAspect, ChannelId, ExposureGrade, Verdict } from './types.ts';

export type LoadClass = 'known' | 'behind' | 'foreign' | 'unkeyed' | 'damaged';

export interface LoadInfo {
  class: LoadClass;
  /** The wall-clock gap between the save's own timestamp and the load, read once from the save's metadata (S2 section 8.7). */
  ageSeconds: number;
}

/** What S5 reports for a released delivery (S2 section 8.5). Raw gaze, distance and dwell values never reach layer 2. */
export interface DisplayReport {
  delivery: string;
  channel: ChannelId;
  grade: ExposureGrade;
  atPlay: number;
  /** The delivery's life on a transient channel is over (a toast gone, a bark ended). */
  final?: boolean;
  /** The ids present when it was shown: the cue callbacks re-use (S2 section 8.5). */
  cue?: { place?: string; speaker?: string; object?: string };
}

export interface Layer2Port {
  channelAvailable(channel: ChannelId): boolean;
  /** Dialogue, scene, menu, photo mode, loading, a vanilla call or banner. */
  uiBusy(): boolean;
  aspects(): ReadonlySet<AttentionAspect>;
  /** The away overlay (S5's away marker). */
  away(): boolean;
  cap(ref: string): Verdict;
  /** The capabilities the port reports (L-28). */
  capabilities(): ReadonlySet<string>;
  writeGameFact(fact: string, request: { set?: number; add?: number }): void;
  reward(table: string, tier: string, route: number | undefined): void;
  loadInfo(): LoadInfo | undefined;
  /** The one input that retracts a push (S5): reported through `Layer2.respond`. */
  /** The game time of the lineage is the kernel's; the play clock is the port's. */
  playClock(): number;
}

/** A stub port driven by a script. Everything is a plain field a test sets. */
export class ScriptPort implements Layer2Port {
  channels = new Set<ChannelId>(['trace', 'bark', 'journal', 'pin', 'message', 'toast', 'call', 'approach']);
  busy = false;
  aspectSet = new Set<AttentionAspect>();
  awayFlag = false;
  caps = new Map<string, Verdict>();
  capabilitySet = new Set<string>(['story.write-vanilla']);
  load: LoadInfo | undefined;
  play = 0;
  readonly gameWrites: Array<{ fact: string; set?: number; add?: number }> = [];
  readonly rewards: Array<{ table: string; tier: string; route: number | undefined }> = [];

  channelAvailable(channel: ChannelId): boolean {
    return this.channels.has(channel);
  }
  uiBusy(): boolean {
    return this.busy;
  }
  aspects(): ReadonlySet<AttentionAspect> {
    return this.aspectSet;
  }
  away(): boolean {
    return this.awayFlag;
  }
  cap(ref: string): Verdict {
    return this.caps.get(ref) ?? 'maybe';
  }
  capabilities(): ReadonlySet<string> {
    return this.capabilitySet;
  }
  writeGameFact(fact: string, request: { set?: number; add?: number }): void {
    this.gameWrites.push({ fact, ...request });
  }
  reward(table: string, tier: string, route: number | undefined): void {
    this.rewards.push({ table, tier, route });
  }
  loadInfo(): LoadInfo | undefined {
    return this.load;
  }
  playClock(): number {
    return this.play;
  }
}

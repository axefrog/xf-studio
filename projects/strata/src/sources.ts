/**
 * Sources and sinks: the only way non-determinism enters a graph. Time, randomness, input, storage, files, jobs, the
 * network and other actors are source interfaces the composition binds to real adapters in an app and to simulated
 * ones in tests (`strata/testing`); nothing else changes between the two. The engine itself reads only these.
 */
import type { Entry, NodeType } from "./types";
import type { AbortSignalLike } from "./kernel/abort";

/** Wall time, monotonic time and timers. */
export interface Clock {
  /** Wall-clock time in milliseconds since the epoch. */
  now(): number;
  /** A monotonic time in milliseconds, for measuring durations. */
  monotonic(): number;
  /** Runs `run` after `ms` milliseconds, unless `signal` aborts first. */
  after(ms: number, run: () => void, signal?: AbortSignalLike): void;
  /** Runs `run` at the next animation frame, where the host has frames (otherwise soon), unless `signal` aborts first. */
  frame?(run: (time: number) => void, signal?: AbortSignalLike): void;
}

/** One named, seeded stream of randomness. */
export interface RandomStream {
  /** A uniform float in [0, 1). */
  next(): number;
  /** A uniform 32-bit unsigned integer. */
  uint32(): number;
  /** An RFC 4122 version 4 UUID. */
  uuid(): string;
}
/** Named random streams: `random.stream("ids")`, `random.stream("export-ids")`, one per purpose. */
export interface Random { stream(name: string): RandomStream }

/** Input events from people: pointer, keys, wheel, focus, file picks and drops, window and theme changes. */
export type InputEvent = { readonly kind: string; readonly [key: string]: unknown };
export interface InputSource { subscribe(listener: (event: InputEvent) => void, signal: AbortSignalLike): void }

/** Files through the host: listings and bytes. */
export interface FileSource {
  list(folder: string): Promise<readonly { readonly name: string; readonly size: number; readonly modified: number; readonly folder: boolean }[]>;
  read(path: string): Promise<Uint8Array>;
}

/** Background and requested work: raster workers, preparation, WolvenKit, bakes, Check and Build. */
export type JobPriority = "user" | "background";
export interface JobSource {
  run<T>(job: { readonly kind: string; readonly input: unknown; readonly priority: JobPriority }): Promise<T>;
}

/** Requests to the network or another process (the game bridge): answered, delayed, reordered or lost. */
export interface RequestSource<Q = unknown, A = unknown> { request(query: Q): Promise<A> }

/** Where committed entries go when another actor should see them (the game, another window). */
export interface Sink { accept(entries: readonly Entry[]): void }

/** The sources a graph needs; a project may bind more by name. */
export interface Sources {
  readonly clock: Clock;
  readonly random: Random;
  readonly [name: string]: unknown;
}

/** A declared source: its name, and whether its events are kept as a session stream (a bounded ring) for replay. */
export type SourceDef<T> = { readonly kind: "strata/source"; readonly name: string; readonly ring: number; readonly __type?: T };
/** Declares a source by name. `ring` is how many of its events the session keeps (0: none). */
export function defineSource<T>(name: string, options: { readonly ring?: number } = {}): SourceDef<T> {
  if (!/^[a-z][\w-]*$/i.test(name)) throw new Error(`Source name ${JSON.stringify(name)} is not a plain identifier.`);
  return Object.freeze({ kind: "strata/source" as const, name, ring: options.ring ?? 0 });
}

/** A declared sink: the node types whose committed entries it receives, after the store acknowledges them. */
export type SinkDef = { readonly kind: "strata/sink"; readonly name: string; readonly types: readonly NodeType[] | "*" };
export function defineSink(name: string, types: readonly NodeType[] | "*"): SinkDef {
  return Object.freeze({ kind: "strata/sink" as const, name, types });
}

/**
 * A priority job queue: the person's jobs start before background jobs queued earlier and not yet running. Pure: the
 * caller decides when a slot is free (`take`) and reports completion (`done`).
 */
export class JobQueue<J> {
  private queue: { job: J; priority: JobPriority; order: number }[] = [];
  private order = 0;
  running = 0;
  constructor(readonly slots = 1) {}
  push(job: J, priority: JobPriority): void { this.queue.push({ job, priority, order: this.order++ }); }
  /** The next job to start, or undefined when every slot is busy or nothing waits. */
  take(): J | undefined {
    if (this.running >= this.slots || !this.queue.length) return undefined;
    let best = 0;
    for (let i = 1; i < this.queue.length; i++) {
      const a = this.queue[i], b = this.queue[best];
      if (a.priority === "user" && b.priority !== "user" || a.priority === b.priority && a.order < b.order) best = i;
    }
    this.running++;
    return this.queue.splice(best, 1)[0].job;
  }
  done(): void { this.running = Math.max(0, this.running - 1); }
  get waiting(): readonly { readonly job: J; readonly priority: JobPriority }[] { return this.queue; }
}

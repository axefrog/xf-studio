// S2 2.24 / S3 2.2: pack data shared by seed compilation and the matcher.
import type { Id } from '../types.ts';
import type { Part } from './types.ts';

export type RoleKind = 'person' | 'group' | 'actor' | 'place' | 'item' | 'fact' | 'event';
export type LinkId = 'because' | 'motive' | 'enables' | 'but' | 'reveals' | 'answers' | 'forecloses';
export interface Vocabulary {
  functions: Record<string, { form: 'event' | 'state'; args: Record<string, RoleKind | RoleKind[] | 'any' | 'pattern id' | 'outcome name'>; searchFrom?: string[] }>;
  relations: Record<string, { args: string[]; searchFrom?: string[] }>;
  tokenPrecedence: string[];
}
export type RelReq = { rel: string; args: string[] } | { not: RelReq };
export interface PatternRole {
  kind: RoleKind | RoleKind[];
  identity?: Part<Id | 'v' | string>;
  must?: RelReq[];
  prefer?: Array<{ r: RelReq; strength: 1 | 2 | 3 }>;
  v?: 'never' | 'may';
}
export type PatternChange = (
  | { begins: string; args: Record<string, string> } | { ends: string; args: Record<string, string> }
  | { frame: { of: string; toward: string; status: 'opens' | 'blocked' | 'satisfied' | 'abandoned' } }
  | { tie: { a: string; b: string }; move: 'up' | 'down' | 'ends' }
  | { standing: { audience: string; of: string }; move: 'up' | 'down' }
  | { member: { who: string; of: string }; move: 'joins' | 'strained' | 'exits' }
  | { belief: { who: string; about: string }; move: 'forms' | 'revised' }
  | { exposure: { to: string; of: string } }
) & { when?: { npc: string } | { protagonist: string } };
export type Filler = { kinds: string[] } | { tags: string[] } | { seed: string; by: string } | { pattern: string; outcome?: string };
export type Realisation = { wait: true } | { offer: { kit?: string } } | { nudge: { kit?: string } }
  | { construct: true } | { refine: { pattern: string; outcome: string; binds: Record<string, string> } };
export interface Juncture {
  fn: string;
  args: Record<string, string>;
  form?: 'event' | 'state';
  requires?: RelReq[];
  changes?: PatternChange[];
  fill?: Part<Filler[]>;
  realise?: Realisation[];
  v?: 'never' | 'offer';
  optional?: boolean;
  park?: boolean;
  join?: 'all' | 'any' | { all: string[]; any: string[] };
  binds?: Record<string, string>;
}
export interface CausalEdge { from: string; to: string; link: LinkId; shown?: 'must' | 'should' }
export interface Outcome {
  reached: string[];
  foreclosed?: string[];
  after?: { clock: 'game'; days: number };
  produces?: Array<{ fn: string; args: Record<string, string> }>;
  aftermath?: { junctures: string[]; days?: number };
  kind: 'resolved' | 'failed' | 'parked';
  next?: string[];
}
export interface Pattern {
  id: string; version: number;
  family: 'tension' | 'turn' | 'closure' | 'shape';
  use?: 'library' | 'authored';
  scale: 'situation' | 'step' | 'goal' | 'concern' | 'drive' | 'standing';
  roles: Record<string, PatternRole>;
  junctures: Record<string, Juncture>;
  edges: CausalEdge[];
  entry: string[];
  outcomes: Record<string, Outcome>;
  unless?: Array<{ between: [string, string]; juncture: Juncture }>;
  within?: { clock: 'game'; days: number };
  once?: string[];
  show: { junctures: string[]; edges: number };
  escalation?: string[];
  latitude?: { nudge: boolean; construct: boolean };
  tell?: { form: 'rumour' | 'recap' | 'sighting' | 'foreshadow' | 'offer' | 'aftermath'; kit?: string; binds: Record<string, string> };
  summary?: string; links?: unknown; traces?: string[]; risks?: unknown;
}
export interface Realises { pattern: string; juncture: string; by: string; binds: Record<string, string> }

/** A read-only adapter binds S1's rule context before handing it to S3. */
export interface PatternWorldPort {
  stateRules(fn: string): Array<{
    fn: string; id: string; durable: true; changes: import('../types.ts').Selector[];
    fromChange(c: import('../types.ts').Change): import('../sim/fillers.ts').StateFill[];
    endsBy(c: import('../types.ts').Change, filler: import('../sim/fillers.ts').FillerRef): boolean;
    search(arg: string, node: Id, at: number, limit: number): { fills: import('../sim/fillers.ts').StateFill[]; truncated: boolean };
    holdsAt(filler: import('../sim/fillers.ts').FillerRef, at: number): 'yes' | 'no' | 'maybe';
  }>;
  relation?(name: string, args: string[], at: number): 'yes' | 'no' | 'maybe';
  relationSearch?(name: string, bound: Record<string, string>, at: number, limit: number): { tuples: Array<{ id: Id; args: Record<string, string> }>; truncated: boolean };
}

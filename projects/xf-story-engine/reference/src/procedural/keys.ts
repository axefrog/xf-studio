import { H, type HArg, id, i, rand, rootId, s } from '../id.ts';
import { ln } from '../fdlibm-log.ts';
import type { Id } from '../types.ts';

export const cmp = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
export class Keys {
  readonly director: Id;
  readonly record: Id;
  constructor(
    readonly worldSeed: Id,
    readonly salt = '',
  ) {
    this.director = rootId(worldSeed, 'director');
    this.record = rootId(worldSeed, 'layer3');
  }
  bindings(tag: 'bind' | 'tomb', pattern: string, bindings: Record<string, Id>, vars = Object.keys(bindings)): Id {
    return H(
      s(tag),
      id(this.worldSeed),
      s(pattern),
      ...vars
        .slice()
        .sort(cmp)
        .flatMap((v) => [s(v), id(bindings[v])]),
    );
  }
  match(pattern: string, binding: Id, occurrence: Id): Id {
    return H(s('match'), id(this.worldSeed), s(pattern), id(binding), id(occurrence));
  }
  candidate(match: Id, stage: number): Id {
    return H(s('cand'), id(this.worldSeed), s('match'), id(match), i(stage));
  }
  decision(candidate: Id): Id {
    return H(s('sow3'), id(this.worldSeed), id(candidate));
  }
  withdraw(seed: Id): Id {
    return H(s('wdraw3'), id(this.worldSeed), id(seed));
  }
  frame(pattern: string): Id {
    return H(s('mint'), id(this.director), id(this.director), s('frame:' + pattern));
  }
  slot(k: number, gap: number): { time: number; u: number } {
    return {
      time: k * gap + Math.floor(this.random('s3-slot', s('open'), i(k)) * gap),
      u: this.random('s3-live', s('open'), i(k)),
    };
  }
  random(name: string, ...args: HArg[]): number {
    return rand(s(name), id(this.worldSeed), s(this.salt), ...args);
  }
  ranked<T extends { key: string; score: number }>(
    name: 's3-pick' | 's3-kit',
    args: HArg[],
    options: T[],
  ): Array<T & { noise: number; total: number; tie: Id }> {
    return options
      .map((o) => {
        const key = name === 's3-pick' ? id(o.key) : s(o.key);
        const noise = -ln(-ln(this.random(name, ...args, key)));
        return {
          ...o,
          noise,
          total: o.score + noise,
          tie: H(s('tie'), id(this.worldSeed), s(this.salt), s(name), ...args, key),
        };
      })
      .sort((a, b) => b.total - a.total || cmp(a.tie, b.tie));
  }
}

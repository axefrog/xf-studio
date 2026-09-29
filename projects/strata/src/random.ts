/**
 * Named, seeded randomness (SPEC §20.2): one stream per purpose, so a run with a seed is exactly repeatable and adding
 * a use of one stream never shifts another. In an app the seed comes from the host's cryptographic source (an adapter);
 * in a simulation, from the run's seed.
 */
import { hash } from "./json";
import type { Random, RandomStream } from "./sources";

/** A small, fast, seedable PRNG (sfc32). */
export function prng(seed: string | number): () => number {
  const h = hash(String(seed));
  let a = parseInt(h.slice(0, 7), 16) | 0, b = parseInt(h.slice(7, 14), 16) | 0, c = parseInt(hash(String(seed), 1).slice(0, 8), 16) | 0, d = 1;
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return next;
}

/** Named, seeded random streams: each name has its own sequence, so adding a use of one stream never shifts another. */
export function seededRandom(seed: string | number): Random {
  const streams = new Map<string, RandomStream>();
  return {
    stream(name) {
      let stream = streams.get(name);
      if (stream) return stream;
      const next = prng(`${seed}\u0000${name}`);
      const uint32 = () => Math.floor(next() * 4294967296) >>> 0;
      const hex = (n: number, width: number) => n.toString(16).padStart(width, "0");
      stream = {
        next, uint32,
        uuid() {
          const a = uint32(), b = uint32(), c = uint32(), d = uint32();
          return `${hex(a, 8)}-${hex(b >>> 16, 4)}-4${hex(b & 0xfff, 3)}-${hex(0x8000 | (c >>> 18 & 0x3fff), 4)}-${hex(c & 0xffff, 4)}${hex(d, 8)}`;
        },
      };
      streams.set(name, stream);
      return stream;
    },
  };
}


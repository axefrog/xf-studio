/**
 * The Studio's randomness: one small interface, so code that makes IDs or random choices takes a source as a parameter.
 * The host source draws from the platform's cryptographic generator; a seeded source repeats the same sequence for the
 * same seed, so tests (and anything that must be reproducible) get the same IDs every run.
 */

export interface Random {
  /** A number in [0, 1). */
  next(): number;
  /** A version-4 UUID (lowercase, hyphenated). */
  uuid(): string;
}

const HEX = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, "0"));

/** Formats 16 bytes as a version-4 UUID (the version and variant bits are set here). */
function uuidOf(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, byte => HEX[byte]);
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
}

/** The platform's cryptographic source. */
export function hostRandom(): Random {
  return {
    next: () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32,
    uuid: () => uuidOf(crypto.getRandomValues(new Uint8Array(16))),
  };
}

/** A 128-bit state from the seed's text (cyrb128), so nearby seeds give unrelated sequences. */
function seedState(seed: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067); h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213); h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067); h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213); h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** A deterministic source: the same seed always gives the same numbers and UUIDs (sfc32). Not for secrets. */
export function seededRandom(seed: string | number): Random {
  let [a, b, c, d] = seedState(String(seed));
  const word = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); c = (c + t) | 0;
    return t >>> 0;
  };
  return {
    next: () => word() / 2 ** 32,
    uuid() {
      const bytes = new Uint8Array(16);
      for (let i = 0; i < 16; i += 4) { const w = word(); bytes[i] = w & 255; bytes[i + 1] = (w >>> 8) & 255; bytes[i + 2] = (w >>> 16) & 255; bytes[i + 3] = w >>> 24; }
      return uuidOf(bytes);
    },
  };
}

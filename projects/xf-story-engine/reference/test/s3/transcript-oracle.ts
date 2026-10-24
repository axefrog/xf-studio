// Independent, deliberately unoptimised encoding of S0 §1 and S3 §3.2. No production
// id/keys/canonicalisation helpers: only the standard BLAKE3 primitive is shared.
import { blake3 } from '@noble/hashes/blake3.js';
type Arg = ['s' | 'id', string] | ['i', number];
export const S = (value: string): Arg => ['s', value];
export const I = (value: string): Arg => ['id', value];
export const N = (value: number): Arg => ['i', value];
export function hash(...args: Arg[]): string {
  const chunks = args.map(([type, value]) => {
    if (type === 'id') return Buffer.concat([Buffer.from([3]), Buffer.from(value as string, 'hex')]);
    if (type === 'i') { const bytes = Buffer.alloc(9); bytes[0] = 2; bytes.writeBigInt64LE(BigInt(value), 1); return bytes; }
    const text = Buffer.from(value as string, 'utf8'), head = Buffer.alloc(5);
    head[0] = 1; head.writeUInt32LE(text.length, 1);
    return Buffer.concat([head, text]);
  });
  return Buffer.from(blake3(Buffer.concat(chunks), { dkLen: 16 })).toString('hex');
}
export function random(...args: Arg[]): number {
  return (parseInt(hash(S('rng'), ...args).slice(0, 13), 16) + 0.5) / 2 ** 52;
}
export function oracle() {
  const world = hash(S('fixture'), S('S3-TRANSCRIPT')),
    root = (name: string) => hash(S('root'), I(world), S(name)),
    director = root('director'), a = root('mara'), b = root('dex'),
    event = (name: string) => hash(S('mint'), I(root('port')), I(hash(S('incident'), S(name))), S(name)),
    first = event('insult100'), last = event('assault100'), pattern = 'xf.fixture:grudge', kit = 'xf.fixture:rumour-kit',
    binding = hash(S('bind'), I(world), S(pattern), S('?a'), I(a), S('?b'), I(b)),
    match = hash(S('match'), I(world), S(pattern), I(binding), I(first)),
    candidate = hash(S('cand'), I(world), S('match'), I(match), N(1)),
    decision = hash(S('sow3'), I(world), I(candidate)),
    story = hash(S('mint'), I(director), I(match), S('meta:story')),
    instance = hash(S('mint'), I(director), I(decision), S(`seed:${kit}:${candidate.slice(0, 16)}`)),
    draw = (name: string, ...args: Arg[]) => random(S(name), I(world), S(''), ...args),
    slot = { time: 4500 + Math.floor(draw('s3-slot', S('open'), N(1)) * 4500), u: draw('s3-live', S('open'), N(1)) },
    pick = draw('s3-pick', S('open'), N(1), I(candidate)), kitDraw = draw('s3-kit', I(candidate), S(kit));
  return { world, director, a, b, first, last, binding, match, candidate, decision, story, instance,
    record: root('layer3'), tombstone: hash(S('tomb'), I(world), S(pattern), S('?a'), I(a), S('?b'), I(b)),
    slot, pick, kitDraw };
}

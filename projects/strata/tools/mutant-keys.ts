/**
 * Keys for the mutation tool's cache and its list of equivalent mutants (test tooling only). A mutant's identity is
 * its file, function, kind of change, the code changed and its replacement, and which occurrence of that change in
 * the function it is; its key adds a hash of the function's text, so a rewritten function's mutants are new ones. A
 * cache entry records the test set it was run against (`testSetHash`); an entry for another test set counts as not
 * yet run. An equivalent entry carries the function hash it was judged against, and reads as stale once it changes.
 */
export type Status = "killed" | "survived" | "timeout";
/**
 * A cached mutant: what the suite alone made of it (`suite`) and what the suite and the external vectors made of it
 * (`full`), each when known, against the test set `tests`.
 */
export type CacheEntry = { readonly suite?: Status; readonly full?: Status; readonly tests: string };
export type Keyed = { readonly fn: string; readonly fnHash: string; readonly operator: string; readonly original: string; readonly replacement: string };

const HASH_FIELD = /^(.*)\|fn:([0-9a-f]+)$/;

/** Each mutant's key (`file|fn|operator|original|replacement|occurrence|fn:<hash>`), in order. */
export function mutantKeys(file: string, list: readonly Keyed[]): string[] {
  const seen = new Map<string, number>();
  return list.map(mutant => {
    const identity = `${file}|${mutant.fn}|${mutant.operator}|${mutant.original}|${mutant.replacement}`;
    const occurrence = seen.get(identity) ?? 0;
    seen.set(identity, occurrence + 1);
    return `${identity}|${occurrence}|fn:${mutant.fnHash}`;
  });
}

/** A key without its function hash, and the hash (undefined for a key without one). */
export function splitKey(key: string): { readonly base: string; readonly fnHash?: string } {
  const match = HASH_FIELD.exec(key);
  return match ? { base: match[1], fnHash: match[2] } : { base: key };
}

/** The test set a run uses: its suite files and the number of simulation seeds (external vectors are recorded apart). */
export function testSetHash(tests: readonly string[], seeds: string | undefined): string {
  return Bun.hash(JSON.stringify([[...tests].sort(), seeds ?? ""])).toString(16);
}

/**
 * A cached mutant's status for this test set, with the external vectors (`full`) or without; undefined when it hasn't
 * been run that way against it. A mutant the suite kills is killed with the vectors too.
 */
export function cachedStatus(entry: CacheEntry | undefined, tests: string, full: boolean): Status | undefined {
  if (!entry || entry.tests !== tests) return undefined;
  if (!full) return entry.suite;
  return entry.suite && entry.suite !== "survived" ? entry.suite : entry.full;
}

/** The equivalent mutants listed in Markdown: a list item holding a key in double backticks, its reason on the indented lines after it. */
export function readEquivalents(text: string): Map<string, { readonly fnHash?: string; readonly reason: string }> {
  const out = new Map<string, { fnHash?: string; reason: string }>();
  let key: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const item = /^- ``(.+)``\s*$/.exec(line);
    // Keys are written from the repository root; the tool's own keys start at the engine's folder.
    if (item) { const { base, fnHash } = splitKey(item[1].replace(/^projects\/strata\//, "")); key = base; out.set(key, { fnHash, reason: "" }); continue; }
    if (key && /^\s+\S/.test(line)) out.get(key)!.reason = `${out.get(key)!.reason} ${line.trim()}`.trim();
    else if (!/^\s*$/.test(line)) key = undefined;
  }
  return out;
}

/** Whether a mutant is listed as equivalent: yes, no, or listed against an older version of its function (stale). */
export function equivalence(equivalents: ReadonlyMap<string, { readonly fnHash?: string }>, key: string): "equivalent" | "stale" | undefined {
  const { base, fnHash } = splitKey(key);
  const entry = equivalents.get(base);
  if (!entry) return undefined;
  return entry.fnHash === fnHash ? "equivalent" : "stale";
}

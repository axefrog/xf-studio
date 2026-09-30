/**
 * The mutation tool's keys (deep review 8, STRATA-18): a rewritten function's mutants get new keys, a cache entry for
 * another test set counts as not yet run, and an equivalent entry judged against an older function reads as stale.
 */
import { expect, test } from "bun:test";
import { cachedStatus, equivalence, mutantKeys, readEquivalents, splitKey, testSetHash } from "../tools/mutant-keys";

const mutant = (fn: string, fnHash: string, original = "a < b") => ({ fn, fnHash, operator: "< → <=", original, replacement: "<=" });

test("a key names the file, function, change and occurrence, then the function's hash", () => {
  const keys = mutantKeys("src/x.ts", [mutant("f", "a1"), mutant("f", "a1"), mutant("g", "b2"), mutant("f", "a1", "c < d")]);
  expect(keys).toEqual([
    "src/x.ts|f|< → <=|a < b|<=|0|fn:a1",
    "src/x.ts|f|< → <=|a < b|<=|1|fn:a1",
    "src/x.ts|g|< → <=|a < b|<=|0|fn:b2",
    "src/x.ts|f|< → <=|c < d|<=|0|fn:a1",
  ]);
  // The same change in a rewritten function is a new mutant.
  expect(mutantKeys("src/x.ts", [mutant("f", "ff")])[0]).not.toBe(keys[0]);
  expect(splitKey(keys[1])).toEqual({ base: "src/x.ts|f|< → <=|a < b|<=|1", fnHash: "a1" });
  // Code can hold "|fn:" itself: only the last field is the hash.
  expect(splitKey("src/x.ts|f|statement removed|a|fn:x;|;|0|fn:0f")).toEqual({ base: "src/x.ts|f|statement removed|a|fn:x;|;|0", fnHash: "0f" });
  expect(splitKey("src/x.ts|f|op|a|b|0")).toEqual({ base: "src/x.ts|f|op|a|b|0" });
});

test("a cached result counts only for the test set it was run against; the vectors count only in the full score", () => {
  const tests = testSetHash(["tests/b.test.ts", "tests/a.test.ts"], "20");
  expect(testSetHash(["tests/a.test.ts", "tests/b.test.ts"], "20")).toBe(tests);
  expect(testSetHash(["tests/a.test.ts"], "20")).not.toBe(tests);
  expect(testSetHash(["tests/a.test.ts", "tests/b.test.ts"], undefined)).not.toBe(tests);
  expect(cachedStatus(undefined, tests, true)).toBeUndefined();
  expect(cachedStatus({ suite: "killed", tests: "other" }, tests, true)).toBeUndefined();
  expect(cachedStatus({ suite: "killed", tests }, tests, true)).toBe("killed");
  expect(cachedStatus({ suite: "timeout", tests }, tests, false)).toBe("timeout");
  expect(cachedStatus({ suite: "survived", tests }, tests, false)).toBe("survived");
  expect(cachedStatus({ suite: "survived", tests }, tests, true)).toBeUndefined();
  expect(cachedStatus({ suite: "survived", full: "killed", tests }, tests, true)).toBe("killed");
  expect(cachedStatus({ suite: "survived", full: "killed", tests }, tests, false)).toBe("survived");
  // Known only with the vectors (a result kept from before the two were told apart): the suite alone is still to run.
  expect(cachedStatus({ full: "killed", tests }, tests, true)).toBe("killed");
  expect(cachedStatus({ full: "killed", tests }, tests, false)).toBeUndefined();
});

test("an equivalent entry matches its mutant while the function is unchanged, and reads as stale once it changes", () => {
  const text = [
    "# Equivalent mutants", "",
    "## src/x.ts", "",
    "- ``projects/strata/src/x.ts|f|< → <=|a < b|<=|0|fn:a1``",
    "  First line of the reason,", "  and its second.",
    "- ``projects/strata/src/x.ts|g|< → <=|a < b|<=|0``",
    "  Written before keys carried hashes.",
    "Not part of any reason.",
  ].join("\n");
  const equivalents = readEquivalents(text);
  expect([...equivalents]).toEqual([
    ["src/x.ts|f|< → <=|a < b|<=|0", { fnHash: "a1", reason: "First line of the reason, and its second." }],
    ["src/x.ts|g|< → <=|a < b|<=|0", { fnHash: undefined, reason: "Written before keys carried hashes." }],
  ]);
  expect(equivalence(equivalents, "src/x.ts|f|< → <=|a < b|<=|0|fn:a1")).toBe("equivalent");
  expect(equivalence(equivalents, "src/x.ts|f|< → <=|a < b|<=|0|fn:b7")).toBe("stale");
  expect(equivalence(equivalents, "src/x.ts|g|< → <=|a < b|<=|0|fn:a1")).toBe("stale");
  expect(equivalence(equivalents, "src/x.ts|f|< → <=|a < b|<=|1|fn:a1")).toBeUndefined();
});

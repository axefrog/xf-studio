// NATIVE-11: the game's Oodle library is loaded only when its bytes are on the known list or carry a valid CD PROJEKT S.A.
// Authenticode signature, and the file is held against changes from the check until it is loaded. The Windows-only checks use a
// junk file and a system binary; the real library is checked opt-in (XFS_RESOLVER_GAME_ROOT).
import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { authenticodeSignature, GAME_OODLE_LIBRARY, holdFile, isPublisherSignature, KNOWN_OODLE_SHA256, loadGameOodle, OodleUnavailableError, subjectField } from "../src/native/oodle";
import { oracleTest } from "./optional-oracles";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const windows = process.platform === "win32" && process.arch === "x64";
const onWindows = windows ? test : test.skip;
const CDPR = "CN=CD PROJEKT S.A., O=CD PROJEKT S.A., L=Warszawa, S=mazowieckie, C=PL, SERIALNUMBER=0000006865, OID.2.5.4.15=Private Organization";

test("the signer check needs a valid signature by CD PROJEKT S.A. on exactly the bytes checked", () => {
  expect(subjectField(CDPR, "CN")).toBe("CD PROJEKT S.A.");
  expect(subjectField(`CN="Example, Inc.", O=Example`, "CN")).toBe("Example, Inc.");
  const sha = "ab".repeat(32);
  expect(isPublisherSignature({ status: "Valid", subject: CDPR, sha256: sha.toUpperCase() }, sha)).toBe(true);
  expect(isPublisherSignature({ status: "HashMismatch", subject: CDPR, sha256: sha }, sha)).toBe(false);
  expect(isPublisherSignature({ status: "Valid", subject: CDPR, sha256: "cd".repeat(32) }, sha)).toBe(false);
  expect(isPublisherSignature({ status: "Valid", subject: "CN=Microsoft Windows, O=Microsoft Corporation", sha256: sha }, sha)).toBe(false);
  expect(isPublisherSignature({ status: "Valid", subject: "CN=CD PROJEKT S.A., O=Someone Else", sha256: sha }, sha)).toBe(false);
});

function fakeGame(bytes: Uint8Array): { root: string; dll: string } {
  const root = mkdtempSync(join(tmpdir(), "xfs-oodle-")); roots.push(root);
  const folder = join(root, ...GAME_OODLE_LIBRARY.slice(0, -1));
  mkdirSync(folder, { recursive: true });
  const dll = join(folder, GAME_OODLE_LIBRARY.at(-1)!);
  writeFileSync(dll, bytes);
  return { root, dll };
}

onWindows("an unsigned library is refused before it is loaded, and a verifier sees the hash of the bytes it judged", () => {
  const junk = new TextEncoder().encode("MZ not really a library");
  const { root } = fakeGame(junk);
  expect(() => loadGameOodle(root)).toThrow(`not signed by CD PROJEKT S.A.`);
  let seen = "";
  expect(() => loadGameOodle(root, { verify: (_, sha256) => { seen = sha256; return { refused: "no" }; } })).toThrow(OodleUnavailableError);
  expect(seen).toBe(createHash("sha256").update(junk).digest("hex"));
  // Accepted but not a library: the load itself fails, still as an OodleUnavailableError.
  expect(() => loadGameOodle(root, { verify: () => ({ trustedBy: "test" }) })).toThrow("could not be loaded");
}, 60_000);

onWindows("a system binary signed by someone else is not the game's publisher", () => {
  const notepad = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "notepad.exe");
  const verdict = authenticodeSignature(notepad);
  expect(verdict.status).toBe("Valid");
  expect(verdict.sha256.toLowerCase()).toBe(createHash("sha256").update(readFileSync(notepad)).digest("hex"));
  expect(isPublisherSignature(verdict, verdict.sha256)).toBe(false);
}, 60_000);

onWindows("while held for checking, the library cannot be renamed, replaced or deleted", () => {
  const { dll } = fakeGame(new Uint8Array([1, 2, 3]));
  const release = holdFile(import.meta.require("bun:ffi"), dll);
  try {
    expect(readFileSync(dll)).toEqual(Buffer.from([1, 2, 3]));
    expect(() => renameSync(dll, `${dll}.moved`)).toThrow();
    expect(() => writeFileSync(dll, new Uint8Array([9]))).toThrow();
    expect(() => unlinkSync(dll)).toThrow();
  } finally { release(); }
  renameSync(dll, `${dll}.moved`);
  expect(existsSync(`${dll}.moved`)).toBe(true);
});

const game = process.env.XFS_RESOLVER_GAME_ROOT ? resolve(process.env.XFS_RESOLVER_GAME_ROOT) : "";
const hasGame = windows && !!game && existsSync(join(game, ...GAME_OODLE_LIBRARY));
oracleTest(hasGame, "the Oodle signer check on the real library needs XFS_RESOLVER_GAME_ROOT (read-only).")("the installed game's library is trusted by hash, and its signature says CD PROJEKT S.A.", () => {
  const oodle = loadGameOodle(game);
  try {
    // A game patch that ships a new library is trusted through its signature until its hash is added to the list.
    expect(oodle.trustedBy).toBe(Object.hasOwn(KNOWN_OODLE_SHA256, oodle.sha256) ? "known-hash" : "authenticode");
    expect(isPublisherSignature(authenticodeSignature(oodle.path), oodle.sha256)).toBe(true);
    expect(oodle.identity).toBe(`oodle:${oodle.sha256.slice(0, 16)}`);
  } finally { oodle.close(); }
}, 60_000);

/**
 * The history service's parity gate: every Undo history behaves as it did before the service (2e0708a6). The golden
 * `tests/golden/history-parity.json` was captured by `tests/fixtures/capture-history-golden.ts` from that code through the
 * observer in `tests/fixtures/history-parity.ts`: a scripted look session (gestures, form and feature controls, look
 * transactions, jumps, the limit; CORE-42), Redo validity (CORE-46), the View and lighting history (coalescing until a release,
 * CORE-95; structure steps and the clear an unrecorded one makes, CORE-94), the document-history API and global Undo/Redo
 * routed to an experiment's document, and a restored workspace's look history stored again byte for byte.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { documentSession, lookSession, persistenceSession, redoValiditySession, routedSession, viewSession } from "./fixtures/history-parity";
import { canonical } from "./fixtures/workspace-observable";

const golden = JSON.parse(readFileSync(new URL("./golden/history-parity.json", import.meta.url), "utf8"));
const plain = (value: unknown) => JSON.parse(canonical(value));

test("the look's history matches the code before the history service (CORE-42)", () => { expect(plain(lookSession())).toEqual(golden.look); });
test("Redo validity matches (CORE-46)", () => { expect(plain(redoValiditySession())).toEqual(golden.redoValidity); });
test("the View and lighting history matches (CORE-94, CORE-95)", () => { expect(plain(viewSession())).toEqual(golden.view); });
test("the document-history API matches", () => { expect(plain(documentSession())).toEqual(golden.documents); });
test("global Undo and Redo reach an experiment's document as before", () => { expect(plain(routedSession())).toEqual(golden.routed); });
test("a restored workspace's look history round-trips byte for byte, and a save stores exactly what it did", () => {
  const now = persistenceSession();
  expect(now.every(item => item.first.roundTrips && item.undone.back)).toBe(true);
  expect(plain(now)).toEqual(golden.persistence);
});

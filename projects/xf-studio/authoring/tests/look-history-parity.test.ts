/**
 * Migration step 4 parity gate (feature-module platform §3, §8): Undo, Redo and History behave exactly
 * as before the look history. `tests/golden/look-history-parity.json` was captured from the code before
 * the change (0885ba6) by `tests/fixtures/capture-look-history-golden.ts`: every look's history of each
 * workspace-1 fixture walked with Undo, Redo and jumps; the standard stored form (byte for byte) and
 * what it restores; and a scripted session of edits, form-control and gesture transactions (committed,
 * cancelled and empty), Undo, Redo, jumps, preset switches across an add and a remove, and a reload.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { observeHistories, observeStored, session } from "./fixtures/look-history-parity";
import { digest, restore } from "./fixtures/workspace-observable";
import { damagedWorkspaceV1, largeWorkspaceV1, looseWorkspaceV1, smallWorkspaceV1, withPreferences } from "./fixtures/workspace-v1-fixtures";
import { encodeWorkspaceAt } from "../src/workspace-budget";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";

const golden = JSON.parse(readFileSync(new URL("./golden/look-history-parity.json", import.meta.url), "utf8"));
const fixtures = { small: smallWorkspaceV1, loose: looseWorkspaceV1, large: largeWorkspaceV1, damaged: damagedWorkspaceV1,
  preferences: () => withPreferences(smallWorkspaceV1()) };

for (const [name, fixture] of Object.entries(fixtures)) test(`${name}: histories, stored form and a session match the code before the look history`, () => {
  const loaded = restore(fixture());
  expect(loaded.writable).toBe(true);
  const stored = encodeWorkspaceAt(loaded.state, 0, STUDIO_DOCUMENTS).encoded;
  expect({ histories: digest(observeHistories(restore(fixture()).state)), stored: observeStored(loaded.state),
    session: digest(session(fixture())), sessionFromStored: digest(session(JSON.parse(stored))) }).toEqual(golden[name]);
}, 60_000);

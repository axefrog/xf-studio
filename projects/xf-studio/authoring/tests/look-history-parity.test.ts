/**
 * Migration step 4 parity gate (feature-module platform §3, §8): Undo, Redo and History retain parity,
 * except the intentional restoration of selections changed by an edit. The original session hashes
 * remain under `selectionBaseline`: the injected legacy policy must reproduce them, and a decoded
 * comparison (including the reload's hashed walks) permits only active/selected differences before
 * checking the new session hashes. Content, labels, capabilities, results and stored bytes still match.
 * `tests/golden/look-history-parity.json` was captured from the code before
 * the change (0885ba6) by `tests/fixtures/capture-look-history-golden.ts`: every look's history of each
 * workspace-1 fixture walked with Undo, Redo and jumps; the standard stored form (byte for byte) and
 * what it restores; and a scripted session of edits, form-control and gesture transactions (committed,
 * cancelled and empty), Undo, Redo, jumps, preset switches across an add and a remove, and a reload.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { observeHistories, observeStored, session, type WalkObservation } from "./fixtures/look-history-parity";
import { digest, restore } from "./fixtures/workspace-observable";
import { damagedWorkspaceV1, largeWorkspaceV1, looseWorkspaceV1, smallWorkspaceV1, withPreferences } from "./fixtures/workspace-v1-fixtures";
import { encodeWorkspaceAt } from "../src/app/workspace/workspace-budget";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { createHistoryService } from "../src/platform/core/history-service";

const golden = JSON.parse(readFileSync(new URL("./golden/look-history-parity.json", import.meta.url), "utf8"));
const fixtures = { small: smallWorkspaceV1, loose: looseWorkspaceV1, large: largeWorkspaceV1, damaged: damagedWorkspaceV1,
  preferences: () => withPreferences(smallWorkspaceV1()) };

// Reproduce the old replay policy through the public history target interface, without changing the application.
function legacySelectionHistory() {
  const history = createHistoryService(), open = history.open.bind(history);
  history.open = (id, target, options) => open(id, { ...target, selection: undefined }, options);
  return history;
}
function differences(before: unknown, after: unknown, path = ""): { path: string; before: unknown; after: unknown }[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (before && after && typeof before === "object" && typeof after === "object") {
    const a = before as Record<string, unknown>, b = after as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(key => differences(a[key], b[key], `${path}/${key}`));
  }
  return [{ path, before, after }];
}
function decoded(stored: unknown, legacy = false) {
  const walks: WalkObservation[] = [];
  const observed = session(stored, legacy ? legacySelectionHistory : undefined, value => walks.push(value));
  if (walks.length !== 1) throw Error("The parity session must inspect its reloaded Undo/Redo walk once.");
  const walk = walks[0];
  return { observed, decoded: { ...observed, reload: { ...observed.reload,
    walk: { ...observed.reload.walk, states: walk.states, jumps: walk.jumps } } } };
}

for (const [name, fixture] of Object.entries(fixtures)) test(`${name}: histories and stored form retain parity; sessions change only selection restoration`, () => {
  const loaded = restore(fixture());
  expect(loaded.writable).toBe(true);
  const stored = encodeWorkspaceAt(loaded.state, 0, STUDIO_DOCUMENTS).encoded;
  const legacy = decoded(fixture(), true), current = decoded(fixture());
  const legacyStored = decoded(JSON.parse(stored), true), currentStored = decoded(JSON.parse(stored));
  const selectionBaseline = { session: digest(legacy.observed), sessionFromStored: digest(legacyStored.observed) };
  expect(selectionBaseline).toEqual(golden[name].selectionBaseline);
  for (const [before, after] of [[legacy, current], [legacyStored, currentStored]]) {
    const changes = differences(before.decoded, after.decoded);
    expect(changes.length).toBeGreaterThan(0);
    for (const change of changes) expect(change.path).toMatch(/^\/(?:log\/\d+\/moment|reload\/moment|reload\/walk\/states\/\d+|reload\/walk\/jumps\/\d+\/after)\/(?:active|selected)$/);
  }
  expect({ histories: digest(observeHistories(restore(fixture()).state)), stored: observeStored(loaded.state),
    session: digest(current.observed), sessionFromStored: digest(currentStored.observed), selectionBaseline }).toEqual(golden[name]);
}, 60_000);

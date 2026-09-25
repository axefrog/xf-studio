/**
 * CORE-37: UI preferences and guided-tour progress survive a workspace-1 restore, the workspace-2
 * stored form at every budget level and a second restore, beside the authored content.
 */
import { expect, test } from "bun:test";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { parseUIPreferences } from "../src/ui-preferences";
import { encodeWorkspaceAt, WORKSPACE_LEVELS } from "../src/workspace-budget";
import { parseWorkspace } from "../src/workspace-state";
import { restore } from "./fixtures/workspace-observable";
import { looseWorkspaceV1, smallWorkspaceV1, withPreferences } from "./fixtures/workspace-v1-fixtures";

test("real UI preferences and tour progress round-trip through workspace-1, workspace-2 and every budget level", () => {
  for (const make of [smallWorkspaceV1, looseWorkspaceV1]) {
    const v1 = withPreferences(make());
    const expected = parseUIPreferences(v1.uiPreferences);
    // The fixture really exercises them: nothing fell back to defaults.
    expect(expected).toMatchObject({ theme: "dark", inputHints: false, layout: { format: "xfs-dock", version: 3 } });
    expect(Object.keys(expected.tours ?? {})).toHaveLength(3);
    const first = restore(v1);
    expect(first.writable).toBe(true);
    expect(first.state.uiPreferences).toEqual(expected);
    for (let level = 0; level < WORKSPACE_LEVELS; level++) {
      const again = parseWorkspace(JSON.parse(encodeWorkspaceAt(first.state, level, STUDIO_DOCUMENTS).encoded), STUDIO_DOCUMENTS);
      expect({ level, preferences: again.uiPreferences }).toEqual({ level, preferences: expected });
      expect(again.library).toEqual(first.state.library);
      expect(again.glitterChoices).toEqual(first.state.glitterChoices);
      expect(again.recipe).toEqual(first.state.recipe);
    }
    // The plain fixtures' unschema'd preferences are not read (the golden digests were captured that way).
    expect(restore(make()).state.uiPreferences).toEqual(parseUIPreferences(undefined));
  }
});

// Saved layouts are frozen migration input; tabs and own defaults replace their active controller.
import { expect, test } from "bun:test";
import { UIPreferenceActions, parseUIPreferences } from "../src/app/ui-preferences";
import { freshWorkspace } from "./fixtures/eye-region";

test("legacy layout/library/module fields survive unrelated preferences unchanged", () => {
  const legacy = { ...freshWorkspace().uiPreferences, modules: { future: true, poses: false },
    layouts: { schema: "xfs/layout-library-1" as const, active: "old", extra: "kept", layouts: [{ id: "old", name: "My layout", dock: { format: "xfs/dock", version: 1, state: {} } }] },
    layout: { format: "xfs/dock", version: 1, state: {} } };
  const prefs = new UIPreferenceActions(legacy);
  prefs.dispatch({ kind: "theme.set", theme: "light" });
  const after = parseUIPreferences(prefs.snapshot());
  expect([after.layout, after.layouts, after.modules]).toEqual([legacy.layout, legacy.layouts, legacy.modules]);
});

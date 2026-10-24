import { describe, expect, test } from "bun:test";
import { openProfileSession, type ProfileServices } from "../src/app/profiles/profile-window";
import { dockPanels } from "../src/app/profiles/profiles-migration-data";
import { UIPreferenceActions, type DockLayout } from "../src/app/ui-preferences";
import { parseWorkspace, serializeWorkspace } from "../src/app/workspace/workspace-state";
import { WorkspaceComposer } from "../src/app/workspace/workspace-composer";
import { WorkspacePersistence } from "../src/app/workspace/workspace-persistence";
import { STUDIO_INITIAL_LAYOUT } from "../src/compose/layout-defaults";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { createHistoryService } from "../src/platform/core/history-service";
import { createStudioViewGraph, sessionViewGraph } from "../src/preview/preview-view-graph";
import { PHASE_ONE_PROFILE, PHASE_ONE_TAB, phaseOneWorkspace } from "./fixtures/phase-one-workspace";
import { seededRandom } from "./fixtures/profile-sessions";

const custom: DockLayout = { format: "xfs/dock", version: 1, state: {
  wide: { root: { kind: "group", id: "g-custom", panels: ["layers", "head"], active: "layers" }, floating: [], closed: ["uv"],
    parked: { poses: { group: ["layers", "poses", "head"], index: 1, active: false } },
    lastPlace: { uv: { group: ["uv", "layers"], index: 0, active: true } } },
  compact: { root: { kind: "group", id: "g-small", panels: ["head", "uv"], active: "uv" }, floating: [], closed: ["layers"] },
} };
// Already-migrated workspaces must not consult the library or repeat its transaction.
const services = {} as Pick<ProfileServices, "profiles" | "collections">;
function open(stored: ReturnType<typeof phaseOneWorkspace>) {
  const workspace = parseWorkspace(JSON.parse(JSON.stringify(stored)), STUDIO_DOCUMENTS);
  const opened = openProfileSession(workspace, services, { history: createHistoryService(),
    graph: (data, owner) => createStudioViewGraph(workspace.preview, data, owner), stored: sessionViewGraph,
    ...{ initial: STUDIO_INITIAL_LAYOUT } }, seededRandom(41));
  expect(opened.stored).toBe(true);
  expect(opened.state.profile).toBe(PHASE_ONE_PROFILE);
  return { workspace, session: opened.state };
}

describe("upgrade a workspace written by phase 1 (3d0dabfc)", () => {
  for (const layout of [undefined, null]) test(`factory layout (${layout}) becomes the contributed arrangement`, () => {
    const { workspace, session } = open(phaseOneWorkspace({ layout }));
    const tab = session.tabList()[0]!;
    expect(tab.id).toBe(PHASE_ONE_TAB);
    expect(tab.origin).toBe("eye-makeup/default");
    expect(session.dock()).toEqual(STUDIO_INITIAL_LAYOUT.dock);
    expect(dockPanels(tab.dock).every(id => tab.panels.some(panel => panel.id === id))).toBe(true);
    const { focused: _legacy, ...views } = workspace.profiles!.sessions[PHASE_ONE_PROFILE]!.views;
    expect(session.session().views).toEqual(views);
    expect(session.focus.viewOrder()).toEqual({ main: 4 });
    expect(session.scene("s1").gen).toBe(7);
  });

  test("a custom live preference is consumed before preference capture or a workspace write", () => {
    const before = phaseOneWorkspace({ layout: custom, sessionDock: null });
    const { workspace, session } = open(before);
    expect(session.dock()).toEqual(custom);
    expect(session.tabList()[0]!.origin).toBeUndefined();
    const preferences = new UIPreferenceActions(workspace.uiPreferences);
    const composer = new WorkspaceComposer(workspace, { editor: () => workspace, uvView: () => workspace.uvView,
      savedV: () => workspace.savedV, collections: () => workspace.collections, quality: () => workspace.preview.textureSize,
      preview: () => undefined, uiPreferences: () => preferences.snapshot(),
      profiles: () => ({ migration: workspace.migration, profiles: session.stored(workspace.profiles) }) });
    let saved = "";
    const writer = new WorkspacePersistence({ storage: { setItem: (_key, value) => { saved = value; } }, key: "upgrade-test",
      writable: true, model: STUDIO_DOCUMENTS, capture: () => composer.capture() });
    writer.activate();
    expect(writer.flush()).toBe(true);
    const written = JSON.parse(saved) as ReturnType<typeof serializeWorkspace>;
    expect<unknown>(written.uiPreferences).toEqual(before.uiPreferences);
    const again = open(written as ReturnType<typeof phaseOneWorkspace>);
    expect(again.session.session()).toEqual(session.session());
  });

  test("an existing phase-1 session arrangement is newer than frozen migration preferences", () => {
    const before = phaseOneWorkspace({ layout: STUDIO_INITIAL_LAYOUT.dock, sessionDock: custom });
    const { session } = open(before);
    expect(session.dock()).toEqual(custom);
    expect(session.tabList()[0]!.origin).toBeUndefined();
    expect(session.tabList()[0]).toEqual(before.profiles!.sessions[PHASE_ONE_PROFILE]!.tabs[0]);
  });

  test("a deliberately empty legacy arrangement stays empty, including when a module remains enabled", () => {
    const empty: DockLayout = { format: "xfs/dock", version: 1, state: {
      wide: { root: null, floating: [], closed: ["save-explorer.explorer"] },
      compact: { root: null, floating: [], closed: ["save-explorer.explorer"] },
    } };
    const { session } = open(phaseOneWorkspace({ layout: empty, explorer: true }));
    expect(session.dock()).toEqual(empty);
    expect(session.tabList()[0]!.origin).toBeUndefined();
  });

  for (const instance of [false, true]) test(`enabled module joins the factory arrangement (existing instance: ${instance})`, () => {
    const { session } = open(phaseOneWorkspace({ explorer: true, instance }));
    const tab = session.tabList()[0]!;
    expect(tab.origin).toBe("eye-makeup/default");
    expect(dockPanels(session.dock())).toContain("head");
    expect(dockPanels(session.dock())).toContain("layers");
    expect(dockPanels(session.dock())).toContain("save-explorer.explorer");
    expect(tab.panels.filter(panel => panel.type === "save-explorer.explorer")).toHaveLength(1);
    if (instance) expect(tab.panels.find(panel => panel.type === "save-explorer.explorer"))
      .toEqual({ id: "save-explorer.explorer--oldsave1", type: "save-explorer.explorer", state: { selected: "remembered" } });
  });

  test("a custom arrangement with an enabled module keeps its groups and closed panels", () => {
    const { session } = open(phaseOneWorkspace({ layout: custom, explorer: true }));
    const state = session.dock()!.state as unknown as { wide: { root: { id: string; active: string }; closed: string[] }; compact: { root: { id: string; active: string } } };
    expect(state.wide.root.id).toBe("g-custom");
    expect(state.wide.root.active).toBe("layers");
    expect(state.wide.closed).toContain("uv");
    expect(state.compact.root.id).toBe("g-small");
    expect(state.compact.root.active).toBe("uv");
    expect(dockPanels(session.dock())).toContain("save-explorer.explorer");
  });

  test("a disabled module's remembered places are retained without reopening it", () => {
    const withParked: DockLayout = { ...custom, state: structuredClone(custom.state) };
    const state = withParked.state as unknown as { wide: { parked: Record<string, unknown> } };
    state.wide.parked["save-explorer.explorer"] = { group: ["layers", "save-explorer.explorer"], index: 1, active: false };
    const { session } = open(phaseOneWorkspace({ layout: withParked, explorer: false }));
    expect(session.dock()).toEqual(withParked);
  });

  test("a stored phase-2 empty tab cannot be distinguished from the buggy upgrade: leave it alone", () => {
    const before = phaseOneWorkspace({ instance: true });
    const data = before.profiles!.sessions[PHASE_ONE_PROFILE]!;
    const stored = { ...before, profiles: { ...before.profiles!, sessions: { [PHASE_ONE_PROFILE]: { ...data,
      focus: { ...data.focus, tab: PHASE_ONE_TAB } } } } };
    const { session } = open(stored);
    expect(session.dock()).toBeNull();
    expect(session.tabList()).toEqual(data.tabs);
  });
});

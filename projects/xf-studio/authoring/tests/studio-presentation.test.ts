import { frameworkStatusVerification } from "../src/compose/framework-status-verification";
import { watchFrameworkInputs } from "../src/installation/framework-check-watch";
import { expect, test } from "bun:test";
import { trustedFixture } from "./studio-presentation-fixture";
import { InstallDetectionActions } from "../src/installation/install-detection-actions";
import { LocalSetupActions } from "../src/setup/local-setup-actions";
import type { LocalSetupView } from "../src/setup/local-settings";
import { frameworkCheckFor } from "../src/installation/framework-fixtures";
import { FRAMEWORKS_UNCHECKED } from "../src/installation/framework-status";
import { PartPresetService, type PartPresetTransport } from "../src/library/part-presets";
import type { PartPresetSet } from "../src/library/part-preset-sets";
import { EXPRESSION_FRAMEWORK_REQUIREMENTS } from "../src/features/expressions/requirements";

test("a view names its V and look without History's V kind prefix", () => {
  const { shell } = trustedFixture({ presentation: {
    panelInstance: panel => panel,
    characterName: character => character === "local" ? "Default feminine V" : undefined,
    scopeName: scope => scope.startsWith("look:") ? "Preset 1" : "V · Default feminine V",
  } });
  expect(shell.views.shows("main")).toEqual({ v: "Default feminine V", look: "Preset 1" });
  expect(shell.views.shows("gone")).toEqual({});
});

test("replacement presentation can perform current cross-surface workflows without trusted objects", async () => {
  const { shell, packageInput, downloads, locations } = trustedFixture();
  expect(Object.keys(shell).sort()).toEqual(["about", "authoring", "capture", "desktopApp", "diagnostics", "documents", "experiments", "facial", "feature", "features", "files", "focus", "installDetection", "library", "links", "localSetup", "modInstall", "module", "panels", "preferences",
    "presets", "previewReadiness", "previewSetup", "snapshot", "status", "subscribe", "updates", "viewport", "views", "workspace"]);
  expect("document" in shell.authoring).toBe(false);
  // Without a session (fixtures) each panel is one instance; a panel that isn't a session's 3D view steps the editing context.
  expect(shell.panels.instance("save-explorer")).toBe("save-explorer--local");
  expect(shell.panels.historyScope("head")).toBe(shell.focus.editing()?.scope);
  // A scope nothing names (here no names are given) has no name: Undo's tooltip never shows a scope's ID ("Changes to look:none/none").
  expect(shell.focus.editing()?.scope).toBeString();
  expect(shell.focus.editing()).not.toHaveProperty("name");
  // No desktop-app offer without a host that has one (the desktop app, fixtures): nothing about it is shown.
  expect(shell.desktopApp.offered()).toBe(false);
  expect(shell.desktopApp.capability({ kind: "desktopApp.refresh" }).available).toBe(false);
  // The detection snapshot carries what Settings › Game › Mod frameworks shows: nothing without a chosen game folder.
  expect(shell.installDetection.snapshot().frameworkStatus).toMatchObject({ shown: false, rows: [], attention: 0 });
  let notifications = 0; const unsubscribe = shell.subscribe(() => notifications++);
  const initial = shell.snapshot(), firstLayer = initial.authoring.document.recipe.layers[0];
  expect(initial.previewReadiness).toMatchObject({ phase: "ready", size: 1024 });
  (initial.authoring.document.recipe.layers[0] as any).name = "Tampered";
  expect(shell.snapshot().authoring.document.recipe.layers[0].name).not.toBe("Tampered");

  expect(shell.authoring.capability({ kind: "layer.edit", command: { kind: "add" } }).available).toBe(true);
  expect(shell.authoring.dispatch({ kind: "layer.edit", command: { kind: "add" } }).ok).toBe(true);
  expect(shell.snapshot().authoring.document.recipe.layers).toHaveLength(5);
  expect(shell.authoring.dispatch({ kind: "history.undo" }).ok).toBe(true);
  expect(shell.snapshot().authoring.document.recipe.layers).toHaveLength(4);
  expect(shell.authoring.dispatch({ kind: "preset.edit", command: { kind: "copy",
    id: shell.library.view().draft!.selected! } }).ok).toBe(true);
  expect(shell.library.view().draft?.presets).toHaveLength(2);
  expect(shell.authoring.dispatch({ kind: "scene.setLook", look: { collection: initial.library.draft!.id, look: initial.library.draft!.selected! } }).ok).toBe(true);

  expect(shell.viewport.uvCommandCapability("other").available).toBe(false);
  expect(shell.viewport.uvCommand("single")).toBe(true);
  expect(shell.viewport.uvCommand("other")).toBe(true);
  shell.viewport.rehost("uv", "floating");
  expect(locations).toContain("uv:floating");
  expect(shell.snapshot().viewport.uv!.view).toMatchObject({ mode: "single", side: "high" });
  const query = shell.viewport.contextAt("uv", 20, 20)!;
  expect(query.options.some(option => option.id === "point.remove")).toBe(true);
  expect(shell.authoring.dispatch({ kind: "layer.setOpacity", layerId: firstLayer.id,
    opacity: .57 }).ok).toBe(true);
  expect(shell.authoring.dispatchContext(query.context, { kind: "point.remove",
    layerId: firstLayer.id, index: 0 })).toMatchObject({ ok: false, code: "missing_target" });

  expect(shell.authoring.dispatch({ kind: "quality.set", size: 1024 }).ok).toBe(true);
  expect(shell.snapshot().authoring.quality?.size).toBe(1024);
  expect((await shell.files.execute({ kind: "recipe.export" })).ok).toBe(true);
  expect(downloads).toContain("xfs.recipe.json");
  expect((await shell.files.execute({ kind: "package.check" })).ok).toBe(true);
  expect(shell.files.snapshot().package?.kind).toBe("packageCheck");
  expect(shell.snapshot().files.package?.freshness).toBe("current");
  expect(packageInput()?.id).toBe(shell.library.view().draft?.id);
  expect(shell.authoring.dispatch({ kind: "layer.setOpacity", layerId: firstLayer.id,
    opacity: .42 }).ok).toBe(true);
  expect(shell.snapshot().files.package?.freshness).toBe("stale");
  expect(shell.preferences.capability({ kind: "theme.set", theme: "dark" }).available).toBe(true);
  shell.preferences.dispatch({ kind: "theme.set", theme: "dark" });
  expect(shell.snapshot().preferences.theme).toBe("dark");
  expect(notifications).toBeGreaterThan(0);
  unsubscribe();
});

// The diagnostic uses real detection and library owners; presentation cannot revive a report for older settings.

async function diagnosticFixture(presets?: PartPresetService, check = frameworkCheckFor("all-ok")) {
  if (!presets) { presets = presetOwner(); await presets.execute({ kind: "partPresetSet.list", feature: "expressions" }); }
  let fields = { gameRoot: "C:\\Game", launchRoute: "mo2", mo2Root: "C:\\MO2", mo2ProfileId: "Play" };
  const setup = new LocalSetupActions(async (_method, body) => {
    if (body) fields = { ...fields, ...(body as { fields: typeof fields }).fields };
    return { ok: true, status: 200, data: { fields, source: "primary", revision: 1 } as LocalSetupView };
  });
  await setup.dispatch({ kind: "setup.refresh" });
  let fail = false;
  const detection = new InstallDetectionActions(async () => fail
    ? { ok: false, status: 503, data: { code: "unavailable", error: "The selected game folder could not be read. Choose Check again." } }
    : { ok: true, status: 200, data: check }, () => setup.snapshot().view?.fields);
  const { shell } = trustedFixture({ presets, presentation: { localSetup: setup, installDetection: detection,
    frameworkProducts: [{ feature: "expressions", name: "expression sets", requirements: EXPRESSION_FRAMEWORK_REQUIREMENTS }] } });
  return { shell, setup, detection, fail: () => { fail = true; } };
}

test("a failed re-check after any input change never presents the old MO2 report as ready", async () => {
  for (const change of [{ gameRoot: "C:\\OtherGame" }, { launchRoute: "direct" as const }, { mo2Root: "C:\\OtherMO2" }, { mo2ProfileId: "Other" }]) {
    const h = await diagnosticFixture();
    await h.detection.dispatch({ kind: "detect.frameworkVersions" });
    expect(h.shell.installDetection.snapshot().frameworkStatus.tone).toBe("ready");
    await h.setup.dispatch({ kind: "setup.update", fields: change });
    expect(h.shell.installDetection.snapshot().frameworkStatus).toMatchObject({ tone: "info", line: FRAMEWORKS_UNCHECKED, rows: [] });
    h.fail(); await h.detection.dispatch({ kind: "detect.frameworkVersions" });
    expect(h.shell.installDetection.snapshot().frameworkStatus).toMatchObject({ tone: "info", rows: [], foldable: false,
      line: "The selected game folder could not be read. Choose Check again." });
    expect(h.shell.installDetection.capability({ kind: "detect.frameworkVersions" }).available).toBe(true);
  }
});

function presetOwner(listSets?: (feature: string) => Promise<PartPresetSet[]> | undefined) {
  let stored: PartPresetSet[] = [];
  const unused = async (): Promise<never> => { throw Error("Unexpected fixture transport call"); };
  const transport: PartPresetTransport = { list: unused, save: unused, rename: unused, delete: unused, updateSet: unused,
    listSets: async feature => listSets?.(feature) ?? structuredClone(stored),
    createSet: async input => { const set = { ...input, id: crypto.randomUUID(), revision: 1, updatedAt: "", members: [] }; stored.push(set); return set; },
    deleteSet: async id => { stored = stored.filter(set => set.id !== id); return { id }; },
  };
  return new PartPresetService(transport);
}

test("requirements loading cannot claim readiness even after successful framework detection", async () => {
  let resolve!: (sets: PartPresetSet[]) => void;
  const owner = presetOwner(() => new Promise(done => { resolve = done; }));
  const h = await diagnosticFixture(owner, frameworkCheckFor("expressions-missing")), read = () => h.shell.installDetection.snapshot().frameworkStatus;
  expect(read()).toMatchObject({ line: "Checking what your mods need…", rows: [], foldable: false });
  await h.detection.dispatch({ kind: "detect.frameworkVersions" });
  expect(read()).toMatchObject({ tone: "checking", line: "Checking what your mods need…", rows: [], attention: 0 });
  resolve([]); await new Promise(done => setTimeout(done, 0));
  expect(read()).toMatchObject({ tone: "ready", line: "All frameworks up to date" });
  expect(read().rows.find(row => row.id === "tweakxl")?.status).toBe("not-needed");
});

test("failed requirements keep the owner's message and both retry actions reload through that owner", async () => {
  for (const action of ["retry", "check"] as const) {
    let calls = 0, resolve!: (sets: PartPresetSet[]) => void;
    const message = "Your expression sets couldn’t be read.";
    const owner = presetOwner(async () => {
      if (++calls === 1) throw Error(message);
      return new Promise(done => { resolve = done; });
    });
    const h = await diagnosticFixture(owner, frameworkCheckFor("expressions-missing")), read = () => h.shell.installDetection.snapshot().frameworkStatus;
    read(); await h.detection.dispatch({ kind: "detect.frameworkVersions" });
    await new Promise(done => setTimeout(done, 0));
    expect(read()).toMatchObject({ tone: "info", line: message, rows: [], foldable: false, retryRequirements: true });
    const retry = action === "retry" ? h.shell.installDetection.retryRequirements()
      : h.shell.installDetection.dispatch({ kind: "detect.frameworkVersions" });
    expect(calls).toBe(2);
    expect(read()).toMatchObject({ tone: "checking", line: "Checking what your mods need…", rows: [] });
    expect(read().retryRequirements).not.toBe(true);
    resolve([{ id: "faces", feature: "expressions", name: "Faces", revision: 1, members: [], updatedAt: "" }]);
    await retry;
    expect(read().rows.find(row => row.id === "tweakxl")).toMatchObject({ status: "missing", neededFor: "Needed for expression sets" });
  }
});

test("requirements follow the owner's expression-set list, including creation and deletion after the check", async () => {
  const presets = presetOwner();
  const h = await diagnosticFixture(presets);
  const read = () => h.shell.installDetection.snapshot().frameworkStatus;
  read(); await presets.execute({ kind: "partPresetSet.list", feature: "expressions" });
  await h.detection.dispatch({ kind: "detect.frameworkVersions" });
  expect(read().rows.find(row => row.id === "tweakxl")).toMatchObject({ status: "not-needed", neededFor: null });
  const made = await presets.execute({ kind: "partPresetSet.create", feature: "expressions", name: "Faces" });
  if (!made.ok || !made.set) throw Error("Fixture set not created");
  expect(read().rows.find(row => row.id === "tweakxl")).toMatchObject({ status: "ok", neededFor: "Needed for expression sets" });
  expect(read().rows.find(row => row.id === "archivexl")?.neededFor).toBe("Needed for XF Eye Artistry and expression sets");
  await presets.execute({ kind: "partPresetSet.delete", feature: "expressions", id: made.set.id, revision: 1 });
  expect(read().rows.find(row => row.id === "tweakxl")).toMatchObject({ status: "not-needed", neededFor: null });
});

test("a delayed successful report stays bound to the settings it started with", async () => {
  const h = await diagnosticFixture();
  let release!: () => void;
  const detector = new InstallDetectionActions(async () => {
    await new Promise<void>(done => { release = done; });
    return { ok: true, status: 200, data: frameworkCheckFor("all-ok") };
  }, () => h.setup.snapshot().view?.fields);
  const { shell } = trustedFixture({ presentation: { localSetup: h.setup, installDetection: detector } });
  const pending = detector.dispatch({ kind: "detect.frameworkVersions" });
  await h.setup.dispatch({ kind: "setup.update", fields: { gameRoot: "C:\\AnotherGame" } });
  release(); await pending;
  expect(shell.installDetection.snapshot().frameworkStatus).toMatchObject({ tone: "info", rows: [], line: FRAMEWORKS_UNCHECKED });
});

test("the capture states run through the real setup, detection, watcher and library owners without a browser", async () => {
  const h = await diagnosticFixture(), presets = presetOwner(feature => hook.listSets(feature));
  let hook!: ReturnType<typeof frameworkStatusVerification>;
  const detection = new InstallDetectionActions(async target => {
    const answer = hook.transport(target);
    if (!answer) throw Error("A capture specimen unexpectedly asked the live host");
    return answer;
  }, () => h.setup.snapshot().view?.fields);
  hook = frameworkStatusVerification({ setup: h.setup, detection: () => detection, presets: () => presets });
  const { shell } = trustedFixture({ presets, presentation: { localSetup: h.setup, installDetection: detection,
    frameworkProducts: [{ feature: "expressions", name: "expression sets", requirements: EXPRESSION_FRAMEWORK_REQUIREMENTS }] } });
  const read = () => shell.installDetection.snapshot().frameworkStatus;
  await hook.state("all-ok");
  const stop = watchFrameworkInputs(h.setup, detection);
  try {
    for (const state of hook.states) {
      await hook.state(state);
      if (state === "no-game") expect(read().shown).toBe(false);
      else if (state === "requirements-loading") expect(read()).toMatchObject({ tone: "checking", rows: [], line: "Checking what your mods need…" });
      else if (state === "requirements-failed") expect(read()).toMatchObject({ tone: "info", rows: [], line: "Your expression sets couldn’t be read.", retryRequirements: true });
      else if (state === "failed") expect(read()).toMatchObject({ tone: "info", rows: [], line: "XF Studio couldn’t read your frameworks. Choose Check again to try once more." });
      else if (state === "checking") {
        expect(read().tone).toBe("checking"); hook.release();
        await new Promise(done => setTimeout(done, 0));
      } else {
        expect(read().tone).toBe(["too-old", "missing", "expressions-too-old", "expressions-missing"].includes(state) ? "attention" : "ready");
        expect(read().rows.find(row => row.id === "tweakxl")?.neededFor).toBe(state.startsWith("expressions-") ? "Needed for expression sets" : null);
      }
    }
  } finally { hook.release(); stop(); }
});

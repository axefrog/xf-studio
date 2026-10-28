import { expect, spyOn, test } from "bun:test";
import { AcceptedStudioOperation } from "../src/app/accepted-studio-operation";
import { StudioFileOperations, type CapturedCollectionService, type FileWriter, type StudioFileAction, type StudioFilePort } from "../src/app/studio-file-operations";
import type { CollectionActivity, CollectionOutcome, CollectionProgress, CollectionRequest, CollectionResult, CollectionService } from "../src/library/collection-service";
import { FILE_DESCRIPTORS, PART_PRESET_DESCRIPTORS, REQUEST_DESCRIPTORS } from "../src/app/studio-action-descriptors";
import { PartPresetService, type PartPreset, type PartPresetRequest, type PartPresetSet } from "../src/library/part-presets";
import type { ViewRecord } from "../src/platform/api/view-graph";
import { profileContextStudio } from "./fixtures/profile-context-studio";
import { portableRecipe } from "../src/legacy/eye-makeup/recipe-schema";
import { initialRecipe } from "./fixtures/eye-region";
import { eyeBuild, eyeCheck } from "./fixtures/package-results";
import { makeupFileOperations } from "../src/app/authoring/makeup-files";
import type { Layer } from "../src/engines/layered-makeup/recipe";

const fileActions: StudioFileAction[] = [
  { kind: "workspace.showInFolder" }, { kind: "recipe.import", collection: "A" }, { kind: "recipe.export" }, { kind: "mask.export" },
  { kind: "savedV.import", character: "V-A" }, { kind: "savedV.export" }, { kind: "characterPreset.import", character: "V-A" },
  { kind: "characterPreset.export" }, { kind: "collection.import" }, { kind: "collection.export" }, { kind: "collection.plan" },
  { kind: "collection.exportWindowCopy" }, { kind: "collection.recover", draft: "earlier-A" }, { kind: "package.check" }, { kind: "package.build" },
];
const requests: CollectionRequest[] = [
  { kind: "initialize" }, { kind: "refresh" }, { kind: "open", id: "opened-A" }, { kind: "save" }, { kind: "saveCopy" },
  { kind: "exportCollection" }, { kind: "exportPlan" }, { kind: "import", text: "A", bytes: 1 },
  { kind: "package", action: "check" }, { kind: "package", action: "build" }, { kind: "resolveConflict", conflict: "conflict-A", keep: "mine" },
];

/** Deliberately different services: any post-acceptance fallback returns B's sentinel or throws. */
function fixture() {
  const gate = Promise.withResolvers<void>(), recipe = initialRecipe(), notifications = new Set<() => void>();
  const seen: string[] = [], downloads: { name: string; blob: Blob }[] = [];
  let focused = "A", request: CollectionActivity | undefined, progress: CollectionProgress | undefined, released = 0, reads = 0;
  const notify = () => { for (const listener of notifications) listener(); };
  const resultFor = (input: CollectionRequest): CollectionResult => {
    switch (input.kind) {
      case "initialize": case "refresh": return { kind: "list", summaries: [] };
      case "import": return { kind: "imported" };
      case "resolveConflict": return { kind: "resolved" };
      case "open": case "save": case "saveCopy": return { kind: input.kind === "open" ? "opened" : "saved",
        collection: { collection: { schema: "xfs/collection-2", id: "A", name: "A", presets: [] }, revision: 1, updatedAt: "" } };
      case "exportCollection": case "exportPlan": return { kind: "export", name: "A.json", json: '{"target":"A"}' };
      case "package": { const checked = eyeCheck({ id: "A" }, { presets: [] }); return input.action === "check" ? { kind: "packageCheck", result: checked }
        : { kind: "packageBuild", result: eyeBuild(checked, "candidate-A") }; }
    }
  };
  const service: CapturedCollectionService = {
    summary: () => ({ busy: !!request, summaries: [], progress }), activity: () => request, capability: () => ({ available: true }),
    subscribe: listener => { notifications.add(listener); return () => notifications.delete(listener); },
    cancel: id => { expect(id).toBe(41); seen.push("cancel:A"); return { accepted: true }; },
    lastPackageIsCurrent: () => true, retainPackageResult: () => { reads++; return () => { reads--; }; },
    draftIdentity: () => ({ collectionId: "A" }), actionCapability: () => ({ available: true }),
    exportWindowCopy: () => { seen.push("windowCopy:A"); return { name: "A.json", json: '{"target":"A"}', message: "A window copy" }; },
  };
  const execute = async (input: CollectionRequest): Promise<CollectionOutcome> => {
    seen.push(`execute:A:${input.kind}`);
    request = { requestId: 41, kind: input.kind, startedAt: 1, cancellable: input.kind === "package" && input.action === "build",
      ...(input.kind === "package" ? { action: input.action } : {}) };
    progress = { phase: "working", code: input.kind, message: "A is working", requestId: 41 }; notify();
    await gate.promise;
    const result = resultFor(input);
    request = undefined; progress = { phase: "success", code: result.kind, message: "A completed", requestId: 41 }; notify();
    return { ok: true, result, requestId: 41 };
  };
  const writer: FileWriter = {
    operations: () => ({ service, execute }), collection: () => "A", message: () => "A completed",
    featureFiles: makeupFileOperations({ recipe: () => recipe, selectedLayer: () => recipe.layers[0],
      importRecipe: (_recipe, _name, into) => { expect(into).toBe("A"); seen.push("importRecipe:A"); } }),
    hasSavedV: () => true, savedV: () => ({ owner: "A" } as never), savedVReady: () => true,
    loadSavedV: (_bytes, character) => { expect(character).toBe("V-A"); seen.push("savedV:A"); return {}; },
    recoverCollection: draft => { expect(draft).toBe("earlier-A"); seen.push("recover:A"); },
    characterPreset: { unavailable: () => undefined,
      load: (_value, character) => { expect(character).toBe("V-A"); seen.push("character:A"); },
      save: async () => { await gate.promise; return { name: "A.json", text: '{"target":"A"}', values: 1, leftOut: 0, personal: 0 }; } },
  };
  const device: StudioFilePort = {
    revealWorkspace: async () => { seen.push("reveal:A"); await gate.promise; },
    pick: async kind => { await gate.promise; const value = kind === "recipe" ? portableRecipe(recipe)
      : kind === "characterPreset" ? { schema: "xfs/cc-preset-1", bodyGender: "female", values: [] } : { target: "A" };
      const text = JSON.stringify(value); return { name: "A.json", size: text.length, text: async () => text, bytes: async () => new TextEncoder().encode(text) }; },
    download: (blob, name) => downloads.push({ blob, name }), bakeMask: async layer => { expect((layer as Layer).id).toBe(recipe.layers[0]!.id); await gate.promise; return new Blob(["mask-A"]); },
  };
  const live = { ...service, summary: () => ({ busy: false, summaries: [], progress: { phase: "error", code: "B", message: "Wrong B" } }),
    lastPackageIsCurrent: () => { throw Error("Accepted freshness reached the live service"); },
    exportWindowCopy: () => { throw Error("Accepted export reached the live service"); },
    windowCopyCapability: () => ({ available: true }) } as unknown as CollectionService;
  const wrong = () => { throw Error("Accepted operation reached a live writer"); };
  const files = new StudioFileOperations(device, { ...writer, featureFiles: makeupFileOperations({ recipe: wrong, selectedLayer: () => recipe.layers[0], importRecipe: wrong }),
    savedV: wrong, loadSavedV: wrong, recoverCollection: wrong,
    message: wrong, characterPreset: { unavailable: () => undefined, load: wrong, save: async () => wrong() },
    executeCollection: async () => { throw Error("Accepted execution reached the live service"); },
    capture: () => { focused = "B"; return { writer, check: () => ({ available: true }), release: () => { released++; } }; } });
  files.attachCollection(live);
  const states: ReturnType<StudioFileOperations["snapshot"]>[] = []; files.subscribe(() => states.push(files.snapshot()));
  return { files, service, device, gate, states, seen, downloads, focused: () => focused, released: () => released, reads: () => reads };
}

test("operation matrix covers every registered file kind and library kind (Stop controls an existing operation)", () => {
  expect(fileActions.map(action => String(action.kind)).sort()).toEqual(Object.keys(FILE_DESCRIPTORS).filter(kind => kind !== "package.stop").sort());
  expect([...new Set(requests.map(request => String(request.kind)))].sort()).toEqual(Object.keys(REQUEST_DESCRIPTORS).sort());
});

const completedOperations = [
  ...fileActions.map(action => ({ name: `file ${action.kind}`, run: (files: StudioFileOperations) => files.execute(action) })),
  ...requests.map(request => ({ name: `library ${request.kind}${request.kind === "package" ? `.${request.action}` : ""}`,
    run: (files: StudioFileOperations) => files.executeCollection(request) })),
];
for (const operation of completedOperations) test(`late notifications preserve the newer outcome after completed ${operation.name}`, async () => {
  const f = fixture(), subscribe = AcceptedStudioOperation.prototype.subscribe;
  let notify: (() => void) | undefined;
  // Keep a delivery already queued by an adapter, even if its subscription is later removed.
  const subscription = spyOn(AcceptedStudioOperation.prototype, "subscribe").mockImplementation(function (this: AcceptedStudioOperation, listener) {
    notify = listener; return subscribe.call(this, listener);
  });
  try {
    const pending = operation.run(f.files); subscription.mockRestore();
    f.gate.resolve(); expect(await pending).toMatchObject({ ok: true });
    f.device.pick = async () => ({ name: "broken.json", size: 1, text: async () => "{", bytes: async () => new TextEncoder().encode("{") });
    expect(await f.files.execute({ kind: "recipe.import", collection: "A" })).toMatchObject({ ok: false, code: "invalid_json" });
    const state = f.files.snapshot(), notifications = f.states.length;
    expect(state.last).toMatchObject({ kind: "recipe.import", ok: false, code: "invalid_json" });
    expect(notify).toBeDefined();
    notify!(); notify!(); notify!();
    expect(f.states.length).toBeGreaterThan(notifications);
    expect(f.files.snapshot()).toEqual(state);
  } finally { subscription.mockRestore(); f.files.dispose(); expect(f.reads()).toBe(0); }
});

for (const action of fileActions) test(`all accepted file dependencies stay captured through completion: ${action.kind}`, async () => {
  const f = fixture();
  try {
    const pending = f.files.execute(action); expect(f.focused()).toBe("B");
    expect(f.states.some(state => state.activity.some(entry => entry.kind === action.kind))).toBe(true);
    f.gate.resolve(); expect(await pending).toMatchObject({ ok: true });
    const state = f.files.snapshot();
    expect(state).toMatchObject({ collectionBusy: false, activity: [], last: { kind: action.kind, ok: true } });
    expect(state.progress?.message).not.toBe("Wrong B");
    expect(state.package?.result.collectionId).toBe(action.kind.startsWith("package.") ? "A" : undefined);
    if (state.package) expect(state.package.freshness).toBe("current");
    for (const download of f.downloads) expect((await download.blob.text()).includes('"target":"B"')).toBe(false);
    if (action.kind === "recipe.export") expect(JSON.parse(await f.downloads[0]!.blob.text())).toEqual(portableRecipe(initialRecipe()));
    if (action.kind === "savedV.export") expect(JSON.parse(await f.downloads[0]!.blob.text())).toEqual({ owner: "A" });
    if (action.kind === "mask.export") expect(await f.downloads[0]!.blob.text()).toBe("mask-A");
    expect(f.released()).toBe(1);
    if (action.kind === "collection.exportWindowCopy") expect(f.seen).toContain("windowCopy:A");
    if (action.kind === "collection.recover") expect(f.seen).toContain("recover:A");
  } finally { f.files.dispose(); expect(f.reads()).toBe(0); }
});

test("a picker and a library Build retain separate observable owners and Stop targets only Build", async () => {
  const f = fixture();
  try {
    const picker = f.files.execute({ kind: "recipe.import", collection: "A" });
    const build = f.files.executeCollection({ kind: "package", action: "build" });
    expect(f.files.activity()).toMatchObject([{ kind: "recipe.import", cancellable: false }, { kind: "package.build", requestId: 41, cancellable: true }]);
    expect(f.files.snapshot().progress?.message).toBe("A is working");
    expect(await f.files.execute({ kind: "package.stop" })).toMatchObject({ ok: true }); expect(f.seen).toContain("cancel:A");
    f.gate.resolve(); expect(await picker).toMatchObject({ ok: true }); expect(await build).toMatchObject({ ok: true });
    expect(f.files.snapshot()).toMatchObject({ activity: [], package: { freshness: "current", result: { collectionId: "A" } } });
    expect(f.released()).toBe(2);
  } finally { f.files.dispose(); expect(f.reads()).toBe(0); }
});

test("disposing a pending operation cancels its captured Build and a late answer acquires no result reader", async () => {
  const f = fixture(), pending = f.files.executeCollection({ kind: "package", action: "build" });
  f.files.dispose(); expect(f.seen).toContain("cancel:A"); f.gate.resolve(); await pending;
  expect(f.released()).toBe(1); expect(f.reads()).toBe(0);
});

for (const input of requests) test(`all accepted library observables stay captured: ${input.kind}${input.kind === "package" ? `.${input.action}` : ""}`, async () => {
  const f = fixture();
  try {
    const pending = f.files.executeCollection(input); expect(f.focused()).toBe("B");
    expect(f.files.snapshot()).toMatchObject({ collectionBusy: true, progress: { message: "A is working" } });
    expect(f.files.activity()[0]).toMatchObject({ requestId: 41, cancellable: input.kind === "package" && input.action === "build" });
    f.gate.resolve(); expect(await pending).toMatchObject({ ok: true });
    expect(f.files.snapshot()).toMatchObject({ collectionBusy: false, activity: [], last: { message: "A completed" }, progress: { message: "A completed" } });
    expect(f.states.some(state => state.progress?.message === "A is working")).toBe(true);
    if (input.kind === "package") expect(f.files.snapshot().package).toMatchObject({ freshness: "current", result: { collectionId: "A" } });
    expect(f.released()).toBe(1);
  } finally { f.files.dispose(); expect(f.reads()).toBe(0); }
});

test("owner audit: every saved-preset/set operation completes through an unseen bound input across focus/drawn changes", async () => {
  let gate: ReturnType<typeof Promise.withResolvers<void>> | undefined, saved: PartPreset | undefined, set: PartPresetSet | undefined;
  const wait = async () => { await gate?.promise; }, presetId = "preset-A", setId = "set-A", feature = "expressions";
  const ids: string[] = [], receipts: string[] = [];
  const service = new PartPresetService({
    list: async kind => { expect(kind).toBe(feature); await wait(); return saved ? [structuredClone(saved)] : []; },
    save: async input => { const accepted = structuredClone(input); await wait();
      return saved = { ...accepted, id: presetId, revision: 1, updatedAt: "now" }; },
    rename: async (id, input) => { ids.push(id); await wait(); saved = { ...saved!, ...input, revision: input.revision + 1 }; return saved; },
    delete: async id => { ids.push(id); const removed = saved!; await wait(); saved = undefined;
      return { id, restore: { ...removed, createdAt: "now", memberships: [] } }; },
    restore: async input => { ids.push(input.id); await wait(); return saved = { ...input, revision: 1, updatedAt: "now" }; },
    listSets: async kind => { expect(kind).toBe(feature); await wait(); return set ? [structuredClone(set)] : []; },
    createSet: async input => { const accepted = structuredClone(input); await wait(); return set = { ...accepted, id: setId, members: accepted.members ?? [], revision: 1, updatedAt: "now" }; },
    updateSet: async (id, input) => { ids.push(id); await wait(); return set = { ...set!, ...input, revision: input.revision + 1 }; },
    deleteSet: async id => { ids.push(id); await wait(); set = undefined; return { id }; },
  }, {
    package: async (action, collection, _signal, progress) => {
      expect(collection).toMatchObject({ id: setId, presets: [{ id: presetId }] });
      if (action === "build") progress?.({ stage: "convert", step: 3, steps: 5 });
      await wait(); const checked = eyeCheck({ id: setId }, { presets: [] });
      return action === "check" ? checked : eyeBuild(checked, "proof-A");
    },
    reveal: async candidate => { receipts.push(candidate); await wait(); return { ok: true }; },
  });
  const w = await profileContextStudio({ presets: service, starters: true });
  try {
    const port = w.bind("presets--scene2").context.current(), covered: string[] = [];
    expect(port.feature(feature)!.dispatch({ kind: "expression.setControl", name: "jaw_mid_open", value: .31 } as never).ok).toBe(true);
    const reader = new AbortController(), held = w.authoring.contexts.acquire(w.looks[2]!, reader.signal)!;
    const part = structuredClone(held.context.app.featureEnvelope(feature)!); reader.abort();
    const run = async (request: PartPresetRequest) => {
      gate = Promise.withResolvers<void>();
      const pending = port.presets.execute(request), views = w.session.session().views.views as readonly ViewRecord[];
      const next = views[covered.length % 2]!; w.history.focus.focusView(next.id); w.draw(next.id);
      if (request.kind === "partPresetSet.build") expect(port.presets.exports().busy).toMatchObject({ id: setId, action: "build", progress: { fraction: .5 } });
      gate.resolve(); expect([request.kind, (await pending).ok]).toEqual([request.kind, true]); covered.push(request.kind);
    };
    await run({ kind: "partPreset.list", feature });
    await run({ kind: "partPreset.save", feature, name: "Captured", part: undefined as never });
    expect(saved!.part).toEqual(part);
    await run({ kind: "partPreset.rename", feature, id: presetId, name: "Renamed", revision: saved!.revision });
    await run({ kind: "partPreset.delete", feature, id: presetId, revision: saved!.revision });
    await run({ kind: "partPreset.restore", feature, id: presetId });
    await run({ kind: "partPresetSet.list", feature });
    await run({ kind: "partPresetSet.create", feature, name: "Set", members: [presetId] });
    await run({ kind: "partPresetSet.rename", feature, id: setId, name: "Set A", revision: set!.revision });
    await run({ kind: "partPresetSet.setMembers", feature, id: setId, members: [presetId], revision: set!.revision });
    await run({ kind: "partPresetSet.setExport", feature, id: setId, modName: "Captured A", revision: set!.revision });
    await run({ kind: "partPresetSet.check", feature, id: setId });
    expect(port.presets.exports().results[setId]).toMatchObject({ kind: "check", result: { collectionId: setId } });
    await run({ kind: "partPresetSet.build", feature, id: setId });
    expect(port.presets.exports().results[setId]).toMatchObject({ kind: "build", result: { collectionId: setId } });
    await run({ kind: "partPresetSet.reveal", feature, id: setId }); expect(receipts).toEqual(["xfs_test"]);
    await run({ kind: "partPresetSet.delete", feature, id: setId, revision: set!.revision });
    expect(covered.sort()).toEqual(Object.keys(PART_PRESET_DESCRIPTORS).sort());
    expect(ids.every(id => id === presetId || id === setId)).toBe(true);
    // Starter saving is synchronous: its shape is serialized from the bound document before the outbox waits.
    expect(port.authoring.dispatch({ kind: "starters.save", layerId: "layer-1", name: "Captured starter" }).ok).toBe(true);
    expect(w.starters!.list().some(starter => starter.name === "Captured starter")).toBe(true);
  } finally { gate?.resolve(); await w.dispose(); }
});

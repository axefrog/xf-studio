/**
 * Profiles phase 1d-ii: the Studio on the profile services, single-V parity at the service level. The collection a scene's look belongs
 * to is edited through owner commands, the shown look through its session (the outbox), Save is Save version, and a restart (a second
 * window on the same library) brings everything back.
 */
import { describe, expect, test } from "bun:test";
import { profileStudio, type ProfileStudio } from "./fixtures/profile-studio";
import { initialRecipe } from "./fixtures/eye-region";
import { lookRef } from "../src/library/collection-documents";
import { lookScope } from "../src/platform/core/history-service";
import { NOTHING_TO_UNDO } from "../src/app/studio-application";
import { CONFLICT_FIRST } from "../src/library/collection-actions";

const layerId = (studio: ProfileStudio, index = 0) => studio.document.recipe.layers[index]!.id;
const dispatch = (studio: ProfileStudio, action: Parameters<ProfileStudio["app"]["dispatch"]>[0]) => {
  const result = studio.app.dispatch(action);
  if (!result.ok) throw Error(result.message);
  return result;
};
/** The same library opened by another window (a restart): showing the look the first one showed. */
async function restart(studio: ProfileStudio) {
  await studio.settle();
  return profileStudio({ library: studio.library, show: studio.scene.look() });
}

describe("the shown look", () => {
  test("opens on the scene's look, is edited in place and written through its session; a restart shows it with its Undo history", async () => {
    const studio = await profileStudio();
    await studio.collection.initialize();
    const ref = studio.scene.look()!;
    expect(studio.document.scopeId).toBe(lookScope(ref));
    expect(studio.collection.summary().draft).toMatchObject({ name: "Current", selected: ref.look, presets: [{ id: ref.look, name: "Look", layers: initialRecipe().layers.length }] });
    dispatch(studio, { kind: "layer.setOpacity", layerId: layerId(studio), opacity: 0.25 });
    dispatch(studio, { kind: "layer.setOpacity", layerId: layerId(studio), opacity: 0.5 });
    expect(studio.app.history()).toMatchObject({ depth: 2 });
    expect(await studio.settle()).toBe(true);
    const stored = studio.library.documents.read([lookRef(ref)])[`look-working/${ref.collection}/${ref.look}`];
    expect(stored?.value).toMatchObject({ id: ref.look, state: "live" });
    const again = await restart(studio);
    expect(again.document.recipe.layers[0]!.opacity).toBe(0.5);
    // The look's history came back with it: Undo reaches it at once (its scope is the editing context).
    expect(again.app.history()).toMatchObject({ depth: 2 });
    dispatch(again, { kind: "history.undo" });
    expect(again.document.recipe.layers[0]!.opacity).toBe(0.25);
    dispatch(again, { kind: "history.redo" });
    expect(again.document.recipe.layers[0]!.opacity).toBe(0.5);
  });

  test("each look keeps its own history scope; with no editing context Undo is unavailable, with its reason", async () => {
    const studio = await profileStudio({ looks: [{ name: "One", recipe: initialRecipe() }, { name: "Two", recipe: initialRecipe() }] });
    await studio.collection.initialize();
    const [one, two] = studio.owner.looksOf(studio.shown()!).map(look => look.id);
    dispatch(studio, { kind: "layer.setOpacity", layerId: layerId(studio), opacity: 0.3 });
    dispatch(studio, { kind: "preset.select", id: two! });
    expect(studio.document.scopeId).toBe(lookScope({ collection: studio.shown()!, look: two! }));
    expect(studio.document.recipe.layers[0]!.opacity).not.toBe(0.3);
    expect(studio.app.history()).toMatchObject({ depth: 0 });
    dispatch(studio, { kind: "preset.select", id: one! });
    expect(studio.document.recipe.layers[0]!.opacity).toBe(0.3);
    expect(studio.app.history()).toMatchObject({ depth: 1 });
    // Nothing edited yet in a fresh history service: no editing context, no Undo.
    studio.history.focus(null); studio.history.focus(null); studio.history.focus(null);
    expect(studio.app.capability({ kind: "history.undo" })).toMatchObject({ available: false, reason: NOTHING_TO_UNDO });
  });

  test("Undo naming a scope steps that one: in the 3D view Ctrl+Z undoes the look even when a creator choice was changed last", async () => {
    const studio = await profileStudio({ looks: [{ name: "One", recipe: initialRecipe() }] });
    await studio.collection.initialize();
    const look = studio.document.scopeId!;
    dispatch(studio, { kind: "layer.setOpacity", layerId: layerId(studio), opacity: 0.3 });
    // A V's creator choice changed after it: its history becomes the editing context.
    let choice = "a";
    const character = studio.history.open("character:v1", { read: () => choice, apply: values => { choice = (values as Record<string, unknown>).choice as string; return true; } });
    character.checkpoint(["choice"], { label: "Body", actionKind: "character.choose" });
    choice = "b";
    expect(studio.history.editing()).toBe("character:v1");
    // The header's Undo follows the editing context: the creator choice.
    expect(studio.app.capability({ kind: "history.undo" })).toMatchObject({ available: true });
    // The 3D view's Undo names the look it shows: the look's edit goes, the creator choice stays.
    expect(studio.app.dispatch({ kind: "history.undo", scope: look }).ok).toBe(true);
    expect(studio.document.recipe.layers[0]!.opacity).not.toBe(0.3);
    expect(choice).toBe("b");
    expect(studio.app.dispatch({ kind: "history.redo", scope: look }).ok).toBe(true);
    expect(studio.document.recipe.layers[0]!.opacity).toBe(0.3);
    // A step kept in the look's history makes it the editing context again; the V's history is still there to step.
    expect(studio.history.editing()).toBe(look);
    expect(studio.app.dispatch({ kind: "history.undo", scope: "character:v1" }).ok).toBe(true);
    expect(choice).toBe("a");
    expect(studio.document.recipe.layers[0]!.opacity).toBe(0.3);
    // A scope that isn't open has nothing to undo, with its reason.
    expect(studio.app.capability({ kind: "history.undo", scope: "look:gone/gone" })).toMatchObject({ available: false, reason: NOTHING_TO_UNDO });
  });
});

describe("another window's change to the shown look", () => {
  /** Two windows on one library showing the same look; this one (`a`) has edited it, and the other's edit reaches the library first. */
  async function raced() {
    const a = await profileStudio({ looks: [{ name: "One", recipe: initialRecipe() }] });
    await a.collection.initialize(); await a.settle();
    const ref = a.scene.look()!;
    const b = await profileStudio({ library: a.library, show: ref });
    // This window's edit is recorded in its outbox as it is made; only storing it waits.
    dispatch(a, { kind: "layer.setOpacity", layerId: layerId(a), opacity: 0.23 });
    expect(a.outbox.pendingEntries().map(entry => entry.command)).toEqual(["look.update"]);
    dispatch(b, { kind: "layer.setOpacity", layerId: layerId(b), opacity: 0.78 });
    await b.settle();
    return { a, b, ref };
  }
  const conflictValues = (studio: ProfileStudio) => {
    const [conflict] = studio.outbox.conflicts();
    type Stored = { parts: Record<string, { body: { layers: { opacity: number }[] } }> };
    const opacity = (value: unknown) => (value as Stored).parts["eye-makeup"]!.body.layers[0]!.opacity;
    return conflict ? { mine: opacity(conflict.writes[0]!.value), theirs: opacity(Object.values(conflict.current!)[0]!.value) } : null;
  };

  test("a revision check finds this window's edit pending: it meets the other window's version as a conflict", async () => {
    const { a, ref } = await raced();
    expect(await a.outbox.check()).toEqual([]);
    expect(a.document.recipe.layers[0]!.opacity).toBe(0.23);
    await a.outbox.settle();
    expect(conflictValues(a)).toEqual({ mine: 0.23, theirs: 0.78 });
    expect(a.owner.look(ref)!.conflict).not.toBeNull();
  });

  test("a read of the library (the owners loading again) finds it pending too: nothing of it is replaced (review 2, Sol's first case)", async () => {
    const { a, ref } = await raced();
    await a.owner.load();
    expect(a.document.recipe.layers[0]!.opacity).toBe(0.23);
    expect(a.owner.look(ref)!.state).toBe("live");
    await a.outbox.settle();
    expect(conflictValues(a)).toEqual({ mine: 0.23, theirs: 0.78 });
  });

  test("an edit made while Keep both reads the library joins this window's copy (review 2, Sol's second case)", async () => {
    const { a, ref } = await raced();
    await a.outbox.check(); await a.outbox.settle();
    const id = a.collection.summary().draft!.conflicts[0]!.id;
    const resolving = a.collection.execute({ kind: "resolveConflict", conflict: id, keep: "both" });
    // The resolution waits for the library; meanwhile this window edits the look again.
    dispatch(a, { kind: "layer.setOpacity", layerId: layerId(a), opacity: 0.41 });
    expect(await resolving).toMatchObject({ ok: true });
    await a.settle();
    const presets = a.collection.summary().draft!.presets, copy = presets.find(preset => preset.id !== ref.look)!;
    const opacityOf = (look: string) => (a.owner.look({ collection: ref.collection, look })!.parts as
      { "eye-makeup": { body: { layers: { opacity: number }[] } } })["eye-makeup"].body.layers[0]!.opacity;
    expect(presets).toHaveLength(2);
    expect(opacityOf(ref.look)).toBe(0.78);
    expect(opacityOf(copy.id)).toBe(0.41);
    expect(a.outbox.conflicts()).toEqual([]);
  });
});

describe("conflicts on presets and collections", () => {
  /** Two windows on one library, each having changed the shown look before the other's change reached it: a conflict in `a`. */
  async function lookConflict() {
    const a = await profileStudio({ looks: [{ name: "Smoky", recipe: initialRecipe() }] });
    await a.collection.initialize(); await a.settle();
    const ref = a.scene.look()!;
    const b = await profileStudio({ library: a.library, show: ref });
    dispatch(a, { kind: "layer.setOpacity", layerId: layerId(a), opacity: 0.23 });
    dispatch(b, { kind: "layer.setOpacity", layerId: layerId(b), opacity: 0.78 });
    await b.settle();
    await a.outbox.check(); await a.outbox.settle();
    return { a, b, ref };
  }
  const opacityIn = (studio: ProfileStudio, ref: { collection: string; look: string }) =>
    (studio.owner.look(ref)!.parts as { "eye-makeup": { body: { layers: { opacity: number }[] } } })["eye-makeup"].body.layers[0]!.opacity;

  test("the Presets panel's summary says what differs; Save version, Check, Build and export wait with the reason", async () => {
    const { a } = await lookConflict();
    const [conflict] = a.collection.summary().draft!.conflicts;
    expect(conflict).toMatchObject({ message: "You changed the preset “Smoky” here too (its makeup). Which version should it keep?", keepBoth: true });
    for (const request of [{ kind: "save" }, { kind: "saveCopy" }, { kind: "exportCollection" }, { kind: "package", action: "check" }, { kind: "package", action: "build" }] as const)
      expect(a.collection.service.capability(request)).toMatchObject({ available: false, reason: CONFLICT_FIRST });
    expect(a.collection.service.capability({ kind: "resolveConflict", conflict: "nope", keep: "mine" })).toMatchObject({ available: false, code: "missing_target" });
  });

  test("Keep mine writes this window's version; Use theirs shows the other's; Keep both keeps mine as a copy beside theirs", async () => {
    {
      const { a, ref } = await lookConflict();
      const id = a.collection.summary().draft!.conflicts[0]!.id;
      expect(await a.collection.execute({ kind: "resolveConflict", conflict: id, keep: "mine" })).toMatchObject({ ok: true });
      await a.settle();
      expect(a.collection.summary().draft!.conflicts).toEqual([]);
      expect(a.document.recipe.layers[0]!.opacity).toBe(0.23);
      expect(opacityIn(a, ref)).toBe(0.23);
      expect(a.collection.service.capability({ kind: "save" })).toMatchObject({ available: true });
    }
    {
      const { a, ref } = await lookConflict();
      const id = a.collection.summary().draft!.conflicts[0]!.id;
      expect(await a.collection.execute({ kind: "resolveConflict", conflict: id, keep: "theirs" })).toMatchObject({ ok: true });
      await a.settle();
      expect(a.collection.summary().draft!.conflicts).toEqual([]);
      expect(a.document.recipe.layers[0]!.opacity).toBe(0.78);
      expect(opacityIn(a, ref)).toBe(0.78);
    }
    {
      const { a, ref } = await lookConflict();
      const id = a.collection.summary().draft!.conflicts[0]!.id;
      expect(await a.collection.execute({ kind: "resolveConflict", conflict: id, keep: "both" })).toMatchObject({ ok: true });
      await a.settle();
      const presets = a.collection.summary().draft!.presets;
      expect(presets).toHaveLength(2);
      expect(opacityIn(a, ref)).toBe(0.78);
      const copy = presets.find(preset => preset.id !== ref.look)!;
      expect(opacityIn(a, { collection: ref.collection, look: copy.id })).toBe(0.23);
    }
  });

  test("a conflict on the collection itself (its name) offers Keep mine and Use theirs only", async () => {
    const a = await profileStudio({ looks: [{ name: "Smoky", recipe: initialRecipe() }] });
    await a.collection.initialize(); await a.settle();
    const b = await profileStudio({ library: a.library, show: a.scene.look() });
    dispatch(a, { kind: "collection.rename", name: "Mine" });
    dispatch(b, { kind: "collection.rename", name: "Theirs" });
    await b.settle();
    await a.outbox.settle();
    const [conflict] = a.collection.summary().draft!.conflicts;
    expect(conflict).toMatchObject({ keepBoth: false });
    expect(conflict!.message).toContain("its name");
    expect(a.collection.service.capability({ kind: "resolveConflict", conflict: conflict!.id, keep: "both" })).toMatchObject({ available: false });
    expect(await a.collection.execute({ kind: "resolveConflict", conflict: conflict!.id, keep: "theirs" })).toMatchObject({ ok: true });
    await a.settle();
    expect(a.collection.summary().draft).toMatchObject({ name: "Theirs", conflicts: [] });
  });
});

describe("presets", () => {
  test("add, copy, rename, move, remove and restore are owner commands on the shown collection; the scene follows the preset chosen", async () => {
    const studio = await profileStudio();
    await studio.collection.initialize();
    const collection = studio.shown()!, first = studio.scene.look()!.look;
    dispatch(studio, { kind: "layer.setOpacity", layerId: layerId(studio), opacity: 0.4 });
    dispatch(studio, { kind: "preset.edit", command: { kind: "add" } });
    const added = studio.scene.look()!.look;
    expect(added).not.toBe(first);
    expect(studio.collection.summary().draft!.presets.map(p => p.name)).toEqual(["Look", "Preset 2"]);
    // A new preset starts with one layer, ready to shape (release-readiness-audit.md item 12), and an empty history.
    expect(studio.document.recipe.layers).toHaveLength(1);
    expect(studio.app.history()).toMatchObject({ depth: 0 });
    dispatch(studio, { kind: "preset.select", id: first });
    // The copy carries the look as edited (written first), named "(copy)", right after it; its history starts fresh.
    dispatch(studio, { kind: "preset.edit", command: { kind: "copy", id: first } });
    const copy = studio.scene.look()!.look;
    expect(studio.collection.summary().draft!.presets.map(p => p.name)).toEqual(["Look", "Look (copy)", "Preset 2"]);
    expect(studio.document.recipe.layers[0]!.opacity).toBe(0.4);
    expect(studio.app.history()).toMatchObject({ depth: 0 });
    dispatch(studio, { kind: "preset.edit", command: { kind: "rename", id: copy, name: "Smoky" } });
    dispatch(studio, { kind: "preset.edit", command: { kind: "move", id: copy, to: 2 } });
    expect(studio.collection.summary().draft!.presets.map(p => p.name)).toEqual(["Look", "Preset 2", "Smoky"]);
    // Removing the shown preset shows the one that takes its place; Restore puts it back where it stood.
    dispatch(studio, { kind: "preset.edit", command: { kind: "remove", id: added } });
    expect(studio.collection.summary().draft).toMatchObject({ presets: [{ name: "Look" }, { name: "Smoky" }], removed: [{ id: added, name: "Preset 2", index: 1 }] });
    expect(studio.scene.look()!.look).toBe(copy);
    dispatch(studio, { kind: "preset.edit", command: { kind: "restore" } });
    expect(studio.collection.summary().draft!.presets.map(p => p.name)).toEqual(["Look", "Preset 2", "Smoky"]);
    expect(studio.scene.look()!.look).toBe(added);
    expect(studio.app.capability({ kind: "preset.edit", command: { kind: "restore" } })).toMatchObject({ available: false });
    // Everything reaches the library, and a restart shows the same collection.
    const again = await restart(studio);
    await again.collection.initialize();
    expect(again.collection.summary().draft!.presets.map(p => p.name)).toEqual(["Look", "Preset 2", "Smoky"]);
    expect(again.owner.collection(collection)!.looks).toHaveLength(3);
    dispatch(again, { kind: "preset.select", id: first });
    expect(again.document.recipe.layers[0]!.opacity).toBe(0.4);
  });

  test("removing the last preset keeps its collection shown, across a restart, and Restore brings the preset back as it was", async () => {
    const studio = await profileStudio({ looks: [{ name: "Only", recipe: initialRecipe() }] });
    await studio.collection.initialize();
    const collection = studio.shown()!, only = studio.scene.look()!;
    dispatch(studio, { kind: "layer.setOpacity", layerId: layerId(studio), opacity: 0.42 });
    dispatch(studio, { kind: "preset.edit", command: { kind: "remove", id: only.look } });
    // The scene still names the removed look: the collection is the one shown, empty, and the editor refuses edits with the reason.
    expect(studio.scene.look()).toEqual(only);
    expect(studio.shown()).toBe(collection);
    expect(studio.collection.summary().draft!.presets).toEqual([]);
    expect(studio.document.recipe.layers).toEqual([]);
    expect(studio.app.capability({ kind: "layer.add" } as never)).toMatchObject({ available: false });
    // A restart shows the same, empty collection, and its removed preset is still there to restore.
    const again = await restart(studio);
    await again.collection.initialize();
    expect(again.shown()).toBe(collection);
    expect(again.owner.list().length).toBe(1);
    expect(again.owner.restorable(collection).map(item => item.look)).toEqual([only.look]);
    dispatch(again, { kind: "preset.edit", command: { kind: "restore" } });
    expect(again.scene.look()).toEqual(only);
    expect(again.collection.summary().draft!.presets.map(p => p.name)).toEqual(["Only"]);
    expect(again.document.recipe.layers[0]!.opacity).toBe(0.42);
    dispatch(again, { kind: "layer.setOpacity", layerId: layerId(again), opacity: 0.5 });
    expect(again.document.recipe.layers[0]!.opacity).toBe(0.5);
  });

  test("a recipe file becomes a preset of its own, shown at once", async () => {
    const studio = await profileStudio();
    await studio.collection.initialize();
    studio.collection.importRecipe(initialRecipe(), "Imported");
    expect(studio.collection.summary().draft!.presets.map(p => p.name)).toEqual(["Look", "Imported"]);
    expect(studio.document.recipe.layers).toHaveLength(initialRecipe().layers.length);
  });
});

describe("Save version, Check and Build", () => {
  test("Save version writes a named version from the library's snapshot; the collection then reads as saved until it changes", async () => {
    const studio = await profileStudio();
    expect((await studio.collection.initialize()).ok).toBe(true);
    expect(studio.collection.persistence()).toMatchObject({ baseline: "none", dirty: true });
    const saved = await studio.collection.execute({ kind: "save" });
    expect(saved).toMatchObject({ ok: true, result: { kind: "saved", collection: { revision: 1 } } });
    expect(studio.library.collections.list()).toMatchObject([{ id: studio.shown(), name: "Current", revision: 1, count: 1 }]);
    expect(studio.collection.summary().draft).toMatchObject({ revision: 1 });
    expect(studio.collection.persistence()).toMatchObject({ baseline: "known", dirty: false });
    dispatch(studio, { kind: "layer.setOpacity", layerId: layerId(studio), opacity: 0.2 });
    expect(studio.collection.persistence()).toMatchObject({ dirty: true, dirtyPresets: [studio.scene.look()!.look] });
    expect(await studio.collection.execute({ kind: "save" })).toMatchObject({ ok: true, result: { collection: { revision: 2 } } });
    const stored = studio.library.collections.get(studio.shown()!);
    expect(JSON.stringify(stored.collection.presets[0]!.parts)).toContain("0.2");
    // A restart knows which version it was saved as, and reads that version's content to compare.
    const again = await restart(studio);
    await again.collection.initialize();
    expect(again.collection.persistence()).toMatchObject({ savedRevision: 2, baseline: "known", dirty: false });
  });

  test("Check and Build send the collection's snapshot, the shown look as edited; the result is current until the next change", async () => {
    const studio = await profileStudio({ looks: [{ name: "A", recipe: initialRecipe() }, { name: "B", recipe: initialRecipe() }] });
    await studio.collection.initialize();
    dispatch(studio, { kind: "layer.setOpacity", layerId: layerId(studio), opacity: 0.6 });
    const check = await studio.files.execute({ kind: "package.check" });
    expect(check.ok).toBe(true);
    const sent = studio.packageInput() as { id: string; presets: { name: string }[] };
    expect([sent.id, sent.presets.map(p => p.name)]).toEqual([studio.shown()!, ["A", "B"]] as never);
    expect(JSON.stringify(sent)).toContain("0.6");
    expect(studio.files.snapshot().package?.freshness).toBe("current");
    const build = await studio.files.execute({ kind: "package.build" });
    expect(build.ok).toBe(true);
    dispatch(studio, { kind: "layer.setOpacity", layerId: layerId(studio), opacity: 0.7 });
    expect(studio.files.snapshot().package?.freshness).toBe("stale");
    // Nothing is saved as a version by Check or Build.
    expect(studio.library.collections.list()).toEqual([]);
  });
});

describe("opening, importing and copies", () => {
  test("importing makes a new collection (nothing replaced); Undo import shows the one before; the import is a recent draft until saved", async () => {
    const studio = await profileStudio();
    await studio.collection.initialize();
    const before = studio.shown()!;
    const text = JSON.stringify({ schema: "xfs/collection-2", id: crypto.randomUUID(), name: "Imported", presets: [
      { id: crypto.randomUUID(), name: "Gift", revision: 1, parts: studio.owner.look(studio.scene.look()!)!.parts }] });
    expect(await studio.collection.execute({ kind: "import", text, bytes: text.length })).toMatchObject({ ok: true });
    expect(studio.collection.summary().draft).toMatchObject({ name: "Imported", presets: [{ name: "Gift" }], previous: { id: before } });
    expect(studio.owner.collection(before)).not.toBeNull();
    dispatch(studio, { kind: "collection.undoOpen" });
    expect(studio.shown()).toBe(before);
    expect(studio.collection.summary().draft!.recovery).toMatchObject([{ name: "Imported", presets: 1, saved: "never" }]);
    const imported = studio.collection.summary().draft!.recovery[0]!.id;
    dispatch(studio, { kind: "collection.undoOpen", draft: imported });
    expect(studio.shown()).toBe(imported);
  });

  test("collections made with the profile's membership stay within the write limit: imports of 63, 64 and 130 looks, and their copies", async () => {
    const studio = await profileStudio({ profile: true });
    await studio.collection.initialize();
    const parts = studio.owner.look(studio.scene.look()!)!.parts;
    for (const count of [63, 64, 130]) {
      const names = Array.from({ length: count }, (_, i) => `Look ${i + 1}`);
      const text = JSON.stringify({ schema: "xfs/collection-2", id: crypto.randomUUID(), name: `Set of ${count}`, presets: names.map(name =>
        ({ id: crypto.randomUUID(), name, revision: 1, parts })) });
      expect(await studio.collection.execute({ kind: "import", text, bytes: text.length })).toMatchObject({ ok: true });
      const imported = studio.shown()!;
      // Every look, in order, and the profile lists the collection.
      expect(studio.owner.looksOf(imported).map(look => look.name)).toEqual(names);
      expect(studio.profiles!.profile(studio.profile!)!.collections).toContain(imported);
      // Save as new collection makes a copy the same way.
      expect(await studio.collection.execute({ kind: "saveCopy" })).toMatchObject({ ok: true });
      const copy = studio.shown()!;
      expect(copy).not.toBe(imported);
      expect(studio.owner.looksOf(copy).map(look => look.name)).toEqual(names);
      expect(studio.profiles!.profile(studio.profile!)!.collections).toContain(copy);
    }
    expect(await studio.settle()).toBe(true);
    expect(studio.outbox.conflicts()).toEqual([]);
  });

  test("opening a version saved before it had a working copy makes one from it; Save as new collection copies under fresh IDs", async () => {
    const studio = await profileStudio();
    await studio.collection.initialize();
    const id = crypto.randomUUID(), look = crypto.randomUUID();
    studio.library.collections.save({ collection: { schema: "xfs/collection-2", id, name: "Old", presets: [
      { id: look, name: "Old look", revision: 1, parts: studio.owner.look(studio.scene.look()!)!.parts }] } });
    await studio.collection.execute({ kind: "refresh" });
    expect(await studio.collection.execute({ kind: "open", id })).toMatchObject({ ok: true });
    expect(studio.scene.look()).toEqual({ collection: id, look });
    expect(studio.collection.summary().draft).toMatchObject({ id, name: "Old", revision: 1 });
    expect(studio.collection.persistence()).toMatchObject({ baseline: "known", dirty: false });
    const copy = await studio.collection.execute({ kind: "saveCopy" });
    expect(copy).toMatchObject({ ok: true, result: { collection: { collection: { name: "Old 2" }, revision: 1 } } });
    expect(studio.shown()).not.toBe(id);
    expect(studio.scene.look()!.look).not.toBe(look);
    expect(studio.library.collections.list().map(item => item.name).sort()).toEqual(["Old", "Old 2"]);
  });

  test("Export collection saves a version first and exports the library's snapshot", async () => {
    const studio = await profileStudio();
    await studio.collection.initialize();
    const outcome = await studio.collection.execute({ kind: "exportCollection" });
    expect(outcome).toMatchObject({ ok: true, result: { kind: "export", name: "xfs.collection.json" } });
    const json = JSON.parse((outcome as { result: { json: string } }).result.json);
    expect(json.id).toBe(studio.shown());
    expect(studio.library.collections.list()).toMatchObject([{ revision: 1 }]);
  });
});

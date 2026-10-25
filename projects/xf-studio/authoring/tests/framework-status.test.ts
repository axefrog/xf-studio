// Settings › Game › Mod frameworks (the model, the keep-current watcher, the named release pages and the verification specimens). The
// panel itself is exercised over the light DOM in tests/ui-polish-dom.test.ts.
import { expect, test } from "bun:test";
import { isProjectLink, PROJECT_LINKS } from "../src/app/project-links";
import { frameworkInputKey, watchFrameworkInputs, type FrameworkWatchDetection, type FrameworkWatchSetup } from "../src/installation/framework-check-watch";
import { FRAMEWORK_LINK_URLS, FRAMEWORKS, frameworkLinkId } from "../src/installation/framework-catalogue";
import { FRAMEWORK_SAMPLE_STATES, frameworkCheckFor, frameworkCheckSample, frameworkCheckUnreadable } from "../src/installation/framework-fixtures";
import { frameworkStatusView, FRAMEWORKS_ALL_GOOD, FRAMEWORKS_CHECKING, FRAMEWORKS_UNCHECKED } from "../src/installation/framework-status";
import { frameworkStatusVerification } from "../src/compose/framework-status-verification";
import { frameworkNote } from "../src/studio-ui/panels/framework-group";

/** The Mod package card's line for a view (the card reads the application's derived status from the frame). */
const pointer = (status: ReturnType<typeof frameworkStatusView>) => frameworkNote({ installDetection: { frameworkStatus: status } } as never);

const view = (check = frameworkCheckFor("all-ok"), extra: { checking?: boolean; gameChosen?: boolean } = {}) =>
  frameworkStatusView({ gameChosen: true, check, checking: false, ...extra });
const row = (v: ReturnType<typeof view>, id: string) => v.rows.find(item => item.id === id)!;

test("all fine: every framework has a row, the rows fold under one line, and nothing is a problem", () => {
  const v = view();
  expect(v).toMatchObject({ shown: true, tone: "ready", line: FRAMEWORKS_ALL_GOOD, attention: 0, foldable: true, checking: false });
  // Needed frameworks first, then the ones the mod doesn't use, each with its version and where the game takes it from.
  expect(v.rows.map(item => [item.name, item.status, item.badge.text, item.facts.join(" · ")])).toEqual([
    ["ArchiveXL", "ok", "OK", "1.27.5 · from the Mod Organizer 2 mod “ArchiveXL”"],
    ["RED4ext", "ok", "OK", "1.30.0 · from the game folder"],
    ["redscript", "ok", "OK", "0.5.31 · from the Mod Organizer 2 mod “redscript” · version from Mod Organizer's list"],
    ["TweakXL", "not-needed", "Not needed for what you build", "1.11.5 · from the Mod Organizer 2 mod “TweakXL”"],
    ["Codeware", "not-needed", "Not needed for what you build", "1.20.6 · from the Mod Organizer 2 mod “Codeware”"],
    ["Cyber Engine Tweaks", "not-needed", "Not needed for what you build", "1.37.1 · from the game folder"]]);
  expect(v.rows.every(item => item.message === null && item.links.length === 0 && item.notes.length === 0)).toBe(true);
  expect(pointer(v)).toBeNull();
});

test("too old: the badge names the minimum, the row says what to do, and the release pages are named links", () => {
  const v = view(frameworkCheckFor("too-old"));
  expect(v).toMatchObject({ tone: "attention", line: "1 framework needs attention", attention: 1, foldable: false });
  const archive = row(v, "archivexl");
  expect(archive).toMatchObject({ status: "too-old", badge: { text: "Too old (minimum 1.27.3)", tone: "warning" }, facts: ["1.26.3", "from the Mod Organizer 2 mod “ArchiveXL”"] });
  expect(archive.message).toBe("XF Eye Artistry needs ArchiveXL 1.27.3 or newer; you have 1.26.3. Update it in Mod Organizer 2 with the latest release from Nexus Mods or GitHub.");
  expect(archive.links).toEqual([{ id: "framework-archivexl-nexus", label: "Nexus Mods", name: "ArchiveXL on Nexus Mods" },
    { id: "framework-archivexl-github", label: "GitHub", name: "ArchiveXL on GitHub" }]);
  // The others are untouched.
  expect(v.rows.filter(item => item.status === "ok").map(item => item.name)).toEqual(["RED4ext", "redscript"]);
  expect(pointer(v)).toBe("A mod framework needs attention before your mod works in the game. Settings › Game › Mod frameworks says which, and where to get each.");
});

test("missing: Missing, with the install sentence and the release pages; two problems are counted", () => {
  const v = view(frameworkCheckFor("missing"));
  expect(row(v, "redscript")).toMatchObject({ status: "missing", badge: { text: "Missing", tone: "warning" }, facts: ["Not installed"],
    message: "XF Eye Artistry needs redscript 0.5.31 or newer, and it isn't installed in this profile. Install it in Mod Organizer 2 from Nexus Mods or GitHub." });
  expect(row(v, "redscript").links.map(link => link.id)).toEqual(["framework-redscript-nexus", "framework-redscript-github"]);
  const two = view(frameworkCheckSample({ redscript: null, red4ext: { version: "1.28.0" } }));
  expect(two).toMatchObject({ line: "2 frameworks need attention", attention: 2 });
  expect(pointer(two)).toContain("Mod frameworks need attention");
});

test("a version that can't be read is its own status; a framework the mod doesn't use is never a problem, installed or not", () => {
  const unreadable = frameworkCheckSample();
  const archive = unreadable.routes[0]!.frameworks.find(item => item.framework === "archivexl")!;
  const blank = { ...unreadable, routes: [{ ...unreadable.routes[0]!, frameworks: unreadable.routes[0]!.frameworks.map(item => item === archive ? { ...item, version: null, versionSource: null, fileVersion: null } : item),
    verdicts: unreadable.routes[0]!.verdicts.map(item => item.framework === "archivexl" ? { ...item, status: "unknown-version" as const, installed: null,
      message: "We found ArchiveXL but couldn't tell which version it is. XF Eye Artistry needs ArchiveXL 1.27.3 or newer; if you're not sure, reinstall the latest release from Nexus Mods or GitHub." } : item) }] };
  const v = view(blank);
  expect(row(v, "archivexl")).toMatchObject({ status: "unreadable", badge: { text: "Version unknown", tone: "warning" }, facts: ["Version unknown", "from the Mod Organizer 2 mod “ArchiveXL”"] });
  expect(row(v, "archivexl").links).toHaveLength(2);
  expect(v.attention).toBe(1);
  // TweakXL and Codeware absent: still not a problem.
  const none = view(frameworkCheckSample({ tweakxl: null, codeware: null }));
  expect(none).toMatchObject({ attention: 0, tone: "ready", foldable: true });
  expect(row(none, "tweakxl")).toMatchObject({ status: "not-needed", facts: ["Not installed"], message: null, links: [] });
});

test("a second copy Mod Organizer doesn't use is a note under its row, never a problem or a button", () => {
  const v = view(frameworkCheckFor("hidden-duplicate"));
  expect(v).toMatchObject({ attention: 0, foldable: true });
  expect(row(v, "archivexl").notes).toEqual([`ArchiveXL is installed more than once in this profile. Mod Organizer uses the copy in "ArchiveXL"; "Old ArchiveXL" is not used.`]);
  expect(row(v, "archivexl").links).toEqual([]);
});

test("not shown without a game folder; the line says when it hasn't been checked, is checking, or couldn't read the route", () => {
  expect(view(frameworkCheckFor("all-ok"), { gameChosen: false })).toMatchObject({ shown: false, rows: [] });
  expect(frameworkStatusView({ gameChosen: true, check: undefined, checking: false })).toMatchObject({ shown: true, tone: "info", line: FRAMEWORKS_UNCHECKED, rows: [], foldable: false });
  expect(frameworkStatusView({ gameChosen: true, check: undefined, checking: true })).toMatchObject({ tone: "checking", line: FRAMEWORKS_CHECKING, rows: [] });
  const unreadable = view(frameworkCheckUnreadable());
  expect(unreadable).toMatchObject({ tone: "info", rows: [], line: "Choose your Mod Organizer 2 folder and profile in Settings › Game." });
  expect(pointer(unreadable)).toBeNull();
});

test("checking keeps the earlier rows and their count, so nothing jumps; only the line changes", () => {
  const before = view(frameworkCheckFor("too-old"));
  const during = view(frameworkCheckFor("too-old"), { checking: true });
  expect(during).toMatchObject({ tone: "checking", line: FRAMEWORKS_CHECKING, checking: true, attention: 1, foldable: false });
  expect(during.rows).toEqual(before.rows);
  expect(pointer(during)).toBe(pointer(before));
});

test("the route the person launches with decides the rows", () => {
  const mo2 = frameworkCheckFor("too-old");
  const direct = { ...mo2, selectedRoute: "direct" as const, routes: [{ ...mo2.routes[0]!, route: "direct" as const }, ...mo2.routes] };
  // Selected "direct" picks the first route; the verdicts read as the route was reported.
  expect(view(direct).attention).toBe(1);
  expect(frameworkStatusView({ gameChosen: true, check: { ...mo2, selectedRoute: "direct" }, checking: false }).rows).toHaveLength(6);
});

test("every framework has a Nexus Mods and a GitHub release page, named and opened by id (the page never supplies a URL)", () => {
  for (const definition of FRAMEWORKS) for (const link of definition.links) {
    const id = frameworkLinkId(definition.id, link.label);
    expect(isProjectLink(id)).toBe(true);
    expect(PROJECT_LINKS[id]).toBe(link.url);
    expect(FRAMEWORK_LINK_URLS[id]).toBe(link.url);
  }
  expect(PROJECT_LINKS["framework-archivexl-github"]).toBe("https://github.com/psiberx/cp2077-archive-xl/releases/latest");
  expect(PROJECT_LINKS["framework-red4ext-nexus"]).toBe("https://www.nexusmods.com/cyberpunk2077/mods/2380");
  expect(Object.keys(FRAMEWORK_LINK_URLS)).toHaveLength(FRAMEWORKS.length * 2);
  expect(isProjectLink("framework-archivexl-evil")).toBe(false);
  expect(isProjectLink("https://example.com")).toBe(false);
});

// ---- Keeping the check current ----

function watched(fields: Record<string, unknown> | null) {
  const setupListeners = new Set<() => void>(), detectionListeners = new Set<() => void>();
  let current = fields, busy = false;
  const dispatched: string[] = [];
  const setup: FrameworkWatchSetup = { snapshot: () => ({ view: current ? { fields: current } : undefined }),
    subscribe: listener => { setupListeners.add(listener); return () => { setupListeners.delete(listener); }; } };
  const detection: FrameworkWatchDetection = { capability: () => ({ available: !busy }),
    dispatch: async action => { dispatched.push(action.kind); return { ok: true }; },
    subscribe: listener => { detectionListeners.add(listener); return () => { detectionListeners.delete(listener); }; } };
  return { setup, detection, dispatched,
    set: (next: Record<string, unknown> | null) => { current = next; for (const listener of setupListeners) listener(); },
    busy: (on: boolean) => { busy = on; if (!on) for (const listener of detectionListeners) listener(); } };
}
const settings = (over: Record<string, unknown> = {}) => ({ gameRoot: "D:\\Game", launchRoute: "mo2", mo2Root: "D:\\MO2", mo2ProfileId: "Play", ...over });

test("the check runs once the settings are known, again when what it reads changes, and not for anything else", () => {
  const w = watched(null);
  const stop = watchFrameworkInputs(w.setup, w.detection);
  expect(w.dispatched).toEqual([]);
  w.set(settings());
  expect(w.dispatched).toEqual(["detect.frameworkVersions"]);
  // Another setting (the extra mod folder, WolvenKit) isn't something the check reads.
  w.set(settings({ wolvenKitCli: "D:\\W.exe", manualModRoot: "D:\\Mods" }));
  expect(w.dispatched).toHaveLength(1);
  w.set(settings({ mo2ProfileId: "Testing" }));
  w.set(settings({ launchRoute: "direct", mo2ProfileId: "Testing" }));
  w.set(settings({ gameRoot: "E:\\Other" }));
  expect(w.dispatched).toHaveLength(4);
  stop();
  w.set(settings({ gameRoot: "F:\\Later" }));
  expect(w.dispatched).toHaveLength(4);
  expect(frameworkInputKey(settings())).toBe(frameworkInputKey({ ...settings(), manualModRoot: "x" }));
});

test("a change that arrives while detection is busy is checked when detection finishes; no game folder asks for nothing", () => {
  const w = watched(settings({ gameRoot: null }));
  watchFrameworkInputs(w.setup, w.detection);
  expect(w.dispatched).toEqual([]);
  w.busy(true);
  w.set(settings());
  expect(w.dispatched).toEqual([]);
  w.busy(false);
  expect(w.dispatched).toEqual(["detect.frameworkVersions"]);
  // Choosing no folder again, then one: the same folder is a change after nothing was chosen.
  w.set(settings({ gameRoot: null }));
  w.set(settings());
  expect(w.dispatched).toHaveLength(2);
});

// ---- Verification specimens ----

test("every verification state is a check the real wording produces, and the hook answers the framework request only", async () => {
  for (const state of FRAMEWORK_SAMPLE_STATES.filter(name => name !== "no-game")) expect(frameworkCheckFor(state).schema).toBe("xfs/framework-version-check-1");
  expect(view(frameworkCheckFor("all-ok")).attention).toBe(0);
  expect(view(frameworkCheckFor("too-old")).attention).toBe(1);
  expect(view(frameworkCheckFor("missing")).attention).toBe(1);
  expect(view(frameworkCheckFor("hidden-duplicate")).rows.flatMap(item => item.notes)).toHaveLength(1);

  const updates: unknown[] = [];
  let fields: { gameRoot: string | null } = { gameRoot: "D:\\Game" }, busy: string | null = null;
  const dispatched: string[] = [];
  const hook = frameworkStatusVerification({
    setup: { snapshot: () => ({ view: { fields } }) as never, dispatch: async action => { updates.push(action); fields = { gameRoot: (action as { fields: { gameRoot: string | null } }).fields.gameRoot }; return { ok: true }; } },
    detection: () => ({ snapshot: () => ({ busy }) as never, dispatch: async action => { dispatched.push(action.kind); return { ok: true }; } }) });
  // Not showing a state yet: the real host is asked.
  expect(hook.transport("frameworks")).toBeUndefined();
  await hook.state("too-old");
  expect(dispatched).toEqual(["detect.frameworkVersions"]);
  expect(((await hook.transport("frameworks"))!.data as unknown as { routes: unknown[] }).routes).toHaveLength(1);
  expect(hook.transport("games")).toBeUndefined();
  // No game folder clears the verification workspace's setting; the next state puts it back.
  await hook.state("no-game");
  expect(fields.gameRoot).toBeNull();
  expect(hook.transport("frameworks")).toBeUndefined();
  await hook.state("all-ok");
  expect(fields.gameRoot).toBe("D:\\Game");
  // Checking holds its request open until released, then answers with the state that showed last.
  await hook.state("checking");
  let answered = false;
  const pending = hook.transport("frameworks")!.then(answer => { answered = true; return answer; });
  await Promise.resolve();
  expect(answered).toBe(false);
  hook.release();
  expect(((await pending).data as unknown as { routes: { verdicts: { status: string }[] }[] }).routes[0]!.verdicts.every(item => item.status === "ok")).toBe(true);
  await expect(hook.state("nonsense" as never)).rejects.toThrow("Unknown state");
  busy = null;
});

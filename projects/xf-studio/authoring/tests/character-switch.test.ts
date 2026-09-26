import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CharacterDetailActions, type CharacterDetailPort, type HostCharacterState } from "../src/character-detail-actions";
import { CHARACTER_REQUEST_SCHEMA, characterRequestFor, characterRequestFromSave, type CharacterRequest } from "../src/character-detail-request";
import { prepareCharacterDetails } from "../src/character-detail-service";
import { depotHash } from "../src/depot-path";
import type { ExportedGeometry, ExportedMask, ExportedTexture, GameAssetExporter } from "../src/game-asset-export";
import { encodePng } from "../src/png";
import { CHARACTER_DETAIL_SCHEMA, type CharacterDetail } from "../src/render-detail";
import { SavedAppearanceActions, type SavedAppearanceResult } from "../src/saved-appearance-actions";
import type { SavedV } from "../src/save-reader";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { detailFixture, FACE, P, REQUEST_A, REQUEST_B } from "./character-detail-fixtures";
import { STUDIO_COMPOSITION } from "../src/compose/studio-registry";
import { freshWorkspace } from "./fixtures/eye-region";

// Application-level save switching (A → B → A) over records the real preparation produced from the
// synthetic installation (character-detail-fixtures.ts), never from the private saves.

const png = encodePng({ width: 1, height: 1, data: new Uint8Array([10, 20, 30, 255]) }, { alpha: true });
function exporter(root: string): GameAssetExporter {
  let n = 0;
  return { open() {
    const dir = join(root, `e${n++}`); mkdirSync(dir, { recursive: true });
    const file = (path: string, ext: string, bytes: Uint8Array | string) => { const f = join(dir, `${depotHash(path)}.${ext}`); writeFileSync(f, bytes); return f; };
    return { tool: { key: "t", label: "Test" }, present: () => null, close() {},
      geometry: async paths => new Map(paths.map((p): [string, ExportedGeometry] => [p, { depotPath: p, hash: depotHash(p), raw: "", rawSha256: "",
        glb: file(p, "glb", `glb ${p}`), glbSha256: "", materials: null, materialsSha256: null, complete: true, cached: false }])),
      textures: async paths => new Map(paths.map((p): [string, ExportedTexture] => [p, { depotPath: p, hash: depotHash(p), png: file(p, "png", png), pngSha256: "", cached: false }])),
      masks: async paths => new Map(paths.map((p): [string, ExportedMask] => [p, { depotPath: p, hash: depotHash(p), layers: [file(p, "png", png)], cached: false }])) };
  } };
}

/** A save-shaped V from a request (what the save reader would decode for it). */
const savedV = (request: Extract<CharacterRequest, { source: "save" }>, morphs: { region: string; target: string }[]): SavedV => ({
  schema: "eye-artistry/saved-v-1", saveVersion: 1, gameVersion: 2310, presetVersion: 12, isMale: false, brainIsMale: false,
  groups: { head: [...new Set(request.appearances.map(a => a.group))].map(name => ({ name,
    appearances: request.appearances.filter(a => a.group === name).map(a => ({ resourceHash: a.app, definition: a.definition, name: a.option, censorFlag: 0, censorAction: 0 })),
    morphs: name === "TPP" ? morphs.map(m => ({ ...m, censorFlag: 0, censorAction: 0 })) : [] })), arms: [], body: [] },
  perspectives: [], tags: [], evidence: { nodeName: "appearance", nodeBytes: 1, bytesRead: 1, trailingBytes: 0, chunks: 1, decompressedBytes: 1 } } as SavedV);

test("switching A → B → A replaces the whole character, and the makeup draft and library are untouched", async () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-switch-"));
  try {
    const records = new Map<string, CharacterDetail>();
    const prepare = async (request: CharacterRequest) => {
      const result = await prepareCharacterDetails({ request, route: { gameRoot: root, launchRoute: "mo2", wolvenKitCli: "wk" }, storeRoot: join(root, "store"),
        resolverCache: join(root, "cache"), exporter: exporter(root), open: () => detailFixture().installation() });
      records.set(result.recordFile, result.record);
      return result.recordFile;
    };
    const A = savedV(REQUEST_A as Extract<CharacterRequest, { source: "save" }>, [{ region: "eyes", target: "h091" }, { region: "nose", target: "h012" }]);
    const B = savedV(REQUEST_B as Extract<CharacterRequest, { source: "save" }>, [{ region: "mouth", target: "h113" }]);
    // The fixture-built saves round-trip to the same requests the resolver fixtures use.
    expect(characterRequestFromSave(A)).toMatchObject({ appearances: REQUEST_A.source === "save" ? REQUEST_A.appearances : [] });

    // The scene: what is drawn for the character right now.
    const scene = { details: [] as string[], skin: "", morphs: [] as string[], eyes: "", face: [] as string[] };
    let holdB: (() => void) | null = null;
    const port: CharacterDetailPort = {
      async request(request, signal) {
        const record = await prepare(request);
        const key = JSON.stringify(request);
        // B's preparation can be held open to test superseding.
        if (holdB && request.source === "save" && request.appearances.some(a => a.option === "eyebrows_color2")) {
          await new Promise<void>(resolve => { holdB = resolve; signal.addEventListener("abort", () => resolve()); });
        }
        return { key, phase: "ready", message: "", progress: null, record } satisfies HostCharacterState;
      },
      async poll(key) { return { key, phase: "unknown", message: "", progress: null, record: null }; },
      async show(file) {
        const record = records.get(file)!;
        scene.details = record.components.map(c => `${c.slot}:${c.option}:${c.geometry.depotPath}`);
        // The skin the head shows: its chunk material, tone tint and albedo.
        const skin = record.components.find(c => c.slot === "skin")?.materials[0];
        scene.skin = skin ? `${skin.name}|${skin.colours.TintColor?.join(",")}|${skin.textures.Albedo?.depotPath}` : "";
        // The eyes the scene draws: the eye colour, its eyeball's template and albedo, and the shell beside it.
        const eyes = record.components.find(c => c.slot === "eyes");
        scene.eyes = eyes ? eyes.materials.map(m => `${m.template}|${m.textures.Albedo?.depotPath ?? m.textures.Mask?.depotPath}`).join(";") +
          `|${eyes.definition}` : "";
        // The face decals the scene draws, in order: each choice and its chunks' colours and priorities.
        scene.face = record.components.filter(c => c.slot === "face").map(c =>
          `${c.definition}|${c.materials.map(m => `${m.colours.DiffuseColor?.join(",") ?? "-"}@${m.materialPriority ?? "-"}`).join(";")}`);
        return { slots: record.slots };
      },
      clear() { scene.details = []; scene.skin = ""; scene.eyes = ""; scene.face = []; },
      async wait() {},
    };
    const saved = new SavedAppearanceActions({ apply(v): SavedAppearanceResult {
      const tpp = v.groups.head.find(g => g.name === "TPP")!;
      // The renderer resets every morph before applying the new V; the eyes and piercings come with the record.
      scene.morphs = tpp.morphs.map(m => `${m.target}_${m.region}`);
      return { applied: scene.morphs, appearanceReferences: tpp.appearances.length };
    } });
    const workspace = freshWorkspace();
    const core = createTrustedAuthoringCore(workspace, { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
    const draftBefore = JSON.stringify(core.document.export()), libraryBefore = JSON.stringify(workspace.collections);

    const details = new CharacterDetailActions(port);
    const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 1)); };
    // The composition makes the shown details follow the V (browser-head-attachment.ts, through the character context).
    const follow = () => { void details.setCharacter(characterRequestFor(saved.snapshot().savedV)); };
    const stop = saved.subscribe(follow);
    follow();
    await settle();
    expect(details.snapshot().source).toBe("default");

    saved.dispatch({ kind: "savedV.restore", value: A });
    await settle();
    const shownA = [...scene.details];
    expect(shownA.map(d => d.split(":")[0])).toEqual(["skin", "face", "face", "brows", "lashes", "hair", "eyes", "piercings"]);
    const skinA = scene.skin, eyesA = scene.eyes, faceA = [...scene.face];
    // A's own lipstick colour and blush (two chunks), both at the vanilla priority.
    expect(faceA).toEqual([`${FACE.lipsRed}|106,40,40,255@EMP_Normal`, `${FACE.cheeksRed}|186,20,40,255@EMP_Normal;186,20,40,255@EMP_Normal`]);
    expect(skinA).toBe(`pale|171,155,150,255|${P.skinD1}`);
    expect(eyesA).toBe(`${P.eyeGradMt}|${P.eyeD};${P.eyeShadowMt}|${P.shellMask}|gradient_blue`);
    expect(scene.morphs).toEqual(["h091_eyes", "h012_nose"]);

    saved.dispatch({ kind: "savedV.restore", value: B });
    // A's details, its skin and eyes included, leave the scene at once, before B has been prepared.
    expect(scene.details).toEqual([]);
    expect(scene.skin).toBe("");
    expect(scene.eyes).toBe("");
    expect(scene.face).toEqual([]);
    expect(details.snapshot().phase).toBe("preparing");
    await settle();
    expect(scene.details.map(d => d.split(":").slice(0, 2).join(":"))).toEqual(["skin:skin_type_03", "face:skin_type_03", "face:makeupCheeks_01",
      "face:facial_tattoo_02", "face:cyberware_01", "face:pack_liner", "brows:eyebrows_color2", "lashes:eyelash_color", "eyes:eyes_color"]);
    // B's face: nothing of A's lipstick or blush; the pack's copied template keeps its front priority.
    expect(scene.face.some(entry => entry.startsWith(FACE.lipsRed) || entry.startsWith(FACE.cheeksRed))).toBe(false);
    expect(scene.face.at(-1)).toBe(`${FACE.packLiner}|20,20,20,255@EMP_Front`);
    // B's own skin type and tone, and its pack eye (texture-only): nothing of A's skin or gradient eye lingers.
    expect(scene.skin).toBe(`senna_d03|202,177,153,255|${P.skinD3}`);
    expect(scene.eyes).toBe(`${P.eyeMt}|${P.packD};${P.eyeShadowMt}|${P.shellMask}|pack_eye_01`);
    expect(scene.morphs).toEqual(["h113_mouth"]);
    const b = details.snapshot();
    expect(b.slots.find(s => s.slot === "hair")).toEqual({ slot: "hair", state: "none", label: "None" });
    expect(b.phase).toBe("ready");

    saved.dispatch({ kind: "savedV.restore", value: A });
    await settle();
    expect(scene.details).toEqual(shownA);
    expect(scene.skin).toBe(skinA);
    expect(scene.eyes).toBe(eyesA);
    expect(scene.face).toEqual(faceA);
    expect(scene.morphs).toEqual(["h091_eyes", "h012_nose"]);

    // A slow B superseded by A never lands.
    holdB = () => {};
    saved.dispatch({ kind: "savedV.restore", value: B });
    await settle();
    saved.dispatch({ kind: "savedV.restore", value: A });
    await settle();
    expect(scene.details).toEqual(shownA);
    expect(scene.skin).toBe(skinA);
    expect(scene.eyes).toBe(eyesA);
    expect(scene.face).toEqual(faceA);
    expect(details.snapshot().slots.map(s => s.label)).toEqual(["pale, skin type 1", "lipstick (red), cheeks (red)", "brown", "brown", "brown", "gradient blue", "None", "style 01, silver", "None", "None"]);

    // A reload restores the last-loaded V: the workspace keeps it, and the shown character follows it.
    expect(characterRequestFor(saved.snapshot().savedV)).toEqual(characterRequestFromSave(A));
    // Switching Vs never touched the makeup draft, its presets or the library.
    expect(JSON.stringify(core.document.export())).toBe(draftBefore);
    expect(JSON.stringify(workspace.collections)).toBe(libraryBefore);
    stop(); details.dispose();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a failed preparation clears the previous V's details and says so in one line", async () => {
  let cleared = 0;
  const port: CharacterDetailPort = {
    request: async () => ({ key: "k", phase: "failed", message: "XF Studio couldn't read your game's character-creator files, so brows, lashes and hair aren't shown. The head still works.", progress: null, record: null }),
    poll: async () => { throw Error("unused"); }, show: async () => { throw Error("unused"); },
    clear: () => { cleared++; }, wait: async () => {},
  };
  const details = new CharacterDetailActions(port);
  await details.setCharacter(REQUEST_B);
  expect(cleared).toBeGreaterThan(0);
  expect(details.snapshot()).toMatchObject({ phase: "failed", source: "save" });
  expect(details.snapshot().message).toContain("The head still works.");
  // Asking again for the same V changes nothing (every context publish asks, PREV-86); Try again prepares it again.
  const before = cleared;
  for (let i = 0; i < 5; i++) await details.setCharacter(REQUEST_B);
  expect(cleared).toBe(before);
  expect(details.failed()).toBe(true);
  await details.retry();
  expect(cleared).toBe(before + 2);
});

/** A port whose host prepares every request at once (or fails the ones `fail` names), recording what it is asked. */
function choicePort(events: string[], fail = (_request: CharacterRequest) => false) {
  const port: CharacterDetailPort = {
    request: async request => {
      events.push(request.choices?.length ? `request:${request.choices.map(choice => choice.choice).join(",")}` : "request");
      return fail(request) ? { key: "k", phase: "failed", message: "The tried part couldn't be read.", progress: null, record: null }
        : { key: JSON.stringify(request), phase: "ready", message: "", progress: null, record: `${"a".repeat(64)}.json` };
    },
    poll: async () => { throw Error("unused"); },
    show: async () => { events.push("show"); return { slots: [{ slot: "piercings", state: "shown", label: "style 12, gold" }], drawn: ["piercings_12"] }; },
    clear: () => { events.push("clear"); }, wait: async () => {},
  };
  return port;
}
const withChoice = (choice: string): CharacterRequest => ({ ...REQUEST_A, choices: [{ part: "head", option: "piercings", choice }] });

test("a changed choice keeps the V on screen and interactive until its record swaps in; another V still clears first", async () => {
  const events: string[] = [];
  const details = new CharacterDetailActions(choicePort(events));
  await details.setCharacter(REQUEST_A);
  expect(events).toEqual(["clear", "request", "show"]);
  // A choice on the same V: no clear and no "preparing" phase (no overlay); the status says an update is on its way.
  const phases: string[] = [];
  const stop = details.subscribe(() => { const s = details.snapshot(); phases.push(`${s.phase}${s.updating ? ":updating" : ""}`); });
  const pending = details.setCharacter(withChoice("12"));
  expect(details.snapshot()).toMatchObject({ phase: "ready", updating: true });
  await pending;
  stop();
  expect(phases).toEqual(["ready:updating", "ready"]);
  expect(events).toEqual(["clear", "request", "show", "request:12", "show"]);
  expect(details.snapshot()).toMatchObject({ phase: "ready", updating: false, choices: 1, drawn: ["piercings_12"] });
  // The same request again is a no-op; a new V clears first.
  await details.setCharacter(withChoice("12"));
  expect(events.length).toBe(5);
  await details.setCharacter(REQUEST_B);
  expect(events.slice(5)).toEqual(["clear", "request", "show"]);
  // Back to the V's own from a choice: again without clearing.
  await details.setCharacter({ ...REQUEST_B, choices: [{ part: "head", option: "piercings", choice: "09" }] });
  await details.setCharacter(REQUEST_B);
  expect(events.slice(8)).toEqual(["request:09", "show", "request", "show"]);
  details.dispose();
});

test("a change that can't be prepared keeps the V as it was shown and says why; only Try again tries again (CORE-63, PREV-86)", async () => {
  const events: string[] = [];
  let failing = true;
  const details = new CharacterDetailActions(choicePort(events, request => failing && !!request.choices?.length));
  await details.setCharacter(REQUEST_A);
  await details.setCharacter(withChoice("12"));
  // The V stays (no clear), and the change is explained instead of silently reverted.
  expect(events).toEqual(["clear", "request", "show", "request:12"]);
  expect(details.snapshot()).toMatchObject({ phase: "ready", updating: false,
    updateError: "That change couldn't be shown in the 3D view, so your V is shown as before it. The tried part couldn't be read." });
  failing = false;
  // The same request asked again (a context publish) is not prepared again.
  await details.setCharacter(withChoice("12"));
  expect(events.length).toBe(4);
  expect(details.failed()).toBe(true);
  await details.retry();
  expect(events.slice(4)).toEqual(["request:12", "show"]);
  expect(details.snapshot().updateError).toBeNull();
  expect(details.failed()).toBe(false);
  details.dispose();
});

test("a host of another version is reported with the version-skew code, not as silence (the app updated while it ran)", async () => {
  const { createBrowserCharacterDetailDevice } = await import("../src/browser-character-detail-device");
  const { loadCharacterDetails } = await import("../src/character-detail-loader");
  // The scene host's detail loader, as the host binds it (platform/scene/character-renderer.ts).
  const scene = { setCharacterDetails: () => ({ limits: [] }), details: { load: (record: Parameters<typeof loadCharacterDetails>[0],
    options: Omit<Parameters<typeof loadCharacterDetails>[1], "anisotropy" | "context">) => loadCharacterDetails(record,
    { ...options, anisotropy: 1, context: () => ({ overMakeup: false, profileEncoding: "srgb-decoded" as const }) }) } } as never;
  const run = async (answer: (url: string, init?: RequestInit) => Response) => {
    const details = new CharacterDetailActions(createBrowserCharacterDetailDevice(scene, async (url, init) => answer(url, init)));
    await details.setCharacter(REQUEST_A);
    const status = details.snapshot();
    details.dispose();
    return status;
  };
  const state = (extra: Record<string, unknown>) => Response.json({ key: "k", phase: "ready", message: "", progress: null, record: `${"a".repeat(64)}.json`, ...extra });
  // An older host: its state names no record schema (and it refuses this page's newer requests as invalid).
  expect(await run(() => state({}))).toMatchObject({ phase: "failed", notice: "version-skew", message: "" });
  expect(await run(() => Response.json({ code: "invalid", error: "Invalid character request." }, { status: 400 }))).toMatchObject({ notice: "version-skew" });
  // A newer host: it refuses the request's version, or writes a record schema this page doesn't read.
  expect(await run(() => Response.json({ code: "unsupported_version" }, { status: 409 }))).toMatchObject({ notice: "version-skew" });
  expect(await run(() => state({ recordSchema: "xfs/render-detail-99" }))).toMatchObject({ notice: "version-skew" });
  // A host of this version whose record is of a newer version.
  expect(await run((url) => url.endsWith(".json") ? Response.json({ schema: "xfs/render-detail-99", detail: "character" })
    : state({ recordSchema: CHARACTER_DETAIL_SCHEMA }))).toMatchObject({ notice: "version-skew" });
  // An ordinary failure keeps its plain message and no notice.
  expect(await run(() => new Response("boom", { status: 500 }))).toMatchObject({ phase: "failed", notice: null });
  // The host answers an unknown request version with `unsupported_version`, naming the versions it reads.
  const { createCharacterDetailHandler } = await import("../src/character-detail-server");
  const handler = createCharacterDetailHandler({ request: () => { throw Error("unused"); }, state: () => { throw Error("unused"); } } as never);
  const refused = await handler(new Request("http://127.0.0.1/api/preview-character", { method: "POST", headers: { "Content-Type": "application/json",
    Origin: "http://127.0.0.1" }, body: JSON.stringify({ schema: "xfs/character-request-9", source: "default", bodyGender: "female" }) }));
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ code: "unsupported_version", request: CHARACTER_REQUEST_SCHEMA, record: CHARACTER_DETAIL_SCHEMA });
});

test("a V waiting for WolvenKit names the need, isn't reported as a failure, asks again now and then, and is prepared once WolvenKit is set up (NATIVE-47)", async () => {
  const events: string[] = [];
  let setUp = false, waits = 0;
  const NEED = "XF Studio needs WolvenKit to turn your V's own skin into the 3D view, and it isn't set up yet.";
  const port: CharacterDetailPort = {
    request: async request => {
      events.push(request.choices?.length ? "request:choice" : "request");
      return setUp ? { key: JSON.stringify(request), phase: "ready", message: "", progress: null, record: `${"a".repeat(64)}.json` }
        : { key: "k", phase: "failed", message: NEED, progress: null, record: null, need: "wolvenkit" };
    },
    poll: async () => { throw Error("unused"); },
    show: async () => { events.push("show"); return { slots: [{ slot: "hair", state: "shown", label: "Long" }] }; },
    clear: () => { events.push("clear"); },
    // The third question finds WolvenKit set up.
    wait: async () => { if (++waits === 2) setUp = true; },
  };
  const details = new CharacterDetailActions(port);
  const publishes: string[] = [];
  details.subscribe(() => { const s = details.snapshot(); publishes.push(`${s.phase}:${s.need ?? "-"}`); });
  await details.setCharacter(REQUEST_A);
  expect(events.filter(event => event === "request").length).toBe(3);
  expect(details.snapshot()).toMatchObject({ phase: "ready", need: null });
  // Said once while it waited (not on every question), then prepared.
  expect(publishes).toEqual(["preparing:-", "failed:wolvenkit", "ready:-"]);

  // A change on the shown V while WolvenKit is gone again: the V stays, the change waits with the same need.
  setUp = false; waits = 0;
  const change = { ...REQUEST_A, choices: [{ part: "head", option: "hairstyle", choice: "long" }] } as CharacterRequest;
  await details.setCharacter(change);
  expect(details.snapshot()).toMatchObject({ phase: "ready", updating: false, need: null });
  expect(events.filter(event => event === "request:choice").length).toBe(3);
});

test("while it waits for WolvenKit the status says so with the need, and Try again is offered", async () => {
  let resolveWait!: () => void;
  const port: CharacterDetailPort = {
    request: async () => ({ key: "k", phase: "failed", message: "Needs WolvenKit.", progress: null, record: null, need: "wolvenkit" }),
    poll: async () => { throw Error("unused"); }, show: async () => { throw Error("unused"); }, clear: () => {},
    wait: (_ms, signal) => new Promise<void>(resolve => { resolveWait = resolve; signal.addEventListener("abort", () => resolve(), { once: true }); }),
  };
  const details = new CharacterDetailActions(port);
  void details.setCharacter(REQUEST_A);
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(details.snapshot()).toMatchObject({ phase: "failed", message: "Needs WolvenKit.", need: "wolvenkit" });
  expect(details.failed()).toBe(true);
  details.dispose();
  resolveWait();
});

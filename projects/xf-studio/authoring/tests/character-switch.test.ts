import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CharacterDetailActions, followShownCharacter, type CharacterDetailPort, type HostCharacterState } from "../src/character-detail-actions";
import { CHARACTER_REQUEST_SCHEMA, characterRequestFor, characterRequestFromSave, type CharacterRequest } from "../src/character-detail-request";
import { prepareCharacterDetails } from "../src/character-detail-service";
import { depotHash } from "../src/depot-path";
import type { ExportedGeometry, ExportedMask, ExportedTexture, GameAssetExporter } from "../src/game-asset-export";
import { encodePng } from "../src/png";
import { CHARACTER_DETAIL_SCHEMA, type CharacterDetail } from "../src/render-detail";
import { SavedAppearanceActions, type SavedAppearanceResult } from "../src/saved-appearance-actions";
import type { SavedV } from "../src/save-reader";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { freshWorkspace } from "../src/workspace-state";
import { detailFixture, FACE, P, REQUEST_A, REQUEST_B } from "./character-detail-fixtures";
import { STUDIO_COMPOSITION } from "../src/compose/studio-registry";

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
    const stop = followShownCharacter(details, saved);
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
    expect(details.snapshot().slots.map(s => s.label)).toEqual(["pale, skin type 1", "lipstick (red), cheeks (red)", "brown", "brown", "brown", "gradient blue", "style 01, silver"]);

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
  // Asking again for a V that failed tries again (the setup may have been fixed meanwhile).
  await details.setCharacter(REQUEST_B);
  expect(cleared).toBe(4);
});

const OFFERED = [{ slot: "piercings" as const, options: [{ choice: "12", label: "Style 12", definitions: [{ name: "gold", label: "Gold" }] },
  { choice: "09", label: "Style 09", definitions: [{ name: "black", label: "Black" }] }] }];
/** A port whose host resolves the tried choice when the installation offers it (and ignores it otherwise), as the real host does. */
function tryPort(events: string[], choices = OFFERED) {
  const port: CharacterDetailPort = {
    request: async request => ({ key: JSON.stringify(request), phase: "ready", message: "", progress: null, record: `${"a".repeat(64)}.json` }),
    poll: async () => { throw Error("unused"); },
    show: async () => {
      events.push("show");
      const tried = last?.override;
      const offered = !!tried && choices.some(entry => entry.options.some(option => option.choice === tried.choice &&
        option.definitions.some(definition => definition.name === tried.definition)));
      return { slots: [{ slot: "piercings", state: "shown", label: "style 12, gold" }], choices, override: offered ? tried : null };
    },
    clear: () => { events.push("clear"); }, wait: async () => {},
  };
  let last: CharacterRequest | undefined;
  const request = port.request;
  port.request = async (value, signal) => { last = value; events.push(value.override ? `request:${value.override.choice}` : "request"); return request(value, signal); };
  return port;
}

test("trying a piercing style keeps the V on screen and interactive until its record swaps in; another V still clears first", async () => {
  const events: string[] = [];
  const details = new CharacterDetailActions(tryPort(events));
  await details.setCharacter(REQUEST_A);
  expect(events).toEqual(["clear", "request", "show"]);
  // The tried style is resolved on the same V: no clear and no "preparing" phase (no overlay); the control says what is on its way.
  const phases: string[] = [];
  const stop = details.subscribe(() => { const s = details.snapshot(); phases.push(`${s.phase}${s.trying ? `:trying ${s.trying.choice}` : ""}`); });
  details.dispatch({ kind: "character.tryChoice", slot: "piercings", choice: "12", definition: "gold" });
  expect(details.snapshot()).toMatchObject({ phase: "ready", trying: { choice: "12" }, tried: { choice: "12" } });
  await new Promise(resolve => setTimeout(resolve, 0));
  stop();
  expect(phases).toEqual(["ready:trying 12", "ready"]);
  expect(events).toEqual(["clear", "request", "show", "request:12", "show"]);
  expect(details.snapshot()).toMatchObject({ phase: "ready", override: { choice: "12" }, trying: null, choices: [{ slot: "piercings" }] });
  // A choice the V's record doesn't offer is refused with a code before it reaches the host.
  expect(details.check({ kind: "character.tryChoice", slot: "piercings", choice: "77", definition: "gold" })).toMatchObject({ available: false, code: "unavailable" });
  expect(details.check({ kind: "character.tryChoice", slot: "piercings", choice: "12", definition: "x".repeat(200) })).toMatchObject({ available: false, code: "invalid_value" });
  // The same request again is a no-op; a new V clears first, and the style tried on the previous V does not follow it (UI-51).
  await details.setOverride({ slot: "piercings", choice: "12", definition: "gold" });
  expect(events.length).toBe(5);
  await details.setCharacter(REQUEST_B);
  expect(events.slice(5)).toEqual(["clear", "request", "show"]);
  expect(details.snapshot().tried).toBeNull();
  // Back to the V's own piercings from a try: again without clearing.
  details.dispatch({ kind: "character.tryChoice", slot: "piercings", choice: "09", definition: "black" });
  await new Promise(resolve => setTimeout(resolve, 0));
  details.dispatch({ kind: "character.tryChoice", slot: "piercings", choice: "", definition: "" });
  // Going back to the V's own is shown as on its way too, without leaving "ready".
  expect(details.snapshot()).toMatchObject({ phase: "ready", trying: { choice: "" } });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(details.snapshot().trying).toBeNull();
  expect(events.slice(8)).toEqual(["request:09", "show", "request", "show"]);
  details.dispose();
});

test("the persisted tried style is read with the host's rules, re-checked when the choices arrive, and cleared when stale (UI-51)", async () => {
  // Over-long, wrongly shaped or foreign values are dropped on read: they never reach (and never make the host refuse) a request.
  for (const stored of [{ slot: "piercings", choice: "x".repeat(200), definition: "gold" }, { slot: "hair", choice: "12", definition: "gold" },
    { slot: "piercings", choice: "12" }, "12", null])
    expect(new CharacterDetailActions(tryPort([]), stored).snapshot().tried).toBeNull();
  // A well-formed style the installation still offers is sent with the V and kept.
  const kept: string[] = [];
  const offered = new CharacterDetailActions(tryPort(kept), { slot: "piercings", choice: "12", definition: "gold" });
  await offered.setCharacter(REQUEST_A);
  expect(kept).toEqual(["clear", "request:12", "show"]);
  expect(offered.snapshot()).toMatchObject({ tried: { choice: "12" }, override: { choice: "12" } });
  // One it no longer offers is cleared once the V's choices arrive, and never sent again.
  const events: string[] = [];
  const stale = new CharacterDetailActions(tryPort(events), { slot: "piercings", choice: "99", definition: "gone" });
  await stale.setCharacter(REQUEST_A);
  expect(stale.snapshot()).toMatchObject({ phase: "ready", tried: null, override: null });
  expect(events).toEqual(["clear", "request:99", "show"]);
  await stale.setCharacter(REQUEST_A);
  expect(events).toEqual(["clear", "request:99", "show"]);
  // The workspace keeps what the service holds: the composer persists the tried style from its snapshot.
  const workspace = freshWorkspace();
  expect(workspace.preview).toMatchObject({ piercingStyle: "", piercingDefinition: "" });
  offered.dispose(); stale.dispose();
});

test("a host of another version is reported with the version-skew code, not as silence (the app updated while it ran)", async () => {
  const { createBrowserCharacterDetailDevice } = await import("../src/browser-character-detail-device");
  const scene = { setCharacterDetails: () => ({ limits: [] }), detailContext: () => ({ overMakeup: false, profileEncoding: "srgb-decoded" as const }),
    renderer: { capabilities: { getMaxAnisotropy: () => 1 } } } as never;
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

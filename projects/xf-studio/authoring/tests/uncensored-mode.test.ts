// The opt-in uncensored look (knowledge/body-rendering.md §3; research/backlog/clothing-render.md decision 3): one viewer setting, off by
// default and stored per workspace, that asks the host for the body as the game draws it with nudity allowed. The plan's side is in
// character-detail-plan.test.ts; this file covers the action, the workspace, the request and the creator rows' coverage.
import { describe, expect, test } from "bun:test";
import { CharacterContextActions, type CreatorPort } from "../src/character-context-actions";
import { CHARACTER_REQUEST_SCHEMA, CharacterRequestVersionError, parseCharacterRequest, sameCharacter } from "../src/character-detail-request";
import { censorshipOf } from "../src/character-detail-service";
import { CC_PANEL_SCHEMA } from "../src/cc-panel";
import { renderCoverage, UNDER_COVER, type CoverageInput } from "../src/cc-render-coverage";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { PreviewActions, type PreviewPort } from "../src/preview-actions";
import { parseWorkspace, serializeWorkspace } from "../src/workspace-state";
import { freshWorkspace } from "./fixtures/eye-region";

const port = (withBody = true) => ({ cameraState: () => ({ position: [0, 0, 1], target: [0, 0, 0], fov: 30 }), front: () => false, setFov: () => false,
  endFovGesture: () => {}, restoreCamera: () => {}, setExposure: () => {}, setLightAngle: () => {}, setSurfaceControls: () => {},
  setWire: () => {}, setNormals: () => {}, setEyeOptics: () => {}, setHair: () => {}, setDetail: () => {}, setEyeShape: () => {}, setPiercings: () => {},
  ...(withBody ? { setBody: () => {}, frameBody: () => false } : {}) }) as PreviewPort;

describe("the uncensored setting (preview.setUncensored)", () => {
  test("off by default and absent from a workspace that never changed it; on and off are stored per workspace", () => {
    const workspace = freshWorkspace();
    const actions = new PreviewActions(workspace.preview, port());
    expect(actions.snapshot().uncensored).toBeUndefined();
    expect(JSON.stringify(serializeWorkspace(workspace, STUDIO_DOCUMENTS))).not.toContain("uncensored");
    let told = 0;
    actions.subscribe(() => told++);
    actions.dispatch({ kind: "preview.setUncensored", enabled: true });
    expect(actions.snapshot().uncensored).toBe(true);
    expect(told).toBe(1);
    // The workspace keeps the choice (as the composition root writes the snapshot back) and reads it again.
    const stored = { ...workspace, preview: { ...workspace.preview, uncensored: actions.snapshot().uncensored } };
    const restored = parseWorkspace(JSON.parse(JSON.stringify(serializeWorkspace(stored, STUDIO_DOCUMENTS))), STUDIO_DOCUMENTS);
    expect(restored.preview.uncensored).toBe(true);
    expect(new PreviewActions(restored.preview, port()).snapshot().uncensored).toBe(true);
    actions.dispatch({ kind: "preview.setUncensored", enabled: false });
    expect(actions.snapshot().uncensored).toBe(false);
    // Anything but a boolean is dropped on restore (off).
    const garbled = parseWorkspace({ ...JSON.parse(JSON.stringify(serializeWorkspace(workspace, STUDIO_DOCUMENTS))),
      preview: { ...workspace.preview, uncensored: "yes" } }, STUDIO_DOCUMENTS);
    expect(garbled.preview.uncensored).toBeUndefined();
  });

  test("refused on a head-only preview and for a value that isn't on or off", () => {
    const headOnly = new PreviewActions(freshWorkspace().preview, port(false));
    expect(headOnly.check({ kind: "preview.setUncensored", enabled: true })).toMatchObject({ available: false, code: "unavailable" });
    const actions = new PreviewActions(freshWorkspace().preview, port());
    expect(actions.check({ kind: "preview.setUncensored", enabled: "on" as never })).toMatchObject({ available: false, code: "invalid_value" });
    expect(actions.check({ kind: "preview.setUncensored", enabled: true }).available).toBe(true);
  });
});

describe("the request (xfs/character-request-7 `nudity`)", () => {
  const context = () => new CharacterContextActions({ creator: {} as CreatorPort, showSave: () => {} }, { save: undefined, stored: undefined });

  test("the character context asks for the uncensored body only while the setting is on and the body shown; the same V either way", () => {
    expect(CHARACTER_REQUEST_SCHEMA).toBe("xfs/character-request-7");
    const ctx = context();
    let published = 0;
    ctx.subscribe(() => published++);
    const censored = ctx.detailRequest();
    expect(censored.nudity).toBeUndefined();
    expect(censorshipOf(censored)).toBe("censored");
    ctx.setUncensored(true);
    const uncensored = ctx.detailRequest();
    expect(uncensored).toMatchObject({ nudity: true });
    expect(censorshipOf(uncensored)).toBe("nudity");
    expect(sameCharacter(censored, uncensored)).toBe(true);
    ctx.setUncensored(true);
    expect(published).toBe(1);
    // A body turned off shows no nudity: the request asks for the head alone.
    ctx.setBodyShown(false);
    expect(ctx.detailRequest()).toMatchObject({ body: false });
    expect(ctx.detailRequest().nudity).toBeUndefined();
    ctx.setBodyShown(true);
    ctx.setUncensored(false);
    expect(ctx.detailRequest()).toEqual(censored);
  });

  test("the host reads it strictly: only `true`, never without the body, and an earlier version is the censored V", () => {
    const request = { schema: CHARACTER_REQUEST_SCHEMA, source: "default", bodyGender: "female", nudity: true };
    expect(parseCharacterRequest(request)).toEqual(request as never);
    expect(() => parseCharacterRequest({ ...request, nudity: false })).toThrow("nudity setting is invalid");
    expect(() => parseCharacterRequest({ ...request, nudity: "yes" })).toThrow("nudity setting is invalid");
    expect(() => parseCharacterRequest({ ...request, body: false })).toThrow("shows no nudity");
    // v6 carried no nudity setting: the field is unknown there, and a v6 request (with its body switch) is the censored V.
    expect(() => parseCharacterRequest({ ...request, schema: "xfs/character-request-6" })).toThrow("unknown fields");
    const v6 = parseCharacterRequest({ schema: "xfs/character-request-6", source: "default", bodyGender: "female", body: false });
    expect(v6).toEqual({ schema: CHARACTER_REQUEST_SCHEMA, source: "default", bodyGender: "female", body: false });
    expect(censorshipOf(v6)).toBe("censored");
    // A later page than this host is a version skew, said as such.
    expect(() => parseCharacterRequest({ ...request, schema: "xfs/character-request-8" })).toThrow(CharacterRequestVersionError);
  });
});

describe("the creator rows' coverage (cc-render-coverage.ts)", () => {
  const option = (name: string, uiSlot: string, censor?: CoverageInput["censor"], extra: Partial<CoverageInput> = {}): CoverageInput => ({ id: name, part: "body", name,
    type: "appearance", uiSlot, link: null, hasResource: true, groups: ["TPP_Body"], targets: [], uiSlots: [], emitsNothing: false, ...(censor ? { censor } : {}), ...extra });
  const nudity = (action: "activate" | "deactivate") => ({ flag: "Censor_Nudity", action });

  test("what the underwear covers reads `uncensored` (drawn only in the uncensored look); another rule's hidden option is not drawn", () => {
    expect(CC_PANEL_SCHEMA).toBe("xfs/cc-panel-3");
    const options = [option("skin", "body_color", nudity("deactivate"), { link: { key: "skin color", controller: false } }),
      option("skin_censored", "body_color", nudity("activate"), { link: { key: "skin color", controller: false } }),
      option("cover", "underpants", nudity("activate")), option("nipples_02", "nipples", nudity("deactivate")),
      option("wound", "scars", { flag: "Censor_Gore", action: "deactivate" }),
      option("nipples", "nipples", undefined, { type: "switcher", hasResource: false, targets: ["nipples_02"], uiSlots: ["nipples"] })];
    const coverage = renderCoverage(options, "female");
    expect(["skin", "skin_censored", "cover", "nipples_02", "wound", "nipples"].map(id => coverage.get(id)!.status))
      .toEqual(["rendered", "not-rendered", "rendered", "uncensored", "not-rendered", "uncensored"]);
    expect(coverage.get("nipples_02")!.note).toBe(UNDER_COVER);
    expect(UNDER_COVER).toContain("uncensored");
  });
});

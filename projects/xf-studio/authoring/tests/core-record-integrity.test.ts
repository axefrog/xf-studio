import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readCoreDetail, loadCoreDetail } from "../src/character/render/core-detail-loader";
import { parseCoreDetail, RENDER_DETAIL_SCHEMA, type CoreDetail, type RenderResource } from "../src/character/render-detail";

const resource = (file: string): RenderResource => ({ file, sha256: "a".repeat(64), sources: [] });
const record: CoreDetail = { schema: RENDER_DETAIL_SCHEMA, detail: "core-head", identity: "synthetic", origin: "game-files",
  provenance: { label: "Synthetic core", notes: [] },
  geometry: { ...resource("head.glb"), nodes: { head: "head", eyes: "eyes" }, morphs: [] },
  textures: { "head.albedo": resource("head-color.png"), "head.normal": resource("head-normal.png"),
    "head.roughness": resource("head-roughness.png"), "eyes.albedo": resource("eye-color.png") } };
const bytes = JSON.stringify(record), etag = `"${createHash("sha256").update(bytes).digest("hex")}"`;
const response = (body = bytes, tag: string | null = etag) => new Response(body, { headers: tag === null ? {} : { ETag: tag } });

test("the page hashes the received record bytes before parsing them", async () => {
  expect(await readCoreDetail(async () => response())).toEqual(record);
  const changed = parseCoreDetail(JSON.parse(bytes));
  [changed.textures["head.albedo"], changed.textures["head.normal"]] = [changed.textures["head.normal"], changed.textures["head.albedo"]];
  expect(parseCoreDetail(changed).textures["head.albedo"].file).toBe("head-normal.png");
  await expect(readCoreDetail(async () => response(JSON.stringify(changed)))).rejects.toMatchObject({ code: "preview_damaged" });
});

test.each([null, "", '"not-a-digest"', `W/${etag}`])("the page refuses a record without a valid required content digest (%s)", async tag => {
  await expect(readCoreDetail(async () => response(bytes, tag))).rejects.toMatchObject({ code: "preview_damaged" });
});

test("an abort during the record digest read retains its owning lifetime's reason", async () => {
  const life = new AbortController(), reply = response();
  const read = reply.arrayBuffer.bind(reply);
  reply.arrayBuffer = async () => { life.abort(); return read(); };
  // No WebGL object is used: this stops immediately after reading the record.
  const result = await loadCoreDetail({} as Parameters<typeof loadCoreDetail>[0], async () => reply, "female", life.signal).catch(error => error);
  expect(result).toBe(life.signal.reason);
});

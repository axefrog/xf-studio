/**
 * The maps every scene runtime on one renderer shares (character-detail-loader.ts `detailLedgerOf`; experiment 044 §16): one ledger per
 * renderer, a map's references counted across the runtimes that use it, its disposal when the last lets go.
 */
import { expect, test } from "bun:test";
import * as THREE from "three";
import { DetailLedger, DetailPartPool, detailLedgerOf, textureLedgerKey } from "../src/character/render/character-detail-loader";

const key = textureLedgerKey({ file: "a.png", isGamma: true }, "colour" as never, "clamp" as never);
/** A map in the ledger held by `parts` parts, as a load makes it. */
function shared(ledger: DetailLedger, parts: number) {
  const texture = new THREE.Texture(), disposed = { count: 0 };
  texture.addEventListener("dispose", () => disposed.count++);
  ledger.textures.set(key, { texture, refs: 0, file: "a.png" });
  const held = Array.from({ length: parts }, () => { ledger.textures.get(key)!.refs++; return { materials: [], owned: [], textureKeys: [key] }; });
  return { texture, disposed, held };
}

test("a renderer has one ledger, and another renderer has its own", () => {
  const a = {}, b = {};
  expect(detailLedgerOf(a)).toBe(detailLedgerOf(a));
  expect(detailLedgerOf(a)).not.toBe(detailLedgerOf(b));
});

test("pools given a renderer's ledger share its maps; a pool without one keeps its own", () => {
  const renderer = {};
  const first = new DetailPartPool(undefined, detailLedgerOf(renderer)), second = new DetailPartPool(undefined, detailLedgerOf(renderer));
  expect(first.ledger).toBe(second.ledger);
  expect(new DetailPartPool().ledger).not.toBe(first.ledger);
});

test("a map two runtimes use is disposed when the last of their parts lets go, not before", () => {
  const ledger = detailLedgerOf({});
  const { disposed, held } = shared(ledger, 2);
  ledger.release(held[0]);
  expect(disposed.count).toBe(0);
  expect(ledger.textures.has(key)).toBe(true);
  ledger.release(held[1]);
  expect(disposed.count).toBe(1);
  expect(ledger.textures.has(key)).toBe(false);
});

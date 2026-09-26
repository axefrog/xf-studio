import { expect, test } from "bun:test";
import { createBrowserCharacterDetailDevice } from "../src/browser-character-detail-device";
import { CharacterDetailActions, type CharacterDetailPort } from "../src/character-detail-actions";
import { DEFAULT_CHARACTER } from "../src/character-detail-request";
import { withSlotLimits, type DetailLimit, type SlotLimits } from "../src/detail-limits";
import { DETAIL_SLOTS, type DetailSlot } from "../src/render-detail";

/**
 * Limits the renderer finds after a V was placed reach the Character panel (PREV-74): a slot the viewer shows later bakes then, and
 * a restored WebGL context bakes again; either may find a part it can't draw. The scene publishes them, the device words them per
 * shown slot as `show` does, and the service replaces the shown slots' codes.
 */
test("limits found after the details were placed update the shown slots; slots not shown keep their state", async () => {
  let publish: ((update: SlotLimits) => void) | null = null;
  const port: CharacterDetailPort = {
    request: async () => ({ key: "k", phase: "ready", message: "", progress: null, record: `${"a".repeat(64)}.json` }),
    poll: async () => { throw Error("unused"); },
    show: async () => ({ slots: DETAIL_SLOTS.map(slot => slot === "hair" ? { slot, state: "none" as const, label: "None" } : { slot, state: "shown" as const, label: "fixture" }) }),
    clear: () => {}, wait: async () => {},
    onLimits: listener => { publish = listener; return () => {}; },
  };
  const details = new CharacterDetailActions(port);
  // Before anything is shown, an update has nothing to apply to.
  publish!([{ slot: "piercings", limits: ["layered-material"] }]);
  expect(details.snapshot().slots.every(slot => slot.state === "pending" && !slot.limits)).toBe(true);
  await details.setCharacter(DEFAULT_CHARACTER);
  const slot = (name: DetailSlot) => details.snapshot().slots.find(entry => entry.slot === name)!;
  expect(slot("piercings").limits).toBeUndefined();
  publish!([{ slot: "piercings", limits: ["layered-material"] }, { slot: "eyes", limits: ["eye-design"] }, { slot: "hair", limits: ["layered-material"] }]);
  expect(slot("piercings").limits).toEqual(["layered-material"]);
  expect(slot("eyes").limits).toEqual(["eye-design"]);
  expect(slot("hair")).toEqual({ slot: "hair", state: "none", label: "None" });
  // A later bake that succeeds clears them.
  publish!([{ slot: "piercings", limits: [] }, { slot: "eyes", limits: [] }]);
  expect(slot("piercings").limits).toBeUndefined();
  details.dispose();
});

test("the device passes the scene's placement limits on only while it shows details", () => {
  let placed: ((limits: { slot: DetailSlot; limit: DetailLimit }[]) => void) | null = null;
  const scene = { setCharacterDetails: () => ({ limits: [] }), details: { load: () => { throw Error("No load expected."); } },
    onBakeLimits: (listener: typeof placed) => { placed = listener; return () => {}; } } as never;
  const device = createBrowserCharacterDetailDevice(scene, async () => new Response(null, { status: 404 }));
  const seen: SlotLimits[] = [];
  device.onLimits!(update => seen.push(update));
  placed!([{ slot: "piercings", limit: "layered-material" }]);
  expect(seen).toEqual([]);
});

test("withSlotLimits replaces only shown slots' codes", () => {
  const slots = [{ slot: "eyes", state: "shown", label: "a", limits: ["eye-design" as DetailLimit] }, { slot: "hair", state: "unavailable", label: "" }];
  expect(withSlotLimits(slots, [{ slot: "eyes", limits: [] }, { slot: "hair", limits: ["layered-material"] }]))
    .toEqual([{ slot: "eyes", state: "shown", label: "a" }, { slot: "hair", state: "unavailable", label: "" }]);
});

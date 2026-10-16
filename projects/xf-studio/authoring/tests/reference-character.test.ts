import { expect, test } from "bun:test";
import { isBaseGameSource } from "../src/resolver-host";
import { routeIdentity } from "../src/route-fingerprint";

test("baseline references include game content and expansion archives, excluding every mod and XL source", () => {
  const base = { provider: "game", kind: "archive", virtualPath: "archive/pc/content/basegame_4_appearance.archive" } as const;
  expect(isBaseGameSource(base)).toBe(true);
  expect(isBaseGameSource({ ...base, virtualPath: "archive/pc/ep1/ep1_1_appearance.archive" })).toBe(true);
  expect(isBaseGameSource({ ...base, virtualPath: "archive/pc/mod/replacement.archive" })).toBe(false);
  expect(isBaseGameSource({ ...base, provider: "manual" })).toBe(false);
  expect(isBaseGameSource({ ...base, kind: "archive-xl" })).toBe(false);
  const route = { gameRoot: ".", launchRoute: "direct" as const };
  expect(routeIdentity({ ...route, baseOnly: true })).not.toEqual(routeIdentity(route));
});

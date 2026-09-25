import { test } from "bun:test";
import { oracleTest } from "./optional-oracles";

/**
 * Tests that read ignored, game-derived files under public/assets. They fail loudly when the
 * assets are missing, except in a build that explicitly declares it has none (public CI sets
 * XFS_PRIVATE_ASSETS=absent after proving the directory does not exist). Never set it locally
 * to hide a missing intake. Under XFS_REQUIRE_ORACLES=1 these declared skips fail too.
 */
export const privateAssetTest = process.env.XFS_PRIVATE_ASSETS === "absent"
  ? oracleTest(false, "XFS_PRIVATE_ASSETS=absent declares that the private preview assets are missing.") : test;

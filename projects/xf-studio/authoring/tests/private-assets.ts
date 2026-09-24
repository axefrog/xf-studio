import { test } from "bun:test";

/**
 * Tests that read ignored, game-derived files under public/assets. They fail loudly when the
 * assets are missing, except in a build that explicitly declares it has none (public CI sets
 * XFS_PRIVATE_ASSETS=absent after proving the directory does not exist). Never set it locally
 * to hide a missing intake.
 */
export const privateAssetTest = process.env.XFS_PRIVATE_ASSETS === "absent" ? test.skip : test;

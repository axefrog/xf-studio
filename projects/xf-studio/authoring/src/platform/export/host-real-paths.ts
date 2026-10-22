/**
 * Host adapter: the file-system reads the real containment checks take (`RealPaths`, platform/api/path-containment.ts). An entry
 * exists when `lstat` finds it, so a link whose target is gone counts as there (and its real path then fails), never as a folder
 * not created yet that a write could pass through (PIPE-136).
 */
import { lstatSync, realpathSync } from "node:fs";
import type { RealPaths } from "../api/path-containment";

export const HOST_REAL_PATHS: RealPaths = {
  exists: path => { try { lstatSync(path); return true; } catch { return false; } },
  realpath: path => realpathSync.native(path),
};

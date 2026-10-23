import { afterAll } from "bun:test";
import { sweepTempDirs } from "./temp-dir.ts";

/** Preloaded by `bunfig.toml`: one `afterAll` for the whole run, after the last test file (see `temp-dir.ts`). */
afterAll(sweepTempDirs);

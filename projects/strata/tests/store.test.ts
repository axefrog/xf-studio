/** The in-memory store passes the store conformance suite (the SQLite adapter runs the same cases). */
import { test } from "bun:test";
import { MemoryStore } from "strata";
import { STORE_CASES } from "strata/testing";

for (const item of STORE_CASES) test(`memory store: ${item.name}`, () => item.run(async () => new MemoryStore()));

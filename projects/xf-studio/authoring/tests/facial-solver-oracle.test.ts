// Opt-in parity check of XF Studio's facial solver against the pinned IO Suite solver (research/animation/facial-solver-spec.md §9): replays
// the fixture `bun tools/facial-solver-oracle.ts --generate` made (the oracle's answers, stored locally in data/facial-oracle/ or
// XFS_FACIAL_ORACLE_FIXTURE) through `solveFace` and holds every group to the §9.4 gates. The fixture is game-derived and the oracle needs
// Python and the IO Suite, so CI has neither and this is skipped there.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compileFacialRig } from "../src/engines/facial-rig/solver";
import { compareFixture, readFixture } from "../tools/facial-oracle-cases";
import { DEFAULT_FIXTURE, intakePaths, primaryCheckout } from "../tools/facial-solver-oracle";
import { oracleDescribe } from "./optional-oracles";

const fixture = resolve(process.env.XFS_FACIAL_ORACLE_FIXTURE ?? DEFAULT_FIXTURE);
const paths = intakePaths(resolve(process.env.XFS_FACIAL_INTAKE ?? join(primaryCheckout(), "research", "consumers")));
const available = existsSync(join(fixture, "female", "cases.json")) && existsSync(paths.rigJson) && existsSync(paths.setupJson);

oracleDescribe(available, "the facial solver oracle needs its fixture (bun tools/facial-solver-oracle.ts --generate, with Python and the IO Suite) and the local facial intake.")(
  "XF Studio's facial solver against the IO Suite", () => {
    const rig = JSON.parse(readFileSync(paths.rigJson, "utf8"));
    for (const [name, setupPath] of [["female", paths.setupJson], ["male", paths.maleSetupJson]] as const) {
      test(`${name} setup: every case within 1e-5 rad, 1e-6 m and 1e-6 on the processed tracks`, () => {
        const data = readFixture(join(fixture, name));
        if (!data || !existsSync(setupPath)) return;
        const reports = compareFixture(compileFacialRig(rig, JSON.parse(readFileSync(setupPath, "utf8"))), data);
        expect(reports.length).toBeGreaterThan(0);
        for (const group of reports) expect({ group: group.group, failures: group.failures }).toEqual({ group: group.group, failures: [] });
      }, 120_000);
    }
  });

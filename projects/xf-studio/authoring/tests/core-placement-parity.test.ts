/** Frozen on e5bc2c61 before slice 12; never regenerate from the refactor. */
import { expect, test } from "bun:test";
import { EYE_MAKEUP_MOD, eyeMakeupRelatedEntries, isEyeMakeupModFolder } from "../src/legacy/eye-makeup/mod-branding";
import { FRAMEWORK_SAMPLE_STATES, frameworkCheckFor } from "../src/installation/framework-fixtures";
import { EYE_ARTISTRY_REQUIREMENTS, requirementsForProducts, frameworkVerdicts } from "./fixtures/product-defaults";
import { XBOX_UNSUPPORTED_MESSAGE } from "./fixtures/product-defaults";
import { canonicalJson } from "../src/platform/api/canonical-json";
import { sha256Hex } from "../src/formats/content-hash";
import { depotPathRegex } from "../src/game/depot-path-regex";
import { diagnosticModlist, diagnosticPlacement } from "./fixtures/product-defaults";

test("e5bc2c61 product defaults, framework wording and install identity recognition", () => {
  const checks = FRAMEWORK_SAMPLE_STATES.filter(state => state !== "no-game").map(state => ({ state, check: frameworkCheckFor(state as Exclude<typeof state, "no-game">) }));
  const list = "+Other\n+XF Studio\n+XF Eye Artistry CCXL - Dev\n+ArchiveXL\n+Frameworks_separator\n";
  expect({ brand: EYE_MAKEUP_MOD, related: eyeMakeupRelatedEntries,
    folders: ["XF Eye Artistry", "xf eye artistry", "XF STUDIO", "XF Eye Artistry CCXL - Dev", "Unrelated"].map(name => [name, isEyeMakeupModFolder(name)]),
    requirements: EYE_ARTISTRY_REQUIREMENTS, merged: requirementsForProducts([{ name: "expression sets", requirements: [{ framework: "tweakxl", minimum: "1.11.5", reason: "fixture" }] }]),
    xbox: XBOX_UNSUPPORTED_MESSAGE, checks,
    verdicts: frameworkVerdicts(checks[0]!.check.routes[0]!.frameworks, "mo2"),
    placement: diagnosticPlacement(list, ["ArchiveXL"]), modlist: diagnosticModlist(list, ["ArchiveXL"]).split("\n"),
  }).toMatchSnapshot();
});

test("e5bc2c61 borrowed helper bytes and edge cases", () => {
  const values = [null, false, 1, "text", [3, { z: 1, a: "a" }], { z: { b: 2, a: 1 }, a: [null, "x"] },
    { a: undefined, b: [undefined, 2] }];
  expect({ json: values.map(value => { const text = canonicalJson(value); return { text, hash: sha256Hex(text) }; }),
    regex: [[], ["base\\a.mesh"], ["a.b\\c+[](){}^$?*.mesh", "base\\x@y.mesh"]].map(depotPathRegex),
  }).toMatchSnapshot();
});

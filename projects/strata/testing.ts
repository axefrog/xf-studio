/**
 * XF Strata's testing entry point: the simulation harness, simulated sources, the reference model, the standard
 * invariants and the conformance runner. For tests only.
 */
export { runKernelVector, runCanonicalVector, conformanceOperators } from "./src/testing/conformance";
export type { KernelVector, KernelStep, CanonicalVector, TreeExpectation, VectorSuite } from "./src/testing/conformance";
export { Scheduler, simClock, settle, SimJobs, SimFiles, SimInput, SimRequests } from "./src/testing/sim-sources";
export { seededRandom, prng } from "./src/random";
export { SimStore } from "./src/testing/sim-store";
export { referenceModel, replayTo } from "./src/testing/reference";
export { simulate, runSteps, generateSteps, shrink, replay } from "./src/testing/simulate";
export type { Step, Scenario, SimAction, SimFailure, SimResult, Regression } from "./src/testing/simulate";
export { STRATA_FAULTS, STRATA_DEBUG } from "./src/graph";
export { STORE_CASES, sampleEntry } from "./src/testing/store-conformance";
export type { StoreCase } from "./src/testing/store-conformance";
export { SYNTHETIC_TYPES, SYNTHETIC_RULES, itemType, groupType, ITEM, GROUP } from "./src/testing/synthetic";
export { checkResolution, checkConflictIndex, checkStructure, checkSnapshots, checkConsistentCut, checkTables, headStates, tableSizes } from "./src/testing/invariants";
export { graphScenario } from "./src/testing/graph-scenario";
export type { GraphWorld } from "./src/testing/graph-scenario";
export { kernelScenario, randomModel } from "./src/testing/kernel-scenario";
export type { KernelWorld } from "./src/testing/kernel-scenario";
export { runEntityVector, typeFromData } from "./src/testing/entity-conformance";
export type { EntityVector, EntityStep } from "./src/testing/entity-conformance";

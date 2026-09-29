/**
 * XF Strata's testing entry point: the simulation harness, simulated sources, the reference model, the standard
 * invariants and the conformance runner. For tests only.
 */
export { runKernelVector, conformanceOperators } from "./src/testing/conformance";
export type { KernelVector, KernelStep, VectorSuite } from "./src/testing/conformance";
export { Scheduler, simClock, seededRandom, prng, settle, SimJobs, SimFiles, SimInput, SimRequests } from "./src/testing/sim-sources";
export { SimStore } from "./src/testing/sim-store";
export { referenceModel, replayTo } from "./src/testing/reference";
export { simulate, runSteps, generateSteps, shrink, replay } from "./src/testing/simulate";
export type { Step, Scenario, SimAction, SimFailure, SimResult, Regression } from "./src/testing/simulate";
export { STRATA_FAULTS } from "./src/graph";

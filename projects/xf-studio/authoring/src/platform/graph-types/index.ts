/**
 * The Studio's graph types and rules (profiles and graph design §1.1): registered with XF Strata through its public
 * API. G1 brings pointers and the structural rules; V, save, look, mod, profile and layout types arrive with their
 * slices. The composition (`compose/graph.ts`) hands these to the graph.
 */
export { POINTER, pointerType, resolvePointer } from "./pointer";
export { R1, R2, R3, L1, L2, STRUCTURAL_RULES } from "./rules";

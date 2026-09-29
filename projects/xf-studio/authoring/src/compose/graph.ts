/**
 * The Studio's graph composition: the node types and conflict rules registered with XF Strata (profiles and graph
 * design §1.1). Composition roots hand it to the graph library; features add their types and rules here as their
 * slices land.
 */
import type { RuleDef, TypeDef } from "strata";
import { pointerType, STRUCTURAL_RULES } from "../platform/graph-types";

export const STUDIO_GRAPH_TYPES: readonly TypeDef[] = [pointerType];
export const STUDIO_GRAPH_RULES: readonly RuleDef[] = STRUCTURAL_RULES;

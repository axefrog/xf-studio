/** Public graph boundary for feature services and source adapters. No renderer or host dependencies. */
export { Aborter, erector, standardOperators } from "strata";
export type { AbortSignalLike, Driver, Environment, Graph, GraphModel, Json, NodeRef, Process, Sources } from "strata";
import type { AbortSignalLike, Environment, Graph, Sources } from "strata";
export type ExperimentContext = { graph: Graph; env: Environment; sources: Sources; signal: AbortSignalLike };

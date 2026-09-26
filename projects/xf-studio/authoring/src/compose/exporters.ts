/**
 * The host composition's exporters (feature-module platform §6, §7 rule 7): every exporting feature's exporter
 * and its independent verifier. Host only (Node): the servers, the desktop host, the builder CLI, the Check
 * worker, tools and tests import it; the browser bundle never does. Each feature whose core registration
 * names an exporter (`FeatureModule.exports`) must be listed here with a verifier of the same exporter ID.
 */
import type { FeatureExporterEntry } from "../platform/api";
import { EYE_MAKEUP_EXPORTER } from "../features/eye-makeup/export";
import { EYE_MAKEUP_VERIFIER } from "../features/eye-makeup/verify";

export const STUDIO_EXPORTERS: readonly FeatureExporterEntry[] = Object.freeze([
  { exporter: EYE_MAKEUP_EXPORTER as FeatureExporterEntry["exporter"], verifier: EYE_MAKEUP_VERIFIER },
]);

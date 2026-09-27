/**
 * What eye makeup's core registration says about its mod exporter (feature-module platform §6): the
 * exporter ID the host composition must register, and the defaults a presentation shows before any
 * Check. Pure: the core, the exporter (`export/`) and the independent verifier (`verify/`) all read it.
 */
import type { ExportInfo } from "../../platform/api";
import { EYE_MAKEUP_MOD } from "../../mod-branding";

/**
 * The exporter's ID. Its routes (flat, faceted, Fresnel and the diagnostic Glitter route) are one exporter:
 * one plate, one selector and one plan per collection.
 */
export const EYE_MAKEUP_EXPORTER_ID = "eye-makeup/mesh-decal";
/** Its own selector, because of the custom face plate; branded by mod-branding. */
export const EYE_MAKEUP_EXPORT: ExportInfo = Object.freeze({ exporterId: EYE_MAKEUP_EXPORTER_ID,
  brand: EYE_MAKEUP_MOD.modName, selectorLabel: EYE_MAKEUP_MOD.selectorLabel, selector: "own" });
/** The host prerequisite a Build needs: the built-in eye plate, cut from the head the game loads. */
export const EYE_PLATE_PREREQUISITE = "eye-makeup/plate";
/**
 * The optional masculine Build prerequisite: the masculine V's eye plate, cut from the male head the game loads. When
 * a host offers it and it is ready, the mod also gets the masculine creator's selector; otherwise the mod is for a
 * feminine V only and Check, Build and the manifest say so.
 */
export const EYE_PLATE_MASCULINE_PREREQUISITE = "eye-makeup/plate-masculine";

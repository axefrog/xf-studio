import type { FinishDescriptor } from "../../finish-catalogue";

/**
 * Help and tour words about which finishes can go into a mod, built from the finish catalogue the port
 * publishes (`authoring.finishCatalogue()`, whose export status mirrors the package route policy), so the
 * guidance never keeps its own copy (UI-44). Tour and topic data carry a token where the words go; the shell
 * fills it in with `withFinishText`. Pure: no DOM.
 */
export type FinishSummary = Pick<FinishDescriptor, "shortLabel" | "exportAdapter">;
/** Replaced by the Help topic's sentences: what goes into a mod, what builds as an experiment, what stays in the preview. */
export const FINISH_EXPORT_TOKEN = "{{finishes.export}}";
/** Replaced by a clause naming the finishes that go into a mod today ("Matte, Satin and Metallic go into your mod today"). */
export const FINISH_MOD_TOKEN = "{{finishes.mod}}";

type ExportGroups = Record<FinishDescriptor["exportAdapter"], string[]>;

function groups(catalogue: readonly FinishSummary[]): ExportGroups {
  const out: ExportGroups = { "flat-provisional": [], experimental: [], none: [] };
  for (const finish of catalogue) out[finish.exportAdapter].push(finish.shortLabel);
  return out;
}

/** "A", "A and B", "A, B and C". */
function list(names: readonly string[], bold: boolean) {
  const shown = names.map(name => bold ? `**${name}**` : name);
  return shown.length < 2 ? shown.join("") : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

export function finishExportHelp(catalogue: readonly FinishSummary[]): string {
  const { "flat-provisional": flat, experimental, none } = groups(catalogue);
  return [
    flat.length ? `${list(flat, true)} can go into your mod.` : "",
    experimental.length ? `${list(experimental, true)} can be built as experiments.` : "",
    none.length ? `${list(none, true)} ${none.length === 1 ? "is" : "are"} preview only for now: Check and Build leave those layers out and say so.` : "",
  ].filter(Boolean).join(" ");
}

export function exportableFinishClause(catalogue: readonly FinishSummary[]): string {
  const flat = groups(catalogue)["flat-provisional"];
  return flat.length ? `${list(flat, false)} ${flat.length === 1 ? "goes" : "go"} into your mod today` : "No finish goes into your mod yet";
}

/** Fill in the finish tokens of a tour step's or Help topic's text. */
export function withFinishText(body: string, catalogue: readonly FinishSummary[]): string {
  if (!body.includes("{{")) return body;
  return body.replaceAll(FINISH_EXPORT_TOKEN, finishExportHelp(catalogue)).replaceAll(FINISH_MOD_TOKEN, exportableFinishClause(catalogue));
}

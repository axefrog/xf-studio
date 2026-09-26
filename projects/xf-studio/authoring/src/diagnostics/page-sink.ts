/**
 * The page's one-line failure hook for app services (docs/diagnostics.md): `pageFailure(area, code, message, error)` logs a failure
 * a person may see to the host log, with a reference, and with `notify` has the shell show it once with "Report this problem".
 * The composition root installs the sink (`setPageDiagnostics`); without one (tests, tools) the console gets it, as before.
 * DOM-free.
 */
import type { DiagnosticLevel } from "./model";

export type PageDiagnosticsSink = (area: string, code: string, message: string, error: unknown,
  options: { notify?: boolean; level?: DiagnosticLevel; source?: string }) => string | null;
let sink: PageDiagnosticsSink | null = null;
export function setPageDiagnostics(next: PageDiagnosticsSink | null) { sink = next; }

export function pageFailure(area: string, code: string, message: string, error?: unknown,
  options: { notify?: boolean; level?: DiagnosticLevel; source?: string } = {}): string | null {
  if (sink) try { return sink(area, code, message, error, options); } catch { /* Fall back to the console. */ }
  console.error(`${area}/${code}: ${message}`, error ?? "");
  return null;
}

/**
 * Captures `tests/golden/history-parity.json` from the code checked out. It was run once on the code before the history
 * service (2e0708a6); rerun it only to review a deliberate change:
 *   bun tests/fixtures/capture-history-golden.ts 2e0708a6
 */
import { writeFileSync } from "node:fs";
import { documentSession, lookSession, persistenceSession, redoValiditySession, routedSession, viewSession } from "./history-parity";
import { canonical } from "./workspace-observable";

const golden = { capturedFrom: process.argv[2] ?? "working tree", look: lookSession(), redoValidity: redoValiditySession(), view: viewSession(),
  documents: documentSession(), routed: routedSession(), persistence: persistenceSession() };
writeFileSync(new URL("../golden/history-parity.json", import.meta.url), JSON.stringify(JSON.parse(canonical(golden)), null, 1) + "\n");
console.log(Object.fromEntries(Object.entries(golden).map(([key, value]) => [key, Array.isArray(value) ? value.length : value])));

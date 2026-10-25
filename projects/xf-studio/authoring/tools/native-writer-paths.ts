/** Path containment plus fresh, exclusive diagnostics; canonical paths alone do not detect hard links. */
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export function canonicalPath(path: string): string {
  let ancestor = resolve(path);
  const tail: string[] = [];
  while (!lstatSync(ancestor, { throwIfNoEntry: false })) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw Error("No existing ancestor for path");
    tail.unshift(basename(ancestor)); ancestor = parent;
  }
  return join(realpathSync.native(ancestor), ...tail);
}

export function requireFreshDiagnosticPath(output: string): void {
  if (lstatSync(output, { throwIfNoEntry: false })) throw Error("Diagnostics directory must not exist; choose a fresh output path.");
}

export function createDiagnosticDirectory(output: string, inputs: string[]): void {
  requireFreshDiagnosticPath(output);
  refuseInputOverlap(output, inputs);
  // Non-recursive mkdir atomically rejects existing entries, including dangling links.
  mkdirSync(output);
}

export function writeDiagnosticFile(path: string, data: string | Uint8Array): void {
  writeFileSync(path, data, { flag: "wx" });
}

export function refuseInputOverlap(output: string, inputs: string[]): void {
  const out = canonicalPath(output);
  const within = (a: string, b: string) => {
    const part = relative(a, b);
    return part === "" || (!isAbsolute(part) && part !== ".." && !part.startsWith("..\\") && !part.startsWith("../"));
  };
  for (const input of inputs) {
    const source = canonicalPath(input);
    if (within(out, source) || within(source, out)) throw Error("Output overlaps an oracle input; choose a separate diagnostics folder.");
  }
}

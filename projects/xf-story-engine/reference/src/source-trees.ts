// Shared, in-memory TypeScript parsing for the source audits. The audits need a parser only: TypeScript 5's
// in-process `createSourceFile` (package alias `ts-parser`) owns lexical context, including regex literals and nested
// template expressions. TypeScript 7's compiler service runs a separate process over stdio, which Bun on Linux CI
// cannot drive.
import ts from 'ts-parser';
export interface SourceFile {
  path: string;
  text: string;
}
export function withSourceTrees<T>(files: SourceFile[], fn: (trees: ts.SourceFile[]) => T): T {
  return fn(files.map((f, n) => ts.createSourceFile('f' + n + '.ts', f.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)));
}

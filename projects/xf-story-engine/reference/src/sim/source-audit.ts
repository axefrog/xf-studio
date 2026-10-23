// Syntax-aware source audits. TypeScript owns lexical context, including regex literals and nested template expressions.
import * as ts from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import { resolve } from 'node:path';
import type { Finding, SourceFile } from './audit.ts';

export type StringMode = 'blank' | 'keep' | 'mark';
export const MARK_OPEN = '\u0001';
export const MARK_CLOSE = '\u0002';
const isStringLiteralLike = (node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
// TypeScript 7 exposes parsing through its compiler service. This virtual project is entirely in memory.
function parsed<T>(files: SourceFile[], fn: (trees: ts.SourceFile[]) => T): T {
  const root = resolve('__xf_source_audit__').replaceAll('\\', '/');
  const config = root + '/tsconfig.json';
  const paths = files.map((_, n) => root + '/f' + n + '.ts');
  const contents = Object.fromEntries(paths.map((p, n) => [p, files[n]!.text]));
  contents[config] = JSON.stringify({ compilerOptions: { noLib: true, noResolve: true }, files: paths });
  const fs = createVirtualFileSystem(contents);
  const api = new API({ fs: { ...fs, readFile: (p) => fs.readFile!(p) ?? null } });
  try {
    using snap = api.updateSnapshot({ openProjects: [config] });
    const project = snap.getProject(config);
    if (!project) throw new Error('source audit: compiler project unavailable');
    return fn(paths.map((p) => { const file = project.program.getSourceFile(p); if (!file) throw new Error('source audit: parse failed'); return file; }));
  } finally { api.close(); }
}

/** A syntax view for diagnostics/tests only. The lint walks AST nodes, never this text. */
export function codeOf(text: string, strings: boolean | StringMode = 'blank'): string {
  const mode = strings === true ? 'keep' : strings === false ? 'blank' : strings;
  return parsed([{ path: 'view.ts', text }], ([file]) => {
    const edits: Array<{ start: number; end: number; literal: boolean }> = [];
    const visit = (node: ts.Node): void => {
      for (const c of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []) edits.push({ start: c.pos, end: c.end, literal: false });
      for (const c of ts.getTrailingCommentRanges(text, node.end) ?? []) edits.push({ start: c.pos, end: c.end, literal: false });
      if (isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || node.kind === ts.SyntaxKind.RegularExpressionLiteral) edits.push({ start: node.getStart(file!), end: node.end, literal: true });
      node.forEachChild(visit);
    };
    visit(file!);
    edits.sort((a, b) => a.start - b.start || b.end - a.end);
    let out = '', at = 0;
    for (const e of edits) {
      if (e.start < at) continue;
      const raw = text.slice(e.start, e.end);
      out += text.slice(at, e.start) + (e.literal && mode !== 'blank' ? mode === 'mark' ? MARK_OPEN + raw + MARK_CLOSE : raw : raw.replace(/[^\r\n]/g, ' '));
      at = e.end;
    }
    return out + text.slice(at);
  });
}

export const COARSE_FILES = ['proc-events.ts', 'proc-stocks.ts', 'proc-mirror.ts', 'proc-norms.ts', 'proc-groups.ts', 'ledger.ts'];
const EXEMPT: Record<string, string[]> = {
  'make-tables.ts': ['arithmetic', 'keys', 'no-load-reads'],
  'port.ts': ['no-load-reads'],
  'slices.ts': ['keys'],
};
const MATH = new Set(['exp', 'expm1', 'pow', 'log', 'log1p', 'log2', 'log10', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'cbrt', 'hypot']);
const CLOCK = new Set(['epoch', 'loadCount', 'loadClass', 'playClock', 'playTotal', 'wallClock', 'hrtime']);
const DEMAND = new Set(['gameOwnedNow', 'demanded', 'demandTier', 'demandRoots', 'vFrames', 'demandLookback']);

function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
  return node;
}
function literal(node: ts.Node | undefined): string | undefined {
  return node && isStringLiteralLike(node) ? node.text : undefined;
}
function property(node: ts.Node): { object: ts.Expression; name: string } | undefined {
  if (ts.isPropertyAccessExpression(node)) return { object: unwrap(node.expression), name: node.name.text };
  if (ts.isElementAccessExpression(node)) {
    const name = literal(node.argumentExpression);
    if (name !== undefined) return { object: unwrap(node.expression), name };
  }
  return undefined;
}
const identifier = (node: ts.Node, name: string): boolean => ts.isIdentifier(node) && node.text === name;
function numeric(input: ts.Expression): boolean {
  const node = unwrap(input);
  return ts.isNumericLiteral(node) || ts.isPrefixUnaryExpression(node) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(node.operator) && numeric(node.operand);
}
function contains(node: ts.Node, predicate: (n: ts.Node) => boolean): boolean {
  if (predicate(node)) return true;
  return node.forEachChild((child) => contains(child, predicate) || undefined) === true;
}

/** Evaluate only expressions whose truth for a meta event follows directly from their syntax. Unknown is never accepted as a guard. */
function metaValue(input: ts.Expression, event: string): boolean | string | undefined {
  const node = unwrap(input);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  const str = literal(node);
  if (str !== undefined) return str;
  if (ts.isCallExpression(node)) {
    const p = property(unwrap(node.expression));
    const kind = p && property(p.object);
    if (p?.name === 'startsWith' && kind?.name === 'kind' && identifier(kind.object, event) && node.arguments.length === 1 && literal(node.arguments[0]) === 'meta:') return true;
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const v = metaValue(node.operand, event);
    if (v !== undefined) return !v;
  }
  if (ts.isTemplateExpression(node)) {
    let s = node.head.text;
    for (const span of node.templateSpans) {
      const v = metaValue(span.expression, event);
      if (v === undefined) return undefined;
      s += String(v) + span.literal.text;
    }
    return s;
  }
  if (ts.isBinaryExpression(node)) {
    const a = metaValue(node.left, event), b = metaValue(node.right, event);
    switch (node.operatorToken.kind) {
      case ts.SyntaxKind.BarBarToken: return a === true || b === true ? true : a === false ? b : b === false ? a : undefined;
      case ts.SyntaxKind.AmpersandAmpersandToken: return a === false || b === false ? false : a === true ? b : b === true ? a : undefined;
      case ts.SyntaxKind.EqualsEqualsEqualsToken: return a !== undefined && b !== undefined ? a === b : undefined;
      case ts.SyntaxKind.ExclamationEqualsEqualsToken: return a !== undefined && b !== undefined ? a !== b : undefined;
    }
  }
  return undefined;
}
function returns(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement)) return statement.expression === undefined;
  return ts.isBlock(statement) && statement.statements.length === 1 && returns(statement.statements[0]!);
}
function guardsMeta(file: ts.SourceFile, method: string): boolean {
  const methods: ts.MethodDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === method) methods.push(node);
    node.forEachChild(visit);
  };
  visit(file);
  if (methods.length !== 1) return false;
  const m = methods[0]!, param = m.parameters[0]?.name, first = m.body?.statements[0];
  return !!param && ts.isIdentifier(param) && !!first && ts.isIfStatement(first) && metaValue(first.expression, param.text) === true && returns(first.thenStatement);
}

export function lintSources(files: SourceFile[]): Finding[] {
  const out: Finding[] = [];
  return parsed(files, (trees) => {
    for (const [index, f] of files.entries()) {
      if (f.path === 'audit.ts' || f.path === 'source-audit.ts') continue;
      const file = trees[index]!;
      const coarse = COARSE_FILES.includes(f.path), exempt = EXEMPT[f.path] ?? [];
      const add = (audit: string, node: ts.Node, detail: string): void => {
        if (!exempt.includes(audit)) out.push({ audit, where: `${f.path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`, detail });
      };
      const visit = (node: ts.Node): void => {
        const p = property(node);
        if (ts.isCallExpression(node)) {
          const fn = unwrap(node.expression), prop = property(fn);
          const name = ts.isIdentifier(fn) ? fn.text : prop?.name;
          if (prop && identifier(prop.object, 'Math') && MATH.has(prop.name)) add('arithmetic', node, `Math.${prop.name} in a decision`);
          if (name && ['gamma', 'lgamma', 'fma'].includes(name)) add('arithmetic', node, `${name}: a gamma function or fused multiply-add`);
          if (f.path !== 'keys.ts' && name && (['rand', 'procRand'].includes(name) && (!prop || identifier(prop.object, 'pctx')) || name === 'pr' && !prop)) add('keys', node, `${name} called outside the key registry`);
          if (name === 'feedAfter') {
            const cursor = node.arguments[1] && property(node.arguments[1]);
            const owner = cursor && property(cursor.object);
            if (owner?.name !== 'cursors') add('feeds', node, 'a feed read with no cursor in the reader\'s state');
          }
          if (prop?.name === 'activeOf') {
            // Keep the existing local memorable-read rule, over syntax nodes rather than text in comments/strings.
            const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line;
            const nearby = (n: ts.Node): boolean => ts.isIdentifier(n) && n.text === 'memorable' && (() => { const l = file.getLineAndCharacterOfPosition(n.getStart(file)).line; return l >= line && l < line + 3; })();
            if (!contains(file, nearby)) add('forbidden-policy', node, 'reads beliefs and does not test whether they are memorable');
          }
          if (name && ['pin', 'reading'].includes(name) && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) checkPin(node.arguments[0]);
        }
        if (ts.isObjectLiteralExpression(node) && node.properties.some((n) => ts.isPropertyAssignment(n) && n.name.getText(file) === 'op' && literal(n.initializer) === 'pin')) checkPin(node);
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskToken && !(numeric(node.left) && numeric(node.right))) add('arithmetic', node, 'the ** operator (a power) in a decision');
        if (ts.isNewExpression(node) && identifier(node.expression, 'Date')) add('no-load-reads', node, 'new Date: a wall clock');
        if (p && ['now', 'random'].includes(p.name) && ts.isIdentifier(p.object) && ['Date', 'performance', 'Math'].includes(p.object.text)) add('no-load-reads', node, `${p.object.text}.${p.name}: a clock or random source`);
        if (ts.isIdentifier(node)) {
          const name = node.text;
          if (CLOCK.has(name)) add('no-load-reads', node, `${name}: a load or clock source`);
          if (coarse && DEMAND.has(name)) add('coarse-independence', node, `${name} read by a process of tier 0 to 2`);
          if (/^(director|orientation|bond)$/i.test(name)) add('firewall', node, `${name}: outside S1's read sets`);
          if (/^(heritage|gender|ethnic\w*|nationality|nameOrigin)$/i.test(name)) add('source-lint', node, `${name}: an attribute that never feeds a decision`);
          if (/^(guilt\w*|streak\w*|nsfw|explicit)$/i.test(name)) add('forbidden-policy', node, `${name}: a forbidden mechanic`);
          if (coarse && name === 'vState') {
            const access = node.parent && property(node.parent) ? node.parent : node;
            const call = access.parent;
            if (!call || !ts.isCallExpression(call) || call.arguments[0] !== access || !['district', 'wanted'].includes(literal(call.arguments[1]) ?? '')) add('coarse-independence', node, 'V\'s mirrored state used other than for district or wanted');
          }
        }
        if (coarse && ['cell', 'position'].includes(literal(node) ?? '')) add('coarse-independence', node, 'V\'s cell or position named by a coarse process');
        node.forEachChild(visit);
      };
      const checkPin = (node: ts.ObjectLiteralExpression): void => {
        const n = node.properties.find((n): n is ts.PropertyAssignment => ts.isPropertyAssignment(n) && n.name.getText(file) === 'node');
        if (n && (identifier(n.initializer, 'v') || property(n.initializer)?.name === 'v')) add('v-exclusion', n, 'a write on V');
      };
      visit(file);
      if (f.path === 'policies.ts') for (const method of ['heardEvent', 'absorb']) {
        if (!guardsMeta(file, method)) out.push({ audit: 'meta-inert', where: `policies.ts:${method}`, detail: `${method} must begin with a conditional that rejects every meta: event` });
      }
    }
    return out;
  });
}

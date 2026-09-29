/**
 * The model catalogue (`projects/xf-studio/models/`, README there): every model file is valid against its kind's JSON
 * Schema, every `<kind>:<id>` reference resolves, IDs are unique, the models agree with each other (a driver serves the
 * requests that name it, a process is started by its own driver), every module in the direct-read and singleton ratchets
 * is replaced by some model or excluded with a reason, and INDEX.md is current. The schemas use a small subset of JSON
 * Schema, validated here by a minimal validator (no dependency).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPABILITIES, CATALOGUE_FILES, catalogueStrays, KINDS, MODELS_DIR, loadModels, renderIndex, type Model } from "../tools/models-index";

const SCHEMA_DIR = join(MODELS_DIR, "schema");
const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const TESTS = fileURLToPath(new URL("./", import.meta.url));
const REF = /^(type|source|sink|operator|driver|process|runtime|request|action|panel|flow):([a-z0-9]+(?:-[a-z0-9]+)*)$/;
/** A string that starts like a reference (`<kind>:`); one that doesn't then match `REF` is a malformed reference. */
const REF_LIKE = /^(type|source|sink|operator|driver|process|runtime|request|action|panel|flow):/;

// ---------------------------------------------------------------------------------------------------------------
// A minimal JSON Schema validator: the keywords the catalogue's schemas use, and nothing else.
// ---------------------------------------------------------------------------------------------------------------

type Schema = boolean | { readonly [keyword: string]: unknown };
const SUPPORTED = new Set(["$schema", "$id", "$defs", "$ref", "title", "description", "type", "properties", "required", "additionalProperties",
  "patternProperties", "items", "minItems", "maxItems", "uniqueItems", "enum", "const", "pattern", "minLength", "maxLength", "minimum", "maximum",
  "minProperties", "maxProperties", "anyOf", "oneOf", "allOf", "if", "then", "else"]);
const SCHEMAS: Record<string, Schema> = Object.fromEntries(readdirSync(SCHEMA_DIR).filter(name => name.endsWith(".schema.json"))
  .map(name => [name, JSON.parse(readFileSync(join(SCHEMA_DIR, name), "utf8")) as Schema]));

const typeOf = (value: unknown) => value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function resolveRef(ref: string, file: string): { schema: Schema; file: string } {
  const [target, pointer = ""] = ref.split("#");
  const at = target || file;
  let node: unknown = SCHEMAS[at];
  if (node === undefined) throw Error(`unknown schema file ${at}`);
  for (const part of pointer.split("/").filter(Boolean)) node = (node as Record<string, unknown>)[part];
  if (node === undefined) throw Error(`unresolved $ref ${ref} in ${file}`);
  return { schema: node as Schema, file: at };
}

/** The errors of `value` against `schema` (read from `file`), each with its JSON path. */
export function validate(value: unknown, schema: Schema, file: string, path = "$"): string[] {
  if (schema === true) return [];
  if (schema === false) return [`${path}: not allowed`];
  const errors: string[] = [];
  for (const keyword of Object.keys(schema)) if (!SUPPORTED.has(keyword)) errors.push(`${path}: schema keyword ${keyword} is not supported`);
  if (typeof schema.$ref === "string") { const { schema: target, file: at } = resolveRef(schema.$ref, file); errors.push(...validate(value, target, at, path)); }
  const t = typeOf(value);
  if (schema.type !== undefined) {
    const types = [schema.type].flat() as string[];
    if (!types.some(type => type === t || (type === "number" && t === "integer"))) return [...errors, `${path}: expected ${types.join(" or ")}, got ${t}`];
  }
  if (schema.enum && !(schema.enum as unknown[]).some(item => same(item, value))) errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  if ("const" in schema && !same(schema.const, value)) errors.push(`${path}: expected ${JSON.stringify(schema.const)}`);
  if (t === "string") {
    const text = value as string;
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(text)) errors.push(`${path}: "${text}" doesn't match ${schema.pattern}`);
    if (typeof schema.minLength === "number" && text.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (typeof schema.maxLength === "number" && text.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
  }
  if (t === "integer" || t === "number") {
    if (typeof schema.minimum === "number" && (value as number) < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
    if (typeof schema.maximum === "number" && (value as number) > schema.maximum) errors.push(`${path}: above ${schema.maximum}`);
  }
  if (t === "array") {
    const items = value as unknown[];
    if (typeof schema.minItems === "number" && items.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (typeof schema.maxItems === "number" && items.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(items.map(item => JSON.stringify(item))).size !== items.length) errors.push(`${path}: items repeat`);
    if (schema.items !== undefined) items.forEach((item, i) => errors.push(...validate(item, schema.items as Schema, file, `${path}[${i}]`)));
  }
  if (t === "object") {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object);
    for (const key of (schema.required as string[] | undefined) ?? []) if (!(key in object)) errors.push(`${path}: missing ${key}`);
    if (typeof schema.minProperties === "number" && keys.length < schema.minProperties) errors.push(`${path}: fewer than ${schema.minProperties} members`);
    if (typeof schema.maxProperties === "number" && keys.length > schema.maxProperties) errors.push(`${path}: more than ${schema.maxProperties} members`);
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    const patterns = Object.entries((schema.patternProperties ?? {}) as Record<string, Schema>).map(([pattern, sub]) => [new RegExp(pattern, "u"), sub] as const);
    for (const key of keys) {
      const at = `${path}.${key}`;
      let matched = false;
      if (key in properties) { matched = true; errors.push(...validate(object[key], properties[key], file, at)); }
      for (const [pattern, sub] of patterns) if (pattern.test(key)) { matched = true; errors.push(...validate(object[key], sub, file, at)); }
      if (!matched && schema.additionalProperties !== undefined) errors.push(...validate(object[key], schema.additionalProperties as Schema, file, at));
    }
  }
  for (const sub of (schema.allOf as Schema[] | undefined) ?? []) errors.push(...validate(value, sub, file, path));
  if (schema.anyOf && !(schema.anyOf as Schema[]).some(sub => !validate(value, sub, file, path).length)) errors.push(`${path}: matches none of the alternatives`);
  if (schema.oneOf && (schema.oneOf as Schema[]).filter(sub => !validate(value, sub, file, path).length).length !== 1) errors.push(`${path}: must match exactly one alternative`);
  if (schema.if !== undefined) {
    const holds = !validate(value, schema.if as Schema, file, path).length;
    const branch = holds ? schema.then : schema.else;
    if (branch !== undefined) errors.push(...validate(value, branch as Schema, file, path));
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------------------------------------------

const ENTRIES = loadModels();
const MODELS = ENTRIES.map(entry => entry.model);
const BY_REF = new Map(MODELS.map(model => [`${model.kind}:${model.id}`, model]));
const of = <T = Record<string, unknown>>(kind: string) => MODELS.filter(model => model.kind === kind) as unknown as (Model & T)[];
const refsIn = (value: unknown, out: string[] = []): string[] => {
  if (typeof value === "string") { if (REF.test(value)) out.push(value); }
  else if (Array.isArray(value)) for (const item of value) refsIn(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) refsIn(item, out);
  return out;
};
/** Strings that start like a reference (`<kind>:`) but aren't one. */
const malformedRefs = (value: unknown, out: string[] = []): string[] => {
  if (typeof value === "string") { if (REF_LIKE.test(value) && !REF.test(value)) out.push(value); }
  else if (Array.isArray(value)) for (const item of value) malformedRefs(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) malformedRefs(item, out);
  return out;
};
/** The requests some other model raises: a driver's or flow's `raises`, an action's effect, a flow's steps, a fault's route. A model never raises itself. */
function raisedRequests(models: readonly Model[]): Set<string> {
  const raised = new Set<string>();
  for (const model of models) {
    const self = `${model.kind}:${model.id}`;
    const add = (ref: string) => { if (ref !== self) raised.add(ref); };
    for (const ref of (model.raises as string[] | undefined) ?? []) add(ref);
    const effect = model.effect as { raises?: string } | undefined;
    if (effect?.raises) add(effect.raises);
    for (const step of (model.steps as { model: string }[] | undefined) ?? []) add(step.model);
    for (const item of (model.faults as { goesTo: string }[] | undefined) ?? []) add(item.goesTo);
  }
  return raised;
}

/** The members of each kind that hold JSON Schemas of plain data. */
const SCHEMA_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  source: ["entry"], sink: ["input"], operator: ["params", "output"], process: ["progress", "result", "failure"],
  request: ["goal", "accepts"], action: ["input"],
};
/** The JSON Schemas a model carries, with where. */
function innerSchemas(model: Model): [string, unknown][] {
  const out: [string, unknown][] = (SCHEMA_MEMBERS[model.kind] ?? []).map(member => [member, model[member]]);
  if (model.kind === "runtime") for (const [i, query] of ((model.query as { input: unknown; output: unknown }[]) ?? []).entries())
    out.push([`query[${i}].input`, query.input], [`query[${i}].output`, query.output]);
  if (model.kind === "type") {
    const walk = (spec: Record<string, unknown>, at: string) => {
      if (spec.shape !== undefined) out.push([`${at}.shape`, spec.shape]);
      if (spec.of) walk(spec.of as Record<string, unknown>, `${at}.of`);
    };
    for (const [name, spec] of Object.entries(model.fields as Record<string, Record<string, unknown>>)) walk(spec, `fields.${name}`);
  }
  return out;
}
/** An inner schema uses only supported keywords, and its $refs point into the shared shapes. */
function checkInner(schema: unknown, at: string): string[] {
  if (typeof schema === "boolean") return [];
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [`${at}: not a schema`];
  const errors: string[] = [];
  const s = schema as Record<string, unknown>;
  for (const key of Object.keys(s)) if (!SUPPORTED.has(key) && !key.startsWith("x-") && key !== "format") errors.push(`${at}: keyword ${key}`);
  if (typeof s.$ref === "string") {
    if (!s.$ref.startsWith("shapes.schema.json#/$defs/")) errors.push(`${at}: $ref ${s.$ref} must point into shapes.schema.json`);
    else try { resolveRef(s.$ref, "shapes.schema.json"); } catch (error) { errors.push(`${at}: ${(error as Error).message}`); }
  }
  for (const key of ["items", "additionalProperties", "if", "then", "else"]) if (s[key] !== undefined) errors.push(...checkInner(s[key], `${at}.${key}`));
  for (const key of ["properties", "patternProperties", "$defs"]) for (const [name, sub] of Object.entries((s[key] ?? {}) as Record<string, unknown>)) errors.push(...checkInner(sub, `${at}.${key}.${name}`));
  for (const key of ["anyOf", "oneOf", "allOf"]) for (const [i, sub] of ((s[key] ?? []) as unknown[]).entries()) errors.push(...checkInner(sub, `${at}.${key}[${i}]`));
  return errors;
}

describe("the validator", () => {
  const probe = { kind: "type", id: "probe", owner: "platform", summary: "A probe type for the validator's own test.", status: "target",
    class: "authored", schema: "1", stream: "delta", fields: { name: { kind: "value" } } };
  test("accepts a valid model and refuses broken ones", () => {
    expect(validate(probe, SCHEMAS["type.schema.json"], "type.schema.json")).toEqual([]);
    expect(validate({ ...probe, colour: 1 }, SCHEMAS["type.schema.json"], "type.schema.json").length).toBeGreaterThan(0);
    expect(validate({ ...probe, "x-note": "reviewers only" }, SCHEMAS["type.schema.json"], "type.schema.json")).toEqual([]);
    expect(validate({ ...probe, id: "Not_Kebab" }, SCHEMAS["type.schema.json"], "type.schema.json").length).toBeGreaterThan(0);
    expect(validate({ ...probe, status: "both" }, SCHEMAS["type.schema.json"], "type.schema.json").length).toBeGreaterThan(0);
    expect(validate({ ...probe, fields: { r: { kind: "ref" } } }, SCHEMAS["type.schema.json"], "type.schema.json").length).toBeGreaterThan(0);
    expect(checkInner({ type: "object", properties: { a: { $ref: "shapes.schema.json#/$defs/nope" } } }, "probe").length).toBe(1);
  });

  test("enforces maxLength (CORE-147)", () => {
    expect(validate("abc", { type: "string", maxLength: 3 }, "probe")).toEqual([]);
    expect(validate("abcd", { type: "string", maxLength: 3 }, "probe")).toEqual(["$: longer than 3"]);
  });

  test("the catalogue checks refuse strays, self-raised requests and malformed references (CORE-147)", () => {
    const dir = mkdtempSync(join(tmpdir(), "xfs-models-"));
    try {
      for (const kind of [...KINDS, "schema"]) mkdirSync(join(dir, kind));
      for (const name of CATALOGUE_FILES) writeFileSync(join(dir, name), "");
      writeFileSync(join(dir, "request", "probe.json"), JSON.stringify({ kind: "request", id: "probe" }));
      expect(catalogueStrays(dir)).toEqual([]);
      mkdirSync(join(dir, "drivers"));
      writeFileSync(join(dir, "drivers", "misfiled.json"), "{}");
      writeFileSync(join(dir, "request", "notes.txt"), "");
      writeFileSync(join(dir, "schema", "extra.json"), "{}");
      writeFileSync(join(dir, "stray.json"), "{}");
      expect(catalogueStrays(dir)).toEqual(["drivers", "request/notes.txt", "schema/extra.json", "stray.json"]);
      expect(() => loadModels(dir)).toThrow("drivers");
    } finally { rmSync(dir, { recursive: true, force: true }); }
    const request = { kind: "request", id: "loop", owner: "platform", summary: "", status: "target", faults: [{ goesTo: "request:loop" }] } as unknown as Model;
    expect(raisedRequests([request]).has("request:loop")).toBe(false);
    expect(raisedRequests([request, { ...request, id: "other" } as Model]).has("request:loop")).toBe(true);
    expect(malformedRefs({ a: "driver:ok-one", b: ["driver:Bad_One", "request:", "type:x y"], c: "a driver: not a reference" }))
      .toEqual(["driver:Bad_One", "request:", "type:x y"]);
  });
});

describe("the model catalogue", () => {
  test("has models of every kind", () => {
    for (const kind of KINDS) expect([kind, of(kind).length > 0]).toEqual([kind, true]);
  });

  test("every file is valid against its kind's schema, and named by its ID", () => {
    const errors: string[] = [];
    for (const { file, model } of ENTRIES) {
      const [folder, name] = file.split("/");
      if (model.kind !== folder) errors.push(`${file}: kind ${model.kind} in the ${folder} folder`);
      if (`${model.id}.json` !== name) errors.push(`${file}: id ${model.id}`);
      errors.push(...validate(model, SCHEMAS[`${folder}.schema.json`], `${folder}.schema.json`).map(error => `${file} ${error}`));
      for (const [at, schema] of innerSchemas(model)) errors.push(...checkInner(schema, `${file} ${at}`));
    }
    expect(errors).toEqual([]);
  });

  test("every reference resolves and is well formed, and IDs are unique within a kind", () => {
    expect(new Set(BY_REF.keys()).size).toBe(MODELS.length);
    expect(MODELS.flatMap(model => malformedRefs(model).map(ref => `${model.kind}:${model.id} → ${ref}`))).toEqual([]);
    const broken = MODELS.flatMap(model => refsIn(model).filter(ref => !BY_REF.has(ref)).map(ref => `${model.kind}:${model.id} → ${ref}`));
    expect(broken).toEqual([]);
  });

  test("drivers, processes and requests agree with each other", () => {
    const errors: string[] = [];
    const drivers = of<{ serves: string[]; starts: string[] }>("driver");
    const requests = of<{ servedBy: string[] }>("request");
    const processes = of<{ driver: string }>("process");
    for (const driver of drivers) {
      for (const request of driver.serves) if (!(BY_REF.get(request) as { servedBy?: string[] } | undefined)?.servedBy?.includes(`driver:${driver.id}`))
        errors.push(`driver:${driver.id} serves ${request}, which doesn't name it`);
      for (const process of driver.starts) if ((BY_REF.get(process) as { driver?: string } | undefined)?.driver !== `driver:${driver.id}`)
        errors.push(`driver:${driver.id} starts ${process}, whose driver is another`);
    }
    for (const request of requests) for (const driver of request.servedBy)
      if (!(BY_REF.get(driver) as { serves?: string[] } | undefined)?.serves?.includes(`request:${request.id}`)) errors.push(`request:${request.id} names ${driver}, which doesn't serve it`);
    for (const process of processes) if (!(BY_REF.get(process.driver) as { starts?: string[] } | undefined)?.starts?.includes(`process:${process.id}`))
      errors.push(`process:${process.id} isn't started by its driver ${process.driver}`);
    expect(errors).toEqual([]);
  });

  test("every runtime, sink, source and operator is used by some other model", () => {
    const used = new Set(MODELS.flatMap(model => refsIn(Object.fromEntries(Object.entries(model).filter(([key]) => key !== "id")))
      .filter(ref => ref !== `${model.kind}:${model.id}`)));
    const unused = MODELS.filter(model => ["runtime", "sink", "source", "operator"].includes(model.kind) && !used.has(`${model.kind}:${model.id}`))
      .map(model => `${model.kind}:${model.id}`);
    expect(unused).toEqual([]);
  });

  test("every request is raised by a driver, an action, a fault's route or a flow, unless it is a root raised from outside", () => {
    const raised = raisedRequests(MODELS);
    const orphans = of<{ root?: boolean }>("request").filter(request => !request.root && !raised.has(`request:${request.id}`)).map(request => request.id);
    expect(orphans).toEqual([]);
  });

  test("every driver's run traces to a root request: each is reachable through what drivers raise", () => {
    const drivers = of<{ serves: string[]; raises?: string[] }>("driver");
    const servedBy = new Map<string, string[]>();
    for (const request of of<{ servedBy: string[] }>("request")) servedBy.set(`request:${request.id}`, request.servedBy);
    // Actions are the person's own requests: what they raise is rooted in the window that dispatched them.
    const frontier = [...of<{ root?: boolean }>("request").filter(request => request.root).map(request => `request:${request.id}`),
      ...of<{ effect: { raises?: string } }>("action").flatMap(action => action.effect.raises ? [action.effect.raises] : [])];
    const reached = new Set<string>();
    while (frontier.length) {
      const request = frontier.pop()!;
      for (const driver of servedBy.get(request) ?? []) {
        if (reached.has(driver)) continue;
        reached.add(driver);
        frontier.push(...((BY_REF.get(driver) as { raises?: string[] } | undefined)?.raises ?? []));
      }
    }
    expect(drivers.map(driver => `driver:${driver.id}`).filter(ref => !reached.has(ref))).toEqual([]);
  });

  test("x-friction records name a known capability in plain words", () => {
    const errors: string[] = [];
    for (const model of MODELS) {
      const friction = model["x-friction"];
      if (friction === undefined) continue;
      if (!Array.isArray(friction) || !friction.length) { errors.push(`${model.kind}:${model.id}: x-friction must be a non-empty list`); continue; }
      for (const item of friction as Record<string, unknown>[]) {
        if (Object.keys(item).sort().join() !== "capability,closes,gap") errors.push(`${model.kind}:${model.id}: x-friction items have gap, capability and closes`);
        if (!(String(item.capability) in CAPABILITIES)) errors.push(`${model.kind}:${model.id}: unknown capability ${item.capability}`);
        for (const key of ["gap", "closes"]) if (typeof item[key] !== "string" || (item[key] as string).length < 12) errors.push(`${model.kind}:${model.id}: x-friction ${key} is a plain sentence`);
      }
    }
    expect(errors).toEqual([]);
  });

  test("public text uses plain words: no internal row numbers", () => {
    const pattern = /\b(?:[STDPFR]|SRC)\d{1,3}\b/;
    const hits = ENTRIES.filter(({ model }) => pattern.test(JSON.stringify(model))).map(({ file }) => file);
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Coverage of the legacy code
// ---------------------------------------------------------------------------------------------------------------

/** The modules the direct-read ratchet grandfathers, read from its test's table. */
function ratchetModules(): string[] {
  const text = readFileSync(join(TESTS, "graph-direct-reads.test.ts"), "utf8");
  const block = text.slice(text.indexOf("const GRANDFATHERED"), text.indexOf("};", text.indexOf("const GRANDFATHERED")));
  return [...block.matchAll(/^\s*"([^"]+)":\s*\{/gm)].map(match => match[1]);
}
/** The modules the singleton ratchet lists. */
function singletonModules(): string[] {
  const text = readFileSync(join(TESTS, "graph-singletons-audit.test.ts"), "utf8");
  return [...text.matchAll(/modules:\s*\[([^\]]*)\]/g)].flatMap(match => [...match[1].matchAll(/"([^"]+)"/g)].map(item => item[1]));
}
type Exclusion = { readonly module: string; readonly reason: string };
const EXCLUSIONS = JSON.parse(readFileSync(join(MODELS_DIR, "coverage-exclusions.json"), "utf8")) as { readonly exclusions: readonly Exclusion[] };

describe("coverage of the legacy code", () => {
  const replaced = new Set(MODELS.flatMap(model => model.replaces ?? []));
  const excluded = new Map(EXCLUSIONS.exclusions.map(item => [item.module, item.reason]));
  const ratchets = [...new Set([...ratchetModules(), ...singletonModules()])].sort();

  test("the ratchet lists were read", () => {
    expect(ratchetModules().length).toBeGreaterThan(150);
    expect(singletonModules()).toContain("character-context-actions");
  });

  test("every module in the direct-read and singleton ratchets is replaced by some model, or excluded with a reason", () => {
    expect(ratchets.filter(module => !replaced.has(module) && !excluded.has(module))).toEqual([]);
  });

  test("exclusions are few, reasoned, current and not also replaced", () => {
    for (const item of EXCLUSIONS.exclusions) expect([item.module, item.reason.length >= 20]).toEqual([item.module, true]);
    expect(EXCLUSIONS.exclusions.filter(item => !ratchets.includes(item.module)).map(item => item.module)).toEqual([]);
    expect(EXCLUSIONS.exclusions.filter(item => replaced.has(item.module)).map(item => item.module)).toEqual([]);
  });

  test("every replaced module exists", () => {
    const missing = [...replaced].filter(module => !existsSync(join(SRC, `${module}.ts`)) && !existsSync(join(SRC, `${module}.js`))).sort();
    expect(missing).toEqual([]);
  });

  test("INDEX.md is current (bun tools/models-index.ts)", () => {
    expect(readFileSync(join(MODELS_DIR, "INDEX.md"), "utf8")).toBe(renderIndex(MODELS));
  });
});

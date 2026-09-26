// A small JSON Schema subset: exactly what the command catalogue uses, so every frontend can
// publish the same schema (MCP inputSchema, CLI help, session-script checks) and the command API
// can validate input before anything reaches the game.
//
// Supported: type (object, number, integer, string, boolean, array), properties, required,
// additionalProperties: false, enum, minimum, maximum, minLength, maxLength, pattern, items,
// minItems, maxItems, description, default (documentation only).

export type JsonSchema = {
  type: "object" | "number" | "integer" | "string" | "boolean" | "array";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: false;
  enum?: readonly (string | number)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  default?: unknown;
};

/** Returns plain-language problems with `value`, or an empty list when it matches. */
export function validate(schema: JsonSchema, value: unknown, path = "input"): string[] {
  const problems: string[] = [];
  const where = path === "input" ? "The input" : `"${path.replace(/^input\./, "")}"`;
  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        problems.push(`${where} must be an object.`);
        break;
      }
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!Object.hasOwn(record, key) || record[key] === undefined) problems.push(`"${key}" is required.`);
      }
      for (const [key, child] of Object.entries(record)) {
        // Own properties only: "constructor", "toString" or "__proto__" must not match Object.prototype.
        const childSchema = schema.properties && Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
        if (!childSchema) {
          if (schema.additionalProperties === false) problems.push(`"${key}" is not a known option.`);
          continue;
        }
        if (child === undefined) continue;
        problems.push(...validate(childSchema, child, `${path}.${key}`));
      }
      break;
    }
    case "number":
    case "integer": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        problems.push(`${where} must be a number.`);
        break;
      }
      if (schema.type === "integer" && !Number.isInteger(value)) problems.push(`${where} must be a whole number.`);
      if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${where} must be at least ${schema.minimum}.`);
      if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${where} must be at most ${schema.maximum}.`);
      if (schema.enum && !schema.enum.includes(value)) problems.push(`${where} must be one of ${schema.enum.join(", ")}.`);
      break;
    }
    case "string": {
      if (typeof value !== "string") {
        problems.push(`${where} must be text.`);
        break;
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) problems.push(`${where} is too short.`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) problems.push(`${where} is too long (at most ${schema.maxLength} characters).`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) problems.push(`${where} has characters that aren't allowed.`);
      if (schema.enum && !schema.enum.includes(value)) problems.push(`${where} must be one of: ${schema.enum.join(", ")}.`);
      break;
    }
    case "boolean":
      if (typeof value !== "boolean") problems.push(`${where} must be true or false.`);
      break;
    case "array": {
      if (!Array.isArray(value)) {
        problems.push(`${where} must be a list.`);
        break;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(`${where} needs at least ${schema.minItems} items.`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) problems.push(`${where} takes at most ${schema.maxItems} items.`);
      if (schema.items) value.forEach((item, i) => problems.push(...validate(schema.items!, item, `${path}[${i}]`)));
      break;
    }
  }
  return problems;
}

// Shorthands for the catalogue.
export const obj = (properties: Record<string, JsonSchema> = {}, required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});
export const num = (description: string, minimum?: number, maximum?: number): JsonSchema => ({
  type: "number",
  description,
  ...(minimum !== undefined ? { minimum } : {}),
  ...(maximum !== undefined ? { maximum } : {}),
});
export const int = (description: string, minimum?: number, maximum?: number): JsonSchema => ({
  ...num(description, minimum, maximum),
  type: "integer",
});
export const bool = (description: string): JsonSchema => ({ type: "boolean", description });
export const str = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: "string", description, ...extra });
export const oneOf = (description: string, values: readonly string[]): JsonSchema => ({ type: "string", description, enum: values });

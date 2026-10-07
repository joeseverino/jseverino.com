// Validates the JSON Schema subset the repo uses (type, properties, required, additionalProperties: false,
// items, enum, const, pattern, minLength, minimum, minItems, maxItems, local $ref). Any other keyword is an error.
const KNOWN = new Set([
  '$schema', '$id', '$defs', '$ref', 'title', 'description', 'type', 'properties', 'required',
  'additionalProperties', 'items', 'enum', 'const', 'pattern', 'minLength', 'minimum', 'minItems', 'maxItems',
]);

export interface JsonSchema {
  $schema?: string;
  $id?: string;
  $defs?: Record<string, JsonSchema>;
  $ref?: string;
  title?: string;
  description?: string;
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  pattern?: string;
  minLength?: number;
  minimum?: number;
  minItems?: number;
  maxItems?: number;
}

const typeOf = (value: unknown): string => {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
};

const matchesType = (type: string, value: unknown): boolean => type === typeOf(value) || (type === 'number' && typeof value === 'number');

// Returns a list of "path: problem" strings; empty means valid.
export function validate(schema: JsonSchema, value: unknown, root: JsonSchema = schema, at = '$'): string[] {
  for (const keyword of Object.keys(schema)) {
    if (!KNOWN.has(keyword)) throw new Error(`${at}: unsupported schema keyword ${keyword}`);
  }
  if (schema.$ref) {
    const name = schema.$ref.replace(/^#\/\$defs\//, '');
    const target = root.$defs?.[name];
    if (!target) throw new Error(`${at}: unresolved $ref ${schema.$ref}`);
    return validate(target, value, root, at);
  }
  const problems: string[] = [];
  if (schema.type && !matchesType(schema.type, value)) return [`${at}: expected ${schema.type}, got ${typeOf(value)}`];
  if ('const' in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) problems.push(`${at}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
    problems.push(`${at}: must be one of ${schema.enum.map((option) => JSON.stringify(option)).join(', ')}`);
  }
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) problems.push(`${at}: does not match ${schema.pattern}`);
    if (schema.minLength !== undefined && value.length < schema.minLength) problems.push(`${at}: shorter than ${schema.minLength}`);
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) problems.push(`${at}: below ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(`${at}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) problems.push(`${at}: more than ${schema.maxItems} items`);
    const { items } = schema;
    if (items) value.forEach((item: unknown, index: number) => problems.push(...validate(items, item, root, `${at}[${index}]`)));
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) problems.push(`${at}: missing ${key}`);
    }
    for (const [key, item] of Object.entries(value)) {
      const property = schema.properties?.[key];
      if (property) problems.push(...validate(property, item, root, `${at}.${key}`));
      else if (schema.additionalProperties === false) problems.push(`${at}: unexpected property ${key}`);
    }
  }
  return problems;
}

// validate() as an assertion: a value with no problems narrows to T, the type
// the caller declares the schema describes.
export function assertMatches<T>(schema: JsonSchema, value: unknown, label: string): asserts value is T {
  const problems = validate(schema, value);
  if (problems.length > 0) throw new Error(`${label} does not match its schema:\n  ${problems.join('\n  ')}`);
}

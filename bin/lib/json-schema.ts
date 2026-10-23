// JSON Schema 2020-12 through Ajv in strict mode, so a keyword Ajv does not know is an error.
import { Ajv2020, type ErrorObject, type SchemaObject } from 'ajv/dist/2020.js';

export type JsonSchema = SchemaObject;

// addUsedSchema false: a schema file read twice compiles twice, instead of
// colliding with its own $id.
const ajv = new Ajv2020({ allErrors: true, addUsedSchema: false });

// Problems name the property or the allowed values; the rest keep Ajv's message.
const problem = ({ keyword, params, message }: ErrorObject): string | undefined =>
  keyword === 'required'
    ? `missing ${params.missingProperty}`
    : keyword === 'additionalProperties'
      ? `unexpected property ${params.additionalProperty}`
      : keyword === 'enum'
        ? `must be one of ${params.allowedValues.map((value: unknown) => JSON.stringify(value)).join(', ')}`
        : message;

// Ajv's JSON Pointer /rules/0/action as $.rules[0].action.
const path = (pointer: string): string =>
  `$${pointer
    .split('/')
    .slice(1)
    .map((token) => {
      const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
      return /^\d+$/.test(key) ? `[${key}]` : `.${key}`;
    })
    .join('')}`;

const describe = (error: ErrorObject): string => `${path(error.instancePath)}: ${problem(error)}`;

// Returns a list of "path: problem" strings; empty means valid.
export function validate(schema: JsonSchema, value: unknown): string[] {
  const check = ajv.compile(schema);
  return check(value) ? [] : (check.errors ?? []).map(describe);
}

// validate() as an assertion: a value with no problems narrows to T, the type
// the caller declares the schema describes.
export function assertMatches<T>(schema: JsonSchema, value: unknown, label: string): asserts value is T {
  const problems = validate(schema, value);
  if (problems.length > 0) throw new Error(`${label} does not match its schema:\n  ${problems.join('\n  ')}`);
}

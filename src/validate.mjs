// Validates tool arguments proposed by the LLM before any tool is executed.
//
// The same JSON schema that is sent to the LLM (tool.parameters) is used here,
// so the model and the application always agree on what a valid call looks like.
// Supported subset of JSON Schema:
//   object:  properties, required, additionalProperties: false
//   string:  minLength, maxLength, pattern, enum   (values are trimmed first)
//   integer / number: minimum, maximum, exclusiveMinimum
//   boolean
//   default  (applied when an optional property is missing)

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

function checkValue(name, value, schema, errors) {
  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') {
        errors.push(`${name} must be a string, got ${typeOf(value)}`);
        return undefined;
      }
      const v = value.trim();
      if (schema.minLength !== undefined && v.length < schema.minLength) errors.push(`${name} must have at least ${schema.minLength} character(s)`);
      if (schema.maxLength !== undefined && v.length > schema.maxLength) errors.push(`${name} must have at most ${schema.maxLength} characters`);
      if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(v)) errors.push(`${name} has an invalid format (expected ${schema.pattern})`);
      if (schema.enum !== undefined && !schema.enum.includes(v)) errors.push(`${name} must be one of: ${schema.enum.join(', ')}`);
      return v;
    }
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(`${name} must be ${schema.type === 'integer' ? 'an' : 'a'} ${schema.type}, got ${typeOf(value)}`);
        return undefined;
      }
      if (schema.type === 'integer' && !Number.isInteger(value)) errors.push(`${name} must be an integer, got ${value}`);
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${name} must be >= ${schema.minimum}, got ${value}`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${name} must be <= ${schema.maximum}, got ${value}`);
      if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${name} must be > ${schema.exclusiveMinimum}, got ${value}`);
      return value;
    }
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${name} must be a boolean, got ${typeOf(value)}`);
      return value;
    default:
      errors.push(`${name}: unsupported schema type ${schema.type}`);
      return undefined;
  }
}

/**
 * @param {object} schema  tool.parameters (type: "object")
 * @param {unknown} args   arguments proposed by the model
 * @returns {{ok: true, value: object} | {ok: false, errors: string[]}}
 */
export function validateArgs(schema, args) {
  if (args && typeof args === 'object' && '__invalid_json' in args) {
    return { ok: false, errors: ['arguments are not valid JSON'] };
  }
  if (typeOf(args) !== 'object') {
    return { ok: false, errors: [`arguments must be an object, got ${typeOf(args)}`] };
  }
  const errors = [];
  const props = schema.properties ?? {};
  const value = {};

  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(props, key) && schema.additionalProperties === false) errors.push(`unknown argument: ${key}`);
  }
  for (const key of schema.required ?? []) {
    if (args[key] === undefined || args[key] === null) errors.push(`missing required argument: ${key}`);
  }
  for (const [key, propSchema] of Object.entries(props)) {
    let v = args[key];
    if (v === undefined || v === null) {
      if (propSchema.default !== undefined) value[key] = propSchema.default;
      continue;
    }
    v = checkValue(key, v, propSchema, errors);
    if (v !== undefined) value[key] = v;
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

// Tool registry and the single entry point for executing a tool call.
//
// runTool() is what the agent loop (Week 13) will call for every tool call the LLM makes:
//   1. the tool name must be registered (the model cannot call anything else),
//   2. arguments are validated against the tool's JSON schema,
//   3. only then the tool is executed,
//   4. every outcome - success or failure - is returned as a plain object
//      that can be sent back to the model as a "tool" message.
import { validateArgs } from '../validate.mjs';
import { ToolError } from './http.mjs';
import { weatherTool } from './weather.mjs';
import { currencyTool } from './currency.mjs';
import { countryTool } from './country.mjs';

export const defaultTools = [weatherTool, currencyTool, countryTool];

/** Builds a name -> tool map. A Map avoids prototype keys like "toString" being treated as tools. */
export function createRegistry(tools = defaultTools) {
  const map = new Map();
  for (const t of tools) {
    if (map.has(t.name)) throw new Error(`duplicate tool name: ${t.name}`);
    map.set(t.name, t);
  }
  return map;
}

/** Tool definitions in the {name, description, parameters} shape expected by model-client. */
export const toolDefinitions = (registry) =>
  [...registry.values()].map(({ name, description, parameters }) => ({ name, description, parameters }));

/**
 * @returns {Promise<
 *   {ok: true,  tool: string, args: object, result: object, ms: number} |
 *   {ok: false, tool: string, args: unknown, error: {kind: string, message: string}, ms: number}
 * >}
 */
export async function runTool(registry, name, rawArgs, deps = {}) {
  const started = Date.now();
  const fail = (kind, message, args = rawArgs) => ({ ok: false, tool: name, args, error: { kind, message }, ms: Date.now() - started });

  const tool = registry.get(name);
  if (!tool) return fail('unknown_tool', `no such tool: ${name}. Available: ${[...registry.keys()].join(', ')}`);

  const check = validateArgs(tool.parameters, rawArgs);
  if (!check.ok) return fail('invalid_arguments', check.errors.join('; '));

  try {
    const result = await tool.execute(check.value, deps);
    return { ok: true, tool: name, args: check.value, result, ms: Date.now() - started };
  } catch (err) {
    if (err instanceof ToolError) return fail(err.kind, err.message, check.value);
    return fail('internal_error', `tool crashed: ${err?.message ?? err}`, check.value);
  }
}

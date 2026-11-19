#!/usr/bin/env node
// Runs one tool directly against the real API, without the LLM. Useful for manual checks and demos.
// Usage (key=value works in every shell, including Windows PowerShell):
//   npm run tool -- get_weather_forecast city=Almaty days=3
//   npm run tool -- convert_currency amount=50000 from=KZT to=GEL
//   npm run tool -- get_country_info country=Georgia
// A JSON object is accepted too (bash):  npm run tool -- get_country_info '{"country":"Georgia"}'
import { createRegistry, runTool } from './tools/index.mjs';

/** Parses CLI arguments: either one JSON object or key=value pairs (numbers are converted). */
export function parseCliArgs(parts) {
  if (parts.length === 1 && parts[0].trim().startsWith('{')) {
    try {
      return JSON.parse(parts[0]);
    } catch {
      return { __invalid_json: parts[0] };
    }
  }
  const args = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 1) continue;
    const key = p.slice(0, eq);
    const raw = p.slice(eq + 1);
    args[key] = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  }
  return args;
}

if (process.argv[1]?.endsWith('try-tool.mjs')) {
  const registry = createRegistry();
  const [name, ...rest] = process.argv.slice(2);
  if (!name) {
    console.error(`Usage: npm run tool -- <tool> key=value ...\nTools: ${[...registry.keys()].join(', ')}`);
    process.exitCode = 2;
  } else {
    const out = await runTool(registry, name, parseCliArgs(rest));
    console.log(JSON.stringify(out, null, 2));
    if (!out.ok) process.exitCode = 1;
  }
}

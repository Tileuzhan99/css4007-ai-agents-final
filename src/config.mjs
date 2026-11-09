// Loads configuration from environment variables and an optional local .env file.
// The .env file is git-ignored; only .env.example is committed.
import fs from 'node:fs';

const DEFAULTS = {
  LLM_BASE_URL: 'https://api.groq.com/openai/v1',
  LLM_MODEL: 'llama-3.3-70b-versatile',
  LLM_TIMEOUT_MS: '30000',
  LLM_MAX_RETRIES: '2',
};

/** Parses KEY=VALUE lines. Ignores blank lines and # comments; strips optional quotes. */
export function parseDotenv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Real environment variables take priority over .env, which takes priority over defaults. */
export function loadConfig({ env = process.env, dotenvPath = '.env' } = {}) {
  const fileVars = dotenvPath && fs.existsSync(dotenvPath) ? parseDotenv(fs.readFileSync(dotenvPath, 'utf8')) : {};
  const pick = (k) => (env[k] ?? fileVars[k] ?? DEFAULTS[k] ?? '').toString().trim();
  const timeoutMs = Number(pick('LLM_TIMEOUT_MS'));
  const maxRetries = Number(pick('LLM_MAX_RETRIES'));
  return {
    baseUrl: pick('LLM_BASE_URL').replace(/\/+$/, ''),
    apiKey: pick('LLM_API_KEY'),
    model: pick('LLM_MODEL'),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000,
    maxRetries: Number.isInteger(maxRetries) && maxRetries >= 0 ? maxRetries : 2,
  };
}

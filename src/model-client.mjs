// Provider adapter for any OpenAI-compatible Chat Completions API
// (Groq, Gemini's OpenAI endpoint, OpenRouter, OpenAI, local Ollama).
//
// Contract used by the rest of the app:
//   complete(messages, tools) -> { text, toolCalls: [{ id, name, arguments }] }
import { loadConfig } from './config.mjs';

export class LLMError extends Error {
  constructor(message, { status, retryable = false, cause } = {}) {
    super(message, { cause });
    this.name = 'LLMError';
    this.status = status;
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Converts our tool definitions ({name, description, parameters}) to the OpenAI wire format. */
export function toWireTools(tools) {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * Turns a raw Chat Completions response body into {text, toolCalls}.
 * Throws LLMError if the body does not have the expected shape.
 * Tool-call arguments that are not valid JSON are kept as {__invalid_json: raw}
 * so the caller can report the problem back to the model instead of crashing.
 */
export function parseCompletion(body) {
  const message = body?.choices?.[0]?.message;
  if (!message || typeof message !== 'object') {
    throw new LLMError('Malformed LLM response: missing choices[0].message');
  }
  const text = typeof message.content === 'string' ? message.content : '';
  const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolCalls = rawCalls.map((c, i) => {
    const name = c?.function?.name;
    if (typeof name !== 'string' || !name) throw new LLMError('Malformed LLM response: tool call without a name');
    const rawArgs = c.function.arguments;
    let args;
    if (rawArgs && typeof rawArgs === 'object') args = rawArgs;
    else {
      try {
        args = rawArgs ? JSON.parse(rawArgs) : {};
      } catch {
        args = { __invalid_json: String(rawArgs) };
      }
    }
    return { id: c.id || `call_${i}`, name, arguments: args };
  });
  return { text, toolCalls };
}

/**
 * Creates a client bound to a configuration. `fetchImpl` is injectable for tests.
 */
export function createClient(config = loadConfig(), { fetchImpl = globalThis.fetch, retryDelayMs = 500 } = {}) {
  if (!config.model) throw new LLMError('LLM_MODEL is not set');
  if (!config.baseUrl) throw new LLMError('LLM_BASE_URL is not set');

  async function once(payload) {
    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    let res;
    try {
      res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (err) {
      const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new LLMError(timeout ? `LLM request timed out after ${config.timeoutMs} ms` : `Network error: ${err.message}`, {
        retryable: true,
        cause: err,
      });
    }
    if (!res.ok) {
      // Never include request headers (API key) in errors; only a short slice of the body.
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      const retryable = res.status === 429 || res.status >= 500;
      const hint = res.status === 401 || res.status === 403 ? ' (check LLM_API_KEY)' : '';
      throw new LLMError(`LLM API error ${res.status}${hint}: ${detail}`, { status: res.status, retryable });
    }
    let body;
    try {
      body = await res.json();
    } catch (err) {
      throw new LLMError('LLM API returned invalid JSON', { cause: err });
    }
    return parseCompletion(body);
  }

  async function complete(messages, tools = [], { temperature = 0.2 } = {}) {
    if (!Array.isArray(messages) || messages.length === 0) throw new LLMError('messages must be a non-empty array');
    const payload = { model: config.model, messages, temperature };
    if (tools.length) {
      payload.tools = toWireTools(tools);
      payload.tool_choice = 'auto';
    }
    let lastErr;
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        return await once(payload);
      } catch (err) {
        lastErr = err;
        if (!(err instanceof LLMError) || !err.retryable || attempt === config.maxRetries) break;
        await sleep(retryDelayMs * 2 ** attempt); // exponential backoff
      }
    }
    throw lastErr;
  }

  return { complete, config };
}

let defaultClient;
/** Convenience wrapper matching the starter signature complete(messages, tools). */
export async function complete(messages, tools = []) {
  defaultClient ??= createClient();
  return defaultClient.complete(messages, tools);
}

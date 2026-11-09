// Tests for the provider adapter, config loader and prompt builder.
// fetch is mocked, so no API key or network access is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, parseCompletion, toWireTools, LLMError } from '../src/model-client.mjs';
import { parseDotenv, loadConfig } from '../src/config.mjs';
import { buildMessages } from '../src/prompts.mjs';

const CONFIG = { baseUrl: 'https://llm.test/v1', apiKey: 'sk-test-secret', model: 'test-model', timeoutMs: 1000, maxRetries: 2 };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function mockFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  };
  fn.calls = calls;
  return fn;
}

test('returns plain text answer and sends model, messages and auth header', async () => {
  const fetchImpl = mockFetch([jsonResponse({ choices: [{ message: { role: 'assistant', content: 'Pack a warm coat.' } }] })]);
  const client = createClient(CONFIG, { fetchImpl, retryDelayMs: 0 });
  const r = await client.complete(buildMessages('What to pack for Astana in January?'));
  assert.deepEqual(r, { text: 'Pack a warm coat.', toolCalls: [] });
  const [call] = fetchImpl.calls;
  assert.equal(call.url, 'https://llm.test/v1/chat/completions');
  assert.equal(call.init.headers.Authorization, 'Bearer sk-test-secret');
  assert.equal(call.body.model, 'test-model');
  assert.equal(call.body.messages[0].role, 'system');
  assert.equal(call.body.tools, undefined, 'no tools sent when none registered');
});

test('parses tool calls and JSON arguments; sends tools in OpenAI format', async () => {
  const tool = { name: 'get_weather_forecast', description: 'Forecast', parameters: { type: 'object', properties: { city: { type: 'string' } } } };
  const fetchImpl = mockFetch([
    jsonResponse({
      choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_weather_forecast', arguments: '{"city":"Almaty","days":3}' } }] } }],
    }),
  ]);
  const client = createClient(CONFIG, { fetchImpl, retryDelayMs: 0 });
  const r = await client.complete(buildMessages('Weather in Almaty?'), [tool]);
  assert.deepEqual(r.toolCalls, [{ id: 'c1', name: 'get_weather_forecast', arguments: { city: 'Almaty', days: 3 } }]);
  assert.equal(r.text, '');
  assert.deepEqual(fetchImpl.calls[0].body.tools, toWireTools([tool]));
  assert.equal(fetchImpl.calls[0].body.tool_choice, 'auto');
});

test('invalid JSON in tool arguments is flagged instead of crashing', () => {
  const r = parseCompletion({ choices: [{ message: { tool_calls: [{ function: { name: 'x', arguments: '{city: Almaty' } }] } }] });
  assert.deepEqual(r.toolCalls[0].arguments, { __invalid_json: '{city: Almaty' });
  assert.equal(r.toolCalls[0].id, 'call_0');
});

test('malformed response body is rejected with LLMError', () => {
  assert.throws(() => parseCompletion({}), LLMError);
  assert.throws(() => parseCompletion({ choices: [] }), /missing choices/);
  assert.throws(() => parseCompletion({ choices: [{ message: { tool_calls: [{ function: {} }] } }] }), /without a name/);
});

test('retries on 429/5xx and network errors, then succeeds', async () => {
  const fetchImpl = mockFetch([
    jsonResponse({ error: 'rate limited' }, 429),
    new TypeError('fetch failed'),
    jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
  ]);
  const client = createClient(CONFIG, { fetchImpl, retryDelayMs: 0 });
  const r = await client.complete(buildMessages('hi'));
  assert.equal(r.text, 'ok');
  assert.equal(fetchImpl.calls.length, 3);
});

test('stops after retry budget and reports the last error', async () => {
  const fetchImpl = mockFetch([jsonResponse({}, 503), jsonResponse({}, 503), jsonResponse({}, 503), jsonResponse({}, 503)]);
  const client = createClient(CONFIG, { fetchImpl, retryDelayMs: 0 });
  await assert.rejects(client.complete(buildMessages('hi')), (e) => e instanceof LLMError && e.status === 503);
  assert.equal(fetchImpl.calls.length, 3, '1 attempt + 2 retries');
});

test('401 is not retried and the error never leaks the API key', async () => {
  const fetchImpl = mockFetch([jsonResponse({ error: 'invalid key' }, 401)]);
  const client = createClient(CONFIG, { fetchImpl, retryDelayMs: 0 });
  await assert.rejects(client.complete(buildMessages('hi')), (e) => {
    assert.match(e.message, /401.*LLM_API_KEY/);
    assert.doesNotMatch(e.message, /sk-test-secret/);
    return true;
  });
  assert.equal(fetchImpl.calls.length, 1);
});

test('timeout is reported as a clear error', async () => {
  const timeoutErr = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
  const fetchImpl = mockFetch([timeoutErr, timeoutErr, timeoutErr]);
  const client = createClient(CONFIG, { fetchImpl, retryDelayMs: 0 });
  await assert.rejects(client.complete(buildMessages('hi')), /timed out after 1000 ms/);
});

test('buildMessages validates user input', () => {
  assert.throws(() => buildMessages(''), /non-empty/);
  assert.throws(() => buildMessages('   '), /non-empty/);
  assert.throws(() => buildMessages(42), /non-empty/);
  assert.throws(() => buildMessages('x'.repeat(2001)), /too long/);
  assert.equal(buildMessages('  hello  ')[1].content, 'hello');
});

test('config: env overrides .env values, defaults fill the rest', () => {
  assert.deepEqual(parseDotenv('# c\nA=1\nB="two"\n\nC=\'3\'\nbad line'), { A: '1', B: 'two', C: '3' });
  const cfg = loadConfig({ env: { LLM_API_KEY: 'k', LLM_BASE_URL: 'http://x/v1/' }, dotenvPath: null });
  assert.equal(cfg.apiKey, 'k');
  assert.equal(cfg.baseUrl, 'http://x/v1');
  assert.equal(cfg.model, 'openai/gpt-oss-120b');
  assert.equal(cfg.maxRetries, 2);
});

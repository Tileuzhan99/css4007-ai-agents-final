// Small HTTP helper shared by all tools. Every failure becomes a ToolError with a `kind`
// so the agent can tell the model *why* data is missing instead of crashing:
//   not_found     - the service has no data for this input (unknown city, unsupported currency)
//   unavailable   - network error, timeout or HTTP error from the service
//   bad_response  - the service answered with something we could not understand

export class ToolError extends Error {
  constructor(message, { kind = 'unavailable', cause } = {}) {
    super(message, { cause });
    this.name = 'ToolError';
    this.kind = kind;
  }
}

/** GET a URL and parse JSON. `fetchImpl` is injectable so tests run offline. */
export async function getJson(url, { fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const host = new URL(url).host;
  let res;
  try {
    res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new ToolError(timeout ? `${host} did not answer within ${timeoutMs} ms` : `cannot reach ${host}: ${err.message}`, {
      kind: 'unavailable',
      cause: err,
    });
  }
  if (!res.ok) {
    throw new ToolError(`${host} returned HTTP ${res.status}`, { kind: res.status === 404 ? 'not_found' : 'unavailable' });
  }
  try {
    return await res.json();
  } catch (err) {
    throw new ToolError(`${host} returned invalid JSON`, { kind: 'bad_response', cause: err });
  }
}

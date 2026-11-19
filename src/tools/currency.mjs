// convert_currency: converts an amount using today's exchange rate.
// Data: ExchangeRate-API open access endpoint (https://open.er-api.com), free, no API key,
// rates updated once a day. The arithmetic is done here, not by the LLM.
import { getJson, ToolError } from './http.mjs';

const RATES_URL = 'https://open.er-api.com/v6/latest';

/** Rounds money to 2 decimals (or more for very small results, e.g. 1 KZT in BTC-like cases). */
export function roundMoney(x) {
  if (x !== 0 && Math.abs(x) < 0.01) return Number(x.toPrecision(3));
  return Math.round(x * 100) / 100;
}

export const currencyTool = {
  name: 'convert_currency',
  description:
    "Convert an amount of money from one currency to another using today's exchange rate. Currencies are 3-letter ISO 4217 codes such as USD, EUR, KZT, GEL, TRY. Use it for any question about prices in another currency or exchange rates.",
  parameters: {
    type: 'object',
    properties: {
      amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e12, description: 'Amount to convert, > 0' },
      from: { type: 'string', pattern: '^[A-Za-z]{3}$', description: 'Source currency code, e.g. "KZT"' },
      to: { type: 'string', pattern: '^[A-Za-z]{3}$', description: 'Target currency code, e.g. "EUR"' },
    },
    required: ['amount', 'from', 'to'],
    additionalProperties: false,
  },

  /** @param {{amount: number, from: string, to: string}} args validated arguments */
  async execute({ amount, from, to }, { fetchImpl, timeoutMs } = {}) {
    const src = from.toUpperCase();
    const dst = to.toUpperCase();
    const body = await getJson(`${RATES_URL}/${src}`, { fetchImpl, timeoutMs });

    if (body?.result === 'error') {
      if (body['error-type'] === 'unsupported-code') throw new ToolError(`unsupported currency: ${src}`, { kind: 'not_found' });
      throw new ToolError(`exchange rate service error: ${body['error-type'] ?? 'unknown'}`, { kind: 'unavailable' });
    }
    const rates = body?.rates;
    if (body?.result !== 'success' || !rates || typeof rates !== 'object') {
      throw new ToolError('exchange rate response has no rates', { kind: 'bad_response' });
    }
    const rate = rates[dst];
    if (typeof rate !== 'number') throw new ToolError(`unsupported currency: ${dst}`, { kind: 'not_found' });

    const updated = body.time_last_update_unix ? new Date(body.time_last_update_unix * 1000).toISOString().slice(0, 10) : null;
    return {
      amount,
      from: src,
      to: dst,
      rate,
      result: roundMoney(amount * rate),
      rateDate: updated,
      source: 'open.er-api.com',
    };
  },
};

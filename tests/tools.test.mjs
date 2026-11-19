// Tests for argument validation, the three tools and runTool().
// fetch is mocked with recorded-style API responses, so the tests are deterministic and offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateArgs } from '../src/validate.mjs';
import { weatherTool, describeWeatherCode } from '../src/tools/weather.mjs';
import { currencyTool, roundMoney } from '../src/tools/currency.mjs';
import { createCountryTool, normalize } from '../src/tools/country.mjs';
import { createRegistry, runTool, toolDefinitions, defaultTools } from '../src/tools/index.mjs';
import { parseCliArgs } from '../src/try-tool.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Mock fetch that answers by URL prefix and records every requested URL. */
function routeFetch(routes) {
  const urls = [];
  const fn = async (url) => {
    urls.push(url);
    for (const [prefix, handler] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return typeof handler === 'function' ? handler(url) : handler;
    }
    throw new Error(`unexpected URL in test: ${url}`);
  };
  fn.urls = urls;
  return fn;
}

const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const RATES = 'https://open.er-api.com/v6/latest/';
const COUNTRIES = 'https://countries.test/countries.json';

const almatyGeo = { results: [{ name: 'Almaty', latitude: 43.25, longitude: 76.91, country: 'Kazakhstan', admin1: 'Almaty', timezone: 'Asia/Almaty' }] };
const almatyForecast = {
  timezone: 'Asia/Almaty',
  daily: {
    time: ['2026-11-19', '2026-11-20'],
    temperature_2m_min: [-0.6, 3.0],
    temperature_2m_max: [10.9, 15.3],
    precipitation_sum: [0, 1.2],
    weather_code: [45, 61],
  },
};
const usdRates = { result: 'success', base_code: 'USD', time_last_update_unix: 1795046551, rates: { USD: 1, KZT: 495.5, GEL: 2.73, EUR: 0.86 } };

const countriesFixture = [
  {
    name: { common: 'Georgia', official: 'Georgia', native: { kat: { common: 'საქართველო', official: 'საქართველო' } } },
    cca2: 'GE', cca3: 'GEO', altSpellings: ['GE', 'Sakartvelo'], capital: ['Tbilisi'], region: 'Asia', subregion: 'Western Asia',
    currencies: { GEL: { name: 'lari', symbol: '₾' } }, languages: { kat: 'Georgian' }, idd: { root: '+9', suffixes: ['95'] },
    borders: ['ARM', 'TUR'], area: 69700, landlocked: false, translations: { rus: { common: 'Грузия', official: 'Грузия' } },
  },
  { name: { common: 'Armenia', official: 'Republic of Armenia' }, cca2: 'AM', cca3: 'ARM', altSpellings: ['AM'], capital: ['Yerevan'], currencies: { AMD: { name: 'Armenian dram', symbol: '֏' } }, languages: { hye: 'Armenian' } },
  { name: { common: 'Türkiye', official: 'Republic of Türkiye' }, cca2: 'TR', cca3: 'TUR', altSpellings: ['TR', 'Turkey'], capital: ['Ankara'], currencies: { TRY: { name: 'Turkish lira', symbol: '₺' } }, languages: { tur: 'Turkish' } },
  { name: { common: 'Republic of the Congo', official: 'Republic of the Congo' }, cca2: 'CG', cca3: 'COG', altSpellings: ['CG', 'Congo'] },
  { name: { common: 'DR Congo', official: 'Democratic Republic of the Congo' }, cca2: 'CD', cca3: 'COD', altSpellings: ['CD', 'Congo'] },
];

// ---------------------------------------------------------------- validation

test('validateArgs accepts valid arguments, trims strings and applies defaults', () => {
  const r = validateArgs(weatherTool.parameters, { city: '  Almaty ' });
  assert.deepEqual(r, { ok: true, value: { city: 'Almaty', days: 3 } });
  assert.deepEqual(validateArgs(currencyTool.parameters, { amount: 99.5, from: 'usd', to: 'KZT' }), {
    ok: true,
    value: { amount: 99.5, from: 'usd', to: 'KZT' },
  });
});

test('validateArgs rejects missing, mistyped, out-of-range, malformed and unknown arguments', () => {
  const w = weatherTool.parameters;
  const c = currencyTool.parameters;
  const errorsOf = (schema, args) => {
    const r = validateArgs(schema, args);
    assert.equal(r.ok, false, `expected rejection for ${JSON.stringify(args)}`);
    return r.errors.join(' | ');
  };
  assert.match(errorsOf(w, {}), /missing required argument: city/);
  assert.match(errorsOf(w, { city: '   ' }), /at least 1 character/);
  assert.match(errorsOf(w, { city: 42 }), /city must be a string, got number/);
  assert.match(errorsOf(w, { city: 'Almaty', days: 0 }), /days must be >= 1/);
  assert.match(errorsOf(w, { city: 'Almaty', days: 8 }), /days must be <= 7/);
  assert.match(errorsOf(w, { city: 'Almaty', days: 2.5 }), /days must be an integer/);
  assert.match(errorsOf(w, { city: 'Almaty', days: '3' }), /days must be an integer, got string/);
  assert.match(errorsOf(w, { city: 'Almaty', units: 'F' }), /unknown argument: units/);
  assert.match(errorsOf(c, { amount: -5, from: 'USD', to: 'EUR' }), /amount must be > 0/);
  assert.match(errorsOf(c, { amount: 10, from: 'dollars', to: 'EUR' }), /from has an invalid format/);
  assert.match(errorsOf(c, { amount: NaN, from: 'USD', to: 'EUR' }), /amount must be a number/);
  assert.match(errorsOf(w, { __invalid_json: '{city: Almaty' }), /not valid JSON/);
  assert.match(errorsOf(w, null), /must be an object, got null/);
  assert.match(errorsOf(w, ['Almaty']), /must be an object, got array/);
});

// ---------------------------------------------------------------- weather

test('weather: geocodes the city, requests the right forecast and normalises the result', async () => {
  const fetchImpl = routeFetch({ [GEO]: json(almatyGeo), [FORECAST]: json(almatyForecast) });
  const r = await weatherTool.execute({ city: 'Almaty', days: 2 }, { fetchImpl });
  assert.equal(r.city, 'Almaty');
  assert.equal(r.country, 'Kazakhstan');
  assert.deepEqual(r.days[1], { date: '2026-11-20', tempMin: 3, tempMax: 15.3, precipitationMm: 1.2, description: 'light rain' });
  assert.equal(r.days[0].description, 'fog');
  const forecastUrl = new URL(fetchImpl.urls[1]);
  assert.equal(forecastUrl.searchParams.get('latitude'), '43.25');
  assert.equal(forecastUrl.searchParams.get('forecast_days'), '2');
  assert.equal(new URL(fetchImpl.urls[0]).searchParams.get('name'), 'Almaty');
  assert.equal(describeWeatherCode(1234), 'unknown (code 1234)');
});

test('weather: unknown city is reported as not_found and no forecast is requested', async () => {
  const fetchImpl = routeFetch({ [GEO]: json({ generationtime_ms: 0.1 }) });
  const r = await runTool(createRegistry([weatherTool]), 'get_weather_forecast', { city: 'Xyzqwerty' }, { fetchImpl });
  assert.equal(r.ok, false);
  assert.deepEqual(r.error, { kind: 'not_found', message: 'city not found: "Xyzqwerty"' });
  assert.equal(fetchImpl.urls.length, 1);
});

// ---------------------------------------------------------------- currency

test('currency: converts with the real rate, uppercases codes and rounds money', async () => {
  const fetchImpl = routeFetch({ [RATES]: json(usdRates) });
  const r = await currencyTool.execute({ amount: 200, from: 'usd', to: 'gel' }, { fetchImpl });
  assert.deepEqual(r, { amount: 200, from: 'USD', to: 'GEL', rate: 2.73, result: 546, rateDate: '2026-11-19', source: 'open.er-api.com' });
  assert.equal(fetchImpl.urls[0], 'https://open.er-api.com/v6/latest/USD');
  assert.equal(roundMoney(12.3456), 12.35);
  assert.equal(roundMoney(291.69999), 291.7);
  assert.equal(roundMoney(0.0012345), 0.00123);
});

test('currency: unsupported source or target currency is not_found', async () => {
  const fetchImpl = routeFetch({
    [RATES + 'XXX']: json({ result: 'error', 'error-type': 'unsupported-code' }),
    [RATES + 'USD']: json(usdRates),
  });
  const reg = createRegistry([currencyTool]);
  const a = await runTool(reg, 'convert_currency', { amount: 1, from: 'XXX', to: 'USD' }, { fetchImpl });
  assert.deepEqual(a.error, { kind: 'not_found', message: 'unsupported currency: XXX' });
  const b = await runTool(reg, 'convert_currency', { amount: 1, from: 'USD', to: 'ABC' }, { fetchImpl });
  assert.deepEqual(b.error, { kind: 'not_found', message: 'unsupported currency: ABC' });
});

// ---------------------------------------------------------------- country

test('country: finds by English name, ISO code, alt spelling or Russian name; downloads dataset once', async () => {
  const fetchImpl = routeFetch({ [COUNTRIES]: () => json(countriesFixture) });
  const tool = createCountryTool({ url: COUNTRIES });
  const ge = await tool.execute({ country: 'georgia' }, { fetchImpl });
  assert.equal(ge.capital[0], 'Tbilisi');
  assert.deepEqual(ge.currencies, [{ code: 'GEL', name: 'lari', symbol: '₾' }]);
  assert.equal(ge.callingCode, '+995');
  assert.deepEqual(ge.borders, ['Armenia', 'Türkiye'], 'border codes are turned into names');
  assert.equal((await tool.execute({ country: 'GE' }, { fetchImpl })).name, 'Georgia');
  assert.equal((await tool.execute({ country: 'Грузия' }, { fetchImpl })).name, 'Georgia');
  assert.equal((await tool.execute({ country: 'Turkey' }, { fetchImpl })).currencies[0].code, 'TRY');
  assert.equal((await tool.execute({ country: 'Arm' }, { fetchImpl })).name, 'Armenia', 'unique prefix');
  assert.equal(fetchImpl.urls.length, 1, 'dataset is cached in memory');
  assert.equal(normalize("  Côte d'Ivoire "), 'cote divoire');
});

test('country: unknown and ambiguous names are not_found, ambiguous ones list candidates', async () => {
  const fetchImpl = routeFetch({ [COUNTRIES]: () => json(countriesFixture) });
  const reg = createRegistry([createCountryTool({ url: COUNTRIES })]);
  const unknown = await runTool(reg, 'get_country_info', { country: 'Zzzland' }, { fetchImpl });
  assert.deepEqual(unknown.error, { kind: 'not_found', message: 'country not found: "Zzzland"' });
  const congo = await runTool(reg, 'get_country_info', { country: 'Congo' }, { fetchImpl });
  assert.equal(congo.error.kind, 'not_found');
  assert.match(congo.error.message, /did you mean: Republic of the Congo, DR Congo\?/);
});

test('country: a failed download is not cached, the next call retries', async () => {
  let calls = 0;
  const fetchImpl = async () => (++calls === 1 ? json({}, 503) : json(countriesFixture));
  const reg = createRegistry([createCountryTool({ url: COUNTRIES })]);
  const first = await runTool(reg, 'get_country_info', { country: 'Georgia' }, { fetchImpl });
  assert.deepEqual(first.error, { kind: 'unavailable', message: 'countries.test returned HTTP 503' });
  const second = await runTool(reg, 'get_country_info', { country: 'Georgia' }, { fetchImpl });
  assert.equal(second.ok, true);
  assert.equal(calls, 2);
});

// ---------------------------------------------------------------- runTool / registry

test('runTool: unknown tool names never execute anything, including prototype keys', async () => {
  let executed = false;
  const spy = { ...weatherTool, execute: async () => { executed = true; } };
  const reg = createRegistry([spy]);
  for (const name of ['delete_files', 'toString', '__proto__', 'constructor']) {
    const r = await runTool(reg, name, {});
    assert.equal(r.ok, false);
    assert.equal(r.error.kind, 'unknown_tool');
  }
  assert.match((await runTool(reg, 'nope', {})).error.message, /Available: get_weather_forecast/);
  assert.equal(executed, false);
});

test('runTool: invalid arguments are rejected before the tool runs', async () => {
  let executed = false;
  const spy = { ...currencyTool, execute: async () => { executed = true; return {}; } };
  const r = await runTool(createRegistry([spy]), 'convert_currency', { amount: '100', from: 'USD' });
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'invalid_arguments');
  assert.match(r.error.message, /amount must be a number.*missing required argument: to|missing required argument: to.*amount must be a number/);
  assert.equal(executed, false);
});

test('runTool: network errors, timeouts, HTTP errors, bad JSON and crashes become structured errors', async () => {
  const reg = createRegistry([currencyTool]);
  const args = { amount: 1, from: 'USD', to: 'EUR' };
  const errorFor = async (fetchImpl) => (await runTool(reg, 'convert_currency', args, { fetchImpl })).error;

  assert.deepEqual(await errorFor(async () => { throw new TypeError('fetch failed'); }), { kind: 'unavailable', message: 'cannot reach open.er-api.com: fetch failed' });
  const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
  assert.deepEqual(await errorFor(async () => { throw timeout; }), { kind: 'unavailable', message: 'open.er-api.com did not answer within 10000 ms' });
  assert.deepEqual(await errorFor(async () => json({}, 500)), { kind: 'unavailable', message: 'open.er-api.com returned HTTP 500' });
  assert.deepEqual(await errorFor(async () => new Response('<html>oops</html>', { status: 200 })), { kind: 'bad_response', message: 'open.er-api.com returned invalid JSON' });
  assert.deepEqual(await errorFor(async () => json({ result: 'success' })), { kind: 'bad_response', message: 'exchange rate response has no rates' });

  const broken = { ...currencyTool, execute: async () => { throw new RangeError('boom'); } };
  const r = await runTool(createRegistry([broken]), 'convert_currency', args);
  assert.deepEqual(r.error, { kind: 'internal_error', message: 'tool crashed: boom' });
});

test('runTool: success returns validated args, result and duration', async () => {
  const fetchImpl = routeFetch({ [RATES]: json(usdRates) });
  const r = await runTool(createRegistry(), 'convert_currency', { amount: 10, from: ' USD ', to: 'KZT' }, { fetchImpl });
  assert.equal(r.ok, true);
  assert.deepEqual(r.args, { amount: 10, from: 'USD', to: 'KZT' });
  assert.equal(r.result.result, 4955);
  assert.equal(typeof r.ms, 'number');
});

test('tool definitions are consistent and ready to send to the LLM', () => {
  const reg = createRegistry();
  const defs = toolDefinitions(reg);
  assert.deepEqual(defs.map((d) => d.name), ['get_weather_forecast', 'convert_currency', 'get_country_info']);
  for (const d of defs) {
    assert.match(d.name, /^[a-z_]+$/);
    assert.ok(d.description.length > 40, `${d.name} needs a useful description`);
    assert.equal(d.parameters.type, 'object');
    assert.equal(d.parameters.additionalProperties, false);
    for (const key of d.parameters.required) assert.ok(key in d.parameters.properties, `${d.name}: required ${key} not in properties`);
    assert.deepEqual(Object.keys(d).sort(), ['description', 'name', 'parameters'], 'execute() is never sent to the model');
  }
  assert.throws(() => createRegistry([...defaultTools, weatherTool]), /duplicate tool name/);
});

test('npm run tool: parses key=value pairs (numbers converted) and JSON objects', () => {
  assert.deepEqual(parseCliArgs(['amount=50000', 'from=KZT', 'to=GEL']), { amount: 50000, from: 'KZT', to: 'GEL' });
  assert.deepEqual(parseCliArgs(['city=New York', 'days=2']), { city: 'New York', days: 2 });
  assert.deepEqual(parseCliArgs(['{"country":"Georgia"}']), { country: 'Georgia' });
  assert.deepEqual(parseCliArgs(['{country:Georgia}']), { __invalid_json: '{country:Georgia}' });
  assert.deepEqual(parseCliArgs([]), {});
});

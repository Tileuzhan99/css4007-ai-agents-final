// get_country_info: verified facts about a country.
//
// Data: the open mledoze/countries dataset (https://github.com/mledoze/countries),
// served by the jsDelivr CDN, no API key. It is the dataset REST Countries was built on.
// The plan was REST Countries v3.1, but in November 2026 its v1-v4 endpoints were shut
// down and the new version needs an account, so the tool reads the source dataset instead.
// The file (~1.4 MB, 250 countries) is downloaded once and kept in memory.
import { getJson, ToolError } from './http.mjs';

export const COUNTRIES_URL = 'https://cdn.jsdelivr.net/gh/mledoze/countries@master/countries.json';

/** Lowercase, strip accents and punctuation: "Côte d'Ivoire" -> "cote divoire". */
export const normalize = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/** All names a country can be asked by: common/official name, ISO codes, alt spellings, translations. */
function namesOf(c) {
  const names = [c.name?.common, c.name?.official, c.cca2, c.cca3, ...(c.altSpellings ?? [])];
  for (const t of Object.values(c.translations ?? {})) names.push(t.common, t.official);
  for (const n of Object.values(c.name?.native ?? {})) names.push(n.common, n.official);
  return new Set(names.filter(Boolean).map(normalize));
}

/** Finds one country by name. Exact name match first, then a unique prefix match on the common name. */
export function findCountry(countries, query) {
  const q = normalize(query);
  if (!q) return { country: null, candidates: [] };
  const exact = countries.filter((c) => namesOf(c).has(q));
  if (exact.length) {
    // Prefer the English common/official name; otherwise the match must be unique
    // ("Congo" is an alt spelling of two countries, so the user has to choose).
    const best =
      exact.find((c) => normalize(c.name.common) === q) ??
      exact.find((c) => normalize(c.name.official) === q) ??
      (exact.length === 1 ? exact[0] : null);
    return { country: best, candidates: exact };
  }
  const prefix = countries.filter((c) => normalize(c.name.common).startsWith(q));
  if (prefix.length === 1) return { country: prefix[0], candidates: prefix };
  return { country: null, candidates: prefix };
}

/** Converts a raw dataset record to the compact shape returned to the LLM. */
export function summarizeCountry(c, byCode = new Map()) {
  const idd = c.idd?.root ? (c.idd.suffixes?.length === 1 ? c.idd.root + c.idd.suffixes[0] : c.idd.root) : null;
  return {
    name: c.name.common,
    officialName: c.name.official,
    code: c.cca2,
    capital: c.capital ?? [],
    region: c.region ?? null,
    subregion: c.subregion ?? null,
    currencies: Object.entries(c.currencies ?? {}).map(([code, v]) => ({ code, name: v.name, symbol: v.symbol ?? null })),
    languages: Object.values(c.languages ?? {}),
    callingCode: idd,
    borders: (c.borders ?? []).map((code) => byCode.get(code) ?? code),
    areaKm2: c.area ?? null,
    landlocked: c.landlocked ?? null,
    source: 'mledoze/countries',
  };
}

export function createCountryTool({ url = COUNTRIES_URL } = {}) {
  let cache = null; // Promise<Array> shared by all calls

  async function loadCountries(deps) {
    cache ??= getJson(url, { timeoutMs: 15000, ...deps }).then((data) => {
      if (!Array.isArray(data) || !data.length) throw new ToolError('country dataset has an unexpected format', { kind: 'bad_response' });
      return data;
    });
    try {
      return await cache;
    } catch (err) {
      cache = null; // do not keep a failed download; the next call retries
      throw err;
    }
  }

  return {
    name: 'get_country_info',
    description:
      'Get verified facts about a country: capital, region, currencies (with ISO codes), official languages, phone calling code, neighbouring countries and area. Use it for destination facts, or to find the currency code of a country before calling convert_currency.',
    parameters: {
      type: 'object',
      properties: {
        country: { type: 'string', minLength: 2, maxLength: 100, description: 'Country name in English or ISO code, e.g. "Georgia", "Turkey", "KR"' },
      },
      required: ['country'],
      additionalProperties: false,
    },

    /** @param {{country: string}} args validated arguments */
    async execute({ country }, { fetchImpl, timeoutMs } = {}) {
      const deps = { fetchImpl };
      if (timeoutMs) deps.timeoutMs = timeoutMs;
      const countries = await loadCountries(deps);
      const { country: found, candidates } = findCountry(countries, country);
      if (!found) {
        const hint = candidates.length > 1 ? `; did you mean: ${candidates.slice(0, 5).map((c) => c.name.common).join(', ')}?` : '';
        throw new ToolError(`country not found: "${country}"${hint}`, { kind: 'not_found' });
      }
      const byCode = new Map(countries.map((c) => [c.cca3, c.name.common]));
      return summarizeCountry(found, byCode);
    },
  };
}

export const countryTool = createCountryTool();

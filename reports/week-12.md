# Semester Week 12 Progress Report

## Completed Work

- Implemented the three tools planned in the proposal, each calling a real public API (no API keys):
  - `get_weather_forecast` (`src/tools/weather.mjs`) — Open-Meteo geocoding turns the city name into coordinates, then the forecast API returns daily min/max temperature, precipitation and a WMO weather code, which is converted to text ("fog", "light rain"). 1–7 days, default 3.
  - `convert_currency` (`src/tools/currency.mjs`) — today's rate from open.er-api.com; the multiplication and rounding are done in code, not by the LLM. Returns the rate, the result and the date of the rate.
  - `get_country_info` (`src/tools/country.mjs`) — capital, region, currencies with ISO codes, languages, calling code, neighbouring countries, area. Accepts English names, ISO codes, alternative spellings ("Turkey") and translations ("Грузия").
- Argument validator `validateArgs(schema, args)` (`src/validate.mjs`). It uses the same JSON schema that will be sent to the LLM, so there is one source of truth for what a valid call is. Checks types, required fields, unknown fields, min/max, string length, regex patterns (3-letter currency codes), applies defaults and trims strings.
- Tool registry and `runTool(registry, name, args)` (`src/tools/index.mjs`) — the single entry point the agent loop will use next week: unknown tool → rejected, invalid arguments → rejected, only then the tool runs. Every result is a plain object `{ok: true, result}` or `{ok: false, error: {kind, message}}` that can be sent back to the model.
- Shared HTTP helper (`src/tools/http.mjs`) with a 10 s timeout. All failures become a `ToolError` with a `kind`: `not_found`, `unavailable`, `bad_response` (plus `invalid_arguments`, `unknown_tool`, `internal_error` from `runTool`).
- `npm run tool -- <tool> key=value ...` to run one tool by hand against the real API.
- 15 new unit tests (`tests/tools.test.mjs`), 35 tests in total, all passing offline with mocked `fetch`.

## Important Commits

- `af33092` — Tool argument validator and shared HTTP helper — https://github.com/Tileuzhan99/css4007-ai-agents-final/commit/af33092
- `2466fcb` — Weather, currency and country tools with registry and `runTool` — https://github.com/Tileuzhan99/css4007-ai-agents-final/commit/2466fcb
- `cb68c1f` — Tests for validator, tools and `runTool` — https://github.com/Tileuzhan99/css4007-ai-agents-final/commit/cb68c1f

## Current Functionality

- `npm start -- "question"` — the LLM answers travel questions directly (from Week 11).
- The tools work against the real APIs, checked by hand on 19 Nov 2026:

```text
npm run tool -- get_weather_forecast city=Almaty days=3
  → Almaty, Kazakhstan: 19.11 fog −0.6…10.9 °C; 20.11 overcast 3…15.3 °C; 21.11 overcast 2.8…13.6 °C
npm run tool -- convert_currency amount=50000 from=KZT to=GEL
  → rate 0.005834, result 291.7 GEL, rate date 2026-11-19
npm run tool -- get_country_info country=Georgia
  → capital Tbilisi, currency GEL (lari, ₾), language Georgian, +995, borders Armenia, Azerbaijan, Russia, Türkiye
```

- Error cases return a clear structured error instead of invented data:
  - `city=Xyzqwerty` → `not_found: city not found: "Xyzqwerty"`
  - `to=XXX` → `not_found: unsupported currency: XXX`
  - `country=Zzzland` → `not_found: country not found: "Zzzland"`
  - `days=30 extra=1` → `invalid_arguments: unknown argument: extra; days must be <= 7, got 30`
  - tool `delete_files` → `unknown_tool`
- The tools are not connected to the LLM yet; that is the plan for Week 13.

## Problems Encountered

- **REST Countries API, planned in the proposal, stopped working.** All requests to `/v3.1/...` now redirect to a message that versions v1–v4 were shut down; the new v5 needs an account and an API key.
- Windows PowerShell 5.1 removes the double quotes inside a JSON argument such as `'{"city":"Almaty"}'` when calling `npm`, so the tool received `{city:Almaty}` and the JSON was invalid.
- The exchange-rate API answers an unsupported currency with HTTP 200 and `{"result":"error"}`, so checking the HTTP status alone is not enough.
- Some country names are ambiguous ("Congo" is an alternative spelling of two countries).
- One of my own tests was wrong: I expected `roundMoney(1.005 * 3)` to be 3.02, but in floating point `1.005 * 3` is `3.01499…`, so 3.01 is correct.

## Solutions

- Replaced REST Countries with the open **mledoze/countries** dataset (the data REST Countries itself was built on), loaded from the jsDelivr CDN without a key. The file (~1.4 MB, 250 countries) is downloaded once and kept in memory; a failed download is not cached, so the next call retries. The dataset has no population or time zones, so those two fields from the proposal were replaced by calling code, neighbouring countries and area. The tool interface for the LLM did not change.
- `npm run tool` accepts `key=value` arguments (`city=Almaty days=3`), which work in every shell; JSON still works in bash.
- The currency tool checks the `result` / `error-type` fields and also checks that the target currency is present in the rates.
- Country search: exact match on English name, official name, ISO code, alternative spellings and translations; a unique prefix is accepted. If several countries match and none is an exact English name, the tool returns `not_found` with the list of candidates, so the model can ask the user.
- Fixed the test to use values that are not on a floating-point boundary.

## What I Learned

- A tool's JSON schema has two jobs: it tells the model how to call the tool and it is the contract the application checks. Using one schema for both keeps them consistent.
- Never trust model-produced arguments: validate before executing, and reject unknown tool names with a `Map` lookup, not a plain object (otherwise names like `toString` resolve to built-in methods).
- Errors should be data with a category (`not_found` vs `unavailable`), because next week the model has to explain to the user *why* information is missing.
- External APIs can disappear without notice; isolating each API inside one tool module made the replacement a one-file change.
- Dependency injection of `fetch` makes all tool tests offline and deterministic.

## Next Week

Week 13 (tool integration): send `toolDefinitions()` to the LLM, implement the agent loop (`runAgent`): LLM → tool calls → `runTool` → results back as `role: "tool"` messages → final answer. Write every tool call to `logs/tool-calls.jsonl`. Agent-loop tests with a scripted mock LLM, and a real demo of tool selection (e.g. "How much is 200 USD in Georgian money and what's the weather in Tbilisi?").

# Project Proposal — Semester Week 10

## Project Title

**Sapar — a tool-using travel assistant agent**

("Sapar" means "trip" in Kazakh.)

## Problem Description

Before a trip, a person usually has to visit several separate websites: one for the weather forecast, one for exchange rates, and another for basic facts about the destination country (capital, currency, languages, time zone). A plain chatbot cannot answer these questions reliably, because the information changes daily and an LLM without tools will either refuse or invent numbers (hallucinated temperatures, outdated exchange rates).

Sapar solves this by letting an LLM decide which real data source it needs, calling that source through a validated tool, and writing an answer that is grounded only in the returned data. If the data is unavailable (unknown city, API down, unsupported currency), the agent must say so instead of guessing.

This is a good fit for an agent because one user request often needs zero, one, or several tools, and the right choice depends on the wording of the request — it cannot be solved by a fixed sequence of calls.

## Target Users

- Students and young travellers planning short trips (e.g. Almaty → Istanbul, Astana → Seoul).
- People who want a quick answer in one place: "What will the weather be in Tbilisi this weekend and how much is 50 000 KZT in lari?"
- The course instructor, as a demonstration of LLM tool selection, argument validation and grounded answers.

## Selected Difficulty

C — Tool-using AI agent.

The design keeps a path open to A level (three tools already planned, explicit limits and logging), but the committed target is C.

## Expected Functionality

1. Accept a natural-language travel question from the command line.
2. Send the question to a real LLM together with the registered tool schemas.
3. Let the LLM decide whether a tool is needed, which one, and with which arguments.
4. Validate tool arguments in application code before execution (types, required fields, allowed currency codes, day ranges).
5. Execute real tool calls against free public APIs (no API keys needed for the tools).
6. Return tool results to the LLM and produce a final answer based on them.
7. Answer general questions that need no tools (e.g. "What should I pack for a winter trip?") without calling tools.
8. Handle failures: unknown city, unsupported currency, network timeout, malformed LLM output, LLM API errors.
9. Write a structured JSON-lines log of every tool call (tool name, validated arguments, status, duration).
10. Enforce simple limits: maximum number of LLM rounds and tool calls per request, request timeouts.

## Proposed Functions

| Name | Purpose | Input | Expected output | Dependencies |
|---|---|---|---|---|
| `complete(messages, tools)` | Provider adapter: send a chat request to the LLM | array of chat messages, array of tool schemas | `{text, toolCalls: [{id, name, arguments}]}` | OpenAI-compatible Chat Completions API (`fetch`) |
| `getWeatherForecast({city, days})` | Daily forecast for a city | `city: string` (1–100 chars), `days: integer 1–7` | `{city, country, days: [{date, tempMin, tempMax, precipitationMm, description}]}` or `{error}` | Open-Meteo geocoding + forecast API |
| `convertCurrency({amount, from, to})` | Convert money using today's rates | `amount: number > 0`, `from`/`to`: 3-letter ISO 4217 codes | `{amount, from, to, rate, result, rateDate}` or `{error}` | open.er-api.com (free, no key) |
| `getCountryInfo({country})` | Basic facts about a country | `country: string` (1–100 chars) | `{name, capital, region, population, currencies, languages, timezones}` or `{error}` | REST Countries API |
| `validateArgs(schema, args)` | Reject malformed tool arguments before execution | JSON schema subset, model-supplied arguments | `{ok: true, value}` or `{ok: false, errors: [...]}` | none |
| `runAgent(question, deps)` | Agent loop: LLM → tools → LLM → answer | user question, injected `complete` and tool registry | `{answer, toolCalls: [...], stopReason}` | `complete`, tool registry, logger |
| `logToolCall(entry)` | Append a trace entry to the log | `{time, tool, args, status, ms, error?}` | line in `logs/tool-calls.jsonl` | `node:fs` |

Example signature:

```js
/**
 * Returns a daily forecast for a city.
 * @param {{city: string, days: number}} args  days in 1..7
 * @returns {Promise<{city, country, days: Array} | {error: string}>}
 */
export async function getWeatherForecast({ city, days }) { ... }
```

## Proposed Agent Tools

All three tools are exposed to the LLM as function-calling tools with JSON schemas. The LLM decides which (if any) to call.

1. **`get_weather_forecast`** — the LLM cannot know future weather; without this tool it would invent a forecast. Needed for "What will the weather be in Seoul on Friday?".
2. **`convert_currency`** — exchange rates change every day and LLMs are bad at precise arithmetic; the tool returns the real rate and the computed result. Needed for "How much is 100 USD in KZT?".
3. **`get_country_info`** — gives verified facts (capital, currency code, languages, time zones). It is also useful as a first step: the LLM can look up a country's currency code and then call `convert_currency`.

Requests that need no tools (travel tips, packing lists, general explanations) must be answered directly.

Tools are read-only: they only perform HTTP GET requests to public APIs and never change external state, so human approval for actions is not required.

## Model Selection

- **Primary:** `openai/gpt-oss-120b` through the **Groq** API (free tier, fast, supports OpenAI-style function calling).
- The adapter uses the **OpenAI-compatible Chat Completions** format, so the provider is configurable with environment variables (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`). Alternatives that work without code changes: Google Gemini (OpenAI-compatible endpoint), OpenRouter, OpenAI, or a local model through **Ollama** (`http://localhost:11434/v1`, e.g. `qwen2.5:7b`).
- Language: **Node.js 22**, no external npm dependencies (built-in `fetch`, `node:test`).
- API keys are read from `.env` / environment variables and never committed.

## Architecture

```text
            ┌──────────────┐
 user ────▶ │  CLI (src/cli.mjs) │
            └──────┬───────┘
                   ▼
            ┌──────────────┐   messages + tool schemas   ┌─────────────┐
            │  Agent loop  │ ──────────────────────────▶ │     LLM     │
            │ (src/agent)  │ ◀────────────────────────── │ (Groq etc.) │
            └──────┬───────┘   text or tool_calls         └─────────────┘
                   │ tool_calls
                   ▼
            ┌──────────────┐  invalid → error message back to LLM
            │  Validator   │
            └──────┬───────┘
                   ▼ valid
            ┌──────────────┐     HTTP GET     ┌──────────────────────────┐
            │ Tool registry│ ───────────────▶ │ Open-Meteo / ER-API /    │
            │              │ ◀─────────────── │ REST Countries           │
            └──────┬───────┘                  └──────────────────────────┘
                   │ result (or {error})
                   ├──▶ logs/tool-calls.jsonl
                   ▼
           back to LLM as role "tool" → final grounded answer → user
```

Flow: User Request → LLM → Tool Selection → Argument Validation → Tool Execution → LLM → Answer. The loop stops when the LLM returns a final text answer or when a limit (max rounds / max tool calls) is reached.

## Example Requests

1. "What will the weather be in Almaty for the next 3 days?" → `get_weather_forecast({city: "Almaty", days: 3})`.
2. "How much is 150 000 KZT in euros?" → `convert_currency({amount: 150000, from: "KZT", to: "EUR"})`.
3. "I'm going to Georgia next week. What currency do they use, how much is 200 USD in it, and what's the weather in Tbilisi?" → `get_country_info`, then `convert_currency` with the returned currency code, plus `get_weather_forecast`.
4. "Give me a packing list for a winter city trip." → no tool call.
5. "Weather in Xyzqwerty city?" → tool returns "city not found"; the agent says it could not find the city instead of inventing a forecast.

## Evaluation Plan

- **Unit tests (`node --test`) with mocked `fetch`**, so they are deterministic and need no API keys:
  - provider adapter parses text replies and tool calls, and throws clear errors on HTTP errors, timeouts and malformed responses;
  - argument validator rejects missing fields, wrong types, out-of-range `days`, invalid currency codes;
  - each tool returns correct normalised data for a sample API response and `{error}` for "not found" / network failure.
- **Agent-loop tests with a scripted mock LLM:** correct tool is executed, the result is passed back, requests without tools do not call tools, invalid arguments are not executed, limits stop the loop.
- At least **8 tests** in total (target: 15+).
- **Manual evaluation with the real model:** a fixed set of ~15 prompts (including the examples above and unseen-style cases: wrong city, unsupported currency, request needing two tools). For each: was the right tool selected, were the arguments correct, is the answer consistent with tool output (no invented numbers). Results recorded in `reports/week-16.md`.
- Tool logs (`logs/tool-calls.jsonl`) used as evidence of real tool selection.

## Weekly Milestones

| Week | Dates | Plan |
|---|---|---|
| 10 | 02.11–08.11 | Choose topic and level, write this proposal. |
| 11 | 09.11–15.11 | Provider adapter (OpenAI-compatible), `.env` config, CLI with the first real LLM request, adapter tests with mocked `fetch`, README setup instructions. |
| 12 | 16.11–22.11 | Implement the three tool functions against the real APIs, argument validator, unit tests for tools and validation. |
| 13 | 23.11–29.11 | Register tools with the LLM, implement the tool-calling loop, demonstrate real tool selection, JSON-lines tool log. |
| 14 | 30.11–06.12 | Complete workflow: multi-tool requests, tool error handling, requests without tools, round/tool-call limits. |
| 15 | 07.12–13.12 | Reliability: retries with backoff for LLM/API errors, timeouts, malformed model output handling, more tests. |
| 16 | 14.12–20.12 | Run the evaluation prompt set, record results, analyse and fix failures, update documentation. |
| 17 | 21.12–22.12 | Final README, final report, commit hash, demo and defense preparation. |

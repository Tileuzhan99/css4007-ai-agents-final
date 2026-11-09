# Semester Week 11 Progress Report

## Completed Work

- Wrote and committed the project proposal (`reports/proposal.md`): Sapar, a C-level travel assistant with three planned tools.
- Implemented the LLM provider adapter `src/model-client.mjs` for any OpenAI-compatible Chat Completions API (default: Groq, `openai/gpt-oss-120b`). It returns `{text, toolCalls}`, already supports sending tool schemas and parsing tool calls for Week 13.
- Error handling: request timeout, retries with exponential backoff on 429 / 5xx / network errors, no retry on 401/403, malformed response detection, invalid JSON in tool arguments flagged instead of crashing. Error messages never contain the API key.
- Configuration from environment variables / `.env` (`src/config.mjs`), `.env.example` with Groq, Gemini and Ollama options.
- System prompt and input validation (`src/prompts.mjs`), CLI entry point `npm start -- "question"`.
- 10 unit tests with mocked `fetch` (`tests/model-client.test.mjs`).
- Project section with setup instructions added to the top of `README.md`.

## Important Commits

- `d9bb4f2` — Project proposal: Sapar travel assistant (level C) — https://github.com/Tileuzhan99/css4007-ai-agents-final/commit/d9bb4f2
- `10fa56b` — OpenAI-compatible LLM adapter, config loader and CLI — https://github.com/Tileuzhan99/css4007-ai-agents-final/commit/10fa56b
- `5f112e3` — Adapter tests and setup instructions — https://github.com/Tileuzhan99/css4007-ai-agents-final/commit/5f112e3

## Current Functionality

The CLI sends a travel question to a real LLM and prints the answer. Example: `npm start -- "What should I pack for Astana in January?"`. Tools are not implemented yet, so the assistant is instructed not to invent live data such as forecasts or exchange rates.

## Problems Encountered

- Different providers use different API formats.
- Tests must not depend on a real API key or on network access.
- An LLM can return tool-call arguments that are not valid JSON.
- The default model `llama-3.3-70b-versatile` returned 404 `model_not_found`: Groq shut it down on 16 Aug 2026.

## Solutions

- Used the OpenAI-compatible Chat Completions format, which Groq, Gemini, OpenRouter and Ollama all support; the provider is selected by `LLM_BASE_URL` and `LLM_MODEL`.
- `fetch` is injected into `createClient`, so tests use a mock and run offline.
- Invalid arguments are kept as `{__invalid_json: raw}` so the agent loop (Week 13) can return an error to the model instead of crashing.
- Switched the default model to `openai/gpt-oss-120b` (Groq recommended replacement, supports tool calling). Only configuration changed, no code changes were needed, which confirms the provider-agnostic design. Verified with a real request to the model via the CLI.

## What I Learned

The structure of a Chat Completions request and response (`messages`, `tools`, `tool_calls`, `finish_reason`), which HTTP errors are worth retrying, exponential backoff, request timeouts with `AbortSignal.timeout`, and writing tests with dependency injection instead of real network calls.

## Next Week

Week 12: implement `getWeatherForecast` (Open-Meteo), `convertCurrency` (open.er-api.com) and `getCountryInfo` (REST Countries), an argument validator, and unit tests for tools and validation.

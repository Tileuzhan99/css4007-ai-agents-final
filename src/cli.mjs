#!/usr/bin/env node
// Usage: npm start -- "What should I pack for Astana in January?"
import { createClient, LLMError } from './model-client.mjs';
import { buildMessages } from './prompts.mjs';

async function main() {
  const question = process.argv.slice(2).join(' ');
  if (!question.trim()) {
    console.error('Usage: npm start -- "your travel question"');
    process.exitCode = 2;
    return;
  }
  try {
    const client = createClient();
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(client.config.baseUrl);
    if (!client.config.apiKey && !isLocal) {
      throw new LLMError('LLM_API_KEY is not set. Copy .env.example to .env and add your key.');
    }
    const { text } = await client.complete(buildMessages(question));
    if (!text.trim()) throw new LLMError('Model returned an empty answer');
    console.log(text.trim());
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}

main();

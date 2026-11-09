// System prompt for Sapar. Tools are added in Week 13; for now the model answers directly.
export const SYSTEM_PROMPT = `You are Sapar, a concise travel assistant.
- Help with trip planning: weather, money, destination facts, packing, practical tips.
- Never invent live data such as forecasts, exchange rates or prices. If you do not have a tool result for it, say that you cannot check it right now.
- Keep answers short and practical. Answer in the language of the user's question.`;

/** Builds the message list for a single user question. Rejects empty or oversized input. */
export function buildMessages(question, { maxChars = 2000 } = {}) {
  if (typeof question !== 'string' || !question.trim()) throw new Error('Question must be a non-empty string');
  const q = question.trim();
  if (q.length > maxChars) throw new Error(`Question is too long (max ${maxChars} characters)`);
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: q },
  ];
}

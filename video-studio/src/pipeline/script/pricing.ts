// Цены Claude API, $ за миллион токенов (кэш на 2026-09-25 из документации
// Anthropic). Бесплатные провайдеры (Gemini free tier, Groq, OpenRouter :free,
// Ollama) считаем по нулям. Токены размышлений входят в output_tokens.

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

const CLAUDE_PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
  // Возможные цели серверного fallback и модели «по выбору» через LLM_MODEL.
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 0.25 },
};

// Неизвестная модель семейства — по самой дорогой известной цене семейства,
// чтобы оценка расходов не занижалась.
const FAMILY_FALLBACK: [RegExp, Price][] = [
  [/opus/, { input: 5, output: 25, cacheRead: 0.5 }],
  [/sonnet/, { input: 3, output: 15, cacheRead: 0.3 }],
  [/haiku/, { input: 1, output: 5, cacheRead: 0.1 }],
  [/fable|mythos/, { input: 10, output: 50, cacheRead: 0.25 }],
];

export function claudePrice(model: string): Price {
  const id = model.replace(/^anthropic\./, "").replace(/\[.*\]$/, "").trim();
  if (CLAUDE_PRICES[id]) return CLAUDE_PRICES[id];
  for (const [re, price] of FAMILY_FALLBACK) if (re.test(id)) return price;
  return { input: 5, output: 25, cacheRead: 0.5 };
}

export interface TokenCounts {
  input: number; // некэшированный вход
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

// Серверный веб-поиск Claude: $10 за 1000 поисков сверх токенов (документация
// Anthropic, 2026-10); поиск с ошибкой не оплачивается.
export const WEB_SEARCH_USD_PER_REQUEST = 0.01;

export function webSearchCostUsd(requests: number): number {
  return Math.round(Math.max(0, requests) * WEB_SEARCH_USD_PER_REQUEST * 1e6) / 1e6;
}

// Запись в кэш (TTL 5 минут) стоит 1.25× входа, чтение — по своей цене.
export function claudeCostUsd(model: string, t: TokenCounts): number {
  const p = claudePrice(model);
  const usd = (t.input * p.input + t.cacheWrite * p.input * 1.25 + t.cacheRead * p.cacheRead + t.output * p.output) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

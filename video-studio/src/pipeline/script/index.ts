// Модуль сценария (контракт — src/pipeline/contracts.ts):
//   generateScript(req) → { script, usage }   тема → проверенный VideoScript через LLM
//   validateScript(json) → VideoScript         проверка своего/чужого JSON, бросает Error со списком проблем
//
// Провайдер — LLM_PROVIDER (gemini по умолчанию, бесплатно), запасные —
// LLM_FALLBACKS или все бесплатные провайдеры с ключами.

export { generateScript, type ScriptDeps } from "./generate";
export { validateScript, lintScript, ScriptValidationError } from "./validate";
export { extractJson } from "./json";
export { resolveChain, LLM_PROVIDERS, type LlmProviderName } from "./llm/chain";
export { VideoScriptSchema, toCompatJsonSchema } from "./schema";
export { claudeCostUsd, claudePrice } from "./pricing";

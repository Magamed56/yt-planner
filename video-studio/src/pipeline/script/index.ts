// Модуль сценария (контракт — src/pipeline/contracts.ts):
//   generateScript(req) → { script, usage, warnings }   тема → проверенный VideoScript через LLM
//   validateScript(json) → VideoScript         проверка своего/чужого JSON, бросает Error со списком проблем
//
// Провайдер — LLM_PROVIDER (gemini по умолчанию, бесплатно), запасные —
// LLM_FALLBACKS или все бесплатные провайдеры с ключами.

export { generateScript, ScriptGenerationError, type ScriptDeps, type ScriptResult } from "./generate";
export { validateScript, lintScript, ScriptValidationError, WORDS_PER_SECOND } from "./validate";
export { extractJson } from "./json";
export { resolveChain, LLM_PROVIDERS, type LlmProviderName } from "./llm/chain";
export { VideoScriptSchema, toCompatJsonSchema } from "./schema";
export { claudeCostUsd, claudePrice } from "./pricing";
export { LONG_DEFAULT_SECONDS, LONG_SCENES, type ScriptExtras, type ScriptGenRequest } from "./prompt";
export { loadCovered, findRepeats, indexCovered, type CoveredEntry } from "./covered";
export { searchPhrases } from "./suggest";
export { appendUsage, llmUsageRecord, ttsUsageRecord, countPostRequests, type UsageRecord, type LlmCallInfo } from "./usage-log";

// Запасной голос: кто озвучивает ролик, если основной провайдер не работает, и как
// об этом сказать — в сводке запуска и в qc.json (он уходит в релиз, панель
// предупреждает о ролике «не тем» голосом). Чистые функции, проверяет src/dev/voice-test.ts.

import type { VoiceResult, VoiceUsed } from "../contracts";
import type { QcIssue } from "../qc";
import { TtsError } from "./http";

type Env = Record<string, string | undefined>;

// TTS_FALLBACK=none: квота кончилась — запуск падает, а не выпускает ролик другим
// голосом. Так запускает автопилот панели (поле voice_fallback = none в workflow).
export function fallbackDisabled(env: Env = process.env): boolean {
  return /^(none|off|0|false|no)$/i.test(env.TTS_FALLBACK?.trim() ?? "");
}

export function fallbackProviderNames(primary: string, env: Env = process.env): string[] {
  if (fallbackDisabled(env)) return [];
  const raw = env.TTS_FALLBACK?.trim().toLowerCase();
  if (raw) return raw.split(",").map((v) => v.trim()).filter((v) => v && v !== primary);
  // Edge — неофициальный API, его могут закрыть или ограничить для IP
  // датацентров; Piper работает офлайн везде. У Gemini маленькая суточная
  // квота — кончилась, значит весь ролик озвучит Edge (а если и он недоступен — Piper).
  // Платные (ElevenLabs) и локальные серверы выбирают осознанно — их молча не подменяем.
  if (primary === "gemini") return ["edge", "piper"];
  if (primary === "edge") return ["piper"];
  return [];
}

const LABELS: Record<string, string> = { gemini: "Gemini", edge: "Edge", piper: "Piper", elevenlabs: "ElevenLabs", openai: "OpenAI-совместимого сервера", fish: "Fish Speech" };
export const providerLabel = (p: string) => LABELS[p] ?? p;

export function isQuotaError(e: unknown): boolean {
  if (e instanceof TtsError) return e.status === 429;
  return /HTTP 429\b/.test(e instanceof Error ? e.message : String(e));
}

const firstLine = (e: unknown, max = 160) => {
  const s = (e instanceof Error ? e.message : String(e)).split("\n")[0]!.trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

// Почему основной голос не озвучил ролик — коротко, для qc.json и сводки.
export function failureReason(provider: string, e: unknown): string {
  return isQuotaError(e) ? `квота ${providerLabel(provider)} закончилась` : firstLine(e);
}

// Строка для сводки запуска, когда ролик не озвучен вовсе. Квота и сбои сети проходят
// сами: панель повторяет упавший запуск (а автопилот назавтра снова берёт ролик без видео).
export function voiceFailureSummary(provider: string, e: unknown): string {
  if (isQuotaError(e)) return `квота ${providerLabel(provider)} закончилась — ролик соберётся при повторе`;
  const retry = e instanceof TtsError ? e.retryable : true;
  return `озвучка ${providerLabel(provider)} не удалась (${firstLine(e)}) — ${retry ? "ролик соберётся при повторе" : "повтор не поможет: проверьте ключ и настройки озвучки"}`;
}

export function voiceUsed(o: { requested: string; provider: string; results: VoiceResult[]; model: string | null; reason: string | null }): VoiceUsed {
  const fallback = o.provider !== o.requested;
  const fbModel = o.results.find((r) => r.fallbackModel)?.fallbackModel ?? null;
  const reason = fallback
    ? o.reason
    : fbModel
      ? `основная модель${o.model ? ` ${o.model}` : ""} не ответила (обычно кончилась её суточная квота) — озвучено запасной ${fbModel}`
      : null;
  return {
    provider: o.provider,
    name: o.results.find((r) => r.voice)?.voice ?? null,
    model: fbModel ?? o.model,
    requested: o.requested,
    fallback,
    modelFallback: Boolean(fbModel),
    reason,
  };
}

// «gemini · Charon» или «⚠ edge · ru-RU-DmitryNeural — запасной вместо gemini: квота Gemini закончилась».
export function describeVoice(u: VoiceUsed): string {
  const base = `${u.provider}${u.name ? ` · ${u.name}` : ""}`;
  if (u.fallback) return `⚠ ${base} — запасной вместо ${u.requested}${u.reason ? `: ${u.reason}` : ""}`;
  if (u.modelFallback) return `${base} · запасная модель ${u.model ?? "?"}`;
  return base;
}

// Предупреждение в qc.json (не ошибка: ручной запуск с запасным голосом — осознанный выбор).
export function voiceQcIssues(u: VoiceUsed): QcIssue[] {
  if (!u.fallback) return [];
  return [
    {
      id: "voice-fallback",
      severity: "warn",
      message: `озвучено запасным голосом ${u.provider}${u.name ? ` (${u.name})` : ""} вместо ${u.requested}${u.reason ? ` — ${u.reason}` : ""}. Нужен основной голос — пересоберите ролик («Пересобрать» в панели; если кончилась квота — на следующий день).`,
    },
  ];
}

// «Перед загрузкой проверьте» в карточке ролика: что нашла автопроверка (qc.json релиза), каким
// голосом озвучено и откуда кадры (блок «Видео и фото» в description.txt). Чистые функции без
// сети — их проверяет scripts/checks-test.ts; файлы читает маршрут /api/release-checks.
import type { ChannelConfig } from "../../src/pipeline/channel";

// Ключи стоков: хотя бы один — и в роликах есть живое видео, а не только архивные фото.
export const STOCK_SECRETS = ["PEXELS_API_KEY", "PIXABAY_API_KEY"];
export const STOCK_SECRETS_LABEL = STOCK_SECRETS.join(", ");

// Рубрики, где конвейер сначала ищет настоящие фото (Wikimedia, Openverse), а сток — только если
// их нет (кроме сцен media без имени собственного — там сначала видео стока):
// DEFAULT_REAL_PILLARS в src/pipeline/visuals (импортировать нельзя — там fs). В Actions
// VISUALS_REAL_PILLARS не передаётся, так что действует именно этот список; совпадение
// проверяет scripts/checks-test.ts. У таких роликов «только Wikimedia» — норма, а не сбой ключей.
export const REAL_PHOTO_PILLARS = ["history", "nature", "space"];
export const realPhotosFirst = (pillar: string | null | undefined) => Boolean(pillar && REAL_PHOTO_PILLARS.includes(pillar.trim().toLowerCase()));

export interface VoiceRef {
  provider: string | null; // gemini | edge | piper | …
  name: string | null; // Charon, ru-RU-DmitryNeural…
}

export interface VoiceUsed {
  provider: string;
  name: string | null;
  requested: string | null; // какой провайдер был основным (qc.json.voice.requested)
  fallback: boolean; // озвучил запасной провайдер
  reason: string | null;
}

export interface QcIssue {
  id: string;
  severity: "error" | "warn";
  message: string;
}

export interface QcFacts {
  ok: boolean | null;
  issues: QcIssue[];
  voice: VoiceUsed | null; // qc.json.voice — есть только у сборок новее записи голоса
}

export interface CreditFacts {
  block: boolean; // в описании есть «Видео и фото:»
  stockVideo: number; // клипы Pexels/Pixabay
  stockPhoto: number; // фото Pexels
  stockOther: number; // строка стока без понятной ссылки
  archive: number; // Wikimedia Commons, Openverse и прочие фото
  hidden: number; // свёрнуто в «… и ещё N источников»
  hiddenProviders: string[];
  providers: { name: string; count: number }[];
  ai: string | null; // «Часть изображений сгенерирована ИИ (…)» — список моделей
  voice: VoiceUsed | null; // строка «Озвучка: …» (была в описаниях до 08.10.2026)
}

// Версия формата ответа /api/release-checks — в адресе запроса: браузер помнит ответ сутки, и
// после смены разбора старый ответ не должен подставиться.
export const FACTS_VERSION = 1;

export type FileFacts<T> = { state: "ok"; data: T } | { state: "missing" } | { state: "error"; message: string };

export interface ReleaseFacts {
  qc: FileFacts<QcFacts>;
  credits: FileFacts<CreditFacts>;
}

export type CheckLevel = "error" | "warn" | "info" | "ok";

export interface CheckLine {
  level: CheckLevel;
  text: string;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---- голос ----

const VOICE_TITLE: Record<string, string> = {
  gemini: "Gemini",
  edge: "Edge",
  piper: "Piper",
  elevenlabs: "ElevenLabs",
  openai: "OpenAI-совместимый",
  fish: "Fish Speech",
};

// Провайдер по виду имени голоса — как applyPillarVoice в src/pipeline/channel.ts.
function providerByName(name: string): string | null {
  if (/Neural$/.test(name)) return "edge";
  if (/^[a-z]{2}_[A-Z]{2}-/.test(name)) return "piper";
  if (/^[A-Z][a-z]+$/.test(name)) return "gemini";
  return null;
}

// Каким голосом ролик должен быть озвучен: голос рубрики (voiceByPillar), иначе голос канала.
// Переменные GitHub Actions могут это перебить — поэтому в карточке «если это не нарочно».
export function expectedVoice(ch: Pick<ChannelConfig, "voice" | "voiceByPillar">, pillar: string | null | undefined): VoiceRef | null {
  const pv = pillar ? ch.voiceByPillar[pillar] : undefined;
  if (pv?.voice || pv?.provider) return { provider: pv.provider ?? (pv.voice ? providerByName(pv.voice) : null), name: pv.voice };
  const name = ch.voice.name;
  const provider = ch.voice.provider?.toLowerCase() ?? (name ? providerByName(name) : null);
  return provider || name ? { provider, name } : null;
}

export function voiceLabel(v: { provider: string | null; name: string | null }): string {
  const title = v.provider ? (VOICE_TITLE[v.provider.toLowerCase()] ?? v.provider) : null;
  return [title, v.name].filter(Boolean).join(" · ") || "неизвестный";
}

// Голос не тот, если отличается провайдер или имя (когда оба известны).
export function voiceDiffers(used: VoiceRef, want: VoiceRef): boolean {
  const differ = (a: string | null, b: string | null) => Boolean(a && b && a.toLowerCase() !== b.toLowerCase());
  return differ(used.provider, want.provider) || differ(used.name, want.name);
}

// qc.json.voice (VoiceUsed конвейера): { provider, name, requested, fallback, reason, … }.
export function parseVoiceUsed(v: unknown): VoiceUsed | null {
  if (!isObj(v)) return null;
  const provider = str(v.provider)?.toLowerCase();
  if (!provider) return null;
  const requested = str(v.requested)?.toLowerCase() ?? null;
  return {
    provider,
    name: str(v.name),
    requested,
    fallback: v.fallback === true || (requested !== null && requested !== "auto" && requested !== provider),
    reason: str(v.reason),
  };
}

// ---- qc.json ----

// null — не JSON или не похоже на отчёт QC (src/pipeline/qc.ts → QcReport).
export function parseQc(text: string): QcFacts | null {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(j) || (!Array.isArray(j.issues) && typeof j.ok !== "boolean")) return null;
  const issues: QcIssue[] = [];
  for (const i of Array.isArray(j.issues) ? j.issues : []) {
    const message = isObj(i) ? str(i.message) : null;
    if (message) issues.push({ id: str(i.id) ?? "", severity: i.severity === "error" ? "error" : "warn", message });
  }
  return { ok: typeof j.ok === "boolean" ? j.ok : null, issues, voice: parseVoiceUsed(j.voice) };
}

// ---- description.txt: блок «Видео и фото» (src/pipeline/meta.ts → creditLines) ----

const MEDIA_HEADER = /^(Видео и фото|Video and photos|Бейне және фото|Video va suratlar):\s*$/;
const AI_LINE = /(сгенерирована ИИ|generated by AI|ЖИ жасаған|sunʼiy intellekt)[^(]*\((.+)\)/;
const VOICE_LINE = /^Озвучка:\s*(?:синтезированный голос\s*—\s*)?(.+?)(?:,\s*голос\s+(.+?))?\s*$/;

function voiceFromTitle(title: string): string {
  const t = title.toLowerCase();
  for (const id of Object.keys(VOICE_TITLE)) if (t.includes(id)) return id;
  return t;
}

type MediaKind = "video" | "photo" | "other";

// Pexels отдаёт и клипы, и фото — их различает ссылка. Pixabay конвейер берёт только видео.
function stockKind(provider: string, url: string | null): MediaKind | null {
  const p = provider.toLowerCase();
  if (p === "pexels") {
    if (url && /pexels\.com\/(?:[a-z]{2}-[a-z]{2}\/)?video\//i.test(url)) return "video";
    if (url && /pexels\.com\/(?:[a-z]{2}-[a-z]{2}\/)?photo\//i.test(url)) return "photo";
    return "other";
  }
  if (p === "pixabay") return url && /pixabay\.com\/(?:[a-z]{2}\/)?(?:photos|illustrations|vectors)\//i.test(url) ? "photo" : "video";
  return null;
}

const isStock = (provider: string) => stockKind(provider, null) !== null;

export function parseCredits(text: string): CreditFacts {
  const out: CreditFacts = { block: false, stockVideo: 0, stockPhoto: 0, stockOther: 0, archive: 0, hidden: 0, hiddenProviders: [], providers: [], ai: null, voice: null };
  const count = (name: string) => {
    const p = out.providers.find((x) => x.name === name);
    if (p) p.count++;
    else out.providers.push({ name, count: 1 });
  };
  let inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (MEDIA_HEADER.test(line)) {
      out.block = inBlock = true;
      continue;
    }
    if (inBlock && line.startsWith("•")) {
      const body = line.replace(/^•\s*/, "");
      if (body.startsWith("…")) {
        // «… и ещё 5 источников (Pexels, Wikimedia Commons)» — описание не влезло в 5000 байт.
        out.hidden += Number(/\d+/.exec(body)?.[0] ?? 0);
        const list = /\(([^()]+)\)\s*$/.exec(body)?.[1];
        for (const p of list?.split(",") ?? []) if (p.trim() && !out.hiddenProviders.includes(p.trim())) out.hiddenProviders.push(p.trim());
        continue;
      }
      const url = /(https?:\/\/\S+)\s*$/.exec(body)?.[1] ?? null;
      const provider = body.split(/\s+—\s+|\s+https?:\/\//)[0]!.trim();
      if (!provider) continue;
      count(provider);
      const kind = stockKind(provider, url);
      if (kind === "video") out.stockVideo++;
      else if (kind === "photo") out.stockPhoto++;
      else if (kind === "other") out.stockOther++;
      else out.archive++;
      continue;
    }
    inBlock = false;
    const ai = AI_LINE.exec(line);
    if (ai) out.ai = ai[2]!.trim();
    const v = VOICE_LINE.exec(line);
    if (v) out.voice = { provider: voiceFromTitle(v[1]!), name: v[2]?.trim() || null, requested: null, fallback: false, reason: null };
  }
  return out;
}

// ---- итог для карточки ----

const QC_SHOWN = 5;
const LEVEL_ORDER: Record<CheckLevel, number> = { error: 0, warn: 1, info: 2, ok: 3 };

export interface CheckContext {
  voice: VoiceRef | null; // каким голосом должно быть (expectedVoice)
  stockKeysMissing: boolean | null; // в секретах GitHub нет ключей стоков; null — неизвестно
  realPhotos?: boolean; // рубрика из REAL_PHOTO_PILLARS: настоящие фото важнее стока
}

function qcLines(f: FileFacts<QcFacts>): CheckLine[] {
  if (f.state === "missing") return [{ level: "info", text: "Автопроверки (qc.json) в релизе нет — ролик собран до неё или залит с компьютера: посмотрите видео целиком." }];
  if (f.state === "error") return [{ level: "info", text: `Автопроверку не прочитать (${f.message}) — посмотрите видео целиком.` }];
  const q = f.data;
  // Запасной голос qc.json пишет и отдельным замечанием — его показывает строка о голосе.
  const issues = q.voice ? q.issues.filter((i) => i.id !== "voice-fallback") : q.issues;
  const sorted = [...issues.filter((i) => i.severity === "error"), ...issues.filter((i) => i.severity === "warn")];
  const out: CheckLine[] = sorted.slice(0, QC_SHOWN).map((i) => ({ level: i.severity, text: `QC: ${capital(i.message)}` }));
  const rest = sorted.length - QC_SHOWN;
  if (rest > 0) out.push({ level: sorted.slice(QC_SHOWN).some((i) => i.severity === "error") ? "error" : "warn", text: `QC: ещё ${rest} — полный список в qc.json релиза («Релиз ↗»).` });
  if (q.ok === false && !sorted.some((i) => i.severity === "error")) out.unshift({ level: "error", text: "Автопроверка не пройдена — подробности в qc.json релиза («Релиз ↗»)." });
  if (!out.length) out.push({ level: "ok", text: "Автопроверка пройдена: длительность, кадр и звук в порядке." });
  return out;
}

function voiceLine(used: VoiceUsed | null, want: VoiceRef | null): CheckLine {
  if (!used) {
    return { level: "info", text: `Каким голосом озвучено, в релизе не записано — послушайте начало${want ? `: должен быть ${voiceLabel(want)}` : ""}.` };
  }
  if (used.fallback) {
    const instead = used.requested ? ` вместо ${voiceLabel({ provider: used.requested, name: null })}` : "";
    return {
      level: "warn",
      text: `Озвучено запасным голосом ${voiceLabel(used)}${instead}${used.reason ? ` (${used.reason})` : ""}. Пересоберите с голосом канала; если кончилась квота — на следующий день.`,
    };
  }
  if (want && voiceDiffers(used, want)) {
    return { level: "warn", text: `Голос ${voiceLabel(used)}, а у канала — ${voiceLabel(want)}. Если это не нарочно — «Пересобрать» с голосом канала.` };
  }
  return { level: "ok", text: `Голос: ${voiceLabel(used)}.` };
}

function stockHint(missing: boolean | null): string {
  if (missing === true) return ` В секретах GitHub нет ${STOCK_SECRETS.join(" и ")} — добавьте бесплатные ключи и пересоберите.`;
  if (missing === false) return " Ключи стоков уже заданы — пересборка подберёт видео заново.";
  return ` Для видео нужны ${STOCK_SECRETS.join(" или ")} в секретах GitHub (ключи бесплатные).`;
}

function visualLines(f: FileFacts<CreditFacts>, ctx: CheckContext): CheckLine[] {
  if (f.state === "missing") return [{ level: "info", text: "description.txt в релизе нет — откуда кадры, не видно." }];
  if (f.state === "error") return [{ level: "info", text: `Описание не прочитать (${f.message}) — откуда кадры, не видно.` }];
  const c = f.data;
  const hiddenStock = c.hiddenProviders.some(isStock);
  const stock = c.stockVideo + c.stockPhoto + c.stockOther + (hiddenStock ? 1 : 0);
  const list = [...c.providers.map((p) => `${p.name} ${p.count}`), ...c.hiddenProviders.filter((p) => !c.providers.some((x) => x.name === p))].join(", ");
  if (!c.block) {
    if (c.ai) return [{ level: "info", text: `Кадры — только картинки ИИ (${c.ai}).` }];
    return [{ level: "warn", text: `В ролике нет ни видео, ни фото — только графика (в описании нет блока «Видео и фото»).${stockHint(ctx.stockKeysMissing)}` }];
  }
  // Рубрика «настоящих фото»: конвейер так и задуман — остаётся проверить глазами, что фото по
  // теме. Без ключей стоков сцены media (там сначала видео стока) тоже ушли в фото — подсказка.
  if (ctx.realPhotos && !c.stockVideo && !c.stockOther && !hiddenStock) {
    return [{ level: "info", text: `Кадры — фото (${list}): в этой рубрике сначала ищутся настоящие фото, а не сток (сток первым — только в сценах media без имени собственного). Проверьте, что они по теме.${ctx.stockKeysMissing === true ? stockHint(true) : ""}` }];
  }
  if (!stock) {
    const archive = c.providers.map((p) => p.name).join(", ") || c.hiddenProviders.join(", ") || "архивов";
    return [{ level: "warn", text: `Кадры только из ${archive} (${c.archive + c.hidden} фото), стокового видео нет — такие фото часто мимо темы.${stockHint(ctx.stockKeysMissing)}` }];
  }
  if (!c.stockVideo && !c.stockOther && !hiddenStock) {
    return [{ level: "warn", text: `Стокового видео нет — только фото (${list}). Пересборка подбирает видео первым.` }];
  }
  const photos = c.stockPhoto + c.archive;
  const parts = [c.stockVideo ? `видео — ${c.stockVideo}` : "", photos ? `фото — ${photos}` : "", c.ai ? "есть картинки ИИ" : ""].filter(Boolean).join(", ");
  return [{ level: "ok", text: `Кадры: ${parts || "из стоков"} (${list}).` }];
}

export function releaseChecks(f: ReleaseFacts, ctx: CheckContext): CheckLine[] {
  const used = (f.qc.state === "ok" ? f.qc.data.voice : null) ?? (f.credits.state === "ok" ? f.credits.data.voice : null);
  const lines = [...qcLines(f.qc), voiceLine(used, ctx.voice), ...visualLines(f.credits, ctx)];
  // Сначала то, что мешает загрузке, потом «проверьте сами», в конце — что в порядке.
  return lines.map((l, i) => ({ l, i })).sort((a, b) => LEVEL_ORDER[a.l.level] - LEVEL_ORDER[b.l.level] || a.i - b.i).map((x) => x.l);
}
